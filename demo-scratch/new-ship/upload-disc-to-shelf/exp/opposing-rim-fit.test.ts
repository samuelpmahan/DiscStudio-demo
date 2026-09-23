import test from 'node:test';
import assert from 'node:assert/strict';
import { fitOpposingRim } from './opposing-rim-fit.ts';
import type { Raster, CircleCandidate } from '../circle-candidates.ts';

function rimmedDisc(width: number, height: number, x0: number, y0: number, outer: number, inner: number): Raster {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const distance = Math.hypot(x - x0, y - y0);
    const fold = Math.abs(y - x * .6 - 12) < 2;
    const pixel = distance < inner ? [224, 205, 61, 255]
      : distance < outer ? [38, 38, 47, 255]
      : fold ? [36, 31, 41, 255] : [175, 137, 116, 255];
    rgba.set(pixel, (y * width + x) * 4);
  }
  return { width, height, rgba };
}

test('opposing edges recover the center and supported outer rim despite an inner ring and background fold', () => {
  const truth = { x: 124, y: 112, inner: 57, outer: 66 }, source = rimmedDisc(260, 230, truth.x, truth.y, truth.outer, truth.inner);
  const anchor: CircleCandidate = { id: 'same-disc', circle: { x: 119, y: 116, radius: 57, confidence: .15 }, score: .15 };
  const before = new Uint8ClampedArray(source.rgba), inputCircle = { ...anchor.circle };
  const result = fitOpposingRim(source, anchor);
  assert.equal(result.status, 'accepted');
  assert.ok(result.selected && result.candidate);
  assert.ok(Math.hypot(result.candidate.circle.x - truth.x, result.candidate.circle.y - truth.y) < 5);
  assert.ok(Math.abs(result.candidate.circle.radius - truth.outer) < 5, 'the outer ring must win over the stronger inner edge');
  assert.ok(result.selected.opposingPairs >= 20 && result.selected.sectors.every(count => count >= 3));
  assert.deepEqual(fitOpposingRim(source, anchor), result);
  assert.deepEqual(anchor.circle, inputCircle);
  assert.deepEqual(source.rgba, before);
});

test('a partial arc cannot masquerade as a complete disc', () => {
  const width = 180, height = 160, rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const angle = Math.atan2(y - 80, x - 90), radius = Math.hypot(x - 90, y - 80);
    rgba.set(radius < 50 && Math.abs(angle) < .6 ? [245, 230, 80, 255] : [35, 42, 54, 255], (y * width + x) * 4);
  }
  const anchor: CircleCandidate = { id: 'same-disc', circle: { x: 90, y: 80, radius: 50, confidence: .1 }, score: .1 };
  const result = fitOpposingRim({ width, height, rgba }, anchor);
  assert.equal(result.status, 'abstained');
  assert.equal(result.reason, 'no-closed-opposing-rim');
});

test('missing image evidence abstains rather than inventing a rim', () => {
  const source: Raster = { width: 160, height: 160, rgba: new Uint8ClampedArray(160 * 160 * 4) };
  const anchor: CircleCandidate = { id: 'same-disc', circle: { x: 80, y: 80, radius: 48, confidence: 0 }, score: 0 };
  assert.equal(fitOpposingRim(source, anchor).status, 'abstained');
});
