import { normalizeAxisAngle, validateEllipseBounds } from './ellipse-geometry.mjs';

const TAU = Math.PI * 2;

function checked(width, height, geometry) {
  if (!geometry || ![geometry.centerX, geometry.centerY, geometry.radiusX, geometry.radiusY, geometry.axisAngle].every(Number.isFinite) ||
      geometry.radiusX < geometry.radiusY || geometry.radiusY <= 0 || !validateEllipseBounds(width, height, geometry, 0))
    throw new Error('Ellipse crop needs a finite, bounded outer ellipse.');
  return { ...geometry, axisAngle: normalizeAxisAngle(geometry.axisAngle) };
}

/** Source pixel -> unit-disk coordinates: D^-1 · R(-axisAngle) · (p-center). */
export function sourceToUnitDisk(point, geometry) {
  const c = Math.cos(geometry.axisAngle), s = Math.sin(geometry.axisAngle);
  const dx = point.x - geometry.centerX, dy = point.y - geometry.centerY;
  return { x: (c * dx + s * dy) / geometry.radiusX, y: (-s * dx + c * dy) / geometry.radiusY };
}

/** Unit-disk coordinate -> source pixel: center + R(axisAngle) · D · u. */
export function unitDiskToSource(point, geometry) {
  const c = Math.cos(geometry.axisAngle), s = Math.sin(geometry.axisAngle);
  const x = geometry.radiusX * point.x, y = geometry.radiusY * point.y;
  return { x: geometry.centerX + c * x - s * y, y: geometry.centerY + s * x + c * y };
}

/** Source pixel -> circularized output pixel. Stamp rotation is a separate output-space rotation. */
export function sourceToCircularPixel(point, geometry, outputSize, stampRotation = 0) {
  const u = sourceToUnitDisk(point, geometry), axisC = Math.cos(geometry.axisAngle), axisS = Math.sin(geometry.axisAngle);
  const sourceFrame = { x: axisC * u.x - axisS * u.y, y: axisS * u.x + axisC * u.y };
  const c = Math.cos(stampRotation), s = Math.sin(stampRotation), half = outputSize / 2;
  return { x: half + half * (c * sourceFrame.x - s * sourceFrame.y), y: half + half * (s * sourceFrame.x + c * sourceFrame.y) };
}

/**
 * Draw an affine ellipse-to-disk resample to a transparent canvas. The disk
 * mask is output-space; no perspective warp or source-content inference runs.
 */
export function drawCircularizedEllipse(ctx, source, width, height, geometry, outputSize = 512, stampRotation = 0) {
  const ellipse = checked(width, height, geometry);
  if (!Number.isInteger(outputSize) || outputSize < 16 || outputSize > 4096 || !Number.isFinite(stampRotation)) throw new Error('Invalid ellipse crop output options.');
  const c = Math.cos(ellipse.axisAngle), s = Math.sin(ellipse.axisAngle), cp = Math.cos(stampRotation), sp = Math.sin(stampRotation);
  const kx = outputSize / (2 * ellipse.radiusX), ky = outputSize / (2 * ellipse.radiusY);
  // A = R(stampRotation) · R(axisAngle) · diag(kx,ky) · R(-axisAngle).
  // The final R(axisAngle) keeps the print's source-photo orientation at
  // default rotation while the ellipse silhouette becomes a circle.
  const baseA = kx * c * c + ky * s * s, baseC = (kx - ky) * s * c;
  const baseB = baseC, baseD = kx * s * s + ky * c * c;
  const a = cp * baseA - sp * baseB;
  const cxy = cp * baseC - sp * baseD;
  const b = sp * baseA + cp * baseB;
  const d = sp * baseC + cp * baseD;
  const e = outputSize / 2 - a * ellipse.centerX - cxy * ellipse.centerY;
  const f = outputSize / 2 - b * ellipse.centerX - d * ellipse.centerY;
  ctx.save();
  ctx.beginPath(); ctx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, TAU); ctx.clip();
  ctx.transform(a, b, cxy, d, e, f);
  ctx.drawImage(source, 0, 0, width, height);
  ctx.restore();
}
