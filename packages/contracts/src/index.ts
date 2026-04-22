/**
 * Shared runtime contracts for Nexrad 3D.
 * All services and UI use these types for schema consistency.
 */

// ============================================
// Domain Types
// ============================================

export enum VolumeProduct {
  REFLECTIVITY = "REF",
  VELOCITY = "VEL",
  SPECTRUM_WIDTH = "SW",
  DIFFERENTIAL_REFLECTIVITY = "ZDR",
  CORRELATION_COEFFICIENT = "RHO",
  DIFFERENTIAL_PHASE = "PHIDP",
}

/** Products the bundled NEXRAD Level-II decoder can extract when the moment exists in the file. */
export const LEVEL2_DECODABLE_VOLUME_PRODUCTS: readonly VolumeProduct[] = [
  VolumeProduct.REFLECTIVITY,
  VolumeProduct.VELOCITY,
  VolumeProduct.SPECTRUM_WIDTH,
  VolumeProduct.DIFFERENTIAL_REFLECTIVITY,
  VolumeProduct.CORRELATION_COEFFICIENT,
  VolumeProduct.DIFFERENTIAL_PHASE,
] as const;

export interface VolumeProductDefinition {
  product: VolumeProduct;
  /** Short UI / legend label */
  label: string;
  /** Level-II ingest attempts this product for each archive (skipped if the moment is missing). */
  level2DecodedIngest: boolean;
}

export const VOLUME_PRODUCT_DEFINITIONS: VolumeProductDefinition[] = [
  { product: VolumeProduct.REFLECTIVITY, label: "Reflectivity (dBZ)", level2DecodedIngest: true },
  { product: VolumeProduct.VELOCITY, label: "Radial velocity (m/s)", level2DecodedIngest: true },
  { product: VolumeProduct.SPECTRUM_WIDTH, label: "Spectrum width (m/s)", level2DecodedIngest: true },
  {
    product: VolumeProduct.DIFFERENTIAL_REFLECTIVITY,
    label: "Differential reflectivity (dB)",
    level2DecodedIngest: true,
  },
  {
    product: VolumeProduct.CORRELATION_COEFFICIENT,
    label: "Correlation coefficient",
    level2DecodedIngest: true,
  },
  {
    product: VolumeProduct.DIFFERENTIAL_PHASE,
    label: "Differential phase (deg)",
    level2DecodedIngest: true,
  },
];

/**
 * Parse API / env product token (case-insensitive) to a VolumeProduct enum value.
 */
export function parseVolumeProduct(input: string): VolumeProduct | null {
  if (!input) {
    return null;
  }
  const normalized = input.trim().toUpperCase();
  const values = Object.values(VolumeProduct) as string[];
  return values.includes(normalized) ? (normalized as VolumeProduct) : null;
}

export interface RadarSite {
  id: string; // e.g., "KMKX"
  name: string; // e.g., "Milwaukee, WI"
  latitude: number;
  longitude: number;
  elevationMeters: number;
  status: "online" | "offline" | "unknown";
  lastVolumeAt?: number; // Unix timestamp ms
}

export type { RadarSiteDefinition } from "./sites.js";
export { RADAR_SITES } from "./sites.js";

export interface SweepInfo {
  sweepIndex: number;
  elevationAngleDegrees: number;
  azimuthBins: number;
  radialBins: number;
  nyquistVelocityMs?: number;
}

export interface RadarVolumeMeta {
  volumeId: string;
  siteId: string;
  product: VolumeProduct;
  generatedAtMs: number; // Unix timestamp when radar completed scan
  sweeps: SweepInfo[];
  radialBinSizeMeters: number;
  minRange: number;
  maxRange: number;
  minValueDb: number;
  maxValueDb: number;
  noDataValue: number;
  storageKey: string; // Path/key in object storage
  decodeMode?: "decoded" | "bootstrap-byte-map";
  /**
   * Antenna position from the Level-II Volume data block (actual scan reference).
   * When set, prefer these over catalog {@link RadarSite} coordinates for globe/local placement.
   */
  radarLatitudeDegrees?: number;
  radarLongitudeDegrees?: number;
  /** Feedhorn height AMSL from the Volume block (meters per NEXRAD ICD / nexrad-level-2-data). */
  radarAntennaHeightMeters?: number;
}

/**
 * Merge catalog site info with volume-reported antenna coordinates when the ingest
 * pipeline stored them on {@link RadarVolumeMeta}.
 */
export function radarSiteForVolume(
  site: RadarSite | null | undefined,
  metadata: RadarVolumeMeta | null | undefined
): RadarSite | null {
  if (!site) {
    return null;
  }
  if (!metadata) {
    return site;
  }
  const lat = metadata.radarLatitudeDegrees;
  const lon = metadata.radarLongitudeDegrees;
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return site;
  }
  const h = metadata.radarAntennaHeightMeters;
  return {
    ...site,
    latitude: lat,
    longitude: lon,
    elevationMeters: h != null && Number.isFinite(h) ? h : site.elevationMeters,
  };
}

export interface TimelineFrame {
  volumeId: string;
  product: VolumeProduct;
  generatedAtMs: number;
  available: boolean; // Can be fetched immediately
  storageKey?: string;
}

// ============================================
// API Responses
// ============================================

export interface GetSitesResponse {
  sites: RadarSite[];
}

/** Latest volume for a site+product; `volume` is null when nothing is indexed yet (not an HTTP error). */
export interface GetLatestVolumeResponse {
  volume: RadarVolumeMeta | null;
}

export interface GetTimelineResponse {
  siteId: string;
  product: VolumeProduct;
  frames: TimelineFrame[];
  oldestMs: number;
  newestMs: number;
}

export interface GetVolumeProductsResponse {
  definitions: VolumeProductDefinition[];
}

export interface LatestVolumeBatchItem {
  product: VolumeProduct;
  volume: RadarVolumeMeta | null;
}

export interface GetLatestVolumesBatchResponse {
  siteId: string;
  items: LatestVolumeBatchItem[];
}

export interface StreamEventPayload {
  eventType: "volume.ready" | "volume.error" | "ingestion.lag";
  data: Record<string, unknown>;
  emittedAtMs: number;
}

export interface VolumeReadyEvent extends StreamEventPayload {
  eventType: "volume.ready";
  data: {
    siteId: string;
    product: VolumeProduct;
    volumeId: string;
    generatedAtMs: number;
    storageKey: string;
  };
}

// ============================================
// Ingestion and Storage
// ============================================

export interface IngestionState {
  siteId: string;
  lastPolledAtMs: number;
  lastSuccessAtMs?: number;
  lastErrorMessage?: string;
  consecutiveFailures: number;
}

export interface VolumeArtifact {
  data: Float32Array; // Packed [sweep][azimuth+padding][range]
  metadata: RadarVolumeMeta;
}
