"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { RadarSite, RadarVolumeMeta } from "@nexrad-3d/contracts";
import { MaplibreRadarLayer } from "../renderers/globe/MaplibreRadarLayer";

interface GlobeViewProps {
  site: RadarSite | null;
  mapSites: RadarSite[];
  selectedSiteId?: string;
  onSiteSelect?: (siteId: string) => void;
  metadata: RadarVolumeMeta | null;
  data: Float32Array | null;
  thresholdDbz: number;
}

export function GlobeView({
  site,
  mapSites,
  selectedSiteId,
  onSiteSelect,
  metadata,
  data,
  thresholdDbz,
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
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "&copy; OpenStreetMap Contributors",
          },
        },
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
            minzoom: 0,
            maxzoom: 19,
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

  // Update radar layer when data changes
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !site || !metadata || !data) {
      layer?.clear();
      return;
    }

    layer.update(site, metadata, data, thresholdDbz);
  }, [site, metadata, data, thresholdDbz]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
