import { NextResponse } from "next/server";
import { getS3, GetObjectCommand, S3_BUCKET } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const { key } = await params;
  const storageKey = key.join("/");

  if (!storageKey) {
    return NextResponse.json({ error: "Missing storage key" }, { status: 400 });
  }

  try {
    const s3 = getS3();
    const object = await s3.send(
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: storageKey })
    );

    if (!object.Body) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }

    const webStream = object.Body.transformToWebStream();

    return new Response(webStream, {
      headers: {
        "Content-Type": object.ContentType || "application/octet-stream",
        "Cache-Control": "public, max-age=120",
        ...(object.ContentLength ? { "Content-Length": String(object.ContentLength) } : {}),
        ...(object.ETag ? { ETag: object.ETag } : {}),
      },
    });
  } catch (err) {
    const errName = err instanceof Error ? err.name : "";
    if (errName === "NoSuchKey" || errName === "NotFound") {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }
    console.error("[api/data] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
