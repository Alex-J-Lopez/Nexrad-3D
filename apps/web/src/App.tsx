import { useEffect, useMemo, useRef, useState } from "react";
import * as Cesium from "cesium";
import { VolumeProduct, type RadarVolumeMeta } from "@nexrad-3d/contracts";
import {
  RadarControls,
  type RadarDisplayMode,
  type VisibleLowestTiltCount,
} from "./components/RadarControls.js";
import { RadarView } from "./components/RadarView.js";
import { useRadarData } from "./hooks/useRadarData.js";
import { loadVolumeArtifact } from "./renderers/volumeLoader.js";
import { buildVolumeSweepSubset } from "./renderers/volumeSweepSubset.js";
import { GlobeRadarLayer, type GlobeRadarRenderMode } from "./renderers/cesiumGlobeLayer.js";
import {
  flyCameraToRadarSite,
  wireHomeButtonToRadarSite,
} from "./renderers/cesiumViewerControls.js";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./App.css";

const cesiumToken = import.meta.env.VITE_CESIUM_ION_TOKEN?.trim();
if (cesiumToken) {
  Cesium.Ion.defaultAccessToken = cesiumToken;
}

export function App() {
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
  const [globeRenderMode, setGlobeRenderMode] = useState<GlobeRadarRenderMode>("mesh");
  const [globeFullResolution, setGlobeFullResolution] = useState(false);
  const [visibleLowestTiltCount, setVisibleLowestTiltCount] =
    useState<VisibleLowestTiltCount>("all");

  const cesiumContainerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const globeLayerRef = useRef<GlobeRadarLayer | null>(null);
  const globeRenderModeRef = useRef(globeRenderMode);
  globeRenderModeRef.current = globeRenderMode;

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

  useEffect(() => {
    if (displayMode !== "globe" || !cesiumContainerRef.current) {
      return;
    }

    const container = cesiumContainerRef.current;
    const hasIon = Boolean(cesiumToken);

    const viewer = new Cesium.Viewer(container, {
      animation: false,
      timeline: false,
      baseLayerPicker: hasIon,
      geocoder: hasIon,
      homeButton: true,
      sceneModePicker: true,
      navigationHelpButton: true,
      fullscreenButton: true,
      navigationInstructionsInitiallyVisible: false,
      infoBox: false,
      selectionIndicator: false,
      baseLayer: new Cesium.ImageryLayer(
        new Cesium.OpenStreetMapImageryProvider({
          url: "https://tile.openstreetmap.org/",
        })
      ),
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    });

    viewer.scene.globe.depthTestAgainstTerrain = false;
    viewer.scene.globe.showGroundAtmosphere = true;

    const unwireHome = wireHomeButtonToRadarSite(viewer, () => selectedSiteRef.current);

    const layer = new GlobeRadarLayer(viewer, globeRenderModeRef.current);
    viewerRef.current = viewer;
    globeLayerRef.current = layer;

    return () => {
      unwireHome();
      globeLayerRef.current = null;
      viewerRef.current = null;
      layer.destroy();
      viewer.destroy();
    };
  }, [displayMode]);

  useEffect(() => {
    if (displayMode !== "globe") {
      return;
    }

    const layer = globeLayerRef.current;
    if (!layer) {
      return;
    }

    layer.setRenderMode(globeRenderMode);

    if (!selectedSite || !renderedVolume) {
      layer.clear();
      return;
    }

    layer.update(selectedSite, renderedVolume.metadata, renderedVolume.data, thresholdDbz, {
      fullResolution: globeFullResolution,
    });
  }, [
    displayMode,
    selectedSite,
    renderedVolume,
    thresholdDbz,
    globeRenderMode,
    globeFullResolution,
  ]);

  useEffect(() => {
    if (displayMode !== "globe" || !viewerRef.current || !selectedSite) {
      return;
    }

    if (!Number.isFinite(selectedSite.latitude) || !Number.isFinite(selectedSite.longitude)) {
      return;
    }

    flyCameraToRadarSite(viewerRef.current, selectedSite);
  }, [displayMode, selectedSite?.id, selectedSite?.latitude, selectedSite?.longitude]);

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

          <RadarControls
            sites={sites}
            selectedSiteId={selectedSiteId}
            selectedProduct={selectedProduct}
            liveFollow={liveFollow}
            displayMode={displayMode}
            onDisplayModeChange={setDisplayMode}
            globeRenderMode={globeRenderMode}
            onGlobeRenderModeChange={setGlobeRenderMode}
            globeFullResolution={globeFullResolution}
            onGlobeFullResolutionChange={setGlobeFullResolution}
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
          <section className="status-strip">
            <span className="status-pill">{statusText}</span>
            <span className="status-pill">Source: {renderSource ?? "none"}</span>
            <span
              className={
                isApproximateDecode ? "status-pill status-pill-warning" : "status-pill"
              }
            >
              {decodeStatusText}
            </span>
            <span className="status-pill">Frames: {timeline.length}</span>
          </section>

          <div className="main-view">
            {displayMode === "local" ? (
              <RadarView
                data={renderedVolume?.data ?? null}
                metadata={renderedVolume?.metadata ?? null}
                site={selectedSite ?? null}
                thresholdDbz={thresholdDbz}
                onThresholdChange={setThresholdDbz}
                showThresholdControls
              />
            ) : (
              <div ref={cesiumContainerRef} className="cesium-viewer-host" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
