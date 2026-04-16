import type { VolumeArtifact, VolumeProduct } from "@nexrad-3d/contracts";
import type { ParserLoadContext, RadarReader } from "./index";

export function isLikelyOdimH5File(filename: string, fileBuffer: ArrayBuffer): boolean {
  const normalized = filename.toLowerCase();
  if (normalized.endsWith(".h5") || normalized.endsWith(".hdf5")) {
    return true;
  }

  // HDF5 magic bytes: 89 48 44 46 0d 0a 1a 0a
  const bytes = new Uint8Array(fileBuffer.slice(0, 8));
  if (bytes.length < 8) {
    return false;
  }

  return (
    bytes[0] === 0x89 &&
    bytes[1] === 0x48 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

export class OdimH5Reader implements RadarReader {
  async loadVolume(
    sourceBuffer: ArrayBuffer,
    product: VolumeProduct,
    context: ParserLoadContext
  ): Promise<VolumeArtifact> {
    throw new Error("ODIM H5 parsing is not implemented yet");
  }
}
