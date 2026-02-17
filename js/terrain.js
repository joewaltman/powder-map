import { BOUNDS, TERRAIN_ZOOM, MAPBOX_TOKEN } from './config.js';
import { saveTerrainToCache, loadTerrainFromCache } from './terrain-cache.js';

/**
 * Convert lon/lat to slippy-map tile coordinates at the given zoom.
 */
export function lonLatToTile(lon, lat, zoom) {
  const n = Math.pow(2, zoom);
  const x = Math.floor((lon + 180) / 360 * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x, y };
}

/**
 * Get the geographic bounds of a tile.
 */
export function tileToBounds(x, y, zoom) {
  const n = Math.pow(2, zoom);
  const lonMin = x / n * 360 - 180;
  const lonMax = (x + 1) / n * 360 - 180;
  const latMaxRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
  const latMinRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n)));
  return {
    lonMin, lonMax,
    latMin: latMinRad * 180 / Math.PI,
    latMax: latMaxRad * 180 / Math.PI
  };
}

/**
 * Meters per pixel at a given zoom level and latitude.
 */
export function getCellSize(zoom, lat) {
  const earthCircumference = 40075016.686;
  return earthCircumference * Math.cos(lat * Math.PI / 180) / (256 * Math.pow(2, zoom));
}

/**
 * Fetch a single Terrain-RGB tile from Mapbox and decode it into a 256x256
 * Float32Array of elevations.
 */
async function fetchTerrainTile(x, y, zoom, token) {
  const url = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${zoom}/${x}/${y}@2x.pngraw?access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tile fetch failed: ${zoom}/${x}/${y} (${res.status})`);

  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const pixels = imageData.data;

  const size = bitmap.width; // 512 for @2x tiles
  const elevations = new Float32Array(size * size);

  for (let i = 0; i < size * size; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    elevations[i] = -10000 + (r * 256 * 256 + g * 256 + b) * 0.1;
  }

  return { elevations, size };
}

/**
 * Fetch all terrain tiles covering the bounding box, stitch them into a
 * single elevation grid, and compute the aspect grid.
 *
 * Uses IndexedDB cache to avoid redundant Mapbox tile fetches.
 *
 * Returns { elevations, aspectGrid, width, height, bounds }
 */
export async function fetchTerrainGrid(bounds, zoom, token) {
  // Check cache first
  const cached = await loadTerrainFromCache();
  if (cached) {
    console.log('Terrain loaded from cache');
    return {
      elevations: cached.elevations,
      aspectGrid: cached.aspectGrid,
      width: cached.width,
      height: cached.height,
      bounds
    };
  }

  console.log('Fetching terrain tiles from Mapbox…');

  const swTile = lonLatToTile(bounds.sw.lon, bounds.sw.lat, zoom);
  const neTile = lonLatToTile(bounds.ne.lon, bounds.ne.lat, zoom);

  const minTx = Math.min(swTile.x, neTile.x);
  const maxTx = Math.max(swTile.x, neTile.x);
  const minTy = Math.min(swTile.y, neTile.y);
  const maxTy = Math.max(swTile.y, neTile.y);

  const cols = maxTx - minTx + 1;
  const rows = maxTy - minTy + 1;

  // Fetch all tiles in parallel
  const tilePromises = [];
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      tilePromises.push(
        fetchTerrainTile(tx, ty, zoom, token).then(result => ({
          tx, ty, ...result
        }))
      );
    }
  }

  const tiles = await Promise.all(tilePromises);

  // Determine tile pixel size (all tiles should be the same)
  const tileSize = tiles[0].size;

  // Stitch into single grid
  const width = cols * tileSize;
  const height = rows * tileSize;
  const elevations = new Float32Array(width * height);

  for (const tile of tiles) {
    const col = tile.tx - minTx;
    const row = tile.ty - minTy;
    const offsetX = col * tileSize;
    const offsetY = row * tileSize;

    for (let py = 0; py < tileSize; py++) {
      for (let px = 0; px < tileSize; px++) {
        elevations[(offsetY + py) * width + (offsetX + px)] =
          tile.elevations[py * tileSize + px];
      }
    }
  }

  // Compute cell size in meters
  const midLat = (bounds.sw.lat + bounds.ne.lat) / 2;
  const cellSize = getCellSize(zoom, midLat);
  // @2x tiles double the resolution
  const effectiveCellSize = cellSize / 2;

  // Compute aspect grid
  const aspectGrid = computeAspectGrid(elevations, width, height, effectiveCellSize);

  console.log(`Terrain stitched: ${width}x${height} pixels, ${cols}x${rows} tiles`);

  // Save to cache
  try {
    await saveTerrainToCache({
      elevations,
      aspectGrid,
      width,
      height,
      metadata: { zoom, cellSize: effectiveCellSize, cols, rows, tileSize }
    });
    console.log('Terrain cached to IndexedDB');
  } catch (e) {
    console.warn('Failed to cache terrain:', e);
  }

  return { elevations, aspectGrid, width, height, bounds };
}

/**
 * Compute aspect (slope direction in degrees, 0=N, 90=E, 180=S, 270=W) for
 * every pixel in the elevation grid using Horn's 3x3 method.
 *
 * Returns Float32Array where NaN means flat/undefined aspect.
 */
export function computeAspectGrid(elevations, width, height, cellSize) {
  const aspect = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        aspect[y * width + x] = NaN; // edge pixels
        continue;
      }

      // 3x3 neighborhood indices
      const idx = (r, c) => r * width + c;
      const a = elevations[idx(y - 1, x - 1)];
      const b = elevations[idx(y - 1, x)];
      const c = elevations[idx(y - 1, x + 1)];
      const d = elevations[idx(y, x - 1)];
      // e = center, not needed
      const f = elevations[idx(y, x + 1)];
      const g = elevations[idx(y + 1, x - 1)];
      const h = elevations[idx(y + 1, x)];
      const ii = elevations[idx(y + 1, x + 1)];

      // Horn's method: partial derivatives
      const dzdx = ((c + 2 * f + ii) - (a + 2 * d + g)) / (8 * cellSize);
      const dzdy = ((g + 2 * h + ii) - (a + 2 * b + c)) / (8 * cellSize);

      if (dzdx === 0 && dzdy === 0) {
        aspect[y * width + x] = NaN; // flat
        continue;
      }

      // Aspect in degrees, 0=N clockwise
      let asp = Math.atan2(dzdx, -dzdy) * 180 / Math.PI;
      asp = ((asp % 360) + 360) % 360;
      aspect[y * width + x] = asp;
    }
  }

  return aspect;
}

/**
 * Get the geographic bounds of the stitched grid (from tile boundaries, not the config bounds).
 */
export function getGridBounds(bounds, zoom) {
  const swTile = lonLatToTile(bounds.sw.lon, bounds.sw.lat, zoom);
  const neTile = lonLatToTile(bounds.ne.lon, bounds.ne.lat, zoom);

  const minTx = Math.min(swTile.x, neTile.x);
  const maxTx = Math.max(swTile.x, neTile.x);
  const minTy = Math.min(swTile.y, neTile.y);
  const maxTy = Math.max(swTile.y, neTile.y);

  const topLeft = tileToBounds(minTx, minTy, zoom);
  const bottomRight = tileToBounds(maxTx, maxTy, zoom);

  return {
    north: topLeft.latMax,
    south: bottomRight.latMin,
    east: bottomRight.lonMax,
    west: topLeft.lonMin
  };
}
