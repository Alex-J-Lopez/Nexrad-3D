/// <reference lib="webworker" />

import type { RadarVolumeMeta } from "@nexrad-3d/contracts";
import { buildPointArrays } from "../renderers/local/pointCloudArrays";

interface PointCloudRequest {
  type: "build";
  data: Float32Array;
  metadata: RadarVolumeMeta;
  thresholdDbz: number;
}

interface PointCloudResult {
  type: "result";
  positions: Float32Array;
  colors: Float32Array;
  pointCount: number;
}

interface PointCloudError {
  type: "error";
  message: string;
}

self.onmessage = (event: MessageEvent<PointCloudRequest>) => {
  const { data, metadata, thresholdDbz } = event.data;

  try {
    const result = buildPointArrays(data, metadata, thresholdDbz);

    const msg: PointCloudResult = {
      type: "result",
      positions: result.positions,
      colors: result.colors,
      pointCount: result.pointCount,
    };

    self.postMessage(msg, [
      result.positions.buffer,
      result.colors.buffer,
    ] as unknown as Transferable[]);
  } catch (err) {
    const msg: PointCloudError = {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(msg);
  }
};
