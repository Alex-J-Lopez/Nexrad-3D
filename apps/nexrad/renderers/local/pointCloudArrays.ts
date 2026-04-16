import type { RadarVolumeMeta } from "@nexrad-3d/contracts";
import { nwsColor, projectBeamSample } from "../shared/radarGeometry";

const HEIGHT_SCALE = 3;

export interface PointArrays {
  positions: Float32Array;
  colors: Float32Array;
  pointCount: number;
}

export function buildPointArrays(
  data: Float32Array,
  metadata: RadarVolumeMeta,
  thresholdDbz: number
): PointArrays {
  let maxPoints = 0;
  for (const sweep of metadata.sweeps) {
    maxPoints += sweep.azimuthBins * sweep.radialBins;
  }

  const positions = new Float32Array(maxPoints * 3);
  const colors = new Float32Array(maxPoints * 3);
  let cursor = 0;
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

        const base = cursor * 3;
        positions[base] = rangeKm * sinAz;
        positions[base + 1] = heightKm;
        positions[base + 2] = rangeKm * cosAz;

        const [r, g, b] = nwsColor(sample);
        colors[base] = r;
        colors[base + 1] = g;
        colors[base + 2] = b;
        cursor++;
      }
    }

    dataOffset += azimuthBins * radialBins;
  }

  return {
    positions: positions.slice(0, cursor * 3),
    colors: colors.slice(0, cursor * 3),
    pointCount: cursor,
  };
}
