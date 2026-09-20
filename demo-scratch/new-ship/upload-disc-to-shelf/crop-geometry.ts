// Shared aperture math: the same editable ellipse drives the canvas preview
// and the prepared photo pixels retained for card rendering.
export function normalizeCropRotation(angle: unknown): number {
  if (!Number.isFinite(angle)) return 0;
  const normalized = ((Number(angle) + Math.PI / 2) % Math.PI + Math.PI) % Math.PI - Math.PI / 2;
  return Math.abs(normalized) < 1e-12 ? 0 : normalized;
}

export function cropForSourceSamples(width: number, height: number, geometry: { x: number; y: number; radius?: number; radiusX?: number; radiusY?: number; rotation?: number }) {
  const radiusX = geometry.radiusX ?? geometry.radius;
  const radiusY = geometry.radiusY ?? geometry.radius;
  if (![width, height, geometry.x, geometry.y, radiusX, radiusY].every(Number.isFinite) || !radiusX || !radiusY) throw new Error('Crop proposal needs finite source geometry.');
  return { centerX: (geometry.x + .5) / width, centerY: (geometry.y + .5) / height, radiusX: radiusX / width, radiusY: radiusY / height, rotation: normalizeCropRotation(geometry.rotation) };
}

export function drawRotatedCrop(ctx: CanvasRenderingContext2D, source: CanvasImageSource, mapping: { outputSize: number; sourceCenterX: number; sourceCenterY: number; sourceRadiusX: number; sourceRadiusY: number; rotation?: number }) {
  const { outputSize, sourceCenterX, sourceCenterY, sourceRadiusX, sourceRadiusY, rotation = 0 } = mapping;
  if (![outputSize, sourceCenterX, sourceCenterY, sourceRadiusX, sourceRadiusY].every(Number.isFinite) || sourceRadiusX <= 0 || sourceRadiusY <= 0) throw new Error('Prepared photo needs finite crop geometry.');
  ctx.save();
  ctx.translate(outputSize / 2, outputSize / 2);
  ctx.rotate(rotation);
  ctx.scale(outputSize / (2 * sourceRadiusX), outputSize / (2 * sourceRadiusY));
  ctx.rotate(-rotation);
  ctx.translate(-sourceCenterX, -sourceCenterY);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
}
