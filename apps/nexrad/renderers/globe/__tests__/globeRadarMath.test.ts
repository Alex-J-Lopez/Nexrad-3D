import { describe, it, expect } from "vitest";
import { suggestedMeshStride, suggestedSampleStride, totalPackedBins } from "../globeRadarMath";
import type { SweepInfo } from "@nexrad-3d/contracts";

describe("totalPackedBins", () => {
  it("sums sweep cell counts", () => {
    const sweeps: SweepInfo[] = [
      { sweepIndex: 0, elevationAngleDegrees: 0.5, azimuthBins: 360, radialBins: 200 },
      { sweepIndex: 1, elevationAngleDegrees: 1.5, azimuthBins: 360, radialBins: 200 },
    ];
    expect(totalPackedBins(sweeps)).toBe(360 * 200 * 2);
  });
});

describe("suggestedSampleStride", () => {
  it("returns 1 when under budget", () => {
    expect(suggestedSampleStride(1000, 5000)).toBe(1);
  });

  it("returns >1 when over budget", () => {
    const stride = suggestedSampleStride(1_000_000, 250_000);
    expect(stride).toBeGreaterThan(1);
    const approxPoints = 1_000_000 / (stride * stride);
    expect(approxPoints).toBeLessThanOrEqual(250_000 + 10_000);
  });
});

describe("suggestedMeshStride", () => {
  it("returns 1 when triangle budget is loose", () => {
    expect(suggestedMeshStride(100, 100, 1_000_000)).toBe(1);
  });

  it("returns >1 when over triangle budget", () => {
    const stride = suggestedMeshStride(720, 1000, 200_000);
    expect(stride).toBeGreaterThan(1);
  });
});
