import { SNOTEL_URL, WIND_URL, SNOW_LIQUID_RATIO, RESORT_API_URL } from './config.js';

// ── SNOTEL (snowfall / precipitation) ───────────────────────────────

/**
 * Fetch hourly SNOTEL data and derive snowfall from the precipitation
 * accumulation gauge and snow depth sensor.
 *
 * Returns { totalSnowfall, totalPrecip, sweChange, baseDepth, tempF }
 *   - totalSnowfall: estimated new snow in inches (SWE delta × SNOW_LIQUID_RATIO)
 *   - totalPrecip: liquid water equivalent of new precip in inches
 *   - sweChange: change in snow water equivalent in inches
 *   - baseDepth: latest snow depth reading in inches
 *   - tempF: latest observed temperature in °F
 */
export async function fetchSnotelData() {
  const res = await fetch(SNOTEL_URL);
  if (!res.ok) throw new Error(`SNOTEL returned ${res.status}`);
  const text = await res.text();

  const rows = parseSnotelCsv(text);
  if (rows.length < 2) throw new Error('Not enough SNOTEL data');

  const first = rows[0];
  const last = rows[rows.length - 1];

  // Precipitation accumulation is water-year cumulative; delta = new precip
  const precFirst = first.prec;
  const precLast = last.prec;
  const totalPrecip = (precFirst != null && precLast != null)
    ? Math.max(0, precLast - precFirst)
    : 0;

  // SWE change
  const sweFirst = first.wteq;
  const sweLast = last.wteq;
  const sweChange = (sweFirst != null && sweLast != null)
    ? Math.max(0, sweLast - sweFirst)
    : 0;

  // Estimate snowfall from liquid precip × snow-to-water ratio
  const totalSnowfall = totalPrecip * SNOW_LIQUID_RATIO;

  return {
    totalSnowfall,
    totalPrecip,
    sweChange,
    baseDepth: last.snwd,
    tempF: last.tobs
  };
}

/**
 * Parse the SNOTEL Report Generator CSV into an array of row objects.
 * Skips comment lines (starting with #) and the header row.
 */
function parseSnotelCsv(text) {
  const lines = text.split('\n');
  const rows = [];
  let headerSeen = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // First non-comment line is the header
    if (!headerSeen) {
      headerSeen = true;
      continue;
    }

    const cols = trimmed.split(',');
    if (cols.length < 5) continue;

    rows.push({
      date: cols[0].trim(),
      snwd: parseFloat(cols[1]) || null,   // snow depth (inches)
      prec: parseFloat(cols[2]) || null,    // precip accumulation (inches)
      wteq: parseFloat(cols[3]) || null,    // snow water equivalent (inches)
      tobs: parseFloat(cols[4]) || null     // observed temperature (°F)
    });
  }

  return rows;
}

// ── Resort API (staff-reported snow) ─────────────────────────────────

/**
 * Fetch the resort-reported snow data from Powder Mountain's API.
 * Returns { snow24h, snow48h, baseDepth, seasonTotal } in inches, or null on failure.
 */
export async function fetchResortSnow() {
  const res = await fetch(RESORT_API_URL);
  if (!res.ok) throw new Error(`Resort API returned ${res.status}`);
  const data = await res.json();
  const snow = data.conditions.currentSnow;
  return {
    snow24h: snow.freshSnowFallDepth24H.countryValue,
    snow48h: snow.freshSnowFallDepth48H.countryValue,
    baseDepth: snow.snowTotalDepth.countryValue,
    seasonTotal: snow.snowFallDepthCompleteSeason.countryValue,
  };
}

/**
 * Average SNOTEL-derived snowfall with resort-reported 24h snowfall.
 * If one source is unavailable, use the other.
 */
export function averageSnowfall(snotelSnowfall, resortSnow24h) {
  if (snotelSnowfall != null && resortSnow24h != null) {
    return (snotelSnowfall + resortSnow24h) / 2;
  }
  return snotelSnowfall ?? resortSnow24h ?? 0;
}

// ── Open-Meteo (wind only) ──────────────────────────────────────────

/**
 * Fetch wind data from Open-Meteo (last 24h hourly).
 * Returns the raw JSON response.
 */
export async function fetchWindData() {
  const res = await fetch(WIND_URL);
  if (!res.ok) throw new Error(`Wind API returned ${res.status}`);
  return res.json();
}

/**
 * Compute the dominant wind direction over the period using vector averaging,
 * weighted by windSpeed * (1 + precip * 10) so snowy+windy hours count more.
 *
 * Returns { direction (degrees), avgSpeed (mph), maxGust (mph) } or null if
 * no valid wind data exists.
 */
export function computeDominantWind(hourly) {
  const speeds = hourly.wind_speed_10m;
  const dirs = hourly.wind_direction_10m;
  const gusts = hourly.wind_gusts_10m;
  const precip = hourly.precipitation;

  if (!speeds || !dirs || speeds.length === 0) return null;

  let sumX = 0;
  let sumY = 0;
  let totalWeight = 0;
  let totalSpeed = 0;
  let maxGust = 0;
  let validCount = 0;

  for (let i = 0; i < speeds.length; i++) {
    const spd = speeds[i];
    const dir = dirs[i];
    if (spd == null || dir == null) continue;

    const p = (precip && precip[i] != null) ? precip[i] : 0;
    const weight = spd * (1 + p * 10);
    const rad = dir * Math.PI / 180;

    sumX += weight * Math.sin(rad);
    sumY += weight * Math.cos(rad);
    totalWeight += weight;
    totalSpeed += spd;
    validCount++;

    if (gusts && gusts[i] != null && gusts[i] > maxGust) {
      maxGust = gusts[i];
    }
  }

  if (validCount === 0 || totalWeight === 0) return null;

  let direction = Math.atan2(sumX, sumY) * 180 / Math.PI;
  direction = ((direction % 360) + 360) % 360;

  return {
    direction,
    avgSpeed: totalSpeed / validCount,
    maxGust
  };
}
