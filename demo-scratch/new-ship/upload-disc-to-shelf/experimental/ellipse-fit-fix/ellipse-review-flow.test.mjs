import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { adaptRimFitResult } from './fit-adapter.mjs';
import { runEllipseFitReview } from './ellipse-review-flow.mjs';
import { prepareEllipsePhoto } from '../../photo-refit.ts';

const servoPath = new URL('../../sample-discs/servo.jpg', import.meta.url);
const servoSha256 = '1d6c7ad370b2fe8896a0bf10d0b31f83df6c3c03d2540ccc8350b67ec075ec27';
const pinnedServoSeed = Object.freeze({
  centerX: 576.9182002194116,
  centerY: 770.4934694714741,
  radiusX: 518.8301356551036,
  radiusY: 498.4919706390199,
  axisAngle: 0.08429337683492744,
});

function acceptedWorkerResult(width, height, ellipse) {
  return {
    status: 'accepted',
    input: { cropWidth: width, cropHeight: height, workingWidth: width, workingHeight: height, workingScaleX: 1, workingScaleY: 1 },
    ellipse: { localCrop: {
      centerPx: [ellipse.centerX, ellipse.centerY],
      radiiPx: [ellipse.radiusX, ellipse.radiusY],
      rotationRadians: ellipse.axisAngle,
    } },
  };
}

async function decodedRaster(bytes) {
  const image = await loadImage(bytes);
  const canvas = createCanvas(image.width, image.height), context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return { image, canvas, raster: { width: image.width, height: image.height, data: context.getImageData(0, 0, image.width, image.height).data } };
}

test('pinned Servo goes through full-source adapter and teal MAYBE path; stamp rotation stays separate', async () => {
  const bytes = fs.readFileSync(servoPath);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), servoSha256, 'fixture bytes match the pinned Servo photo');
  const { image, raster } = await decodedRaster(bytes);
  const result = acceptedWorkerResult(image.width, image.height, pinnedServoSeed);
  const worker = {
    async recover(input, options) {
      assert.equal(input.data, raster.data, 'worker receives the same full-source RGBA array');
      assert.deepEqual(options, { maxRefinementDimension: 384 });
      return result;
    },
  };

  const review = await runEllipseFitReview({ worker, image: raster });
  assert.equal(review.status, 'READY');
  const proposal = review.proposal;
  assert.equal(proposal.status, 'MAYBE', 'the visual refinement is still a creator-review proposal');
  assert.equal(proposal.refinement.status, 'MAYBE');
  assert.equal(proposal.refinement.reason, 'paired-rim-evidence-refined-review-only');
  assert.ok(proposal.refinement.trace.geometryConsensus.geometryInlierSamples >= 50);
  assert.equal(proposal.refinement.trace.perRayEvidence.length, 64);
  assert.equal(proposal.refinement.trace.perRayEvidence[34].geometryIncluded, false, 'the pinned isolated Servo ray is omitted from fit dots');
  const dots = proposal.refinement.trace.perRayEvidence.filter(ray => ray.geometryIncluded === true);
  assert.equal(dots.length, proposal.refinement.trace.geometryConsensus.geometryInlierSamples);
  assert.ok(dots.every(ray => Number.isFinite(ray.outerBoundaryPointSourcePx?.x) && Number.isFinite(ray.outerBoundaryPointSourcePx?.y)));
  assert.ok(proposal.ellipse.centerY > proposal.refinement.originalEllipse.centerY + 10, 'the refined contour follows the pinned outer pale rim');

  const stampRotation = 0.7;
  const prepared = prepareEllipsePhoto(image, image.width, image.height,
    { ...proposal.ellipse, rotation: stampRotation }, 'Servo', () => createCanvas(1, 1));
  assert.equal(prepared.refit.rotation, stampRotation);
  assert.equal(prepared.refit.axisAngle, proposal.ellipse.axisAngle);
});

test('refinement ABSTAIN keeps the original MAYBE ellipse unchanged with no refined trace claim', async () => {
  const width = 160, height = 160, raster = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  const seed = { centerX: 80, centerY: 80, radiusX: 56, radiusY: 44, axisAngle: 0.2 };
  const result = acceptedWorkerResult(width, height, seed);
  const base = adaptRimFitResult(result, { ...raster, maxRefinementDimension: 384 });
  assert.equal(base.status, 'MAYBE');

  const review = await runEllipseFitReview({ worker: { recover: async () => result }, image: raster });
  assert.equal(review.status, 'READY');
  assert.equal(review.proposal.status, 'MAYBE');
  assert.equal(review.proposal.refinement.status, 'ABSTAIN');
  assert.deepEqual(review.proposal.ellipse, base.ellipse, 'ABSTAIN retains the exact adapter proposal');
});

test('a superseded worker response is discarded before adapter or refinement can run', async () => {
  let resolveWorker, current = true;
  const worker = { recover: () => new Promise(resolve => { resolveWorker = resolve; }) };
  const pending = runEllipseFitReview({
    worker,
    image: { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) },
    isCurrent: () => current,
  });
  current = false;
  resolveWorker({ status: 'abstained' });
  assert.deepEqual(await pending, { status: 'STALE' });
});
