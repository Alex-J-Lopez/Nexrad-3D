import { parentPort, workerData } from "worker_threads";
import { getReaderForFile, parseNexradGeneratedAtMs } from "@nexrad-3d/radar-parser";
import { VolumeProduct } from "@nexrad-3d/contracts";

interface WorkerData {
  buffer: Uint8Array;
  filename: string;
  siteId: string;
  generatedAtMs: number;
  product: VolumeProduct;
}

const run = async () => {
  if (!parentPort) return;
  const { buffer, filename, siteId, generatedAtMs, product } = workerData as WorkerData;

  try {
    const sourceBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    const parser = getReaderForFile(filename, sourceBuffer);

    if (!parser) {
      throw new Error(`unsupported radar file format: ${filename}`);
    }

    const artifact = await parser.loadVolume(sourceBuffer, product, {
      filename,
      siteId,
      generatedAtMs,
    });

    const parsedVolumeBytes = new Uint8Array(
      artifact.data.buffer,
      artifact.data.byteOffset,
      artifact.data.byteLength
    );

    parentPort.postMessage({
      success: true,
      data: parsedVolumeBytes,
      metadata: artifact.metadata,
    }, [parsedVolumeBytes.buffer as ArrayBuffer]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    parentPort.postMessage({
      success: false,
      error: message,
    });
  }
};

run();
