import { paintBoundary } from './boundary-paint.mjs';
import { createFrameRenderer, frameStateAt } from './frame-seek.mjs';

/** Exact source-space screen-cardinal extrema, independent of the view. */
export function ellipseExtrema(ellipse) {
  const { centerX: x, centerY: y, radiusX: a, radiusY: b, axisAngle: angle } = ellipse;
  if (![x, y, a, b, angle].every(Number.isFinite) || a <= 0 || b <= 0) throw Error('Finite positive ellipse required');
  const c = Math.cos(angle), s = Math.sin(angle);
  const hx = Math.hypot(a * c, b * s), hy = Math.hypot(a * s, b * c);
  const cross = (a * a - b * b) * s * c;
  return Object.freeze({ halfWidth: hx, halfHeight: hy, points: Object.freeze([
    Object.freeze({ name: 'top', x: x - cross / hy, y: y - hy }),
    Object.freeze({ name: 'right', x: x + hx, y: y + cross / hx }),
    Object.freeze({ name: 'bottom', x: x + cross / hy, y: y + hy }),
    Object.freeze({ name: 'left', x: x - hx, y: y - cross / hx }),
  ]) });
}

export function projectRefinement(snapshot) {
  const { source, ellipse, viewport, view = {} } = snapshot;
  if (!source.identity || ![source.width, source.height, viewport.width, viewport.height, viewport.dpr].every(n => Number.isFinite(n) && n > 0)) throw Error('Explicit source and viewport required');
  const padding = view.padding ?? 16, zoom = view.zoom ?? 1;
  if (!Number.isFinite(padding) || padding < 8 || !Number.isFinite(zoom) || zoom <= 0 || zoom > 1 || (view.projection && view.projection !== 'uniform')) throw Error('View must preserve all four extrema');
  const bounds = ellipseExtrema(ellipse);
  const fittedScale = Math.min((viewport.width - padding * 2) / (bounds.halfWidth * 2), (viewport.height - padding * 2) / (bounds.halfHeight * 2)) * zoom;
  const scale = view.frozenProjection?.scale ?? fittedScale;
  if (!Number.isFinite(scale) || scale <= 0) throw Error('Viewport must exceed padding');
  const dx = view.frozenProjection?.dx ?? viewport.width / 2 - ellipse.centerX * scale, dy = view.frozenProjection?.dy ?? viewport.height / 2 - ellipse.centerY * scale;
  if (![dx,dy].every(Number.isFinite)) throw Error('Finite projection required');
  return Object.freeze({ scale, dx, dy, points: Object.freeze(bounds.points.map(p => Object.freeze({ name: p.name, x: p.x * scale + dx, y: p.y * scale + dy }))) });
}

/** Explicit seek(t): never reads the clock, DOM, fit state, or persistence. */
export function createRefinementRenderer({ createCanvas, drawDots = true }) {
  const frames = createFrameRenderer({ createCanvas, maxLayers: 6 });
  function seek(context, snapshot, t) {
    const state = frameStateAt(snapshot, t), { source, ellipse, viewport } = state;
    const projection = projectRefinement(state), { scale, dx, dy } = projection;
    const width = Math.max(1, Math.round(viewport.width * viewport.dpr)), height = Math.max(1, Math.round(viewport.height * viewport.dpr));
    const identity = JSON.stringify([source.identity, source.width, source.height, ellipse, viewport, state.view]);
    const frame = { width, height, layers: [
      { id: 'refinement-photo', identity: JSON.stringify([source.identity, source.width, source.height, viewport, scale, dx, dy]), draw(ctx) {
        ctx.scale(viewport.dpr, viewport.dpr); ctx.fillStyle = '#dfe5db'; ctx.fillRect(0, 0, viewport.width, viewport.height);
        ctx.drawImage(source.image, dx, dy, source.width * scale, source.height * scale);
      } },
      { id: 'refinement-boundary', identity, draw(ctx) {
        ctx.scale(viewport.dpr, viewport.dpr);
        paintBoundary(ctx, { width:viewport.width, height:viewport.height, centerX:ellipse.centerX * scale + dx, centerY:ellipse.centerY * scale + dy, radiusX:ellipse.radiusX * scale, radiusY:ellipse.radiusY * scale, axisAngle:ellipse.axisAngle });
        if (drawDots) for (const point of projection.points) { ctx.beginPath(); ctx.arc(point.x, point.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#173a30'; ctx.stroke(); }
      } },
    ] };
    const receipt = frames.seek(context, frame, t);
    return Object.freeze({ projection, receipt });
  }
  return { seek, metrics: frames.metrics, clear: frames.clear };
}
