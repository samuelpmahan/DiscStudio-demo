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
