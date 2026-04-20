import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { GetTimelineResponse, RadarVolumeMeta, TimelineFrame } from "@nexrad-3d/contracts";
import { parseVolumeProduct } from "@nexrad-3d/contracts";
import { getRedis, withTimeout } from "@/lib/redis";
import { REDIS_COMMAND_TIMEOUT_MS } from "@/lib/env";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const siteId = searchParams.get("siteId")?.trim().toUpperCase();
  const productRaw = searchParams.get("product");
  const limitRaw = searchParams.get("limit");

  if (!siteId || !productRaw) {
    return NextResponse.json({ error: "Missing siteId or product" }, { status: 400 });
  }

  const product = parseVolumeProduct(productRaw);
  if (!product) {
    return NextResponse.json({ error: "Invalid product" }, { status: 400 });
  }

  const parsedLimit = Number.parseInt(limitRaw || "120", 10);
  const limit = Number.isNaN(parsedLimit) ? 120 : Math.min(Math.max(parsedLimit, 1), 500);

  try {
    const redis = getRedis();
    const timelineKey = `radar:timeline:${siteId}:${product}`;
    
    // Clean up expired items in Redis so the frontend strictly only gets the last 15 min
    const thresholdTime = Date.now() - (15 * 60 * 1000);
    await redis.zremrangebyscore(timelineKey, "-inf", thresholdTime);

    const volumeIds = await withTimeout(
      redis.zrange(timelineKey, 0, limit - 1, "REV"),
      REDIS_COMMAND_TIMEOUT_MS,
      "Redis timeline lookup"
    );

    if (volumeIds.length === 0) {
      const empty: GetTimelineResponse = {
        siteId,
        product,
        frames: [],
        oldestMs: 0,
        newestMs: 0,
      };
      return NextResponse.json(empty);
    }

    const volumeKeys = volumeIds.map((id) => `radar:volume:${id}`);
    const metaValues = await withTimeout(
      redis.mget(...volumeKeys),
      REDIS_COMMAND_TIMEOUT_MS,
      "Redis timeline metadata lookup"
    );

    const metas = metaValues.flatMap((v) => {
      if (typeof v !== "string") return [];
      try {
        return [JSON.parse(v) as RadarVolumeMeta];
      } catch {
        return [];
      }
    });

    const frames: TimelineFrame[] = metas.map((m) => ({
      volumeId: m.volumeId,
      product: m.product,
      generatedAtMs: m.generatedAtMs,
      available: true,
      storageKey: m.storageKey,
    }));

    const response: GetTimelineResponse = {
      siteId,
      product,
      frames,
      oldestMs: frames.length > 0 ? frames[frames.length - 1].generatedAtMs : 0,
      newestMs: frames.length > 0 ? frames[0].generatedAtMs : 0,
    };
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
