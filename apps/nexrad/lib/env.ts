import "server-only";

function env(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export const REDIS_URL = env("REDIS_URL", "redis://localhost:6379");
export const REDIS_COMMAND_TIMEOUT_MS = envInt("REDIS_COMMAND_TIMEOUT_MS", 3000);

export const S3_ENDPOINT = env("S3_ENDPOINT", "http://localhost:9000");
export const S3_ACCESS_KEY = env("S3_ACCESS_KEY", "minioadmin");
export const S3_SECRET_KEY = env("S3_SECRET_KEY", "minioadmin");
export const S3_BUCKET = env("S3_BUCKET", "radar-data");
export const S3_REGION = env("S3_REGION", "us-east-1");

export const POLL_INTERVAL_SECONDS = envInt("POLL_INTERVAL_SECONDS", 30);

export const RADAR_SITES = env("RADAR_SITES", "KMKX")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

export const KNOWN_SITES: Record<
  string,
  { name: string; latitude: number; longitude: number; elevationMeters: number }
> = {
  KMKX: { name: "Milwaukee, WI", latitude: 42.9681, longitude: -87.9275, elevationMeters: 203 },
  KTLX: { name: "Oklahoma City, OK", latitude: 35.3331, longitude: -97.2775, elevationMeters: 372 },
  KLOT: { name: "Chicago, IL", latitude: 41.6044, longitude: -88.0844, elevationMeters: 218 },
};
