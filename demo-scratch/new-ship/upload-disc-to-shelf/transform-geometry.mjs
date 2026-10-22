// Shared geometry for browser placement and the nctk XYTransform calculation.
export const identityTransform = Object.freeze({ scale: 1, dx: 0, dy: 0 });

export function transformedBounds({ width, height, alphaBounds, scale = 1, dx = 0, dy = 0 }) {
  if (![width, height, scale, dx, dy].every(Number.isFinite) || width <= 0 || height <= 0 || scale < 0.5 || scale > 1.5) throw Error('Invalid card transform.');
  if (!Array.isArray(alphaBounds) || alphaBounds.length !== 4 || !alphaBounds.every(Number.isFinite)) throw Error('Invalid alpha bounds.');
  const [left, top, right, bottom] = alphaBounds, cx = width / 2, cy = height / 2;
  return Object.freeze({
    left: cx + (left - cx) * scale + dx * width,
    top: cy + (top - cy) * scale + dy * height,
    right: cx + (right - cx) * scale + dx * width,
    bottom: cy + (bottom - cy) * scale + dy * height,
  });
}

export function validateTransform({ width, height, alphaBounds, scale = 1, dx = 0, dy = 0 }) {
  if (![dx, dy].every(Number.isFinite)) throw Error('Normalized x/y offsets must be finite.');
  const bounds = transformedBounds({ width, height, alphaBounds, scale, dx, dy });
  if (bounds.left < 0 || bounds.top < 0 || bounds.right > width || bounds.bottom > height) throw Error('Transform would clip visible card pixels.');
  return bounds;
}

export function clampTransform({ width, height, alphaBounds, scale = 1, dx = 0, dy = 0 }) {
  const scaled = transformedBounds({ width, height, alphaBounds, scale });
  const minDx = -scaled.left / width, maxDx = (width - scaled.right) / width;
  const minDy = -scaled.top / height, maxDy = (height - scaled.bottom) / height;
  if (minDx > maxDx || minDy > maxDy) throw Error('Card cannot fit inside the canvas at this scale.');
  return Object.freeze({ scale, dx: Math.min(maxDx, Math.max(minDx, dx)), dy: Math.min(maxDy, Math.max(minDy, dy)) });
}

/** A compact visible footprint may grow independently of its distance from the
 * native frame center. The existing scale limit and clipping contract remain. */
export function maxCardScale({ width, height, alphaBounds, limit = 1.5 }) {
  transformedBounds({ width, height, alphaBounds });
  const [left, top, right, bottom] = alphaBounds;
  if (right <= left || bottom <= top || !Number.isFinite(limit) || limit < .5 || limit > 1.5) throw Error('Invalid visible card footprint.');
  return Math.min(limit, width / (right - left), height / (bottom - top));
}

/** Default size for a freshly shown card. Per axis: a card that hugs a frame
 * edge (within 15% of it) shrinks toward that edge, so a lower-third card stays
 * in its corner. Otherwise it shrinks around its own centre, except vertically
 * in a portrait frame, where it keeps its own bottom edge so it settles a
 * little toward the bottom corner (Sam, 21 Oct 2026). Never toward the middle. */
export function anchoredDefaultPlacement({ width, height, alphaBounds, scale, edgeBand = 0.15 }) {
  transformedBounds({ width, height, alphaBounds, scale });
  const [left, top, right, bottom] = alphaBounds;
  const anchor = (low, high, size) => low <= size * edgeBand ? low : size - high <= size * edgeBand ? high : (low + high) / 2;
  const anchorX = anchor(left, right, width);
  const anchorY = height > width && top > height * edgeBand && height - bottom > height * edgeBand ? bottom : anchor(top, bottom, height);
  const dx = (anchorX - width / 2) * (1 - scale) / width;
  const dy = (anchorY - height / 2) * (1 - scale) / height;
  return clampTransform({ width, height, alphaBounds, scale, dx, dy });
}

/** Derive a new explicit transform. Retain the visible card's center until the
 * frame boundary requires clamping. `current` is the caller-held resize anchor;
 * repeated sizes should reuse it until a card or actual placement change.
 * No raster, DOM, or persistent state here. */
export function resizeCardTransform({ width, height, alphaBounds, current, requestedScale, maxScale = 1.5 }) {
  transformedBounds({ width, height, alphaBounds, ...current });
  if (!Number.isFinite(requestedScale)) throw Error('Invalid requested card scale.');
  const scale = Math.min(requestedScale, maxCardScale({ width, height, alphaBounds, limit: maxScale }));
  const [left, top, right, bottom] = alphaBounds;
  const dx = current.dx + (current.scale - scale) * ((left + right) / 2 - width / 2) / width;
  const dy = current.dy + (current.scale - scale) * ((top + bottom) / 2 - height / 2) / height;
  return clampTransform({ width, height, alphaBounds, scale, dx, dy });
}
