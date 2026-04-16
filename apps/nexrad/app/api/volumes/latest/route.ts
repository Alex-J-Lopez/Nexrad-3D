import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { GetLatestVolumeResponse, RadarVolumeMeta } from "@nexrad-3d/contracts";
import { parseVolumeProduct } from "@nexrad-3d/contracts";
import { getRedis, withTimeout } from "@/lib/redis";
import { REDIS_COMMAND_TIMEOUT_MS } from "@/lib/env";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const siteId = searchParams.get("siteId")?.trim().toUpperCase();
  const productRaw = searchParams.get("product");

  if (!siteId || !productRaw) {
    return NextResponse.json({ error: "Missing siteId or product" }, { status: 400 });
  }

  const product = parseVolumeProduct(productRaw);
  if (!product) {
    return NextResponse.json({ error: "Invalid product" }, { status: 400 });
  }

  try {
    const redis = getRedis();
    const json = await withTimeout(
      redis.get(`radar:latest:${siteId}:${product}`),
      REDIS_COMMAND_TIMEOUT_MS,
      "Redis latest volume lookup"
    );

    const response: GetLatestVolumeResponse = json
      ? { volume: JSON.parse(json) as RadarVolumeMeta }
      : { volume: null };

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
