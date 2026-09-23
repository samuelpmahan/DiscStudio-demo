import { detectDiscCircle, mapWorkingCircleToSource, refineDiscCircle, type DiscCircle } from './circle-fit.ts';

/** The raster shape already used by CircleFit's photo-intake calculation. */
export type Raster = {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
};

/** A source-space circle that can be shown or selected by a caller. */
export type RimEllipse = { x: number; y: number; radiusX: number; radiusY: number; rotation: number };
export type CircleCandidate = {
  id: string;
  circle: DiscCircle;
  score: number;
  ellipse?: RimEllipse;
};

const MAX_INITIAL = 3;
const MIN_EVIDENCE = .055;

function usableRaster(raster: Raster | null | undefined): raster is Raster {
  return !!raster && Number.isInteger(raster.width) && Number.isInteger(raster.height) && raster.width >= 32 && raster.height >= 32 && raster.rgba instanceof Uint8ClampedArray && raster.rgba.length >= raster.width * raster.height * 4;
}

function limitValue(limit: number | undefined, fallback: number) {
  if (limit === undefined) return fallback;
  if (!Number.isFinite(limit)) return 0;
  return Math.max(0, Math.min(MAX_INITIAL, Math.floor(limit)));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * DiscCircle coordinates are pixel-centre coordinates. The corresponding
 * crop centre is (x + .5, y + .5), matching cropForSourceSamples. Keeping
 * this conversion local avoids silently changing candidate source geometry.
 */
function boundedCircle(width: number, height: number, circle: DiscCircle): DiscCircle | null {
  if (![circle?.x, circle?.y, circle?.radius, circle?.confidence].every(Number.isFinite) || circle.radius <= 0) return null;
  const minimum = Math.max(1, Math.min(width, height) * .035);
  const maxRadius = Math.min(width, height) / 2;
  const radius = clamp(circle.radius, minimum, maxRadius);
  const x = clamp(circle.x, radius - .5, width - radius - .5);
  const y = clamp(circle.y, radius - .5, height - radius - .5);
  return { ...circle, x, y, radius };
}

function sample(raster: Raster, x: number, y: number) {
  const sx = clamp(Math.round(x), 0, raster.width - 1), sy = clamp(Math.round(y), 0, raster.height - 1), index = (sy * raster.width + sx) * 4;
  return [raster.rgba[index], raster.rgba[index + 1], raster.rgba[index + 2]];
}

function colourDistance(a: number[], b: number[]) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

/** Deterministic local edge support; values are comparable within one raster. */
function circleEvidence(raster: Raster, circle: DiscCircle) {
  // Keep the sampling band proportional in source and working rasters. A
  // fixed four-pixel cap would collapse a source-scale thin rim after a
  // working-scale detector pass on large photos.
  const margin = Math.max(1.5, circle.radius * .045);
  const contrasts: number[] = [];
  const samples = 48;
  for (let index = 0; index < samples; index++) {
    const angle = index * Math.PI * 2 / samples, cos = Math.cos(angle), sin = Math.sin(angle);
    const inside = sample(raster, circle.x + cos * (circle.radius - margin), circle.y + sin * (circle.radius - margin));
    const outside = sample(raster, circle.x + cos * (circle.radius + margin), circle.y + sin * (circle.radius + margin));
    contrasts.push(colourDistance(inside, outside) / 765);
  }
  const average = contrasts.reduce((sum, value) => sum + value, 0) / samples;
  // A large circle grazing one foreground object can have a respectable
  // average contrast at only a few angles. Require broad angular support so
  // broad search returns real circles rather than partial-image arcs.
  const support = contrasts.filter(value => value >= Math.max(.08, average * .35)).length / samples;
  return average * support;
}

function sourceFit(working: Raster, source: Raster, coarse: DiscCircle) {
  const mapped = mapWorkingCircleToSource(coarse, working.width, working.height, source.width, source.height);
  const refined = refineDiscCircle(source.rgba, source.width, source.height, mapped);
  return boundedCircle(source.width, source.height, refined);
}

function candidate(id: string, circle: DiscCircle, score: number): CircleCandidate {
  return Object.freeze({ id, circle: Object.freeze({ ...circle }), score });
}

function circleDistance(a: DiscCircle, b: DiscCircle) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.radius - b.radius);
}

function isDistinct(circle: DiscCircle, others: readonly DiscCircle[], minimum = 2, fraction = .045) {
  const threshold = Math.max(minimum, circle.radius * fraction);
  return others.every(other => circleDistance(circle, other) >= threshold);
}

function sortCircles(rows: Array<{ circle: DiscCircle; score: number }>) {
  return rows.sort((a, b) => b.score - a.score || a.circle.y - b.circle.y || a.circle.x - b.circle.x || a.circle.radius - b.circle.radius);
}

function localCircleSeeds(anchor: DiscCircle, width: number, height: number) {
  // Search coarse-to-fine around the selected anchor. The outer ring stays
  // well inside the local contract; the smaller rings make repeated refine
  // passes useful for sub-pixel-ish source corrections without global jumps.
  const offsets: Array<[number, number, number]> = [[0, 0, 0]];
  for (const fraction of [.16, .09, .045, .022]) {
    const centerStep = Math.max(.75, anchor.radius * fraction), radiusStep = Math.max(.75, anchor.radius * fraction * .8);
    offsets.push(
      [-centerStep, 0, 0], [centerStep, 0, 0], [0, -centerStep, 0], [0, centerStep, 0],
      [0, 0, -radiusStep], [0, 0, radiusStep],
      [-centerStep, -centerStep, 0], [centerStep, centerStep, 0], [-centerStep, centerStep, 0], [centerStep, -centerStep, 0],
    );
    // Joint center/radius moves matter when a crop edge is biased: moving a
    // centre and growing/shrinking together can restore both rim sides in a
    // single local round where either axis alone cannot.
    for (const dx of [-centerStep, 0, centerStep]) for (const dy of [-centerStep, 0, centerStep]) {
      if (dx === 0 && dy === 0) continue;
      offsets.push([dx, dy, -radiusStep], [dx, dy, radiusStep]);
    }
  }
  return offsets.map(([dx, dy, dr]) => boundedCircle(width, height, { ...anchor, x: anchor.x + dx, y: anchor.y + dy, radius: anchor.radius + dr })).filter((circle): circle is DiscCircle => !!circle);
}

function supportedConcentricShrink(source: Raster, anchor: CircleCandidate): CircleCandidate | null {
  const targetRadius = Math.min(anchor.circle.radius - 1, Math.floor(anchor.circle.radius * .988));
  const circle = boundedCircle(source.width, source.height, { ...anchor.circle, radius: targetRadius });
  if (!circle || circle.x !== anchor.circle.x || circle.y !== anchor.circle.y || circle.radius >= anchor.circle.radius) return null;
  if (!isDistinct(circle, [anchor.circle], 1, .0075)) return null;
  const score = circleEvidence(source, circle);
  return score >= MIN_EVIDENCE ? candidate(`${anchor.id}-local-1`, { ...circle, confidence: score }, score) : null;
}

function localAlternatives(source: Raster, anchor: CircleCandidate, limit: number, { reserveConcentricShrink = false }: { reserveConcentricShrink?: boolean } = {}) {
  if (limit <= 1) return [anchor];
  const rows = sortCircles(localCircleSeeds(anchor.circle, source.width, source.height).map(circle => ({ circle, score: circleEvidence(source, circle) })));
  const selected: CircleCandidate[] = [anchor];
  // A Refine round must offer one stable, visibly meaningful rim trim before
  // evidence ranking spends the remaining slot on a center-correction option.
  // Initial candidates keep the original score-only selection behavior.
  if (reserveConcentricShrink) {
    const shrink = supportedConcentricShrink(source, anchor);
    if (shrink) selected.push(shrink);
  }
  if (selected.length >= limit) return selected;
  for (const row of rows) {
    if (selected.some(existing => existing.circle === row.circle)) continue;
    // Local options need a finer separation than global object NMS so small
    // joint centre/radius corrections remain selectable.
    if (!isDistinct(row.circle, selected.map(existing => existing.circle), 1, .0075)) continue;
    // Keep alternatives tied to visible support, while always retaining the
    // selected anchor even when its source has weak or partial evidence.
    if (row.score < MIN_EVIDENCE) continue;
    selected.push(candidate(`${anchor.id}-local-${selected.length}`, { ...row.circle, confidence: row.score }, row.score));
    if (selected.length >= limit) break;
  }
  return selected;
}

/**
 * Refine one selected option without re-running a global detector. The first
 * result is the exact object supplied by the caller, preserving its id and
 * source-space circle byte-for-byte; only following results are local.
 */
export function refineCircleCandidates(source: Raster, anchor: CircleCandidate, limit = MAX_INITIAL): CircleCandidate[] {
  const wanted = limitValue(limit, MAX_INITIAL);
  if (!wanted || !usableRaster(source) || !anchor || !anchor.circle) return [];
  const bounded = boundedCircle(source.width, source.height, anchor.circle);
  if (!bounded) return [];
  if (bounded.x !== anchor.circle.x || bounded.y !== anchor.circle.y || bounded.radius !== anchor.circle.radius) return [];
  return localAlternatives(source, anchor, wanted, { reserveConcentricShrink: true });
}

type RawCircle = { circle: DiscCircle; score: number };

function broadWorkingSeeds(working: Raster) {
  const shortest = Math.min(working.width, working.height), minRadius = Math.max(12, shortest * .18), maxRadius = shortest * .48;
  const radiusStep = Math.max(2, shortest * .03), stride = Math.max(3, shortest / 28), rows: RawCircle[] = [];
  const coarse = detectDiscCircle(working.rgba, working.width, working.height);
  if (coarse) rows.push({ circle: coarse, score: circleEvidence(working, coarse) });
  for (let radius = minRadius; radius <= maxRadius + .001; radius += radiusStep) {
    for (let y = radius - .5; y <= working.height - radius - .5 + .001; y += stride) for (let x = radius - .5; x <= working.width - radius - .5 + .001; x += stride) {
      const circle: DiscCircle = { x, y, radius, confidence: 0 }, score = circleEvidence(working, circle);
      if (score >= MIN_EVIDENCE) rows.push({ circle, score });
    }
  }
  return sortCircles(rows);
}

function sameRegion(a: DiscCircle, b: DiscCircle) {
  const scale = Math.max(a.radius, b.radius);
  return Math.hypot(a.x - b.x, a.y - b.y) < scale * .7 && Math.abs(a.radius - b.radius) < scale * .25;
}

function globalCircleCandidates(working: Raster, source: Raster, excluded: readonly CircleCandidate[], wanted: number, idPrefix: string) {
  const excludedCircles = (excluded ?? []).map(row => row?.circle).filter((circle): circle is DiscCircle => !!circle);
  const selected: Array<{ raw: RawCircle; mapped: DiscCircle }> = [];
  const selectedWorking: RawCircle[] = [];
  // Rank and suppress at working resolution first. The source-resolution
  // refiner scans every source pixel, so it is intentionally reserved for
  // the few final spatial winners rather than every near-duplicate seed.
  for (const raw of broadWorkingSeeds(working)) {
    const mappedRaw = boundedCircle(source.width, source.height, mapWorkingCircleToSource(raw.circle, working.width, working.height, source.width, source.height));
    if (!mappedRaw || excludedCircles.some(circle => sameRegion(mappedRaw, circle)) || selectedWorking.some(row => sameRegion(raw.circle, row.circle))) continue;
    selectedWorking.push(raw);
    if (selectedWorking.length >= Math.max(6, wanted * 3)) break;
  }
  for (const raw of selectedWorking) {
    const mapped = boundedCircle(source.width, source.height, mapWorkingCircleToSource(raw.circle, working.width, working.height, source.width, source.height));
    if (!mapped) continue;
    selected.push({ raw, mapped });
    if (selected.length >= Math.max(6, wanted * 2)) break;
  }
  const polished: CircleCandidate[] = [];
  for (const row of selected) {
    // Preserve the ranked working evidence as the public score. A source
    // raster may have a different edge bandwidth, but the mapped geometry is
    // still source-valid and the existing refiner can safely polish it here.
    const refined = sourceFit(working, source, row.raw.circle) ?? row.mapped;
    if (excludedCircles.some(circle => sameRegion(refined, circle)) || polished.some(item => sameRegion(refined, item.circle))) continue;
    polished.push(candidate(`${idPrefix}-${polished.length + 1}`, { ...refined, confidence: row.raw.score }, row.raw.score));
    if (polished.length >= wanted) break;
  }
  return polished;
}

/**
 * Search globally for additional evidence while excluding earlier options.
 * This is deliberately separate from refineCircleCandidates: callers can
 * page to a different object when every local/initial option is wrong.
 */
export function findOtherCircleCandidates(working: Raster, source: Raster, excluded: readonly CircleCandidate[], limit = MAX_INITIAL): CircleCandidate[] {
  const wanted = limitValue(limit, MAX_INITIAL);
  if (!wanted || !usableRaster(working) || !usableRaster(source)) return [];
  return globalCircleCandidates(working, source, excluded, wanted, 'circle-other');
}

/**
 * Initial choices are the top spatially distinct global proposals. Local
 * correction belongs to refineCircleCandidates; keeping these pools separate
 * prevents a single detector winner from becoming three nearby fake objects.
 */
export function findInitialCircleCandidates(working: Raster, source: Raster, limit = MAX_INITIAL): CircleCandidate[] {
  const wanted = limitValue(limit, MAX_INITIAL);
  if (!wanted || !usableRaster(working) || !usableRaster(source)) return [];
  const global = globalCircleCandidates(working, source, [], wanted, 'circle-option');
  if (!global.length || global.length >= wanted) return global;
  // A photo may contain only one supported global region. Fill remaining
  // initial slots with supported local fits of that known region, while
  // leaving the broad "other" search strictly global and exclusion-aware.
  const filled = [...global], local = localAlternatives(source, global[0], wanted);
  for (const option of local.slice(1)) {
    if (filled.length >= wanted) break;
    if (!isDistinct(option.circle, filled.map(row => row.circle), 1, .0075)) continue;
    filled.push(candidate(`circle-option-${filled.length + 1}`, option.circle, option.score));
  }
  return filled;
}

// Friendly aliases for callers that describe the operation as proposing.
export const proposeCircleCandidates = findInitialCircleCandidates;
export const findCircleCandidates = findInitialCircleCandidates;
