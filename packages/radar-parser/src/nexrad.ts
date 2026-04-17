import { VolumeProduct, type SweepInfo, type VolumeArtifact } from "@nexrad-3d/contracts";
import {
  Level2Radar,
  type HighResData,
  type MessageHeader,
} from "nexrad-level-2-data";
import type { ParserLoadContext, RadarReader } from "./index.js";

const DEFAULT_AZIMUTH_BINS = 360;
const DEFAULT_RADIAL_BINS = 200;
const DEFAULT_BIN_SIZE_METERS = 250;
const NO_DATA_VALUE = -9999;

interface ParsedSweep {
  sweepInfo: SweepInfo;
  values: Float32Array;
  radialBinSizeMeters: number;
  firstGateMeters: number;
}

export function isLikelyNexradFile(filename: string, fileBuffer: ArrayBuffer): boolean {
  const normalized = filename.toUpperCase();

  if (/^[A-Z0-9]{4}_?\d{8}_?\d{6}/.test(normalized)) {
    return true;
  }

  if (normalized.endsWith(".AR2V") || normalized.includes("_V0")) {
    return true;
  }

  const bytes = new Uint8Array(fileBuffer.slice(0, 2));
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  return isGzip;
}

export function parseNexradGeneratedAtMs(filename: string): number | null {
  const match = filename.match(/(\d{8})_?(\d{6})/);
  if (!match) {
    return null;
  }

  const date = match[1];
  const time = match[2];

  const year = Number.parseInt(date.slice(0, 4), 10);
  const month = Number.parseInt(date.slice(4, 6), 10) - 1;
  const day = Number.parseInt(date.slice(6, 8), 10);

  const hour = Number.parseInt(time.slice(0, 2), 10);
  const minute = Number.parseInt(time.slice(2, 4), 10);
  const second = Number.parseInt(time.slice(4, 6), 10);

  if ([year, month, day, hour, minute, second].some((value) => Number.isNaN(value))) {
    return null;
  }

  return Date.UTC(year, month, day, hour, minute, second);
}

export function parseSiteIdFromFilename(filename: string): string | null {
  const match = filename.toUpperCase().match(/^([A-Z0-9]{4})/);
  return match ? match[1] : null;
}

function normalizeAzimuthIndex(azimuthDegrees: number): number {
  const rounded = Math.round(azimuthDegrees);
  const normalized = ((rounded % DEFAULT_AZIMUTH_BINS) + DEFAULT_AZIMUTH_BINS) % DEFAULT_AZIMUTH_BINS;
  return normalized;
}

function normalizeArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function validMomentSample(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function resolveMomentBlocks(radar: Level2Radar, product: VolumeProduct): HighResData[] {
  let raw: unknown;
  switch (product) {
    case VolumeProduct.REFLECTIVITY:
      raw = radar.getHighresReflectivity();
      break;
    case VolumeProduct.VELOCITY:
      raw = radar.getHighresVelocity();
      break;
    case VolumeProduct.SPECTRUM_WIDTH:
      raw = radar.getHighresSpectrum();
      break;
    case VolumeProduct.DIFFERENTIAL_REFLECTIVITY:
      raw = radar.getHighresDiffReflectivity();
      break;
    case VolumeProduct.CORRELATION_COEFFICIENT:
      raw = radar.getHighresCorrelationCoefficient();
      break;
    case VolumeProduct.DIFFERENTIAL_PHASE:
      raw = radar.getHighresDiffPhase();
      break;
    default:
      throw new Error(`Unsupported decoded product: ${product}`);
  }

  return normalizeArray(raw as HighResData | HighResData[] | undefined);
}

function isHighResData(block: unknown): block is HighResData {
  return block != null && typeof block === "object" && "moment_data" in (block as object);
}

function pickGateSizeMeters(momentBlocks: (HighResData | undefined)[]): number {
  for (const block of momentBlocks) {
    if (!isHighResData(block)) {
      continue;
    }
    if (typeof block.gate_size === "number" && block.gate_size > 0) {
      return block.gate_size * 1000;
    }
  }

  return DEFAULT_BIN_SIZE_METERS;
}

function pickFirstGateMeters(momentBlocks: (HighResData | undefined)[]): number {
  let firstGateMeters = Number.POSITIVE_INFINITY;

  for (const block of momentBlocks) {
    if (!isHighResData(block)) {
      continue;
    }
    if (typeof block.first_gate === "number" && Number.isFinite(block.first_gate)) {
      firstGateMeters = Math.min(firstGateMeters, block.first_gate * 1000);
    }
  }

  return Number.isFinite(firstGateMeters) ? Math.max(0, firstGateMeters) : 0;
}

function readHeader(radar: Level2Radar): MessageHeader | null {
  try {
    const header = radar.getHeader(0);
    return Array.isArray(header) ? header[0] ?? null : header;
  } catch {
    return null;
  }
}

/** Level-II Volume block: antenna lat/lon and feedhorn height (see NEXRAD Message 31 VOL). */
function extractRadarGeoreference(radar: Level2Radar):
  | {
      radarLatitudeDegrees: number;
      radarLongitudeDegrees: number;
      radarAntennaHeightMeters?: number;
    }
  | undefined {
  const header = readHeader(radar);
  const vol = header?.volume;
  if (!vol || typeof vol.latitude !== "number" || typeof vol.longitude !== "number") {
    return undefined;
  }
  if (!Number.isFinite(vol.latitude) || !Number.isFinite(vol.longitude)) {
    return undefined;
  }
  const out: {
    radarLatitudeDegrees: number;
    radarLongitudeDegrees: number;
    radarAntennaHeightMeters?: number;
  } = {
    radarLatitudeDegrees: vol.latitude,
    radarLongitudeDegrees: vol.longitude,
  };
  if (typeof vol.feedhorn_height === "number" && Number.isFinite(vol.feedhorn_height)) {
    out.radarAntennaHeightMeters = vol.feedhorn_height;
  }
  return out;
}

function fillMissingAzimuthRows(
  sweepValues: Float32Array,
  radialBins: number,
  populatedRows: boolean[],
  noDataValue: number
): void {
  if (radialBins <= 0) {
    return;
  }

  const rowCount = populatedRows.length;
  if (rowCount === 0 || populatedRows.every((row) => !row)) {
    return;
  }

  const findNearest = (start: number, direction: 1 | -1): number | null => {
    for (let step = 1; step < rowCount; step += 1) {
      const row = (start + direction * step + rowCount) % rowCount;
      if (populatedRows[row]) {
        return row;
      }
    }

    return null;
  };

  for (let row = 0; row < rowCount; row += 1) {
    if (populatedRows[row]) {
      continue;
    }

    const previousRow = findNearest(row, -1);
    const nextRow = findNearest(row, 1);
    const donorRow = previousRow ?? nextRow;
    if (donorRow === null) {
      continue;
    }

    const srcOffset = donorRow * radialBins;
    const dstOffset = row * radialBins;
    for (let radial = 0; radial < radialBins; radial += 1) {
      const sourceValue = sweepValues[srcOffset + radial];
      sweepValues[dstOffset + radial] = sourceValue === noDataValue ? noDataValue : sourceValue;
    }
  }
}

function loadBootstrapVolume(
  sourceBuffer: ArrayBuffer,
  product: VolumeProduct,
  context: ParserLoadContext
): VolumeArtifact {
  const bytes = new Uint8Array(sourceBuffer);
  const generatedAtMs =
    context.generatedAtMs ??
    parseNexradGeneratedAtMs(context.filename) ??
    Date.now();

  const siteId = context.siteId ?? parseSiteIdFromFilename(context.filename) ?? "UNKN";

  const radialCellCount = DEFAULT_AZIMUTH_BINS * DEFAULT_RADIAL_BINS;
  const data = new Float32Array(radialCellCount);
  data.fill(NO_DATA_VALUE);

  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;

  const sampleCount = Math.min(bytes.length, radialCellCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const value = bytes[index] / 2 - 32;
    data[index] = value;

    if (value < minValue) {
      minValue = value;
    }

    if (value > maxValue) {
      maxValue = value;
    }
  }

  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    minValue = 0;
    maxValue = 0;
  }

  const sweeps: SweepInfo[] = [
    {
      sweepIndex: 0,
      elevationAngleDegrees: 0.5,
      azimuthBins: DEFAULT_AZIMUTH_BINS,
      radialBins: DEFAULT_RADIAL_BINS,
    },
  ];

  return {
    data,
    metadata: {
      volumeId: `${siteId}-${generatedAtMs}-${product}`,
      siteId,
      product,
      generatedAtMs,
      sweeps,
      radialBinSizeMeters: DEFAULT_BIN_SIZE_METERS,
      minRange: 0,
      maxRange: DEFAULT_BIN_SIZE_METERS * DEFAULT_RADIAL_BINS,
      minValueDb: minValue,
      maxValueDb: maxValue,
      noDataValue: NO_DATA_VALUE,
      storageKey: "",
      decodeMode: "bootstrap-byte-map",
    },
  };
}

function loadDecodedVolume(
  sourceBuffer: ArrayBuffer,
  product: VolumeProduct,
  context: ParserLoadContext
): VolumeArtifact {
  const radar = new Level2Radar(Buffer.from(sourceBuffer), {
    logger: false,
  });

  const elevations = radar
    .listElevations()
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  if (elevations.length === 0) {
    throw new Error("No elevations found in NEXRAD archive");
  }

  const parsedSweeps: ParsedSweep[] = [];
  let globalMin = Number.POSITIVE_INFINITY;
  let globalMax = Number.NEGATIVE_INFINITY;
  let radialBinSizeMeters = DEFAULT_BIN_SIZE_METERS;
  let minRangeMeters = Number.POSITIVE_INFINITY;
  let maxRangeMeters = 0;
  let radarGeoref:
    | {
        radarLatitudeDegrees: number;
        radarLongitudeDegrees: number;
        radarAntennaHeightMeters?: number;
      }
    | undefined;

  for (const elevation of elevations) {
    radar.setElevation(elevation);

    if (!radarGeoref) {
      radarGeoref = extractRadarGeoreference(radar);
    }

    let scanCount = 0;
    try {
      scanCount = radar.getScans();
    } catch {
      continue;
    }

    if (scanCount <= 0) {
      continue;
    }

    const azimuths = normalizeArray(radar.getAzimuth())
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    const moments = resolveMomentBlocks(radar, product);
    const pairedCount = Math.min(scanCount, azimuths.length, moments.length);
    if (pairedCount <= 0) {
      continue;
    }

    const activeMoments = moments.slice(0, pairedCount);
    const sweepGateSizeMeters = pickGateSizeMeters(activeMoments);
    const sweepFirstGateMeters = pickFirstGateMeters(activeMoments);
    const radialBins =
      activeMoments.reduce((maxGateCount, block) => {
        if (!isHighResData(block) || !Array.isArray(block.moment_data)) {
          return maxGateCount;
        }
        const gateCount =
          typeof block.gate_count === "number"
            ? Math.max(0, Math.trunc(block.gate_count))
            : block.moment_data.length;
        const gateSizeKm =
          typeof block.gate_size === "number" && block.gate_size > 0
            ? block.gate_size
            : sweepGateSizeMeters / 1000;
        const firstGateKm =
          typeof block.first_gate === "number" && Number.isFinite(block.first_gate)
            ? block.first_gate
            : 0;
        const startBin = Math.max(0, Math.round(firstGateKm / Math.max(gateSizeKm, 0.0001)));
        return Math.max(maxGateCount, startBin + gateCount);
      }, 0) || DEFAULT_RADIAL_BINS;

    const sweepValues = new Float32Array(DEFAULT_AZIMUTH_BINS * radialBins);
    sweepValues.fill(NO_DATA_VALUE);
    const populatedRows = new Array<boolean>(DEFAULT_AZIMUTH_BINS).fill(false);

    for (let scanIndex = 0; scanIndex < pairedCount; scanIndex += 1) {
      const azimuth = azimuths[scanIndex];
      const moment = activeMoments[scanIndex];
      if (!moment || !Array.isArray(moment.moment_data)) {
        continue;
      }

      const azimuthIndex = normalizeAzimuthIndex(azimuth);
      populatedRows[azimuthIndex] = true;

      const gateSizeKm =
        typeof moment.gate_size === "number" && moment.gate_size > 0
          ? moment.gate_size
          : sweepGateSizeMeters / 1000;
      const firstGateKm =
        typeof moment.first_gate === "number" && Number.isFinite(moment.first_gate)
          ? moment.first_gate
          : 0;
      const startBin = Math.max(0, Math.round(firstGateKm / Math.max(gateSizeKm, 0.0001)));
      const gateCount = Math.min(
        radialBins - startBin,
        typeof moment.gate_count === "number"
          ? Math.max(0, Math.trunc(moment.gate_count))
          : moment.moment_data.length,
        moment.moment_data.length
      );

      const rowOffset = azimuthIndex * radialBins;
      for (let gate = 0; gate < gateCount; gate += 1) {
        const sample = moment.moment_data[gate];
        if (!validMomentSample(sample)) {
          continue;
        }

        const target = rowOffset + startBin + gate;
        if (target < rowOffset || target >= rowOffset + radialBins) {
          continue;
        }

        const existing = sweepValues[target];
        sweepValues[target] =
          existing === NO_DATA_VALUE ? sample : (existing + sample) / 2;
      }
    }

    fillMissingAzimuthRows(sweepValues, radialBins, populatedRows, NO_DATA_VALUE);

    let sweepHasData = false;
    for (let index = 0; index < sweepValues.length; index += 1) {
      const sample = sweepValues[index];
      if (!Number.isFinite(sample) || sample === NO_DATA_VALUE) {
        continue;
      }

      sweepHasData = true;
      if (sample < globalMin) {
        globalMin = sample;
      }
      if (sample > globalMax) {
        globalMax = sample;
      }
    }

    if (!sweepHasData) {
      continue;
    }

    const header = readHeader(radar);
    const elevationAngleDegrees =
      header && Number.isFinite(header.elevation_angle)
        ? Number(header.elevation_angle)
        : elevation;
    const nyquistVelocityMs =
      header?.radial && Number.isFinite(header.radial.nyquist_velocity)
        ? Number(header.radial.nyquist_velocity)
        : undefined;

    parsedSweeps.push({
      sweepInfo: {
        sweepIndex: parsedSweeps.length,
        elevationAngleDegrees,
        azimuthBins: DEFAULT_AZIMUTH_BINS,
        radialBins,
        nyquistVelocityMs,
      },
      values: sweepValues,
      radialBinSizeMeters: sweepGateSizeMeters,
      firstGateMeters: sweepFirstGateMeters,
    });

    radialBinSizeMeters = sweepGateSizeMeters;
    minRangeMeters = Math.min(minRangeMeters, sweepFirstGateMeters);
    maxRangeMeters = Math.max(maxRangeMeters, sweepFirstGateMeters + radialBins * sweepGateSizeMeters);
  }

  if (parsedSweeps.length === 0) {
    throw new Error("No decodable sweeps found in NEXRAD archive");
  }

  const packedDataSize = parsedSweeps.reduce((total, sweep) => total + sweep.values.length, 0);
  const packedData = new Float32Array(packedDataSize);
  let writeOffset = 0;
  for (const sweep of parsedSweeps) {
    packedData.set(sweep.values, writeOffset);
    writeOffset += sweep.values.length;
  }

  const generatedAtMs =
    context.generatedAtMs ??
    parseNexradGeneratedAtMs(context.filename) ??
    Date.now();

  const parsedSiteId = radar.header?.ICAO;
  const siteId =
    context.siteId ??
    (typeof parsedSiteId === "string" && parsedSiteId.trim().length > 0
      ? parsedSiteId.trim().toUpperCase()
      : parseSiteIdFromFilename(context.filename) ?? "UNKN");

  return {
    data: packedData,
    metadata: {
      volumeId: `${siteId}-${generatedAtMs}-${product}`,
      siteId,
      product,
      generatedAtMs,
      sweeps: parsedSweeps.map((sweep) => sweep.sweepInfo),
      radialBinSizeMeters,
      minRange: Number.isFinite(minRangeMeters) ? minRangeMeters : 0,
      maxRange: maxRangeMeters > 0 ? maxRangeMeters : radialBinSizeMeters * DEFAULT_RADIAL_BINS,
      minValueDb: Number.isFinite(globalMin) ? globalMin : 0,
      maxValueDb: Number.isFinite(globalMax) ? globalMax : 0,
      noDataValue: NO_DATA_VALUE,
      storageKey: "",
      decodeMode: "decoded",
      ...(radarGeoref ?? {}),
    },
  };
}

/**
 * Bootstrap NEXRAD reader.
 *
 * This starts Phase 2 with a deterministic metadata extractor and packed sample field,
 * while full radial message decoding is implemented in the next parser milestone.
 */
export class NexradReader implements RadarReader {
  async loadVolume(
    sourceBuffer: ArrayBuffer,
    product: VolumeProduct,
    context: ParserLoadContext
  ): Promise<VolumeArtifact> {
    try {
      return loadDecodedVolume(sourceBuffer, product, context);
    } catch (decodeError) {
      const message = decodeError instanceof Error ? decodeError.message : String(decodeError);
      console.warn(`[NexradReader] Falling back to bootstrap decode: ${message}`);
      return loadBootstrapVolume(sourceBuffer, product, context);
    }
  }
}
