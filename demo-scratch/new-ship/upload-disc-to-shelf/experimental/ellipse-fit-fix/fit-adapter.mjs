import { canonicalEllipse, validateEllipseBounds } from './ellipse-geometry.mjs';

function rgbAt(data, width, height, x, y) {
  x = Math.max(0, Math.min(width - 1.001, x)); y = Math.max(0, Math.min(height - 1.001, y));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1), fx = x - x0, fy = y - y0;
  const sample = channel => {
    const at = (px, py) => data[(py * width + px) * 4 + channel];
    const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx, bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
  return [sample(0), sample(1), sample(2)];
}

function sourceBoundaryEvidence(data, width, height, ellipse, factor = 1, samples = 96) {
  const values = [];
  const c = Math.cos(ellipse.axisAngle), s = Math.sin(ellipse.axisAngle);
  for (let i = 0; i < samples; i++) {
    const t = Math.PI * 2 * i / samples, ct = Math.cos(t), st = Math.sin(t);
    const x = ellipse.centerX + c * ellipse.radiusX * factor * ct - s * ellipse.radiusY * factor * st;
    const y = ellipse.centerY + s * ellipse.radiusX * factor * ct + c * ellipse.radiusY * factor * st;
    let nx = c * ct / ellipse.radiusX - s * st / ellipse.radiusY, ny = s * ct / ellipse.radiusX + c * st / ellipse.radiusY;
    const n = Math.hypot(nx, ny) || 1; nx /= n; ny /= n;
    const inside = rgbAt(data, width, height, x - nx * 2.0, y - ny * 2.0), outside = rgbAt(data, width, height, x + nx * 2.0, y + ny * 2.0);
    values.push(Math.hypot(inside[0] - outside[0], inside[1] - outside[1], inside[2] - outside[2]) / Math.sqrt(3));
  }
  const threshold = 12, supported = values.filter(value => value >= threshold).length;
  const sectors = Array.from({ length: 12 }, (_, sector) => values.slice(Math.floor(sector * samples / 12), Math.floor((sector + 1) * samples / 12)));
  const supportedSectors = sectors.filter(rows => rows.filter(value => value >= threshold).length >= Math.ceil(rows.length * .25)).length;
  const sorted = [...values].sort((a, b) => a - b), core = sorted.slice(Math.floor(samples * .12), Math.ceil(samples * .88));
  return { meanContrast: core.reduce((sum, value) => sum + value, 0) / core.length, coverage: supported / samples, supportedSectors, sectorCoverage: supportedSectors / 12, threshold, sampleCount: samples };
}

function largerOuterContourGuard(data, width, height, ellipse, ownEvidence) {
  const checks = [];
  for (const factor of [1.035, 1.07, 1.11, 1.16, 1.22, 1.28]) {
    const candidate = { ...ellipse, radiusX: ellipse.radiusX * factor, radiusY: ellipse.radiusY * factor };
    if (!validateEllipseBounds(width, height, candidate)) continue;
    const evidence = sourceBoundaryEvidence(data, width, height, ellipse, factor, 72);
    checks.push({ factor, ...evidence });
  }
  const minimumContrast = Math.max(13, ownEvidence.meanContrast * .62);
  const supported = checks.find(row => row.coverage >= .36 && row.sectorCoverage >= .5 && row.meanContrast >= minimumContrast);
  return Object.freeze({ possibleLargerOuterBoundary: Boolean(supported), minimumContrast, checks: Object.freeze(checks) });
}

function localCropToGeometry(localCrop) {
  const raw = localCropToRawGeometry(localCrop);
  return raw ? canonicalEllipse(raw) : null;
}

function localCropToRawGeometry(localCrop) {
  if (!localCrop || !Array.isArray(localCrop.centerPx) || !Array.isArray(localCrop.radiiPx) || localCrop.centerPx.length !== 2 || localCrop.radiiPx.length !== 2) return null;
  if (![...localCrop.centerPx, ...localCrop.radiiPx, localCrop.rotationRadians].every(Number.isFinite) || localCrop.radiiPx.some(radius => radius <= 0)) return null;
  return { centerX: localCrop.centerPx[0], centerY: localCrop.centerPx[1], radiusX: localCrop.radiiPx[0], radiusY: localCrop.radiiPx[1], axisAngle: localCrop.rotationRadians };
}

function validRaster(raster) {
  return raster && Number.isFinite(raster.width) && Number.isFinite(raster.height) &&
    raster.width > 1 && raster.height > 1 && raster.data && raster.data.length === raster.width * raster.height * 4;
}

function failed(reason, detectorStatus = 'missing', diagnostics = null) {
  return Object.freeze({ status: 'FAIL', ellipse: null, reason, detectorStatus, diagnostics });
}

/** Covariance-map a working-raster ellipse through independent x/y scales. */
export function mapWorkingEllipseToSource(ellipse, workingWidth, workingHeight, sourceWidth, sourceHeight) {
  if (![workingWidth, workingHeight, sourceWidth, sourceHeight].every(value => Number.isFinite(value) && value > 1) ||
      !ellipse || ![ellipse.centerX, ellipse.centerY, ellipse.radiusX, ellipse.radiusY, ellipse.axisAngle].every(Number.isFinite)) return null;
  const sx = sourceWidth / workingWidth, sy = sourceHeight / workingHeight;
  return mapEllipseCovariance(ellipse, sx, sy, (x, y) => ({ x: (x + .5) * sx - .5, y: (y + .5) * sy - .5 }));
}

function mapEllipseCovariance(ellipse, sx, sy, mapCenter) {
  const c = Math.cos(ellipse.axisAngle), s = Math.sin(ellipse.axisAngle), rx2 = ellipse.radiusX ** 2, ry2 = ellipse.radiusY ** 2;
  const xx = sx * sx * (rx2 * c * c + ry2 * s * s);
  const xy = sx * sy * (rx2 - ry2) * s * c;
  const yy = sy * sy * (rx2 * s * s + ry2 * c * c);
  const spread = Math.hypot(xx - yy, 2 * xy), major = Math.max(0, (xx + yy + spread) / 2), minor = Math.max(0, (xx + yy - spread) / 2);
  const center = mapCenter(ellipse.centerX, ellipse.centerY);
  return canonicalEllipse({
    centerX: center.x,
    centerY: center.y,
    radiusX: Math.sqrt(major), radiusY: Math.sqrt(minor),
    axisAngle: .5 * Math.atan2(2 * xy, xx - yy),
  });
}

function mapRimFitEllipseToInput(localCrop, workerInput, width, height) {
  const geometry = localCropToRawGeometry(localCrop);
  if (!geometry) return null;
  if (!workerInput) return canonicalEllipse(geometry);
  const { cropWidth, cropHeight, workingWidth, workingHeight, workingScaleX, workingScaleY } = workerInput;
  if (cropWidth !== width || cropHeight !== height ||
      ![workingWidth, workingHeight, workingScaleX, workingScaleY].every(value => Number.isFinite(value) && value > 0) ||
      workingWidth <= 1 || workingHeight <= 1 ||
      Math.abs(workingScaleX - (workingWidth - 1) / (cropWidth - 1)) > 1e-12 ||
      Math.abs(workingScaleY - (workingHeight - 1) / (cropHeight - 1)) > 1e-12) return null;
  // The frozen worker scales returned centers and radii independently in x/y,
  // without rotating the ellipse axes. Undo that encoding first, then map the
  // raw fitted covariance through its endpoint-aligned resize exactly.
  const workingEllipse = {
    centerX: geometry.centerX * workingScaleX,
    centerY: geometry.centerY * workingScaleY,
    radiusX: geometry.radiusX * workingScaleX,
    radiusY: geometry.radiusY * workingScaleY,
    axisAngle: geometry.axisAngle,
  };
  return mapEllipseCovariance(workingEllipse, 1 / workingScaleX, 1 / workingScaleY,
    (x, y) => ({ x: x / workingScaleX, y: y / workingScaleY }));
}

/** Adapt the frozen RimFit v3 result to an editable, source-pixel ellipse. */
export function adaptRimFitResult(result, input) {
  if (!input || !validRaster(input)) return failed('invalid-fit-raster', result?.status ?? 'missing');
  const { data, width, height } = input;
  const source = input.source ?? input;
  if (!validRaster(source)) return failed('invalid-source-raster', result?.status ?? 'missing');
  if (result?.input && (result.input.cropWidth !== width || result.input.cropHeight !== height))
    return failed('worker-raster-provenance-mismatch', result.status, result.input);
  const raw = result?.status === 'accepted' ? result?.ellipse?.localCrop : null;
  if (!raw) {
    const diagnosticFit = mapRimFitEllipseToInput(result?.diagnosticFit?.localCrop, result?.input, width, height);
    const diagnosticSource = diagnosticFit && (input.source
      ? mapWorkingEllipseToSource(diagnosticFit, width, height, source.width, source.height)
      : diagnosticFit);
    return failed(result?.status === 'abstained' ? 'rimfit-abstained-manual-placement-required' : 'no-accepted-rimfit-ellipse', result?.status ?? 'missing', Object.freeze({
      quality: result?.algorithm?.quality ?? null,
      unacceptedDiagnosticEllipse: diagnosticSource ?? null,
      requiresManualPlacement: true,
      perspectiveRecovered: false,
    }));
  }
  const fitGeometry = mapRimFitEllipseToInput(raw, result?.input, width, height);
  const geometry = fitGeometry && (input.source
    ? mapWorkingEllipseToSource(fitGeometry, width, height, source.width, source.height)
    : fitGeometry);
  if (!fitGeometry || !validateEllipseBounds(width, height, fitGeometry, 0) || !geometry || !validateEllipseBounds(source.width, source.height, geometry, 0))
    return failed('no-bounded-rimfit-proposal', result?.status ?? 'missing', result?.algorithm?.quality ?? null);
  // Edge evidence is evaluated on precisely the raster sent to this adapter.
  // Full-source callers therefore measure offsets in source pixels; an
  // explicitly mapped working-raster caller measures them in working pixels.
  const boundaryEvidence = sourceBoundaryEvidence(source.data, source.width, source.height, geometry);
  const outerRimGuard = largerOuterContourGuard(source.data, source.width, source.height, geometry, boundaryEvidence);
  // RimFit acceptance and the human-facing state stay separate: even its
  // accepted geometry must be inspected for outer-overmold inclusion.
  const reason = outerRimGuard.possibleLargerOuterBoundary ? 'possible-larger-outer-overmold-review' : 'rimfit-accepted-awaiting-creator';
  return Object.freeze({
    status: 'MAYBE', ellipse: geometry, reason,
    detectorStatus: result.status,
    diagnostics: Object.freeze({
      detector: 'existing-RimFit-v3',
      sourceAlgorithmSchema: result.sourceAlgorithmSchema,
      sourceAlgorithmSha256: result.sourceAlgorithmSha256,
      timing: result.timing,
      quality: result.algorithm?.quality ?? null,
      refinement: { maximumDimension: input.maxRefinementDimension ?? null, workerInput: result.input ?? null },
      fitRaster: { width, height, maximumDimension: Math.max(width, height) },
      sourceRaster: { width: source.width, height: source.height },
      sourceMapping: { scaleX: source.width / width, scaleY: source.height / height, covarianceMapped: Boolean(input.source) },
      sourceBoundaryEvidence: boundaryEvidence,
      outerRimGuard,
      outerGuardOffsetUnit: 'source-pixels',
      requiresCreatorConfirmation: true,
      perspectiveRecovered: false,
    }),
  });
}
