import { parentPort, workerData } from "worker_threads";
import { getReaderForFile, type ProductVolumeResult } from "@nexrad-3d/radar-parser";
import { VolumeProduct } from "@nexrad-3d/contracts";

interface WorkerData {
  buffer: Uint8Array;
  filename: string;
  siteId: string;
  generatedAtMs: number;
  products: VolumeProduct[];
}

interface ProductParseSuccess {
  product: VolumeProduct;
  success: true;
  data: Uint8Array;
  metadata: ProductVolumeResult["artifact"]["metadata"];
}

const toTransferableBytes = (data: Float32Array): Uint8Array =>
  new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

const run = async () => {
  if (!parentPort) return;
  const { buffer, filename, siteId, generatedAtMs, products } = workerData as WorkerData;

  try {
    const sourceBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;
    const parser = getReaderForFile(filename, sourceBuffer);

    if (!parser) {
      throw new Error(`unsupported radar file format: ${filename}`);
    }

    const context = {
      filename,
      siteId,
      generatedAtMs,
    };

    const loaded: ProductVolumeResult[] = parser.loadVolumes
      ? await parser.loadVolumes(sourceBuffer, products, context)
      : await Promise.all(
          products.map(async (product) => ({
            product,
            artifact: await parser.loadVolume(sourceBuffer, product, context),
          }))
        );

    const results: ProductParseSuccess[] = loaded.map(({ product, artifact }) => ({
      product,
      success: true,
      data: toTransferableBytes(artifact.data),
      metadata: artifact.metadata,
    }));

    parentPort.postMessage(
      {
        success: true,
        results,
      },
      results.map((result) => result.data.buffer as ArrayBuffer)
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    parentPort.postMessage({
      success: false,
      error: message,
    });
  }
};

run();
