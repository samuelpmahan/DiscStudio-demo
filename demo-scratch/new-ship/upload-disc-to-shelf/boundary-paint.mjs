/** Shared visual paint only. Geometry and view mappings are supplied unchanged.
 * cssPixelScale converts one displayed CSS pixel into current canvas units.
 */
export const boundaryPaintStyle = Object.freeze({ dash: Object.freeze([6,5]), lineWidth: 1, backingWidth: 3, backingStroke: '#173a30', outsideFill: 'rgba(18,39,31,.35)', stroke: '#fff' });
export function paintBoundary(context, { width, height, centerX, centerY, radiusX, radiusY, axisAngle = 0, cssPixelScale = 1 }) {
  if (![width,height,radiusX,radiusY,cssPixelScale].every(value => Number.isFinite(value) && value > 0) || ![centerX,centerY,axisAngle].every(Number.isFinite)) throw Error('Finite boundary paint coordinates required');
  context.save();
  // Separate subpaths make the inside completely clear; dimming terminates at
  // the same ellipse centerline used by the dashed strokes, with no continuous border stroke.
  context.beginPath(); context.rect(0,0,width,height);
  context.moveTo(centerX + radiusX * Math.cos(axisAngle), centerY + radiusX * Math.sin(axisAngle));
  context.ellipse(centerX,centerY,radiusX,radiusY,axisAngle,0,Math.PI * 2);
  context.fillStyle = boundaryPaintStyle.outsideFill; context.fill('evenodd');
  context.beginPath(); context.ellipse(centerX,centerY,radiusX,radiusY,axisAngle,0,Math.PI * 2);
  context.setLineDash(boundaryPaintStyle.dash.map(value => value * cssPixelScale));
  context.lineCap = 'round';
  context.lineWidth = boundaryPaintStyle.backingWidth * cssPixelScale; context.strokeStyle = boundaryPaintStyle.backingStroke; context.stroke();
  context.lineWidth = boundaryPaintStyle.lineWidth * cssPixelScale; context.strokeStyle = boundaryPaintStyle.stroke; context.stroke();
  context.restore();
}
