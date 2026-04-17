import type { RadarSite } from "@nexrad-3d/contracts";
import { getRedis, withTimeout } from "@/lib/redis";
import {
  RADAR_SITES,
  KNOWN_SITES,
  POLL_INTERVAL_SECONDS,
  REDIS_COMMAND_TIMEOUT_MS,
} from "@/lib/env";
import { RadarViewer } from "@/components/RadarViewer";

function buildSite(siteId: string, lastVolumeAtMs: number | undefined): RadarSite {
  const fallback = { name: `Radar ${siteId}`, latitude: 0, longitude: 0, elevationMeters: 0 };
  const info = KNOWN_SITES[siteId] ?? fallback;
  const staleMs = POLL_INTERVAL_SECONDS * 3 * 1000;
  const isOnline =
    typeof lastVolumeAtMs === "number" && Date.now() - lastVolumeAtMs <= staleMs;

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

async function getSites(): Promise<RadarSite[]> {
  try {
    const redis = getRedis();
    const keys = RADAR_SITES.map((id) => `radar:site:lastVolumeAt:${id}`);
    const values =
      keys.length > 0
        ? await withTimeout(
            redis.mget(...keys),
            REDIS_COMMAND_TIMEOUT_MS,
            "site lookup"
          )
        : [];

    return RADAR_SITES.map((id, i) => {
      const parsed = Number.parseInt(values[i] ?? "", 10);
      return buildSite(id, Number.isNaN(parsed) ? undefined : parsed);
    });
  } catch {
    return RADAR_SITES.map((id) => buildSite(id, undefined));
  }
}

export default async function Home() {
  const sites = await getSites();
  return <RadarViewer initialSites={sites} />;
}
