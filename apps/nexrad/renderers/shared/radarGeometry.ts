const EFFECTIVE_EARTH_RADIUS_METERS = 6_371_000 * (4 / 3);

/**
 * Computes beam height and horizontal ground range from slant range and
 * elevation angle using the standard 4/3-Earth effective radius model.
 * Safe to call with any finite input — negative slant range clamps to zero.
 */
export function projectBeamSample(
  slantRangeMeters: number,
  elevationAngleDegrees: number
): { horizontalRangeMeters: number; heightMeters: number } {
  const range = Math.max(0, slantRangeMeters);
  const elevationRadians =
    Math.max(-2, Math.min(90, elevationAngleDegrees)) * (Math.PI / 180);

  const centerDistance = Math.sqrt(
    range * range +
      EFFECTIVE_EARTH_RADIUS_METERS * EFFECTIVE_EARTH_RADIUS_METERS +
      2 * range * EFFECTIVE_EARTH_RADIUS_METERS * Math.sin(elevationRadians)
  );

  return {
    horizontalRangeMeters: Math.max(0, range * Math.cos(elevationRadians)),
    heightMeters: Math.max(0, centerDistance - EFFECTIVE_EARTH_RADIUS_METERS),
  };
}

/**
 * NWS standard WSR-88D reflectivity color table.
 * Returns [r, g, b] each in [0, 1].
 * Iterates ascending thresholds and keeps the last match — identical to
 * the NWS legacy color assignment algorithm.
 */
const NWS_STOPS: Array<[number, [number, number, number]]> = [
  [15, [0x66 / 255, 0xcc / 255, 0xff / 255]],
  [20, [0x00 / 255, 0x99 / 255, 0xff / 255]],
  [25, [0x00 / 255, 0xff / 255, 0x00 / 255]],
  [30, [0x00 / 255, 0xcc / 255, 0x00 / 255]],
  [35, [0x00 / 255, 0x99 / 255, 0x00 / 255]],
  [40, [0xff / 255, 0xff / 255, 0x00 / 255]],
  [45, [0xff / 255, 0xcc / 255, 0x00 / 255]],
  [50, [0xff / 255, 0x99 / 255, 0x00 / 255]],
  [55, [0xff / 255, 0x00 / 255, 0x00 / 255]],
  [60, [0xcc / 255, 0x00 / 255, 0x00 / 255]],
  [65, [0x99 / 255, 0x00 / 255, 0x00 / 255]],
  [70, [0xff / 255, 0x00 / 255, 0xff / 255]],
  [75, [0xcc / 255, 0x00 / 255, 0xcc / 255]],
];

export function nwsColor(dbz: number): [number, number, number] {
  let color: [number, number, number] = [0x66 / 255, 0xcc / 255, 0xff / 255];
  for (const [threshold, rgb] of NWS_STOPS) {
    if (dbz >= threshold) {
      color = rgb;
    }
  }
  return color;
}
