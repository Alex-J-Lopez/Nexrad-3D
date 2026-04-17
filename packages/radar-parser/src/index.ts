/**
 * Radar parser interfaces and utilities.
 * Provides format detection and abstract reader interface for NEXRAD, ODIM H5, etc.
 *
 * Inspired by OpenStorm's RadarReader pattern but engine-agnostic.
 */

import type { VolumeArtifact, VolumeProduct } from "@nexrad-3d/contracts";
import { NexradReader, isLikelyNexradFile } from "./nexrad.js";
import { OdimH5Reader, isLikelyOdimH5File } from "./odim-h5.js";

export interface ParserLoadContext {
  filename: string;
  siteId?: string;
  generatedAtMs?: number;
}

export interface RadarReader {
  /**
   * Read and parse a complete radar file from disk or buffer.
   * Returns volume metadata and raw data artifact.
   */
  loadVolume(
    sourceBuffer: ArrayBuffer,
    product: VolumeProduct,
    context: ParserLoadContext
  ): Promise<VolumeArtifact>;
}

/**
 * Detect file format by magic bytes or filename and return appropriate reader.
 */
export function getReaderForFile(
  filename: string,
  fileBuffer: ArrayBuffer
): RadarReader | null {
  if (isLikelyOdimH5File(filename, fileBuffer)) {
    return new OdimH5Reader();
  }

  if (isLikelyNexradFile(filename, fileBuffer)) {
    return new NexradReader();
  }

  return null;
}

export { NexradReader, parseNexradGeneratedAtMs, parseSiteIdFromFilename } from "./nexrad.js";
export { OdimH5Reader } from "./odim-h5.js";
