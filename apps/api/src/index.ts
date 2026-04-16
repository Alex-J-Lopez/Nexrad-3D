import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import cors from "cors";
import express from "express";
import { createClient } from "redis";
import type {
  GetLatestVolumesBatchResponse,
  GetSitesResponse,
  GetLatestVolumeResponse,
  GetTimelineResponse,
  GetVolumeProductsResponse,
  RadarSite,
  RadarVolumeMeta,
  StreamEventPayload,
  TimelineFrame,
  VolumeProduct,
} from "@nexrad-3d/contracts";
import {
  parseVolumeProduct,
  VOLUME_PRODUCT_DEFINITIONS,
} from "@nexrad-3d/contracts";

const app = express();
const port = Number(process.env.API_PORT || 4000);
const host = process.env.API_HOST || "0.0.0.0";
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const pollIntervalSeconds = Number.parseInt(process.env.POLL_INTERVAL_SECONDS || "30", 10);
const objectStorageEnabled =
  (process.env.OBJECT_STORAGE_ENABLED || "true").toLowerCase() === "true";
const minioEndpoint = process.env.MINIO_ENDPOINT || "http://localhost:9000";
const minioAccessKey = process.env.MINIO_ACCESS_KEY || "minioadmin";
const minioSecretKey = process.env.MINIO_SECRET_KEY || "minioadmin";
const minioBucket = process.env.MINIO_BUCKET || "radar-data";
const redisCommandTimeoutMs = Number.parseInt(
  process.env.REDIS_COMMAND_TIMEOUT_MS || "3000",
  10
);
const configuredSites = (process.env.RADAR_SITES || "KMKX")
  .split(",")
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean);

const knownSites: Record<
  string,
  { name: string; latitude: number; longitude: number; elevationMeters: number }
> = {
  KMKX: {
    name: "Milwaukee, WI",
    latitude: 42.9681,
    longitude: -87.9275,
    elevationMeters: 203,
  },
  KTLX: {
    name: "Oklahoma City, OK",
    latitude: 35.3331,
    longitude: -97.2775,
    elevationMeters: 372,
  },
  KLOT: {
    name: "Chicago, IL",
    latitude: 41.6044,
    longitude: -88.0844,
    elevationMeters: 218,
  },
};

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

async function streamBodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) {
    return Buffer.alloc(0);
  }

  const transformableBody = body as {
    transformToByteArray?: () => Promise<Uint8Array>;
  };

  if (typeof transformableBody.transformToByteArray === "function") {
    const bytes = await transformableBody.transformToByteArray();
    return Buffer.from(bytes);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("timed out");
}

function parseProductQuery(input?: string): VolumeProduct | null {
  return input ? parseVolumeProduct(input) : null;
}

/** Pass metadata through without inventing decodeMode (avoids false "bootstrap" warnings). */
function normalizeVolumeMeta(meta: RadarVolumeMeta): RadarVolumeMeta {
  return meta;
}

function buildSite(siteId: string, lastVolumeAtMs: number | undefined): RadarSite {
  const fallback = {
    name: `Radar ${siteId}`,
    latitude: 0,
    longitude: 0,
    elevationMeters: 0,
  };

  const siteInfo = knownSites[siteId] || fallback;
  const staleThresholdMs = pollIntervalSeconds * 3 * 1000;
  const isOnline =
    typeof lastVolumeAtMs === "number" && Date.now() - lastVolumeAtMs <= staleThresholdMs;

  return {
    id: siteId,
    name: siteInfo.name,
    latitude: siteInfo.latitude,
    longitude: siteInfo.longitude,
    elevationMeters: siteInfo.elevationMeters,
    status: isOnline ? "online" : "unknown",
    lastVolumeAt: lastVolumeAtMs,
  };
}

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
  })
);

app.use(express.json());

// ============================================
// API Routes
// ============================================

/**
 * GET /v1/products
 * Catalog of radar volume products (codes, labels, ingest support).
 */
app.get("/v1/products", (_req, res) => {
  const response: GetVolumeProductsResponse = {
    definitions: VOLUME_PRODUCT_DEFINITIONS,
  };
  res.json(response);
});

/**
 * GET /v1/sites
 * Return list of available radar sites
 */
app.get("/v1/sites", async (req, res) => {
  try {
    const keys = configuredSites.map((siteId) => `radar:site:lastVolumeAt:${siteId}`);
    const latestValues =
      keys.length > 0
        ? await withTimeout(
            redis.mGet(keys),
            redisCommandTimeoutMs,
            "Redis site lookup"
          )
        : [];

    const sites = configuredSites.map((siteId, index) => {
      const parsedTimestamp = Number.parseInt(latestValues[index] || "", 10);
      const lastVolumeAtMs = Number.isNaN(parsedTimestamp) ? undefined : parsedTimestamp;
      return buildSite(siteId, lastVolumeAtMs);
    });

    const response: GetSitesResponse = {
      sites,
    };

    res.json(response);
  } catch (err) {
    if (isTimeoutError(err)) {
      res.status(503).json({ error: "Timed out while loading sites" });
      return;
    }

    res.status(500).json({ error: String(err) });
  }
});

/**
 * GET /v1/volumes/latest?siteId=KMKX&product=REF
 * Return metadata for the latest radar volume, or `{ volume: null }` if none is indexed yet.
 */
app.get("/v1/volumes/latest", async (req, res) => {
  try {
    const { siteId, product } = req.query as {
      siteId?: string;
      product?: string;
    };

    if (!siteId || !product) {
      res.status(400).json({ error: "Missing siteId or product" });
      return;
    }

    const normalizedSiteId = siteId.trim().toUpperCase();
    const normalizedProduct = parseProductQuery(product);
    if (!normalizedProduct) {
      res.status(400).json({ error: "Invalid product" });
      return;
    }

    const latestKey = `radar:latest:${normalizedSiteId}:${normalizedProduct}`;
    const metadataJson = await withTimeout(
      redis.get(latestKey),
      redisCommandTimeoutMs,
      "Redis latest volume lookup"
    );

    const response: GetLatestVolumeResponse =
      metadataJson && typeof metadataJson === "string"
        ? {
            volume: normalizeVolumeMeta(JSON.parse(metadataJson) as RadarVolumeMeta),
          }
        : { volume: null };

    res.json(response);
  } catch (err) {
    if (isTimeoutError(err)) {
      res.status(503).json({ error: "Timed out while loading latest volume" });
      return;
    }

    res.status(500).json({ error: String(err) });
  }
});

/**
 * GET /v1/volumes/latest/batch?siteId=KMKX&products=REF,VEL,SW
 * Latest volume metadata for several products in one request.
 */
app.get("/v1/volumes/latest/batch", async (req, res) => {
  try {
    const { siteId, products } = req.query as {
      siteId?: string;
      products?: string;
    };

    if (!siteId || !products) {
      res.status(400).json({ error: "Missing siteId or products" });
      return;
    }

    const normalizedSiteId = siteId.trim().toUpperCase();
    const tokens = products
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    if (tokens.length === 0) {
      res.status(400).json({ error: "products must list at least one code" });
      return;
    }

    if (tokens.length > 32) {
      res.status(400).json({ error: "Too many products (max 32)" });
      return;
    }

    const parsedProducts: VolumeProduct[] = [];
    for (const token of tokens) {
      const p = parseVolumeProduct(token);
      if (!p) {
        res.status(400).json({ error: `Invalid product: ${token}` });
        return;
      }
      parsedProducts.push(p);
    }

    const keys = parsedProducts.map((p) => `radar:latest:${normalizedSiteId}:${p}`);
    const metadataJsonList =
      keys.length > 0
        ? await withTimeout(
            redis.mGet(keys),
            redisCommandTimeoutMs,
            "Redis latest volume batch lookup"
          )
        : [];

    const items = parsedProducts.map((product, index) => {
      const metadataJson = metadataJsonList[index];
      if (!metadataJson || typeof metadataJson !== "string") {
        return { product, volume: null };
      }
      return {
        product,
        volume: normalizeVolumeMeta(JSON.parse(metadataJson) as RadarVolumeMeta),
      };
    });

    const response: GetLatestVolumesBatchResponse = {
      siteId: normalizedSiteId,
      items,
    };

    res.json(response);
  } catch (err) {
    if (isTimeoutError(err)) {
      res.status(503).json({ error: "Timed out while loading latest volumes" });
      return;
    }

    res.status(500).json({ error: String(err) });
  }
});

/**
 * GET /v1/volumes/:volumeId
 * Return metadata for a specific radar volume id
 */
app.get("/v1/volumes/:volumeId", async (req, res) => {
  try {
    const volumeId = (req.params.volumeId || "").trim();
    if (!volumeId) {
      res.status(400).json({ error: "Missing volumeId" });
      return;
    }

    const volumeKey = `radar:volume:${volumeId}`;
    const metadataJson = await withTimeout(
      redis.get(volumeKey),
      redisCommandTimeoutMs,
      "Redis volume lookup"
    );
    if (!metadataJson) {
      res.status(404).json({ error: "Volume not found" });
      return;
    }

    const response: GetLatestVolumeResponse = {
      volume: normalizeVolumeMeta(JSON.parse(metadataJson) as RadarVolumeMeta),
    };

    res.json(response);
  } catch (err) {
    if (isTimeoutError(err)) {
      res.status(503).json({ error: "Timed out while loading volume" });
      return;
    }

    res.status(500).json({ error: String(err) });
  }
});

/**
 * GET /v1/timeline?siteId=KMKX&product=REF&limit=120
 * Return ordered timeline of available volumes
 */
app.get("/v1/timeline", async (req, res) => {
  try {
    const { siteId, product, limit } = req.query as {
      siteId?: string;
      product?: string;
      limit?: string;
    };

    if (!siteId || !product) {
      res.status(400).json({ error: "Missing siteId or product" });
      return;
    }

    const normalizedSiteId = siteId.trim().toUpperCase();
    const normalizedProduct = parseProductQuery(product);
    if (!normalizedProduct) {
      res.status(400).json({ error: "Invalid product" });
      return;
    }

    const parsedLimit = Number.parseInt(limit || "120", 10);
    const timelineLimit = Number.isNaN(parsedLimit)
      ? 120
      : Math.min(Math.max(parsedLimit, 1), 500);

    const timelineKey = `radar:timeline:${normalizedSiteId}:${normalizedProduct}`;
    const volumeIds = await withTimeout(
      redis.zRange(timelineKey, 0, timelineLimit - 1, { REV: true }),
      redisCommandTimeoutMs,
      "Redis timeline lookup"
    );
    if (volumeIds.length === 0) {
      const empty: GetTimelineResponse = {
        siteId: normalizedSiteId,
        product: normalizedProduct,
        frames: [],
        oldestMs: 0,
        newestMs: 0,
      };

      res.json(empty);
      return;
    }

    const volumeKeys = volumeIds.map((volumeId) => `radar:volume:${volumeId}`);
    const metadataValues = await withTimeout(
      redis.mGet(volumeKeys),
      redisCommandTimeoutMs,
      "Redis timeline metadata lookup"
    );
    const metas = metadataValues
      .filter((value): value is string => typeof value === "string")
      .map((value) => normalizeVolumeMeta(JSON.parse(value) as RadarVolumeMeta));

    const frames: TimelineFrame[] = metas.map((meta) => ({
      volumeId: meta.volumeId,
      product: meta.product,
      generatedAtMs: meta.generatedAtMs,
      available: true,
      storageKey: meta.storageKey,
    }));

    const response: GetTimelineResponse = {
      siteId: normalizedSiteId,
      product: normalizedProduct,
      frames,
      oldestMs: frames.length > 0 ? frames[frames.length - 1].generatedAtMs : 0,
      newestMs: frames.length > 0 ? frames[0].generatedAtMs : 0,
    };

    res.json(response);
  } catch (err) {
    if (isTimeoutError(err)) {
      res.status(503).json({ error: "Timed out while loading timeline" });
      return;
    }

    res.status(500).json({ error: String(err) });
  }
});

/**
 * GET /v1/data/:storageKey(*)
 * Streams raw artifact bytes from object storage.
 */
app.get("/v1/data/:storageKey(*)", async (req, res) => {
  if (!objectStorageEnabled) {
    res.status(503).json({ error: "Object storage disabled" });
    return;
  }

  try {
    const encodedStorageKey = req.params.storageKey;
    if (!encodedStorageKey) {
      res.status(400).json({ error: "Missing storage key" });
      return;
    }

    const storageKey = decodeURIComponent(encodedStorageKey);
    const object = await s3.send(
      new GetObjectCommand({
        Bucket: minioBucket,
        Key: storageKey,
      })
    );

    if (!object.Body) {
      res.status(404).json({ error: "Artifact not found" });
      return;
    }

    const payload = await streamBodyToBuffer(object.Body);

    res.setHeader("Content-Type", object.ContentType || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=120");
    if (object.ContentLength) {
      res.setHeader("Content-Length", String(object.ContentLength));
    }
    if (object.ETag) {
      res.setHeader("ETag", object.ETag);
    }

    res.send(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("NoSuchKey") || message.includes("NotFound")) {
      res.status(404).json({ error: "Artifact not found" });
      return;
    }

    res.status(500).json({ error: message });
  }
});

/**
 * GET /v1/stream/events
 * Server-Sent Events channel for volume readiness notifications
 */
app.get("/v1/stream/events", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Emit a first chunk immediately so clients know the stream is open.
  res.write(": connected\n\n");

  const subscriber = redis.duplicate();
  await subscriber.connect();

  const heartbeatId = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 20000);

  await subscriber.subscribe("radar:events", (message) => {
    try {
      const event = JSON.parse(message) as StreamEventPayload;
      res.write(`event: ${event.eventType}\n`);
      res.write(`data: ${JSON.stringify(event.data)}\n\n`);
    } catch (parseError) {
      res.write("event: volume.error\n");
      res.write(
        `data: ${JSON.stringify({
          reason: "Invalid event payload",
          details: String(parseError),
        })}\n\n`
      );
    }
  });

  req.on("close", () => {
    clearInterval(heartbeatId);
    void subscriber.unsubscribe("radar:events").catch(() => undefined);
    void subscriber.quit().catch(() => undefined);
  });
});

// ============================================
// Health Check
// ============================================

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ============================================
// Server Startup
// ============================================

async function start() {
  try {
    await redis.connect();
    console.log("Connected to Redis");

    app.listen(port, host, () => {
      console.log(`API listening on ${host}:${port}`);
    });
  } catch (err) {
    console.error("Failed to start API:", err);
    process.exit(1);
  }
}

start();
