/// <reference lib="webworker" />

import type { RadarVolumeMeta } from "@nexrad-3d/contracts";
import {
  buildGlobeRadarVolumeMesh,
  type EcefPoint,
} from "../renderers/globe/globeRadarMesh";

interface MeshRequest {
  type: "build";
  data: Float32Array;
  metadata: RadarVolumeMeta;
  thresholdDbz: number;
  stride: number;
  enuToEcefMatrix: number[];
}

interface MeshResult {
  type: "result";
  positions: Float64Array;
  colors: Uint8Array;
  indices: Uint32Array;
}

interface MeshEmpty {
  type: "empty";
}

interface MeshError {
  type: "error";
  message: string;
}

function multiplyMatrixByPoint(m: number[], x: number, y: number, z: number): EcefPoint {
  return {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14],
  };
}

self.onmessage = (event: MessageEvent<MeshRequest>) => {
  const { data, metadata, thresholdDbz, stride, enuToEcefMatrix } = event.data;

  try {
    const enuToEcef = (east: number, north: number, up: number): EcefPoint =>
      multiplyMatrixByPoint(enuToEcefMatrix, east, north, up);

    const mesh = buildGlobeRadarVolumeMesh({
      metadata,
      data,
      thresholdDbz,
      stride,
      enuToEcef,
    });

    if (!mesh) {
      const msg: MeshEmpty = { type: "empty" };
      self.postMessage(msg);
      return;
    }

    const msg: MeshResult = {
      type: "result",
      positions: mesh.positions,
      colors: mesh.colors,
      indices: mesh.indices,
    };

    self.postMessage(msg, [
      mesh.positions.buffer,
      mesh.colors.buffer,
      mesh.indices.buffer,
    ] as unknown as Transferable[]);
  } catch (err) {
    const msg: MeshError = {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(msg);
  }
};
