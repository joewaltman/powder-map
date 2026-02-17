import { CENTER, BOUNDS, TERRAIN_ZOOM, MAP_ZOOM, MAP_STYLE, MAPBOX_TOKEN } from './config.js';
import { fetchSnotelData, fetchWindData, computeDominantWind } from './weather.js';
import { fetchTerrainGrid, getGridBounds } from './terrain.js';
import { computePowderScores } from './powder.js';
import { renderOverlay, addOverlayToMap } from './overlay.js';
import { degreesToCardinal, formatInches } from './utils.js';

// ── UI helpers ──────────────────────────────────────────────────────

function showStatus(msg) {
  const el = document.getElementById('status-message');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideStatus() {
  document.getElementById('status-message').classList.add('hidden');
}

function showWeatherError(msg) {
  document.getElementById('weather-loading').classList.add('hidden');
  document.getElementById('weather-content').classList.add('hidden');
  const err = document.getElementById('weather-error');
  err.textContent = msg || 'Weather data unavailable';
  err.classList.remove('hidden');
}

function updateWeatherPanel(snotel, wind) {
  document.getElementById('weather-loading').classList.add('hidden');
  document.getElementById('weather-error').classList.add('hidden');
  const content = document.getElementById('weather-content');
  content.classList.remove('hidden');

  document.getElementById('snowfall-value').textContent = formatInches(snotel.totalSnowfall);
  document.getElementById('precip-value').textContent = formatInches(snotel.totalPrecip) + ' SWE';

  if (wind) {
    document.getElementById('wind-value').textContent = `${wind.avgSpeed.toFixed(0)} mph`;
    document.getElementById('wind-dir-value').textContent =
      `${degreesToCardinal(wind.direction)} (${wind.direction.toFixed(0)}°)`;
    document.getElementById('gust-value').textContent = `${wind.maxGust.toFixed(0)} mph`;
  } else {
    document.getElementById('wind-value').textContent = 'N/A';
    document.getElementById('wind-dir-value').textContent = 'N/A';
    document.getElementById('gust-value').textContent = 'N/A';
  }

  const now = new Date();
  document.getElementById('last-updated').textContent =
    `SNOTEL #1300 · ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

// ── Main ────────────────────────────────────────────────────────────

mapboxgl.accessToken = MAPBOX_TOKEN;

const map = new mapboxgl.Map({
  container: 'map',
  style: MAP_STYLE,
  center: [CENTER.lon, CENTER.lat],
  zoom: MAP_ZOOM
});

map.addControl(new mapboxgl.NavigationControl(), 'top-right');

map.on('load', async () => {
  showStatus('Loading powder data…');

  try {
    // Fetch SNOTEL snow data, Open-Meteo wind, and terrain in parallel
    const [snotel, windData, terrain] = await Promise.all([
      fetchSnotelData().catch(err => {
        console.error('SNOTEL fetch failed:', err);
        return null;
      }),
      fetchWindData().catch(err => {
        console.error('Wind fetch failed:', err);
        return null;
      }),
      fetchTerrainGrid(BOUNDS, TERRAIN_ZOOM, MAPBOX_TOKEN).catch(err => {
        console.error('Terrain fetch failed:', err);
        return null;
      })
    ]);

    // Process wind from Open-Meteo
    let wind = null;
    if (windData && windData.hourly) {
      wind = computeDominantWind(windData.hourly);
    }

    // Process SNOTEL snow data
    if (!snotel) {
      showWeatherError('SNOTEL data unavailable');
    } else {
      updateWeatherPanel(snotel, wind);
      console.log('SNOTEL:', snotel);
    }

    // Can't render overlay without terrain
    if (!terrain) {
      hideStatus();
      showStatus('Terrain data unavailable. Check your Mapbox token.');
      return;
    }

    const totalSnowfall = snotel ? snotel.totalSnowfall : 0;
    const totalPrecip = snotel ? snotel.totalPrecip : 0;

    // No meaningful snow → skip overlay
    if (totalSnowfall < 0.5) {
      hideStatus();
      console.log(`Only ${totalSnowfall.toFixed(2)}" snowfall in last 24h — overlay not shown`);
      return;
    }

    // No wind data → skip overlay
    if (!wind) {
      hideStatus();
      console.log('No wind data — overlay not shown');
      return;
    }

    // Compute powder scores
    const scores = computePowderScores(
      terrain.aspectGrid,
      wind.direction,
      totalSnowfall,
      totalPrecip,
      wind.avgSpeed,
      terrain.width,
      terrain.height
    );

    // Render overlay image
    const imageUrl = await renderOverlay(scores, terrain.width, terrain.height);

    // Get the actual geographic bounds of the stitched tile grid
    const gridBounds = getGridBounds(BOUNDS, TERRAIN_ZOOM);

    // Add to map
    addOverlayToMap(map, imageUrl, gridBounds);

    hideStatus();
    console.log('Powder overlay rendered successfully');

  } catch (err) {
    console.error('Error loading powder map:', err);
    hideStatus();
    showStatus('Error loading data. See console for details.');
  }
});
