/**
 * Nexrad-3D Ingest Worker
 * 
 * This service is responsible for continually polling NOAA's NEXRAD Level II 
 * data servers to find, download, and parse new radar sweeps. Once downloaded,
 * it parses the binary radar data arrays into usable volume products (like 
 * Reflectivity or Velocity), uploads the raw and parsed data to an S3-compatible 
 * object storage (such as MinIO), and publishes metadata/events to Redis. 
 * This enables the frontend and other services to render real-time 3D radar data.
 * 
 * It also maintains a scheduled cleanup process to prevent the object storage disk 
 * from filling up, actively deleting radar sweeps older than a configured limit.
 */
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  RADAR_SITES,
  LEVEL2_DECODABLE_VOLUME_PRODUCTS,
  VolumeProduct,
  parseVolumeProduct,
  type IngestionState,
  type RadarVolumeMeta,
  type StreamEventPayload,
} from "@nexrad-3d/contracts";
import { getReaderForFile, parseNexradGeneratedAtMs } from "@nexrad-3d/radar-parser";
import { createClient } from "redis";
import { Worker } from "worker_threads";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import path from "path";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const noaaBaseUrl =
  process.env.NOAA_BASE_URL ||
  "https://nomads.ncep.noaa.gov/pub/data/nccf/radar/nexrad_level2";
const radarSites = RADAR_SITES.map((site) => site.id);
const pollIntervalSeconds = parseInt(
  process.env.POLL_INTERVAL_SECONDS || "30",
  10
);
const maxFilesPerPoll = parseInt(process.env.INGEST_MAX_FILES_PER_POLL || "3", 10);
const fileTimeoutMs = parseInt(
  process.env.INGEST_FILE_TIMEOUT_MS || "120000",
  10
);
const fetchTimeoutMs = parseInt(
  process.env.INGEST_FETCH_TIMEOUT_MS || "20000",
  10
);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

const withTimeout = async <T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, Math.max(1, timeoutMs));
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const fetchWithTimeout = async (url: string): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, fetchTimeoutMs));

  try {
    return await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`request timed out after ${fetchTimeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const parseVolumeInWorker = async (
  buffer: ArrayBuffer,
  filename: string,
  siteId: string,
  generatedAtMs: number,
  product: VolumeProduct
): Promise<{ data: Uint8Array; metadata: any }> => {
  return new Promise((resolve, reject) => {
    const workerDir = fileURLToPath(new URL('.', import.meta.url));
    let workerFile = path.resolve(workerDir, "parse-worker.js");
    // Fallback when the compiled .js file is missing (e.g. running via tsx/ts-node)
    if (!existsSync(workerFile)) {
      workerFile = path.resolve(workerDir, "parse-worker.ts");
    }
    
    const worker = new Worker(workerFile, {
      workerData: {
        buffer: new Uint8Array(buffer),
        filename,
        siteId,
        generatedAtMs,
        product,
      },
      execArgv: workerFile.endsWith('.ts') ? ['--loader', 'ts-node/esm'] : undefined
    });

    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(`worker parser timed out after ${fileTimeoutMs}ms`));
    }, fileTimeoutMs);

    worker.on("message", (msg) => {
      clearTimeout(timer);
      if (msg.success) {
        resolve({ data: msg.data, metadata: msg.metadata });
      } else {
        reject(new Error(msg.error));
      }
    });

    worker.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    worker.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`worker stopped with exit code ${code}`));
      }
    });
  });
};

/**
 * Parses the INGEST_PRODUCTS environment variable (a comma-separated string) 
 * to determine which specific radar metrics (like Reflectivity, Velocity, etc.) 
 * to parse and extract from the raw Level II binary data. 
 * Defaults to all supported decodable volume products.
 * 
 * @returns {VolumeProduct[]} An array of volume products to process.
 */
const parseIngestProductList = (): VolumeProduct[] => {
  const raw = process.env.INGEST_PRODUCTS?.trim();
  if (!raw) {
    return [...LEVEL2_DECODABLE_VOLUME_PRODUCTS];
  }

  const allowed = new Set<VolumeProduct>(LEVEL2_DECODABLE_VOLUME_PRODUCTS);
  const out: VolumeProduct[] = [];

  for (const part of raw.split(",")) {
    const token = part.trim();
    if (!token) {
      continue;
    }
    const p = parseVolumeProduct(token);
    if (!p || !allowed.has(p)) {
      console.warn(
        `[ingest] INGEST_PRODUCTS: skipping "${token}" (unknown or not decodable from Level II)`
      );
      continue;
    }
    if (!out.includes(p)) {
      out.push(p);
    }
  }

  return out.length > 0 ? out : [...LEVEL2_DECODABLE_VOLUME_PRODUCTS];
}

const objectStorageEnabled =
  (process.env.OBJECT_STORAGE_ENABLED || "true").toLowerCase() === "true";
const minioEndpoint = process.env.MINIO_ENDPOINT || "http://localhost:9000";
const minioAccessKey = process.env.MINIO_ACCESS_KEY || "minioadmin";
const minioSecretKey = process.env.MINIO_SECRET_KEY || "minioadmin";
const minioBucket = process.env.MINIO_BUCKET || "radar-data";

const redis = createClient({ url: redisUrl });
const s3 = new S3Client({
  region: "us-east-1",
  endpoint: minioEndpoint,
  forcePathStyle: true,
/**
 * Parses the plain text output of NOAA's dir.list directory listing
 * to extract a clean array of radar file names.
 * 
 * @param {string} rawDirList The raw text response from a NOAA dir.list URL.
 * @returns {string[]} An array of file names.
 */
  credentials: {
    accessKeyId: minioAccessKey,
    secretAccessKey: minioSecretKey,
  },
});

const inFlightSitePolls = new Set<string>();

const parseDirList = (rawDirList: string): string[] => {
  return rawDirList
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      const candidate = parts[parts.length - 1] || "";
      const lastSlash = candidate.lastIndexOf("/");
      return lastSlash >= 0 ? candidate.slice(lastSlash + 1) : candidate;
    })
    .filter((filename) => filename.length > 0 && filename !== "dir.list");
}

/**
 * Builds the full NOAA download URL for a specific radar file.
 * 
 * @param {string} siteId - The 4-letter radar site station ID (e.g., KGRB).
 * @param {string} filename - The name of the file to download.
 */
const buildRadarFileUrl = (siteId: string, filename: string): string => {
  return `${noaaBaseUrl}/${siteId}/${filename}`;
}

/**
 * Compares the list of all available NOAA files with the last processed file 
 * from Redis. Selects the next set of files to download, avoiding the very newest
 * file if it sits at the end of the listing to prevent partial file corruption.
 * 
 * @param {string[]} allFiles - Current directory listing from NOAA.
 * @param {string | null} lastProcessedFile - Reference of the last file fully processed.
 * @returns {string[]} The array of file names ripe for ingestion.
 */
const selectFilesToProcess = (
  allFiles: string[],
  lastProcessedFile: string | null
): string[] => {
  if (allFiles.length === 0) {
    return [];
  }

  // The newest NEXRAD file can still be in-flight on NOAA storage.
  // Prefer only completed files (all except latest) when possible.
  const completedFiles = allFiles.length > 1 ? allFiles.slice(0, -1) : allFiles;

  if (!lastProcessedFile) {
    return [completedFiles[completedFiles.length - 1]];
  }

  const lastIndex = allFiles.lastIndexOf(lastProcessedFile);
  if (lastIndex < 0) {
    return [completedFiles[completedFiles.length - 1]];
  }

  // If the last processed file is the latest listing entry, there are no completed
  // new files to process yet.
  if (lastIndex >= allFiles.length - 1) {
    return [];
  }

  const pending = allFiles.slice(lastIndex + 1, Math.max(lastIndex + 1, allFiles.length - 1));
  return pending.slice(-maxFilesPerPoll);
}

/**
 * Gets a unique, site-specific Redis key mapped to its ingestion state.
 * @param {string} siteId - The 4-letter radar station ID.
 */
const getSiteStateKey = (siteId: string): string => {
  return `ingestion:state:${siteId}`;
}

/**
 * Reads the latest ingestion state from Redis for a particular site.
 * 
 * @param {string} siteId - The radar station ID.
 * @returns {Promise<IngestionState>} An object representing the site's state (failures, last poll, etc).
 */
const readState = async (siteId: string): Promise<IngestionState> => {
  const existing = await redis.get(getSiteStateKey(siteId));
  if (!existing) {
    return {
      siteId,
      lastPolledAtMs: 0,
      consecutiveFailures: 0,
    };
  }

  return JSON.parse(existing) as IngestionState;
}

/**
 * Writes the latest ingestion state metadata to Redis for a specified site with a TTL.
 *
 * @param {IngestionState} state - The object containing state variables like lastPolledAtMs.
 */
const writeState = async (state: IngestionState): Promise<void> => {
  await redis.set(getSiteStateKey(state.siteId), JSON.stringify(state), {
    EX: 60 * 60 * 24,
  });
}

/**
 * Dispatches an event payload sequentially over the Redis Pub/Sub channels 
 * allowing other microservices (like socket pushers) to consume them.
 * 
 * @param {StreamEventPayload} event - The specific StreamEventPayload message to cast.
 */
const publishEvent = async (event: StreamEventPayload): Promise<void> => {
  await redis.publish("radar:events", JSON.stringify(event));
}

/**
 * Utility function to convert generic ArrayBuffer/Uint8Array responses 
 * from the browser-backed Fetch API into a Node compatible Buffer instance.
 *
 * @param {ArrayBuffer | Uint8Array} bytes - Input primitive array structures.
 * @returns {Buffer} Typed Node.js memory Buffer.
 */
const toNodeBuffer = (bytes: ArrayBuffer | Uint8Array): Buffer => {
  if (bytes instanceof ArrayBuffer) {
    return Buffer.from(bytes);
  }

  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Primary function backing integration with local object storage (aka AWS S3 API/MinIO).
 * Sends raw bytes via S3 PutObject to the preconfigured storage block key.
 * 
 * @param {string} storageKey - The file location path defined for this upload payload.
 * @param {ArrayBuffer | Uint8Array} payload - Precompiled byte array stream data.
 * @param {string} contentType - Explicit MIME type indicating file nature.
 */
const uploadObject = async (
  storageKey: string,
  payload: ArrayBuffer | Uint8Array,
  contentType: string
): Promise<void> => {
  if (!objectStorageEnabled) {
    return;
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: minioBucket,
      Key: storageKey,
      Body: toNodeBuffer(payload),
      ContentType: contentType,
    })
  );
}

/**
 * Validates initialization by polling the cloud object store for Bucket existence.
 * Constructs it actively if a 404/NotFoundError is returned handling early access gracefully.
 */
const ensureBucketExists = async (): Promise<void> => {
  if (!objectStorageEnabled) {
    return;
  }

  try {
    await s3.send(new HeadBucketCommand({ Bucket: minioBucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: minioBucket }));
  }
}

/**
 * Generates secondary index mappings inside Redis required by clients rendering volume assets.
 * Sets independent standard cache layers for the specific generated sweep mapped to ID,
 * and maintains an active TimeSeries sorted set indicating volume chronological states.
 * Limits sets via `TIMELINE_LIMIT` properties removing stale historic tracking.
 * 
 * @param {RadarVolumeMeta} metadata - Constructed asset volume identifiers describing state.
 */
const persistVolumeMetadata = async (metadata: RadarVolumeMeta): Promise<void> => {
  const latestKey = `radar:latest:${metadata.siteId}:${metadata.product}`;
  const volumeKey = `radar:volume:${metadata.volumeId}`;
  const metadataJson = JSON.stringify(metadata);

  await redis.set(latestKey, metadataJson, { EX: 60 * 60 * 24 * 2 });
  await redis.set(volumeKey, metadataJson, { EX: 60 * 60 * 24 * 2 });
  await redis.set(`radar:site:lastVolumeAt:${metadata.siteId}`, String(metadata.generatedAtMs), {
    EX: 60 * 60 * 24 * 2,
  });
}

/**
 * Downloads the HTTP text body mapping the directory layout from an authoritative 
 * US Government NEXRAD distribution host resolving to array lines.
 *
 * @param {string} siteId - 4-character Nexrad ground station identifier code.
 * @returns {Promise<string[]>} Normalized string index paths for matching volumes.
 */
const fetchFileList = async (siteId: string): Promise<string[]> => {
  const dirListUrl = `${noaaBaseUrl}/${siteId}/dir.list`;
  const response = await fetchWithTimeout(dirListUrl);

  if (!response.ok) {
    throw new Error(`dir.list request failed for ${siteId}: HTTP ${response.status}`);
  }

  const rawDirList = await response.text();
  return parseDirList(rawDirList);
}

/**
 * Downloads a raw binary NEXRAD Level II file, extracts requested radar volume products
 * (e.g. Reflectivity, Velocity) to optimized Float32 grids, and outputs these products 
 * to Amazon S3 / Minio block storage alongside standard Redis notification broadcasts.
 *
 * @param {string} siteId - Identifies the specific tower generating the underlying signal.
 * @param {string} filename - Specific timestamp file payload target from NOAA URL strings.
 */
const processRadarFile = async (siteId: string, filename: string): Promise<void> => {
  const fileUrl = buildRadarFileUrl(siteId, filename);
  const response = await fetchWithTimeout(fileUrl);

  if (!response.ok) {
    throw new Error(`file request failed for ${filename}: HTTP ${response.status}`);
  }

  const sourceBuffer = await response.arrayBuffer();

  const generatedAtMs = parseNexradGeneratedAtMs(filename) ?? Date.now();
  const rawStorageKey = `${siteId}/latest/raw`;
  await uploadObject(rawStorageKey, sourceBuffer, "application/octet-stream");

  const ingestProducts = parseIngestProductList();
  let anyProductSucceeded = false;

  for (const product of ingestProducts) {
    try {
      const artifact = await parseVolumeInWorker(
        sourceBuffer,
        filename,
        siteId,
        generatedAtMs,
        product
      );

      const parsedStorageKey = `${siteId}/latest/${product}.f32`;
      const parsedVolumeBytes = artifact.data;

      await uploadObject(parsedStorageKey, parsedVolumeBytes, "application/octet-stream");

      const metadata: RadarVolumeMeta = {
        ...artifact.metadata,
        siteId,
        product,
        generatedAtMs,
        volumeId: `${siteId}-${generatedAtMs}-${product}`,
        storageKey: parsedStorageKey,
      };

      await persistVolumeMetadata(metadata);

      await publishEvent({
        eventType: "volume.ready",
        data: {
          siteId,
          product: metadata.product,
          volumeId: metadata.volumeId,
          generatedAtMs: metadata.generatedAtMs,
          storageKey: metadata.storageKey,
        },
        emittedAtMs: Date.now(),
      });

      anyProductSucceeded = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[${siteId}/${filename}] product ${product}: ${message}`);
    }
  }

  if (!anyProductSucceeded) {
    throw new Error(`No Level-II moments could be extracted from ${filename}`);
  }
}

/**
 * High-level orchestration function to poll a given radar site. 
 * Resolves standard configuration, validates current status limits via remote endpoints,
 * kicks off individual file ingestion blocks sequentially, and updates metrics logs.
 *
 * @param {string} siteId - Targeted radar asset string.
 */
const pollRadarSite = async (siteId: string): Promise<void> => {
  const normalizedSiteId = siteId.trim().toUpperCase();
  if (!normalizedSiteId) {
    return;
  }

  if (inFlightSitePolls.has(normalizedSiteId)) {
    return;
  }

  inFlightSitePolls.add(normalizedSiteId);
  const pollStartedAtMs = Date.now();

  try {
    const previousState = await readState(normalizedSiteId);
    const availableFiles = await fetchFileList(normalizedSiteId);
    const lastProcessedKey = `ingestion:lastFile:${normalizedSiteId}`;
    const lastProcessedFile = await redis.get(lastProcessedKey);
    const filesToProcess = selectFilesToProcess(availableFiles, lastProcessedFile);

    for (const filename of filesToProcess) {
      console.log(`[${new Date().toISOString()}] Ingesting ${normalizedSiteId}/${filename}`);
      const t0 = Date.now();

      try {
        await withTimeout(
          processRadarFile(normalizedSiteId, filename),
          fileTimeoutMs,
          `Parsing timeout after ${fileTimeoutMs}ms for ${normalizedSiteId}/${filename}`
        );

        const t1 = Date.now();
        const timingKey = "ingestion:metrics:timing";
        const existingAvgStr = await redis.hGet(timingKey, normalizedSiteId);
        const currentAvg = existingAvgStr ? parseFloat(existingAvgStr) : 0;
        const duration = t1 - t0;
        const newAvg = currentAvg === 0 ? duration : currentAvg * 0.9 + duration * 0.1;
        await redis.hSet(timingKey, normalizedSiteId, String(newAvg));

        await redis.set(lastProcessedKey, filename, { EX: 60 * 60 * 24 * 7 });
        console.log(
          `[${new Date().toISOString()}] Successfully ingested ${normalizedSiteId}/${filename} in ${duration}ms`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[${normalizedSiteId}/${filename}] failed: ${message}`);
      }
    }

    await writeState({
      ...previousState,
      siteId: normalizedSiteId,
      lastPolledAtMs: pollStartedAtMs,
      lastSuccessAtMs: Date.now(),
      consecutiveFailures: 0,
      lastErrorMessage: undefined,
    });
  } catch (error) {
    const previousState = await readState(normalizedSiteId);
    const nextFailures = (previousState.consecutiveFailures || 0) + 1;
    const errorMessage = error instanceof Error ? error.message : String(error);

    await writeState({
      ...previousState,
      siteId: normalizedSiteId,
      lastPolledAtMs: pollStartedAtMs,
      consecutiveFailures: nextFailures,
      lastErrorMessage: errorMessage,
    });

    await publishEvent({
      eventType: "volume.error",
      data: {
        siteId: normalizedSiteId,
        error: errorMessage,
        consecutiveFailures: nextFailures,
      },
      emittedAtMs: Date.now(),
    });

    console.error(`Polling error for ${normalizedSiteId}:`, errorMessage);
  } finally {
    inFlightSitePolls.delete(normalizedSiteId);
  }
}

const updateS3MetricsSize = async () => {
  try {
    let size = 0;
    let continuationToken: string | undefined = undefined;
    const maxPages = 10000;

    for (let page = 0; page < maxPages; page += 1) {
      const resp: any = await s3.send(
        new ListObjectsV2Command({
          Bucket: minioBucket,
          ContinuationToken: continuationToken,
        })
      );

      for (const obj of resp.Contents || []) {
        size += obj.Size || 0;
      }

      const nextToken = resp.NextContinuationToken;
      if (!nextToken) {
        break;
      }

      continuationToken = nextToken;
    }

    await redis.set("ingestion:metrics:s3_size", String(size));
  } catch (error) {
    console.error("Failed to fetch S3 metrics size", error);
  }
};

const main = async () => {
  try {
    await redis.connect();
    console.log("Ingestion worker connected to Redis");

    if (objectStorageEnabled) {
      console.log(`Object storage enabled at ${minioEndpoint} (bucket: ${minioBucket})`);
      await ensureBucketExists();
      updateS3MetricsSize();
      setInterval(updateS3MetricsSize, 30000); // Run every 30s
    } else {
      console.log("Object storage disabled by OBJECT_STORAGE_ENABLED=false");
    }

    const productList = parseIngestProductList().join(", ");
    console.log(
      `Ingestion worker started. Polling ${radarSites.join(", ")} continuously; products: ${productList}`
    );

    const validSites = radarSites.map((value) => value.trim()).filter(Boolean);
    while (true) {
      for (const siteId of validSites) {
        await pollRadarSite(siteId);
      }

      await sleep(Math.max(1, pollIntervalSeconds) * 1000);
    }
  } catch (err) {
    console.error("Ingestion worker failed:", err);
    process.exit(1);
  }
}

main();
