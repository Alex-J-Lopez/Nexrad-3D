import type { RadarVolumeMeta } from "@nexrad-3d/contracts";
import { nwsColor, projectBeamSample } from "./radarGeometry.js";

/** ECEF meters (WGS84) from site ENU. */
export type EcefPoint = { x: number; y: number; z: number };

const MESH_ALPHA_BYTE = Math.round(0.92 * 255);

function decimatedAxisIndices(binCount: number, stride: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < binCount; i += stride) {
    out.push(i);
  }
  return out;
}

function sampleDbz(
  data: Float32Array,
  baseOffset: number,
  azimuthBins: number,
  radialBins: number,
  azIdx: number,
  rIdx: number,
  noDataValue: number,
  thresholdDbz: number
): number | null {
  const v = data[baseOffset + azIdx * radialBins + rIdx];
  if (!Number.isFinite(v) || v === noDataValue || v < thresholdDbz) {
    return null;
  }
  return v;
}

type SweepLayout = {
  dataOffset: number;
  elevationAngleDegrees: number;
  azimuthBins: number;
  radialBins: number;
};

function buildSweepLayouts(metadata: RadarVolumeMeta, data: Float32Array): SweepLayout[] {
  const layouts: SweepLayout[] = [];
  let dataOffset = 0;
  for (const sweep of metadata.sweeps) {
    const { azimuthBins, radialBins } = sweep;
    if (dataOffset + azimuthBins * radialBins > data.length) {
      break;
    }
    layouts.push({
      dataOffset,
      elevationAngleDegrees: sweep.elevationAngleDegrees,
      azimuthBins,
      radialBins,
    });
    dataOffset += azimuthBins * radialBins;
  }
  return layouts;
}

function pushVertex(
  posList: number[],
  colList: number[],
  vertexCache: Map<string, number>,
  cacheKey: string,
  p: EcefPoint,
  dbz: number
): number {
  const existing = vertexCache.get(cacheKey);
  if (existing !== undefined) {
    return existing;
  }
  const id = posList.length / 3;
  vertexCache.set(cacheKey, id);
  posList.push(p.x, p.y, p.z);
  const [r, g, b] = nwsColor(dbz);
  colList.push(
    Math.min(255, Math.max(0, Math.round(r * 255))),
    Math.min(255, Math.max(0, Math.round(g * 255))),
    Math.min(255, Math.max(0, Math.round(b * 255))),
    MESH_ALPHA_BYTE
  );
  return id;
}

function cornerValid(
  data: Float32Array,
  layout: SweepLayout,
  azList: number[],
  rgList: number[],
  ia: number,
  ir: number,
  noDataValue: number,
  thresholdDbz: number
): boolean {
  return (
    sampleDbz(
      data,
      layout.dataOffset,
      layout.azimuthBins,
      layout.radialBins,
      azList[ia],
      rgList[ir],
      noDataValue,
      thresholdDbz
    ) !== null
  );
}

function cornerDbz(
  data: Float32Array,
  layout: SweepLayout,
  azList: number[],
  rgList: number[],
  ia: number,
  ir: number,
  noDataValue: number,
  thresholdDbz: number
): number {
  return sampleDbz(
    data,
    layout.dataOffset,
    layout.azimuthBins,
    layout.radialBins,
    azList[ia],
    rgList[ir],
    noDataValue,
    thresholdDbz
  )!;
}

function vertexKey(dataOffset: number, ia: number, ir: number): string {
  return `${dataOffset}\0${ia}\0${ir}`;
}

function appendSweepSurface(
  posList: number[],
  colList: number[],
  idxList: number[],
  vertexCache: Map<string, number>,
  options: {
    layout: SweepLayout;
    metadata: RadarVolumeMeta;
    data: Float32Array;
    thresholdDbz: number;
    stride: number;
    enuToEcef: (east: number, north: number, up: number) => EcefPoint;
  }
): void {
  const { layout, metadata, data, thresholdDbz, stride, enuToEcef } = options;
  const { azimuthBins, radialBins, elevationAngleDegrees, dataOffset } = layout;
  if (azimuthBins < 2 || radialBins < 2) {
    return;
  }

  const strideClamped = Math.max(1, stride);
  const azList = decimatedAxisIndices(azimuthBins, strideClamped);
  const rgList = decimatedAxisIndices(radialBins, strideClamped);
  const nAz = azList.length;
  const nR = rgList.length;
  if (nAz < 2 || nR < 2) {
    return;
  }

  const vmap = new Int32Array(nAz * nR).fill(-1);

  const cValid = (ia: number, ir: number) =>
    cornerValid(data, layout, azList, rgList, ia, ir, metadata.noDataValue, thresholdDbz);
  const cDbz = (ia: number, ir: number) =>
    cornerDbz(data, layout, azList, rgList, ia, ir, metadata.noDataValue, thresholdDbz);

  const vertexId = (ia: number, ir: number): number => {
    const key = ia * nR + ir;
    const existing = vmap[key];
    if (existing >= 0) {
      return existing;
    }
    const azCell = azList[ia];
    const rCell = rgList[ir];
    const dbz = cDbz(ia, ir);
    const slantMeters = metadata.minRange + rCell * metadata.radialBinSizeMeters;
    const { horizontalRangeMeters, heightMeters } = projectBeamSample(
      slantMeters,
      elevationAngleDegrees
    );
    const azRad = (azCell / azimuthBins) * 2 * Math.PI;
    const sinAz = Math.sin(azRad);
    const cosAz = Math.cos(azRad);
    const east = sinAz * horizontalRangeMeters;
    const north = cosAz * horizontalRangeMeters;
    const up = heightMeters;
    const p = enuToEcef(east, north, up);
    const cacheKey = vertexKey(dataOffset, ia, ir);
    const id = pushVertex(posList, colList, vertexCache, cacheKey, p, dbz);
    vmap[key] = id;
    return id;
  };

  for (let ia = 0; ia < nAz; ia++) {
    const iaNext = (ia + 1) % nAz;
    for (let ir = 0; ir < nR - 1; ir++) {
      if (!cValid(ia, ir) || !cValid(iaNext, ir) || !cValid(iaNext, ir + 1) || !cValid(ia, ir + 1)) {
        continue;
      }
      const a = vertexId(ia, ir);
      const b = vertexId(iaNext, ir);
      const c = vertexId(iaNext, ir + 1);
      const d = vertexId(ia, ir + 1);
      idxList.push(a, b, c, a, c, d);
    }
  }
}

/**
 * Vertical walls between lower and upper tilt: two faces per polar cell (azimuth step and range step)
 * so each interior seam is drawn once.
 */
function appendInterSweepWalls(
  posList: number[],
  colList: number[],
  idxList: number[],
  vertexCache: Map<string, number>,
  lower: SweepLayout,
  upper: SweepLayout,
  metadata: RadarVolumeMeta,
  data: Float32Array,
  thresholdDbz: number,
  stride: number,
  enuToEcef: (east: number, north: number, up: number) => EcefPoint
): void {
  if (
    lower.azimuthBins !== upper.azimuthBins ||
    lower.radialBins !== upper.radialBins ||
    lower.azimuthBins < 2 ||
    lower.radialBins < 2
  ) {
    return;
  }

  const azimuthBins = lower.azimuthBins;
  const radialBins = lower.radialBins;
  const strideClamped = Math.max(1, stride);
  const azList = decimatedAxisIndices(azimuthBins, strideClamped);
  const rgList = decimatedAxisIndices(radialBins, strideClamped);
  const nAz = azList.length;
  const nR = rgList.length;
  if (nAz < 2 || nR < 2) {
    return;
  }

  const mkVert = (layout: SweepLayout, ia: number, ir: number): number | null => {
    if (!cornerValid(data, layout, azList, rgList, ia, ir, metadata.noDataValue, thresholdDbz)) {
      return null;
    }
    const dbz = cornerDbz(data, layout, azList, rgList, ia, ir, metadata.noDataValue, thresholdDbz);
    const azCell = azList[ia];
    const rCell = rgList[ir];
    const slantMeters = metadata.minRange + rCell * metadata.radialBinSizeMeters;
    const { horizontalRangeMeters, heightMeters } = projectBeamSample(
      slantMeters,
      layout.elevationAngleDegrees
    );
    const azRad = (azCell / azimuthBins) * 2 * Math.PI;
    const sinAz = Math.sin(azRad);
    const cosAz = Math.cos(azRad);
    const p = enuToEcef(
      sinAz * horizontalRangeMeters,
      cosAz * horizontalRangeMeters,
      heightMeters
    );
    const key = vertexKey(layout.dataOffset, ia, ir);
    return pushVertex(posList, colList, vertexCache, key, p, dbz);
  };

  for (let ia = 0; ia < nAz; ia++) {
    const iaNext = (ia + 1) % nAz;
    for (let ir = 0; ir < nR - 1; ir++) {
      // Wall along azimuth (constant inner range index ir): (ia,ir)-(iaNext,ir)
      const L0 = mkVert(lower, ia, ir);
      const L1 = mkVert(lower, iaNext, ir);
      const U1 = mkVert(upper, iaNext, ir);
      const U0 = mkVert(upper, ia, ir);
      if (L0 !== null && L1 !== null && U1 !== null && U0 !== null) {
        idxList.push(L0, L1, U1, L0, U1, U0);
      }

      // Wall along range (constant ia): (ia,ir)-(ia,ir+1)
      const R0 = mkVert(lower, ia, ir);
      const R1 = mkVert(lower, ia, ir + 1);
      const R1u = mkVert(upper, ia, ir + 1);
      const R0u = mkVert(upper, ia, ir);
      if (R0 !== null && R1 !== null && R1u !== null && R0u !== null) {
        idxList.push(R0, R1, R1u, R0, R1u, R0u);
      }
    }
  }
}

export type BuildGlobeRadarVolumeMeshOptions = {
  metadata: RadarVolumeMeta;
  data: Float32Array;
  thresholdDbz: number;
  stride: number;
  enuToEcef: (east: number, north: number, up: number) => EcefPoint;
  /**
   * When true (default), adds vertical walls between consecutive elevation tilts
   * so the volume is closed between scan levels (same azimuth/range grid).
   */
  fillInterSweepGaps?: boolean;
};

/**
 * Builds a triangle mesh over the polar (azimuth × range) grid per sweep, in ECEF,
 * with NWS colors per vertex. Quads connect decimated bins; the azimuth axis wraps
 * (last column connects to the first). Optionally stitches adjacent tilts with sidewalls.
 */
export function buildGlobeRadarVolumeMesh(
  options: BuildGlobeRadarVolumeMeshOptions
): { positions: Float64Array; colors: Uint8Array; indices: Uint32Array } | null {
  const { metadata, data, thresholdDbz, stride, enuToEcef } = options;
  const fillInterSweepGaps = options.fillInterSweepGaps !== false;

  const posList: number[] = [];
  const colList: number[] = [];
  const idxList: number[] = [];
  const vertexCache = new Map<string, number>();

  const layouts = buildSweepLayouts(metadata, data);
  for (const layout of layouts) {
    appendSweepSurface(posList, colList, idxList, vertexCache, {
      layout,
      metadata,
      data,
      thresholdDbz,
      stride,
      enuToEcef,
    });
  }

  if (fillInterSweepGaps && layouts.length >= 2) {
    const sorted = layouts.slice().sort((a, b) => a.elevationAngleDegrees - b.elevationAngleDegrees);
    for (let s = 0; s < sorted.length - 1; s++) {
      appendInterSweepWalls(
        posList,
        colList,
        idxList,
        vertexCache,
        sorted[s]!,
        sorted[s + 1]!,
        metadata,
        data,
        thresholdDbz,
        stride,
        enuToEcef
      );
    }
  }

  if (idxList.length === 0) {
    return null;
  }

  return {
    positions: new Float64Array(posList),
    colors: new Uint8Array(colList),
    indices: new Uint32Array(idxList),
  };
}
