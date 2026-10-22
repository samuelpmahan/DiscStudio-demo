import { drawCircularizedEllipse } from './experimental/ellipse-fit-fix/ellipse-crop.mjs';
import { canonicalEllipse, ellipseBounds, validateEllipseBounds } from './experimental/ellipse-fit-fix/ellipse-geometry.mjs';

/** Circle archives keep their original v1 shape; ellipse corrections are a tagged v2 shape. */
export type CircleRefitSource = Readonly<{ version: 1; src: string; width: number; height: number; centerX: number; centerY: number; radius: number; rotation: number }>;
export type EllipseRefitSource = Readonly<{ version: 2; kind: 'ellipse'; src: string; width: number; height: number; centerX: number; centerY: number; radiusX: number; radiusY: number; axisAngle: number; rotation: number }>;
export type RefitSource = CircleRefitSource | EllipseRefitSource;
export type CircleSelection = { centerX: number; centerY: number; radiusX: number; radiusY: number; rotation: number };
export type EllipseSelection = { centerX: number; centerY: number; radiusX: number; radiusY: number; axisAngle: number; rotation: number };
export const localPhotoPattern = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

function validDimensions(width: number, height: number) {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0;
}

export function validateRefitSource(value: unknown): RefitSource {
  if (!value || typeof value !== 'object') throw Error('Invalid retained re-fit source.');
  const row = value as Record<string, unknown>;
  if (typeof row.src !== 'string' || !localPhotoPattern.test(row.src) || !validDimensions(row.width as number, row.height as number)) throw Error('Invalid retained re-fit source.');
  if (row.version === 1) {
    const { width, height, centerX, centerY, radius, rotation } = row;
    if ('kind' in row || 'radiusX' in row || 'radiusY' in row || 'axisAngle' in row) throw Error('Invalid retained re-fit source.');
    if (![centerX, centerY, radius, rotation].every(Number.isFinite) || (radius as number) <= 0 || (centerX as number) < (radius as number) || (centerY as number) < (radius as number) || (centerX as number) + (radius as number) > (width as number) + 1e-7 || (centerY as number) + (radius as number) > (height as number) + 1e-7) throw Error('Invalid retained re-fit geometry.');
    return Object.freeze({ version: 1, src: row.src, width: width as number, height: height as number, centerX: centerX as number, centerY: centerY as number, radius: radius as number, rotation: rotation as number });
  }
  if (row.version === 2 && row.kind === 'ellipse') {
    const { width, height, centerX, centerY, radiusX, radiusY, axisAngle, rotation } = row;
    if ('radius' in row) throw Error('Invalid retained re-fit source.');
    if (![centerX, centerY, radiusX, radiusY, axisAngle, rotation].every(Number.isFinite) || !validateEllipseBounds(width as number, height as number, { centerX: centerX as number, centerY: centerY as number, radiusX: radiusX as number, radiusY: radiusY as number, axisAngle: axisAngle as number })) throw Error('Invalid retained ellipse re-fit geometry.');
    return Object.freeze({ version: 2, kind: 'ellipse', src: row.src, width: width as number, height: height as number, centerX: centerX as number, centerY: centerY as number, radiusX: radiusX as number, radiusY: radiusY as number, axisAngle: axisAngle as number, rotation: rotation as number });
  }
  throw Error('Invalid retained re-fit source.');
}

export function retainedSourceBounds(width: number, height: number, crop: CircleSelection) {
  const centerX = crop.centerX * width, centerY = crop.centerY * height, radius = crop.radiusX * width;
  if (![width, height, centerX, centerY, radius].every(Number.isFinite) || width <= 0 || height <= 0 || radius <= 0 || Math.abs(radius - crop.radiusY * height) > 1e-7 || centerX < radius || centerY < radius || centerX + radius > width + 1e-7 || centerY + radius > height + 1e-7) throw Error('Photo needs a bounded source circle.');
  const x = Math.max(0, Math.floor(centerX - 1.5 * radius)), y = Math.max(0, Math.floor(centerY - 1.5 * radius));
  const right = Math.min(width, Math.ceil(centerX + 1.5 * radius)), bottom = Math.min(height, Math.ceil(centerY + 1.5 * radius));
  return { x, y, width: right - x, height: bottom - y, centerX: centerX - x, centerY: centerY - y, radius };
}

function retainedEllipseBounds(width: number, height: number, geometry: EllipseSelection) {
  if (!validDimensions(width, height) || ![geometry.centerX, geometry.centerY, geometry.radiusX, geometry.radiusY, geometry.axisAngle, geometry.rotation].every(Number.isFinite)) throw Error('Photo needs a finite ellipse.');
  const ellipse = canonicalEllipse(geometry);
  if (!validateEllipseBounds(width, height, ellipse)) throw Error('Photo needs a bounded source ellipse.');
  const { halfWidth, halfHeight } = ellipseBounds(ellipse);
  // Keep the ellipse plus the same half-radius context used by circle v1 re-fit.
  const x = Math.max(0, Math.floor(ellipse.centerX - 1.5 * halfWidth));
  const y = Math.max(0, Math.floor(ellipse.centerY - 1.5 * halfHeight));
  const right = Math.min(width, Math.ceil(ellipse.centerX + 1.5 * halfWidth));
  const bottom = Math.min(height, Math.ceil(ellipse.centerY + 1.5 * halfHeight));
  return { x, y, width: right - x, height: bottom - y, geometry: { ...ellipse, centerX: ellipse.centerX - x, centerY: ellipse.centerY - y, rotation: geometry.rotation } };
}

/** Construct both handoff values before the caller changes its committed draft. */
export function prepareCirclePhoto(source: CanvasImageSource, width: number, height: number, crop: CircleSelection, name: string, canvasFactory: () => HTMLCanvasElement = () => document.createElement('canvas'), retained?: RefitSource) {
  const bounds = retainedSourceBounds(width, height, crop), size = Math.max(1, Math.floor(2 * bounds.radius));
  const canvas = canvasFactory(); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d'); if (!ctx) throw Error('Photo canvas unavailable.');
  ctx.save(); ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
  ctx.translate(size / 2, size / 2); ctx.rotate(crop.rotation); ctx.scale(size / (2 * bounds.radius), size / (2 * bounds.radius)); ctx.translate(-crop.centerX * width, -crop.centerY * height); ctx.drawImage(source, 0, 0); ctx.restore();
  const src = canvas.toDataURL('image/webp', .95); if (!localPhotoPattern.test(src)) throw Error('Prepared photo could not be encoded.');
  let refit: RefitSource;
  if (retained) {
    // A later correction keeps all retained surroundings, avoiding repeated narrowing.
    if (retained.width !== width || retained.height !== height) throw Error('Re-fit source dimensions differ.');
    // Choosing the circle path on a v2 source deliberately converts the
    // metadata back to v1 while keeping the same retained pixels and identity.
    refit = validateRefitSource({ version: 1, src: retained.src, width, height, centerX: crop.centerX * width, centerY: crop.centerY * height, radius: bounds.radius, rotation: crop.rotation });
  } else {
    const context = canvasFactory(); context.width = bounds.width; context.height = bounds.height;
    const context2d = context.getContext('2d'); if (!context2d) throw Error('Re-fit canvas unavailable.');
    context2d.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
    refit = validateRefitSource({ version: 1, src: context.toDataURL('image/webp', .94), width: bounds.width, height: bounds.height, centerX: bounds.centerX, centerY: bounds.centerY, radius: bounds.radius, rotation: crop.rotation });
  }
  return Object.freeze({ kind: 'photo' as const, name, src, refit });
}

/** Prepare an explicit creator-approved ellipse as a circular photo, keeping stamp rotation separate. */
export function prepareEllipsePhoto(source: CanvasImageSource, width: number, height: number, geometry: EllipseSelection, name: string, canvasFactory: () => HTMLCanvasElement = () => document.createElement('canvas'), retained?: RefitSource) {
  if (!geometry || ![geometry.centerX, geometry.centerY, geometry.radiusX, geometry.radiusY, geometry.axisAngle, geometry.rotation].every(Number.isFinite)) throw Error('Photo needs a finite ellipse and stamp rotation.');
  const ellipse = canonicalEllipse(geometry);
  if (!validateEllipseBounds(width, height, ellipse)) throw Error('Photo needs a bounded source ellipse.');
  const size = Math.max(16, Math.min(4096, Math.floor(2 * ellipse.radiusX)));
  const canvas = canvasFactory(); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d'); if (!ctx) throw Error('Photo canvas unavailable.');
  ctx.clearRect(0, 0, size, size);
  drawCircularizedEllipse(ctx, source, width, height, ellipse, size, geometry.rotation);
  const src = canvas.toDataURL('image/webp', .95); if (!localPhotoPattern.test(src)) throw Error('Prepared ellipse photo could not be encoded.');
  let refit: EllipseRefitSource;
  if (retained) {
    if (retained.width !== width || retained.height !== height) throw Error('Re-fit source dimensions differ.');
    // v1 circle sources remain usable; an explicit ellipse correction upgrades only its refit metadata.
    refit = validateRefitSource({ version: 2, kind: 'ellipse', src: retained.src, width, height, ...ellipse, rotation: geometry.rotation }) as EllipseRefitSource;
  } else {
    const bounds = retainedEllipseBounds(width, height, { ...ellipse, rotation: geometry.rotation });
    const context = canvasFactory(); context.width = bounds.width; context.height = bounds.height;
    const context2d = context.getContext('2d'); if (!context2d) throw Error('Re-fit canvas unavailable.');
    context2d.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
    refit = validateRefitSource({ version: 2, kind: 'ellipse', src: context.toDataURL('image/webp', .94), width: bounds.width, height: bounds.height, ...bounds.geometry }) as EllipseRefitSource;
  }
  return Object.freeze({ kind: 'photo' as const, name, src, refit });
}
