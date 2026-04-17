# Next.js Migration + Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Vite SPA + Express API with a consolidated Next.js App Router app, rebuild the rendering pipeline with Web Workers and pre-allocated typed arrays, and containerize for Docker deployment.

**Architecture:** Single Next.js app with Route Handlers (replaces Express), RSC page shell, `'use client'` WebGL viewers, Web Workers for geometry construction. Ingest worker and shared packages unchanged.

**Tech Stack:** Next.js 15, React 19, Cesium, Three.js, ioredis, @aws-sdk/client-s3, Vitest, Docker

**Spec:** [2026-04-15-nextjs-migration-design.md](../specs/2026-04-15-nextjs-migration-design.md)

---

## File Structure

### Files to Create

- `apps/nexrad/package.json`
- `apps/nexrad/tsconfig.json`
- `apps/nexrad/next.config.ts`
- `apps/nexrad/next-env.d.ts`
- `apps/nexrad/Dockerfile`
- `apps/nexrad/app/layout.tsx`
- `apps/nexrad/app/page.tsx`
- `apps/nexrad/app/api/health/route.ts`
- `apps/nexrad/app/api/sites/route.ts`
- `apps/nexrad/app/api/products/route.ts`
- `apps/nexrad/app/api/volumes/latest/route.ts`
- `apps/nexrad/app/api/volumes/latest/batch/route.ts`
- `apps/nexrad/app/api/volumes/[volumeId]/route.ts`
- `apps/nexrad/app/api/volumes/timeline/route.ts`
- `apps/nexrad/app/api/data/[...key]/route.ts`
- `apps/nexrad/app/api/events/route.ts`
- `apps/nexrad/lib/env.ts`
- `apps/nexrad/lib/redis.ts`
- `apps/nexrad/lib/storage.ts`
- `apps/nexrad/lib/__tests__/redis.test.ts`
- `apps/nexrad/renderers/shared/radarGeometry.ts`
- `apps/nexrad/renderers/shared/volumeLoader.ts`
- `apps/nexrad/renderers/shared/volumeSweepSubset.ts`
- `apps/nexrad/renderers/globe/globeRadarMath.ts`
- `apps/nexrad/renderers/globe/globeRadarMesh.ts`
- `apps/nexrad/renderers/globe/globeRadarRenderStrategy.ts`
- `apps/nexrad/renderers/globe/GlobeRadarLayer.ts`
- `apps/nexrad/renderers/local/pointCloudArrays.ts`
- `apps/nexrad/renderers/local/PointCloudRenderer.ts`
- `apps/nexrad/renderers/local/__tests__/pointCloudArrays.test.ts`
- `apps/nexrad/renderers/globe/__tests__/globeRadarMesh.test.ts`
- `apps/nexrad/renderers/globe/__tests__/globeRadarMath.test.ts`
- `apps/nexrad/workers/meshWorker.ts`
- `apps/nexrad/workers/pointCloudWorker.ts`
- `apps/nexrad/hooks/useWorker.ts`
- `apps/nexrad/hooks/useRadarData.ts`
- `apps/nexrad/components/RadarViewer.tsx`
- `apps/nexrad/components/GlobeView.tsx`
- `apps/nexrad/components/LocalView.tsx`
- `apps/nexrad/components/ControlPanel.tsx`
- `apps/nexrad/components/StatusStrip.tsx`
- `apps/nexrad/styles/globals.css`

### Files to Delete (after migration verified)

- `apps/web/` (entire directory)
- `apps/api/` (entire directory)

### Files to Modify

- `package.json` (root: update workspace scripts)
- `infra/docker/docker-compose.yml` (add nexrad service)

---

### Task 1: Scaffold Next.js App

**Files:**

- Create: `apps/nexrad/package.json`
- Create: `apps/nexrad/tsconfig.json`
- Create: `apps/nexrad/next.config.ts`
- Create: `apps/nexrad/next-env.d.ts`
- **Step 1: Create package.json**

```json
{
  "name": "@nexrad-3d/nexrad",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.1030.0",
    "@nexrad-3d/contracts": "*",
    "cesium": "^1.140.0",
    "ioredis": "^5.4.1",
    "next": "^15.3.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "three": "^0.160.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@types/three": "^0.160.0",
    "copy-webpack-plugin": "^12.0.2",
    "typescript": "^5.7.2",
    "vitest": "^2.0.0"
  }
}
```

- **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- **Step 3: Create next.config.ts**

This is the trickiest part. Cesium needs its static assets (Workers, Assets, Widgets, ThirdParty) served alongside the app. We use `CopyWebpackPlugin` to copy them into the build output.

```typescript
import type { NextConfig } from "next";
import CopyWebpackPlugin from "copy-webpack-plugin";
import path from "node:path";

const cesiumSource = path.resolve(
  __dirname,
  "node_modules/cesium/Build/Cesium"
);

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
  env: {
    NEXT_PUBLIC_CESIUM_BASE_URL: "/_next/static/cesium",
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.plugins.push(
        new CopyWebpackPlugin({
          patterns: [
            { from: path.join(cesiumSource, "Workers"), to: "../static/cesium/Workers" },
            { from: path.join(cesiumSource, "Assets"), to: "../static/cesium/Assets" },
            { from: path.join(cesiumSource, "Widgets"), to: "../static/cesium/Widgets" },
            { from: path.join(cesiumSource, "ThirdParty"), to: "../static/cesium/ThirdParty" },
          ],
        })
      );

      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        http: false,
        https: false,
        url: false,
      };
    }

    return config;
  },
};

export default nextConfig;
```

- **Step 4: Create next-env.d.ts**

```typescript
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

- **Step 5: Install dependencies**

Run: `npm install` from the monorepo root.

Expected: `apps/nexrad/node_modules` populated with all dependencies, no peer dependency errors.

- **Step 6: Verify Next.js boots**

Create a minimal `apps/nexrad/app/layout.tsx`:

```typescript
export const metadata = { title: "Nexrad 3D" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Create a minimal `apps/nexrad/app/page.tsx`:

```typescript
export default function Home() {
  return <h1>Nexrad 3D</h1>;
}
```

Run: `cd apps/nexrad && npx next dev --turbopack`

Expected: Dev server starts on port 3000, page renders "Nexrad 3D".

- **Step 7: Commit**

```bash
git add apps/nexrad/package.json apps/nexrad/tsconfig.json apps/nexrad/next.config.ts apps/nexrad/next-env.d.ts apps/nexrad/app/layout.tsx apps/nexrad/app/page.tsx
git commit -m "feat(nexrad): scaffold Next.js app with Cesium asset config"
```

---

### Task 2: Server-Side Infrastructure

**Files:**

- Create: `apps/nexrad/lib/env.ts`
- Create: `apps/nexrad/lib/redis.ts`
- Create: `apps/nexrad/lib/storage.ts`
- **Step 1: Create env.ts**

```typescript
function env(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export const REDIS_URL = env("REDIS_URL", "redis://localhost:6379");
export const REDIS_COMMAND_TIMEOUT_MS = envInt("REDIS_COMMAND_TIMEOUT_MS", 3000);

export const S3_ENDPOINT = env("S3_ENDPOINT", "http://localhost:9000");
export const S3_ACCESS_KEY = env("S3_ACCESS_KEY", "minioadmin");
export const S3_SECRET_KEY = env("S3_SECRET_KEY", "minioadmin");
export const S3_BUCKET = env("S3_BUCKET", "radar-data");
export const S3_REGION = env("S3_REGION", "us-east-1");

export const POLL_INTERVAL_SECONDS = envInt("POLL_INTERVAL_SECONDS", 30);

export const RADAR_SITES = env("RADAR_SITES", "KMKX")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

export const KNOWN_SITES: Record<
  string,
  { name: string; latitude: number; longitude: number; elevationMeters: number }
> = {
  KMKX: { name: "Milwaukee, WI", latitude: 42.9681, longitude: -87.9275, elevationMeters: 203 },
  KTLX: { name: "Oklahoma City, OK", latitude: 35.3331, longitude: -97.2775, elevationMeters: 372 },
  KLOT: { name: "Chicago, IL", latitude: 41.6044, longitude: -88.0844, elevationMeters: 218 },
};
```

- **Step 2: Create redis.ts**

```typescript
import Redis from "ioredis";
import { REDIS_URL, REDIS_COMMAND_TIMEOUT_MS } from "./env";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
      lazyConnect: true,
    });
  }
  return redis;
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
```

- **Step 3: Create storage.ts**

```typescript
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION, S3_BUCKET } from "./env";

let s3: S3Client | null = null;

export function getS3(): S3Client {
  if (!s3) {
    s3 = new S3Client({
      region: S3_REGION,
      endpoint: S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: S3_ACCESS_KEY,
        secretAccessKey: S3_SECRET_KEY,
      },
    });
  }
  return s3;
}

export { GetObjectCommand, S3_BUCKET };
```

- **Step 4: Commit**

```bash
git add apps/nexrad/lib/
git commit -m "feat(nexrad): add server-side Redis, S3, and env infrastructure"
```

---

### Task 3: Route Handlers - Core Endpoints

**Files:**

- Create: `apps/nexrad/app/api/health/route.ts`
- Create: `apps/nexrad/app/api/products/route.ts`
- Create: `apps/nexrad/app/api/sites/route.ts`
- Create: `apps/nexrad/app/api/volumes/latest/route.ts`
- Create: `apps/nexrad/app/api/volumes/latest/batch/route.ts`
- Create: `apps/nexrad/app/api/volumes/[volumeId]/route.ts`
- Create: `apps/nexrad/app/api/volumes/timeline/route.ts`
- **Step 1: Create health route**

```typescript
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ status: "ok" });
}
```

- **Step 2: Create products route**

```typescript
import { NextResponse } from "next/server";
import { VOLUME_PRODUCT_DEFINITIONS } from "@nexrad-3d/contracts";
import type { GetVolumeProductsResponse } from "@nexrad-3d/contracts";

export async function GET() {
  const response: GetVolumeProductsResponse = { definitions: VOLUME_PRODUCT_DEFINITIONS };
  return NextResponse.json(response);
}
```

- **Step 3: Create sites route**

```typescript
import { NextResponse } from "next/server";
import type { GetSitesResponse, RadarSite } from "@nexrad-3d/contracts";
import { getRedis, withTimeout } from "@/lib/redis";
import { RADAR_SITES, KNOWN_SITES, POLL_INTERVAL_SECONDS, REDIS_COMMAND_TIMEOUT_MS } from "@/lib/env";

function buildSite(siteId: string, lastVolumeAtMs: number | undefined): RadarSite {
  const fallback = { name: `Radar ${siteId}`, latitude: 0, longitude: 0, elevationMeters: 0 };
  const info = KNOWN_SITES[siteId] || fallback;
  const staleThresholdMs = POLL_INTERVAL_SECONDS * 3 * 1000;
  const isOnline = typeof lastVolumeAtMs === "number" && Date.now() - lastVolumeAtMs <= staleThresholdMs;

  return {
    id: siteId,
    name: info.name,
    latitude: info.latitude,
    longitude: info.longitude,
    elevationMeters: info.elevationMeters,
    status: isOnline ? "online" : "unknown",
    lastVolumeAt: lastVolumeAtMs,
  };
}

export async function GET() {
  try {
    const redis = getRedis();
    const keys = RADAR_SITES.map((id) => `radar:site:lastVolumeAt:${id}`);
    const values = keys.length > 0
      ? await withTimeout(redis.mget(...keys), REDIS_COMMAND_TIMEOUT_MS, "Redis site lookup")
      : [];

    const sites = RADAR_SITES.map((id, i) => {
      const parsed = Number.parseInt(values[i] || "", 10);
      return buildSite(id, Number.isNaN(parsed) ? undefined : parsed);
    });

    const response: GetSitesResponse = { sites };
    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("timed out") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
```

- **Step 4: Create volumes/latest route**

```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { GetLatestVolumeResponse, RadarVolumeMeta } from "@nexrad-3d/contracts";
import { parseVolumeProduct } from "@nexrad-3d/contracts";
import { getRedis, withTimeout } from "@/lib/redis";
import { REDIS_COMMAND_TIMEOUT_MS } from "@/lib/env";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const siteId = searchParams.get("siteId")?.trim().toUpperCase();
  const productRaw = searchParams.get("product");

  if (!siteId || !productRaw) {
    return NextResponse.json({ error: "Missing siteId or product" }, { status: 400 });
  }

  const product = parseVolumeProduct(productRaw);
  if (!product) {
    return NextResponse.json({ error: "Invalid product" }, { status: 400 });
  }

  try {
    const redis = getRedis();
    const json = await withTimeout(
      redis.get(`radar:latest:${siteId}:${product}`),
      REDIS_COMMAND_TIMEOUT_MS,
      "Redis latest volume lookup"
    );

    const response: GetLatestVolumeResponse = json
      ? { volume: JSON.parse(json) as RadarVolumeMeta }
      : { volume: null };

    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("timed out") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
```

- **Step 5: Create volumes/latest/batch route**

```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { GetLatestVolumesBatchResponse, RadarVolumeMeta, VolumeProduct } from "@nexrad-3d/contracts";
import { parseVolumeProduct } from "@nexrad-3d/contracts";
import { getRedis, withTimeout } from "@/lib/redis";
import { REDIS_COMMAND_TIMEOUT_MS } from "@/lib/env";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const siteId = searchParams.get("siteId")?.trim().toUpperCase();
  const productsRaw = searchParams.get("products");

  if (!siteId || !productsRaw) {
    return NextResponse.json({ error: "Missing siteId or products" }, { status: 400 });
  }

  const tokens = productsRaw.split(",").map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return NextResponse.json({ error: "products must list at least one code" }, { status: 400 });
  }
  if (tokens.length > 32) {
    return NextResponse.json({ error: "Too many products (max 32)" }, { status: 400 });
  }

  const products: VolumeProduct[] = [];
  for (const token of tokens) {
    const p = parseVolumeProduct(token);
    if (!p) {
      return NextResponse.json({ error: `Invalid product: ${token}` }, { status: 400 });
    }
    products.push(p);
  }

  try {
    const redis = getRedis();
    const keys = products.map((p) => `radar:latest:${siteId}:${p}`);
    const values = await withTimeout(
      redis.mget(...keys),
      REDIS_COMMAND_TIMEOUT_MS,
      "Redis latest volume batch lookup"
    );

    const items = products.map((product, i) => {
      const json = values[i];
      return {
        product,
        volume: json ? (JSON.parse(json) as RadarVolumeMeta) : null,
      };
    });

    const response: GetLatestVolumesBatchResponse = { siteId, items };
    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("timed out") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
```

- **Step 6: Create volumes/[volumeId] route**

```typescript
import { NextResponse } from "next/server";
import type { GetLatestVolumeResponse, RadarVolumeMeta } from "@nexrad-3d/contracts";
import { getRedis, withTimeout } from "@/lib/redis";
import { REDIS_COMMAND_TIMEOUT_MS } from "@/lib/env";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ volumeId: string }> }
) {
  const { volumeId } = await params;
  if (!volumeId?.trim()) {
    return NextResponse.json({ error: "Missing volumeId" }, { status: 400 });
  }

  try {
    const redis = getRedis();
    const json = await withTimeout(
      redis.get(`radar:volume:${volumeId.trim()}`),
      REDIS_COMMAND_TIMEOUT_MS,
      "Redis volume lookup"
    );

    if (!json) {
      return NextResponse.json({ error: "Volume not found" }, { status: 404 });
    }

    const response: GetLatestVolumeResponse = {
      volume: JSON.parse(json) as RadarVolumeMeta,
    };
    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("timed out") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
```

- **Step 7: Create volumes/timeline route**

```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { GetTimelineResponse, RadarVolumeMeta, TimelineFrame } from "@nexrad-3d/contracts";
import { parseVolumeProduct } from "@nexrad-3d/contracts";
import { getRedis, withTimeout } from "@/lib/redis";
import { REDIS_COMMAND_TIMEOUT_MS } from "@/lib/env";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const siteId = searchParams.get("siteId")?.trim().toUpperCase();
  const productRaw = searchParams.get("product");
  const limitRaw = searchParams.get("limit");

  if (!siteId || !productRaw) {
    return NextResponse.json({ error: "Missing siteId or product" }, { status: 400 });
  }

  const product = parseVolumeProduct(productRaw);
  if (!product) {
    return NextResponse.json({ error: "Invalid product" }, { status: 400 });
  }

  const parsedLimit = Number.parseInt(limitRaw || "120", 10);
  const limit = Number.isNaN(parsedLimit) ? 120 : Math.min(Math.max(parsedLimit, 1), 500);

  try {
    const redis = getRedis();
    const timelineKey = `radar:timeline:${siteId}:${product}`;
    const volumeIds = await withTimeout(
      redis.zrange(timelineKey, 0, limit - 1, "REV"),
      REDIS_COMMAND_TIMEOUT_MS,
      "Redis timeline lookup"
    );

    if (volumeIds.length === 0) {
      const empty: GetTimelineResponse = {
        siteId,
        product,
        frames: [],
        oldestMs: 0,
        newestMs: 0,
      };
      return NextResponse.json(empty);
    }

    const volumeKeys = volumeIds.map((id) => `radar:volume:${id}`);
    const metaValues = await withTimeout(
      redis.mget(...volumeKeys),
      REDIS_COMMAND_TIMEOUT_MS,
      "Redis timeline metadata lookup"
    );

    const metas = metaValues
      .filter((v): v is string => typeof v === "string")
      .map((v) => JSON.parse(v) as RadarVolumeMeta);

    const frames: TimelineFrame[] = metas.map((m) => ({
      volumeId: m.volumeId,
      product: m.product,
      generatedAtMs: m.generatedAtMs,
      available: true,
      storageKey: m.storageKey,
    }));

    const response: GetTimelineResponse = {
      siteId,
      product,
      frames,
      oldestMs: frames.length > 0 ? frames[frames.length - 1].generatedAtMs : 0,
      newestMs: frames.length > 0 ? frames[0].generatedAtMs : 0,
    };
    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("timed out") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
```

- **Step 8: Run dev server and verify routes**

Run: `cd apps/nexrad && npx next dev --turbopack`

Then in another terminal:

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/products
```

Expected: `{"status":"ok"}` and product definitions JSON.

- **Step 9: Commit**

```bash
git add apps/nexrad/app/api/
git commit -m "feat(nexrad): port all core API Route Handlers from Express"
```

---

### Task 4: Route Handlers - Binary Data + SSE

**Files:**

- Create: `apps/nexrad/app/api/data/[...key]/route.ts`
- Create: `apps/nexrad/app/api/events/route.ts`
- **Step 1: Create binary data streaming route**

```typescript
import { NextResponse } from "next/server";
import { getS3, GetObjectCommand, S3_BUCKET } from "@/lib/storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const { key } = await params;
  const storageKey = key.join("/");

  if (!storageKey) {
    return NextResponse.json({ error: "Missing storage key" }, { status: 400 });
  }

  try {
    const s3 = getS3();
    const object = await s3.send(
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: storageKey })
    );

    if (!object.Body) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }

    const webStream = object.Body.transformToWebStream();

    return new Response(webStream, {
      headers: {
        "Content-Type": object.ContentType || "application/octet-stream",
        "Cache-Control": "public, max-age=120",
        ...(object.ContentLength ? { "Content-Length": String(object.ContentLength) } : {}),
        ...(object.ETag ? { ETag: object.ETag } : {}),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("NoSuchKey") || message.includes("NotFound")) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- **Step 2: Create SSE events route**

```typescript
import Redis from "ioredis";
import { REDIS_URL } from "@/lib/env";
import type { StreamEventPayload } from "@nexrad-3d/contracts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const subscriber = new Redis(REDIS_URL);

      const cleanup = () => {
        clearInterval(heartbeat);
        subscriber.unsubscribe("radar:events").catch(() => {});
        subscriber.quit().catch(() => {});
      };

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          cleanup();
        }
      }, 20_000);

      controller.enqueue(encoder.encode(": connected\n\n"));

      subscriber.on("message", (_channel: string, message: string) => {
        try {
          const event = JSON.parse(message) as StreamEventPayload;
          controller.enqueue(
            encoder.encode(`event: ${event.eventType}\ndata: ${JSON.stringify(event.data)}\n\n`)
          );
        } catch {
          controller.enqueue(
            encoder.encode(
              `event: volume.error\ndata: ${JSON.stringify({ reason: "Invalid event payload" })}\n\n`
            )
          );
        }
      });

      await subscriber.subscribe("radar:events");

      request.signal.addEventListener("abort", () => {
        cleanup();
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

- **Step 3: Commit**

```bash
git add apps/nexrad/app/api/data/ apps/nexrad/app/api/events/
git commit -m "feat(nexrad): add binary data streaming and SSE Route Handlers"
```

---

### Task 5: Optimized Geometry Builders

**Files:**

- Create: `apps/nexrad/renderers/shared/radarGeometry.ts`
- Create: `apps/nexrad/renderers/local/pointCloudArrays.ts`
- Create: `apps/nexrad/renderers/local/__tests__/pointCloudArrays.test.ts`
- Create: `apps/nexrad/renderers/globe/globeRadarMath.ts`
- Create: `apps/nexrad/renderers/globe/globeRadarMesh.ts`
- Create: `apps/nexrad/renderers/globe/__tests__/globeRadarMath.test.ts`
- Create: `apps/nexrad/renderers/globe/__tests__/globeRadarMesh.test.ts`
- **Step 1: Write failing test for pointCloudArrays**

Port existing test from `apps/web/src/renderers/pointCloudArrays.test.ts`, but add assertions that the result uses pre-allocated arrays (no intermediate JS arrays).

Read the existing test file first:

Run: `cat apps/web/src/renderers/pointCloudArrays.test.ts`

Write the test in `apps/nexrad/renderers/local/__tests__/pointCloudArrays.test.ts`. The test should verify:

- Returns correct point count for known input
- Filters below threshold
- Returns Float32Array (not regular Array)
- Handles empty data
- Matches existing test expectations
- **Step 2: Run test to verify it fails**

Run: `cd apps/nexrad && npx vitest run renderers/local/__tests__/pointCloudArrays.test.ts`

Expected: FAIL - module not found.

- **Step 3: Create radarGeometry.ts (shared)**

Copy from `apps/web/src/renderers/radarGeometry.ts` unchanged — `projectBeamSample` and `nwsColor` are pure functions with no dependencies.

```typescript
const EFFECTIVE_EARTH_RADIUS_METERS = 6_371_000 * (4 / 3);

export function projectBeamSample(
  slantRangeMeters: number,
  elevationAngleDegrees: number
): { horizontalRangeMeters: number; heightMeters: number } {
  const range = Math.max(0, slantRangeMeters);
  const elevationRadians =
    Math.max(-2, Math.min(90, elevationAngleDegrees)) * (Math.PI / 180);

  const centerDistance = Math.sqrt(
    range * range +
      EFFECTIVE_EARTH_RADIUS_METERS * EFFECTIVE_EARTH_RADIUS_METERS +
      2 * range * EFFECTIVE_EARTH_RADIUS_METERS * Math.sin(elevationRadians)
  );

  return {
    horizontalRangeMeters: Math.max(0, range * Math.cos(elevationRadians)),
    heightMeters: Math.max(0, centerDistance - EFFECTIVE_EARTH_RADIUS_METERS),
  };
}

const NWS_STOPS: Array<[number, [number, number, number]]> = [
  [15, [0x66 / 255, 0xcc / 255, 0xff / 255]],
  [20, [0x00 / 255, 0x99 / 255, 0xff / 255]],
  [25, [0x00 / 255, 0xff / 255, 0x00 / 255]],
  [30, [0x00 / 255, 0xcc / 255, 0x00 / 255]],
  [35, [0x00 / 255, 0x99 / 255, 0x00 / 255]],
  [40, [0xff / 255, 0xff / 255, 0x00 / 255]],
  [45, [0xff / 255, 0xcc / 255, 0x00 / 255]],
  [50, [0xff / 255, 0x99 / 255, 0x00 / 255]],
  [55, [0xff / 255, 0x00 / 255, 0x00 / 255]],
  [60, [0xcc / 255, 0x00 / 255, 0x00 / 255]],
  [65, [0x99 / 255, 0x00 / 255, 0x00 / 255]],
  [70, [0xff / 255, 0x00 / 255, 0xff / 255]],
  [75, [0xcc / 255, 0x00 / 255, 0xcc / 255]],
];

export function nwsColor(dbz: number): [number, number, number] {
  let color: [number, number, number] = [0x66 / 255, 0xcc / 255, 0xff / 255];
  for (const [threshold, rgb] of NWS_STOPS) {
    if (dbz >= threshold) {
      color = rgb;
    }
  }
  return color;
}
```

- **Step 4: Create optimized pointCloudArrays.ts**

Key change: pre-allocate `Float32Array` with upper-bound size, use a write cursor, return `subarray` views.

```typescript
import type { RadarVolumeMeta } from "@nexrad-3d/contracts";
import { nwsColor, projectBeamSample } from "../shared/radarGeometry";

const HEIGHT_SCALE = 3;

export interface PointArrays {
  positions: Float32Array;
  colors: Float32Array;
  pointCount: number;
}

export function buildPointArrays(
  data: Float32Array,
  metadata: RadarVolumeMeta,
  thresholdDbz: number
): PointArrays {
  let maxPoints = 0;
  for (const sweep of metadata.sweeps) {
    maxPoints += sweep.azimuthBins * sweep.radialBins;
  }

  const positions = new Float32Array(maxPoints * 3);
  const colors = new Float32Array(maxPoints * 3);
  let cursor = 0;
  let dataOffset = 0;

  for (const sweep of metadata.sweeps) {
    const { azimuthBins, radialBins, elevationAngleDegrees } = sweep;

    for (let azIdx = 0; azIdx < azimuthBins; azIdx++) {
      const azRad = (azIdx / azimuthBins) * 2 * Math.PI;
      const sinAz = Math.sin(azRad);
      const cosAz = Math.cos(azRad);

      for (let rIdx = 0; rIdx < radialBins; rIdx++) {
        const sample = data[dataOffset + azIdx * radialBins + rIdx];
        if (!Number.isFinite(sample) || sample === metadata.noDataValue || sample < thresholdDbz) {
          continue;
        }

        const slantMeters = metadata.minRange + rIdx * metadata.radialBinSizeMeters;
        const { horizontalRangeMeters, heightMeters } = projectBeamSample(
          slantMeters,
          elevationAngleDegrees
        );
        const rangeKm = horizontalRangeMeters / 1000;
        const heightKm = (heightMeters / 1000) * HEIGHT_SCALE;

        const base = cursor * 3;
        positions[base] = rangeKm * sinAz;
        positions[base + 1] = heightKm;
        positions[base + 2] = rangeKm * cosAz;

        const [r, g, b] = nwsColor(sample);
        colors[base] = r;
        colors[base + 1] = g;
        colors[base + 2] = b;
        cursor++;
      }
    }

    dataOffset += azimuthBins * radialBins;
  }

  return {
    positions: positions.subarray(0, cursor * 3),
    colors: colors.subarray(0, cursor * 3),
    pointCount: cursor,
  };
}
```

- **Step 5: Run test to verify it passes**

Run: `cd apps/nexrad && npx vitest run renderers/local/__tests__/pointCloudArrays.test.ts`

Expected: PASS

- **Step 6: Create globeRadarMath.ts**

Copy from `apps/web/src/renderers/globeRadarMath.ts` unchanged — pure math functions.

- **Step 7: Write failing test for globeRadarMesh**

Port existing tests from `apps/web/src/renderers/globeRadarMesh.test.ts`.

- **Step 8: Create optimized globeRadarMesh.ts**

Key changes from current implementation:

- Pre-allocate `Float64Array` for positions, `Uint8Array` for colors, `Uint32Array` for indices with estimated upper bounds.
- Use numeric vertex keys: `(sweepIdx << 21) | (azIdx << 11) | rangeIdx` instead of `Map<string, number>`.
- Use `Int32Array` vmap with `fill(-1)` (already present in current code for sweep surface, extend to vertex cache).
- Write cursor pattern for all output arrays.
- The ECEF transform callback stays the same (needed for Cesium's coordinate system).

The structure follows the same `appendSweepSurface` + `appendInterSweepWalls` pattern but with pre-allocated storage. The function signature and return type are identical to the current version so the rendering strategy can consume it unchanged.

```typescript
import type { RadarVolumeMeta } from "@nexrad-3d/contracts";
import { nwsColor, projectBeamSample } from "../shared/radarGeometry";

export type EcefPoint = { x: number; y: number; z: number };

const MESH_ALPHA_BYTE = Math.round(0.92 * 255);

export type BuildGlobeRadarVolumeMeshOptions = {
  metadata: RadarVolumeMeta;
  data: Float32Array;
  thresholdDbz: number;
  stride: number;
  enuToEcef: (east: number, north: number, up: number) => EcefPoint;
  fillInterSweepGaps?: boolean;
};

export function buildGlobeRadarVolumeMesh(
  options: BuildGlobeRadarVolumeMeshOptions
): { positions: Float64Array; colors: Uint8Array; indices: Uint32Array } | null {
  const { metadata, data, thresholdDbz, stride, enuToEcef } = options;
  const fillInterSweepGaps = options.fillInterSweepGaps !== false;
  const strideClamped = Math.max(1, stride);

  let totalCells = 0;
  for (const s of metadata.sweeps) {
    totalCells += s.azimuthBins * s.radialBins;
  }
  const estimatedVerts = Math.ceil(totalCells / (strideClamped * strideClamped)) * 2;
  const estimatedTris = estimatedVerts * 3;

  const positions = new Float64Array(estimatedVerts * 3);
  const colors = new Uint8Array(estimatedVerts * 4);
  const indices = new Uint32Array(estimatedTris * 3);
  let vertCursor = 0;
  let idxCursor = 0;

  const vertexCache = new Map<number, number>();

  type SweepLayout = {
    dataOffset: number;
    elevationAngleDegrees: number;
    azimuthBins: number;
    radialBins: number;
    sweepIdx: number;
  };

  const layouts: SweepLayout[] = [];
  let dataOffset = 0;
  for (let si = 0; si < metadata.sweeps.length; si++) {
    const sweep = metadata.sweeps[si];
    const { azimuthBins, radialBins } = sweep;
    if (dataOffset + azimuthBins * radialBins > data.length) break;
    layouts.push({
      dataOffset,
      elevationAngleDegrees: sweep.elevationAngleDegrees,
      azimuthBins,
      radialBins,
      sweepIdx: si,
    });
    dataOffset += azimuthBins * radialBins;
  }

  function sampleDbz(layout: SweepLayout, azIdx: number, rIdx: number): number | null {
    const v = data[layout.dataOffset + azIdx * layout.radialBins + rIdx];
    if (!Number.isFinite(v) || v === metadata.noDataValue || v < thresholdDbz) return null;
    return v;
  }

  function decimatedIndices(count: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < count; i += strideClamped) out.push(i);
    return out;
  }

  function vertexKey(sweepIdx: number, ia: number, ir: number): number {
    return (sweepIdx << 21) | (ia << 11) | ir;
  }

  function getOrCreateVertex(layout: SweepLayout, azList: number[], rgList: number[], ia: number, ir: number): number {
    const key = vertexKey(layout.sweepIdx, ia, ir);
    const existing = vertexCache.get(key);
    if (existing !== undefined) return existing;

    const azCell = azList[ia];
    const rCell = rgList[ir];
    const dbz = sampleDbz(layout, azCell, rCell)!;
    const slantMeters = metadata.minRange + rCell * metadata.radialBinSizeMeters;
    const { horizontalRangeMeters, heightMeters } = projectBeamSample(slantMeters, layout.elevationAngleDegrees);
    const azRad = (azCell / layout.azimuthBins) * 2 * Math.PI;
    const p = enuToEcef(
      Math.sin(azRad) * horizontalRangeMeters,
      Math.cos(azRad) * horizontalRangeMeters,
      heightMeters
    );

    const id = vertCursor;
    const pb = id * 3;
    positions[pb] = p.x;
    positions[pb + 1] = p.y;
    positions[pb + 2] = p.z;

    const [r, g, b] = nwsColor(dbz);
    const cb = id * 4;
    colors[cb] = Math.min(255, Math.max(0, Math.round(r * 255)));
    colors[cb + 1] = Math.min(255, Math.max(0, Math.round(g * 255)));
    colors[cb + 2] = Math.min(255, Math.max(0, Math.round(b * 255)));
    colors[cb + 3] = MESH_ALPHA_BYTE;

    vertexCache.set(key, id);
    vertCursor++;
    return id;
  }

  function appendSweepSurface(layout: SweepLayout): void {
    if (layout.azimuthBins < 2 || layout.radialBins < 2) return;
    const azList = decimatedIndices(layout.azimuthBins);
    const rgList = decimatedIndices(layout.radialBins);
    const nAz = azList.length;
    const nR = rgList.length;
    if (nAz < 2 || nR < 2) return;

    for (let ia = 0; ia < nAz; ia++) {
      const iaNext = (ia + 1) % nAz;
      for (let ir = 0; ir < nR - 1; ir++) {
        if (
          sampleDbz(layout, azList[ia], rgList[ir]) === null ||
          sampleDbz(layout, azList[iaNext], rgList[ir]) === null ||
          sampleDbz(layout, azList[iaNext], rgList[ir + 1]) === null ||
          sampleDbz(layout, azList[ia], rgList[ir + 1]) === null
        ) continue;

        const a = getOrCreateVertex(layout, azList, rgList, ia, ir);
        const b = getOrCreateVertex(layout, azList, rgList, iaNext, ir);
        const c = getOrCreateVertex(layout, azList, rgList, iaNext, ir + 1);
        const d = getOrCreateVertex(layout, azList, rgList, ia, ir + 1);
        indices[idxCursor++] = a;
        indices[idxCursor++] = b;
        indices[idxCursor++] = c;
        indices[idxCursor++] = a;
        indices[idxCursor++] = c;
        indices[idxCursor++] = d;
      }
    }
  }

  function appendInterSweepWalls(lower: SweepLayout, upper: SweepLayout): void {
    if (lower.azimuthBins !== upper.azimuthBins || lower.radialBins !== upper.radialBins) return;
    if (lower.azimuthBins < 2 || lower.radialBins < 2) return;
    const azList = decimatedIndices(lower.azimuthBins);
    const rgList = decimatedIndices(lower.radialBins);
    const nAz = azList.length;
    const nR = rgList.length;
    if (nAz < 2 || nR < 2) return;

    for (let ia = 0; ia < nAz; ia++) {
      const iaNext = (ia + 1) % nAz;
      for (let ir = 0; ir < nR - 1; ir++) {
        const l0 = sampleDbz(lower, azList[ia], rgList[ir]) !== null ? getOrCreateVertex(lower, azList, rgList, ia, ir) : null;
        const l1 = sampleDbz(lower, azList[iaNext], rgList[ir]) !== null ? getOrCreateVertex(lower, azList, rgList, iaNext, ir) : null;
        const u1 = sampleDbz(upper, azList[iaNext], rgList[ir]) !== null ? getOrCreateVertex(upper, azList, rgList, iaNext, ir) : null;
        const u0 = sampleDbz(upper, azList[ia], rgList[ir]) !== null ? getOrCreateVertex(upper, azList, rgList, ia, ir) : null;
        if (l0 !== null && l1 !== null && u1 !== null && u0 !== null) {
          indices[idxCursor++] = l0;
          indices[idxCursor++] = l1;
          indices[idxCursor++] = u1;
          indices[idxCursor++] = l0;
          indices[idxCursor++] = u1;
          indices[idxCursor++] = u0;
        }

        const r0 = sampleDbz(lower, azList[ia], rgList[ir]) !== null ? getOrCreateVertex(lower, azList, rgList, ia, ir) : null;
        const r1 = sampleDbz(lower, azList[ia], rgList[ir + 1]) !== null ? getOrCreateVertex(lower, azList, rgList, ia, ir + 1) : null;
        const r1u = sampleDbz(upper, azList[ia], rgList[ir + 1]) !== null ? getOrCreateVertex(upper, azList, rgList, ia, ir + 1) : null;
        const r0u = sampleDbz(upper, azList[ia], rgList[ir]) !== null ? getOrCreateVertex(upper, azList, rgList, ia, ir) : null;
        if (r0 !== null && r1 !== null && r1u !== null && r0u !== null) {
          indices[idxCursor++] = r0;
          indices[idxCursor++] = r1;
          indices[idxCursor++] = r1u;
          indices[idxCursor++] = r0;
          indices[idxCursor++] = r1u;
          indices[idxCursor++] = r0u;
        }
      }
    }
  }

  for (const layout of layouts) {
    appendSweepSurface(layout);
  }

  if (fillInterSweepGaps && layouts.length >= 2) {
    const sorted = [...layouts].sort((a, b) => a.elevationAngleDegrees - b.elevationAngleDegrees);
    for (let s = 0; s < sorted.length - 1; s++) {
      appendInterSweepWalls(sorted[s], sorted[s + 1]);
    }
  }

  if (idxCursor === 0) return null;

  return {
    positions: positions.subarray(0, vertCursor * 3),
    colors: colors.subarray(0, vertCursor * 4),
    indices: indices.subarray(0, idxCursor),
  };
}
```

- **Step 9: Run globe mesh tests**

Run: `cd apps/nexrad && npx vitest run renderers/globe/__tests__/`

Expected: PASS

- **Step 10: Commit**

```bash
git add apps/nexrad/renderers/
git commit -m "feat(nexrad): add optimized geometry builders with pre-allocated typed arrays"
```

---

### Task 6: Web Workers + useWorker Hook

**Files:**

- Create: `apps/nexrad/workers/meshWorker.ts`
- Create: `apps/nexrad/workers/pointCloudWorker.ts`
- Create: `apps/nexrad/hooks/useWorker.ts`
- **Step 1: Create meshWorker.ts**

The worker receives volume data + metadata, computes ECEF positions using Cesium math internally (since Cesium is client-side only, the worker uses the same 4/3 Earth math + a manual ENU-to-ECEF matrix multiply). The ECEF transform is done in the worker to keep the main thread free.

```typescript
import type { RadarVolumeMeta } from "@nexrad-3d/contracts";
import { buildGlobeRadarVolumeMesh, type BuildGlobeRadarVolumeMeshOptions, type EcefPoint } from "../renderers/globe/globeRadarMesh";

interface MeshRequest {
  type: "build";
  data: Float32Array;
  metadata: RadarVolumeMeta;
  thresholdDbz: number;
  stride: number;
  enuToEcefMatrix: number[];
}

interface MeshResult {
  type: "result";
  positions: Float64Array;
  colors: Uint8Array;
  indices: Uint32Array;
}

interface MeshEmpty {
  type: "empty";
}

interface MeshError {
  type: "error";
  message: string;
}

function multiplyMatrixByPoint(m: number[], x: number, y: number, z: number): EcefPoint {
  return {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14],
  };
}

self.onmessage = (event: MessageEvent<MeshRequest>) => {
  const { data, metadata, thresholdDbz, stride, enuToEcefMatrix } = event.data;

  try {
    const enuToEcef = (east: number, north: number, up: number): EcefPoint =>
      multiplyMatrixByPoint(enuToEcefMatrix, east, north, up);

    const mesh = buildGlobeRadarVolumeMesh({
      metadata,
      data,
      thresholdDbz,
      stride,
      enuToEcef,
    });

    if (!mesh) {
      const msg: MeshEmpty = { type: "empty" };
      self.postMessage(msg);
      return;
    }

    const msg: MeshResult = {
      type: "result",
      positions: mesh.positions,
      colors: mesh.colors,
      indices: mesh.indices,
    };

    self.postMessage(msg, [
      mesh.positions.buffer,
      mesh.colors.buffer,
      mesh.indices.buffer,
    ] as unknown as Transferable[]);
  } catch (err) {
    const msg: MeshError = {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(msg);
  }
};
```

- **Step 2: Create pointCloudWorker.ts**

```typescript
import type { RadarVolumeMeta } from "@nexrad-3d/contracts";
import { buildPointArrays } from "../renderers/local/pointCloudArrays";

interface PointCloudRequest {
  type: "build";
  data: Float32Array;
  metadata: RadarVolumeMeta;
  thresholdDbz: number;
}

interface PointCloudResult {
  type: "result";
  positions: Float32Array;
  colors: Float32Array;
  pointCount: number;
}

interface PointCloudError {
  type: "error";
  message: string;
}

self.onmessage = (event: MessageEvent<PointCloudRequest>) => {
  const { data, metadata, thresholdDbz } = event.data;

  try {
    const result = buildPointArrays(data, metadata, thresholdDbz);

    const msg: PointCloudResult = {
      type: "result",
      positions: result.positions,
      colors: result.colors,
      pointCount: result.pointCount,
    };

    self.postMessage(msg, [
      result.positions.buffer,
      result.colors.buffer,
    ] as unknown as Transferable[]);
  } catch (err) {
    const msg: PointCloudError = {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(msg);
  }
};
```

- **Step 3: Create useWorker hook**

```typescript
import { useCallback, useEffect, useRef } from "react";

export function useWorker<TRequest, TResult>(
  factory: () => Worker,
  onResult: (result: TResult) => void
) {
  const workerRef = useRef<Worker | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    const worker = factory();
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<TResult>) => {
      onResultRef.current(event.data);
    };

    worker.onerror = (err) => {
      console.error("Worker error:", err);
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [factory]);

  const postMessage = useCallback(
    (message: TRequest, transfer?: Transferable[]) => {
      workerRef.current?.postMessage(message, transfer ?? []);
    },
    []
  );

  return { postMessage };
}
```

- **Step 4: Commit**

```bash
git add apps/nexrad/workers/ apps/nexrad/hooks/useWorker.ts
git commit -m "feat(nexrad): add Web Workers for mesh and point cloud geometry construction"
```

---

### Task 7: Rendering Strategies (Cesium + Three.js)

**Files:**

- Create: `apps/nexrad/renderers/globe/globeRadarRenderStrategy.ts`
- Create: `apps/nexrad/renderers/globe/GlobeRadarLayer.ts`
- Create: `apps/nexrad/renderers/local/PointCloudRenderer.ts`
- Create: `apps/nexrad/renderers/shared/volumeLoader.ts`
- Create: `apps/nexrad/renderers/shared/volumeSweepSubset.ts`
- **Step 1: Create globeRadarRenderStrategy.ts**

Port from `apps/web/src/renderers/globeRadarRenderStrategy.ts` with these changes:

- `MeshGlobeRadarStrategy.update`: Receives pre-built geometry from worker (positions/colors/indices) instead of calling `buildGlobeRadarVolumeMesh` on main thread. Add a `updateFromGeometry(positions, colors, indices)` method.
- Change `asynchronous: false` to `asynchronous: true`.
- `PointGlobeRadarStrategy`: Replace `PointPrimitiveCollection.add()` loop with a single batched `Cesium.Primitive` using `PrimitiveType.POINTS`.
- Keep existing `update()` method signature for backward compat, but add `updateFromWorkerResult()` for the worker path.

The strategy now has two update paths:

1. `updateFromWorkerResult(mesh)` — takes pre-built geometry from worker (primary path)
2. `update(site, metadata, data, thresholdDbz, options)` — fallback that builds on main thread

- **Step 2: Create GlobeRadarLayer.ts**

Port from `apps/web/src/renderers/cesiumGlobeLayer.ts` unchanged — thin wrapper over the strategy.

- **Step 3: Create PointCloudRenderer.ts with reusable BufferGeometry**

Port from `apps/web/src/renderers/pointCloudRenderer.ts` with this key change:

In the constructor, create the `BufferGeometry`, `PointsMaterial`, and `THREE.Points` once with a maximum-size buffer. On `updateVolume`, copy new data in and set `drawRange` + `needsUpdate` instead of disposing and recreating.

Key changes in `updateVolume`:

```typescript
updateFromWorkerResult(positions: Float32Array, colors: Float32Array, pointCount: number): number {
  if (pointCount === 0) {
    if (this.points) this.points.visible = false;
    return 0;
  }

  if (!this.points) {
    this.initPointCloud(positions.length / 3);
  }

  const geo = this.points!.geometry;
  const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
  const colAttr = geo.getAttribute("color") as THREE.BufferAttribute;

  if (positions.length > posAttr.array.length) {
    this.initPointCloud(positions.length / 3);
  }

  (posAttr.array as Float32Array).set(positions);
  posAttr.needsUpdate = true;
  (colAttr.array as Float32Array).set(colors);
  colAttr.needsUpdate = true;
  geo.setDrawRange(0, pointCount);
  this.points!.visible = true;
  return pointCount;
}
```

- **Step 4: Create volumeLoader.ts**

Port from `apps/web/src/renderers/volumeLoader.ts` with these changes:

- API base URL becomes relative (`/api` instead of `http://localhost:4000/v1`)
- Data endpoint: `/api/data/{storageKey}` instead of `/v1/data/{storageKey}`
- Fix cache: return `cached.data` directly instead of `new Float32Array(cached.data)`
- Remove `window.setTimeout` (use `AbortController` timeout instead for SSR safety)
- **Step 5: Create volumeSweepSubset.ts**

Copy from `apps/web/src/renderers/volumeSweepSubset.ts` unchanged — pure function.

- **Step 6: Commit**

```bash
git add apps/nexrad/renderers/
git commit -m "feat(nexrad): port rendering strategies with buffer reuse and batched points"
```

---

### Task 8: Client Components

**Files:**

- Create: `apps/nexrad/components/ControlPanel.tsx`
- Create: `apps/nexrad/components/StatusStrip.tsx`
- Create: `apps/nexrad/components/GlobeView.tsx`
- Create: `apps/nexrad/components/LocalView.tsx`
- Create: `apps/nexrad/components/RadarViewer.tsx`
- **Step 1: Create ControlPanel.tsx**

Port from `apps/web/src/components/RadarControls.tsx`. Same props interface and JSX. Change imports to use relative paths within the new structure. Add `"use client"` directive.

- **Step 2: Create StatusStrip.tsx**

Extract the status strip section from `App.tsx` into its own client component:

```typescript
"use client";

interface StatusStripProps {
  statusText: string;
  renderSource: "artifact" | "synthetic" | null;
  decodeStatusText: string;
  isApproximateDecode: boolean;
  frameCount: number;
}

export function StatusStrip(props: StatusStripProps) {
  const { statusText, renderSource, decodeStatusText, isApproximateDecode, frameCount } = props;

  return (
    <section className="status-strip">
      <span className="status-pill">{statusText}</span>
      <span className="status-pill">Source: {renderSource ?? "none"}</span>
      <span className={isApproximateDecode ? "status-pill status-pill-warning" : "status-pill"}>
        {decodeStatusText}
      </span>
      <span className="status-pill">Frames: {frameCount}</span>
    </section>
  );
}
```

- **Step 3: Create GlobeView.tsx**

`"use client"` component that owns the Cesium Viewer lifecycle. Uses the `meshWorker` via `useWorker` to build geometry off-thread. Receives volume data, metadata, threshold, and render options as props.

Key aspects:

- Creates `Cesium.Viewer` in a `useEffect` on mount (same config as current `App.tsx`)
- Creates `GlobeRadarLayer` tied to the viewer
- On volume/threshold/mode change: posts data to mesh/point worker, receives geometry, calls strategy's `updateFromWorkerResult`
- For the mesh worker, extracts the ENU-to-ECEF matrix from Cesium as a flat `number[16]` array and sends it to the worker
- Cleans up viewer on unmount
- **Step 4: Create LocalView.tsx**

`"use client"` component that owns the Three.js `PointCloudRenderer`. Uses `pointCloudWorker` via `useWorker`. Receives the same data props as `RadarView` currently does.

Port from `apps/web/src/components/RadarView.tsx` — same structure but uses worker for geometry and the renderer's `updateFromWorkerResult` instead of `updateVolume`.

- **Step 5: Create RadarViewer.tsx**

`"use client"` component that owns all application state. This is the equivalent of the current `App.tsx` but without server/Cesium lifecycle code.

Props: `{ initialSites: RadarSite[] }` (received from the RSC page).

Contains:

- All `useState` calls from current `App.tsx`
- `useRadarData` hook
- `useMemo` for sweep subset
- `useEffect` for volume data loading
- Renders `ControlPanel`, `StatusStrip`, and conditionally `GlobeView` or `LocalView` based on `displayMode`

Import `GlobeView` and `LocalView` via `next/dynamic` with `{ ssr: false }`:

```typescript
import dynamic from "next/dynamic";

const GlobeView = dynamic(() => import("./GlobeView").then((m) => ({ default: m.GlobeView })), {
  ssr: false,
  loading: () => <div className="cesium-viewer-host" />,
});

const LocalView = dynamic(() => import("./LocalView").then((m) => ({ default: m.LocalView })), {
  ssr: false,
  loading: () => <div className="radar-view" />,
});
```

- **Step 6: Commit**

```bash
git add apps/nexrad/components/
git commit -m "feat(nexrad): port all client components with dynamic WebGL imports"
```

---

### Task 9: Hooks + Page Assembly

**Files:**

- Create: `apps/nexrad/hooks/useRadarData.ts`
- Modify: `apps/nexrad/app/layout.tsx`
- Modify: `apps/nexrad/app/page.tsx`
- Create: `apps/nexrad/styles/globals.css`
- **Step 1: Create useRadarData.ts**

Port from `apps/web/src/hooks/useRadarData.ts` with these changes:

- API base is empty string (relative to same origin): `fetch("/api/sites")` instead of `fetch("${apiBase}/v1/sites")`
- Path prefix changes: `/api/volumes/latest` instead of `/v1/volumes/latest`
- SSE endpoint: `/api/events` instead of `/v1/stream/events`
- Remove `import.meta.env.VITE_`* references
- Timeout default is 10000ms (same as current)
- **Step 2: Create globals.css**

Copy from `apps/web/src/App.css` unchanged. This is a complete CSS file with all styles for the app.

Add Cesium widget CSS import at the top:

```css
@import "cesium/Build/Cesium/Widgets/widgets.css";

:root {
  --surface: rgba(11, 23, 37, 0.85);
  /* ... rest of existing CSS ... */
}
```

Note: The Cesium CSS import path may need adjustment depending on how Next.js resolves it. If the import path doesn't work, inline the Cesium widget CSS or load it via a `<link>` tag in `layout.tsx`.

- **Step 3: Update layout.tsx**

```typescript
import type { Metadata } from "next";
import "./styles/globals.css";

export const metadata: Metadata = {
  title: "Nexrad 3D",
  description: "Volumetric radar — globe or local 3D",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- **Step 4: Update page.tsx**

```typescript
import type { RadarSite } from "@nexrad-3d/contracts";
import { getRedis, withTimeout } from "@/lib/redis";
import { RADAR_SITES, KNOWN_SITES, POLL_INTERVAL_SECONDS, REDIS_COMMAND_TIMEOUT_MS } from "@/lib/env";
import { RadarViewer } from "@/components/RadarViewer";

function buildSite(siteId: string, lastVolumeAtMs: number | undefined): RadarSite {
  const fallback = { name: `Radar ${siteId}`, latitude: 0, longitude: 0, elevationMeters: 0 };
  const info = KNOWN_SITES[siteId] || fallback;
  const staleMs = POLL_INTERVAL_SECONDS * 3 * 1000;
  const isOnline = typeof lastVolumeAtMs === "number" && Date.now() - lastVolumeAtMs <= staleMs;

  return {
    id: siteId,
    name: info.name,
    latitude: info.latitude,
    longitude: info.longitude,
    elevationMeters: info.elevationMeters,
    status: isOnline ? "online" : "unknown",
    lastVolumeAt: lastVolumeAtMs,
  };
}

async function getSites(): Promise<RadarSite[]> {
  try {
    const redis = getRedis();
    const keys = RADAR_SITES.map((id) => `radar:site:lastVolumeAt:${id}`);
    const values = keys.length > 0
      ? await withTimeout(redis.mget(...keys), REDIS_COMMAND_TIMEOUT_MS, "site lookup")
      : [];

    return RADAR_SITES.map((id, i) => {
      const parsed = Number.parseInt(values[i] || "", 10);
      return buildSite(id, Number.isNaN(parsed) ? undefined : parsed);
    });
  } catch {
    return RADAR_SITES.map((id) => buildSite(id, undefined));
  }
}

export default async function Home() {
  const sites = await getSites();
  return <RadarViewer initialSites={sites} />;
}
```

- **Step 5: Commit**

```bash
git add apps/nexrad/hooks/useRadarData.ts apps/nexrad/app/layout.tsx apps/nexrad/app/page.tsx apps/nexrad/styles/
git commit -m "feat(nexrad): wire page shell, hooks, and styles"
```

---

### Task 10: Docker + Infrastructure

**Files:**

- Create: `apps/nexrad/Dockerfile`
- Modify: `infra/docker/docker-compose.yml`
- **Step 1: Create Dockerfile**

Multi-stage build using Next.js standalone output:

```dockerfile
FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/nexrad/package.json apps/nexrad/
RUN npm ci --workspace=@nexrad-3d/nexrad --include-workspace-root

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=deps /app/apps/nexrad/node_modules ./apps/nexrad/node_modules
COPY . .
RUN npm run build -w @nexrad-3d/contracts
RUN npm run build -w @nexrad-3d/nexrad

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/nexrad/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/nexrad/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/nexrad/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "apps/nexrad/server.js"]
```

- **Step 2: Update docker-compose.yml**

Add the nexrad and ingest-worker services to the existing `infra/docker/docker-compose.yml`. Keep existing redis, minio, and minio-init services unchanged.

Add before the `volumes:` section:

```yaml
  nexrad:
    build:
      context: ../..
      dockerfile: apps/nexrad/Dockerfile
    ports:
      - "3000:3000"
    environment:
      REDIS_URL: redis://redis:6379
      S3_ENDPOINT: http://minio:9000
      S3_ACCESS_KEY: minioadmin
      S3_SECRET_KEY: minioadmin
      S3_BUCKET: radar-data
      RADAR_SITES: KMKX
    depends_on:
      - redis
      - minio

  ingest-worker:
    build:
      context: ../..
      dockerfile: services/ingest-worker/Dockerfile
    environment:
      REDIS_URL: redis://redis:6379
      MINIO_ENDPOINT: http://minio:9000
      MINIO_ACCESS_KEY: minioadmin
      MINIO_SECRET_KEY: minioadmin
      MINIO_BUCKET: radar-data
      RADAR_SITES: KMKX
      POLL_INTERVAL_SECONDS: "30"
    depends_on:
      - redis
      - minio
```

- **Step 3: Commit**

```bash
git add apps/nexrad/Dockerfile infra/docker/docker-compose.yml
git commit -m "feat(nexrad): add Dockerfile and update docker-compose for full stack"
```

---

### Task 11: Verify Full Stack

- **Step 1: Run dev server**

Run: `cd apps/nexrad && npx next dev --turbopack`

Verify:

- Page loads at `http://localhost:3000`
- Site dropdown is populated (if Redis is running with data)
- API routes respond: `curl http://localhost:3000/api/health`
- Cesium globe renders (check browser console for Cesium asset loading errors)
- Local 3D view renders
- **Step 2: Run tests**

Run: `cd apps/nexrad && npx vitest run`

Expected: All geometry builder tests pass.

- **Step 3: Build production**

Run: `cd apps/nexrad && npx next build`

Expected: Build succeeds, standalone output in `.next/standalone/`.

- **Step 4: Docker Compose up**

Run: `docker compose -f infra/docker/docker-compose.yml up --build`

Verify: All services start, nexrad app accessible at `http://localhost:3000`.

---

### Task 12: Cleanup

**Files:**

- Delete: `apps/web/` (entire directory)
- Delete: `apps/api/` (entire directory)
- Modify: `package.json` (root)
- **Step 1: Remove old apps**

```bash
rm -rf apps/web apps/api
```

- **Step 2: Update root package.json scripts**

Replace the current scripts with:

```json
{
  "scripts": {
    "dev": "concurrently -n nexrad,ingest -c cyan,magenta \"npm:dev:nexrad\" \"npm:dev:ingest\"",
    "dev:nexrad": "npm run dev -w @nexrad-3d/nexrad",
    "dev:ingest": "npm run dev -w @nexrad-3d/ingest-worker",
    "build": "npm run build --workspaces --if-present",
    "typecheck": "npm run build -w @nexrad-3d/contracts && npm run build -w @nexrad-3d/radar-parser && npm run typecheck --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present",
    "infra:up": "docker compose -f infra/docker/docker-compose.yml up -d",
    "infra:down": "docker compose -f infra/docker/docker-compose.yml down",
    "format": "prettier --write ."
  }
}
```

- **Step 3: Run npm install to clean lockfile**

Run: `npm install` from monorepo root.

Expected: `package-lock.json` updated, no errors about missing workspaces.

- **Step 4: Run full typecheck**

Run: `npm run typecheck`

Expected: No type errors.

- **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove old Vite SPA and Express API, update workspace scripts"
```

