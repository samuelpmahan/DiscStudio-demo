import type { CircleCandidate, Raster } from '../circle-candidates.ts';

export type CenterFitEvidence = {
  schema: 'CenterFitEvidence@1';
  status: 'accepted' | 'abstained';
  candidate: CircleCandidate | null;
  reason?: string;
  centerShift: number;
  originalSupport: number;
  proposedSupport: number;
};

function pixel(source: Raster, x: number, y: number) {
  const sx = Math.max(0, Math.min(source.width - 1, Math.round(x)));
  const sy = Math.max(0, Math.min(source.height - 1, Math.round(y)));
  const index = (sy * source.width + sx) * 4;
  return [source.rgba[index], source.rgba[index + 1], source.rgba[index + 2]];
}

function perimeterSupport(source: Raster, x: number, y: number, radius: number) {
  const contrasts: number[] = [], margin = Math.max(1.5, radius * .04);
  for (let i = 0; i < 64; i++) {
    const angle = i * Math.PI / 32, ux = Math.cos(angle), uy = Math.sin(angle);
    const inside = pixel(source, x + ux * (radius - margin), y + uy * (radius - margin));
    const outside = pixel(source, x + ux * (radius + margin), y + uy * (radius + margin));
    contrasts.push((Math.abs(inside[0] - outside[0]) + Math.abs(inside[1] - outside[1]) + Math.abs(inside[2] - outside[2])) / 765);
  }
  const ordered = [...contrasts].sort((a, b) => a - b);
  const mean = contrasts.reduce((sum, value) => sum + value, 0) / contrasts.length;
  const coverage = contrasts.filter(value => value >= Math.max(.08, mean * .35)).length / contrasts.length;
  // The lower quartile rewards evidence around the whole circumference;
  // contrast from one bedsheet fold cannot compensate for a weak far side.
  return mean * coverage + ordered[16] * .2;
}

/** A separate, deterministic derivation of the same semantic disc circle. */
export function fitCircleCenter(source: Raster, anchor: CircleCandidate): CenterFitEvidence {
  const abstain = (reason: string, originalSupport = 0, proposedSupport = 0): CenterFitEvidence => Object.freeze({ schema: 'CenterFitEvidence@1', status: 'abstained', candidate: null, reason, centerShift: 0, originalSupport, proposedSupport });
  if (!source || !Number.isInteger(source.width) || !Number.isInteger(source.height) || source.rgba?.length < source.width * source.height * 4) return abstain('invalid-raster');
  const original = anchor?.circle;
  if (!original || ![original.x, original.y, original.radius].every(Number.isFinite) || original.radius < 12) return abstain('invalid-anchor');
  const valid = (x: number, y: number, radius: number) => radius >= 12 && x - radius >= 1 && y - radius >= 1 && x + radius < source.width - 1 && y + radius < source.height - 1;
  if (!valid(original.x, original.y, original.radius)) return abstain('unbounded-anchor');
  const base = perimeterSupport(source, original.x, original.y, original.radius);
  const step = original.radius * .006;
  let x = original.x, y = original.y, radius = original.radius, best = base;
  // Solve centre while holding radius, then size the radius at that centre.
  // Repeat once for a bounded joint correction; never jump to another object.
  for (let round = 0; round < 2; round++) {
    let centered = { x, y, score: perimeterSupport(source, x, y, radius) };
    for (let dx = -8; dx <= 8; dx++) for (let dy = -8; dy <= 8; dy++) {
      const nextX = x + dx * step, nextY = y + dy * step;
      if (!valid(nextX, nextY, radius) || Math.hypot(nextX - original.x, nextY - original.y) > original.radius * .07) continue;
      const score = perimeterSupport(source, nextX, nextY, radius);
      if (score > centered.score + 1e-9) centered = { x: nextX, y: nextY, score };
    }
    x = centered.x; y = centered.y;
    let sized = { radius, score: centered.score };
    for (let delta = -8; delta <= 8; delta++) {
      const next = radius + delta * step;
      if (!valid(x, y, next) || Math.abs(next - original.radius) > original.radius * .07) continue;
      const score = perimeterSupport(source, x, y, next);
      if (score > sized.score + 1e-9) sized = { radius: next, score };
    }
    radius = sized.radius; best = sized.score;
  }
  const centerShift = Math.hypot(x - original.x, y - original.y);
  if (best < .08 || best - base < .025 || centerShift < original.radius * .008) return abstain('no-supported-center-improvement', base, best);
  const candidate: CircleCandidate = Object.freeze({ id: `${anchor.id}-center`, circle: Object.freeze({ x, y, radius, confidence: best }), score: best });
  return Object.freeze({ schema: 'CenterFitEvidence@1', status: 'accepted', candidate, centerShift, originalSupport: base, proposedSupport: best });
}
