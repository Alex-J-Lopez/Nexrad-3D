import { describe, it, expect } from "vitest";
import { buildGlobeRadarVolumeMesh } from "./globeRadarMesh.js";
import type { RadarVolumeMeta } from "@nexrad-3d/contracts";
import { VolumeProduct } from "@nexrad-3d/contracts";

function makeMeta(overrides: Partial<RadarVolumeMeta> = {}): RadarVolumeMeta {
  return {
    volumeId: "test-mesh",
    siteId: "TEST",
    product: VolumeProduct.REFLECTIVITY,
    generatedAtMs: 0,
    sweeps: [
      { sweepIndex: 0, elevationAngleDegrees: 0, azimuthBins: 4, radialBins: 3 },
    ],
    radialBinSizeMeters: 1000,
    minRange: 0,
    maxRange: 3000,
    minValueDb: -32,
    maxValueDb: 75,
    noDataValue: -999,
    storageKey: "",
    ...overrides,
  };
}

describe("buildGlobeRadarVolumeMesh", () => {
  it("emits wrapped quads as triangles with shared vertices", () => {
    const metadata = makeMeta();

    const cells = 4 * 3;
    const data = new Float32Array(cells);
    data.fill(20);

    const mesh = buildGlobeRadarVolumeMesh({
      metadata,
      data,
      thresholdDbz: 15,
      stride: 1,
      enuToEcef: (e, n, u) => ({ x: e, y: n, z: u }),
    });

    expect(mesh).not.toBeNull();
    const m = mesh!;
    // nAz=4, nR=3 → 4 * 2 quads → 8 quads → 16 triangles → 48 indices
    expect(m.indices.length).toBe(48);
    expect(m.positions.length / 3).toBe(4 * 3);
    expect(m.colors.length / 4).toBe(4 * 3);
  });

  it("returns null when no corners pass threshold", () => {
    const metadata = makeMeta();
    const data = new Float32Array(4 * 3);
    data.fill(5);

    expect(
      buildGlobeRadarVolumeMesh({
        metadata,
        data,
        thresholdDbz: 15,
        stride: 1,
        enuToEcef: (e, n, u) => ({ x: e, y: n, z: u }),
      })
    ).toBeNull();
  });

  it("adds sidewalls between consecutive elevation tilts when grids match", () => {
    const metadata = makeMeta({
      sweeps: [
        { sweepIndex: 0, elevationAngleDegrees: 0.5, azimuthBins: 4, radialBins: 3 },
        { sweepIndex: 1, elevationAngleDegrees: 1.5, azimuthBins: 4, radialBins: 3 },
      ],
    });
    const data = new Float32Array(4 * 3 * 2).fill(20);

    const mesh = buildGlobeRadarVolumeMesh({
      metadata,
      data,
      thresholdDbz: 15,
      stride: 1,
      enuToEcef: (e, n, u) => ({ x: e, y: n, z: u }),
    });

    expect(mesh).not.toBeNull();
    // Two surfaces: 48 + 48 indices; one tilt pair: 4×2 cells × (2 walls × 6 indices) = 96
    expect(mesh!.indices.length).toBe(96 + 96);
  });

  it("skips inter-tilt walls when fillInterSweepGaps is false", () => {
    const metadata = makeMeta({
      sweeps: [
        { sweepIndex: 0, elevationAngleDegrees: 0.5, azimuthBins: 4, radialBins: 3 },
        { sweepIndex: 1, elevationAngleDegrees: 1.5, azimuthBins: 4, radialBins: 3 },
      ],
    });
    const data = new Float32Array(4 * 3 * 2).fill(20);

    const mesh = buildGlobeRadarVolumeMesh({
      metadata,
      data,
      thresholdDbz: 15,
      stride: 1,
      enuToEcef: (e, n, u) => ({ x: e, y: n, z: u }),
      fillInterSweepGaps: false,
    });

    expect(mesh).not.toBeNull();
    expect(mesh!.indices.length).toBe(96);
  });
});
