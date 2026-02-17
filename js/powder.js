import { angleDifference, clamp } from './utils.js';

/**
 * Compute powder scores for each pixel in the terrain grid.
 *
 * Algorithm:
 * 1. Leeward direction = (windFromDirection + 180) % 360
 * 2. Leeward score = (cos(angleDiff between aspect and leeward) + 1) / 2
 * 3. Wind transport factor = clamp(avgSpeed / 30, 0.2, 1.0)
 * 4. Snow factor = clamp(totalSnowfall / 6.0, 0, 1)
 * 5. Final = snowFactor * (0.5 + (leewardScore - 0.5) * windTransportFactor)
 *
 * @param {Float32Array} aspectGrid - Aspect in degrees per pixel (NaN = flat)
 * @param {number} windDir - Dominant wind-from direction in degrees
 * @param {number} totalSnowfall - Total snowfall in inches
 * @param {number} totalPrecip - Total precipitation in inches
 * @param {number} avgWindSpeed - Average wind speed in mph
 * @param {number} width - Grid width in pixels
 * @param {number} height - Grid height in pixels
 * @returns {Float32Array} Score per pixel, [0, 1]
 */
export function computePowderScores(aspectGrid, windDir, totalSnowfall, totalPrecip, avgWindSpeed, width, height) {
  const scores = new Float32Array(width * height);

  // No snow → all zeros (overlay will be transparent)
  const snowFactor = clamp(totalSnowfall / 6.0, 0, 1);
  if (snowFactor === 0) return scores;

  // Leeward = opposite of wind-from direction
  const leeward = (windDir + 180) % 360;

  // How much wind redistributes snow (light wind → even, strong → pronounced)
  const windTransport = clamp(avgWindSpeed / 30, 0.2, 1.0);

  for (let i = 0; i < width * height; i++) {
    const aspect = aspectGrid[i];

    if (isNaN(aspect)) {
      // Flat terrain or edge: neutral score
      scores[i] = snowFactor * 0.5;
      continue;
    }

    const diff = angleDifference(aspect, leeward);
    const leewardScore = (Math.cos(diff * Math.PI / 180) + 1) / 2;

    scores[i] = snowFactor * (0.5 + (leewardScore - 0.5) * windTransport);
  }

  return scores;
}
