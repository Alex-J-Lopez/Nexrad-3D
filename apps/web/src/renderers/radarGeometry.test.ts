import { describe, it, expect } from "vitest";
import { projectBeamSample, nwsColor } from "./radarGeometry.js";

describe("projectBeamSample", () => {
  it("returns zero height and range for zero slant range", () => {
    const { horizontalRangeMeters, heightMeters } = projectBeamSample(0, 0.5);
    expect(horizontalRangeMeters).toBe(0);
    expect(heightMeters).toBe(0);
  });

  it("computes beam height above 500 m for 100 km slant range at 0.5° elevation", () => {
    const { heightMeters } = projectBeamSample(100_000, 0.5);
    expect(heightMeters).toBeGreaterThan(500);
    expect(heightMeters).toBeLessThan(5_000);
  });

  it("higher elevation produces greater height at identical slant range", () => {
    const low = projectBeamSample(100_000, 0.5);
    const high = projectBeamSample(100_000, 10);
    expect(high.heightMeters).toBeGreaterThan(low.heightMeters);
  });

  it("higher elevation produces smaller horizontal range at identical slant range", () => {
    const low = projectBeamSample(100_000, 0.5);
    const high = projectBeamSample(100_000, 10);
    expect(high.horizontalRangeMeters).toBeLessThan(low.horizontalRangeMeters);
  });

  it("clamps negative slant range — both outputs are zero", () => {
    const { horizontalRangeMeters, heightMeters } = projectBeamSample(-1_000, 0.5);
    expect(horizontalRangeMeters).toBe(0);
    expect(heightMeters).toBe(0);
  });
});

describe("nwsColor", () => {
  it("returns light blue for values below 15 dBZ", () => {
    const [r, g, b] = nwsColor(10);
    expect(r).toBeCloseTo(0x66 / 255, 2);
    expect(g).toBeCloseTo(0xcc / 255, 2);
    expect(b).toBeCloseTo(0xff / 255, 2);
  });

  it("returns bright yellow at 40 dBZ", () => {
    const [r, g, b] = nwsColor(40);
    expect(r).toBeCloseTo(1.0, 2);
    expect(g).toBeCloseTo(1.0, 2);
    expect(b).toBeCloseTo(0, 2);
  });

  it("returns bright red at 55 dBZ", () => {
    const [r, g, b] = nwsColor(55);
    expect(r).toBeCloseTo(1.0, 2);
    expect(g).toBeCloseTo(0, 2);
    expect(b).toBeCloseTo(0, 2);
  });

  it("returns magenta at 70 dBZ", () => {
    const [r, g, b] = nwsColor(70);
    expect(r).toBeCloseTo(1.0, 2);
    expect(g).toBeCloseTo(0, 2);
    expect(b).toBeCloseTo(1.0, 2);
  });

  it("returns a distinct [r,g,b] at every 5 dBZ threshold step", () => {
    const thresholds = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75];
    const colors = thresholds.map(nwsColor);
    for (let i = 0; i < colors.length - 1; i++) {
      const isSame =
        colors[i][0] === colors[i + 1][0] &&
        colors[i][1] === colors[i + 1][1] &&
        colors[i][2] === colors[i + 1][2];
      expect(isSame, `colors at ${thresholds[i]} and ${thresholds[i + 1]} should differ`).toBe(false);
    }
  });
});
