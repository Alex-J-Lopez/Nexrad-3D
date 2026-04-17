import type { RadarVolumeMeta, SweepInfo } from "@nexrad-3d/contracts";

type SweepLayout = {
  sweep: SweepInfo;
  offset: number;
  count: number;
};

function buildSweepLayouts(sweeps: SweepInfo[]): SweepLayout[] {
  let offset = 0;
  return sweeps.map((s) => {
    const count = s.azimuthBins * s.radialBins;
    const layout = { sweep: s, offset, count };
    offset += count;
    return layout;
  });
}

/**
 * Drops the highest-elevation sweeps so the lowest `lowestTiltsToKeep` tilts (by elevation angle)
 * remain. Packing order follows the original artifact; data is re-packed.
 *
 * @param lowestTiltsToKeep Count from 1 .. sweep count; values ≥ sweep count leave the volume unchanged.
 */
export function buildVolumeSweepSubset(
  metadata: RadarVolumeMeta,
  data: Float32Array,
  lowestTiltsToKeep: number
): { metadata: RadarVolumeMeta; data: Float32Array } {
  const sweeps = metadata.sweeps;
  const n = sweeps.length;
  if (n <= 1) {
    return { metadata, data };
  }

  const k = Math.min(n, Math.max(1, Math.floor(lowestTiltsToKeep)));
  if (k >= n) {
    return { metadata, data };
  }

  const layouts = buildSweepLayouts(sweeps);
  const sortedByElev = [...layouts].sort(
    (a, b) => a.sweep.elevationAngleDegrees - b.sweep.elevationAngleDegrees
  );
  const selected = sortedByElev.slice(0, k).sort((a, b) => a.offset - b.offset);

  const newSweeps = selected.map((l) => l.sweep);
  const totalLen = selected.reduce((sum, l) => sum + l.count, 0);
  const out = new Float32Array(totalLen);
  let w = 0;
  for (const l of selected) {
    out.set(data.subarray(l.offset, l.offset + l.count), w);
    w += l.count;
  }

  return {
    metadata: { ...metadata, sweeps: newSweeps },
    data: out,
  };
}
