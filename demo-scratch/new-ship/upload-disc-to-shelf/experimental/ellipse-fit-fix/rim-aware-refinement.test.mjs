import test from 'node:test';
import assert from 'node:assert/strict';
import { refineEllipseWithRimEvidence } from './rim-aware-refinement.mjs';
import {
  CLEAN_RIM,
  DIRTY_AMBIGUOUS_RIM,
  LOCAL_FOLD_RIM,
  MULTI_RAY_FOLD_RIM,
  WEAK_OUTER_CONTRAST_RIM,
  ellipseParameterError,
  innerFaceProposal,
  renderCoherentPairedRim,
  renderDirtyAmbiguousBackground,
  renderRimWithLocalFabricFold,
  renderRimWithMultiRayFabricFold,
  renderWeakOuterContrastDirtyRim,
} from '../../../../../../lanes/rim-aware-tests/synthetic-rims.mjs';

function sameGeometry(actual, expected) {
  assert.deepEqual(actual, expected);
}

function sampleBoundary(ellipse, count = 512) {
  const c = Math.cos(ellipse.axisAngle), s = Math.sin(ellipse.axisAngle);
  return Array.from({ length: count }, (_, i) => {
    const t = 2 * Math.PI * i / count;
    return {
      x: ellipse.centerX + c * ellipse.radiusX * Math.cos(t) - s * ellipse.radiusY * Math.sin(t),
      y: ellipse.centerY + s * ellipse.radiusX * Math.cos(t) + c * ellipse.radiusY * Math.sin(t),
    };
  });
}

function symmetricBoundaryDistancePx(a, b) {
  const first = sampleBoundary(a), second = sampleBoundary(b);
  const directed = (from, to) => Math.max(...from.map(point => Math.min(...to.map(other => Math.hypot(point.x - other.x, point.y - other.y)))));
  return Math.max(directed(first, second), directed(second, first));
}

test('default-off refinement returns the exact proposal and leaves the source raster unchanged', () => {
  const raster = renderCoherentPairedRim(CLEAN_RIM);
  const proposal = innerFaceProposal(CLEAN_RIM.ellipse, CLEAN_RIM.faceFraction);
  Object.freeze(proposal.ellipse);
  Object.freeze(proposal);
  const pixelsBefore = new Uint8ClampedArray(raster.data);

  const defaultResult = refineEllipseWithRimEvidence(raster, proposal);
  const explicitlyDisabled = refineEllipseWithRimEvidence(raster, proposal, { enabled: false });

  assert.equal(defaultResult.status, 'ABSTAIN');
  assert.equal(explicitlyDisabled.status, 'ABSTAIN');
  sameGeometry(defaultResult.ellipse, proposal.ellipse);
  sameGeometry(explicitlyDisabled.ellipse, proposal.ellipse);
  sameGeometry(defaultResult.originalEllipse, proposal.ellipse);
  assert.deepEqual(raster.data, pixelsBefore, 'disabled refinement must not edit source pixels');
});

test('opt-in refinement follows the coherent paired dirty-white rim to its outer ellipse', () => {
  const raster = renderCoherentPairedRim(CLEAN_RIM);
  const proposal = innerFaceProposal(CLEAN_RIM.ellipse, CLEAN_RIM.faceFraction);
  const beforeError = ellipseParameterError(proposal.ellipse, CLEAN_RIM.ellipse);

  const result = refineEllipseWithRimEvidence(raster, proposal, { enabled: true });

  assert.equal(result.schema, 'RimAwareEllipseRefinement@1');
  assert.equal(result.status, 'MAYBE');
  assert.ok(result.ellipse, 'accepted refinement must return a candidate geometry');
  const afterError = ellipseParameterError(result.ellipse, CLEAN_RIM.ellipse);
  assert.ok(afterError < beforeError * 0.45, `outer ellipse error should shrink materially (${beforeError} -> ${afterError})`);
  assert.ok(afterError < 3.2, `candidate should land on the painted outer rim in source pixels (error ${afterError})`);
  assert.ok(result.ellipse.radiusX > proposal.ellipse.radiusX + 3, 'outer-rim fit should expand beyond the face-edge seed');
  assert.ok(result.ellipse.radiusY > proposal.ellipse.radiusY + 3, 'outer-rim fit should expand beyond the face-edge seed');
  assert.ok(Math.abs(result.ellipse.centerX - CLEAN_RIM.ellipse.centerX) < 2.5);
  assert.ok(Math.abs(result.ellipse.centerY - CLEAN_RIM.ellipse.centerY) < 2.5);
});

test('a strong face edge with diffuse same-colored gray cloth abstains', () => {
  const raster = renderDirtyAmbiguousBackground(DIRTY_AMBIGUOUS_RIM);
  const proposal = innerFaceProposal(DIRTY_AMBIGUOUS_RIM.ellipse, DIRTY_AMBIGUOUS_RIM.faceFraction);
  const original = structuredClone(proposal.ellipse);

  const result = refineEllipseWithRimEvidence(raster, proposal, { enabled: true });

  assert.equal(result.schema, 'RimAwareEllipseRefinement@1');
  assert.equal(result.status, 'ABSTAIN', 'one clear inner edge must not be mistaken for a coherent outer rim');
  sameGeometry(result.ellipse, original);
});

test('the earlier ragged pale rim with weak outer contrast still abstains', () => {
  const raster = renderWeakOuterContrastDirtyRim(WEAK_OUTER_CONTRAST_RIM);
  const proposal = innerFaceProposal(WEAK_OUTER_CONTRAST_RIM.ellipse, WEAK_OUTER_CONTRAST_RIM.faceFraction);
  const original = structuredClone(proposal.ellipse);

  const result = refineEllipseWithRimEvidence(raster, proposal, { enabled: true });

  assert.equal(result.status, 'ABSTAIN', 'a coherent face edge must not compensate for weak, diffuse outer support');
  sameGeometry(result.ellipse, original);
});

test('a sharp local fabric fold cannot pull the ellipse off the known outer rim', () => {
  const raster = renderRimWithLocalFabricFold(LOCAL_FOLD_RIM);
  const proposal = innerFaceProposal(LOCAL_FOLD_RIM.ellipse, LOCAL_FOLD_RIM.faceFraction);
  const result = refineEllipseWithRimEvidence(raster, proposal, { enabled: true });

  assert.ok(result.status === 'MAYBE' || result.status === 'ABSTAIN');
  if (result.status === 'MAYBE') {
    assert.ok(symmetricBoundaryDistancePx(result.ellipse, LOCAL_FOLD_RIM.ellipse) < 4,
      'accepted output must remain within four source pixels of the known outer contour');
  } else {
    sameGeometry(result.ellipse, proposal.ellipse);
  }

  const rays = result.trace?.perRayEvidence;
  assert.ok(Array.isArray(rays) && rays.length === 64, 'the diagnostic must expose all sampled rays');
  const foldIndex = Math.round(LOCAL_FOLD_RIM.foldThetaRadians / (2 * Math.PI) * rays.length) % rays.length;
  const foldRay = rays[foldIndex];
  const neighbors = [rays[(foldIndex - 2 + rays.length) % rays.length], rays[(foldIndex + 2) % rays.length]];
  assert.equal(foldRay.sample, foldIndex);
  assert.ok(neighbors.every(ray => Number.isFinite(ray.outerOffsetPx) && Number.isFinite(ray.bandWidthPx)));
  const neighborOffset = neighbors.reduce((sum, ray) => sum + ray.outerOffsetPx, 0) / neighbors.length;
  const neighborWidth = neighbors.reduce((sum, ray) => sum + ray.bandWidthPx, 0) / neighbors.length;
  assert.ok(!foldRay.supported || Math.abs(foldRay.outerOffsetPx - neighborOffset) >= 3 ||
    Math.abs(foldRay.bandWidthPx - neighborWidth) >= 3,
  'per-ray trace must expose a local support discontinuity or offset/width outlier at the fold');
});

test('a plausible paired fold arc must abstain or stay near the known physical rim', () => {
  const raster = renderRimWithMultiRayFabricFold(MULTI_RAY_FOLD_RIM);
  const proposal = innerFaceProposal(MULTI_RAY_FOLD_RIM.ellipse, MULTI_RAY_FOLD_RIM.faceFraction);
  const result = refineEllipseWithRimEvidence(raster, proposal, { enabled: true });

  const rays = result.trace?.perRayEvidence;
  if (result.status === 'ABSTAIN') {
    sameGeometry(result.ellipse, proposal.ellipse);
    if (rays) assert.equal(rays.length, 64);
    return;
  }
  assert.equal(result.status, 'MAYBE');
  assert.ok(Array.isArray(rays) && rays.length === 64, 'accepted result must expose all per-ray diagnostics');

  const signedAngleDelta = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
  const foldRays = rays.filter(ray => Math.abs(signedAngleDelta(ray.thetaRadians - MULTI_RAY_FOLD_RIM.foldThetaRadians)) <= MULTI_RAY_FOLD_RIM.foldHalfWidthRadians);
  const clearRays = rays.filter(ray => Math.abs(signedAngleDelta(ray.thetaRadians - MULTI_RAY_FOLD_RIM.foldThetaRadians)) > MULTI_RAY_FOLD_RIM.foldHalfWidthRadians + 0.16);
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const foldOffset = median(foldRays.filter(ray => Number.isFinite(ray.outerOffsetPx)).map(ray => ray.outerOffsetPx));
  const clearOffset = median(clearRays.filter(ray => Number.isFinite(ray.outerOffsetPx)).map(ray => ray.outerOffsetPx));
  const foldWidth = median(foldRays.filter(ray => Number.isFinite(ray.bandWidthPx)).map(ray => ray.bandWidthPx));
  const clearWidth = median(clearRays.filter(ray => Number.isFinite(ray.bandWidthPx)).map(ray => ray.bandWidthPx));
  assert.ok(foldRays.filter(ray => ray.supported).length >= 8, 'the fold must supply a multi-ray false pair');
  assert.ok(foldOffset > clearOffset + 6 && foldWidth > clearWidth + 6,
    `trace should expose the false fold pair (offset ${foldOffset} vs ${clearOffset}, width ${foldWidth} vs ${clearWidth})`);

  assert.ok(symmetricBoundaryDistancePx(result.ellipse, MULTI_RAY_FOLD_RIM.ellipse) <= 6,
    'a MAYBE must remain within six source pixels of the known outer ellipse');
});

test('the same source-pixel input gives deterministic geometry in source-image coordinates', () => {
  const raster = renderCoherentPairedRim(CLEAN_RIM);
  const proposal = innerFaceProposal(CLEAN_RIM.ellipse, CLEAN_RIM.faceFraction);
  const first = refineEllipseWithRimEvidence(raster, proposal, { enabled: true });
  const second = refineEllipseWithRimEvidence(raster, proposal, { enabled: true });

  assert.equal(first.status, 'MAYBE');
  assert.deepEqual(first.ellipse, second.ellipse, 'same bytes and proposal must produce repeatable geometry');
  assert.equal(first.trace.units, 'source-pixels');
  assert.ok(first.ellipse.centerX > 100 && first.ellipse.centerX < 160, 'centerX is reported in raster pixels');
  assert.ok(first.ellipse.centerY > 100 && first.ellipse.centerY < 160, 'centerY is reported in raster pixels');
  assert.ok(first.ellipse.radiusX > 70 && first.ellipse.radiusX < 105, 'radiusX is reported in raster pixels');
  assert.ok(first.ellipse.radiusY > 60 && first.ellipse.radiusY < 100, 'radiusY is reported in raster pixels');
});

test('near-circular axis reparameterization is accepted when the spatial boundary is unchanged', () => {
  const nearCircle = {
    ...CLEAN_RIM,
    ellipse: { ...CLEAN_RIM.ellipse, radiusX: 88, radiusY: 87.7 },
  };
  const raster = renderCoherentPairedRim(nearCircle);
  const proposalA = innerFaceProposal(nearCircle.ellipse, nearCircle.faceFraction);
  const proposalB = {
    ...proposalA,
    ellipse: {
      ...proposalA.ellipse,
      radiusX: proposalA.ellipse.radiusY,
      radiusY: proposalA.ellipse.radiusX,
      axisAngle: proposalA.ellipse.axisAngle + Math.PI / 2,
    },
  };

  const resultA = refineEllipseWithRimEvidence(raster, proposalA, { enabled: true });
  const resultB = refineEllipseWithRimEvidence(raster, proposalB, { enabled: true });

  assert.equal(resultA.status, 'MAYBE');
  assert.equal(resultB.status, 'MAYBE');
  assert.ok(symmetricBoundaryDistancePx(resultA.ellipse, resultB.ellipse) < 0.75,
    'equivalent major-axis parameterizations should return the same physical boundary');
  assert.ok(ellipseParameterError(resultA.ellipse, nearCircle.ellipse) < 2.5,
    'judge a near-circle by its boundary rather than an unstable angle value');
});

test('missing, malformed, and out-of-bounds inputs fail closed without changing supplied geometry', () => {
  const validRaster = renderCoherentPairedRim(CLEAN_RIM);
  const validProposal = innerFaceProposal(CLEAN_RIM.ellipse, CLEAN_RIM.faceFraction);
  const nullOptions = refineEllipseWithRimEvidence(validRaster, validProposal, null);
  assert.equal(nullOptions.status, 'ABSTAIN');
  assert.equal(nullOptions.reason, 'invalid-options');
  sameGeometry(nullOptions.ellipse, validProposal.ellipse);

  const invalidRasters = [
    undefined,
    null,
    { width: CLEAN_RIM.width, height: CLEAN_RIM.height, data: new Uint8Array(20) },
    { width: '256', height: CLEAN_RIM.height, data: validRaster.data },
  ];
  for (const raster of invalidRasters) {
    const result = refineEllipseWithRimEvidence(raster, validProposal, { enabled: true });
    assert.equal(result.status, 'ABSTAIN');
    sameGeometry(result.ellipse, validProposal.ellipse);
  }

  for (const ellipse of [
    { ...validProposal.ellipse, centerX: '129.25' },
    { ...validProposal.ellipse, axisAngle: Number.NaN },
    { ...validProposal.ellipse, radiusX: Number.POSITIVE_INFINITY },
    { ...validProposal.ellipse, axisAngle: '0.252' },
    { ...validProposal.ellipse, radiusX: 130, radiusY: 115, centerX: 8 },
  ]) {
    const proposal = { ...validProposal, ellipse };
    const result = refineEllipseWithRimEvidence(validRaster, proposal, { enabled: true });
    assert.equal(result.status, 'ABSTAIN');
    if ([ellipse.centerX, ellipse.centerY, ellipse.radiusX, ellipse.radiusY, ellipse.axisAngle].every(Number.isFinite))
      sameGeometry(result.ellipse, ellipse);
    else
      assert.equal(result.ellipse, null, 'unusable nonnumeric geometry must not be surfaced as a candidate');
  }

  for (const proposal of [undefined, null, { status: 'MAYBE' }, { status: 'FAIL', ellipse: validProposal.ellipse }]) {
    const result = refineEllipseWithRimEvidence(validRaster, proposal, { enabled: true });
    assert.equal(result.status, 'ABSTAIN');
  }
});
