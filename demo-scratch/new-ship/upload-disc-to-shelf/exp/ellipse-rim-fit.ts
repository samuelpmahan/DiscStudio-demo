import type { CircleCandidate, RimEllipse } from '../circle-candidates.ts';
import type { OpposingRimEvidence, RimSpoke } from './opposing-rim-fit.ts';

type Fit = { radius: number; dx: number; dy: number; u: number; v: number };
type Point = { angle: number; distance: number; score: number };
export type EllipseRimEvidence = {
  schema: 'EllipseRimEvidence@1';
  status: 'accepted' | 'abstained';
  reason?: string;
  candidate: CircleCandidate | null;
  ellipse: RimEllipse | null;
  trial?: RimEllipse;
  circleMedianResidual?: number;
  ellipseMedianResidual?: number;
  coverage?: number;
  opposingPairs?: number;
  rimPoints?: readonly Point[];
};

const axes = (angle: number) => [1, Math.cos(angle), Math.sin(angle), Math.cos(2 * angle), Math.sin(2 * angle)];
function predict(fit: Fit, angle: number) {
  const [one, cos, sin, cos2, sin2] = axes(angle);
  return fit.radius * one + fit.dx * cos + fit.dy * sin + fit.u * cos2 + fit.v * sin2;
}
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Bounded weighted least squares over the first two angular harmonics. */
function solve(points: readonly Point[], terms: 3 | 5): Fit | null {
  const matrix = Array.from({ length: terms }, () => Array(terms + 1).fill(0));
  for (const point of points) {
    const features = axes(point.angle), weight = Math.min(.5, point.score);
    for (let i = 0; i < terms; i++) {
      for (let j = 0; j < terms; j++) matrix[i][j] += weight * features[i] * features[j];
      matrix[i][terms] += weight * features[i] * point.distance;
    }
  }
  for (let col = 0; col < terms; col++) {
    let pivot = col;
    for (let row = col + 1; row < terms; row++) if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    if (Math.abs(matrix[pivot][col]) < 1e-7) return null;
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    const divisor = matrix[col][col];
    for (let j = col; j <= terms; j++) matrix[col][j] /= divisor;
    for (let row = 0; row < terms; row++) if (row !== col) {
      const factor = matrix[row][col];
      for (let j = col; j <= terms; j++) matrix[row][j] -= factor * matrix[col][j];
    }
  }
  return { radius: matrix[0][terms], dx: matrix[1][terms], dy: matrix[2][terms], u: terms === 5 ? matrix[3][terms] : 0, v: terms === 5 ? matrix[4][terms] : 0 };
}

function nearestRing(spokes: readonly RimSpoke[], fit: Fit, anchorRadius: number, band: number): Point[] {
  const points: Point[] = [];
  for (const spoke of spokes) {
    const wanted = predict(fit, spoke.angle);
    let chosen: RimSpoke['peaks'][number] | null = null, best = -Infinity;
    for (const peak of spoke.peaks) {
      const offset = Math.abs(peak.distance - wanted);
      if (offset > anchorRadius * band) continue;
      const merit = peak.score - offset / anchorRadius * 1.7;
      if (merit > best) { chosen = peak; best = merit; }
    }
    if (chosen) points.push({ angle: spoke.angle, distance: chosen.distance, score: chosen.score });
  }
  return points;
}

/** Use rim points from the existing opposing-rim Part, and abstain on incomplete or nearly circular support. */
export function fitEllipseRim(source: { width: number; height: number }, anchor: CircleCandidate, rim: OpposingRimEvidence): EllipseRimEvidence {
  const abstain = (reason: string, extras: Partial<EllipseRimEvidence> = {}): EllipseRimEvidence => Object.freeze({ schema: 'EllipseRimEvidence@1', status: 'abstained', candidate: null, ellipse: null, reason, ...extras });
  if (!anchor?.circle || !(rim?.selected ?? rim?.seed) || !rim.rimSpokes?.length || !source?.width || !source?.height) return abstain('missing-rim-points');
  const baseline = (rim.selected ?? rim.seed)!, radius = anchor.circle.radius;
  let fit: Fit = { radius: baseline.radius, dx: baseline.centerX - anchor.circle.x, dy: baseline.centerY - anchor.circle.y, u: 0, v: 0 };
  for (let pass = 0; pass < 5; pass++) {
    const points = nearestRing(rim.rimSpokes, fit, radius, pass ? .07 : .085);
    if (points.length < 40) break;
    let next = solve(points, 5);
    if (!next) break;
    const inliers = points.filter(point => Math.abs(point.distance - predict(next!, point.angle)) < radius * .04);
    if (inliers.length >= 40) next = solve(inliers, 5) ?? next;
    if (Math.hypot(next.dx, next.dy) > radius * .13 || Math.abs(next.radius - baseline.radius) > radius * .08 || Math.hypot(next.u, next.v) > radius * .16) break;
    fit = next;
  }
  const points = nearestRing(rim.rimSpokes, fit, radius, .032)
    .filter(point => Math.abs(point.distance - predict(fit, point.angle)) < radius * .032);
  const coverage = points.length / 64, present = new Set(points.map(point => Math.round(point.angle * 32 / Math.PI)));
  const opposingPairs = points.filter(point => present.has((Math.round(point.angle * 32 / Math.PI) + 32) % 64)).length / 2;
  const sectors = Array.from({ length: 8 }, (_, i) => points.filter(point => Math.floor(point.angle / (Math.PI / 4)) === i).length);
  if (coverage < .82 || opposingPairs < 22 || sectors.some(count => count < 3)) return abstain('incomplete-ellipse-rim', { coverage, opposingPairs });
  const circle = solve(points, 3);
  if (!circle) return abstain('uncertain-circle-comparison', { coverage, opposingPairs });
  const circleMedianResidual = median(points.map(point => Math.abs(point.distance - predict(circle, point.angle))));
  const ellipseMedianResidual = median(points.map(point => Math.abs(point.distance - predict(fit, point.angle))));
  const detail = { coverage, opposingPairs, circleMedianResidual, ellipseMedianResidual, rimPoints: Object.freeze(points.map(point => Object.freeze(point))) };
  const contrast = Math.hypot(fit.u, fit.v);
  if (contrast < radius * .018 || ellipseMedianResidual > circleMedianResidual * .7 || circleMedianResidual - ellipseMedianResidual < radius * .0035) return abstain('circle-sufficient', detail);
  const major = fit.radius + contrast, minor = fit.radius - contrast, ratio = minor / major;
  if (ratio < .75 || ratio > .97 || ellipseMedianResidual > radius * .018) return abstain('ellipse-not-supported', detail);
  const rotation = Math.atan2(fit.v, fit.u) / 2;
  const ellipse: RimEllipse = Object.freeze({ x: anchor.circle.x + fit.dx, y: anchor.circle.y + fit.dy, radiusX: major, radiusY: minor, rotation });
  const halfX = Math.hypot(major * Math.cos(rotation), minor * Math.sin(rotation));
  const halfY = Math.hypot(major * Math.sin(rotation), minor * Math.cos(rotation));
  if (ellipse.x - halfX < 1 || ellipse.y - halfY < 1 || ellipse.x + halfX >= source.width - 1 || ellipse.y + halfY >= source.height - 1) return abstain('ellipse-outside-image', { ...detail, trial: ellipse });
  const candidate: CircleCandidate = Object.freeze({ id: `${anchor.id}-tilt-repair`, score: coverage, circle: Object.freeze({ x: ellipse.x, y: ellipse.y, radius: fit.radius, confidence: coverage }), ellipse });
  return Object.freeze({ schema: 'EllipseRimEvidence@1', status: 'accepted', candidate, ellipse, ...detail });
}
