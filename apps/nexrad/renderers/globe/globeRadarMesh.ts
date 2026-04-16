import type { RadarVolumeMeta } from "@nexrad-3d/contracts";
import { nwsColor, projectBeamSample } from "../shared/radarGeometry";

export type EcefPoint = { x: number; y: number; z: number };

const MESH_ALPHA_BYTE = Math.round(0.92 * 255);

export type BuildGlobeRadarVolumeMeshOptions = {
  metadata: RadarVolumeMeta;
  data: Float32Array;
  thresholdDbz: number;
  stride: number;
  enuToEcef: (east: number, north: number, up: number) => EcefPoint;
  fillInterSweepGaps?: boolean;
};

export function buildGlobeRadarVolumeMesh(
  options: BuildGlobeRadarVolumeMeshOptions
): { positions: Float64Array; colors: Uint8Array; indices: Uint32Array } | null {
  const { metadata, data, thresholdDbz, stride, enuToEcef } = options;
  const fillInterSweepGaps = options.fillInterSweepGaps !== false;
  const strideClamped = Math.max(1, stride);

  let totalCells = 0;
  for (const s of metadata.sweeps) {
    totalCells += s.azimuthBins * s.radialBins;
  }
  const estimatedVerts = Math.ceil(totalCells / (strideClamped * strideClamped)) * 2;
  const estimatedTris = estimatedVerts * 3;

  const positions = new Float64Array(estimatedVerts * 3);
  const colors = new Uint8Array(estimatedVerts * 4);
  const indices = new Uint32Array(estimatedTris * 3);
  let vertCursor = 0;
  let idxCursor = 0;

  const vertexCache = new Map<number, number>();

  type SweepLayout = {
    dataOffset: number;
    elevationAngleDegrees: number;
    azimuthBins: number;
    radialBins: number;
    sweepIdx: number;
  };

  const layouts: SweepLayout[] = [];
  let dataOffset = 0;
  for (let si = 0; si < metadata.sweeps.length; si++) {
    const sweep = metadata.sweeps[si];
    const { azimuthBins, radialBins } = sweep;
    if (dataOffset + azimuthBins * radialBins > data.length) break;
    layouts.push({
      dataOffset,
      elevationAngleDegrees: sweep.elevationAngleDegrees,
      azimuthBins,
      radialBins,
      sweepIdx: si,
    });
    dataOffset += azimuthBins * radialBins;
  }

  function sampleDbz(layout: SweepLayout, azIdx: number, rIdx: number): number | null {
    const v = data[layout.dataOffset + azIdx * layout.radialBins + rIdx];
    if (!Number.isFinite(v) || v === metadata.noDataValue || v < thresholdDbz) return null;
    return v;
  }

  function decimatedIndices(count: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < count; i += strideClamped) out.push(i);
    return out;
  }

  function vertexKey(sweepIdx: number, ia: number, ir: number): number {
    return (sweepIdx << 21) | (ia << 11) | ir;
  }

  function getOrCreateVertex(layout: SweepLayout, azList: number[], rgList: number[], ia: number, ir: number): number {
    const key = vertexKey(layout.sweepIdx, ia, ir);
    const existing = vertexCache.get(key);
    if (existing !== undefined) return existing;

    const azCell = azList[ia];
    const rCell = rgList[ir];
    const dbz = sampleDbz(layout, azCell, rCell)!;
    const slantMeters = metadata.minRange + rCell * metadata.radialBinSizeMeters;
    const { horizontalRangeMeters, heightMeters } = projectBeamSample(slantMeters, layout.elevationAngleDegrees);
    const azRad = (azCell / layout.azimuthBins) * 2 * Math.PI;
    const p = enuToEcef(
      Math.sin(azRad) * horizontalRangeMeters,
      Math.cos(azRad) * horizontalRangeMeters,
      heightMeters
    );

    const id = vertCursor;
    const pb = id * 3;
    positions[pb] = p.x;
    positions[pb + 1] = p.y;
    positions[pb + 2] = p.z;

    const [r, g, b] = nwsColor(dbz);
    const cb = id * 4;
    colors[cb] = Math.min(255, Math.max(0, Math.round(r * 255)));
    colors[cb + 1] = Math.min(255, Math.max(0, Math.round(g * 255)));
    colors[cb + 2] = Math.min(255, Math.max(0, Math.round(b * 255)));
    colors[cb + 3] = MESH_ALPHA_BYTE;

    vertexCache.set(key, id);
    vertCursor++;
    return id;
  }

  function appendSweepSurface(layout: SweepLayout): void {
    if (layout.azimuthBins < 2 || layout.radialBins < 2) return;
    const azList = decimatedIndices(layout.azimuthBins);
    const rgList = decimatedIndices(layout.radialBins);
    const nAz = azList.length;
    const nR = rgList.length;
    if (nAz < 2 || nR < 2) return;

    for (let ia = 0; ia < nAz; ia++) {
      const iaNext = (ia + 1) % nAz;
      for (let ir = 0; ir < nR - 1; ir++) {
        if (
          sampleDbz(layout, azList[ia], rgList[ir]) === null ||
          sampleDbz(layout, azList[iaNext], rgList[ir]) === null ||
          sampleDbz(layout, azList[iaNext], rgList[ir + 1]) === null ||
          sampleDbz(layout, azList[ia], rgList[ir + 1]) === null
        ) continue;

        const a = getOrCreateVertex(layout, azList, rgList, ia, ir);
        const b = getOrCreateVertex(layout, azList, rgList, iaNext, ir);
        const c = getOrCreateVertex(layout, azList, rgList, iaNext, ir + 1);
        const d = getOrCreateVertex(layout, azList, rgList, ia, ir + 1);
        indices[idxCursor++] = a;
        indices[idxCursor++] = b;
        indices[idxCursor++] = c;
        indices[idxCursor++] = a;
        indices[idxCursor++] = c;
        indices[idxCursor++] = d;
      }
    }
  }

  function appendInterSweepWalls(lower: SweepLayout, upper: SweepLayout): void {
    if (lower.azimuthBins !== upper.azimuthBins || lower.radialBins !== upper.radialBins) return;
    if (lower.azimuthBins < 2 || lower.radialBins < 2) return;
    const azList = decimatedIndices(lower.azimuthBins);
    const rgList = decimatedIndices(lower.radialBins);
    const nAz = azList.length;
    const nR = rgList.length;
    if (nAz < 2 || nR < 2) return;

    for (let ia = 0; ia < nAz; ia++) {
      const iaNext = (ia + 1) % nAz;
      for (let ir = 0; ir < nR - 1; ir++) {
        const l0 = sampleDbz(lower, azList[ia], rgList[ir]) !== null ? getOrCreateVertex(lower, azList, rgList, ia, ir) : null;
        const l1 = sampleDbz(lower, azList[iaNext], rgList[ir]) !== null ? getOrCreateVertex(lower, azList, rgList, iaNext, ir) : null;
        const u1 = sampleDbz(upper, azList[iaNext], rgList[ir]) !== null ? getOrCreateVertex(upper, azList, rgList, iaNext, ir) : null;
        const u0 = sampleDbz(upper, azList[ia], rgList[ir]) !== null ? getOrCreateVertex(upper, azList, rgList, ia, ir) : null;
        if (l0 !== null && l1 !== null && u1 !== null && u0 !== null) {
          indices[idxCursor++] = l0;
          indices[idxCursor++] = l1;
          indices[idxCursor++] = u1;
          indices[idxCursor++] = l0;
          indices[idxCursor++] = u1;
          indices[idxCursor++] = u0;
        }

        const r0 = sampleDbz(lower, azList[ia], rgList[ir]) !== null ? getOrCreateVertex(lower, azList, rgList, ia, ir) : null;
        const r1 = sampleDbz(lower, azList[ia], rgList[ir + 1]) !== null ? getOrCreateVertex(lower, azList, rgList, ia, ir + 1) : null;
        const r1u = sampleDbz(upper, azList[ia], rgList[ir + 1]) !== null ? getOrCreateVertex(upper, azList, rgList, ia, ir + 1) : null;
        const r0u = sampleDbz(upper, azList[ia], rgList[ir]) !== null ? getOrCreateVertex(upper, azList, rgList, ia, ir) : null;
        if (r0 !== null && r1 !== null && r1u !== null && r0u !== null) {
          indices[idxCursor++] = r0;
          indices[idxCursor++] = r1;
          indices[idxCursor++] = r1u;
          indices[idxCursor++] = r0;
          indices[idxCursor++] = r1u;
          indices[idxCursor++] = r0u;
        }
      }
    }
  }

  for (const layout of layouts) {
    appendSweepSurface(layout);
  }

  if (fillInterSweepGaps && layouts.length >= 2) {
    const sorted = [...layouts].sort((a, b) => a.elevationAngleDegrees - b.elevationAngleDegrees);
    for (let s = 0; s < sorted.length - 1; s++) {
      appendInterSweepWalls(sorted[s], sorted[s + 1]);
    }
  }

  if (idxCursor === 0) return null;

  return {
    positions: positions.subarray(0, vertCursor * 3),
    colors: colors.subarray(0, vertCursor * 4),
    indices: indices.subarray(0, idxCursor),
  };
}
