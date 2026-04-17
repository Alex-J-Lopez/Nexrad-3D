import { NextResponse } from "next/server";
import type { GetSitesResponse, RadarSite } from "@nexrad-3d/contracts";
import { getRedis, withTimeout } from "@/lib/redis";
import { RADAR_SITES, KNOWN_SITES, POLL_INTERVAL_SECONDS, REDIS_COMMAND_TIMEOUT_MS } from "@/lib/env";

function buildSite(siteId: string, lastVolumeAtMs: number | undefined): RadarSite {
  const fallback = { name: `Radar ${siteId}`, latitude: 0, longitude: 0, elevationMeters: 0 };
  const info = KNOWN_SITES[siteId] || fallback;
  const staleThresholdMs = POLL_INTERVAL_SECONDS * 3 * 1000;
  const isOnline = typeof lastVolumeAtMs === "number" && Date.now() - lastVolumeAtMs <= staleThresholdMs;

  return {
    id: siteId,
    name: info.name,
    latitude: info.latitude,
    longitude: info.longitude,
    elevationMeters: info.elevationMeters,
    status: isOnline ? "online" : "unknown",
    lastVolumeAt: lastVolumeAtMs,
  };
}

export async function GET() {
  try {
    const redis = getRedis();
    const keys = RADAR_SITES.map((id) => `radar:site:lastVolumeAt:${id}`);
    const values =
      keys.length > 0
        ? await withTimeout(redis.mget(...keys), REDIS_COMMAND_TIMEOUT_MS, "Redis site lookup")
        : [];

    const sites = RADAR_SITES.map((id, i) => {
      const parsed = Number.parseInt(values[i] || "", 10);
      return buildSite(id, Number.isNaN(parsed) ? undefined : parsed);
    });

    const response: GetSitesResponse = { sites };
    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("timed out")) {
      return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 });
    }
    console.error("[api] route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
