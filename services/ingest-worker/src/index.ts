import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  LEVEL2_DECODABLE_VOLUME_PRODUCTS,
  VolumeProduct,
  parseVolumeProduct,
  type IngestionState,
  type RadarVolumeMeta,
  type StreamEventPayload,
} from "@nexrad-3d/contracts";
import { getReaderForFile, parseNexradGeneratedAtMs } from "@nexrad-3d/radar-parser";
import { createClient } from "redis";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const noaaBaseUrl =
  process.env.NOAA_BASE_URL ||
  "https://nomads.ncep.noaa.gov/pub/data/nccf/radar/nexrad_level2";
const radarSites = (process.env.RADAR_SITES || "KMKX").split(",");
const pollIntervalSeconds = parseInt(
  process.env.POLL_INTERVAL_SECONDS || "30",
  10
);
const maxFilesPerPoll = parseInt(process.env.INGEST_MAX_FILES_PER_POLL || "3", 10);
const timelineLimit = parseInt(process.env.TIMELINE_LIMIT || "240", 10);

function parseIngestProductList(): VolumeProduct[] {
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
  credentials: {
    accessKeyId: minioAccessKey,
    secretAccessKey: minioSecretKey,
  },
});

const inFlightSitePolls = new Set<string>();

function parseDirList(rawDirList: string): string[] {
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

function buildRadarFileUrl(siteId: string, filename: string): string {
  return `${noaaBaseUrl}/${siteId}/${filename}`;
}

function selectFilesToProcess(
  allFiles: string[],
  lastProcessedFile: string | null
): string[] {
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

function getSiteStateKey(siteId: string): string {
  return `ingestion:state:${siteId}`;
}

async function readState(siteId: string): Promise<IngestionState> {
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

async function writeState(state: IngestionState): Promise<void> {
  await redis.set(getSiteStateKey(state.siteId), JSON.stringify(state), {
    EX: 60 * 60 * 24,
  });
}

async function publishEvent(event: StreamEventPayload): Promise<void> {
  await redis.publish("radar:events", JSON.stringify(event));
}

function toNodeBuffer(bytes: ArrayBuffer | Uint8Array): Buffer {
  if (bytes instanceof ArrayBuffer) {
    return Buffer.from(bytes);
  }

  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

async function uploadObject(
  storageKey: string,
  payload: ArrayBuffer | Uint8Array,
  contentType: string
): Promise<void> {
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

async function ensureBucketExists(): Promise<void> {
  if (!objectStorageEnabled) {
    return;
  }

  try {
    await s3.send(new HeadBucketCommand({ Bucket: minioBucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: minioBucket }));
  }
}

async function persistVolumeMetadata(metadata: RadarVolumeMeta): Promise<void> {
  const latestKey = `radar:latest:${metadata.siteId}:${metadata.product}`;
  const volumeKey = `radar:volume:${metadata.volumeId}`;
  const timelineKey = `radar:timeline:${metadata.siteId}:${metadata.product}`;
  const metadataJson = JSON.stringify(metadata);

  await redis.set(latestKey, metadataJson, { EX: 60 * 60 * 24 * 2 });
  await redis.set(volumeKey, metadataJson, { EX: 60 * 60 * 24 * 2 });
  await redis.set(`radar:site:lastVolumeAt:${metadata.siteId}`, String(metadata.generatedAtMs), {
    EX: 60 * 60 * 24 * 2,
  });

  await redis.zAdd(timelineKey, [
    {
      score: metadata.generatedAtMs,
      value: metadata.volumeId,
    },
  ]);

  const entryCount = await redis.zCard(timelineKey);
  if (entryCount > timelineLimit) {
    await redis.zRemRangeByRank(timelineKey, 0, entryCount - timelineLimit - 1);
  }
}

async function fetchFileList(siteId: string): Promise<string[]> {
  const dirListUrl = `${noaaBaseUrl}/${siteId}/dir.list`;
  const response = await fetch(dirListUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`dir.list request failed for ${siteId}: HTTP ${response.status}`);
  }

  const rawDirList = await response.text();
  return parseDirList(rawDirList);
}

async function processRadarFile(siteId: string, filename: string): Promise<void> {
  const fileUrl = buildRadarFileUrl(siteId, filename);
  const response = await fetch(fileUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`file request failed for ${filename}: HTTP ${response.status}`);
  }

  const sourceBuffer = await response.arrayBuffer();
  const parser = getReaderForFile(filename, sourceBuffer);
  if (!parser) {
    throw new Error(`unsupported radar file format: ${filename}`);
  }

  const generatedAtMs = parseNexradGeneratedAtMs(filename) ?? Date.now();
  const rawStorageKey = `${siteId}/${generatedAtMs}/${filename}`;
  await uploadObject(rawStorageKey, sourceBuffer, "application/octet-stream");

  const ingestProducts = parseIngestProductList();
  let anyProductSucceeded = false;

  for (const product of ingestProducts) {
    try {
      const artifact = await parser.loadVolume(sourceBuffer, product, {
        filename,
        siteId,
        generatedAtMs,
      });

      const parsedStorageKey = `${siteId}/${generatedAtMs}/${product}.f32`;
      const parsedVolumeBytes = new Uint8Array(
        artifact.data.buffer,
        artifact.data.byteOffset,
        artifact.data.byteLength
      );

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

async function pollRadarSite(siteId: string): Promise<void> {
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
      console.log(`Ingesting ${normalizedSiteId}/${filename}`);
      await processRadarFile(normalizedSiteId, filename);
      await redis.set(lastProcessedKey, filename, { EX: 60 * 60 * 24 * 7 });
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

async function main() {
  try {
    await redis.connect();
    console.log("Ingestion worker connected to Redis");

    if (objectStorageEnabled) {
      console.log(`Object storage enabled at ${minioEndpoint} (bucket: ${minioBucket})`);
      await ensureBucketExists();
    } else {
      console.log("Object storage disabled by OBJECT_STORAGE_ENABLED=false");
    }

    // Poll each site on interval
    for (const siteId of radarSites.map((value) => value.trim()).filter(Boolean)) {
      setInterval(() => {
        void pollRadarSite(siteId);
      }, pollIntervalSeconds * 1000);

      // Poll immediately on startup
      await pollRadarSite(siteId);
    }

    const productList = parseIngestProductList().join(", ");
    console.log(
      `Ingestion worker started. Polling ${radarSites.join(", ")} every ${pollIntervalSeconds}s; products: ${productList}`
    );
  } catch (err) {
    console.error("Ingestion worker failed:", err);
    process.exit(1);
  }
}

main();
