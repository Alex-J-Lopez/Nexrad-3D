import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION, S3_BUCKET } from "./env";

const g = globalThis as typeof globalThis & { _nexradS3?: S3Client };

const isCustomEndpoint = Boolean(process.env.S3_ENDPOINT?.trim());

export function getS3(): S3Client {
  if (!g._nexradS3) {
    g._nexradS3 = new S3Client({
      region: S3_REGION,
      ...(isCustomEndpoint ? { endpoint: S3_ENDPOINT } : {}),
      forcePathStyle: isCustomEndpoint,
      credentials: {
        accessKeyId: S3_ACCESS_KEY,
        secretAccessKey: S3_SECRET_KEY,
      },
    });
  }
  return g._nexradS3;
}

export { GetObjectCommand, S3_BUCKET };
