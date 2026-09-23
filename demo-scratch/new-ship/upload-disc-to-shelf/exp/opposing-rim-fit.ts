import type { CircleCandidate, Raster } from '../circle-candidates.ts';

export type RimPeak = Readonly<{ distance: number; score: number }>;
export type RimSpoke = Readonly<{ angle: number; peaks: readonly RimPeak[] }>;
type Peak = RimPeak;
type Spoke = RimSpoke;
type Observation = { angle: number; distance: number; weight: number; score: number };
type Fit = { radius: number; dx: number; dy: number };
export type RimHypothesis = { radius: number; centerX: number; centerY: number; coverage: number; opposingPairs: number; medianResidual: number; strength: number; sectors: readonly number[] };
export type OpposingRimEvidence = {
  schema: 'OpposingRimEvidence@1';
  status: 'accepted' | 'abstained';
  candidate: CircleCandidate | null;
  reason?: string;
  hypotheses: readonly RimHypothesis[];
  selected: RimHypothesis | null;
  seed?: RimHypothesis | null;
  rimSpokes?: readonly RimSpoke[];
};

function sample(source: Raster, x: number, y: number) {
  const px = Math.max(0, Math.min(source.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(source.height - 1, Math.round(y)));
  const index = (py * source.width + px) * 4;
  return [source.rgba[index], source.rgba[index + 1], source.rgba[index + 2]];
}

function colourDistance(a: number[], b: number[]) {
  return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 765;
}

function median(numbers: number[]) {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Only inspect a narrow annulus once. Keep inner and outer rim hits separately. */
export function scanRimSpokes(source: Raster, circle: CircleCandidate['circle']): readonly RimSpoke[] {
  const { x, y, radius } = circle, gap = Math.max(2, radius * .01), step = Math.max(1, radius * .003), spokes: Spoke[] = [];
  for (let index = 0; index < 64; index++) {
    const angle = index * Math.PI / 32, ux = Math.cos(angle), uy = Math.sin(angle), values: Peak[] = [];
    for (let distance = radius * .80; distance < radius * 1.30; distance += step) {
      const px = x + ux * distance, py = y + uy * distance;
      if (px - gap < 0 || py - gap < 0 || px + gap >= source.width || py + gap >= source.height) continue;
      const radial = colourDistance(sample(source, px - ux * gap, py - uy * gap), sample(source, px + ux * gap, py + uy * gap));
      const tangent = colourDistance(sample(source, px + uy * gap, py - ux * gap), sample(source, px - uy * gap, py + ux * gap));
      values.push({ distance, score: radial * radial / (radial + tangent + .02) });
    }
    const maxima: Peak[] = [];
    for (let j = 1; j < values.length - 1; j++) if (values[j].score >= .02 && values[j].score >= values[j - 1].score && values[j].score >= values[j + 1].score) maxima.push(values[j]);
    maxima.sort((a, b) => b.score - a.score);
    const peaks: Peak[] = [];
    for (const peak of maxima) {
      if (peaks.every(previous => Math.abs(previous.distance - peak.distance) > radius * .013)) peaks.push(Object.freeze(peak));
      if (peaks.length === 9) break;
    }
    spokes.push(Object.freeze({ angle, peaks: Object.freeze(peaks) }));
  }
  return Object.freeze(spokes);
}

/** Weighted least squares for distance(theta) = radius + dx*cos(theta) + dy*sin(theta). */
function solve(observations: Observation[]): Fit | null {
  const matrix = Array.from({ length: 3 }, () => [0, 0, 0, 0]);
  for (const row of observations) {
    const axes = [1, Math.cos(row.angle), Math.sin(row.angle)];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) matrix[i][j] += row.weight * axes[i] * axes[j];
      matrix[i][3] += row.weight * axes[i] * row.distance;
    }
  }
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    if (Math.abs(matrix[pivot][col]) < 1e-6) return null;
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    const divisor = matrix[col][col];
    for (let j = col; j < 4; j++) matrix[col][j] /= divisor;
    for (let row = 0; row < 3; row++) if (row !== col) {
      const factor = matrix[row][col];
      for (let j = col; j < 4; j++) matrix[row][j] -= factor * matrix[col][j];
    }
  }
  return { radius: matrix[0][3], dx: matrix[1][3], dy: matrix[2][3] };
}

function fitHypothesis(spokes: readonly Spoke[], anchor: CircleCandidate['circle'], factor: number): RimHypothesis {
  const { radius } = anchor;
  let fit: Fit = { radius: radius * factor, dx: 0, dy: 0 };
  for (let iteration = 0; iteration < 5; iteration++) {
    const observations: Observation[] = [];
    for (const { angle, peaks } of spokes) {
      const predicted = fit.radius + fit.dx * Math.cos(angle) + fit.dy * Math.sin(angle);
      let best: Peak | null = null, bestMerit = -Infinity;
      for (const peak of peaks) {
        const offset = Math.abs(peak.distance - predicted);
        if (offset >= radius * (iteration === 0 ? .16 : .08)) continue;
        // The radius hypothesis selects an edge family; a stronger inner rim
        // must not pull an outer-rim hypothesis across a concentric dark band.
        const merit = peak.score - offset / radius * 2;
        if (merit > bestMerit) { best = peak; bestMerit = merit; }
      }
      if (best) observations.push({ angle, distance: best.distance, weight: Math.min(.5, best.score), score: best.score });
    }
    if (observations.length < 28) break;
    let next = solve(observations);
    if (!next) break;
    const inliers = observations.filter(row => Math.abs(row.distance - next!.radius - next!.dx * Math.cos(row.angle) - next!.dy * Math.sin(row.angle)) < radius * .032);
    if (inliers.length >= 25) next = solve(inliers) ?? next;
    if (Math.hypot(next.dx, next.dy) > radius * .1 || Math.abs(next.radius - radius) > radius * .2) break;
    fit = next;
  }
  const matched: Observation[] = [];
  for (const { angle, peaks } of spokes) {
    const predicted = fit.radius + fit.dx * Math.cos(angle) + fit.dy * Math.sin(angle);
    const near = peaks.filter(peak => Math.abs(peak.distance - predicted) < radius * .025).sort((a, b) => b.score - a.score)[0];
    if (near) matched.push({ angle, distance: near.distance, weight: Math.abs(near.distance - predicted), score: near.score });
  }
  const sectors = Array.from({ length: 8 }, (_, sector) => matched.filter(row => Math.floor(row.angle / (Math.PI / 4)) === sector).length);
  const present = new Set(matched.map(row => Math.round(row.angle * 32 / Math.PI)));
  const opposingPairs = matched.filter(row => present.has((Math.round(row.angle * 32 / Math.PI) + 32) % 64)).length / 2;
  return Object.freeze({ radius: fit.radius, centerX: anchor.x + fit.dx, centerY: anchor.y + fit.dy, coverage: matched.length / 64, opposingPairs, medianResidual: matched.length ? median(matched.map(row => row.weight)) : Infinity, strength: matched.reduce((sum, row) => sum + row.score, 0) / Math.max(1, matched.length), sectors: Object.freeze(sectors) });
}

/** Geometry first: opposing edges imply a centre; a supported closed ring implies its radius. */
export function fitOpposingRim(source: Raster, anchor: CircleCandidate): OpposingRimEvidence {
  const abstain = (reason: string, hypotheses: RimHypothesis[] = []): OpposingRimEvidence => Object.freeze({ schema: 'OpposingRimEvidence@1', status: 'abstained', candidate: null, reason, hypotheses: Object.freeze(hypotheses), selected: null });
  if (!source || !Number.isInteger(source.width) || !Number.isInteger(source.height) || source.rgba?.length < source.width * source.height * 4) return abstain('invalid-raster');
  const circle = anchor?.circle;
  if (!circle || ![circle.x, circle.y, circle.radius].every(Number.isFinite) || circle.radius < 12) return abstain('invalid-anchor');
  const spokes = scanRimSpokes(source, circle);
  const hypotheses = [.90, .94, .98, 1.02, 1.06, 1.10, 1.14, 1.18, 1.24].map(factor => fitHypothesis(spokes, circle, factor));
  const supported = hypotheses.filter(row => row.coverage >= .82 && row.opposingPairs >= 20 && row.sectors.every(count => count >= 3) && row.medianResidual < circle.radius * .018 && row.strength >= .06
    && Math.hypot(row.centerX - circle.x, row.centerY - circle.y) <= circle.radius * .1
    && row.centerX - row.radius >= 1 && row.centerY - row.radius >= 1 && row.centerX + row.radius < source.width - 1 && row.centerY + row.radius < source.height - 1);
  if (!supported.length) {
    // An elliptical rim can defeat the circle's own sector gate. Preserve a
    // bounded, explicitly unaccepted seed for the independent ellipse check.
    const seed = [...hypotheses].filter(row => row.coverage >= .65 && row.opposingPairs >= 18 && row.strength >= .04 && row.medianResidual < circle.radius * .035)
      .sort((a, b) => b.coverage - a.coverage || b.opposingPairs - a.opposingPairs)[0] ?? null;
    return Object.freeze({ ...abstain('no-closed-opposing-rim', hypotheses), seed, rimSpokes: spokes });
  }
  const strongest = Math.max(...supported.map(row => row.strength));
  // A concentric dark outer rim can be weaker than its bright inner edge.
  // Pick the largest well-supported ring, with a relative strength floor.
  const selected = [...supported].filter(row => row.strength >= strongest * .55).sort((a, b) => b.radius - a.radius || b.coverage - a.coverage)[0];
  if (Math.hypot(selected.centerX - circle.x, selected.centerY - circle.y, selected.radius - circle.radius) < circle.radius * .008) return Object.freeze({ ...abstain('unchanged-circle', hypotheses), selected, rimSpokes: spokes });
  const candidate: CircleCandidate = Object.freeze({ id: `${anchor.id}-opposing-rim`, score: selected.coverage, circle: Object.freeze({ x: selected.centerX, y: selected.centerY, radius: selected.radius, confidence: selected.coverage }) });
  return Object.freeze({ schema: 'OpposingRimEvidence@1', status: 'accepted', candidate, hypotheses: Object.freeze(hypotheses), selected, rimSpokes: spokes });
}
