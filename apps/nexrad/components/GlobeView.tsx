"use client";

import "@/lib/cesiumBootstrap";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Cesium from "cesium";
import type { RadarSite, RadarVolumeMeta } from "@nexrad-3d/contracts";
import { GlobeRadarLayer } from "@/renderers/globe/GlobeRadarLayer";
import type { GlobeRadarRenderMode } from "@/renderers/globe/globeRadarRenderStrategy";
import { flyCameraToRadarSite, wireHomeButtonToRadarSite } from "@/renderers/globe/cesiumViewerControls";
import { useWorker } from "@/hooks/useWorker";
import type { GlobeRadarUpdateOptions } from "@/renderers/globe/globeRadarRenderStrategy";

interface GlobeViewProps {
  site: RadarSite | null;
  /** Midwest (or configured) sites shown as map pins; clicking selects the radar. */
  mapSites: RadarSite[];
  selectedSiteId?: string;
  onSiteSelect?: (siteId: string) => void;
  metadata: RadarVolumeMeta | null;
  data: Float32Array | null;
  thresholdDbz: number;
  renderMode: GlobeRadarRenderMode;
  options?: GlobeRadarUpdateOptions;
  onRenderModeChange: (mode: GlobeRadarRenderMode) => void;
}

interface MeshWorkerResult {
  type: "result" | "empty" | "error";
  positions?: Float64Array;
  colors?: Uint8Array;
  indices?: Uint32Array;
  message?: string;
}

export function GlobeView({
  site,
  mapSites,
  selectedSiteId,
  onSiteSelect,
  metadata,
  data,
  thresholdDbz,
  renderMode,
  options,
  onRenderModeChange: _onRenderModeChange,
}: GlobeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const layerRef = useRef<GlobeRadarLayer | null>(null);
  const sitesDataSourceRef = useRef<Cesium.CustomDataSource | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const renderModeRef = useRef(renderMode);
  renderModeRef.current = renderMode;
  const siteRef = useRef(site);
  siteRef.current = site;
  const mapSitesRef = useRef(mapSites);
  mapSitesRef.current = mapSites;
  const onSiteSelectRef = useRef(onSiteSelect);
  onSiteSelectRef.current = onSiteSelect;

  // Memoize worker factory so useWorker doesn't restart on re-renders
  const meshWorkerFactory = useMemo(
    () => () => new Worker(new URL("../workers/meshWorker", import.meta.url)),
    []
  );

  const handleMeshResult = useCallback((result: MeshWorkerResult) => {
    const layer = layerRef.current;
    if (!layer || !siteRef.current) return;

    if (result.type === "result" && result.positions && result.colors && result.indices) {
      layer.updateFromWorkerResult(result.positions, result.colors, result.indices, siteRef.current);
    } else if (result.type === "empty") {
      layer.clear();
    } else if (result.type === "error") {
      console.error("[GlobeView] mesh worker error:", result.message);
    }
  }, []);

  const { postMessage: postMeshMessage } = useWorker<unknown, MeshWorkerResult>(
    meshWorkerFactory,
    handleMeshResult
  );

  // Create Cesium Viewer on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const viewer = new Cesium.Viewer(containerRef.current, {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
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

    const unwireHome = wireHomeButtonToRadarSite(viewer, () => siteRef.current);
    const layer = new GlobeRadarLayer(viewer, renderModeRef.current);

    const sitesDs = new Cesium.CustomDataSource("nexrad-site-pins");
    void viewer.dataSources.add(sitesDs);
    sitesDataSourceRef.current = sitesDs;

    const pickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    pickHandler.setInputAction((click: { position: Cesium.Cartesian2 }) => {
      const picked = viewer.scene.pick(click.position);
      if (!Cesium.defined(picked) || picked.id === undefined) {
        return;
      }
      const entity = picked.id;
      if (!(entity instanceof Cesium.Entity)) {
        return;
      }
      const id = entity.id;
      if (typeof id !== "string") {
        return;
      }
      const allowed = new Set(mapSitesRef.current.map((s) => s.id));
      if (!allowed.has(id)) {
        return;
      }
      onSiteSelectRef.current?.(id);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    viewerRef.current = viewer;
    layerRef.current = layer;
    setViewerReady(true);

    return () => {
      setViewerReady(false);
      pickHandler.destroy();
      unwireHome();
      if (sitesDataSourceRef.current) {
        void viewer.dataSources.remove(sitesDataSourceRef.current, true);
        sitesDataSourceRef.current = null;
      }
      layerRef.current = null;
      viewerRef.current = null;
      layer.destroy();
      viewer.destroy();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!viewerReady) {
      return;
    }
    const viewer = viewerRef.current;
    const ds = sitesDataSourceRef.current;
    if (!viewer || !ds) {
      return;
    }

    ds.entities.removeAll();

    for (const s of mapSites) {
      if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) {
        continue;
      }
      const selected = s.id === selectedSiteId;
      const alt = Number.isFinite(s.elevationMeters) ? Math.max(0, s.elevationMeters) : 0;
      ds.entities.add({
        id: s.id,
        position: Cesium.Cartesian3.fromDegrees(s.longitude, s.latitude, alt),
        point: {
          pixelSize: selected ? 14 : 9,
          color: selected
            ? Cesium.Color.LIMEGREEN
            : Cesium.Color.CYAN.withAlpha(0.9),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: s.id,
          font: "11px system-ui, sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
  }, [viewerReady, mapSites, selectedSiteId]);

  // Sync render mode
  useEffect(() => {
    layerRef.current?.setRenderMode(renderMode);
  }, [renderMode]);

  // Update radar layer when data changes
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !site || !metadata || !data) {
      layer?.clear();
      return;
    }

    if (renderMode === "mesh") {
      // Extract ENU-to-ECEF matrix for the worker
      const radarAlt = Number.isFinite(site.elevationMeters) ? Math.max(0, site.elevationMeters) : 0;
      const center = Cesium.Cartesian3.fromDegrees(site.longitude, site.latitude, radarAlt);
      const enuToEcef = Cesium.Transforms.eastNorthUpToFixedFrame(center);
      const enuToEcefMatrix = Array.from(enuToEcef);

      const totalCells = metadata.sweeps.reduce((s, sw) => s + sw.azimuthBins * sw.radialBins, 0);
      const stride = options?.fullResolution ? 1 : Math.max(1, Math.ceil(Math.sqrt(totalCells / 380_000)));

      // Transfer data to worker (zero-copy)
      const dataCopy = data.slice();
      postMeshMessage(
        { type: "build", data: dataCopy, metadata, thresholdDbz, stride, enuToEcefMatrix },
        [dataCopy.buffer]
      );
    } else {
      // Points mode builds on main thread
      layer.update(site, metadata, data, thresholdDbz, options);
    }
  }, [site, metadata, data, thresholdDbz, renderMode, options, postMeshMessage]);

  // Fly to site on site change
  useEffect(() => {
    if (!viewerRef.current || !site) return;
    if (!Number.isFinite(site.latitude) || !Number.isFinite(site.longitude)) return;
    flyCameraToRadarSite(viewerRef.current, site);
  }, [site?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} className="cesium-viewer-host" style={{ width: "100%", height: "100%" }} />;
}
