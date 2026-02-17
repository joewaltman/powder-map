import { SNOTEL_BASE_URL, SNOTEL_ELEMENTS, WIND_BASE_URL, SNOW_LIQUID_RATIO, RESORT_API_URL } from './config.js';

// ── SNOTEL (snowfall / precipitation) ───────────────────────────────

/**
 * Build SNOTEL URL for a given number of lookback hours.
 */
function snotelUrl(hours) {
  return `${SNOTEL_BASE_URL}-${hours},0/${SNOTEL_ELEMENTS}`;
}

/**
 * Fetch hourly SNOTEL data for the given lookback period and derive snowfall.
 *
 * @param {number} hours - Lookback period (12, 24, or 48)
 * Returns { totalSnowfall, totalPrecip, sweChange, baseDepth, tempF }
 */
export async function fetchSnotelData(hours = 24) {
  const res = await fetch(snotelUrl(hours));
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
 */
function parseSnotelCsv(text) {
  const lines = text.split('\n');
  const rows = [];
  let headerSeen = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (!headerSeen) {
      headerSeen = true;
      continue;
    }

    const cols = trimmed.split(',');
    if (cols.length < 5) continue;

    rows.push({
      date: cols[0].trim(),
      snwd: parseFloat(cols[1]) || null,
      prec: parseFloat(cols[2]) || null,
      wteq: parseFloat(cols[3]) || null,
      tobs: parseFloat(cols[4]) || null
    });
  }

  return rows;
}

// ── Resort API (staff-reported snow) ─────────────────────────────────

/**
 * Fetch resort-reported snow data from Powder Mountain's API.
 * Returns { snow12h, snow24h, snow48h, baseDepth } in inches.
 */
export async function fetchResortSnow() {
  const res = await fetch(RESORT_API_URL);
  if (!res.ok) throw new Error(`Resort API returned ${res.status}`);
  const data = await res.json();
  const snow = data.conditions.currentSnow;
  return {
    snow12h: snow.freshSnowFallDepth12H.countryValue,
    snow24h: snow.freshSnowFallDepth24H.countryValue,
    snow48h: snow.freshSnowFallDepth48H.countryValue,
    baseDepth: snow.snowTotalDepth.countryValue,
  };
}

/**
 * Get resort snowfall for a specific period.
 */
export function getResortSnowForPeriod(resort, hours) {
  if (!resort) return null;
  if (hours <= 12) return resort.snow12h;
  if (hours <= 24) return resort.snow24h;
  return resort.snow48h;
}

/**
 * Average SNOTEL-derived snowfall with resort-reported snowfall.
 * If one source is unavailable, use the other.
 */
export function averageSnowfall(snotelSnowfall, resortSnowfall) {
  if (snotelSnowfall != null && resortSnowfall != null) {
    return (snotelSnowfall + resortSnowfall) / 2;
  }
  return snotelSnowfall ?? resortSnowfall ?? 0;
}

// ── Open-Meteo (wind only) ──────────────────────────────────────────

/**
 * Build Open-Meteo URL for a given lookback period.
 */
function windUrl(hours) {
  const pastDays = hours <= 24 ? 1 : 2;
  return `${WIND_BASE_URL}&past_days=${pastDays}`;
}

/**
 * Fetch wind data from Open-Meteo for the given lookback period.
 * Returns the raw JSON response, trimmed to the requested number of hours.
 *
 * @param {number} hours - Lookback period (12, 24, or 48)
 */
export async function fetchWindData(hours = 24) {
  const res = await fetch(windUrl(hours));
  if (!res.ok) throw new Error(`Wind API returned ${res.status}`);
  const data = await res.json();

  // Open-Meteo returns full days; trim to the requested hours from the end
  if (data.hourly && data.hourly.time) {
    const total = data.hourly.time.length;
    const keep = Math.min(hours, total);
    const start = total - keep;
    for (const key of Object.keys(data.hourly)) {
      data.hourly[key] = data.hourly[key].slice(start);
    }
  }

  return data;
}

/**
 * Compute the dominant wind direction over the period using vector averaging,
 * weighted by windSpeed * (1 + precip * 10) so snowy+windy hours count more.
 *
 * Returns { direction (degrees), avgSpeed (mph), maxGust (mph) } or null.
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
