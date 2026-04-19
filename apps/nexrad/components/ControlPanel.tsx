"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { VolumeProduct, VOLUME_PRODUCT_DEFINITIONS, type RadarSite, type TimelineFrame } from "@nexrad-3d/contracts";
import type { RenderingQuality } from "@/renderers/shared/radarVolumeNode";

export type RadarDisplayMode = "globe" | "local";

/** How many lowest-elevation tilts to include, or full volume. */
export type VisibleLowestTiltCount = number | "all";

interface ControlPanelProps {
  sites: RadarSite[];
  selectedSiteId?: string;
  selectedProduct: VolumeProduct;
  liveFollow: boolean;
  displayMode: RadarDisplayMode;
  onDisplayModeChange: (mode: RadarDisplayMode) => void;
  thresholdDbz: number;
  onThresholdChange: (value: number) => void;
  timeline: TimelineFrame[];
  timelineIndex: number;
  activeGeneratedAtMs?: number;
  isRefreshing: boolean;
  onSiteChange: (siteId: string) => void;
  onProductChange: (product: VolumeProduct) => void;
  onLiveFollowChange: (isEnabled: boolean) => void;
  onTimelineIndexChange: (value: number) => void;
  onRefresh: () => void;
  visibleLowestTiltCount: VisibleLowestTiltCount;
  onVisibleLowestTiltCountChange: (value: VisibleLowestTiltCount) => void;
  volumeSweepCount: number;
  renderingQuality: RenderingQuality;
  onRenderingQualityChange: (quality: RenderingQuality) => void;
}

function formatTimestamp(timestampMs?: number): string {
  if (!timestampMs) {
    return "No frame loaded";
  }

  return new Date(timestampMs).toLocaleString();
}

export function ControlPanel(props: ControlPanelProps) {
  const {
    sites,
    selectedSiteId,
    selectedProduct,
    liveFollow,
    displayMode,
    onDisplayModeChange,
    thresholdDbz,
    onThresholdChange,
    timeline,
    timelineIndex,
    activeGeneratedAtMs,
    isRefreshing,
    onSiteChange,
    onProductChange,
    onLiveFollowChange,
    onTimelineIndexChange,
    onRefresh,
    visibleLowestTiltCount,
    onVisibleLowestTiltCountChange,
    volumeSweepCount,
    renderingQuality,
    onRenderingQualityChange,
  } = props;

  const maxTimelineIndex = Math.max(timeline.length - 1, 0);
  const normalizedTimelineIndex = Math.min(timelineIndex, maxTimelineIndex);
  const selectedFrame = timeline[normalizedTimelineIndex];
  const displayedTimestamp = selectedFrame?.generatedAtMs || activeGeneratedAtMs;

  const tiltSelectValue =
    visibleLowestTiltCount === "all" ? "all" : String(visibleLowestTiltCount);

  const [isInfoModalOpen, setInfoModalOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const modalContent = isInfoModalOpen && mounted ? createPortal(
    <div className="modal-overlay" onClick={() => setInfoModalOpen(false)}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Radar Data Types</h3>
          <button 
            type="button" 
            className="modal-close" 
            onClick={() => setInfoModalOpen(false)}
            title="Close"
          >
            &times;
          </button>
        </div>
        <div className="modal-body">
          <p>
            Radar sites emit radio waves and measure their return to determine atmospheric conditions. 
            Below is a short guide on interpreting the various products generated from these sweeps.
          </p>
          
          <h4>Reflectivity (REF)</h4>
          <p>
            Measures the amount of energy returned to the radar. Higher values (warm colors like reds and purples) generally indicate heavier precipitation, such as heavy rain or hail, while lower values (cool colors like greens and blues) suggest light rain or snow.
          </p>

          <h4>Velocity (VEL / VELD)</h4>
          <p>
            Measures the speed and direction of particles relative to the radar. Typically, green/blue colors mean wind/particles are moving <strong>toward</strong> the radar, while red/orange colors mean they are moving <strong>away</strong>. Where these colors tightly border each other, it can indicate rotation (mesocyclones).
          </p>

          <h4>Spectrum Width (SW)</h4>
          <p>
            Represents the variation in velocities within a given area. High spectrum width points to strong turbulence and diverse wind speeds (often found near severe weather boundaries or updrafts), whereas low spectrum width indicates uniform wind flow.
          </p>

          <h4>Correlation Coefficient (CC)</h4>
          <p>
            Measures how uniform the shape and size of radar targets are. Values near 1.0 (warm colors) indicate uniform targets like rain or snow. Lower values (cooler colors) suggest mixed targets such as birds, insects, ground clutter, or a mixture of rain, hail, and lofted tornadic debris (debris balls).
          </p>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className="controls-panel">
      {modalContent}

      <div className="sidebar-section">
        <div className="sidebar-section-title">Source</div>

        <label className="control-field">
          <span className="control-label">Site</span>
          <select
            className="control-input"
            value={selectedSiteId || ""}
            onChange={(event) => {
              onSiteChange(event.target.value);
            }}
          >
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.id} – {site.name}
              </option>
            ))}
          </select>
        </label>

        <label className="control-field">
          <span className="control-label">
            Product
            <button 
              type="button" 
              className="info-button" 
              onClick={() => setInfoModalOpen(true)}
              title="Learn about radar products"
            >
              &#9432;
            </button>
          </span>
          <select
            className="control-input"
            value={selectedProduct}
            onChange={(event) => {
              onProductChange(event.target.value as VolumeProduct);
            }}
          >
            {VOLUME_PRODUCT_DEFINITIONS.map((def) => (
              <option key={def.product} value={def.product}>
                {def.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="refresh-button"
          disabled={isRefreshing}
          onClick={onRefresh}
        >
          {isRefreshing ? "Refreshing…" : "Refresh data"}
        </button>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-title">Display</div>

        <label className="control-field">
          <span className="control-label">View</span>
          <select
            className="control-input"
            value={displayMode}
            onChange={(event) => {
              onDisplayModeChange(event.target.value as RadarDisplayMode);
            }}
          >
            <option value="globe">Globe (map + radar)</option>
            <option value="local">Local 3D</option>
          </select>
        </label>

        {displayMode === "globe" ? (
          <label className="control-field">
            <span className="control-label">Threshold ({thresholdDbz} dBZ)</span>
            <input
              className="control-input-range"
              type="range"
              min={0}
              max={80}
              step={1}
              value={thresholdDbz}
              onChange={(event) => {
                onThresholdChange(Number.parseInt(event.target.value, 10));
              }}
            />
          </label>
        ) : null}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-title">Volume</div>
        <p className="sidebar-hint">
          Limit to the lowest elevation tilts to emphasize nearer-surface echoes and peel away
          upper beams.
        </p>

        <label className="control-field">
          <span className="control-label">Tilts shown</span>
          <select
            className="control-input"
            value={tiltSelectValue}
            disabled={volumeSweepCount <= 1}
            onChange={(event) => {
              const raw = event.target.value;
              onVisibleLowestTiltCountChange(raw === "all" ? "all" : Number.parseInt(raw, 10));
            }}
          >
            <option value="all">
              All tilts{volumeSweepCount > 0 ? ` (${volumeSweepCount})` : ""}
            </option>
            {volumeSweepCount > 1
              ? Array.from({ length: volumeSweepCount - 1 }, (_, i) => {
                  const k = i + 1;
                  return (
                    <option key={k} value={String(k)}>
                      Lowest {k} tilt{k === 1 ? "" : "s"}
                    </option>
                  );
                })
              : null}
          </select>
        </label>

        <label className="control-field">
          <span className="control-label">Quality (LOD)</span>
          <select
            className="control-input"
            value={renderingQuality}
            onChange={(event) => {
              onRenderingQualityChange(event.target.value as RenderingQuality);
            }}
          >
            <option value="high">High (Trilinear, Full steps)</option>
            <option value="medium">Medium (Trilinear, Half steps)</option>
            <option value="low">Low (Nearest-neighbor, Low steps)</option>
          </select>
        </label>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-title">Time</div>

        <label className="toggle-field" htmlFor="live-follow">
          <input
            id="live-follow"
            type="checkbox"
            checked={liveFollow}
            onChange={(event) => {
              onLiveFollowChange(event.target.checked);
            }}
          />
          <span>Live follow (newest frame)</span>
        </label>

        <label className="control-field">
          <span className="control-label">Timeline</span>
          <input
            className="control-input-range"
            type="range"
            min={0}
            max={maxTimelineIndex}
            step={1}
            value={normalizedTimelineIndex}
            disabled={timeline.length === 0}
            onChange={(event) => {
              onTimelineIndexChange(Number.parseInt(event.target.value, 10));
            }}
          />
        </label>

        <p className="sidebar-readout">{formatTimestamp(displayedTimestamp)}</p>
      </div>
    </div>
  );
}
