import type { RadarVolumeMeta, SweepInfo } from "@nexrad-3d/contracts";

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "http://localhost:4000";
const requestTimeoutMs = Number.parseInt(
  (import.meta.env.VITE_API_REQUEST_TIMEOUT_MS as string | undefined) || "10000",
  10
);

const DEFAULT_AZIMUTH_BINS = 360;
const DEFAULT_RADIAL_BINS = 200;

type VolumeDataSource = "artifact" | "synthetic";

interface CacheEntry {
  data: Float32Array;
  source: VolumeDataSource;
  bytesDownloaded: number;
}

export interface LoadedVolumeData {
  data: Float32Array;
  source: VolumeDataSource;
  bytesDownloaded: number;
}

const volumeCache = new Map<string, CacheEntry>();

function getExpectedBinCount(sweeps: SweepInfo[]): number {
  if (sweeps.length === 0) {
    return DEFAULT_AZIMUTH_BINS * DEFAULT_RADIAL_BINS;
  }

  return sweeps.reduce((total, sweep) => total + sweep.azimuthBins * sweep.radialBins, 0);
}

function toCacheKey(meta: RadarVolumeMeta): string {
  return `${meta.volumeId}:${meta.storageKey}`;
}

function normalizeDataLength(
  values: Float32Array,
  expectedCount: number,
  noDataValue: number
): Float32Array {
  if (values.length === expectedCount) {
    return values;
  }

  if (values.length > expectedCount) {
    return values.subarray(0, expectedCount);
  }

  const padded = new Float32Array(expectedCount);
  padded.fill(noDataValue);
  padded.set(values);
  return padded;
}

function buildSyntheticVolume(meta: RadarVolumeMeta): Float32Array {
  const expectedCount = getExpectedBinCount(meta.sweeps);
  const values = new Float32Array(expectedCount);
  values.fill(meta.noDataValue);

  const valueSpan = Math.max(meta.maxValueDb - meta.minValueDb, 1);
  const seed = (meta.generatedAtMs % 100000) / 100000;

  let offset = 0;
  for (const sweep of meta.sweeps) {
    const azimuthBins = Math.max(1, sweep.azimuthBins);
    const radialBins = Math.max(1, sweep.radialBins);

    for (let azimuth = 0; azimuth < azimuthBins; azimuth += 1) {
      for (let range = 0; range < radialBins; range += 1) {
        const index = offset + azimuth * radialBins + range;
        const azimuthRatio = azimuth / azimuthBins;
        const rangeRatio = range / radialBins;

        const swirl = Math.sin((azimuthRatio + seed) * Math.PI * 6);
        const pulse = Math.cos((rangeRatio - seed) * Math.PI * 4);
        const envelope = Math.max(0, 1 - rangeRatio * 0.95);

        const normalized = (swirl * 0.55 + pulse * 0.45) * envelope;
        values[index] =
          meta.minValueDb + (normalized * 0.5 + 0.5) * valueSpan;
      }
    }

    offset += azimuthBins * radialBins;
  }

  return values;
}

async function fetchArtifactBuffer(storageKey: string): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, requestTimeoutMs);

  let response: Response;

  try {
    response = await fetch(`${apiBase}/v1/data/${encodeURIComponent(storageKey)}`, {
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Artifact request timeout after ${requestTimeoutMs}ms for ${storageKey}`);
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch artifact ${storageKey}: HTTP ${response.status}`);
  }

  return response.arrayBuffer();
}

function decodeArtifact(meta: RadarVolumeMeta, payload: ArrayBuffer): Float32Array {
  if (!meta.storageKey.toLowerCase().endsWith(".f32")) {
    throw new Error("Unsupported artifact encoding");
  }

  if (payload.byteLength % 4 !== 0) {
    throw new Error("Corrupt float32 artifact payload");
  }

  const rawValues = new Float32Array(payload);
  return normalizeDataLength(rawValues, getExpectedBinCount(meta.sweeps), meta.noDataValue);
}

export async function loadVolumeArtifact(meta: RadarVolumeMeta): Promise<LoadedVolumeData> {
  const cacheKey = toCacheKey(meta);
  const cached = volumeCache.get(cacheKey);
  if (cached) {
    return {
      data: new Float32Array(cached.data),
      source: cached.source,
      bytesDownloaded: cached.bytesDownloaded,
    };
  }

  let loaded: LoadedVolumeData;

  try {
    const payload = await fetchArtifactBuffer(meta.storageKey);
    const decoded = decodeArtifact(meta, payload);

    loaded = {
      data: decoded,
      source: "artifact",
      bytesDownloaded: payload.byteLength,
    };
  } catch {
    loaded = {
      data: buildSyntheticVolume(meta),
      source: "synthetic",
      bytesDownloaded: 0,
    };
  }

  volumeCache.set(cacheKey, {
    data: new Float32Array(loaded.data),
    source: loaded.source,
    bytesDownloaded: loaded.bytesDownloaded,
  });

  return loaded;
}
