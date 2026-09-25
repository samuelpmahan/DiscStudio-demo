import test from 'node:test';
import assert from 'node:assert/strict';
import { clampCircleCropSelection, clampCropSelection, circleCropExportMapping, cropExportMapping, cropForDetectedCircle, cropZoomNudges, detectDiscCircle, fixedCirclePreviewGeometry, panCircleCrop, resizeCircleAtFixedCenter, resizeCircleCrop, resizeCircleCropByScreenDelta, resizeCrop, sourceImagePlacement } from './upload-ui.ts';
import { mapWorkingCircleToSource, refineDiscCircle } from './circle-fit.ts';
import { createCanvas } from '@napi-rs/canvas';
import { drawOrientedCrop, drawRotatedCrop, edgeSafeCrop } from './crop-geometry.ts';

test('orientation turns the finished cutout without changing ellipse repair or its transparent edge', () => {
  const source = createCanvas(120, 120), src = source.getContext('2d');
  for (const [x, y, color] of [[0, 0, '#dc280d'], [60, 0, '#2843e8'], [0, 60, '#f3c61d'], [60, 60, '#20b459']] as const) {
    src.fillStyle = color; src.fillRect(x, y, 60, 60);
  }
  const mapping = { outputSize: 100, sourceCenterX: 60, sourceCenterY: 60, sourceRadiusX: 50, sourceRadiusY: 40, rotation: .23 };
  const draw = (angle: number) => {
    const canvas = createCanvas(100, 100), ctx = canvas.getContext('2d');
    ctx.save(); ctx.beginPath(); ctx.arc(50, 50, 50, 0, Math.PI * 2); ctx.clip();
    drawOrientedCrop(ctx as unknown as CanvasRenderingContext2D, source as unknown as CanvasImageSource, mapping, angle);
    ctx.restore(); return ctx;
  };
  const zero = draw(0), quarterTurn = draw(90);
  const rgba = (ctx: ReturnType<typeof draw>, x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
  assert.deepEqual(rgba(quarterTurn, 75, 25), rgba(zero, 25, 25), 'top-left stamp moves to top-right after +90°');
  assert.deepEqual(rgba(quarterTurn, 75, 75), rgba(zero, 75, 25), 'all quadrants rotate after ellipse correction');
  assert.equal(rgba(quarterTurn, 0, 0)[3], 0, 'the output stays a transparent circle');
  assert.throws(() => drawOrientedCrop(zero as unknown as CanvasRenderingContext2D, source as unknown as CanvasImageSource, mapping, Infinity), /Disc rotation/);
});

test('a fitted tilted rim with a background fringe materializes without visible background', () => {
  const source = createCanvas(240, 240), sourceContext = source.getContext('2d');
  sourceContext.fillStyle = '#00ff00'; sourceContext.fillRect(0, 0, 240, 240);
  sourceContext.fillStyle = '#e20000'; sourceContext.beginPath();
  sourceContext.ellipse(120, 120, 100 * .975, 90 * .975, .3, 0, Math.PI * 2); sourceContext.fill();
  const output = createCanvas(128, 128), ctx = output.getContext('2d');
  ctx.save(); ctx.beginPath(); ctx.arc(64, 64, 64, 0, Math.PI * 2); ctx.clip();
  drawRotatedCrop(ctx as unknown as CanvasRenderingContext2D, source as unknown as CanvasImageSource,
    edgeSafeCrop({ outputSize: 128, sourceCenterX: 120, sourceCenterY: 120, sourceRadiusX: 100, sourceRadiusY: 90, rotation: .3 }, true));
  ctx.restore();
  const rgba = ctx.getImageData(0, 0, 128, 128).data;
  // Very low-alpha pixels are unpremultiplied by canvas and can report a bright
  // RGB value even though their visible contribution is below one color step.
  for (let i = 0; i < rgba.length; i += 4) assert.ok(rgba[i + 1] * rgba[i + 3] / 255 < 10, `visible background leaked at pixel ${i / 4}`);
  assert.equal(rgba[(64 * 128 + 64) * 4], 226);
});

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
  assert.ok(Math.abs(crop.centerX - (circle.x + .5) / width) < .01);
  assert.ok(Math.abs(crop.centerY - (circle.y + .5) / height) < .01);
  assert.equal(crop.radiusX * width, crop.radiusY * height);
});

test('invalid source dimensions refuse preparation', () => {
  assert.throws(() => sourceImagePlacement(0, 600, 600), /positive/);
  assert.throws(() => cropExportMapping(600, 600, 0, { centerX: .5, centerY: .5, radiusX: .4, radiusY: .4 }), /positive/);
});

function solidCircle(width: number, height: number, cx: number, cy: number, radius: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = Math.hypot(x - cx, y - cy) <= radius, index = (y * width + x) * 4;
    data[index] = inside ? 230 : 30; data[index + 1] = inside ? 130 : 45; data[index + 2] = inside ? 55 : 35; data[index + 3] = 255;
  }
  return data;
}

test('CircleFit keeps one source-pixel radius on a non-square photo', () => {
  const working = { width: 240, height: 140, circle: { x: 132, y: 72, radius: 42, confidence: 100 } };
  const source = { width: 1200, height: 700, cx: 662, cy: 362, radius: 210 };
  const mapped = mapWorkingCircleToSource(working.circle, working.width, working.height, source.width, source.height);
  const refined = refineDiscCircle(solidCircle(source.width, source.height, source.cx, source.cy, source.radius), source.width, source.height, mapped);
  const crop = cropForDetectedCircle(source.width, source.height, refined);
  assert.ok(Math.abs(refined.x - source.cx) <= 1);
  assert.ok(Math.abs(refined.y - source.cy) <= 1);
  assert.ok(Math.abs(refined.radius - source.radius) <= 1);
  assert.equal(crop.radiusX * source.width, crop.radiusY * source.height);
  assert.equal(crop.rotation, 0);
});

test('CircleFit retains the recovered 96×112 full-rim fixture exactly', () => {
  const width = 96, height = 112, cx = 55, cy = 51, radius = 31, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = Math.hypot(x - cx, y - cy) <= radius, index = (y * width + x) * 4;
    [data[index], data[index + 1], data[index + 2]] = inside ? [224, 110, 52] : [44, 75, 44]; data[index + 3] = 255;
  }
  const coarse = detectDiscCircle(data, width, height);
  assert.ok(coarse);
  const crop = cropForDetectedCircle(width, height, refineDiscCircle(data, width, height, coarse));
  const mapping = circleCropExportMapping(width, height, 256, crop);
  assert.equal(mapping.sourceRadiusX, mapping.sourceRadiusY);
  let lostForeground = 0, includedBackground = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const foreground = Math.hypot(x - cx, y - cy) <= radius;
    const included = ((x + .5 - mapping.sourceCenterX) / mapping.sourceRadiusX) ** 2 + ((y + .5 - mapping.sourceCenterY) / mapping.sourceRadiusY) ** 2 <= 1;
    if (foreground && !included) lostForeground++;
    if (!foreground && included) includedBackground++;
  }
  assert.equal(lostForeground, 0);
  assert.equal(includedBackground, 0);
});

test('active circle crop keeps one radius through clamp, nudge, and export', () => {
  const initial = clampCircleCropSelection(1200, 600, { centerX: .4, centerY: .6, radiusX: .2, radiusY: .4, rotation: .4 });
  const nudged = resizeCircleCrop(1200, 600, initial, -5), mapping = circleCropExportMapping(1200, 600, 512, nudged);
  assert.equal(initial.rotation, 0);
  assert.equal(initial.radiusX * 1200, initial.radiusY * 600);
  assert.equal(nudged.radiusX * 1200, nudged.radiusY * 600);
  assert.equal(mapping.sourceRadiusX, mapping.sourceRadiusY);
  assert.equal(mapping.rotation, 0);
});


test('handle resize uses captured movement with no grab-offset jump', () => {
  const initial = clampCircleCropSelection(1200, 600, { centerX: .5, centerY: .5, radiusX: .2, radiusY: .4, rotation: 0 });
  assert.deepEqual(resizeCircleCropByScreenDelta(1200, 600, initial, 0, .5), initial, 'stationary handle press changes nothing');
  const moved = resizeCircleCropByScreenDelta(1200, 600, initial, 1, .5);
  assert.equal(moved.radiusX * 1200 - initial.radiusX * 1200, 2, 'one screen pixel moves only its source-space equivalent');
  assert.equal(moved.centerX, initial.centerX);
  assert.equal(moved.centerY, initial.centerY);
});

test('fixed aperture keeps its screen center while photo panning reverses source center', () => {
  const initial = clampCircleCropSelection(1200, 600, { centerX: .5, centerY: .5, radiusX: .2, radiusY: .4, rotation: 0 });
  const panned = panCircleCrop(1200, 600, initial, 36, -18);
  const before = fixedCirclePreviewGeometry(1200, 600, initial, 320), after = fixedCirclePreviewGeometry(1200, 600, panned, 320);
  assert.equal(panned.centerX, initial.centerX - 36 / 1200);
  assert.equal(panned.centerY, initial.centerY + 18 / 600);
  assert.equal(after.centerX, before.centerX);
  assert.equal(after.centerY, before.centerY);
  assert.equal(after.radius, before.radius);
  assert.ok(after.imageX > before.imageX, 'dragging the photo right translates its pixels right under the fixed aperture');
  assert.ok(after.imageY < before.imageY, 'dragging the photo up translates its pixels up under the fixed aperture');
});


test('manual resize caps at a fixed center instead of translating the photo', () => {
  const nearEdge = clampCircleCropSelection(1200, 600, { centerX: .2, centerY: .5, radiusX: .1, radiusY: .2, rotation: 0 });
  const grown = resizeCircleAtFixedCenter(1200, 600, nearEdge, 500);
  assert.equal(grown.centerX, nearEdge.centerX);
  assert.equal(grown.centerY, nearEdge.centerY);
  assert.equal(grown.radiusX * 1200, 240, 'left edge caps the radius at the retained center');
  assert.equal(grown.radiusY * 600, 240);
});
