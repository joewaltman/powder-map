import { BOUNDS, TERRAIN_ZOOM } from './config.js';

const DB_NAME = 'powder-map-terrain';
const DB_VERSION = 1;
const STORE_NAME = 'terrain';

/**
 * Build a cache key from the current bounding box and zoom config.
 */
function cacheKey() {
  return `${BOUNDS.sw.lat},${BOUNDS.sw.lon},${BOUNDS.ne.lat},${BOUNDS.ne.lon}@z${TERRAIN_ZOOM}`;
}

/**
 * Open (or create) the IndexedDB database.
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Save decoded terrain data to IndexedDB.
 * @param {Object} data - { elevations: Float32Array, aspectGrid: Float32Array, width, height, metadata }
 */
export async function saveTerrainToCache(data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    // Store as a plain object; Float32Arrays are structured-cloneable
    store.put({
      elevations: data.elevations,
      aspectGrid: data.aspectGrid,
      width: data.width,
      height: data.height,
      metadata: data.metadata || {},
      timestamp: Date.now()
    }, cacheKey());
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Load cached terrain data from IndexedDB.
 * Returns the cached object or null if not found.
 */
export async function loadTerrainFromCache() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(cacheKey());
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch {
    // IndexedDB unavailable (e.g. private browsing in some browsers)
    return null;
  }
}
