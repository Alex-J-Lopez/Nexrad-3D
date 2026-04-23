"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  GetLatestVolumeResponse,
  GetSitesResponse,
  RadarSite,
  RadarVolumeMeta,
  VolumeProduct,
} from "@nexrad-3d/contracts";

const requestTimeoutMs = 10000;

interface UseRadarDataOptions {
  siteId?: string;
  product: VolumeProduct;
}

export interface UseRadarDataResult {
  sites: RadarSite[];
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
    response = await fetch(path, {
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
  const [latestVolume, setLatestVolume] = useState<RadarVolumeMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSites = useCallback(async () => {
    try {
      const payload = await fetchJson<GetSitesResponse>("/api/sites");
      setSites(payload.sites);
    } catch (fetchError) {
      setError(getErrorMessage(fetchError));
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!siteId) {
      setLatestVolume(null);
      setIsLoading(false);
      return;
    }

    setError(null);
    setIsRefreshing(true);

    try {
      const latestPayload = await fetchJson<GetLatestVolumeResponse>(
        `/api/volumes/latest?siteId=${encodeURIComponent(siteId)}&product=${encodeURIComponent(product)}`
      );

      setLatestVolume(latestPayload.volume);
    } catch (refreshError) {
      const message = getErrorMessage(refreshError);
      setError(message);
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
        `/api/volumes/${encodeURIComponent(volumeId)}`
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

    const eventSource = new EventSource("/api/events");

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
    latestVolume,
    isLoading,
    isRefreshing,
    error,
    refresh,
    fetchVolumeById,
  };
}
