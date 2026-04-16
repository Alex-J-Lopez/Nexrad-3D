import type { SweepInfo } from "@nexrad-3d/contracts";

/** Sum of azimuthBins × radialBins across all sweeps. */
export function totalPackedBins(sweeps: SweepInfo[]): number {
  return sweeps.reduce((sum, s) => sum + s.azimuthBins * s.radialBins, 0);
}

/**
 * Integer step ≥1 for sampling azimuth and range indices so approximate point count
 * stays near maxPoints when every cell would otherwise be plotted.
 */
export function suggestedSampleStride(totalCells: number, maxPoints: number): number {
  if (totalCells <= 0 || maxPoints <= 0) {
    return 1;
  }
  if (totalCells <= maxPoints) {
    return 1;
  }
  return Math.max(1, Math.ceil(Math.sqrt(totalCells / maxPoints)));
}

/**
 * Integer stride for azimuth/range decimation so triangle count stays near a budget.
 * Each polar quad becomes two triangles; quads ≈ (azimuthBins/stride) × (radialBins/stride).
 */
export function suggestedMeshStride(
  azimuthBins: number,
  radialBins: number,
  maxTriangles: number
): number {
  if (azimuthBins <= 0 || radialBins <= 0 || maxTriangles <= 0) {
    return 1;
  }
  const maxQuads = Math.max(1, Math.floor(maxTriangles / 2));
  const product = azimuthBins * radialBins;
  if (product <= maxQuads) {
    return 1;
  }
  return Math.max(1, Math.ceil(Math.sqrt(product / maxQuads)));
}
