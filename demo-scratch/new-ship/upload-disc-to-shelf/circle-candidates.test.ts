import test from 'node:test';
import assert from 'node:assert/strict';
import { findInitialCircleCandidates, findOtherCircleCandidates, refineCircleCandidates, type CircleCandidate, type Raster } from './circle-candidates.ts';

function circlesRaster(width: number, height: number, circles: Array<{ x: number; y: number; radius: number }>): Raster {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const foreground = circles.some(circle => Math.hypot(x - circle.x, y - circle.y) <= circle.radius), index = (y * width + x) * 4;
    [rgba[index], rgba[index + 1], rgba[index + 2], rgba[index + 3]] = foreground ? [222, 108, 47, 255] : [24, 34, 45, 255];
  }
  return { width, height, rgba };
}

function rimmedCircleRaster(width: number, height: number, circle: { x: number; y: number; radius: number }): Raster {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const distance = Math.hypot(x - circle.x, y - circle.y), index = (y * width + x) * 4;
    const pixel = distance <= circle.radius - 2 ? [222, 108, 47, 255] : distance <= circle.radius ? [174, 75, 31, 255] : [24, 34, 45, 255];
    rgba.set(pixel, index);
  }
  return { width, height, rgba };
}

function blankRaster(width = 96, height = 96): Raster {
  return { width, height, rgba: new Uint8ClampedArray(width * height * 4) };
}

function distinct(a: CircleCandidate, b: CircleCandidate, minimum = 2, fraction = .045) {
  return Math.hypot(a.circle.x - b.circle.x, a.circle.y - b.circle.y, a.circle.radius - b.circle.radius) >= Math.max(minimum, Math.min(a.circle.radius, b.circle.radius) * fraction);
}

function withinSource(candidate: CircleCandidate, raster: Raster) {
  const { x, y, radius } = candidate.circle;
  return x - radius >= -.5 && x + radius <= raster.width - .5 && y - radius >= -.5 && y + radius <= raster.height - .5;
}

test('initial candidates are deterministic, source-bounded, and genuinely distinct', () => {
  const raster = circlesRaster(220, 160, [{ x: 48, y: 68, radius: 30 }, { x: 110, y: 85, radius: 28 }, { x: 175, y: 62, radius: 34 }]);
  const first = findInitialCircleCandidates(raster, raster, 3), repeat = findInitialCircleCandidates(raster, raster, 3);
  assert.equal(first.length, 3);
  assert.deepEqual(repeat, first);
  assert.deepEqual(first.map(row => row.id), ['circle-option-1', 'circle-option-2', 'circle-option-3']);
  assert.ok(first.every(row => row.score >= 0 && row.score <= 1 && withinSource(row, raster)));
  assert.ok(distinct(first[0], first[1]) && distinct(first[0], first[2]) && distinct(first[1], first[2]));
});

test('initial proposals map working evidence into exact source-space circles', () => {
  const source = circlesRaster(160, 120, [{ x: 110, y: 74, radius: 28 }]);
  const working = circlesRaster(80, 60, [{ x: 55, y: 37, radius: 14 }]);
  const candidates = findInitialCircleCandidates(working, source, 3);
  assert.ok(candidates.length >= 1);
  assert.ok(candidates.every(row => withinSource(row, source)));
  assert.ok(Math.abs(candidates[0].circle.x - 109.5) <= 2);
  assert.ok(Math.abs(candidates[0].circle.y - 73.5) <= 2);
  assert.ok(Math.abs(candidates[0].circle.radius - 28) <= 3);
});

test('refine keeps the selected anchor exact and only searches locally', () => {
  const raster = circlesRaster(220, 160, [{ x: 48, y: 68, radius: 30 }, { x: 110, y: 85, radius: 28 }, { x: 175, y: 62, radius: 34 }]);
  const initial = findInitialCircleCandidates(raster, raster, 3), anchor = initial[0], refined = refineCircleCandidates(raster, anchor, 3);
  assert.strictEqual(refined[0], anchor);
  assert.deepEqual(refined[0], anchor);
  assert.ok(refined.length <= 3);
  for (const row of refined.slice(1)) {
    assert.ok(distinct(row, anchor, 1, .0075));
    assert.ok(Math.hypot(row.circle.x - anchor.circle.x, row.circle.y - anchor.circle.y) <= Math.max(3, anchor.circle.radius * .16));
    assert.ok(Math.abs(row.circle.radius - anchor.circle.radius) <= Math.max(3, anchor.circle.radius * .16));
    assert.ok(withinSource(row, raster));
  }
  assert.deepEqual(refineCircleCandidates(raster, anchor, 3), refined);
});

test('refine reserves a supported concentric rim trim and repeats it from the selected trim', () => {
  const raster = rimmedCircleRaster(160, 140, { x: 80, y: 70, radius: 30 });
  const anchor: CircleCandidate = { id: 'rimmed-anchor', circle: { x: 80, y: 70, radius: 30, confidence: .1 }, score: .1 }, refined = refineCircleCandidates(raster, anchor, 3);
  assert.strictEqual(refined[0], anchor);
  assert.ok(refined.length >= 2, 'supported anchors expose a fine concentric trim');
  const trim = refined[1], targetRadius = Math.min(anchor.circle.radius - 1, Math.floor(anchor.circle.radius * .988));
  assert.equal(trim.circle.x, anchor.circle.x);
  assert.equal(trim.circle.y, anchor.circle.y);
  assert.equal(trim.circle.radius, targetRadius);
  assert.ok(withinSource(trim, raster));

  const repeated = refineCircleCandidates(raster, trim, 3);
  assert.strictEqual(repeated[0], trim);
  assert.ok(repeated.length >= 2, 'the selected trim can be refined again');
  assert.equal(repeated[1].circle.x, trim.circle.x);
  assert.equal(repeated[1].circle.y, trim.circle.y);
  assert.ok(repeated[1].circle.radius < trim.circle.radius);

  const limited = refineCircleCandidates(raster, anchor, 2);
  assert.equal(limited.length, 2);
  assert.strictEqual(limited[0], anchor);
  assert.deepEqual(limited[1], trim);
});

test('offset anchors get a supported local correction and remain stable when selected', () => {
  const truth = { x: 67, y: 58, radius: 28 }, raster = circlesRaster(160, 140, [truth]);
  const anchor: CircleCandidate = { id: 'manual-anchor', circle: { x: 68, y: 59, radius: 30, confidence: .1 }, score: .1 };
  const first = refineCircleCandidates(raster, anchor, 3);
  assert.ok(first.length >= 2, 'a supported offset anchor should expose at least one local alternative');
  assert.strictEqual(first[0], anchor);
  const error = (row: CircleCandidate) => Math.hypot(row.circle.x - truth.x, row.circle.y - truth.y, row.circle.radius - truth.radius);
  assert.ok(first.slice(1).some(row => error(row) < error(anchor)), 'one local option should reduce the source geometry error');
  const centerError = (row: CircleCandidate) => Math.hypot(row.circle.x - truth.x, row.circle.y - truth.y);
  assert.ok(first.slice(1).some(row => centerError(row) < centerError(anchor)), 'the remaining local option should still improve center recovery');

  const selectedImprovement = first[1], repeated = refineCircleCandidates(raster, selectedImprovement, 3);
  assert.ok(repeated.length >= 1);
  assert.strictEqual(repeated[0], selectedImprovement);
  assert.deepEqual(repeated[0].circle, selectedImprovement.circle);
  assert.ok(repeated.slice(1).every(row => Math.hypot(row.circle.x - selectedImprovement.circle.x, row.circle.y - selectedImprovement.circle.y) <= Math.max(3, selectedImprovement.circle.radius * .16)));
});

test('broad alternatives exclude prior options and can find another physical circle', () => {
  const raster = circlesRaster(220, 160, [{ x: 48, y: 68, radius: 30 }, { x: 110, y: 85, radius: 28 }, { x: 175, y: 62, radius: 34 }]);
  const initial = findInitialCircleCandidates(raster, raster, 3), others = findOtherCircleCandidates(raster, raster, [initial[0]], 3);
  assert.ok(others.length >= 1);
  assert.ok(others.every(row => withinSource(row, raster) && initial.every(previous => !distinct(row, previous) || Math.hypot(row.circle.x - previous.circle.x, row.circle.y - previous.circle.y) > Math.max(row.circle.radius, previous.circle.radius) * .48)));
  assert.ok(others.some(row => Math.hypot(row.circle.x - 48, row.circle.y - 68) < 5 && Math.abs(row.circle.radius - 30) < 5));
  assert.deepEqual(findOtherCircleCandidates(raster, raster, [initial[0]], 3), others);
});

test('blank evidence abstains without manufacturing proposals', () => {
  const blank = blankRaster();
  assert.deepEqual(findInitialCircleCandidates(blank, blank, 3), []);
  assert.deepEqual(findOtherCircleCandidates(blank, blank, [], 3), []);
  const anchor: CircleCandidate = { id: 'manual-anchor', circle: { x: 48, y: 48, radius: 24, confidence: 0 }, score: 0 };
  const refined = refineCircleCandidates(blank, anchor, 3);
  assert.equal(refined.length, 1);
  assert.strictEqual(refined[0], anchor);
  assert.deepEqual(refineCircleCandidates(blank, { id: 'invalid', circle: { x: Number.NaN, y: 48, radius: 24, confidence: 0 }, score: 0 }, 3), []);
});
