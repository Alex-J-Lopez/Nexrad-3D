import { NextResponse } from "next/server";
import { VOLUME_PRODUCT_DEFINITIONS } from "@nexrad-3d/contracts";
import type { GetVolumeProductsResponse } from "@nexrad-3d/contracts";

export async function GET() {
  const response: GetVolumeProductsResponse = { definitions: VOLUME_PRODUCT_DEFINITIONS };
  return NextResponse.json(response);
}
