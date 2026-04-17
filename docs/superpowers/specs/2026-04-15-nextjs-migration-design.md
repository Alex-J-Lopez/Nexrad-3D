# Next.js Migration + Performance Optimization Design

## Goal

Migrate Nexrad-3D from a Vite SPA + Express API architecture to a consolidated Next.js App Router application, while rebuilding the rendering pipeline with Web Workers, pre-allocated typed arrays, and buffer reuse to eliminate full-resolution performance bottlenecks.

## Architecture

The Next.js app replaces both `apps/web` (Vite SPA) and `apps/api` (Express). Route Handlers provide direct server-side access to Redis and S3 with no intermediate HTTP hop. The ingest worker remains a separate Docker service. React Server Components render the page shell and fetch initial site data server-side. WebGL viewers (Cesium globe, Three.js local 3D) load as `'use client'` components with SSR disabled. Geometry construction runs in dedicated Web Workers with zero-copy `Transferable` typed arrays.

## Tech Stack

- **Next.js 15** (App Router, Turbopack dev, standalone Docker output)
- **React 19** (Server Components for shell, client components for WebGL)
- **Cesium** (globe view, mesh + batched point primitives)
- **Three.js** (local 3D view, point cloud with reusable BufferGeometry)
- **ioredis** (server-only Redis client for Route Handlers)
- **@aws-sdk/client-s3** (server-only S3 client for binary data proxy)
- **Web Workers** (geometry construction off main thread)
- **Vitest** (unit tests for geometry builders, workers, route handlers)

## Monorepo Structure After Migration

```
nexrad-3d/
  apps/
    nexrad/                          <-- NEW: Next.js app (replaces apps/web + apps/api)
      app/
        layout.tsx                   Root layout, global CSS, Cesium base URL
        page.tsx                     RSC shell: fetches sites server-side, renders client viewer
        api/
          sites/route.ts             GET - site list from Redis
          products/route.ts          GET - product catalog (static)
          volumes/
            latest/route.ts          GET - latest volume metadata from Redis
            latest/batch/route.ts    GET - batch latest volumes
            [volumeId]/route.ts      GET - volume by ID from Redis
            timeline/route.ts        GET - timeline frames from Redis sorted set
          data/[...key]/route.ts     GET - binary .f32 stream from S3
          events/route.ts            GET - SSE stream via Redis pub/sub
          health/route.ts            GET - health check
      components/
        RadarViewer.tsx              'use client' - top-level state owner, mode switcher
        GlobeView.tsx                'use client' - Cesium viewer lifecycle
        LocalView.tsx                'use client' - Three.js point cloud lifecycle
        ControlPanel.tsx             'use client' - site/product/threshold/timeline controls
        StatusStrip.tsx              'use client' - status indicators
      workers/
        meshWorker.ts                Web Worker: buildGlobeRadarVolumeMesh
        pointCloudWorker.ts          Web Worker: buildPointArrays
      renderers/
        globe/
          GlobeRadarLayer.ts         Owns active render strategy for Cesium viewer
          globeRadarRenderStrategy.ts Mesh + BatchedPoint strategies (Cesium Primitives)
          globeRadarMesh.ts          Triangle mesh builder (pre-allocated arrays)
          globeRadarMath.ts          Stride/budget calculations
        local/
          PointCloudRenderer.ts      Three.js renderer with reusable BufferGeometry
          pointCloudArrays.ts        Point cloud builder (pre-allocated arrays)
        shared/
          radarGeometry.ts           projectBeamSample, nwsColor
          volumeLoader.ts            Fetch + decode .f32 from API route, client cache
          volumeSweepSubset.ts       Tilt subsetting
      hooks/
        useRadarData.ts              Metadata fetching, SSE subscription (uses /api/* routes)
        useWorker.ts                 Typed Worker postMessage/onmessage wrapper
      lib/
        redis.ts                     Server-only ioredis singleton
        storage.ts                   Server-only S3Client singleton
        env.ts                       Server-only env var parsing
      public/
        cesium/                      Static Cesium assets (copied at build time)
      styles/
        globals.css                  App CSS (ported from current App.css)
      next.config.ts                 CopyWebpackPlugin for Cesium, standalone output
      Dockerfile                     Multi-stage Docker build
      package.json
      tsconfig.json

  services/
    ingest-worker/                   UNCHANGED - separate Docker service

  packages/
    contracts/                       UNCHANGED - shared TypeScript types
    radar-parser/                    UNCHANGED - NEXRAD/ODIM parser (used by ingest-worker)

  infra/
    docker/
      docker-compose.yml             Updated: nexrad + ingest-worker + redis + minio
```

## What Gets Deleted

- `apps/web/` - entire Vite SPA (replaced by `apps/nexrad/`)
- `apps/api/` - entire Express API (replaced by Route Handlers in `apps/nexrad/`)

## What Stays Unchanged

- `packages/contracts/` - shared types, API response interfaces
- `packages/radar-parser/` - NEXRAD Level-II parser
- `services/ingest-worker/` - NOAA polling, parsing, S3 upload, Redis metadata

## Route Handlers

Each Express endpoint maps to a Next.js Route Handler. The handlers import `lib/redis.ts` and `lib/storage.ts` directly (server-side only, never bundled to client).


| Current Express Route          | Next.js Route Handler                   | Notes                                            |
| ------------------------------ | --------------------------------------- | ------------------------------------------------ |
| `GET /v1/sites`                | `app/api/sites/route.ts`                | Reads `radar:site:lastVolumeAt:*` from Redis     |
| `GET /v1/products`             | `app/api/products/route.ts`             | Static product catalog from contracts            |
| `GET /v1/volumes/latest`       | `app/api/volumes/latest/route.ts`       | Reads `radar:latest:{site}:{product}` from Redis |
| `GET /v1/volumes/latest/batch` | `app/api/volumes/latest/batch/route.ts` | Multi-get from Redis                             |
| `GET /v1/volumes/:volumeId`    | `app/api/volumes/[volumeId]/route.ts`   | Reads `radar:volume:{id}` from Redis             |
| `GET /v1/timeline`             | `app/api/volumes/timeline/route.ts`     | `ZRANGE` on `radar:timeline:{site}:{product}`    |
| `GET /v1/data/:storageKey(*)`  | `app/api/data/[...key]/route.ts`        | Streams S3 object body as Response               |
| `GET /v1/stream/events`        | `app/api/events/route.ts`               | SSE via ReadableStream + Redis pub/sub           |
| `GET /health`                  | `app/api/health/route.ts`               | `{ status: "ok" }`                               |


### SSE in Route Handlers

```typescript
export async function GET() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const subscriber = redis.duplicate();
      await subscriber.connect();
      controller.enqueue(encoder.encode(": connected\n\n"));

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 20_000);

      await subscriber.subscribe("radar:events", (message) => {
        try {
          const event = JSON.parse(message);
          controller.enqueue(
            encoder.encode(`event: ${event.eventType}\ndata: ${JSON.stringify(event.data)}\n\n`)
          );
        } catch {}
      });

      // Cleanup when client disconnects (controller.close or abort signal)
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

### Binary Data Streaming

```typescript
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const storageKey = key.join("/");
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: storageKey });
  const object = await s3.send(command);

  if (!object.Body) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new Response(object.Body.transformToWebStream(), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "public, max-age=120",
    },
  });
}
```

## Server Component Page Shell

The root `page.tsx` is a React Server Component that fetches the site list at request time:

```typescript
import { getSites } from "@/lib/redis";
import { RadarViewer } from "@/components/RadarViewer";

export default async function Home() {
  const sites = await getSites();
  return <RadarViewer initialSites={sites} />;
}
```

This means the site dropdown is populated before any client JavaScript loads. `RadarViewer` is a `'use client'` component that owns all interactive state.

## Cesium in Next.js

Cesium requires static assets (Workers, Assets, Widgets, ThirdParty) served alongside the app. In the current Vite setup, `vite-plugin-static-copy` handles this. In Next.js:

1. `next.config.ts` uses `CopyWebpackPlugin` to copy Cesium assets from `node_modules/cesium/Build/Cesium/` to `.next/static/cesium/` during build.
2. `NEXT_PUBLIC_CESIUM_BASE_URL` env var is set to `/_next/static/cesium`.
3. Cesium is only imported in `'use client'` components loaded via `next/dynamic` with `{ ssr: false }`.
4. The `GlobeView` component sets `window.CESIUM_BASE_URL` before creating the Viewer.

## Performance Optimizations (Built Into New Architecture)

### 1. Web Workers for Geometry Construction

Both `buildGlobeRadarVolumeMesh` and `buildPointArrays` move to dedicated Web Workers. The main thread posts the `Float32Array` volume data as a `Transferable` (zero-copy), the worker builds geometry, and posts the result arrays back as `Transferable`.

Worker message protocol:

```typescript
// Main -> Worker
interface GeometryRequest {
  type: "build";
  data: Float32Array;          // transferred
  metadata: RadarVolumeMeta;   // structured clone
  thresholdDbz: number;
  stride: number;
  sitePosition?: { lat: number; lon: number; elevM: number }; // for ECEF transform in mesh worker
}

// Worker -> Main
interface MeshGeometryResult {
  type: "result";
  positions: Float64Array;     // transferred
  colors: Uint8Array;          // transferred
  indices: Uint32Array;        // transferred
}

interface PointGeometryResult {
  type: "result";
  positions: Float32Array;     // transferred
  colors: Float32Array;        // transferred
  pointCount: number;
}
```

The `useWorker` hook wraps `new Worker(new URL(...), { type: "module" })` with typed `postMessage`/`onmessage` and handles cleanup on unmount.

### 2. Pre-allocated Typed Arrays

Replace the current pattern of `number[].push(...)` then `new Float32Array(positions)` with pre-sized typed arrays:

```typescript
// Before (current):
const positions: number[] = [];
// ... loop: positions.push(x, y, z);
return new Float32Array(positions);  // double allocation + GC

// After:
const maxPoints = totalPackedBins(metadata.sweeps);
const positions = new Float32Array(maxPoints * 3);
let cursor = 0;
// ... loop: positions[cursor++] = x; positions[cursor++] = y; positions[cursor++] = z;
return positions.subarray(0, cursor);  // no copy, just a view
```

### 3. Numeric Vertex Dedup (Globe Mesh)

Replace string-keyed `Map<string, number>` vertex cache with numeric keys:

```typescript
// Before:
function vertexKey(dataOffset: number, ia: number, ir: number): string {
  return `${dataOffset}\0${ia}\0${ir}`;
}
const vertexCache = new Map<string, number>();

// After:
// Encode (sweepIdx, azIdx, rangeIdx) into a single integer key
// sweepIdx < 32, azIdx < 1024, rangeIdx < 2048 => fits in 32 bits
function vertexKey(sweepIdx: number, ia: number, ir: number): number {
  return (sweepIdx << 21) | (ia << 11) | ir;
}
const vertexCache = new Map<number, number>();
```

### 4. Reusable BufferGeometry (Three.js Local View)

Instead of dispose/recreate on every update:

```typescript
// Create once
const geometry = new THREE.BufferGeometry();
const posAttr = new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3);
posAttr.setUsage(THREE.DynamicDrawUsage);
geometry.setAttribute("position", posAttr);
// ... same for color

// On update: copy new data in, set drawRange
posAttr.array.set(newPositions);
posAttr.needsUpdate = true;
geometry.setDrawRange(0, newPointCount);
```

### 5. Batched Globe Points (Cesium)

Replace per-sample `PointPrimitiveCollection.add()` with a single batched `Cesium.Primitive`:

```typescript
// Before: hundreds of thousands of collection.add({ position, color, pixelSize })
// After: one Primitive with PrimitiveType.POINTS
const geometry = new Cesium.Geometry({
  attributes: {
    position: new Cesium.GeometryAttribute({
      componentDatatype: Cesium.ComponentDatatype.DOUBLE,
      componentsPerAttribute: 3,
      values: positionsFloat64,
    }),
    color: new Cesium.GeometryAttribute({
      componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
      componentsPerAttribute: 4,
      normalize: true,
      values: colorsUint8,
    }),
  },
  primitiveType: Cesium.PrimitiveType.POINTS,
  boundingSphere: Cesium.BoundingSphere.fromVertices(positionsFloat64),
});
```

### 6. Async Cesium Primitive Creation

Change `asynchronous: false` to `asynchronous: true` so Cesium builds GPU resources on its own worker thread instead of blocking the main thread.

### 7. Volume Loader Cache Fix

Return the cached `Float32Array` directly (callers treat as read-only) instead of copying:

```typescript
// Before: return { data: new Float32Array(cached.data), ... };
// After:  return { data: cached.data, ... };
```

## Data Flow

```
NOAA NEXRAD Level II
       |
       v
 ingest-worker (Docker)
   - polls NOAA dir.list
   - downloads .ar2v archive
   - radar-parser: loadVolume()
   - uploads {site}/{time}/{PRODUCT}.f32 to S3
   - writes RadarVolumeMeta to Redis
   - publishes radar:events
       |
       v
 Next.js App (Docker)
   Server Layer:
     - page.tsx (RSC): reads site list from Redis, passes to client
     - Route Handlers: read Redis/S3 directly, respond to client
   Client Layer:
     - RadarViewer: fetches metadata from /api/*, receives SSE
     - transfers Float32Array to Web Worker
     - Worker builds geometry (mesh or point cloud)
     - Worker transfers geometry arrays back
     - GlobeView: updates Cesium Primitive (async)
     - LocalView: updates Three.js BufferGeometry (in-place)
```

## Docker Composition

```yaml
services:
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
    depends_on:
      - redis
      - minio

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio-data:/data

  minio-init:
    image: minio/mc:latest
    depends_on:
      - minio
    entrypoint: >
      /bin/sh -c "
      until (/usr/bin/mc alias set local http://minio:9000 minioadmin minioadmin); do
        echo 'waiting for minio...' && sleep 1;
      done;
      /usr/bin/mc mb -p local/radar-data || true;
      exit 0;
      "

volumes:
  minio-data:
```

## Error Handling

- Route Handlers use try/catch with `NextResponse.json({ error }, { status })` matching current Express patterns.
- Redis operations use a `withTimeout` wrapper (ported from current API).
- SSE stream handles subscriber disconnect via AbortSignal.
- Workers post error messages back to main thread on failure; the hook surfaces these as state.
- Volume loader falls back to synthetic data on fetch failure (same as current behavior).

## Testing Strategy

- **Geometry builders**: Unit tests for `buildPointArrays` and `buildGlobeRadarVolumeMesh` with pre-allocated array variants. Port existing tests from `apps/web/src/renderers/*.test.ts`.
- **Route Handlers**: Unit tests with mocked Redis/S3 clients.
- **Workers**: Test the geometry functions directly (they are pure functions that don't depend on the Worker runtime).
- **Integration**: Manual testing with Docker Compose running the full stack.

## Migration Order

1. Scaffold the Next.js app with project config, Cesium asset handling, and Docker setup.
2. Port server-side code: `lib/redis.ts`, `lib/storage.ts`, all Route Handlers.
3. Port and optimize geometry builders with pre-allocated arrays (pure functions, easy to test).
4. Create Web Workers wrapping the geometry builders.
5. Port client components: ControlPanel, StatusStrip, RadarViewer, GlobeView, LocalView.
6. Port hooks: useRadarData (update API base to relative `/api/`*), useWorker.
7. Wire everything together in page.tsx and layout.tsx.
8. Update Docker Compose and verify full stack.
9. Delete `apps/web/` and `apps/api/`.
10. Update root package.json workspace scripts.

