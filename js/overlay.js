import { OVERLAY_OPACITY } from './config.js';

/**
 * Color ramp for powder scores.
 * Each stop: [score, r, g, b, a]
 *
 * "Hot spots" approach: low scores are invisible, high scores glow
 * magenta → pink → white. Contrasts clearly with green/brown terrain.
 */
const COLOR_RAMP = [
  [0.00,   0,   0,   0,   0],     // transparent
  [0.35,   0,   0,   0,   0],     // still transparent — hide below-average areas
  [0.40, 120,  50, 160,  80],     // faint purple hint
  [0.50, 170,  50, 180, 150],     // medium purple
  [0.60, 220,  50, 160, 190],     // magenta
  [0.75, 255,  80, 130, 220],     // hot pink
  [0.90, 255, 170, 200, 240],     // light pink
  [1.00, 255, 255, 255, 255],     // bright white — the best powder
];

/**
 * Interpolate the color ramp at a given score [0,1].
 * Returns [r, g, b, a].
 */
function sampleRamp(score) {
  if (score <= COLOR_RAMP[0][0]) return COLOR_RAMP[0].slice(1);
  if (score >= COLOR_RAMP[COLOR_RAMP.length - 1][0]) return COLOR_RAMP[COLOR_RAMP.length - 1].slice(1);

  for (let i = 0; i < COLOR_RAMP.length - 1; i++) {
    const lo = COLOR_RAMP[i];
    const hi = COLOR_RAMP[i + 1];
    if (score >= lo[0] && score <= hi[0]) {
      const t = (score - lo[0]) / (hi[0] - lo[0]);
      return [
        Math.round(lo[1] + t * (hi[1] - lo[1])),
        Math.round(lo[2] + t * (hi[2] - lo[2])),
        Math.round(lo[3] + t * (hi[3] - lo[3])),
        Math.round(lo[4] + t * (hi[4] - lo[4])),
      ];
    }
  }
  return [0, 0, 0, 0];
}

/**
 * Render powder scores to a canvas and return a data URL.
 * The canvas is downsampled for performance (the full-res grid can be huge).
 */
export function renderOverlay(scores, width, height) {
  // Downsample to a manageable size for the image overlay
  const maxDim = 1024;
  let outW = width;
  let outH = height;
  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    outW = Math.round(width * scale);
    outH = Math.round(height * scale);
  }

  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(outW, outH);
  const data = imageData.data;

  const xRatio = width / outW;
  const yRatio = height / outH;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      // Nearest-neighbor sampling from the source grid
      const srcX = Math.min(Math.floor(x * xRatio), width - 1);
      const srcY = Math.min(Math.floor(y * yRatio), height - 1);
      const score = scores[srcY * width + srcX];

      const [r, g, b, a] = sampleRamp(score);
      const idx = (y * outW + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // Convert to blob URL for Mapbox
  return canvas.convertToBlob({ type: 'image/png' }).then(blob => URL.createObjectURL(blob));
}

/**
 * Add or update the powder overlay on the Mapbox map.
 * @param {mapboxgl.Map} map
 * @param {string} imageUrl - Object URL or data URL of the overlay image
 * @param {Object} gridBounds - { north, south, east, west }
 */
export function addOverlayToMap(map, imageUrl, gridBounds) {
  const coordinates = [
    [gridBounds.west, gridBounds.north],  // top-left
    [gridBounds.east, gridBounds.north],  // top-right
    [gridBounds.east, gridBounds.south],  // bottom-right
    [gridBounds.west, gridBounds.south],  // bottom-left
  ];

  if (map.getSource('powder-overlay')) {
    map.getSource('powder-overlay').updateImage({ url: imageUrl, coordinates });
  } else {
    map.addSource('powder-overlay', {
      type: 'image',
      url: imageUrl,
      coordinates
    });

    map.addLayer({
      id: 'powder-overlay-layer',
      type: 'raster',
      source: 'powder-overlay',
      paint: {
        'raster-opacity': OVERLAY_OPACITY,
        'raster-fade-duration': 0
      }
    });
  }
}
