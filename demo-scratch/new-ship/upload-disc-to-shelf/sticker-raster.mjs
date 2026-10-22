// Card pixels and composition are separate: scale belongs to this raster;
// dx/dy and backgrounds belong only to the scene that places it.
export function alphaBounds(data, width, height) {
  const bounds = [width, height, 0, 0];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 0) {
    bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x + 1); bounds[3] = Math.max(bounds[3], y + 1);
  }
  if (bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) throw Error('Card has no visible pixels.');
  return Object.freeze(bounds);
}

export function cardRasterIdentity(disc, orientation, preset, appearance) {
  return JSON.stringify([disc, orientation, preset, appearance]);
}

export function createStickerSizer({ createCanvas, frameRenderer, maxCards = 12 }) {
  const held = new Map(); let rasterBuilds = 0, cacheHits = 0;
  function size({ image, nativeWidth, nativeHeight, nativeBounds, identity, scale }) {
    if (!Number.isFinite(scale) || scale < .5 || scale > 1.5) throw Error('Card scale must be between 50% and 150%.');
    const key = JSON.stringify([identity, nativeBounds, scale]);
    const previous = held.get(key);
    if (previous) { held.delete(key); held.set(key, previous); cacheHits++; return previous; }
    const [left, top, right, bottom] = nativeBounds;
    if (right <= left || bottom <= top) throw Error('Invalid native card bounds.');
    // Internal guard lets interpolation finish before the final alpha crop.
    // It is removed from the sticker; there is no exported transparent gutter.
    const guard = 4, width = Math.ceil((right - left) * scale) + guard * 2, height = Math.ceil((bottom - top) * scale) + guard * 2;
    const scaled = createCanvas(width, height), context = scaled.getContext('2d');
    const receipt = frameRenderer.seek(context, { width, height, layers: [{
      id: 'sized-card-raster', identity: key, width, height,
      draw: ctx => { ctx.translate(guard, guard); ctx.scale(scale, scale); ctx.drawImage(image, -left, -top, nativeWidth, nativeHeight); },
    }] }, 0);
    const bounds = alphaBounds(context.getImageData(0, 0, width, height).data, width, height);
    const canvas = createCanvas(bounds[2] - bounds[0], bounds[3] - bounds[1]);
    canvas.getContext('2d').drawImage(scaled, -bounds[0], -bounds[1]);
    const result = Object.freeze({ canvas, identity: key, width: canvas.width, height: canvas.height,
      nativeBounds: Object.freeze([...nativeBounds]), scale,
      cropOffset: Object.freeze({ x: bounds[0] - guard, y: bounds[1] - guard }), receipt });
    held.set(key, result); rasterBuilds++;
    while (held.size > maxCards) held.delete(held.keys().next().value);
    return result;
  }
  return { size, metrics: () => ({ rasterBuilds, cacheHits, retainedCards: held.size }) };
}

/** Explicit integer origin means composition never resamples the sized sticker. */
export function stickerOrigin({ width, height, nativeBounds, placement, sticker }) {
  const left = width / 2 + (nativeBounds[0] - width / 2) * placement.scale + placement.dx * width + sticker.cropOffset.x;
  const top = height / 2 + (nativeBounds[1] - height / 2) * placement.scale + placement.dy * height + sticker.cropOffset.y;
  if (sticker.width > width || sticker.height > height) throw Error('Sized card cannot fit inside this scene.');
  return Object.freeze({ x: Math.max(0, Math.min(width - sticker.width, Math.round(left))), y: Math.max(0, Math.min(height - sticker.height, Math.round(top))) });
}
