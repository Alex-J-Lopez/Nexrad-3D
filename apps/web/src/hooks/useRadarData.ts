import { useCallback, useEffect, useState } from "react";
import type {
  GetLatestVolumeResponse,
  GetSitesResponse,
  GetTimelineResponse,
  RadarSite,
  RadarVolumeMeta,
  TimelineFrame,
  VolumeProduct,
} from "@nexrad-3d/contracts";

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "http://localhost:4000";
const requestTimeoutMs = Number.parseInt(
  (import.meta.env.VITE_API_REQUEST_TIMEOUT_MS as string | undefined) || "10000",
  10
);

interface UseRadarDataOptions {
  siteId?: string;
  product: VolumeProduct;
}

export interface UseRadarDataResult {
  sites: RadarSite[];
  timeline: TimelineFrame[];
  latestVolume: RadarVolumeMeta | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  fetchVolumeById: (volumeId: string) => Promise<RadarVolumeMeta | null>;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function fetchJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, requestTimeoutMs);

  let response: Response;

  try {
    response = await fetch(`${apiBase}${path}`, {
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Request timeout after ${requestTimeoutMs}ms for ${path}`);
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${path}`);
  }

  return (await response.json()) as T;
}

export function useRadarData(options: UseRadarDataOptions): UseRadarDataResult {
  const { siteId, product } = options;
  const [sites, setSites] = useState<RadarSite[]>([]);
  const [timeline, setTimeline] = useState<TimelineFrame[]>([]);
  const [latestVolume, setLatestVolume] = useState<RadarVolumeMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSites = useCallback(async () => {
    try {
      const payload = await fetchJson<GetSitesResponse>("/v1/sites");
      setSites(payload.sites);
    } catch (fetchError) {
      setError(getErrorMessage(fetchError));
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!siteId) {
      setTimeline([]);
      setLatestVolume(null);
      setIsLoading(false);
      return;
    }

    setError(null);
    setIsRefreshing(true);

    try {
      const [latestPayload, timelinePayload] = await Promise.all([
        fetchJson<GetLatestVolumeResponse>(
          `/v1/volumes/latest?siteId=${encodeURIComponent(siteId)}&product=${encodeURIComponent(product)}`
        ),
        fetchJson<GetTimelineResponse>(
          `/v1/timeline?siteId=${encodeURIComponent(siteId)}&product=${encodeURIComponent(product)}&limit=120`
        ),
      ]);

      setLatestVolume(latestPayload.volume);
      setTimeline(timelinePayload.frames);
    } catch (refreshError) {
      const message = getErrorMessage(refreshError);
      setError(message);
      setTimeline([]);
      setLatestVolume(null);
    } finally {
      setIsRefreshing(false);
      setIsLoading(false);
    }
  }, [product, siteId]);

  const fetchVolumeById = useCallback(async (volumeId: string) => {
    if (!volumeId) {
      return null;
    }

    try {
      const payload = await fetchJson<GetLatestVolumeResponse>(
        `/v1/volumes/${encodeURIComponent(volumeId)}`
      );
      return payload.volume ?? null;
    } catch (fetchError) {
      setError(getErrorMessage(fetchError));
      return null;
    }
  }, []);

  useEffect(() => {
    void fetchSites();

    const intervalId = window.setInterval(() => {
      void fetchSites();
    }, 60000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [fetchSites]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!siteId) {
      return;
    }

    const eventSource = new EventSource(`${apiBase}/v1/stream/events`);

    const handleVolumeReady = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as {
          siteId?: string;
          product?: string;
        };

        if (!payload.siteId || !payload.product) {
          return;
        }

        const matchesSite = payload.siteId.toUpperCase() === siteId.toUpperCase();
        const matchesProduct = payload.product.toUpperCase() === product.toUpperCase();

        if (matchesSite && matchesProduct) {
          void refresh();
        }
      } catch {
        // Ignore malformed messages from test tooling.
      }
    };

    eventSource.addEventListener("volume.ready", handleVolumeReady as EventListener);

    return () => {
      eventSource.removeEventListener("volume.ready", handleVolumeReady as EventListener);
      eventSource.close();
    };
  }, [product, refresh, siteId]);

  return {
    sites,
    timeline,
    latestVolume,
    isLoading,
    isRefreshing,
    error,
    refresh,
    fetchVolumeById,
  };
}
