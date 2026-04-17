/**
 * Radar product color scales and lookup tables.
 * Ported from OpenStorm's RadarColorIndex system.
 */

import type { VolumeProduct } from "@nexrad-3d/contracts";

export interface ColorRGBA {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
  a: number; // 0-1
}

/**
 * Abstract color lookup for a product type.
 */
export interface ColorIndex {
  /**
   * Map a radar value (dBZ, m/s, etc.) to an RGBA color.
   * @param value Raw radar value
   * @param min Expected minimum value for this product
   * @param max Expected maximum value for this product
   * @returns ColorRGBA with opacity
   */
  valueToColor(value: number, min: number, max: number): ColorRGBA;

  /**
   * Get 128x128 RGBA8 lookup texture for GPU sampling.
   */
  getLookupTexture(): Uint8Array;
}

/**
 * Reflectivity (dBZ) color scale: greens to reds.
 */
export class ReflectivityColorIndex implements ColorIndex {
  valueToColor(value: number, min: number, max: number): ColorRGBA {
    // TODO: Implement gradient from -10 dBZ (transparent) to 80 dBZ (red)
    // Reference: OpenStorm/Source/OpenStorm/Radar/RadarColorIndex.h
    const normalized = (value - min) / (max - min);
    return { r: 0, g: 0, b: 0, a: Math.max(0, normalized) };
  }

  getLookupTexture(): Uint8Array {
    // TODO: Generate 128x128 RGBA texture
    return new Uint8Array(128 * 128 * 4);
  }
}

/**
 * Velocity (m/s) color scale: blue to red diverging.
 */
export class VelocityColorIndex implements ColorIndex {
  valueToColor(value: number, min: number, max: number): ColorRGBA {
    // TODO: Implement diverging color map around zero (away/toward)
    const normalized = (value - min) / (max - min);
    const isAway = value > 0;
    return isAway
      ? { r: Math.min(255, normalized * 255), g: 0, b: 0, a: 0.8 }
      : { r: 0, g: 0, b: Math.min(255, (1 - normalized) * 255), a: 0.8 };
  }

  getLookupTexture(): Uint8Array {
    // TODO: Generate 128x128 RGBA texture
    return new Uint8Array(128 * 128 * 4);
  }
}

export function getColorIndexForProduct(product: VolumeProduct): ColorIndex {
  switch (product) {
    case "REF":
      return new ReflectivityColorIndex();
    case "VEL":
    case "VELD":
    case "SRV":
      return new VelocityColorIndex();
    default:
      return new ReflectivityColorIndex();
  }
}
