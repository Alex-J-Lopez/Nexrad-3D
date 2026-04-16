"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RadarSite, RadarVolumeMeta } from "@nexrad-3d/contracts";
import { PointCloudRenderer } from "@/renderers/local/PointCloudRenderer";
import { useWorker } from "@/hooks/useWorker";

// NWS colorbar gradient stops [fraction 0–1, hex color]
const COLORBAR_STOPS: Array<[number, string]> = [
  [0, "#66ccff"],
  [0.083, "#0099ff"],
  [0.167, "#00ff00"],
  [0.25, "#00cc00"],
  [0.333, "#009900"],
  [0.417, "#ffff00"],
  [0.5, "#ffcc00"],
  [0.583, "#ff9900"],
  [0.667, "#ff0000"],
  [0.75, "#cc0000"],
  [0.833, "#990000"],
  [0.917, "#ff00ff"],
  [1.0, "#cc00cc"],
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

interface LocalViewProps {
  data: Float32Array | null;
  metadata: RadarVolumeMeta | null;
  site: RadarSite | null;
  thresholdDbz: number;
  onThresholdChange: (value: number) => void;
  /** When false, threshold slider is omitted (e.g. threshold lives in header for globe view). */
  showThresholdControls?: boolean;
}

interface PointCloudWorkerResult {
  type: "result" | "error";
  positions?: Float32Array;
  colors?: Float32Array;
  pointCount?: number;
  message?: string;
}

export function LocalView({
  data,
  metadata,
  site,
  thresholdDbz,
  onThresholdChange,
  showThresholdControls = true,
}: LocalViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorbarRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PointCloudRenderer | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [pointCount, setPointCount] = useState(0);

  // Memoize worker factory
  const pointCloudWorkerFactory = useMemo(
    () => () => new Worker(new URL("../workers/pointCloudWorker", import.meta.url)),
    []
  );

  const handlePointCloudResult = useCallback((result: PointCloudWorkerResult) => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    if (result.type === "result" && result.positions && result.colors && result.pointCount !== undefined) {
      const count = renderer.updateFromWorkerResult(result.positions, result.colors, result.pointCount);
      setPointCount(count);
    } else if (result.type === "error") {
      console.error("[LocalView] point cloud worker error:", result.message);
      setPointCount(0);
    }
  }, []);

  const { postMessage: postPointCloudMessage } = useWorker<unknown, PointCloudWorkerResult>(
    pointCloudWorkerFactory,
    handlePointCloudResult
  );

  useEffect(() => {
    if (!canvasRef.current) return;
    const renderer = new PointCloudRenderer(canvasRef.current);
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

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

  useEffect(() => {
    if (colorbarRef.current) paintColorbar(colorbarRef.current);
  }, []);

  useEffect(() => {
    if (!data || !metadata) {
      setPointCount(0);
      return;
    }

    // Post to worker (transfer data)
    const dataCopy = data.slice();
    postPointCloudMessage(
      { type: "build", data: dataCopy, metadata, thresholdDbz },
      [dataCopy.buffer]
    );
  }, [data, metadata, thresholdDbz, postPointCloudMessage]);

  const handleToggleSpin = useCallback(() => {
    if (!rendererRef.current) return;
    setSpinning(rendererRef.current.toggleSpin());
  }, []);

  const handleReset = useCallback(() => {
    rendererRef.current?.resetCamera();
  }, []);

  const sweepCount = metadata?.sweeps.length ?? 0;
  const firstElev = metadata?.sweeps[0]?.elevationAngleDegrees ?? 0;
  const lastElev = metadata?.sweeps[metadata?.sweeps.length - 1]?.elevationAngleDegrees ?? 0;
  const siteId = site?.id ?? metadata?.siteId ?? "—";
  const siteName = site?.name ?? "";

  return (
    <div className="radar-view">
      <canvas ref={canvasRef} className="radar-canvas" />

      <div className="rv-overlay rv-top-left">
        <div className="rv-site-line">
          <span className="rv-site-id">{siteId}</span>
          {siteName ? <span className="rv-site-name">{siteName}</span> : null}
        </div>
        <div className="rv-hint">
          {pointCount > 0
            ? `${pointCount.toLocaleString()} pts · drag rotate · scroll zoom`
            : "drag to rotate · scroll to zoom"}
        </div>
      </div>

      {metadata ? (
        <div className="rv-overlay rv-top-right">
          <div className="rv-tilt-count">{sweepCount} tilts</div>
          <div className="rv-elev-range">
            {firstElev.toFixed(1)}° – {lastElev.toFixed(1)}°
          </div>
        </div>
      ) : null}

      <div className="rv-overlay rv-bottom-left">
        <canvas ref={colorbarRef} className="rv-colorbar" width={140} height={10} />
        <div className="rv-colorbar-labels">
          <span>15 dBZ</span>
          <span>45</span>
          <span>75+</span>
        </div>
      </div>

      <div className="rv-overlay rv-bottom-right">
        {showThresholdControls ? (
          <>
            <label className="rv-thresh-label" htmlFor="rv-thresh">
              threshold
            </label>
            <input
              id="rv-thresh"
              type="range"
              className="rv-thresh-slider"
              min={0}
              max={80}
              step={1}
              value={thresholdDbz}
              onChange={(e) => onThresholdChange(Number.parseInt(e.target.value, 10))}
            />
            <span className="rv-thresh-value">{thresholdDbz} dBZ</span>
          </>
        ) : null}
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
