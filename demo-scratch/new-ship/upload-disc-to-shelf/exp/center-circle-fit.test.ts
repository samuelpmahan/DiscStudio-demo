import test from 'node:test';
import assert from 'node:assert/strict';
import { fitCircleCenter } from './center-circle-fit.ts';
import type { Raster, CircleCandidate } from '../circle-candidates.ts';

function discRaster(width: number, height: number, disc: { x: number; y: number; radius: number }): Raster {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = Math.hypot(x - disc.x, y - disc.y) < disc.radius;
    rgba.set(inside ? [214, 80, 28, 255] : [31, 40, 49, 255], (y * width + x) * 4);
  }
  return { width, height, rgba };
}

test('separate center fit improves a displaced circle without mutating its input', () => {
  const truth = { x: 92, y: 83, radius: 55 }, source = discRaster(200, 180, truth);
  const anchor: CircleCandidate = { id: 'same-disc', circle: { x: 89, y: 81, radius: 55, confidence: .1 }, score: .1 };
  const originalPixels = new Uint8ClampedArray(source.rgba), originalCircle = { ...anchor.circle };
  const fit = fitCircleCenter(source, anchor);
  assert.equal(fit.status, 'accepted');
  assert.ok(fit.candidate);
  assert.ok(Math.hypot(fit.candidate.circle.x - truth.x, fit.candidate.circle.y - truth.y) < Math.hypot(anchor.circle.x - truth.x, anchor.circle.y - truth.y));
  assert.ok(Math.abs(fit.candidate.circle.radius - truth.radius) < 4);
  assert.ok(fit.proposedSupport > fit.originalSupport);
  assert.deepEqual(fitCircleCenter(source, anchor), fit);
  assert.deepEqual(anchor.circle, originalCircle);
  assert.deepEqual(source.rgba, originalPixels);
});

test('unsupported or already centered input keeps the original choice', () => {
  const empty: Raster = { width: 160, height: 160, rgba: new Uint8ClampedArray(160 * 160 * 4) };
  const anchor: CircleCandidate = { id: 'same-disc', circle: { x: 79.5, y: 79.5, radius: 50, confidence: 0 }, score: 0 };
  assert.equal(fitCircleCenter(empty, anchor).status, 'abstained');
  const exact = fitCircleCenter(discRaster(160, 160, { x: 80, y: 80, radius: 50 }), anchor);
  assert.equal(exact.status, 'abstained');
  assert.equal(exact.candidate, null);
});
