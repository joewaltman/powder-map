// Powder Mountain Resort center
export const CENTER = { lat: 41.3797, lon: -111.7808 };

// Bounding box for terrain analysis
export const BOUNDS = {
  sw: { lat: 41.35, lon: -111.82 },
  ne: { lat: 41.42, lon: -111.73 }
};

// Terrain-RGB tile zoom level (~7m/pixel at this latitude)
export const TERRAIN_ZOOM = 14;

// Map initial view
export const MAP_ZOOM = 13;
export const MAP_STYLE = 'mapbox://styles/mapbox/outdoors-v12';

// Mapbox access token — set in env.js (not committed) or replace here
export const MAPBOX_TOKEN = window.MAPBOX_TOKEN || 'YOUR_MAPBOX_TOKEN_HERE';

// SNOTEL station on Powder Mountain (#1300) — hourly snow depth + precip
// Returns CSV; no auth needed
export const SNOTEL_URL =
  'https://wcc.sc.egov.usda.gov/reportGenerator/view_csv/' +
  'customSingleStationReport/hourly/1300:UT:SNTL/-24,0/' +
  'SNWD::value,PREC::value,WTEQ::value,TOBS::value';

// Snow-to-water ratio for estimating snowfall from liquid precip (SWE)
// Utah cold powder typically 12:1–15:1; 12 is conservative
export const SNOW_LIQUID_RATIO = 12;

// Open-Meteo API — used only for wind direction/speed (SNOTEL wind is unreliable)
export const WIND_URL =
  'https://api.open-meteo.com/v1/forecast' +
  '?latitude=41.3797&longitude=-111.7808' +
  '&hourly=precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
  '&past_days=1&forecast_days=0' +
  '&wind_speed_unit=mph&precipitation_unit=inch' +
  '&timezone=America%2FDenver';

// Overlay opacity on top of the map
export const OVERLAY_OPACITY = 0.75;
