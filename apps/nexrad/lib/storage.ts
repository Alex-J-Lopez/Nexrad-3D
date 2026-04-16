import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION, S3_BUCKET } from "./env";

let s3: S3Client | null = null;

export function getS3(): S3Client {
  if (!s3) {
    s3 = new S3Client({
      region: S3_REGION,
      endpoint: S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: S3_ACCESS_KEY,
        secretAccessKey: S3_SECRET_KEY,
      },
    });
  }
  return s3;
}

export { GetObjectCommand, S3_BUCKET };
