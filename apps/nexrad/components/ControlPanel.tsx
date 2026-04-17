"use client";

import { VolumeProduct, type RadarSite, type TimelineFrame } from "@nexrad-3d/contracts";
type GlobeRadarRenderMode = "volumetric" | "points" | "mesh";

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
  globeRenderMode: GlobeRadarRenderMode;
  onGlobeRenderModeChange: (mode: GlobeRadarRenderMode) => void;
  globeFullResolution: boolean;
  onGlobeFullResolutionChange: (enabled: boolean) => void;
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
}

const productOptions = Object.values(VolumeProduct);

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
    globeRenderMode,
    onGlobeRenderModeChange,
    globeFullResolution,
    onGlobeFullResolutionChange,
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
  } = props;

  const maxTimelineIndex = Math.max(timeline.length - 1, 0);
  const normalizedTimelineIndex = Math.min(timelineIndex, maxTimelineIndex);
  const selectedFrame = timeline[normalizedTimelineIndex];
  const displayedTimestamp = selectedFrame?.generatedAtMs || activeGeneratedAtMs;

  const tiltSelectValue =
    visibleLowestTiltCount === "all" ? "all" : String(visibleLowestTiltCount);

  return (
    <div className="controls-panel">
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
          <span className="control-label">Product</span>
          <select
            className="control-input"
            value={selectedProduct}
            onChange={(event) => {
              onProductChange(event.target.value as VolumeProduct);
            }}
          >
            {productOptions.map((productOption) => (
              <option key={productOption} value={productOption}>
                {productOption}
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
            <span className="control-label">Globe style</span>
            <select
              className="control-input"
              value={globeRenderMode}
              onChange={(event) => {
                onGlobeRenderModeChange(event.target.value as GlobeRadarRenderMode);
              }}
            >
              <option value="mesh">Mesh</option>
              <option value="points">Point cloud</option>
              <option value="volumetric">Volumetric cloud</option>
            </select>
          </label>
        ) : null}

        {displayMode === "globe" ? (
          <label className="toggle-field" htmlFor="globe-full-resolution">
            <input
              id="globe-full-resolution"
              type="checkbox"
              checked={globeFullResolution}
              onChange={(event) => {
                onGlobeFullResolutionChange(event.target.checked);
              }}
            />
            <span>Full resolution (globe)</span>
          </label>
        ) : null}

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
