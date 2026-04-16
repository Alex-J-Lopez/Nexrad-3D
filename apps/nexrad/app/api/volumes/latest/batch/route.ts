import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { GetLatestVolumesBatchResponse, RadarVolumeMeta, VolumeProduct } from "@nexrad-3d/contracts";
import { parseVolumeProduct } from "@nexrad-3d/contracts";
import { getRedis, withTimeout } from "@/lib/redis";
import { REDIS_COMMAND_TIMEOUT_MS } from "@/lib/env";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const siteId = searchParams.get("siteId")?.trim().toUpperCase();
  const productsRaw = searchParams.get("products");

  if (!siteId || !productsRaw) {
    return NextResponse.json({ error: "Missing siteId or products" }, { status: 400 });
  }

  const tokens = productsRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return NextResponse.json({ error: "products must list at least one code" }, { status: 400 });
  }
  if (tokens.length > 32) {
    return NextResponse.json({ error: "Too many products (max 32)" }, { status: 400 });
  }

  const products: VolumeProduct[] = [];
  for (const token of tokens) {
    const p = parseVolumeProduct(token);
    if (!p) {
      return NextResponse.json({ error: `Invalid product: ${token}` }, { status: 400 });
    }
    products.push(p);
  }

  try {
    const redis = getRedis();
    const keys = products.map((p) => `radar:latest:${siteId}:${p}`);
    const values = await withTimeout(
      redis.mget(...keys),
      REDIS_COMMAND_TIMEOUT_MS,
      "Redis latest volume batch lookup"
    );

    const items = products.map((product, i) => {
      const json = values[i];
      return {
        product,
        volume: json ? (JSON.parse(json) as RadarVolumeMeta) : null,
      };
    });

    const response: GetLatestVolumesBatchResponse = { siteId, items };
    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("timed out") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
