import { describe, expect, it } from "vitest";
import type { RadarVolumeMeta } from "@nexrad-3d/contracts";
import { VolumeProduct } from "@nexrad-3d/contracts";
import { buildVolumeSweepSubset } from "./volumeSweepSubset.js";

function makeMeta(sweeps: RadarVolumeMeta["sweeps"]): RadarVolumeMeta {
  return {
    volumeId: "v1",
    siteId: "KTEST",
    product: VolumeProduct.REFLECTIVITY,
    generatedAtMs: 0,
    sweeps,
    radialBinSizeMeters: 250,
    minRange: 0,
    maxRange: 100_000,
    minValueDb: -32,
    maxValueDb: 70,
    noDataValue: -999,
    storageKey: "k",
  };
}

describe("buildVolumeSweepSubset", () => {
  it("returns same references when keeping all tilts", () => {
    const meta = makeMeta([
      { sweepIndex: 0, elevationAngleDegrees: 0.5, azimuthBins: 2, radialBins: 2 },
      { sweepIndex: 1, elevationAngleDegrees: 1.5, azimuthBins: 2, radialBins: 2 },
    ]);
    const data = new Float32Array([1, 2, 3, 4, 10, 20, 30, 40]);
    const out = buildVolumeSweepSubset(meta, data, 2);
    expect(out.metadata).toBe(meta);
    expect(out.data).toBe(data);
  });

  it("returns same references when keep count is at least sweep count", () => {
    const meta = makeMeta([
      { sweepIndex: 0, elevationAngleDegrees: 0.5, azimuthBins: 2, radialBins: 2 },
      { sweepIndex: 1, elevationAngleDegrees: 1.5, azimuthBins: 2, radialBins: 2 },
    ]);
    const data = new Float32Array(8);
    expect(buildVolumeSweepSubset(meta, data, 99).data).toBe(data);
  });

  it("keeps lowest-elevation sweep only when k is 1", () => {
    const meta = makeMeta([
      { sweepIndex: 0, elevationAngleDegrees: 2, azimuthBins: 2, radialBins: 2 },
      { sweepIndex: 1, elevationAngleDegrees: 0.5, azimuthBins: 2, radialBins: 2 },
    ]);
    const data = new Float32Array([1, 2, 3, 4, 10, 20, 30, 40]);
    const out = buildVolumeSweepSubset(meta, data, 1);
    expect(out.metadata.sweeps).toHaveLength(1);
    expect(out.metadata.sweeps[0].elevationAngleDegrees).toBe(0.5);
    expect(Array.from(out.data)).toEqual([10, 20, 30, 40]);
  });

  it("preserves original file order among kept sweeps", () => {
    const meta = makeMeta([
      { sweepIndex: 0, elevationAngleDegrees: 1, azimuthBins: 1, radialBins: 2 },
      { sweepIndex: 1, elevationAngleDegrees: 0.2, azimuthBins: 1, radialBins: 2 },
      { sweepIndex: 2, elevationAngleDegrees: 2, azimuthBins: 1, radialBins: 2 },
    ]);
    const data = new Float32Array([1, 2, 10, 20, 100, 200]);
    const out = buildVolumeSweepSubset(meta, data, 2);
    expect(out.metadata.sweeps.map((s) => s.elevationAngleDegrees)).toEqual([1, 0.2]);
    expect(Array.from(out.data)).toEqual([1, 2, 10, 20]);
  });
});
