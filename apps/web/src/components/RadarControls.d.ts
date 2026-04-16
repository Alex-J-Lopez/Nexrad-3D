import { VolumeProduct, type RadarSite, type TimelineFrame } from "@nexrad-3d/contracts";
interface RadarControlsProps {
    sites: RadarSite[];
    selectedSiteId?: string;
    selectedProduct: VolumeProduct;
    liveFollow: boolean;
    quality: number;
    timeline: TimelineFrame[];
    timelineIndex: number;
    activeGeneratedAtMs?: number;
    isRefreshing: boolean;
    onSiteChange: (siteId: string) => void;
    onProductChange: (product: VolumeProduct) => void;
    onLiveFollowChange: (isEnabled: boolean) => void;
    onQualityChange: (value: number) => void;
    onTimelineIndexChange: (value: number) => void;
    onRefresh: () => void;
}
export declare function RadarControls(props: RadarControlsProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=RadarControls.d.ts.map