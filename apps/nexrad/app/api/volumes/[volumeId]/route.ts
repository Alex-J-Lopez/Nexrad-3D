import { NextResponse } from "next/server";
import type { GetLatestVolumeResponse, RadarVolumeMeta } from "@nexrad-3d/contracts";
import { getRedis, withTimeout } from "@/lib/redis";
import { REDIS_COMMAND_TIMEOUT_MS } from "@/lib/env";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ volumeId: string }> }
) {
  const { volumeId } = await params;
  if (!volumeId?.trim()) {
    return NextResponse.json({ error: "Missing volumeId" }, { status: 400 });
  }
  if (volumeId.length > 128) {
    return NextResponse.json({ error: "Invalid volumeId" }, { status: 400 });
  }

  try {
    const redis = getRedis();
    const json = await withTimeout(
      redis.get(`radar:volume:${volumeId.trim()}`),
      REDIS_COMMAND_TIMEOUT_MS,
      "Redis volume lookup"
    );

    if (!json) {
      return NextResponse.json({ error: "Volume not found" }, { status: 404 });
    }

    const response: GetLatestVolumeResponse = {
      volume: JSON.parse(json) as RadarVolumeMeta,
    };
    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=600" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("timed out")) {
      return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 });
    }
    console.error("[api] route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
