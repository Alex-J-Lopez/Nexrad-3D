# Point Cloud Primary Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Cesium globe with the existing Three.js point cloud renderer as the full-screen primary view, matching the HTML reference file's dark overlay UI.

**Architecture:** The existing `PointCloudRenderer` and `VolumePanel` already implement the Three.js rendering correctly — they just live as a small secondary panel under the Cesium globe. This plan promotes the point cloud to the primary full-height view via a new `RadarView` component, strips Cesium entirely (package, vite config, imports), and adds the on-canvas overlays from the HTML reference (site info, tilt/elev range, NWS colorbar, threshold slider).

**Tech Stack:** React 18, Three.js 0.160, TypeScript, Vitest, Vite 5

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| **Create** | `apps/web/src/renderers/pointCloudArrays.ts` | Pure function: build positions+colors Float32Arrays from volume data, returns point count |
| **Create** | `apps/web/src/renderers/pointCloudArrays.test.ts` | Unit tests for the pure array builder |
| **Create** | `apps/web/src/components/RadarView.tsx` | Full-screen canvas + absolute overlay UI (replaces VolumePanel) |
| **Modify** | `apps/web/src/renderers/pointCloudRenderer.ts` | Call `buildPointArrays`; `updateVolume` returns `number` (point count) |
| **Modify** | `apps/web/src/App.tsx` | Remove Cesium; remove `VolumetricRenderer`; remove `quality`; render `<RadarView>` |
| **Modify** | `apps/web/src/App.css` | Remove `.cesium-container` / `.volume-panel*`; add `.radar-view` full-height style |
| **Modify** | `apps/web/src/components/RadarControls.tsx` | Remove `quality`, `onQualityChange`, `thresholdDbz`, `onThresholdChange` (threshold moves into `RadarView`) |
| **Modify** | `apps/web/vite.config.ts` | Remove `viteStaticCopy` Cesium targets; remove `CESIUM_BASE_URL` define; remove Cesium from `optimizeDeps` |
| **Delete** | `apps/web/src/components/VolumePanel.tsx` | Superseded by `RadarView.tsx` |

---

## Task 1: Extract pure `buildPointArrays` function

The current `PointCloudRenderer.updateVolume` mixes geometry math with WebGL calls, making it untestable. Pull the math out into a pure function so it can be unit-tested without a canvas.

**Files:**
- Create: `apps/web/src/renderers/pointCloudArrays.ts`
- Create: `apps/web/src/renderers/pointCloudArrays.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/renderers/pointCloudArrays.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildPointArrays } from "./pointCloudArrays.js";
import type { RadarVolumeMeta } from "@nexrad-3d/contracts";
import { VolumeProduct } from "@nexrad-3d/contracts";

function makeMeta(overrides: Partial<RadarVolumeMeta> = {}): RadarVolumeMeta {
  return {
    volumeId: "test-001",
    siteId: "KMKX",
    product: VolumeProduct.REFLECTIVITY,
    generatedAtMs: 0,
    sweeps: [
      { sweepIndex: 0, elevationAngleDegrees: 0.5, azimuthBins: 4, radialBins: 3 },
    ],
    radialBinSizeMeters: 250,
    minRange: 0,
    maxRange: 750,
    minValueDb: -32,
    maxValueDb: 75,
    noDataValue: -9999,
    storageKey: "",
    ...overrides,
  };
}

describe("buildPointArrays", () => {
  it("returns empty arrays when all values are below threshold", () => {
    const meta = makeMeta();
    // 4 azimuths × 3 radials = 12 cells, all 10 dBZ (below 15 threshold)
    const data = new Float32Array(12).fill(10);
    const { positions, colors, pointCount } = buildPointArrays(data, meta, 15);
    expect(pointCount).toBe(0);
    expect(positions.length).toBe(0);
    expect(colors.length).toBe(0);
  });

  it("returns empty arrays when all values are noData", () => {
    const meta = makeMeta();
    const data = new Float32Array(12).fill(-9999);
    const { pointCount } = buildPointArrays(data, meta, 15);
    expect(pointCount).toBe(0);
  });

  it("counts only cells at or above threshold", () => {
    const meta = makeMeta();
    // 4 azimuths × 3 radials = 12 cells
    const data = new Float32Array(12).fill(-9999);
    // Place 3 cells above threshold: azimuth 0 radials 0,1,2
    data[0] = 40; // az=0, r=0
    data[1] = 50; // az=0, r=1
    data[2] = 20; // az=0, r=2 — above 15 threshold
    data[3] = 10; // az=1, r=0 — below threshold, skipped
    const { pointCount } = buildPointArrays(data, meta, 15);
    expect(pointCount).toBe(3);
  });

  it("positions array length is 3× pointCount", () => {
    const meta = makeMeta();
    const data = new Float32Array(12).fill(40);
    const { positions, pointCount } = buildPointArrays(data, meta, 15);
    expect(positions.length).toBe(pointCount * 3);
  });

  it("colors array length is 3× pointCount", () => {
    const meta = makeMeta();
    const data = new Float32Array(12).fill(40);
    const { colors, pointCount } = buildPointArrays(data, meta, 15);
    expect(colors.length).toBe(pointCount * 3);
  });

  it("increasing threshold reduces point count", () => {
    const meta = makeMeta();
    const data = new Float32Array(12);
    for (let i = 0; i < 12; i++) data[i] = 10 + i * 5; // 10,15,20,25,...65
    const low = buildPointArrays(data, meta, 15).pointCount;
    const high = buildPointArrays(data, meta, 45).pointCount;
    expect(high).toBeLessThan(low);
  });

  it("accumulates cells across multiple sweeps", () => {
    const meta = makeMeta({
      sweeps: [
        { sweepIndex: 0, elevationAngleDegrees: 0.5, azimuthBins: 2, radialBins: 2 },
        { sweepIndex: 1, elevationAngleDegrees: 1.5, azimuthBins: 2, radialBins: 2 },
      ],
    });
    // 4 cells per sweep, 8 total, all 40 dBZ
    const data = new Float32Array(8).fill(40);
    const { pointCount } = buildPointArrays(data, meta, 15);
    expect(pointCount).toBe(8);
  });

  it("Y (height) coordinate increases with elevation angle", () => {
    const lowMeta = makeMeta({
      sweeps: [{ sweepIndex: 0, elevationAngleDegrees: 0.5, azimuthBins: 1, radialBins: 1 }],
    });
    const highMeta = makeMeta({
      sweeps: [{ sweepIndex: 0, elevationAngleDegrees: 10, azimuthBins: 1, radialBins: 1 }],
    });
    const data = new Float32Array([40]);
    const lowY = buildPointArrays(data, lowMeta, 15).positions[1];
    const highY = buildPointArrays(data, highMeta, 15).positions[1];
    expect(highY).toBeGreaterThan(lowY);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd apps/web && npm test -- --run pointCloudArrays
```

Expected: `Cannot find module './pointCloudArrays.js'`

- [ ] **Step 3: Create `pointCloudArrays.ts`**

Create `apps/web/src/renderers/pointCloudArrays.ts`:

```typescript
import type { RadarVolumeMeta } from "@nexrad-3d/contracts";
import { nwsColor, projectBeamSample } from "./radarGeometry.js";

const HEIGHT_SCALE = 3;

export interface PointArrays {
  positions: Float32Array;
  colors: Float32Array;
  pointCount: number;
}

/**
 * Pure function: converts packed volume Float32Array into Three.js-ready
 * position (X,Y,Z km) and color (R,G,B 0–1) arrays.
 * No WebGL or Three.js dependency — safe to unit test.
 */
export function buildPointArrays(
  data: Float32Array,
  metadata: RadarVolumeMeta,
  thresholdDbz: number
): PointArrays {
  const positions: number[] = [];
  const colors: number[] = [];
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

        positions.push(rangeKm * sinAz, heightKm, rangeKm * cosAz);
        const [r, g, b] = nwsColor(sample);
        colors.push(r, g, b);
      }
    }

    dataOffset += azimuthBins * radialBins;
  }

  const pointCount = positions.length / 3;
  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    pointCount,
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/web && npm test -- --run pointCloudArrays
```

Expected: All 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/renderers/pointCloudArrays.ts apps/web/src/renderers/pointCloudArrays.test.ts
git commit -m "feat(renderer): extract pure buildPointArrays for testable geometry math"
```

---

## Task 2: Update `PointCloudRenderer` to use `buildPointArrays` and return point count

**Files:**
- Modify: `apps/web/src/renderers/pointCloudRenderer.ts`

- [ ] **Step 1: Replace the `updateVolume` body and change return type to `number`**

Replace the entire `updateVolume` method and the `HEIGHT_SCALE` constant (it moves to `pointCloudArrays.ts`). The full updated file:

```typescript
import * as THREE from "three";
import type { RadarVolumeMeta } from "@nexrad-3d/contracts";
import { buildPointArrays } from "./pointCloudArrays.js";

const RANGE_RING_RADII_KM = [50, 100, 150];
const RING_SEGMENTS = 128;
const POINT_SIZE = 1.8;
const BACKGROUND_COLOR = 0x070a12;

export class PointCloudRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private points: THREE.Points | null = null;
  private animFrameId: number | null = null;
  private spherical = { theta: -0.4, phi: 1.1, r: 230 };
  private isDragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private lastTouchDist = 0;
  private spinning = false;

  private readonly boundMouseDown: (e: MouseEvent) => void;
  private readonly boundMouseMove: (e: MouseEvent) => void;
  private readonly boundMouseUp: () => void;
  private readonly boundWheel: (e: WheelEvent) => void;
  private readonly boundTouchStart: (e: TouchEvent) => void;
  private readonly boundTouchMove: (e: TouchEvent) => void;
  private readonly boundTouchEnd: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const w = canvas.clientWidth || 700;
    const h = canvas.clientHeight || 520;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.setClearColor(BACKGROUND_COLOR, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 2000);
    this.updateCamera();

    this.addGroundDisk();
    this.addRangeRings();

    this.boundMouseDown = (e) => {
      this.isDragging = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    };
    this.boundMouseMove = (e) => {
      if (!this.isDragging) return;
      this.spherical.theta -= (e.clientX - this.lastPointerX) * 0.008;
      this.spherical.phi = Math.max(
        0.2,
        Math.min(1.5, this.spherical.phi + (e.clientY - this.lastPointerY) * 0.006)
      );
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.updateCamera();
    };
    this.boundMouseUp = () => {
      this.isDragging = false;
    };
    this.boundWheel = (e) => {
      this.spherical.r = Math.max(80, Math.min(500, this.spherical.r + e.deltaY * 0.3));
      this.updateCamera();
      e.preventDefault();
    };
    this.boundTouchStart = (e) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.lastPointerX = e.touches[0].clientX;
        this.lastPointerY = e.touches[0].clientY;
      }
      if (e.touches.length === 2) {
        this.lastTouchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
      e.preventDefault();
    };
    this.boundTouchMove = (e) => {
      if (e.touches.length === 1 && this.isDragging) {
        this.spherical.theta -= (e.touches[0].clientX - this.lastPointerX) * 0.01;
        this.spherical.phi = Math.max(
          0.2,
          Math.min(1.5, this.spherical.phi + (e.touches[0].clientY - this.lastPointerY) * 0.008)
        );
        this.lastPointerX = e.touches[0].clientX;
        this.lastPointerY = e.touches[0].clientY;
        this.updateCamera();
      }
      if (e.touches.length === 2) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        this.spherical.r = Math.max(
          80,
          Math.min(500, this.spherical.r - (d - this.lastTouchDist) * 0.5)
        );
        this.lastTouchDist = d;
        this.updateCamera();
      }
      e.preventDefault();
    };
    this.boundTouchEnd = () => {
      this.isDragging = false;
    };

    canvas.addEventListener("mousedown", this.boundMouseDown);
    window.addEventListener("mousemove", this.boundMouseMove);
    window.addEventListener("mouseup", this.boundMouseUp);
    canvas.addEventListener("wheel", this.boundWheel, { passive: false });
    canvas.addEventListener("touchstart", this.boundTouchStart, { passive: false });
    canvas.addEventListener("touchmove", this.boundTouchMove, { passive: false });
    canvas.addEventListener("touchend", this.boundTouchEnd);

    this.startRenderLoop();
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  toggleSpin(): boolean {
    this.spinning = !this.spinning;
    return this.spinning;
  }

  resetCamera(): void {
    this.spherical = { theta: -0.4, phi: 1.1, r: 230 };
    this.updateCamera();
  }

  /** Returns the number of points rendered (0 if nothing passes threshold). */
  updateVolume(data: Float32Array, metadata: RadarVolumeMeta, thresholdDbz: number): number {
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      (this.points.material as THREE.Material).dispose();
      this.points = null;
    }

    const { positions, colors, pointCount } = buildPointArrays(data, metadata, thresholdDbz);

    if (pointCount === 0) return 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: POINT_SIZE,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
    });

    this.points = new THREE.Points(geo, mat);
    this.scene.add(this.points);
    return pointCount;
  }

  dispose(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.canvas.removeEventListener("mousedown", this.boundMouseDown);
    window.removeEventListener("mousemove", this.boundMouseMove);
    window.removeEventListener("mouseup", this.boundMouseUp);
    this.canvas.removeEventListener("wheel", this.boundWheel);
    this.canvas.removeEventListener("touchstart", this.boundTouchStart);
    this.canvas.removeEventListener("touchmove", this.boundTouchMove);
    this.canvas.removeEventListener("touchend", this.boundTouchEnd);
    if (this.points) {
      this.points.geometry.dispose();
      (this.points.material as THREE.Material).dispose();
    }
    this.renderer.dispose();
  }

  private updateCamera(): void {
    this.camera.position.set(
      this.spherical.r * Math.sin(this.spherical.phi) * Math.sin(this.spherical.theta),
      this.spherical.r * Math.cos(this.spherical.phi) + 20,
      this.spherical.r * Math.sin(this.spherical.phi) * Math.cos(this.spherical.theta)
    );
    this.camera.lookAt(0, 20, 0);
  }

  private addRangeRings(): void {
    for (const rkm of RANGE_RING_RADII_KM) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= RING_SEGMENTS; i++) {
        const a = (i / RING_SEGMENTS) * 2 * Math.PI;
        pts.push(new THREE.Vector3(rkm * Math.cos(a), 0, rkm * Math.sin(a)));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.scene.add(
        new THREE.Line(
          geo,
          new THREE.LineBasicMaterial({ color: 0x1e3050, transparent: true, opacity: 0.5 })
        )
      );
    }
  }

  private addGroundDisk(): void {
    const geo = new THREE.CircleGeometry(155, 128);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x1a2035,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.4,
    });
    const disk = new THREE.Mesh(geo, mat);
    disk.rotation.x = -Math.PI / 2;
    disk.position.y = -0.5;
    this.scene.add(disk);
  }

  private startRenderLoop(): void {
    const animate = () => {
      this.animFrameId = requestAnimationFrame(animate);
      if (this.spinning) {
        this.spherical.theta += 0.005;
        this.updateCamera();
      }
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }
}
```

- [ ] **Step 2: Run existing tests to confirm nothing broke**

```bash
cd apps/web && npm test -- --run
```

Expected: All tests pass (the `pointCloudArrays` tests from Task 1 still pass; radarGeometry tests still pass).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/renderers/pointCloudRenderer.ts
git commit -m "feat(renderer): updateVolume returns point count, delegates math to buildPointArrays"
```

---

## Task 3: Create `RadarView.tsx` — full-screen canvas with overlays

This replaces `VolumePanel`. It renders a Three.js canvas that fills all remaining viewport height, with four absolute-positioned overlay zones matching the HTML reference file:

- **Top-left:** Site ID + city name + "drag to rotate" / live point count
- **Top-right:** Tilt count + elevation range
- **Bottom-left:** NWS color bar (140×10 px canvas) + dBZ labels
- **Bottom-right:** dBZ threshold range input + reset + spin buttons

**Files:**
- Create: `apps/web/src/components/RadarView.tsx`

- [ ] **Step 1: Create `RadarView.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { RadarSite, RadarVolumeMeta } from "@nexrad-3d/contracts";
import { PointCloudRenderer } from "../renderers/pointCloudRenderer.js";

interface RadarViewProps {
  data: Float32Array | null;
  metadata: RadarVolumeMeta | null;
  site: RadarSite | null;
  thresholdDbz: number;
  onThresholdChange: (value: number) => void;
}

// NWS colorbar gradient stops [fraction 0–1, hex color]
const COLORBAR_STOPS: Array<[number, string]> = [
  [0,     "#66ccff"],
  [0.083, "#0099ff"],
  [0.167, "#00ff00"],
  [0.250, "#00cc00"],
  [0.333, "#009900"],
  [0.417, "#ffff00"],
  [0.500, "#ffcc00"],
  [0.583, "#ff9900"],
  [0.667, "#ff0000"],
  [0.750, "#cc0000"],
  [0.833, "#990000"],
  [0.917, "#ff00ff"],
  [1.000, "#cc00cc"],
];

function paintColorbar(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
  for (const [stop, color] of COLORBAR_STOPS) {
    grad.addColorStop(stop, color);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

export function RadarView({
  data,
  metadata,
  site,
  thresholdDbz,
  onThresholdChange,
}: RadarViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorbarRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PointCloudRenderer | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [pointCount, setPointCount] = useState(0);

  // Mount renderer
  useEffect(() => {
    if (!canvasRef.current) return;
    const renderer = new PointCloudRenderer(canvasRef.current);
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        rendererRef.current?.resize(width, height);
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Paint colorbar once on mount
  useEffect(() => {
    if (colorbarRef.current) paintColorbar(colorbarRef.current);
  }, []);

  // Update point cloud whenever data, metadata, or threshold changes
  useEffect(() => {
    if (!rendererRef.current || !data || !metadata) {
      setPointCount(0);
      return;
    }
    const count = rendererRef.current.updateVolume(data, metadata, thresholdDbz);
    setPointCount(count);
  }, [data, metadata, thresholdDbz]);

  const handleToggleSpin = useCallback(() => {
    if (!rendererRef.current) return;
    setSpinning(rendererRef.current.toggleSpin());
  }, []);

  const handleReset = useCallback(() => {
    rendererRef.current?.resetCamera();
  }, []);

  const sweepCount = metadata?.sweeps.length ?? 0;
  const firstElev = metadata?.sweeps[0]?.elevationAngleDegrees ?? 0;
  const lastElev = metadata?.sweeps[metadata.sweeps.length - 1]?.elevationAngleDegrees ?? 0;
  const siteId = site?.id ?? metadata?.siteId ?? "—";
  const siteName = site?.name ?? "";

  return (
    <div className="radar-view">
      <canvas ref={canvasRef} className="radar-canvas" />

      {/* Top-left: site info + hint */}
      <div className="rv-overlay rv-top-left">
        <div className="rv-site-line">
          <span className="rv-site-id">{siteId}</span>
          {siteName && <span className="rv-site-name">{siteName}</span>}
        </div>
        <div className="rv-hint">
          {pointCount > 0
            ? `${pointCount.toLocaleString()} pts · drag rotate · scroll zoom`
            : "drag to rotate · scroll to zoom"}
        </div>
      </div>

      {/* Top-right: tilt + elevation range */}
      {metadata && (
        <div className="rv-overlay rv-top-right">
          <div className="rv-tilt-count">{sweepCount} tilts</div>
          <div className="rv-elev-range">
            {firstElev.toFixed(1)}° – {lastElev.toFixed(1)}°
          </div>
        </div>
      )}

      {/* Bottom-left: NWS colorbar */}
      <div className="rv-overlay rv-bottom-left">
        <canvas ref={colorbarRef} className="rv-colorbar" width={140} height={10} />
        <div className="rv-colorbar-labels">
          <span>15 dBZ</span>
          <span>45</span>
          <span>75+</span>
        </div>
      </div>

      {/* Bottom-right: threshold + controls */}
      <div className="rv-overlay rv-bottom-right">
        <label className="rv-thresh-label">threshold</label>
        <input
          type="range"
          className="rv-thresh-slider"
          min={0}
          max={80}
          step={1}
          value={thresholdDbz}
          onChange={(e) => onThresholdChange(Number.parseInt(e.target.value, 10))}
        />
        <span className="rv-thresh-value">{thresholdDbz} dBZ</span>
        <div className="rv-btn-row">
          <button type="button" className="rv-btn" onClick={handleReset}>
            reset
          </button>
          <button
            type="button"
            className={spinning ? "rv-btn rv-btn-active" : "rv-btn"}
            onClick={handleToggleSpin}
          >
            {spinning ? "stop" : "spin"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npm run typecheck
```

Expected: No errors. (Three.js types are already installed, `@types/three` is in devDependencies.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/RadarView.tsx
git commit -m "feat(ui): add RadarView full-screen component with on-canvas overlays"
```

---

## Task 4: Update `App.css` — restyle for full-height radar view

**Files:**
- Modify: `apps/web/src/App.css`

- [ ] **Step 1: Replace the Cesium and VolumePanel CSS blocks, add RadarView styles**

Remove the `.cesium-container` block and the entire `/* ── Three.js Volume Panel */` section. Replace with:

```css
/* ── Radar View (full-height Three.js canvas) ─────────────── */
.radar-view {
  flex: 1;
  min-height: 0;
  position: relative;
  background: #070a12;
  overflow: hidden;
  user-select: none;
}

.radar-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

/* Shared overlay base */
.rv-overlay {
  position: absolute;
  font-family: monospace;
  pointer-events: none;
  line-height: 1.6;
}

/* Top-left: site info */
.rv-top-left {
  top: 12px;
  left: 14px;
  color: #9ab;
  font-size: 11px;
}

.rv-site-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.rv-site-id {
  color: #fff;
  font-size: 13px;
  font-weight: 500;
}

.rv-site-name {
  color: #5af;
  font-size: 11px;
}

.rv-hint {
  font-size: 10px;
  color: #789;
}

/* Top-right: tilt/elevation info */
.rv-top-right {
  top: 12px;
  right: 14px;
  text-align: right;
  color: #789;
  font-size: 10px;
}

.rv-tilt-count {
  color: #cde;
  font-size: 11px;
}

.rv-elev-range {
  color: #789;
  font-size: 10px;
}

/* Bottom-left: colorbar */
.rv-bottom-left {
  bottom: 12px;
  left: 14px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.rv-colorbar {
  border-radius: 2px;
  display: block;
}

.rv-colorbar-labels {
  display: flex;
  justify-content: space-between;
  width: 140px;
  font-size: 9px;
  color: #678;
}

/* Bottom-right: threshold controls */
.rv-bottom-right {
  bottom: 12px;
  right: 14px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  pointer-events: all;
}

.rv-thresh-label {
  font-size: 10px;
  color: #789;
}

.rv-thresh-slider {
  width: 100px;
  accent-color: #5af;
}

.rv-thresh-value {
  font-size: 9px;
  color: #678;
}

.rv-btn-row {
  display: flex;
  gap: 4px;
}

.rv-btn {
  font-size: 10px;
  padding: 3px 8px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.05);
  color: #9ab;
  border: 0.5px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  font-family: monospace;
  transition: color 120ms ease, border-color 120ms ease;
}

.rv-btn-active {
  color: #5af;
  border-color: rgba(85, 170, 255, 0.4);
}
```

Also remove the `.quality-readout` rule from `App.css` (it will no longer be used after Task 5).

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/App.css
git commit -m "style: replace cesium-container and volume-panel CSS with radar-view overlays"
```

---

## Task 5: Update `App.tsx` — remove Cesium, render `RadarView`

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Rewrite `App.tsx`**

Replace the entire file:

```tsx
import { useEffect, useMemo, useState } from "react";
import { VolumeProduct, type RadarVolumeMeta } from "@nexrad-3d/contracts";
import { RadarControls } from "./components/RadarControls.js";
import { RadarView } from "./components/RadarView.js";
import { useRadarData } from "./hooks/useRadarData.js";
import { loadVolumeArtifact } from "./renderers/volumeLoader.js";
import "./App.css";

export function App() {
  const [selectedSiteId, setSelectedSiteId] = useState<string | undefined>(undefined);
  const [selectedProduct, setSelectedProduct] = useState<VolumeProduct>(
    VolumeProduct.REFLECTIVITY
  );
  const [liveFollow, setLiveFollow] = useState(true);
  const [timelineIndex, setTimelineIndex] = useState(0);
  const [activeVolume, setActiveVolume] = useState<RadarVolumeMeta | null>(null);
  const [renderSource, setRenderSource] = useState<"artifact" | "synthetic" | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [loadedVolumeData, setLoadedVolumeData] = useState<{
    data: Float32Array;
    source: "artifact" | "synthetic";
  } | null>(null);
  const [thresholdDbz, setThresholdDbz] = useState(15);

  const {
    sites,
    timeline,
    latestVolume,
    isLoading,
    isRefreshing,
    error,
    refresh,
    fetchVolumeById,
  } = useRadarData({
    siteId: selectedSiteId,
    product: selectedProduct,
  });

  const selectedSite = useMemo(
    () => sites.find((s) => s.id === selectedSiteId),
    [selectedSiteId, sites]
  );

  const activeTimestamp = activeVolume?.generatedAtMs;

  // Auto-select first site
  useEffect(() => {
    if (!selectedSiteId && sites.length > 0) {
      setSelectedSiteId(sites[0].id);
      return;
    }
    if (selectedSiteId && !sites.some((s) => s.id === selectedSiteId) && sites.length > 0) {
      setSelectedSiteId(sites[0].id);
    }
  }, [selectedSiteId, sites]);

  // Keep timeline index in bounds
  useEffect(() => {
    if (liveFollow) {
      setTimelineIndex(0);
      return;
    }
    setTimelineIndex((prev) => Math.min(prev, Math.max(timeline.length - 1, 0)));
  }, [liveFollow, timeline.length]);

  // Resolve active volume from live or timeline
  useEffect(() => {
    let cancelled = false;

    async function resolveActiveVolume(): Promise<void> {
      if (!selectedSiteId) {
        setActiveVolume(null);
        return;
      }
      if (liveFollow || timelineIndex === 0) {
        setActiveVolume(latestVolume);
        return;
      }
      if (timeline.length === 0) {
        setActiveVolume(latestVolume);
        return;
      }
      const frame = timeline[Math.min(timelineIndex, timeline.length - 1)];
      if (!frame) {
        setActiveVolume(latestVolume);
        return;
      }
      if (latestVolume && frame.volumeId === latestVolume.volumeId) {
        setActiveVolume(latestVolume);
        return;
      }
      const resolved = await fetchVolumeById(frame.volumeId);
      if (!cancelled) setActiveVolume(resolved);
    }

    void resolveActiveVolume();
    return () => { cancelled = true; };
  }, [fetchVolumeById, latestVolume, liveFollow, selectedSiteId, timeline, timelineIndex]);

  // Load Float32 volume data whenever the active volume changes
  useEffect(() => {
    let cancelled = false;

    async function loadData(): Promise<void> {
      if (!activeVolume) {
        setLoadedVolumeData(null);
        return;
      }
      try {
        const loaded = await loadVolumeArtifact(activeVolume);
        if (!cancelled) {
          setLoadedVolumeData({ data: loaded.data, source: loaded.source });
          setRenderSource(loaded.source);
          setRenderError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setRenderError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    void loadData();
    return () => { cancelled = true; };
  }, [activeVolume]);

  const statusText = useMemo(() => {
    if (renderError) return renderError;
    if (error) return error;
    if (isLoading) return "Loading radar state";
    if (!activeVolume) return "Waiting for radar volume";
    return "Rendering volume preview";
  }, [activeVolume, error, isLoading, renderError]);

  const effectiveDecodeMode = activeVolume?.decodeMode ?? "bootstrap-byte-map";
  const isApproximateDecode = !!activeVolume && effectiveDecodeMode === "bootstrap-byte-map";

  const decodeStatusText = useMemo(() => {
    if (!activeVolume) return "Decode: waiting for volume";
    if (effectiveDecodeMode === "bootstrap-byte-map") {
      return "Decode: bootstrap byte map (not full NEXRAD reflectivity decode)";
    }
    return "Decode: full radial decode";
  }, [activeVolume, effectiveDecodeMode]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-copy">
          <h1>NextRadWeb</h1>
          <p>Volumetric radar — 3D point cloud</p>
        </div>

        <RadarControls
          sites={sites}
          selectedSiteId={selectedSiteId}
          selectedProduct={selectedProduct}
          liveFollow={liveFollow}
          timeline={timeline}
          timelineIndex={timelineIndex}
          activeGeneratedAtMs={activeTimestamp}
          isRefreshing={isRefreshing}
          onSiteChange={setSelectedSiteId}
          onProductChange={(next) => {
            setSelectedProduct(next);
            setLiveFollow(true);
            setTimelineIndex(0);
          }}
          onLiveFollowChange={setLiveFollow}
          onTimelineIndexChange={setTimelineIndex}
          onRefresh={() => { void refresh(); }}
        />
      </header>

      <section className="status-strip">
        <span className="status-pill">{statusText}</span>
        <span className="status-pill">Source: {renderSource ?? "none"}</span>
        <span className={isApproximateDecode ? "status-pill status-pill-warning" : "status-pill"}>
          {decodeStatusText}
        </span>
        <span className="status-pill">Frames: {timeline.length}</span>
      </section>

      <RadarView
        data={loadedVolumeData?.data ?? null}
        metadata={activeVolume}
        site={selectedSite ?? null}
        thresholdDbz={thresholdDbz}
        onThresholdChange={setThresholdDbz}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npm run typecheck
```

Expected: Errors about `quality` / `onQualityChange` / `thresholdDbz` / `onThresholdChange` no longer being passed to `RadarControls` — these will be fixed in Task 6.

- [ ] **Step 3: Commit (do not build yet)**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(app): remove Cesium, render RadarView as primary full-screen view"
```

---

## Task 6: Update `RadarControls.tsx` — remove quality and threshold props

**Files:**
- Modify: `apps/web/src/components/RadarControls.tsx`

- [ ] **Step 1: Rewrite `RadarControls.tsx` without quality and threshold**

```tsx
import { VolumeProduct, type RadarSite, type TimelineFrame } from "@nexrad-3d/contracts";

interface RadarControlsProps {
  sites: RadarSite[];
  selectedSiteId?: string;
  selectedProduct: VolumeProduct;
  liveFollow: boolean;
  timeline: TimelineFrame[];
  timelineIndex: number;
  activeGeneratedAtMs?: number;
  isRefreshing: boolean;
  onSiteChange: (siteId: string) => void;
  onProductChange: (product: VolumeProduct) => void;
  onLiveFollowChange: (isEnabled: boolean) => void;
  onTimelineIndexChange: (value: number) => void;
  onRefresh: () => void;
}

const productOptions = Object.values(VolumeProduct);

function formatTimestamp(timestampMs?: number): string {
  if (!timestampMs) return "No frame loaded";
  return new Date(timestampMs).toLocaleString();
}

export function RadarControls(props: RadarControlsProps) {
  const {
    sites,
    selectedSiteId,
    selectedProduct,
    liveFollow,
    timeline,
    timelineIndex,
    activeGeneratedAtMs,
    isRefreshing,
    onSiteChange,
    onProductChange,
    onLiveFollowChange,
    onTimelineIndexChange,
    onRefresh,
  } = props;

  const maxTimelineIndex = Math.max(timeline.length - 1, 0);
  const normalizedTimelineIndex = Math.min(timelineIndex, maxTimelineIndex);
  const selectedFrame = timeline[normalizedTimelineIndex];
  const displayedTimestamp = selectedFrame?.generatedAtMs || activeGeneratedAtMs;

  return (
    <div className="controls-panel">
      <div className="controls-row">
        <label className="control-field">
          <span className="control-label">Site</span>
          <select
            className="control-input"
            value={selectedSiteId || ""}
            onChange={(e) => onSiteChange(e.target.value)}
          >
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.id} – {site.name}
              </option>
            ))}
          </select>
        </label>

        <label className="control-field">
          <span className="control-label">Product</span>
          <select
            className="control-input"
            value={selectedProduct}
            onChange={(e) => onProductChange(e.target.value as VolumeProduct)}
          >
            {productOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>

        <label className="toggle-field" htmlFor="live-follow">
          <input
            id="live-follow"
            type="checkbox"
            checked={liveFollow}
            onChange={(e) => onLiveFollowChange(e.target.checked)}
          />
          <span>Live follow</span>
        </label>

        <button
          type="button"
          className="refresh-button"
          disabled={isRefreshing}
          onClick={onRefresh}
        >
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="controls-row controls-row-tight">
        <label className="control-field control-grow">
          <span className="control-label">Timeline</span>
          <input
            className="control-input-range"
            type="range"
            min={0}
            max={maxTimelineIndex}
            step={1}
            value={normalizedTimelineIndex}
            disabled={timeline.length === 0}
            onChange={(e) => onTimelineIndexChange(Number.parseInt(e.target.value, 10))}
          />
        </label>

        <span className="frame-readout">Frame: {formatTimestamp(displayedTimestamp)}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck the full web app**

```bash
cd apps/web && npm run typecheck
```

Expected: Zero TypeScript errors.

- [ ] **Step 3: Run all tests**

```bash
cd apps/web && npm test -- --run
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/RadarControls.tsx
git commit -m "refactor(controls): remove quality and threshold props — threshold lives in RadarView overlay"
```

---

## Task 7: Remove Cesium dependency and delete `VolumePanel.tsx`

**Files:**
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/package.json` (via npm uninstall)
- Delete: `apps/web/src/components/VolumePanel.tsx`

- [ ] **Step 1: Remove Cesium from `vite.config.ts`**

Replace the entire file:

```typescript
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  envDir: "../..",
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
  },
});
```

- [ ] **Step 2: Uninstall Cesium**

```bash
cd apps/web && npm uninstall cesium vite-plugin-static-copy
```

Expected: `package.json` no longer lists `cesium` or `vite-plugin-static-copy` in dependencies.

- [ ] **Step 3: Delete `VolumePanel.tsx`**

```bash
rm apps/web/src/components/VolumePanel.tsx
```

- [ ] **Step 4: Verify `VolumePanel` is not imported anywhere**

```bash
rg "VolumePanel" apps/web/src/
```

Expected: No output (zero matches).

- [ ] **Step 5: Confirm the dev build starts cleanly**

```bash
cd apps/web && npm run dev
```

Expected: Vite starts on port 5173 with no errors. Open `http://localhost:5173` and verify:
- Full-height dark Three.js canvas is the primary view
- Top-left shows site ID + name
- Bottom-left shows NWS colorbar
- Bottom-right shows threshold slider + reset + spin
- Drag/scroll/pinch controls work
- Spin button animates the scene
- Threshold slider filters points live

- [ ] **Step 6: Run all tests one final time**

```bash
cd apps/web && npm test -- --run
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/vite.config.ts apps/web/package.json
git rm apps/web/src/components/VolumePanel.tsx
git commit -m "chore: remove Cesium dependency and VolumePanel — point cloud is now the sole renderer"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Three.js point cloud as full-screen primary view — Task 3/5
- ✅ Remove Cesium entirely — Task 7
- ✅ dBZ threshold slider in on-canvas overlay — Task 3
- ✅ Spin + reset buttons in on-canvas overlay — Task 3
- ✅ NWS colorbar matching HTML reference — Task 3/4
- ✅ Site ID + city name overlay — Task 3
- ✅ Live point count display — Tasks 1/2/3
- ✅ Tilt count + elevation range overlay — Task 3
- ✅ Drag/scroll/touch controls (already in `PointCloudRenderer`) — unchanged

**Placeholder scan:** None found — every step has real code.

**Type consistency check:**
- `buildPointArrays` returns `{ positions, colors, pointCount }` — used in Task 1 test and Task 2 renderer
- `PointCloudRenderer.updateVolume` returns `number` — used in `RadarView.tsx` `setPointCount(count)`
- `RadarView` props: `{ data, metadata, site, thresholdDbz, onThresholdChange }` — matches `App.tsx` usage exactly
- `RadarControls` no longer has `quality`, `onQualityChange`, `thresholdDbz`, `onThresholdChange` — `App.tsx` does not pass them
