import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalEllipse, normalizeAxisAngle } from './ellipse-geometry.mjs';
import { adaptRimFitResult } from './fit-adapter.mjs';
import { sourceToUnitDisk } from './ellipse-crop.mjs';

const rgba = (width, height) => new Uint8ClampedArray(width * height * 4);

function returnedRimFitEllipse(workingEllipse, workingScaleX, workingScaleY) {
  // Mirrors the frozen RimFit v3 worker's current result conversion.
  return { localCrop: {
    centerPx: [workingEllipse.centerX / workingScaleX, workingEllipse.centerY / workingScaleY],
    radiiPx: [workingEllipse.radiusX / workingScaleX, workingEllipse.radiusY / workingScaleY],
    rotationRadians: workingEllipse.axisAngle,
  } };
}

test('malformed and missing angles fail before ellipse canonicalization', () => {
  assert.throws(() => normalizeAxisAngle(Number.NaN), /finite/);
  assert.throws(() => canonicalEllipse({ centerX: 10, centerY: 10, radiusX: 8, radiusY: 5 }), /finite/);
  const raster = { width: 64, height: 64, data: rgba(64, 64) };
  for (const rotationRadians of [undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = adaptRimFitResult({ status: 'accepted', ellipse: { localCrop: {
      centerPx: [32, 32], radiiPx: [18, 12], rotationRadians,
    } } }, raster);
    assert.equal(result.status, 'FAIL');
    assert.equal(result.ellipse, null);
  }
});

test('worker fit is reconstructed then covariance-mapped with its exact endpoint scales', () => {
  const cropWidth = 1200, cropHeight = 1400, workingWidth = 540, workingHeight = 720;
  const workingScaleX = (workingWidth - 1) / (cropWidth - 1), workingScaleY = (workingHeight - 1) / (cropHeight - 1);
  const fit = { centerX: 271.25, centerY: 355.75, radiusX: 201.5, radiusY: 145.25, axisAngle: .61 };
  const result = {
    status: 'accepted', input: { cropWidth, cropHeight, workingWidth, workingHeight, workingScaleX, workingScaleY },
    ellipse: returnedRimFitEllipse(fit, workingScaleX, workingScaleY),
  };
  const proposal = adaptRimFitResult(result, { width: cropWidth, height: cropHeight, data: rgba(cropWidth, cropHeight) });
  assert.equal(proposal.status, 'MAYBE');
  assert.equal(proposal.diagnostics.outerGuardOffsetUnit, 'source-pixels');
  assert.equal(proposal.diagnostics.sourceMapping.covarianceMapped, false);
  assert.deepEqual(proposal.diagnostics.refinement.workerInput, result.input);

  const residuals = [];
  for (let i = 0; i < 72; i++) {
    const t = 2 * Math.PI * i / 72, c = Math.cos(fit.axisAngle), s = Math.sin(fit.axisAngle);
    const workingPoint = {
      x: fit.centerX + c * fit.radiusX * Math.cos(t) - s * fit.radiusY * Math.sin(t),
      y: fit.centerY + s * fit.radiusX * Math.cos(t) + c * fit.radiusY * Math.sin(t),
    };
    const sourcePoint = { x: workingPoint.x / workingScaleX, y: workingPoint.y / workingScaleY };
    const normalized = sourceToUnitDisk(sourcePoint, proposal.ellipse);
    residuals.push(Math.abs(Math.hypot(normalized.x, normalized.y) - 1));
  }
  assert.ok(Math.max(...residuals) < 1e-10);
  assert.ok(Math.abs(proposal.ellipse.axisAngle - fit.axisAngle) > .02, 'anisotropic resize should rotate ellipse principal axes');
});

test('720-working fit maps to full source and measures the two-pixel rim guard in source pixels', () => {
  const workingWidth = 540, workingHeight = 720, sourceWidth = 1200, sourceHeight = 1400;
  const fit = { centerX: 271.25, centerY: 355.75, radiusX: 201.5, radiusY: 145.25, axisAngle: .61 };
  const result = {
    status: 'accepted',
    input: { cropWidth: workingWidth, cropHeight: workingHeight, workingWidth, workingHeight, workingScaleX: 1, workingScaleY: 1 },
    ellipse: returnedRimFitEllipse(fit, 1, 1),
  };
  const proposal = adaptRimFitResult(result, {
    width: workingWidth, height: workingHeight, data: rgba(workingWidth, workingHeight),
    source: { width: sourceWidth, height: sourceHeight, data: rgba(sourceWidth, sourceHeight) },
  });
  assert.equal(proposal.status, 'MAYBE');
  assert.equal(proposal.diagnostics.sourceMapping.covarianceMapped, true);
  assert.equal(proposal.diagnostics.outerGuardOffsetUnit, 'source-pixels');
  const sx = sourceWidth / workingWidth, sy = sourceHeight / workingHeight, residuals = [];
  for (let i = 0; i < 72; i++) {
    const t = 2 * Math.PI * i / 72, c = Math.cos(fit.axisAngle), s = Math.sin(fit.axisAngle);
    const p = {
      x: fit.centerX + c * fit.radiusX * Math.cos(t) - s * fit.radiusY * Math.sin(t),
      y: fit.centerY + s * fit.radiusX * Math.cos(t) + c * fit.radiusY * Math.sin(t),
    };
    const mapped = { x: (p.x + .5) * sx - .5, y: (p.y + .5) * sy - .5 };
    const normalized = sourceToUnitDisk(mapped, proposal.ellipse);
    residuals.push(Math.abs(Math.hypot(normalized.x, normalized.y) - 1));
  }
  assert.ok(Math.max(...residuals) < 1e-10);
});

test('worker metadata tied to another fit raster fails closed', () => {
  const result = { status: 'accepted', input: { cropWidth: 128, cropHeight: 64 }, ellipse: { localCrop: {
    centerPx: [32, 32], radiiPx: [18, 12], rotationRadians: .2,
  } } };
  const proposal = adaptRimFitResult(result, { width: 64, height: 64, data: rgba(64, 64) });
  assert.equal(proposal.status, 'FAIL');
  assert.equal(proposal.reason, 'worker-raster-provenance-mismatch');
});
