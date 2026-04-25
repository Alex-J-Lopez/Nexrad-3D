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

export interface ColorLegendData {
  gradientCss: string;
  ticks: { label: string; positionPct: number }[];
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

  /**
   * Get metadata to render a UI legend.
   */
  getLegendData(min: number, max: number): ColorLegendData;
}

// Utility to interpolate between two RGBA colors
function lerpColor(c1: ColorRGBA, c2: ColorRGBA, t: number): ColorRGBA {
  return {
    r: c1.r + (c2.r - c1.r) * t,
    g: c1.g + (c2.g - c1.g) * t,
    b: c1.b + (c2.b - c1.b) * t,
    a: c1.a + (c2.a - c1.a) * t,
  };
}

// Utility to create a lookup texture from a list of color stops
function generateTextureFromStops(stops: { pct: number; color: ColorRGBA }[]): Uint8Array {
  const tex = new Uint8Array(128 * 128 * 4);
  for (let i = 0; i < 128; i++) {
    const pct = i / 127;
    let c = stops[stops.length - 1].color;
    for (let j = 0; j < stops.length - 1; j++) {
      if (pct >= stops[j].pct && pct <= stops[j + 1].pct) {
        const localT = (pct - stops[j].pct) / (stops[j + 1].pct - stops[j].pct);
        c = lerpColor(stops[j].color, stops[j + 1].color, localT);
        break;
      }
    }
    for (let y = 0; y < 128; y++) {
      const idx = (y * 128 + i) * 4;
      tex[idx] = c.r;
      tex[idx + 1] = c.g;
      tex[idx + 2] = c.b;
      tex[idx + 3] = Math.round(c.a * 255);
    }
  }
  return tex;
}

function valueToColorStops(value: number, min: number, max: number, stops: { pct: number; color: ColorRGBA }[]): ColorRGBA {
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  for (let j = 0; j < stops.length - 1; j++) {
    if (pct >= stops[j].pct && pct <= stops[j + 1].pct) {
      const localT = (pct - stops[j].pct) / (stops[j + 1].pct - stops[j].pct);
      return lerpColor(stops[j].color, stops[j + 1].color, localT);
    }
  }
  return stops[stops.length - 1].color;
}

function getGradientCss(stops: { pct: number; color: ColorRGBA }[]) {
  const cssStops = stops.map(s => `rgba(${s.color.r}, ${s.color.g}, ${s.color.b}, ${s.color.a}) ${Math.round(s.pct * 100)}%`);
  return `linear-gradient(to right, ${cssStops.join(", ")})`;
}

/**
 * Reflectivity (dBZ) color scale: blues to greens to reds.
 */
const REF_STOPS = [
  { pct: 0.0, color: { r: 0, g: 0, b: 0, a: 0 } },           // -10
  { pct: 0.1, color: { r: 0, g: 255, b: 255, a: 0.5 } },     // 0
  { pct: 0.22, color: { r: 0, g: 128, b: 255, a: 0.7 } },    // 10
  { pct: 0.33, color: { r: 0, g: 255, b: 0, a: 0.8 } },      // 20
  { pct: 0.44, color: { r: 0, g: 128, b: 0, a: 0.9 } },      // 30
  { pct: 0.55, color: { r: 255, g: 255, b: 0, a: 0.9 } },    // 40
  { pct: 0.66, color: { r: 255, g: 128, b: 0, a: 0.95 } },   // 50
  { pct: 0.77, color: { r: 255, g: 0, b: 0, a: 1.0 } },      // 60
  { pct: 0.88, color: { r: 255, g: 0, b: 255, a: 1.0 } },    // 70
  { pct: 1.0, color: { r: 255, g: 255, b: 255, a: 1.0 } },   // 80+
];

export class ReflectivityColorIndex implements ColorIndex {
  valueToColor(value: number, min: number, max: number): ColorRGBA {
    return valueToColorStops(value, min, max, REF_STOPS);
  }

  getLookupTexture(): Uint8Array {
    return generateTextureFromStops(REF_STOPS);
  }

  getLegendData(min: number, max: number): ColorLegendData {
    return {
      gradientCss: getGradientCss(REF_STOPS),
      ticks: [
        { label: "10", positionPct: 0.22 },
        { label: "30", positionPct: 0.44 },
        { label: "50", positionPct: 0.66 },
        { label: "70 dBZ", positionPct: 0.88 },
      ]
    };
  }
}

/**
 * Velocity (m/s) color scale: blue to red diverging.
 */
const VEL_STOPS = [
  { pct: 0.0, color: { r: 0, g: 255, b: 255, a: 0.9 } },     // Max Toward (Cyan)
  { pct: 0.25, color: { r: 0, g: 0, b: 255, a: 0.8 } },      // Toward (Blue)
  { pct: 0.5, color: { r: 0, g: 0, b: 0, a: 0 } },           // 0
  { pct: 0.75, color: { r: 255, g: 0, b: 0, a: 0.8 } },      // Away (Red)
  { pct: 1.0, color: { r: 255, g: 255, b: 0, a: 0.9 } },     // Max Away (Yellow)
];

export class VelocityColorIndex implements ColorIndex {
  valueToColor(value: number, min: number, max: number): ColorRGBA {
    return valueToColorStops(value, min, max, VEL_STOPS);
  }

  getLookupTexture(): Uint8Array {
    return generateTextureFromStops(VEL_STOPS);
  }

  getLegendData(min: number, max: number): ColorLegendData {
    return {
      gradientCss: getGradientCss(VEL_STOPS),
      ticks: [
        { label: "-30", positionPct: 0 },
        { label: "-15", positionPct: 0.25 },
        { label: "0", positionPct: 0.5 },
        { label: "15", positionPct: 0.75 },
        { label: "30 m/s", positionPct: 1 },
      ]
    };
  }
}

export function getColorIndexForProduct(product: VolumeProduct): ColorIndex {
  switch (product) {
    case "REF":
      return new ReflectivityColorIndex();
    case "VEL":
      return new VelocityColorIndex();
    default:
      return new ReflectivityColorIndex();
  }
}
