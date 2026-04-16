import * as Cesium from "cesium";
import type { RadarSite, RadarVolumeMeta } from "@nexrad-3d/contracts";
import { nwsColor, projectBeamSample } from "./radarGeometry.js";
import {
  suggestedMeshStride,
  suggestedSampleStride,
  totalPackedBins,
} from "./globeRadarMath.js";
import { buildGlobeRadarVolumeMesh } from "./globeRadarMesh.js";

/** How radar samples are drawn on the Cesium globe (strategy pattern). */
export type GlobeRadarRenderMode = "mesh" | "points";

export interface GlobeRadarUpdateOptions {
  /**
   * Use native azimuth/range grid step (stride 1) for points and mesh decimation.
   * Much heavier on GPU/CPU than the default budgets — use for inspection only.
   */
  fullResolution?: boolean;
}

export interface GlobeRadarRenderStrategy {
  /** Remove all drawn geometry but keep GPU resources owned by this strategy. */
  clear(): void;
  /** Draw or refresh radar for the current volume; returns a draw-count hint (triangles or points). */
  update(
    site: RadarSite,
    metadata: RadarVolumeMeta,
    data: Float32Array,
    thresholdDbz: number,
    options?: GlobeRadarUpdateOptions
  ): number;
  /** Tear down primitives/collections; safe to call more than once. */
  dispose(): void;
}

const GLOBE_POINT_BUDGET = 280_000;

/**
 * Target upper bound on triangles for the globe radar mesh (surfaces + inter-tilt walls).
 */
const GLOBE_MESH_TRIANGLE_BUDGET = 380_000;

function enuFrameForSite(site: RadarSite): Cesium.Matrix4 {
  const radarAltMeters = Number.isFinite(site.elevationMeters) ? Math.max(0, site.elevationMeters) : 0;
  const center = Cesium.Cartesian3.fromDegrees(site.longitude, site.latitude, radarAltMeters);
  return Cesium.Transforms.eastNorthUpToFixedFrame(center);
}

export class MeshGlobeRadarStrategy implements GlobeRadarRenderStrategy {
  private meshPrimitive: Cesium.Primitive | undefined;

  constructor(private readonly viewer: Cesium.Viewer) {}

  clear(): void {
    if (this.meshPrimitive) {
      this.viewer.scene.primitives.remove(this.meshPrimitive);
      this.meshPrimitive = undefined;
    }
  }

  update(
    site: RadarSite,
    metadata: RadarVolumeMeta,
    data: Float32Array,
    thresholdDbz: number,
    options?: GlobeRadarUpdateOptions
  ): number {
    this.clear();

    if (!Number.isFinite(site.latitude) || !Number.isFinite(site.longitude)) {
      return 0;
    }

    const enuToFixed = enuFrameForSite(site);

    const sweepCount = Math.max(1, metadata.sweeps.length);
    let maxAz = 0;
    let maxRg = 0;
    for (const s of metadata.sweeps) {
      maxAz = Math.max(maxAz, s.azimuthBins);
      maxRg = Math.max(maxRg, s.radialBins);
    }

    const triangleBudgetPerSweep = Math.max(
      4000,
      Math.floor(GLOBE_MESH_TRIANGLE_BUDGET / sweepCount)
    );
    const stride = options?.fullResolution
      ? 1
      : suggestedMeshStride(maxAz, maxRg, triangleBudgetPerSweep);

    const expectedSamples = totalPackedBins(metadata.sweeps);
    if (expectedSamples > 0 && data.length < expectedSamples) {
      return 0;
    }

    const mesh = buildGlobeRadarVolumeMesh({
      metadata,
      data,
      thresholdDbz,
      stride,
      enuToEcef: (east, north, up) => {
        const localEnu = new Cesium.Cartesian3(east, north, up);
        const position = Cesium.Matrix4.multiplyByPoint(enuToFixed, localEnu, new Cesium.Cartesian3());
        return { x: position.x, y: position.y, z: position.z };
      },
    });

    if (!mesh) {
      return 0;
    }

    const attributes = new Cesium.GeometryAttributes();
    attributes.position = new Cesium.GeometryAttribute({
      componentDatatype: Cesium.ComponentDatatype.DOUBLE,
      componentsPerAttribute: 3,
      values: mesh.positions,
    });
    attributes.color = new Cesium.GeometryAttribute({
      componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
      componentsPerAttribute: 4,
      normalize: true,
      values: mesh.colors,
    });

    const geometry = new Cesium.Geometry({
      attributes,
      indices: mesh.indices,
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: Cesium.BoundingSphere.fromVertices(mesh.positions),
    });

    const instance = new Cesium.GeometryInstance({
      geometry,
      id: "nexrad-3d-radar-volume",
    });

    this.meshPrimitive = this.viewer.scene.primitives.add(
      new Cesium.Primitive({
        geometryInstances: instance,
        appearance: new Cesium.PerInstanceColorAppearance({
          flat: true,
          translucent: true,
          closed: false,
        }),
        asynchronous: false,
      })
    );

    return mesh.indices.length / 3;
  }

  dispose(): void {
    this.clear();
  }
}

export class PointGlobeRadarStrategy implements GlobeRadarRenderStrategy {
  private readonly collection: Cesium.PointPrimitiveCollection;

  constructor(private readonly viewer: Cesium.Viewer) {
    this.collection = this.viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
  }

  clear(): void {
    this.collection.removeAll();
  }

  update(
    site: RadarSite,
    metadata: RadarVolumeMeta,
    data: Float32Array,
    thresholdDbz: number,
    options?: GlobeRadarUpdateOptions
  ): number {
    this.clear();

    if (!Number.isFinite(site.latitude) || !Number.isFinite(site.longitude)) {
      return 0;
    }

    const enuToFixed = enuFrameForSite(site);

    const totalCells = totalPackedBins(metadata.sweeps);
    const stride = options?.fullResolution
      ? 1
      : suggestedSampleStride(totalCells, GLOBE_POINT_BUDGET);

    const expectedSamples = totalPackedBins(metadata.sweeps);
    if (expectedSamples > 0 && data.length < expectedSamples) {
      return 0;
    }

    let drawn = 0;
    let dataOffset = 0;

    for (const sweep of metadata.sweeps) {
      const { azimuthBins, radialBins, elevationAngleDegrees } = sweep;

      for (let azIdx = 0; azIdx < azimuthBins; azIdx += stride) {
        const azRad = (azIdx / azimuthBins) * 2 * Math.PI;
        const sinAz = Math.sin(azRad);
        const cosAz = Math.cos(azRad);

        for (let rIdx = 0; rIdx < radialBins; rIdx += stride) {
          const sample = data[dataOffset + azIdx * radialBins + rIdx];
          if (
            !Number.isFinite(sample) ||
            sample === metadata.noDataValue ||
            sample < thresholdDbz
          ) {
            continue;
          }

          const slantMeters = metadata.minRange + rIdx * metadata.radialBinSizeMeters;
          const { horizontalRangeMeters, heightMeters } = projectBeamSample(
            slantMeters,
            elevationAngleDegrees
          );

          const east = sinAz * horizontalRangeMeters;
          const north = cosAz * horizontalRangeMeters;
          const up = heightMeters;

          const localEnu = new Cesium.Cartesian3(east, north, up);
          const position = Cesium.Matrix4.multiplyByPoint(enuToFixed, localEnu, new Cesium.Cartesian3());

          const [r, g, b] = nwsColor(sample);
          this.collection.add({
            position,
            color: new Cesium.Color(r, g, b, 0.92),
            pixelSize: 2.5,
          });
          drawn += 1;
        }
      }

      dataOffset += azimuthBins * radialBins;
    }

    return drawn;
  }

  dispose(): void {
    this.viewer.scene.primitives.remove(this.collection);
  }
}

export function createGlobeRadarStrategy(
  viewer: Cesium.Viewer,
  mode: GlobeRadarRenderMode
): GlobeRadarRenderStrategy {
  switch (mode) {
    case "points":
      return new PointGlobeRadarStrategy(viewer);
    case "mesh":
    default:
      return new MeshGlobeRadarStrategy(viewer);
  }
}
