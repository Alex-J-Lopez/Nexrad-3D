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
  { id: "KABR", name: "Aberdeen, SD", latitude: 45.4558, longitude: -98.4131, elevationMeters: 397 },
  { id: "KAPX", name: "Gaylord, MI", latitude: 44.9073, longitude: -84.7197, elevationMeters: 442 },
  { id: "KARX", name: "La Crosse, WI", latitude: 43.9081, longitude: -91.1911, elevationMeters: 355 },
  { id: "KBIS", name: "Bismarck, ND", latitude: 46.7709, longitude: -100.7603, elevationMeters: 506 },
  { id: "KCLE", name: "Cleveland, OH", latitude: 41.4132, longitude: -81.8597, elevationMeters: 194 },
  { id: "KDDC", name: "Dodge City, KS", latitude: 37.7611, longitude: -99.9689, elevationMeters: 790 },
  { id: "KDMX", name: "Des Moines, IA", latitude: 41.7312, longitude: -93.7229, elevationMeters: 299 },
  { id: "KDTX", name: "Detroit, MI", latitude: 42.7, longitude: -83.4719, elevationMeters: 346 },
  { id: "KDVN", name: "Davenport, IA", latitude: 41.6111, longitude: -90.5808, elevationMeters: 240 },
  { id: "KEAX", name: "Kansas City, MO", latitude: 38.8102, longitude: -94.2645, elevationMeters: 263 },
  { id: "KFSD", name: "Sioux Falls, SD", latitude: 43.5878, longitude: -96.7294, elevationMeters: 436 },
  { id: "KGLD", name: "Goodland, KS", latitude: 39.367, longitude: -101.7, elevationMeters: 1129 },
  { id: "KGRB", name: "Green Bay, WI", latitude: 44.4986, longitude: -88.1111, elevationMeters: 210 },
  { id: "KGRR", name: "Grand Rapids, MI", latitude: 42.8939, longitude: -85.5449, elevationMeters: 241 },
  { id: "KICT", name: "Wichita, KS", latitude: 37.7556, longitude: -97.1622, elevationMeters: 408 },
  { id: "KILN", name: "Wilmington, OH", latitude: 39.4203, longitude: -83.8217, elevationMeters: 328 },
  { id: "KILX", name: "Lincoln, IL", latitude: 40.1505, longitude: -89.3368, elevationMeters: 210 },
  { id: "KIND", name: "Indianapolis, IN", latitude: 39.7074, longitude: -86.2804, elevationMeters: 241 },
  { id: "KIWX", name: "North Webster, IN", latitude: 41.3586, longitude: -85.7, elevationMeters: 298 },
  { id: "KLOT", name: "Chicago (Romeoville), IL", latitude: 41.6044, longitude: -88.0844, elevationMeters: 200 },
  { id: "KLSX", name: "St. Louis, MO", latitude: 38.6986, longitude: -90.6828, elevationMeters: 170 },
  { id: "KLVX", name: "Louisville, KY", latitude: 37.9753, longitude: -85.9436, elevationMeters: 219 },
  { id: "KMKX", name: "Milwaukee, WI", latitude: 42.9679, longitude: -87.9046, elevationMeters: 214 },
  { id: "KMPX", name: "Minneapolis, MN", latitude: 44.8488, longitude: -93.5655, elevationMeters: 288 },
  { id: "KMQT", name: "Marquette, MI", latitude: 46.5311, longitude: -87.5483, elevationMeters: 428 },
  { id: "KMVX", name: "Minot, ND", latitude: 48.06, longitude: -102.3281, elevationMeters: 495 },
  { id: "KOAX", name: "Omaha, NE", latitude: 41.3203, longitude: -96.3667, elevationMeters: 350 },
  { id: "KSGF", name: "Springfield, MO", latitude: 37.2353, longitude: -93.4, elevationMeters: 383 },
  { id: "KUEX", name: "Hastings, NE", latitude: 40.3208, longitude: -98.4419, elevationMeters: 585 },
];

/** Default `RADAR_SITES` when the env var is unset (comma-separated ICAO radar IDs). */
export const DEFAULT_RADAR_SITES_CSV = MIDWEST_RADAR_SITES.map((s) => s.id).join(",");
