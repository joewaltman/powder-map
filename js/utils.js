/**
 * Shortest signed angle difference between two bearings (0-360).
 * Returns a value in [0, 180].
 */
export function angleDifference(a, b) {
  let diff = Math.abs(((a - b) % 360 + 360) % 360);
  if (diff > 180) diff = 360 - diff;
  return diff;
}

/**
 * Convert degrees (0-360) to 16-point cardinal direction string.
 */
export function degreesToCardinal(deg) {
  const dirs = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'
  ];
  const idx = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return dirs[idx];
}

/**
 * Format a numeric value as inches with one decimal.
 */
export function formatInches(val) {
  if (val == null || isNaN(val)) return '—';
  return val.toFixed(1) + '"';
}

/**
 * Clamp a value between min and max.
 */
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
