export function normalizeAxisAngle(angle) {
  if (!Number.isFinite(angle)) throw new RangeError('Ellipse axis angle must be finite.');
  const normalized = ((angle + Math.PI / 2) % Math.PI + Math.PI) % Math.PI - Math.PI / 2;
  return Math.abs(normalized) < 1e-12 ? 0 : normalized;
}

export function ellipseBounds(ellipse) {
  const c = Math.cos(ellipse.axisAngle), s = Math.sin(ellipse.axisAngle);
  return {
    halfWidth: Math.hypot(ellipse.radiusX * c, ellipse.radiusY * s),
    halfHeight: Math.hypot(ellipse.radiusX * s, ellipse.radiusY * c),
  };
}

export function canonicalEllipse(ellipse) {
  let { centerX, centerY, radiusX, radiusY, axisAngle } = ellipse;
  if (![centerX, centerY, radiusX, radiusY, axisAngle].every(Number.isFinite))
    throw new RangeError('Ellipse geometry must be finite before canonicalization.');
  if (radiusY > radiusX) { [radiusX, radiusY] = [radiusY, radiusX]; axisAngle += Math.PI / 2; }
  return Object.freeze({ centerX, centerY, radiusX, radiusY, axisAngle: normalizeAxisAngle(axisAngle) });
}

export function validateEllipseBounds(width, height, ellipse, margin = 0) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2 ||
      !ellipse || ![ellipse.centerX, ellipse.centerY, ellipse.radiusX, ellipse.radiusY, ellipse.axisAngle].every(Number.isFinite) ||
      ellipse.radiusX < ellipse.radiusY || ellipse.radiusY <= 0 || margin < 0) return false;
  const { halfWidth, halfHeight } = ellipseBounds(ellipse);
  return ellipse.centerX - halfWidth >= margin && ellipse.centerY - halfHeight >= margin &&
    ellipse.centerX + halfWidth <= width - 1 - margin && ellipse.centerY + halfHeight <= height - 1 - margin;
}
