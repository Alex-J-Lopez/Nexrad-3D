import * as Cesium from "cesium";
import type { RadarSite, RadarVolumeMeta } from "@nexrad-3d/contracts";
import { nwsColor, projectBeamSample } from "../shared/radarGeometry";
import {
  suggestedMeshStride,
  suggestedSampleStride,
  totalPackedBins,
} from "./globeRadarMath";
import { buildGlobeRadarVolumeMesh } from "./globeRadarMesh";

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
  /** Accept pre-built geometry arrays from a worker and draw them; returns triangle count. */
  updateFromWorkerResult(
    positions: Float64Array,
    colors: Uint8Array,
    indices: Uint32Array,
    site: RadarSite
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
        asynchronous: true,
      })
    );

    return mesh.indices.length / 3;
  }

  updateFromWorkerResult(
    positions: Float64Array,
    colors: Uint8Array,
    indices: Uint32Array,
    site: RadarSite
  ): number {
    this.clear();

    if (!Number.isFinite(site.latitude) || !Number.isFinite(site.longitude)) {
      return 0;
    }

    const attributes = new Cesium.GeometryAttributes();
    attributes.position = new Cesium.GeometryAttribute({
      componentDatatype: Cesium.ComponentDatatype.DOUBLE,
      componentsPerAttribute: 3,
      values: positions,
    });
    attributes.color = new Cesium.GeometryAttribute({
      componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
      componentsPerAttribute: 4,
      normalize: true,
      values: colors,
    });

    const geometry = new Cesium.Geometry({
      attributes,
      indices,
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: Cesium.BoundingSphere.fromVertices(positions),
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
        asynchronous: true,
      })
    );

    return indices.length / 3;
  }

  dispose(): void {
    this.clear();
  }
}

export class PointGlobeRadarStrategy implements GlobeRadarRenderStrategy {
  private pointsPrimitive: Cesium.Primitive | undefined;

  constructor(private readonly viewer: Cesium.Viewer) {}

  clear(): void {
    if (this.pointsPrimitive) {
      this.viewer.scene.primitives.remove(this.pointsPrimitive);
      this.pointsPrimitive = undefined;
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

    if (!Number.isFinite(site.latitude) || !Number.isFinite(site.longitude)) return 0;

    const enuToFixed = enuFrameForSite(site);
    const totalCells = totalPackedBins(metadata.sweeps);
    const stride = options?.fullResolution ? 1 : suggestedSampleStride(totalCells, GLOBE_POINT_BUDGET);
    const expectedSamples = totalPackedBins(metadata.sweeps);
    if (expectedSamples > 0 && data.length < expectedSamples) return 0;

    // Count valid points first for pre-allocation
    let count = 0;
    let dataOffset = 0;
    for (const sweep of metadata.sweeps) {
      for (let az = 0; az < sweep.azimuthBins; az += stride) {
        for (let r = 0; r < sweep.radialBins; r += stride) {
          const v = data[dataOffset + az * sweep.radialBins + r];
          if (Number.isFinite(v) && v !== metadata.noDataValue && v >= thresholdDbz) count++;
        }
      }
      dataOffset += sweep.azimuthBins * sweep.radialBins;
    }

    if (count === 0) return 0;

    const positions = new Float64Array(count * 3);
    const colors = new Uint8Array(count * 4);
    let cursor = 0;
    dataOffset = 0;

    for (const sweep of metadata.sweeps) {
      const { azimuthBins, radialBins, elevationAngleDegrees } = sweep;
      for (let az = 0; az < azimuthBins; az += stride) {
        const azRad = (az / azimuthBins) * 2 * Math.PI;
        const sinAz = Math.sin(azRad);
        const cosAz = Math.cos(azRad);
        for (let r = 0; r < radialBins; r += stride) {
          const v = data[dataOffset + az * radialBins + r];
          if (!Number.isFinite(v) || v === metadata.noDataValue || v < thresholdDbz) continue;
          const { horizontalRangeMeters, heightMeters } = projectBeamSample(
            metadata.minRange + r * metadata.radialBinSizeMeters,
            elevationAngleDegrees
          );
          const localEnu = new Cesium.Cartesian3(sinAz * horizontalRangeMeters, cosAz * horizontalRangeMeters, heightMeters);
          const pos = Cesium.Matrix4.multiplyByPoint(enuToFixed, localEnu, new Cesium.Cartesian3());
          const b = cursor * 3;
          positions[b] = pos.x; positions[b + 1] = pos.y; positions[b + 2] = pos.z;
          const [r_, g_, b_] = nwsColor(v);
          const cb = cursor * 4;
          colors[cb] = Math.round(r_ * 255); colors[cb + 1] = Math.round(g_ * 255);
          colors[cb + 2] = Math.round(b_ * 255); colors[cb + 3] = Math.round(0.92 * 255);
          cursor++;
        }
      }
      dataOffset += azimuthBins * radialBins;
    }

    const pointAttributes = new Cesium.GeometryAttributes();
    pointAttributes.position = new Cesium.GeometryAttribute({
      componentDatatype: Cesium.ComponentDatatype.DOUBLE,
      componentsPerAttribute: 3,
      values: positions,
    });
    pointAttributes.color = new Cesium.GeometryAttribute({
      componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
      componentsPerAttribute: 4,
      normalize: true,
      values: colors,
    });

    const geometry = new Cesium.Geometry({
      attributes: pointAttributes,
      primitiveType: Cesium.PrimitiveType.POINTS,
      boundingSphere: Cesium.BoundingSphere.fromVertices(positions),
    });

    const instance = new Cesium.GeometryInstance({
      geometry,
      id: "nexrad-3d-radar-points",
    });

    this.pointsPrimitive = this.viewer.scene.primitives.add(
      new Cesium.Primitive({
        geometryInstances: instance,
        appearance: new Cesium.PerInstanceColorAppearance({
          flat: true,
          translucent: true,
          closed: false,
        }),
        asynchronous: true,
      })
    );

    return cursor;
  }

  updateFromWorkerResult(
    _positions: Float64Array,
    _colors: Uint8Array,
    _indices: Uint32Array,
    _site: RadarSite
  ): number {
    // Points strategy builds geometry on the main thread; worker result is not used.
    return 0;
  }

  dispose(): void {
    this.clear();
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
