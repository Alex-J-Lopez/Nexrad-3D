import type { RadarVolumeMeta } from "@nexrad-3d/contracts";
import { nwsColor, projectBeamSample } from "./radarGeometry.js";

const HEIGHT_SCALE = 3;

export interface PointArrays {
  positions: Float32Array;
  colors: Float32Array;
  pointCount: number;
}

/**
 * Pure function: converts packed volume Float32Array into Three.js-ready
 * position (X,Y,Z km) and color (R,G,B 0–1) arrays.
 * No WebGL or Three.js dependency — safe to unit test.
 */
export function buildPointArrays(
  data: Float32Array,
  metadata: RadarVolumeMeta,
  thresholdDbz: number
): PointArrays {
  const positions: number[] = [];
  const colors: number[] = [];
  let dataOffset = 0;

  for (const sweep of metadata.sweeps) {
    const { azimuthBins, radialBins, elevationAngleDegrees } = sweep;

    for (let azIdx = 0; azIdx < azimuthBins; azIdx++) {
      const azRad = (azIdx / azimuthBins) * 2 * Math.PI;
      const sinAz = Math.sin(azRad);
      const cosAz = Math.cos(azRad);

      for (let rIdx = 0; rIdx < radialBins; rIdx++) {
        const sample = data[dataOffset + azIdx * radialBins + rIdx];
        if (!Number.isFinite(sample) || sample === metadata.noDataValue || sample < thresholdDbz) {
          continue;
        }

        const slantMeters = metadata.minRange + rIdx * metadata.radialBinSizeMeters;
        const { horizontalRangeMeters, heightMeters } = projectBeamSample(
          slantMeters,
          elevationAngleDegrees
        );
        const rangeKm = horizontalRangeMeters / 1000;
        const heightKm = (heightMeters / 1000) * HEIGHT_SCALE;

        positions.push(rangeKm * sinAz, heightKm, rangeKm * cosAz);
        const [r, g, b] = nwsColor(sample);
        colors.push(r, g, b);
      }
    }

    dataOffset += azimuthBins * radialBins;
  }

  const pointCount = positions.length / 3;
  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    pointCount,
  };
}
