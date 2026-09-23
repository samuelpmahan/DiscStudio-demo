import test from 'node:test';
import assert from 'node:assert/strict';
import { fitOpposingRim } from './opposing-rim-fit.ts';
import { fitEllipseRim } from './ellipse-rim-fit.ts';
import type { Raster, CircleCandidate } from '../circle-candidates.ts';

function sourceDisc(major: number, minor: number): Raster {
  const width = 310, height = 280, centerX = 150, centerY = 135, rotation = .38;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = x - centerX, dy = y - centerY;
    const forward = dx * Math.cos(rotation) + dy * Math.sin(rotation);
    const cross = dy * Math.cos(rotation) - dx * Math.sin(rotation);
    const radial = Math.hypot(forward / major, cross / minor);
    const fold = Math.abs(y - x * .57 - 15) < 2;
    const colour = radial < .86 ? [118, 113, 102, 255] : radial < 1 ? [80, 76, 70, 255] : fold ? [36, 32, 47, 255] : [199, 185, 162, 255];
    rgba.set(colour, (y * width + x) * 4);
  }
  return { width, height, rgba };
}

const anchor: CircleCandidate = { id: 'physical-disc', circle: { x: 148, y: 137, radius: 72, confidence: .2 }, score: .2 };

test('supported tilted rim is repaired to an ellipse of the same physical disc', () => {
  const source = sourceDisc(75, 68), original = new Uint8ClampedArray(source.rgba), circle = fitOpposingRim(source, anchor);
  assert.ok((circle.selected || circle.seed) && circle.rimSpokes, `rim evidence must retain a bounded seed: ${circle.reason}`);
  const result = fitEllipseRim(source, anchor, circle);
  assert.equal(result.status, 'accepted', JSON.stringify({ reason: result.reason, circle: circle.selected, ellipse: { coverage: result.coverage, circleResidual: result.circleMedianResidual, ellipseResidual: result.ellipseMedianResidual } }));
  assert.ok(result.ellipse && result.candidate?.ellipse);
  assert.ok(Math.hypot(result.ellipse.x - 150, result.ellipse.y - 135) < 5);
  assert.ok(Math.abs(result.ellipse.radiusX - 75) < 7);
  assert.ok(Math.abs(result.ellipse.radiusY - 68) < 7);
  assert.ok(result.coverage! >= .82 && result.opposingPairs! >= 22);
  assert.deepEqual(fitEllipseRim(source, anchor, circle), result);
  assert.deepEqual(source.rgba, original);
});

test('near-circular rim abstains instead of distorting the image', () => {
  const source = sourceDisc(72, 71), circle = fitOpposingRim(source, anchor);
  assert.ok((circle.selected || circle.seed) && circle.rimSpokes);
  const result = fitEllipseRim(source, anchor, circle);
  assert.equal(result.status, 'abstained');
  assert.equal(result.reason, 'circle-sufficient');
  assert.equal(result.candidate, null);
});

test('no supported rim yields no invented ellipse', () => {
  const source: Raster = { width: 310, height: 280, rgba: new Uint8ClampedArray(310 * 280 * 4) };
  const circle = fitOpposingRim(source, anchor);
  const result = fitEllipseRim(source, anchor, circle);
  assert.equal(result.status, 'abstained');
  assert.equal(result.reason, 'missing-rim-points');
});
