import type { RadarVolumeMeta } from "@nexrad-3d/contracts";
type VolumeDataSource = "artifact" | "synthetic";
export interface LoadedVolumeData {
    data: Float32Array;
    source: VolumeDataSource;
    bytesDownloaded: number;
}
export declare function loadVolumeArtifact(meta: RadarVolumeMeta): Promise<LoadedVolumeData>;
export {};
//# sourceMappingURL=volumeLoader.d.ts.map