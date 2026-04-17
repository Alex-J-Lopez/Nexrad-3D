import { describe, it, expect } from "vitest";
import { buildPointArrays } from "../pointCloudArrays";
import type { RadarVolumeMeta } from "@nexrad-3d/contracts";
import { VolumeProduct } from "@nexrad-3d/contracts";

function makeMeta(overrides: Partial<RadarVolumeMeta> = {}): RadarVolumeMeta {
  return {
    volumeId: "test-001",
    siteId: "KMKX",
    product: VolumeProduct.REFLECTIVITY,
    generatedAtMs: 0,
    sweeps: [
      { sweepIndex: 0, elevationAngleDegrees: 0.5, azimuthBins: 4, radialBins: 3 },
    ],
    radialBinSizeMeters: 250,
    minRange: 0,
    maxRange: 750,
    minValueDb: -32,
    maxValueDb: 75,
    noDataValue: -9999,
    storageKey: "",
    ...overrides,
  };
}

describe("buildPointArrays", () => {
  it("returns empty arrays when all values are below threshold", () => {
    const meta = makeMeta();
    const data = new Float32Array(12).fill(10);
    const { positions, colors, pointCount } = buildPointArrays(data, meta, 15);
    expect(pointCount).toBe(0);
    expect(positions.length).toBe(0);
    expect(colors.length).toBe(0);
  });

  it("returns empty arrays when all values are noData", () => {
    const meta = makeMeta();
    const data = new Float32Array(12).fill(-9999);
    const { pointCount } = buildPointArrays(data, meta, 15);
    expect(pointCount).toBe(0);
  });

  it("counts only cells at or above threshold", () => {
    const meta = makeMeta();
    const data = new Float32Array(12).fill(-9999);
    data[0] = 40;
    data[1] = 50;
    data[2] = 20;
    data[3] = 10;
    const { pointCount } = buildPointArrays(data, meta, 15);
    expect(pointCount).toBe(3);
  });

  it("positions array length is 3× pointCount", () => {
    const meta = makeMeta();
    const data = new Float32Array(12).fill(40);
    const { positions, pointCount } = buildPointArrays(data, meta, 15);
    expect(positions.length).toBe(pointCount * 3);
  });

  it("colors array length is 3× pointCount", () => {
    const meta = makeMeta();
    const data = new Float32Array(12).fill(40);
    const { colors, pointCount } = buildPointArrays(data, meta, 15);
    expect(colors.length).toBe(pointCount * 3);
  });

  it("increasing threshold reduces point count", () => {
    const meta = makeMeta();
    const data = new Float32Array(12);
    for (let i = 0; i < 12; i++) data[i] = 10 + i * 5;
    const low = buildPointArrays(data, meta, 15).pointCount;
    const high = buildPointArrays(data, meta, 45).pointCount;
    expect(high).toBeLessThan(low);
  });

  it("accumulates cells across multiple sweeps", () => {
    const meta = makeMeta({
      sweeps: [
        { sweepIndex: 0, elevationAngleDegrees: 0.5, azimuthBins: 2, radialBins: 2 },
        { sweepIndex: 1, elevationAngleDegrees: 1.5, azimuthBins: 2, radialBins: 2 },
      ],
    });
    const data = new Float32Array(8).fill(40);
    const { pointCount } = buildPointArrays(data, meta, 15);
    expect(pointCount).toBe(8);
  });

  it("Y (height) coordinate increases with elevation angle", () => {
    // First gate must be at non-zero slant range or projectBeamSample yields zero height.
    const lowMeta = makeMeta({
      sweeps: [{ sweepIndex: 0, elevationAngleDegrees: 0.5, azimuthBins: 1, radialBins: 1 }],
      minRange: 50_000,
    });
    const highMeta = makeMeta({
      sweeps: [{ sweepIndex: 0, elevationAngleDegrees: 10, azimuthBins: 1, radialBins: 1 }],
      minRange: 50_000,
    });
    const data = new Float32Array([40]);
    const lowY = buildPointArrays(data, lowMeta, 15).positions[1];
    const highY = buildPointArrays(data, highMeta, 15).positions[1];
    expect(highY).toBeGreaterThan(lowY);
  });

  it("returns typed Float32Array (not regular Array)", () => {
    const meta = makeMeta();
    const data = new Float32Array(12).fill(40);
    const { positions, colors } = buildPointArrays(data, meta, 15);
    expect(positions).toBeInstanceOf(Float32Array);
    expect(colors).toBeInstanceOf(Float32Array);
  });
});
