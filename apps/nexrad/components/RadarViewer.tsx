"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  VolumeProduct,
  radarSiteForVolume,
  type RadarSite,
  type RadarVolumeMeta,
} from "@nexrad-3d/contracts";
import {
  ControlPanel,
  type RadarDisplayMode,
  type VisibleLowestTiltCount,
} from "./ControlPanel";
import { StatusStrip } from "./StatusStrip";
import { useRadarData } from "@/hooks/useRadarData";
import { loadVolumeArtifact } from "@/renderers/shared/volumeLoader";
import { buildVolumeSweepSubset } from "@/renderers/shared/volumeSweepSubset";

// Dynamic imports with ssr: false for WebGL components
const GlobeView = dynamic(() => import("./GlobeView").then((m) => ({ default: m.GlobeView })), {
  ssr: false,
  loading: () => <div className="cesium-viewer-host" />,
});

const LocalView = dynamic(() => import("./LocalView").then((m) => ({ default: m.LocalView })), {
  ssr: false,
  loading: () => <div className="radar-view" />,
});

interface RadarViewerProps {
  initialSites: RadarSite[];
}

export function RadarViewer({ initialSites: _initialSites }: RadarViewerProps) {
  const [selectedSiteId, setSelectedSiteId] = useState<string | undefined>(undefined);
  const [selectedProduct, setSelectedProduct] = useState<VolumeProduct>(
    VolumeProduct.REFLECTIVITY
  );
  const [displayMode, setDisplayMode] = useState<RadarDisplayMode>("globe");
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
  const [visibleLowestTiltCount, setVisibleLowestTiltCount] =
    useState<VisibleLowestTiltCount>("all");

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

  const selectedSiteRef = useRef(selectedSite);
  selectedSiteRef.current = selectedSite;

  const activeTimestamp = activeVolume?.generatedAtMs;

  useEffect(() => {
    if (!selectedSiteId && sites.length > 0) {
      setSelectedSiteId(sites[0].id);
      return;
    }

    if (selectedSiteId && !sites.some((s) => s.id === selectedSiteId) && sites.length > 0) {
      setSelectedSiteId(sites[0].id);
    }
  }, [selectedSiteId, sites]);

  useEffect(() => {
    if (liveFollow) {
      setTimelineIndex(0);
      return;
    }

    setTimelineIndex((prev) => Math.min(prev, Math.max(timeline.length - 1, 0)));
  }, [liveFollow, timeline.length]);

  useEffect(() => {
    let cancelled = false;

    async function resolveActiveVolume(): Promise<void> {
      if (!selectedSiteId) {
        setActiveVolume(null);
        return;
      }

      // Index 0 is newest-in-timeline; use the latest endpoint result (may be fresher than frame metadata).
      if (timelineIndex === 0) {
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
      if (!cancelled) {
        setActiveVolume(resolved);
      }
    }

    void resolveActiveVolume();

    return () => {
      cancelled = true;
    };
  }, [fetchVolumeById, latestVolume, selectedSiteId, timeline, timelineIndex]);

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
    return () => {
      cancelled = true;
    };
  }, [activeVolume]);

  useEffect(() => {
    setVisibleLowestTiltCount("all");
  }, [activeVolume?.volumeId]);

  useEffect(() => {
    const n = activeVolume?.sweeps.length ?? 0;
    if (visibleLowestTiltCount === "all") {
      return;
    }
    if (n <= 1 || visibleLowestTiltCount > n - 1) {
      setVisibleLowestTiltCount("all");
    }
  }, [activeVolume?.sweeps.length, visibleLowestTiltCount]);

  const renderedVolume = useMemo(() => {
    if (!activeVolume || !loadedVolumeData) {
      return null;
    }
    const n = activeVolume.sweeps.length;
    const keep = visibleLowestTiltCount === "all" ? n : visibleLowestTiltCount;
    return buildVolumeSweepSubset(activeVolume, loadedVolumeData.data, keep);
  }, [activeVolume, loadedVolumeData, visibleLowestTiltCount]);

  /** Prefer Level-II Volume-block antenna coords over catalog (KNOWN_SITES) for drawing. */
  const volumeMetaForPlacement = renderedVolume?.metadata ?? activeVolume;
  const siteForRendering = useMemo(
    () => radarSiteForVolume(selectedSite, volumeMetaForPlacement),
    [selectedSite, volumeMetaForPlacement]
  );

  const statusText = useMemo(() => {
    if (renderError) {
      return renderError;
    }

    if (error) {
      return error;
    }

    if (isLoading) {
      return "Loading radar state";
    }

    if (!activeVolume) {
      return "Waiting for radar volume";
    }

    return "Rendering volume preview";
  }, [activeVolume, error, isLoading, renderError]);

  const decodeMode = activeVolume?.decodeMode;
  const isApproximateDecode = decodeMode === "bootstrap-byte-map";

  const decodeStatusText = useMemo(() => {
    if (!activeVolume) {
      return "Decode: waiting for volume";
    }

    if (decodeMode === "bootstrap-byte-map") {
      return "Decode: approximate byte map (full radial decode unavailable for this file/product)";
    }

    if (decodeMode === "decoded") {
      return "Decode: full radial decode";
    }

    return "Decode: full radial decode";
  }, [activeVolume, decodeMode]);

  return (
    <div className="app">
      <div className="app-body">
        <aside className="app-sidebar" aria-label="Radar controls">
          <div className="sidebar-brand">
            <h1 className="sidebar-title">Nexrad 3D</h1>
            <p className="sidebar-tagline">Volumetric radar — globe or local 3D</p>
          </div>

          <ControlPanel
            sites={sites}
            selectedSiteId={selectedSiteId}
            selectedProduct={selectedProduct}
            liveFollow={liveFollow}
            displayMode={displayMode}
            onDisplayModeChange={setDisplayMode}
            thresholdDbz={thresholdDbz}
            onThresholdChange={setThresholdDbz}
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
            onTimelineIndexChange={(index) => {
              setTimelineIndex(index);
              if (index !== 0) {
                setLiveFollow(false);
              }
            }}
            onRefresh={() => {
              void refresh();
            }}
            visibleLowestTiltCount={visibleLowestTiltCount}
            onVisibleLowestTiltCountChange={setVisibleLowestTiltCount}
            volumeSweepCount={activeVolume?.sweeps.length ?? 0}
          />
        </aside>

        <div className="app-main">
          <StatusStrip
            statusText={statusText}
            renderSource={renderSource}
            decodeStatusText={decodeStatusText}
            isApproximateDecode={isApproximateDecode}
            frameCount={timeline.length}
          />

          <div className="main-view">
            {displayMode === "local" ? (
              <LocalView
                data={renderedVolume?.data ?? null}
                metadata={renderedVolume?.metadata ?? null}
                site={siteForRendering}
                thresholdDbz={thresholdDbz}
                onThresholdChange={setThresholdDbz}
                showThresholdControls
              />
            ) : (
              <GlobeView
                site={siteForRendering}
                mapSites={sites}
                selectedSiteId={selectedSiteId}
                onSiteSelect={setSelectedSiteId}
                metadata={renderedVolume?.metadata ?? null}
                data={renderedVolume?.data ?? null}
                thresholdDbz={thresholdDbz}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
