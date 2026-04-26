import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { RADAR_SITES } from "@nexrad-3d/contracts";

export async function GET() {
  const metricsInfo: any = {};
  const redis = getRedis();
  try {
    const keys = RADAR_SITES.map((site) => `ingestion:state:${site.id}`);
    const results = await redis.mget(...keys);
    
    let activeSites = 0;
    const states = results.map((result, i) => {
      if (result) {
        const data = JSON.parse(result);
        if (data.consecutiveFailures === 0 && data.lastSuccessAtMs && Date.now() - data.lastSuccessAtMs < 600000) {
            activeSites++;
        }
        return data; 
      }
      return { siteId: RADAR_SITES[i].id, consecutiveFailures: 0, lastPolledAtMs: 0 };
    });

    metricsInfo.sitesActive = activeSites;
    metricsInfo.totalSites = RADAR_SITES.length;
    metricsInfo.states = states;

    const lastVolumeKeys = RADAR_SITES.map(s => `radar:site:lastVolumeAt:${s.id}`);
    const lastVolumeResults = await redis.mget(...lastVolumeKeys);
    
    let mostRecentSite = null;
    let mostRecentTime = 0;
    lastVolumeResults.forEach((val, i) => {
        if (val) {
            const time = parseInt(val, 10);
            if (time > mostRecentTime) {
                mostRecentTime = time;
                mostRecentSite = RADAR_SITES[i].id;
            }
        }
    });
    metricsInfo.mostRecentSite = mostRecentSite;
    metricsInfo.mostRecentTime = mostRecentTime;

    const timings = await redis.hgetall("ingestion:metrics:timing");
    const avgTimes: Record<string, number> = {};
    let globalTotalTime = 0;
    let globalSites = 0;
    for (const [site, time] of Object.entries(timings)) {
        avgTimes[site] = parseFloat(time);
        globalTotalTime += parseFloat(time);
        globalSites++;
    }
    metricsInfo.avgTimes = avgTimes;
    metricsInfo.globalAvgTime = globalSites > 0 ? globalTotalTime / globalSites : 0;

    const s3Size = await redis.get("ingestion:metrics:s3_size");
    metricsInfo.s3TotalBytes = s3Size ? parseInt(s3Size, 10) : 0;

  } catch (e) {
      console.error(e);
  }
  return NextResponse.json(metricsInfo);
}
