import type { RadarVolumeMeta } from "@nexrad-3d/contracts";
import { VolumeProduct } from "@nexrad-3d/contracts";
import { projectBeamSample } from "../shared/radarGeometry";

const ANGLE_INDEX_SIZE = 65_536;
const VALUE_INDEX_SIZE = 16_384;

export interface PackedRadarVolume {
  data: Float32Array;
  width: number;
  height: number;
  radiusSize: number;
  thetaSize: number;
  sweepCount: number;
  raysPerLine: number;
  paddedTheta: number;
  binSizeKm: number;
  innerDistanceKm: number;
  maxRangeKm: number;
  maxHeightKm: number;
}

export interface ValueIndexTexture {
  data: Float32Array;
  lower: number;
  upper: number;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue2rgb = (p: number, q: number, tIn: number): number => {
    let t = tIn;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  if (s === 0) {
    return [l, l, l];
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hue2rgb(p, q, h + 1 / 3),
    hue2rgb(p, q, h),
    hue2rgb(p, q, h - 1 / 3),
  ];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function valueToIndex(lower: number, upper: number, value: number): number {
  const t = clamp01((value - lower) / (upper - lower));
  return Math.min(VALUE_INDEX_SIZE - 1, Math.max(0, Math.round(t * (VALUE_INDEX_SIZE - 1))));
}

function colorRangeHsl(
  out: Float32Array,
  startIndex: number,
  endIndex: number,
  h1: number,
  s1: number,
  l1: number,
  h2: number,
  s2: number,
  l2: number
): void {
  const s = Math.min(startIndex, endIndex);
  const e = Math.max(startIndex, endIndex);
  const span = Math.max(1, e - s);
  for (let i = 0; i <= span; i++) {
    const t = i / span;
    const h = h1 + (h2 - h1) * t;
    const sat = s1 + (s2 - s1) * t;
    const light = l1 + (l2 - l1) * t;
    const [r, g, b] = hslToRgb(h, sat, light);
    const idx = (s + i) * 4;
    out[idx] = r;
    out[idx + 1] = g;
    out[idx + 2] = b;
  }
}

function applyOpacityCutoff(
  valueIndex: Float32Array,
  lower: number,
  upper: number,
  threshold: number,
  opacityMultiplier: number
): void {
  const cutoff = clamp01((threshold - lower) / (upper - lower));
  const cutoffIndex = Math.floor(cutoff * VALUE_INDEX_SIZE);
  for (let i = 0; i < VALUE_INDEX_SIZE; i++) {
    const aIdx = i * 4 + 3;
    if (i < cutoffIndex) {
      valueIndex[aIdx] = 0;
    } else {
      valueIndex[aIdx] *= opacityMultiplier;
    }
  }
}

function buildReflectivityValueIndex(thresholdDbz: number): ValueIndexTexture {
  const lower = -20;
  const upper = 80;
  const out = new Float32Array(VALUE_INDEX_SIZE * 4);

  colorRangeHsl(out, valueToIndex(lower, upper, -20), valueToIndex(lower, upper, 15), 0, 0, 0.1, 0, 0, 0.4);
  colorRangeHsl(out, valueToIndex(lower, upper, 15), valueToIndex(lower, upper, 30), 0.5, 0.6, 0.5, 0.66, 1, 0.5);
  colorRangeHsl(out, valueToIndex(lower, upper, 30), valueToIndex(lower, upper, 40), 0.4, 1, 0.5, 0.33, 1, 0.5);
  colorRangeHsl(out, valueToIndex(lower, upper, 40), valueToIndex(lower, upper, 50), 0.25, 1, 0.5, 0.166, 1, 0.5);
  colorRangeHsl(out, valueToIndex(lower, upper, 50), valueToIndex(lower, upper, 60), 0, 1, 0.5, 0, 1, 0.5);
  colorRangeHsl(out, valueToIndex(lower, upper, 60), valueToIndex(lower, upper, 70), 0.92, 1, 0.5, 0.83, 1, 0.5);
  colorRangeHsl(out, valueToIndex(lower, upper, 70), valueToIndex(lower, upper, 80), 0.83, 0.3, 0.8, 0.83, 0, 1);

  const purpleStart = valueToIndex(lower, upper, 60);
  const purpleEnd = valueToIndex(lower, upper, 70);
  const whiteStart = valueToIndex(lower, upper, 70);
  const whiteEnd = valueToIndex(lower, upper, 80);

  for (let i = 0; i < VALUE_INDEX_SIZE; i++) {
    let value = i / (VALUE_INDEX_SIZE - 1);
    if (i >= purpleStart && i < purpleEnd) {
      value *= 1.5;
    }
    if (i >= whiteStart && i < whiteEnd) {
      value *= 2;
    }
    value *= 2;
    out[i * 4 + 3] = value;
  }

  applyOpacityCutoff(out, lower, upper, thresholdDbz, 1);
  return { data: out, lower, upper };
}

function buildVelocityValueIndex(): ValueIndexTexture {
  const lower = -100;
  const upper = 100;
  const out = new Float32Array(VALUE_INDEX_SIZE * 4);

  colorRangeHsl(out, valueToIndex(lower, upper, -100), valueToIndex(lower, upper, -50), 0.33, 1, 0.5, 0.33, 1, 0.5);
  colorRangeHsl(out, valueToIndex(lower, upper, -50), valueToIndex(lower, upper, 0), 0.33, 1, 0.5, 0.33, 0.2, 0.5);
  colorRangeHsl(out, valueToIndex(lower, upper, 0), valueToIndex(lower, upper, 50), 0.0, 0.2, 0.5, 0.0, 1, 0.5);
  colorRangeHsl(out, valueToIndex(lower, upper, 50), valueToIndex(lower, upper, 100), 0.0, 1, 0.5, 0.0, 1, 0.5);

  for (let i = 0; i < VALUE_INDEX_SIZE; i++) {
    // Provide a consistent baseline alpha for velocity (fading only slightly towards 0)
    // so that clear air mode doesn't completely disappear.
    const normalized = Math.abs(i - 8191.5) / 8191.5;
    const alpha = 0.5 + (normalized * 0.5); // Scale from 0.5 (at 0 velocity) to 1.0 (at max velocity)
    out[i * 4 + 3] = alpha;
  }

  // Still hide absolute theoretical zero if needed to reduce tiny static, 
  // but generally radar noise will fall around it.
  // out[8191 * 4 + 3] = 0; 
  // out[8192 * 4 + 3] = 0;

  return { data: out, lower, upper };
}

function buildSpectrumWidthValueIndex(): ValueIndexTexture {
  const lower = 0;
  const upper = 20;
  const out = new Float32Array(VALUE_INDEX_SIZE * 4);
  const mult = 15;

  colorRangeHsl(out, valueToIndex(lower, upper, 0.0 * mult), valueToIndex(lower, upper, 0.2 * mult), 0.66, 0, 0.2, 0.66, 0, 0.5);
  colorRangeHsl(out, valueToIndex(lower, upper, 0.2 * mult), valueToIndex(lower, upper, 0.5 * mult), 0.66, 0, 0.5, 0.66, 1, 0.5);
  colorRangeHsl(out, valueToIndex(lower, upper, 0.5 * mult), valueToIndex(lower, upper, 0.95 * mult), 0.66, 1, 0.5, 0, 1, 0.5);
  colorRangeHsl(out, valueToIndex(lower, upper, 0.95 * mult), valueToIndex(lower, upper, 0.98 * mult), 0, 1, 0.5, 0, 1, 0.5);
  colorRangeHsl(out, valueToIndex(lower, upper, 0.98 * mult), valueToIndex(lower, upper, 1.01 * mult), 1, 1, 0.5, 0.9, 1, 0.5);
  colorRangeHsl(out, valueToIndex(lower, upper, 1.01 * mult), valueToIndex(lower, upper, upper), 0.9, 1, 0.5, 0.9, 1, 1);

  for (let i = 0; i < VALUE_INDEX_SIZE; i++) {
    out[i * 4 + 3] = i / (VALUE_INDEX_SIZE - 1);
  }
  out[3] = 0;

  return { data: out, lower, upper };
}

function buildCorrelationValueIndex(): ValueIndexTexture {
  const lower = 0;
  const upper = 1.05;
  const out = new Float32Array(VALUE_INDEX_SIZE * 4);

  colorRangeHsl(out, valueToIndex(lower, upper, 0.0), valueToIndex(lower, upper, 0.2), 0.66, 0, 0.2, 0.66, 0, 0.5);
  colorRangeHsl(out, valueToIndex(lower, upper, 0.2), valueToIndex(lower, upper, 0.5), 0.66, 0, 0.5, 0.66, 1, 0.5);
  colorRangeHsl(out, valueToIndex(lower, upper, 0.5), valueToIndex(lower, upper, 0.95), 0.66, 1, 0.5, 0, 1, 0.5);
  colorRangeHsl(out, valueToIndex(lower, upper, 0.95), valueToIndex(lower, upper, 0.98), 0, 1, 0.5, 0, 1, 0.5);
  colorRangeHsl(out, valueToIndex(lower, upper, 0.98), valueToIndex(lower, upper, 1.01), 1, 1, 0.5, 0.9, 1, 0.5);
  colorRangeHsl(out, valueToIndex(lower, upper, 1.01), valueToIndex(lower, upper, 1.05), 0.9, 1, 0.5, 0.9, 1, 0.65);

  for (let i = 0; i < VALUE_INDEX_SIZE; i++) {
    out[i * 4 + 3] = 1;
  }
  out[3] = 0;

  return { data: out, lower, upper };
}

function buildRelativeHueIndex(minValue: number, maxValue: number): ValueIndexTexture {
  const lower = minValue;
  const upper = maxValue;
  const out = new Float32Array(VALUE_INDEX_SIZE * 4);

  colorRangeHsl(out, valueToIndex(0, 100, 0), valueToIndex(0, 100, 90), 0.7, 1, 0.5, 0.01, 1, 0.5);
  colorRangeHsl(out, valueToIndex(0, 100, 90), valueToIndex(0, 100, 95), 0.01, 1, 0.5, 0.0, 1, 0.5);
  colorRangeHsl(out, valueToIndex(0, 100, 95), valueToIndex(0, 100, 100), 0.0, 1, 0.5, 0.0, 1, 0.5);

  for (let i = 0; i < VALUE_INDEX_SIZE; i++) {
    out[i * 4 + 3] = (i / (VALUE_INDEX_SIZE - 1)) * 2;
  }

  return { data: out, lower, upper };
}

export function buildValueIndexTexture(metadata: RadarVolumeMeta, thresholdDbz: number): ValueIndexTexture {
  switch (metadata.product) {
    case VolumeProduct.REFLECTIVITY:
      return buildReflectivityValueIndex(thresholdDbz);
    case VolumeProduct.VELOCITY:
      return buildVelocityValueIndex();
    case VolumeProduct.SPECTRUM_WIDTH:
      return buildSpectrumWidthValueIndex();
    case VolumeProduct.CORRELATION_COEFFICIENT:
      return buildCorrelationValueIndex();
    default:
      return buildRelativeHueIndex(metadata.minValueDb, metadata.maxValueDb);
  }
}

export function buildAngleIndexTexture(metadata: RadarVolumeMeta): Float32Array {
  const out = new Float32Array(ANGLE_INDEX_SIZE);
  out.fill(-1);

  const elevations = metadata.sweeps
    .map((s) => s.elevationAngleDegrees)
    .filter((v) => Number.isFinite(v));

  if (elevations.length === 0) {
    return out;
  }

  if (elevations.length === 1) {
    const e = elevations[0];
    const start = Math.max(0, Math.min(ANGLE_INDEX_SIZE - 1, Math.round(((e - 0.2) * 32768) / 90 + 32768)));
    const end = Math.max(0, Math.min(ANGLE_INDEX_SIZE - 1, Math.round(((e + 0.2) * 32768) / 90 + 32768)));
    for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
      out[i] = 0;
    }
    return out;
  }

  for (let i = 1; i < elevations.length; i++) {
    const start = Math.round((elevations[i - 1] * 32768) / 90 + 32768);
    const end = Math.round((elevations[i] * 32768) / 90 + 32768);
    if (start < 0 || end >= ANGLE_INDEX_SIZE) {
      continue;
    }

    if (end <= start) {
      continue;
    }

    const delta = end - start;
    const baseSweep = i - 1;
    for (let j = 0; j <= delta; j++) {
      out[start + j] = baseSweep + j / delta;
    }
  }

  return out;
}

export function buildPackedRadarVolume(
  data: Float32Array,
  metadata: RadarVolumeMeta,
  maxTextureSize: number
): PackedRadarVolume {
  const sweeps = metadata.sweeps;
  const sweepCount = sweeps.length;
  const radiusSize = Math.max(1, ...sweeps.map((s) => s.radialBins));
  const thetaSize = Math.max(1, ...sweeps.map((s) => s.azimuthBins));
  const paddedTheta = thetaSize + 2;
  const totalLines = paddedTheta * sweepCount;

  const maxTex = Math.max(64, maxTextureSize);
  const raysPerLine = Math.max(1, Math.ceil(totalLines / maxTex));
  const width = Math.max(1, radiusSize * raysPerLine);
  const height = Math.max(1, Math.ceil(totalLines / raysPerLine));

  const noData = Number.isFinite(metadata.noDataValue)
    ? metadata.noDataValue
    : metadata.minValueDb - 1;

  const packed = new Float32Array(width * height);
  packed.fill(noData);

  const setValue = (line: number, radius: number, value: number): void => {
    const actualLine = Math.floor(line / raysPerLine);
    const lineOffset = line % raysPerLine;
    const x = radius + lineOffset * radiusSize;
    packed[actualLine * width + x] = value;
  };

  const copyLine = (srcLine: number, dstLine: number): void => {
    for (let r = 0; r < radiusSize; r++) {
      const srcActualLine = Math.floor(srcLine / raysPerLine);
      const srcLineOffset = srcLine % raysPerLine;
      const srcX = r + srcLineOffset * radiusSize;
      const value = packed[srcActualLine * width + srcX];
      setValue(dstLine, r, value);
    }
  };

  let dataOffset = 0;
  for (let sweepIndex = 0; sweepIndex < sweepCount; sweepIndex++) {
    const sweep = sweeps[sweepIndex];
    const lineStart = sweepIndex * paddedTheta;

    for (let az = 0; az < thetaSize; az++) {
      const outLine = lineStart + az + 1;
      for (let r = 0; r < radiusSize; r++) {
        let value = noData;
        if (az < sweep.azimuthBins && r < sweep.radialBins) {
          const srcIndex = dataOffset + az * sweep.radialBins + r;
          if (srcIndex >= 0 && srcIndex < data.length) {
            value = data[srcIndex];
          }
        }
        setValue(outLine, r, value);
      }
    }

    const firstValid = lineStart + 1;
    const lastValid = lineStart + Math.max(1, Math.min(thetaSize, sweep.azimuthBins));
    copyLine(lastValid, lineStart);
    copyLine(firstValid, lineStart + thetaSize + 1);

    dataOffset += sweep.azimuthBins * sweep.radialBins;
  }

  const binSizeKm = Math.max(metadata.radialBinSizeMeters, 1) / 1000;
  const innerDistanceKm = Math.max(metadata.minRange, 0) / 1000;
  const maxRangeKm = Math.max(metadata.maxRange, metadata.minRange) / 1000;

  let maxHeightKm = 1;
  for (const sweep of sweeps) {
    const projected = projectBeamSample(Math.max(metadata.maxRange, metadata.minRange), sweep.elevationAngleDegrees);
    maxHeightKm = Math.max(maxHeightKm, (projected.heightMeters / 1000) * 3);
  }

  return {
    data: packed,
    width,
    height,
    radiusSize,
    thetaSize,
    sweepCount,
    raysPerLine,
    paddedTheta,
    binSizeKm,
    innerDistanceKm,
    maxRangeKm,
    maxHeightKm,
  };
}
