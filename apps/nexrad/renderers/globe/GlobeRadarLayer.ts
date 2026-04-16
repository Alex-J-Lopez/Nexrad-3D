import * as Cesium from "cesium";
import type { RadarSite, RadarVolumeMeta } from "@nexrad-3d/contracts";
import {
  createGlobeRadarStrategy,
  type GlobeRadarRenderMode,
  type GlobeRadarRenderStrategy,
  type GlobeRadarUpdateOptions,
} from "./globeRadarRenderStrategy";

export type { GlobeRadarRenderMode, GlobeRadarRenderStrategy, GlobeRadarUpdateOptions };

/**
 * Owns the active {@link GlobeRadarRenderStrategy} for one {@link Cesium.Viewer}.
 */
export class GlobeRadarLayer {
  private strategy: GlobeRadarRenderStrategy;
  private renderMode: GlobeRadarRenderMode;

  constructor(
    private readonly viewer: Cesium.Viewer,
    initialMode: GlobeRadarRenderMode = "mesh"
  ) {
    this.renderMode = initialMode;
    this.strategy = createGlobeRadarStrategy(viewer, initialMode);
  }

  getRenderMode(): GlobeRadarRenderMode {
    return this.renderMode;
  }

  setRenderMode(mode: GlobeRadarRenderMode): void {
    if (mode === this.renderMode) {
      return;
    }
    this.strategy.dispose();
    this.renderMode = mode;
    this.strategy = createGlobeRadarStrategy(this.viewer, mode);
  }

  clear(): void {
    this.strategy.clear();
  }

  update(
    site: RadarSite,
    metadata: RadarVolumeMeta,
    data: Float32Array,
    thresholdDbz: number,
    options?: GlobeRadarUpdateOptions
  ): number {
    return this.strategy.update(site, metadata, data, thresholdDbz, options);
  }

  updateFromWorkerResult(
    positions: Float64Array,
    colors: Uint8Array,
    indices: Uint32Array,
    site: RadarSite
  ): number {
    return this.strategy.updateFromWorkerResult(positions, colors, indices, site);
  }

  destroy(): void {
    this.strategy.dispose();
  }
}
