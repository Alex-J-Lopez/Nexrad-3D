import type { RadarSite, RadarVolumeMeta, TimelineFrame, VolumeProduct } from "@nexrad-3d/contracts";
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
export declare function useRadarData(options: UseRadarDataOptions): UseRadarDataResult;
export {};
//# sourceMappingURL=useRadarData.d.ts.map