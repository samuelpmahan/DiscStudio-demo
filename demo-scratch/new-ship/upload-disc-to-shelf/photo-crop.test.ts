import test from 'node:test';
import assert from 'node:assert/strict';
import { clampCropSelection, cropExportMapping, cropForDetectedCircle, cropZoomNudges, detectDiscCircle, resizeCrop, sourceImagePlacement } from './upload-ui.ts';

test('correction strip exposes the exact discrete nudges', () => {
  assert.deepEqual(cropZoomNudges, [-10, -5, -3, -1, 1, 3, 5, 10]);
  assert.equal(resizeCrop(1000, 800, { centerX: .5, centerY: .5, radiusX: .25, radiusY: .2 }, -10).radiusX, .2);
  assert.equal(resizeCrop(1000, 800, { centerX: .5, centerY: .5, radiusX: .25, radiusY: .2 }, 10).radiusY, .25);
  assert.throws(() => resizeCrop(1000, 800, { centerX: .5, centerY: .5, radiusX: .25, radiusY: .2 }, 2), /Unsupported crop selection nudge/);
});

test('source placement contains portrait and landscape photos without a fixed square crop assumption', () => {
  assert.deepEqual(sourceImagePlacement(600, 1200, 600), { x: 150, y: 0, width: 300, height: 600, scale: .5 });
  assert.deepEqual(sourceImagePlacement(1200, 600, 600), { x: 0, y: 150, width: 600, height: 300, scale: .5 });
  assert.deepEqual(sourceImagePlacement(600, 600, 600), { x: 0, y: 0, width: 600, height: 600, scale: 1 });
});

test('selection moves freely in two dimensions and remains bounded to the source', () => {
  const moved = clampCropSelection(1200, 800, { centerX: .1, centerY: .9, radiusX: .2, radiusY: .15 });
  assert.deepEqual(moved, { centerX: .2, centerY: .85, radiusX: .2, radiusY: .15, rotation: 0 });
  const bounded = clampCropSelection(1200, 800, { centerX: .99, centerY: .01, radiusX: .2, radiusY: .2 });
  assert.deepEqual(bounded, { centerX: .8, centerY: .2, radiusX: .2, radiusY: .2, rotation: 0 });
});

test('edge resizing supports smaller and larger apertures, bounded by the image', () => {
  const initial = { centerX: .5, centerY: .5, radiusX: .25, radiusY: .2 };
  assert.equal(resizeCrop(1000, 800, initial, -10).radiusX, .2);
  assert.equal(resizeCrop(1000, 800, initial, 10).radiusY, .25);
  assert.deepEqual(resizeCrop(1000, 800, { centerX: .5, centerY: .5, radiusX: .49, radiusY: .49 }, 10), { centerX: .5, centerY: .5, radiusX: .5, radiusY: .5, rotation: 0 });
});

test('export mapping preserves the selected ellipse in source pixels', () => {
  assert.deepEqual(cropExportMapping(1200, 600, 600, { centerX: .5, centerY: .5, radiusX: .25, radiusY: .4 }), {
    sourceX: 300, sourceY: 60, sourceWidth: 600, sourceHeight: 480, sourceCenterX: 600, sourceCenterY: 300, sourceRadiusX: 300, sourceRadiusY: 240, outputSize: 600, rotation: 0,
    selection: { centerX: .5, centerY: .5, radiusX: .25, radiusY: .4, rotation: 0 },
  });
});

test('rotated apertures remain fully within the source', () => {
  const rotated = clampCropSelection(1200, 800, { centerX: .03, centerY: .97, radiusX: .35, radiusY: .1, rotation: Math.PI / 4 });
  assert.ok(rotated.centerX > .2 && rotated.centerY < .8);
  assert.equal(rotated.rotation, Math.PI / 4);
});

test('automatic crop maps a detected physical disc to a source-space ellipse', () => {
  const width = 96, height = 96, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = Math.hypot(x - 54, y - 44) <= 32, i = (y * width + x) * 4;
    data[i] = inside ? 175 : 25; data[i + 1] = inside ? 235 : 35; data[i + 2] = inside ? 55 : 30; data[i + 3] = 255;
  }
  const circle = detectDiscCircle(data, width, height);
  assert.ok(circle);
  const crop = cropForDetectedCircle(width, height, circle);
  assert.ok(Math.abs(crop.centerX - circle.x / width) < .01);
  assert.ok(Math.abs(crop.centerY - circle.y / height) < .01);
  assert.equal(crop.radiusX, crop.radiusY);
});

test('invalid source dimensions refuse preparation', () => {
  assert.throws(() => sourceImagePlacement(0, 600, 600), /positive/);
  assert.throws(() => cropExportMapping(600, 600, 0, { centerX: .5, centerY: .5, radiusX: .4, radiusY: .4 }), /positive/);
});
