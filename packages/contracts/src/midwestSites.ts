/**
 * NEXRAD WSR-88D sites commonly grouped as US Midwest (ingest + UI defaults).
 * Coordinates: approximate radar tower reference from NWS/NCEI public tables.
 */
export interface MidwestRadarSiteDefinition {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  elevationMeters: number;
}

export const MIDWEST_RADAR_SITES: MidwestRadarSiteDefinition[] = [
  { id: "KARX", name: "La Crosse, WI", latitude: 43.8227768, longitude: -91.1911087, elevationMeters: 355 },
  { id: "KGRB", name: "Green Bay, WI", latitude: 44.4986343, longitude: -88.1111145, elevationMeters: 210 },
  { id: "KMKX", name: "Milwaukee, WI", latitude: 42.9678993, longitude: -88.5506668, elevationMeters: 214 },
];

/** Default `RADAR_SITES` when the env var is unset (comma-separated ICAO radar IDs). */
export const DEFAULT_RADAR_SITES_CSV = MIDWEST_RADAR_SITES.map((s) => s.id).join(",");
