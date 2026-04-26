"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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
import type { RenderingQuality } from "@/renderers/shared/radarVolumeNode";

import type { MapStyle } from "./GlobeView";

// Dynamic imports with ssr: false for WebGL components
const GlobeView = dynamic(
  () => import("./GlobeView").then((m) => ({ default: m.GlobeView })),
  {
    ssr: false,
    loading: () => <div className="radar-view-placeholder" />,
  },
);

const LocalView = dynamic(
  () => import("./LocalView").then((m) => ({ default: m.LocalView })),
  {
    ssr: false,
    loading: () => <div className="radar-view" />,
  },
);

interface RadarViewerProps {
  initialSites: RadarSite[];
}

export function RadarViewer({ initialSites: _initialSites }: RadarViewerProps) {
  const [selectedSiteId, setSelectedSiteId] = useState<string | undefined>(
    undefined,
  );
  const [selectedProduct, setSelectedProduct] = useState<VolumeProduct>(
    VolumeProduct.REFLECTIVITY,
  );
  const [displayMode, setDisplayMode] = useState<RadarDisplayMode>("globe");
  const [activeVolume, setActiveVolume] = useState<RadarVolumeMeta | null>(
    null,
  );
  const [renderSource, setRenderSource] = useState<
    "artifact" | "synthetic" | null
  >(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [loadedVolumeData, setLoadedVolumeData] = useState<{
    data: Float32Array;
    source: "artifact" | "synthetic";
  } | null>(null);
  const [thresholdDbz, setThresholdDbz] = useState(15);
  const [mapStyle, setMapStyle] = useState<MapStyle>("dark");
  const [visibleLowestTiltCount, setVisibleLowestTiltCount] =
    useState<VisibleLowestTiltCount>("all");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [renderingQuality, setRenderingQuality] = useState<RenderingQuality>("high");
  const [showFlights, setShowFlights] = useState(false);

  const {
    sites,
    latestVolume,
    isLoading,
    isRefreshing,
    error,
    refresh,
  } = useRadarData({
    siteId: selectedSiteId,
    product: selectedProduct,
  });

  const selectedSite = useMemo(
    () => sites.find((s) => s.id === selectedSiteId),
    [selectedSiteId, sites],
  );

  const selectedSiteRef = useRef(selectedSite);
  selectedSiteRef.current = selectedSite;

  const activeTimestamp = latestVolume?.generatedAtMs;

  useEffect(() => {
    if (typeof window !== "undefined" && /Mobi|Android/i.test(window.navigator.userAgent)) {
      setRenderingQuality("medium");
    }
  }, []);

  // Load preferences from local storage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedSiteId = localStorage.getItem("nexrad_selectedSiteId");
      if (storedSiteId) {
        setSelectedSiteId(storedSiteId);
      }
      
      const storedProduct = localStorage.getItem("nexrad_selectedProduct") as VolumeProduct;
      if (storedProduct && Object.values(VolumeProduct).includes(storedProduct)) {
        setSelectedProduct(storedProduct);
      }
      
      const storedThreshold = localStorage.getItem("nexrad_thresholdDbz");
      if (storedThreshold && !isNaN(Number(storedThreshold))) {
        setThresholdDbz(Number(storedThreshold));
      }
      
      const storedMapStyle = localStorage.getItem("nexrad_mapStyle") as MapStyle;
      if (storedMapStyle) {
        setMapStyle(storedMapStyle);
      }

      const storedShowFlights = localStorage.getItem("nexrad_showFlights");
      if (storedShowFlights) {
        setShowFlights(storedShowFlights === "true");
      }
    }
  }, []);

  // Save preferences to local storage
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (selectedSiteId) localStorage.setItem("nexrad_selectedSiteId", selectedSiteId);
      localStorage.setItem("nexrad_selectedProduct", selectedProduct);
      localStorage.setItem("nexrad_thresholdDbz", thresholdDbz.toString());
      localStorage.setItem("nexrad_mapStyle", mapStyle);
      localStorage.setItem("nexrad_showFlights", showFlights.toString());
    }
  }, [selectedSiteId, selectedProduct, thresholdDbz, mapStyle, showFlights]);

  useEffect(() => {
    if (!selectedSiteId && sites.length > 0) {
      setSelectedSiteId(sites[0].id);
      return;
    }

    if (
      selectedSiteId &&
      !sites.some((s) => s.id === selectedSiteId) &&
      sites.length > 0
    ) {
      setSelectedSiteId(sites[0].id);
    }
  }, [selectedSiteId, sites]);

  useEffect(() => {
    if (!selectedSiteId) {
      setActiveVolume(null);
      return;
    }
    setActiveVolume(latestVolume || null);
  }, [latestVolume, selectedSiteId]);

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
    [selectedSite, volumeMetaForPlacement],
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
        {/* Mobile sidebar overlay backdrop */}
        {isSidebarOpen && (
          <div
            className="mobile-sidebar-backdrop"
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
          />
        )}
        <aside
          className={`app-sidebar ${isSidebarOpen ? "open" : ""}`}
          aria-label="Radar controls"
        >
          <div className="sidebar-brand">
            <div className="sidebar-header-row">
              <h1 className="sidebar-title">Nexrad 3D</h1>
              <button
                className="mobile-sidebar-close"
                onClick={() => setIsSidebarOpen(false)}
                aria-label="Close controls"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <p className="sidebar-tagline">
              Volumetric radar — globe or local 3D<br/>
              <Link href="/info" className="info-link">How it works</Link>
              <span style={{ margin: "0 8px", color: "gray" }}>|</span>
              <Link href="/health" className="info-link">Health Dashboard</Link>
            </p>
          </div>

          <ControlPanel
            sites={sites}
            selectedSiteId={selectedSiteId}
            selectedProduct={selectedProduct}
            displayMode={displayMode}
            onDisplayModeChange={setDisplayMode}
            thresholdDbz={thresholdDbz}
            onThresholdChange={setThresholdDbz}
            activeGeneratedAtMs={activeTimestamp}
            isRefreshing={isRefreshing}
            onSiteChange={setSelectedSiteId}
            onProductChange={(next) => {
              setSelectedProduct(next);
            }}
            onRefresh={() => {
              void refresh();
            }}
            visibleLowestTiltCount={visibleLowestTiltCount}
            onVisibleLowestTiltCountChange={setVisibleLowestTiltCount}
            volumeSweepCount={activeVolume?.sweeps.length ?? 0}
            renderingQuality={renderingQuality}
            onRenderingQualityChange={setRenderingQuality}
            mapStyle={mapStyle}
            onMapStyleChange={setMapStyle}
            showFlights={showFlights}
            onShowFlightsChange={setShowFlights}
          />
        </aside>

        <div className="app-main">
          <div className="mobile-header">
            <button
              className="mobile-sidebar-toggle"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open controls"
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>
            <span className="mobile-header-title">Nexrad 3D</span>
          </div>
          <StatusStrip
            statusText={statusText}
            renderSource={renderSource}
            decodeStatusText={decodeStatusText}
            isApproximateDecode={isApproximateDecode}
            frameCount={activeVolume ? 1 : 0}
          />

          <div className="main-view">
            {displayMode === "local" ? (
              <LocalView
                data={renderedVolume?.data ?? null}
                metadata={renderedVolume?.metadata ?? null}
                site={siteForRendering}
                thresholdDbz={thresholdDbz}
                renderingQuality={renderingQuality}
                onThresholdChange={setThresholdDbz}
                showThresholdControls
                showFlights={showFlights}
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
                renderingQuality={renderingQuality}
                mapStyle={mapStyle}
                showFlights={showFlights}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
