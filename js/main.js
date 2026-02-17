import { CENTER, BOUNDS, TERRAIN_ZOOM, MAP_ZOOM, MAP_STYLE, MAPBOX_TOKEN } from './config.js';
import { fetchSnotelData, fetchResortSnow, fetchWindData, computeDominantWind, averageSnowfall, getResortSnowForPeriod } from './weather.js';
import { fetchTerrainGrid, getGridBounds } from './terrain.js';
import { computePowderScores } from './powder.js';
import { renderOverlay, addOverlayToMap } from './overlay.js';
import { degreesToCardinal, formatInches } from './utils.js';

// ── State ───────────────────────────────────────────────────────────

let currentHours = 24;
let cachedTerrain = null;
let cachedResort = null;

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

function updateWeatherPanel(snowfall, snotel, resortSnow, wind, hours) {
  document.getElementById('weather-loading').classList.add('hidden');
  document.getElementById('weather-error').classList.add('hidden');
  const content = document.getElementById('weather-content');
  content.classList.remove('hidden');

  document.getElementById('snowfall-label').textContent = `${hours}h Snowfall`;
  document.getElementById('snowfall-value').textContent = formatInches(snowfall);

  // Show both sources
  const snotelStr = snotel ? formatInches(snotel.totalSnowfall) : '—';
  const resortStr = resortSnow != null ? formatInches(resortSnow) : '—';
  document.getElementById('snow-sources-value').textContent =
    `${snotelStr} / ${resortStr}`;

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
    `Updated ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function updateToggleUI(hours) {
  document.querySelectorAll('.time-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.hours) === hours);
  });
}

// ── Data loading + rendering ────────────────────────────────────────

async function loadAndRender(hours) {
  showStatus('Loading powder data…');

  try {
    // Fetch SNOTEL + wind fresh for the selected period; resort + terrain are cached
    const fetches = [
      fetchSnotelData(hours).catch(err => {
        console.error('SNOTEL fetch failed:', err);
        return null;
      }),
      fetchWindData(hours).catch(err => {
        console.error('Wind fetch failed:', err);
        return null;
      }),
    ];

    // Fetch resort data once (it has 12/24/48h fields already)
    if (!cachedResort) {
      fetches.push(
        fetchResortSnow().catch(err => {
          console.error('Resort API fetch failed:', err);
          return null;
        })
      );
    }

    // Fetch terrain once
    if (!cachedTerrain) {
      fetches.push(
        fetchTerrainGrid(BOUNDS, TERRAIN_ZOOM, MAPBOX_TOKEN).catch(err => {
          console.error('Terrain fetch failed:', err);
          return null;
        })
      );
    }

    const results = await Promise.all(fetches);

    const snotel = results[0];
    const windData = results[1];
    let idx = 2;

    if (!cachedResort && results.length > idx) {
      cachedResort = results[idx];
      idx++;
    }
    if (!cachedTerrain && results.length > idx) {
      cachedTerrain = results[idx];
    }

    // Process wind
    let wind = null;
    if (windData && windData.hourly) {
      wind = computeDominantWind(windData.hourly);
    }

    // Average SNOTEL + resort for the selected period
    const snotelSnowfall = snotel ? snotel.totalSnowfall : null;
    const resortSnowfall = getResortSnowForPeriod(cachedResort, hours);
    const totalSnowfall = averageSnowfall(snotelSnowfall, resortSnowfall);
    const totalPrecip = snotel ? snotel.totalPrecip : 0;

    console.log(`${hours}h Snow — SNOTEL: ${snotelSnowfall?.toFixed(1)}", Resort: ${resortSnowfall}", Avg: ${totalSnowfall.toFixed(1)}"`);

    if (snotel || cachedResort) {
      updateWeatherPanel(totalSnowfall, snotel, resortSnowfall, wind, hours);
    } else {
      showWeatherError();
    }

    // Can't render overlay without terrain
    if (!cachedTerrain) {
      hideStatus();
      showStatus('Terrain data unavailable. Check your Mapbox token.');
      return;
    }

    // No meaningful snow → remove overlay
    if (totalSnowfall < 0.5) {
      removeOverlay();
      hideStatus();
      console.log(`Only ${totalSnowfall.toFixed(2)}" snowfall in last ${hours}h — overlay not shown`);
      return;
    }

    // No wind data → remove overlay
    if (!wind) {
      removeOverlay();
      hideStatus();
      console.log('No wind data — overlay not shown');
      return;
    }

    // Compute powder scores
    const scores = computePowderScores(
      cachedTerrain.aspectGrid,
      wind.direction,
      totalSnowfall,
      totalPrecip,
      wind.avgSpeed,
      cachedTerrain.width,
      cachedTerrain.height
    );

    // Render overlay image
    const imageUrl = await renderOverlay(scores, cachedTerrain.width, cachedTerrain.height);

    // Get the actual geographic bounds of the stitched tile grid
    const gridBounds = getGridBounds(BOUNDS, TERRAIN_ZOOM);

    // Add to map
    addOverlayToMap(map, imageUrl, gridBounds);

    hideStatus();
    console.log(`Powder overlay rendered for ${hours}h window`);

  } catch (err) {
    console.error('Error loading powder map:', err);
    hideStatus();
    showStatus('Error loading data. See console for details.');
  }
}

function removeOverlay() {
  if (map.getLayer('powder-overlay-layer')) {
    map.removeLayer('powder-overlay-layer');
  }
  if (map.getSource('powder-overlay')) {
    map.removeSource('powder-overlay');
  }
}

// ── Map init ────────────────────────────────────────────────────────

mapboxgl.accessToken = MAPBOX_TOKEN;

const map = new mapboxgl.Map({
  container: 'map',
  style: MAP_STYLE,
  center: [CENTER.lon, CENTER.lat],
  zoom: MAP_ZOOM
});

map.addControl(new mapboxgl.NavigationControl(), 'top-right');

// ── Time toggle ─────────────────────────────────────────────────────

document.querySelectorAll('.time-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const hours = parseInt(btn.dataset.hours);
    if (hours === currentHours) return;
    currentHours = hours;
    updateToggleUI(hours);
    loadAndRender(hours);
  });
});

// ── Initial load ────────────────────────────────────────────────────

map.on('load', () => {
  updateToggleUI(currentHours);
  loadAndRender(currentHours);
});
