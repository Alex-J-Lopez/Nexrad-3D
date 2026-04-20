"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { RadarSite, RadarVolumeMeta } from "@nexrad-3d/contracts";
import { MaplibreRadarLayer } from "../renderers/globe/MaplibreRadarLayer";
import type { RenderingQuality } from "../renderers/shared/radarVolumeNode";

export type MapStyle = "dark" | "light" | "satellite";

export const MAP_STYLES: Record<MapStyle, { tiles: string[], attribution: string }> = {
  dark: {
    tiles: [
      "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    ],
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  light: {
    tiles: [
      "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    ],
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  satellite: {
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
  }
};

interface GlobeViewProps {
  site: RadarSite | null;
  mapSites: RadarSite[];
  selectedSiteId?: string;
  onSiteSelect?: (siteId: string) => void;
  metadata: RadarVolumeMeta | null;
  data: Float32Array | null;
  thresholdDbz: number;
  renderingQuality?: RenderingQuality;
  mapStyle?: MapStyle;
}

export function GlobeView({
  site,
  mapSites,
  selectedSiteId,
  onSiteSelect,
  metadata,
  data,
  thresholdDbz,
  renderingQuality = "high",
  mapStyle = "dark",
}: GlobeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const layerRef = useRef<MaplibreRadarLayer | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const siteRef = useRef(site);
  siteRef.current = site;
  const onSiteSelectRef = useRef(onSiteSelect);
  onSiteSelectRef.current = onSiteSelect;

  // Create MapLibre map on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          "base-map": {
            type: "raster",
            tiles: MAP_STYLES[mapStyle].tiles,
            tileSize: 256,
            attribution: MAP_STYLES[mapStyle].attribution,
          },
        },
        layers: [
          {
            id: "background",
            type: "background",
            paint: {
              "background-color": "#070a12", // dark stormy blue/black
            },
          },
          {
            id: "base-map-layer",
            type: "raster",
            source: "base-map",
            minzoom: 0,
            maxzoom: 20,
          },
        ],
      },
      center: [-98.5795, 39.8283],
      zoom: 3,
      pitch: 45,
      maxPitch: 85,
    });

    map.on("load", () => {
      const layer = new MaplibreRadarLayer();
      map.addLayer(layer);
      layerRef.current = layer;
      setMapReady(true);
    });

    map.on("click", (e) => {
      // Basic picking
    });

    mapRef.current = map;

    return () => {
      setMapReady(false);
      layerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Handle MapStyle changes
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    if (map.getLayer("base-map-layer")) map.removeLayer("base-map-layer");
    if (map.getSource("base-map")) map.removeSource("base-map");

    map.addSource("base-map", {
      type: "raster",
      tiles: MAP_STYLES[mapStyle].tiles,
      tileSize: 256,
      attribution: MAP_STYLES[mapStyle].attribution,
    });

    map.addLayer(
      {
        id: "base-map-layer",
        type: "raster",
        source: "base-map",
        minzoom: 0,
        maxzoom: 20,
      },
      "radar-volume-layer" // Insert beneath our radar layer
    );
  }, [mapStyle, mapReady]);

  // Update radar layer when data changes
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !site || !metadata || !data) {
      layer?.clear();
      return;
    }

    layer.update(site, metadata, data, thresholdDbz, renderingQuality);
  }, [site, metadata, data, thresholdDbz, renderingQuality]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
