import { canonicalEllipse, validateEllipseBounds } from './ellipse-geometry.mjs';

const SCHEMA = 'RimAwareEllipseRefinement@1';
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const finiteGeometry = e => e && [e.centerX, e.centerY, e.radiusX, e.radiusY, e.axisAngle].every(Number.isFinite) && e.radiusX > 0 && e.radiusY > 0;

function inputEllipse(proposal) {
  const value = proposal?.ellipse;
  return finiteGeometry(value) ? Object.freeze({
    centerX: value.centerX, centerY: value.centerY, radiusX: value.radiusX,
    radiusY: value.radiusY, axisAngle: value.axisAngle,
  }) : null;
}

function result(status, ellipse, originalEllipse, reason, trace = null, diagnosticEllipse = null) {
  return Object.freeze({ schema: SCHEMA, status, ellipse, originalEllipse, reason, trace, ...(diagnosticEllipse ? { diagnosticEllipse } : {}) });
}

function validRaster(raster) {
  return raster && Number.isInteger(raster.width) && Number.isInteger(raster.height) &&
    raster.width > 1 && raster.height > 1 && raster.data &&
    raster.data.length === raster.width * raster.height * 4;
}

function rgbAt(raster, x, y) {
  const { width, height, data } = raster;
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return null;
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const at = (px, py, channel) => data[(py * width + px) * 4 + channel];
  return [0, 1, 2].map(channel => {
    const top = at(x0, y0, channel) * (1 - fx) + at(x1, y0, channel) * fx;
    const bottom = at(x0, y1, channel) * (1 - fx) + at(x1, y1, channel) * fx;
    return top * (1 - fy) + bottom * fy;
  });
}

// D65 CIELAB; Lab makes a weak dirty-white/grey transition comparable across
// channels while a*b* isolates the face-to-rim chroma change from brightness.
function lab(rgb) {
  const [r, g, b] = rgb.map(value => {
    const q = value / 255;
    return q <= 0.04045 ? q / 12.92 : ((q + 0.055) / 1.055) ** 2.4;
  });
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = value => value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const distance3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const chromaDistance = (a, b) => Math.hypot(a[1] - b[1], a[2] - b[2]);
const average = rows => rows[0].map((_, k) => rows.reduce((sum, row) => sum + row[k], 0) / rows.length);

function pointAndNormal(ellipse, theta) {
  const c = Math.cos(ellipse.axisAngle), s = Math.sin(ellipse.axisAngle), ct = Math.cos(theta), st = Math.sin(theta);
  const x = ellipse.centerX + c * ellipse.radiusX * ct - s * ellipse.radiusY * st;
  const y = ellipse.centerY + s * ellipse.radiusX * ct + c * ellipse.radiusY * st;
  let nx = c * ct / ellipse.radiusX - s * st / ellipse.radiusY;
  let ny = s * ct / ellipse.radiusX + c * st / ellipse.radiusY;
  const norm = Math.hypot(nx, ny) || 1;
  nx /= norm; ny /= norm;
  return { x, y, nx, ny };
}

function offsetPoint(base, offset) {
  return { x: base.x + base.nx * offset, y: base.y + base.ny * offset };
}

function atLab(raster, base, offset) {
  const p = offsetPoint(base, offset), rgb = rgbAt(raster, p.x, p.y);
  return rgb ? lab(rgb) : null;
}

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.round((sorted.length - 1) * q)];
}

function clamp01(value) { return clamp(value, 0, 1); }

function localPairAt(raster, base, outerOffset, width) {
  const innerOffset = outerOffset - width;
  const face = atLab(raster, base, innerOffset - 2.5);
  const justInside = atLab(raster, base, innerOffset + 2.5);
  const justOutside = atLab(raster, base, outerOffset - 2.5);
  const background = atLab(raster, base, outerOffset + 2.5);
  if (!face || !justInside || !justOutside || !background) return null;
  const annulus = [0.25, 0.5, 0.75].map(fraction => atLab(raster, base, innerOffset + width * fraction));
  if (annulus.some(row => !row)) return null;
  const rimMean = average(annulus);
  const rimRms = Math.sqrt(annulus.reduce((sum, row) => sum + distance3(row, rimMean) ** 2, 0) / annulus.length);
  const innerDeltaE = distance3(face, justInside);
  const innerChroma = chromaDistance(face, justInside);
  const outerDeltaE = distance3(justOutside, background);
  const outerFarInside = atLab(raster, base, outerOffset - 6);
  const outerFarOutside = atLab(raster, base, outerOffset + 6);
  if (!outerFarInside || !outerFarOutside) return null;
  // Prefer a localized edge over broad fabric shading. The edge sample spans
  // 5px; its reference spans 12px along the same source-pixel normal.
  const outerWideDeltaE = distance3(outerFarInside, outerFarOutside);
  const outerLocalization = Math.min(1, outerDeltaE / Math.max(1e-6, outerWideDeltaE));
  const innerSignal = clamp01((innerChroma - 5) / 24) * clamp01((innerDeltaE - 7) / 28);
  const outerContrastSignal = clamp01((outerDeltaE - 3.5) / 12);
  const outerLocalizationSignal = clamp01((outerLocalization - 0.40) / 0.36);
  const outerSignal = outerContrastSignal * outerLocalizationSignal;
  const annulusCoherence = Math.exp(-rimRms / 22);
  // A weak outer edge can still contribute, but cannot win by itself: both
  // boundaries and a reasonably consistent enclosed rim color are required.
  const score = Math.sqrt(innerSignal * outerSignal) * annulusCoherence;
  return { score, innerDeltaE, innerChroma, outerDeltaE, outerLocalization, annulusCoherence, rimRms, width };
}

function findPairedBoundary(raster, ellipse) {
  const sampleCount = 64;
  const shortRadius = Math.min(ellipse.radiusX, ellipse.radiusY);
  const shiftLimit = clamp(shortRadius * 0.12, 12, 64);
  const maximumBandWidth = clamp(shortRadius * 0.22, 12, 96);
  const offsets = [];
  for (let d = -shiftLimit; d <= shiftLimit + 1e-6; d += 2) offsets.push(d);
  const widths = [];
  for (let w = 6; w <= maximumBandWidth; w += 4) widths.push(w);
  const points = [];
  const rows = [];
  const rayRows = [];
  for (let i = 0; i < sampleCount; i++) {
    const theta = TAU * i / sampleCount, base = pointAndNormal(ellipse, theta);
    let best = null;
    for (const outerOffset of offsets) for (const width of widths) {
      const pair = localPairAt(raster, base, outerOffset, width);
      if (!pair) continue;
      // A mild seed-distance prior breaks ties toward the current MAYBE fit;
      // it does not override a clearer nested face/rim/background signal.
      const prior = Math.exp(-0.10 * (outerOffset / shiftLimit) ** 2);
      const score = pair.score * prior;
      if (!best || score > best.score) best = { ...pair, score, jointScore: pair.score, outerOffset, theta, base };
    }
    const accepted = Boolean(best && best.score >= 0.12 && best.outerDeltaE >= 4.5 && best.outerLocalization >= 0.53);
    const target = best ? offsetPoint(best.base, best.outerOffset) : null;
    const inner = best ? offsetPoint(best.base, best.outerOffset - best.width) : null;
    rayRows.push(Object.freeze({
      sample: i, thetaRadians: theta, supported: accepted,
      reason: !best ? 'no-sampleable-paired-boundary' : accepted ? 'paired-boundary-evidence-found' :
        best.outerDeltaE < 4.5 ? 'weak-rim-background-contrast' :
        best.outerLocalization < 0.53 ? 'diffuse-rim-background-transition' : 'low-joint-pair-score',
      outerBoundaryPointSourcePx: target ? Object.freeze({ x: target.x, y: target.y }) : null,
      innerBoundaryPointSourcePx: inner ? Object.freeze({ x: inner.x, y: inner.y }) : null,
      ...(best ? {
        outerOffsetPx: best.outerOffset, bandWidthPx: best.width,
        innerChromaContrastLabAB: best.innerChroma, innerContrastLab: best.innerDeltaE,
        outerContrastLab: best.outerDeltaE, outerLocalization: best.outerLocalization,
        annulusCoherence: best.annulusCoherence, pairScore: best.score, jointScore: best.jointScore,
      } : {}),
    }));
    if (accepted) {
      const target = offsetPoint(best.base, best.outerOffset);
      points.push({ sample: i, x: target.x, y: target.y, weight: best.score, theta: best.theta });
      rows.push(best);
    }
  }
  return { points, rows, rayRows, sampleCount, shiftLimit, maximumBandWidth };
}

function solveLinearSystem(matrix, vector) {
  const n = vector.length, rows = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    if (Math.abs(rows[pivot][col]) < 1e-10) return null;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const scale = rows[col][col];
    for (let k = col; k <= n; k++) rows[col][k] /= scale;
    for (let row = 0; row < n; row++) if (row !== col) {
      const factor = rows[row][col];
      for (let k = col; k <= n; k++) rows[row][k] -= factor * rows[col][k];
    }
  }
  return rows.map(row => row[n]);
}

function ellipseResidual(point, p) {
  const [cx, cy, rx, ry, angle] = p, c = Math.cos(angle), s = Math.sin(angle), dx = point.x - cx, dy = point.y - cy;
  const u = c * dx + s * dy, v = -s * dx + c * dy;
  return Math.hypot(u / rx, v / ry) - 1;
}

function fitEllipse(points, seed) {
  let p = [seed.centerX, seed.centerY, seed.radiusX, seed.radiusY, seed.axisAngle];
  const minimumRadius = Math.min(seed.radiusX, seed.radiusY);
  // Axis orientation is poorly determined near a circle. Freeze the seed
  // angle below 6% eccentricity; otherwise tiny pixel noise can rotate a
  // nearly round disc by tens of degrees without improving its boundary.
  const axisObservable = (seed.radiusX - seed.radiusY) / seed.radiusX >= 0.06;
  for (let iteration = 0; iteration < 12; iteration++) {
    const a = Array.from({ length: 5 }, () => Array(5).fill(0)), b = Array(5).fill(0);
    for (const point of points) {
      const [cx, cy, rx, ry, angle] = p, c = Math.cos(angle), s = Math.sin(angle), dx = point.x - cx, dy = point.y - cy;
      const u = c * dx + s * dy, v = -s * dx + c * dy, rx2 = rx * rx, ry2 = ry * ry;
      const residual = Math.hypot(u / rx, v / ry) - 1;
      const errorPx = Math.abs(residual) * minimumRadius;
      const huber = errorPx <= 7 ? 1 : 7 / errorPx;
      const weight = point.weight * huber;
      const radial = Math.hypot(u / rx, v / ry) || 1e-8;
      const jacobian = [
        (u * (-c / rx2) + v * (s / ry2)) / radial,
        (u * (-s / rx2) - v * (c / ry2)) / radial,
        -u * u / (rx2 * rx * radial),
        -v * v / (ry2 * ry * radial),
        u * v * (1 / rx2 - 1 / ry2) / radial,
      ];
      if (!axisObservable) jacobian[4] = 0;
      for (let r = 0; r < 5; r++) {
        b[r] -= weight * jacobian[r] * residual;
        for (let col = 0; col < 5; col++) a[r][col] += weight * jacobian[r] * jacobian[col];
      }
    }
    if (!axisObservable) { a[4][4] = 1; b[4] = 0; }
    for (let k = 0; k < 5; k++) a[k][k] += 1e-8;
    const delta = solveLinearSystem(a, b);
    if (!delta) return null;
    p = p.map((value, i) => value + delta[i]);
    p[2] = Math.max(1, p[2]); p[3] = Math.max(1, p[3]);
    if (Math.max(...delta.map(Math.abs)) < 1e-4) break;
  }
  if (!axisObservable && p[2] < p[3]) {
    // When the data fit crosses the axes while orientation is unidentifiable,
    // keep the seed orientation and report the least-biased circular average.
    const radius = (p[2] + p[3]) / 2;
    p[2] = radius; p[3] = radius;
  }
  const ellipse = canonicalEllipse({ centerX: p[0], centerY: p[1], radiusX: p[2], radiusY: p[3], axisAngle: p[4] });
  const before = points.map(point => Math.abs(ellipseResidual(point, [seed.centerX, seed.centerY, seed.radiusX, seed.radiusY, seed.axisAngle])) * minimumRadius);
  const after = points.map(point => Math.abs(ellipseResidual(point, [ellipse.centerX, ellipse.centerY, ellipse.radiusX, ellipse.radiusY, ellipse.axisAngle])) * minimumRadius);
  return { ellipse, beforeMedianPx: quantile(before, 0.5), afterMedianPx: quantile(after, 0.5) };
}

function sectorCoverage(rows, count, sectors = 12, predicate = () => true) {
  const bins = Array.from({ length: sectors }, () => 0), supported = Array.from({ length: sectors }, () => 0);
  for (const row of rows) {
    const sector = Math.min(sectors - 1, Math.floor(row.theta / TAU * sectors));
    bins[sector]++;
    if (predicate(row)) supported[sector]++;
  }
  const active = supported.filter((value, i) => bins[i] > 0 && value >= Math.ceil(count / sectors * 0.25)).length;
  return { supportedSectors: active, fractions: supported.map((value, i) => bins[i] ? value / bins[i] : 0) };
}

/**
 * Remove geometry-only outliers where a broad false band forms a plateau in
 * both outer offset and rim width. A real tilted/perspective ellipse varies
 * smoothly with angle; a cloth extension creates opposite-sign step edges.
 * Pixel evidence remains in the trace even when excluded from the fit.
 */
function applyAngularProfileConsensus(found, ellipse) {
  const { sampleCount } = found;
  const shortRadius = Math.min(ellipse.radiusX, ellipse.radiusY);
  const offsetStep = Math.max(5, shortRadius * 0.015);
  const widthStep = Math.max(5, shortRadius * 0.015);
  const bySample = Array(sampleCount).fill(null);
  // Keep weak best-pair samples for profile-boundary evidence. A real false
  // band often has a diffuse leading/trailing pixel at the very edge, while
  // the interior arc carries strong support. Such a ray can close a block
  // only when at least 75% of the enclosed block is itself supported.
  for (const ray of found.rayRows) if (Number.isFinite(ray.outerOffsetPx) && Number.isFinite(ray.bandWidthPx) && ray.pairScore >= 0.3)
    bySample[ray.sample] = {
      sample: ray.sample, outerOffset: ray.outerOffsetPx, width: ray.bandWidthPx,
      score: ray.pairScore, supported: ray.supported, theta: ray.thetaRadians,
    };
  const transitions = [];
  for (let i = 0; i < sampleCount; i++) {
    const j = (i + 1) % sampleCount, a = bySample[i], b = bySample[j];
    if (!a || !b) continue;
    const offsetDelta = b.outerOffset - a.outerOffset, widthDelta = b.width - a.width;
    if (Math.abs(offsetDelta) >= offsetStep && Math.abs(widthDelta) >= widthStep)
      transitions.push({ from: i, to: j, direction: Math.sign(offsetDelta), offsetDelta, widthDelta });
  }

  const excluded = new Map();
  const blocks = [];
  const minimumArcRays = Math.ceil(sampleCount * 20 / 360), maximumArcRays = Math.floor(sampleCount * 150 / 360);
  for (const start of transitions) for (const end of transitions) {
    if (start.direction === end.direction) continue;
    const span = (end.from - start.from + sampleCount) % sampleCount;
    if (span < minimumArcRays || span > maximumArcRays) continue;
    const insideIndices = [];
    for (let step = 1; step <= span; step++) insideIndices.push((start.from + step) % sampleCount);
    const outsideIndices = [];
    for (let step = 0; step < 3; step++) {
      outsideIndices.push((start.from - step + sampleCount) % sampleCount);
      outsideIndices.push((end.to + step) % sampleCount);
    }
    const inside = insideIndices.map(index => bySample[index]).filter(Boolean);
    const outside = outsideIndices.map(index => bySample[index]).filter(Boolean);
    if (inside.length < Math.ceil(span * 0.75) || outside.length < 4 ||
        inside.filter(row => row.supported).length / inside.length < 0.75 ||
        outside.filter(row => row.supported).length / outside.length < 0.75) continue;
    const insideOffset = quantile(inside.map(row => row.outerOffset), 0.5);
    const outsideOffset = quantile(outside.map(row => row.outerOffset), 0.5);
    const insideWidth = quantile(inside.map(row => row.width), 0.5);
    const outsideWidth = quantile(outside.map(row => row.width), 0.5);
    const offsetShift = insideOffset - outsideOffset, widthShift = insideWidth - outsideWidth;
    const thresholdMatch = Math.sign(offsetShift) === start.direction && Math.sign(widthShift) === start.direction;
    if (!thresholdMatch || Math.abs(offsetShift) < offsetStep * 0.75 || Math.abs(widthShift) < widthStep * 0.75) continue;
    const block = {
      startSample: start.to,
      endSample: end.from,
      sampleCount: inside.length,
      arcDegrees: span * 360 / sampleCount,
      medianOffsetShiftPx: offsetShift,
      medianWidthShiftPx: widthShift,
      startOffsetStepPx: start.offsetDelta,
      endOffsetStepPx: end.offsetDelta,
      startWidthStepPx: start.widthDelta,
      endWidthStepPx: end.widthDelta,
      reason: 'opposed-offset-and-width-steps-bound-a-non-conic-band-arc',
    };
    blocks.push(block);
    for (const index of insideIndices) excluded.set(index, 'bounded-false-band-arc');
  }

  // Also discard isolated paired-profile spikes. Requiring both offset and
  // width to depart from their four-ray neighborhood avoids suppressing a
  // smooth local rim-width change caused by perspective or lighting.
  for (let i = 0; i < sampleCount; i++) {
    if (excluded.has(i) || !bySample[i]?.supported) continue;
    const neighbors = [-2, -1, 1, 2].map(delta => bySample[(i + delta + sampleCount) % sampleCount]).filter(Boolean);
    if (neighbors.length < 3) continue;
    const medianOffset = quantile(neighbors.map(row => row.outerOffset), 0.5);
    const medianWidth = quantile(neighbors.map(row => row.width), 0.5);
    const offsetResidual = Math.abs(bySample[i].outerOffset - medianOffset);
    const widthResidual = Math.abs(bySample[i].width - medianWidth);
    if (offsetResidual >= offsetStep * 1.25 && widthResidual >= widthStep * 1.25)
      excluded.set(i, 'isolated-offset-and-width-profile-spike');
  }

  const geometryPoints = found.points.filter(point => !excluded.has(point.sample));
  const geometryRows = found.rows.filter(row => {
    const sample = Math.min(sampleCount - 1, Math.round(row.theta / TAU * sampleCount) % sampleCount);
    return !excluded.has(sample);
  });
  const geometryCoverage = geometryPoints.length / sampleCount;
  const geometryOutlierCount = found.points.filter(point => excluded.has(point.sample)).length;
  const geometrySectors = sectorCoverage(geometryRows, sampleCount);
  const rayRows = found.rayRows.map(ray => {
    const exclusion = excluded.get(ray.sample);
    return Object.freeze({
      ...ray,
      geometryIncluded: Boolean(ray.supported && !exclusion),
      ...(exclusion ? { geometryExclusionReason: exclusion } : {}),
    });
  });
  const geometryConsensus = Object.freeze({
    method: 'paired outer-offset and band-width angular discontinuity screening',
    units: 'source-pixels',
    offsetStepThresholdPx: offsetStep,
    bandWidthStepThresholdPx: widthStep,
    geometryInlierSamples: geometryPoints.length,
    geometryOutlierSamples: geometryOutlierCount,
    geometryInlierFraction: geometryCoverage,
    geometryInlierSectors: geometrySectors.supportedSectors,
    profileDiscontinuities: Object.freeze(transitions.map(transition => Object.freeze({ ...transition }))),
    excludedArcBlocks: Object.freeze(blocks.map(block => Object.freeze(block))),
    excludedSamples: Object.freeze([...excluded.entries()].map(([sample, reason]) => Object.freeze({ sample, reason }))),
  });
  return { ...found, points: geometryPoints, geometryRows, rayRows, geometryConsensus };
}

function maximumSampledBoundarySeparation(first, second) {
  const count = 128;
  const points = ellipse => Array.from({ length: count }, (_, i) => {
    const point = pointAndNormal(ellipse, TAU * i / count);
    return { x: point.x, y: point.y };
  });
  const a = points(first), b = points(second);
  const directed = (from, to) => Math.max(...from.map(point => Math.min(...to.map(other => Math.hypot(point.x - other.x, point.y - other.y)))));
  return Math.max(directed(a, b), directed(b, a));
}

function traceFor(found, fit, startedAt, options = {}) {
  const { rows, sampleCount, shiftLimit, maximumBandWidth } = found;
  const inner = rows.map(row => row.innerChroma), innerE = rows.map(row => row.innerDeltaE), outer = rows.map(row => row.outerDeltaE);
  const widths = rows.map(row => row.width), coherence = rows.map(row => row.annulusCoherence), offsets = rows.map(row => row.outerOffset);
  const sectors = sectorCoverage(rows, sampleCount);
  const perSector = Object.freeze(Array.from({ length: 12 }, (_, sector) => {
    const sectorRows = rows.filter(row => Math.min(11, Math.floor(row.theta / TAU * 12)) === sector);
    const sectorRays = found.rayRows.filter(ray => Math.min(11, Math.floor(ray.thetaRadians / TAU * 12)) === sector);
    return Object.freeze({
      sector,
      supportedSamples: sectorRows.length,
      geometryIncludedSamples: sectorRays.filter(ray => ray.geometryIncluded).length,
      medianOuterOffsetPx: quantile(sectorRows.map(row => row.outerOffset), 0.5),
      medianBandWidthPx: quantile(sectorRows.map(row => row.width), 0.5),
      medianPairScore: quantile(sectorRows.map(row => row.score), 0.5),
      lowerQuartileOuterContrastLab: quantile(sectorRows.map(row => row.outerDeltaE), 0.25),
      lowerQuartileOuterLocalization: quantile(sectorRows.map(row => row.outerLocalization), 0.25),
    });
  }));
  const angleDelta = ((fit.ellipse.axisAngle - options.original.axisAngle + Math.PI / 2) % Math.PI + Math.PI) % Math.PI - Math.PI / 2;
  return Object.freeze({
    version: SCHEMA,
    units: 'source-pixels',
    timingMs: Math.round((globalThis.performance?.now?.() ?? Date.now()) - startedAt),
    sampleCount,
    supportedSamples: rows.length,
    supportedFraction: rows.length / sampleCount,
    supportedSectors: sectors.supportedSectors,
    sectorSupportFractions: Object.freeze(sectors.fractions),
    sectorEvidence: perSector,
    geometryConsensus: found.geometryConsensus,
    perRayEvidence: Object.freeze(found.rayRows),
    innerBoundary: Object.freeze({ coverage: rows.length / sampleCount, medianChromaContrastLabAB: quantile(inner, 0.5), medianContrastLab: quantile(innerE, 0.5) }),
    outerBoundary: Object.freeze({ coverage: rows.length / sampleCount, medianContrastLab: quantile(outer, 0.5) }),
    outerLocalization: quantile(rows.map(row => row.outerLocalization), 0.5),
    annulus: Object.freeze({ medianWidthPx: quantile(widths, 0.5), p10WidthPx: quantile(widths, 0.1), p90WidthPx: quantile(widths, 0.9), medianCoherence: quantile(coherence, 0.5) }),
    geometryDeltaPx: Object.freeze({
      center: Math.hypot(fit.ellipse.centerX - options.original.centerX, fit.ellipse.centerY - options.original.centerY),
      radiusX: fit.ellipse.radiusX - options.original.radiusX,
      radiusY: fit.ellipse.radiusY - options.original.radiusY,
      axisAngleDegrees: angleDelta * 180 / Math.PI,
      medianBoundaryShift: quantile(offsets, 0.5),
      maximumSampledBoundaryDistancePx: options.maximumBoundaryShiftPx,
    }),
    fit: Object.freeze({ medianBoundaryResidualBeforePx: fit.beforeMedianPx, medianBoundaryResidualAfterPx: fit.afterMedianPx }),
    search: Object.freeze({ maximumOffsetPx: shiftLimit, maximumBandWidthPx: maximumBandWidth, offsetStepPx: 2, bandWidthStepPx: 4, minimumPairScore: 0.12, minimumOuterContrastLab: 4.5, minimumOuterLocalization: 0.53 }),
  });
}

/**
 * Refine an existing MAYBE ellipse by locating a nested face→rim chroma edge
 * and rim→background edge together in source pixels. This is review-only and
 * default-OFF; an abstention always carries the input ellipse unchanged.
 */
export function refineEllipseWithRimEvidence(raster, proposal, options = {}) {
  const startedAt = globalThis.performance?.now?.() ?? Date.now();
  const originalEllipse = inputEllipse(proposal);
  const originalForReturn = originalEllipse ?? null;
  const abstain = (reason, trace = null, diagnosticEllipse = null) => result('ABSTAIN', originalForReturn, originalForReturn, reason, trace, diagnosticEllipse);
  if (!options || typeof options !== 'object' || Array.isArray(options)) return abstain('invalid-options');
  if (options.enabled !== true) return abstain('feature-disabled');
  if (!validRaster(raster)) return abstain('invalid-source-raster');
  if (proposal?.status !== 'MAYBE' || !originalEllipse) return abstain('requires-valid-maybe-ellipse');
  let ellipse;
  try { ellipse = canonicalEllipse(originalEllipse); } catch { return abstain('invalid-ellipse-geometry'); }
  if (!validateEllipseBounds(raster.width, raster.height, ellipse, 0)) return abstain('ellipse-outside-source-bounds');

  const pairedEvidence = findPairedBoundary(raster, ellipse);
  const found = applyAngularProfileConsensus(pairedEvidence, ellipse);
  const sectors = sectorCoverage(found.rows, found.sampleCount);
  const coverage = found.rows.length / found.sampleCount;
  const outerLocalization = quantile(found.rows.map(row => row.outerLocalization), 0.5);
  if (coverage < 0.42 || sectors.supportedSectors < 8 || (outerLocalization ?? 0) < 0.58) {
    const candidate = found.points.length >= 8 ? fitEllipse(found.points, ellipse)?.ellipse ?? null : null;
    return abstain('insufficient-joint-face-rim-background-support', Object.freeze({
      version: SCHEMA, units: 'source-pixels', timingMs: Math.round((globalThis.performance?.now?.() ?? Date.now()) - startedAt),
      sampleCount: found.sampleCount, supportedSamples: found.rows.length, supportedFraction: coverage,
      supportedSectors: sectors.supportedSectors, sectorSupportFractions: Object.freeze(sectors.fractions),
      minimumCoverage: 0.42, minimumSectors: 8,
      outerLocalization: outerLocalization ?? null, minimumMedianOuterLocalization: 0.58,
      perRayEvidence: Object.freeze(found.rayRows),
      geometryConsensus: found.geometryConsensus,
      ...(candidate ? { diagnosticEllipse: candidate } : {}),
      search: Object.freeze({ maximumOffsetPx: found.shiftLimit, maximumBandWidthPx: found.maximumBandWidth, offsetStepPx: 2, bandWidthStepPx: 4 }),
    }), candidate);
  }
  if (found.geometryConsensus.geometryInlierFraction < 0.58 || found.geometryConsensus.geometryInlierSectors < 8) {
    const candidate = found.points.length >= 8 ? fitEllipse(found.points, ellipse)?.ellipse ?? null : null;
    return abstain('insufficient-conic-geometry-consensus', Object.freeze({
      version: SCHEMA, units: 'source-pixels', timingMs: Math.round((globalThis.performance?.now?.() ?? Date.now()) - startedAt),
      sampleCount: found.sampleCount, supportedSamples: found.rows.length, supportedFraction: coverage,
      perRayEvidence: Object.freeze(found.rayRows), geometryConsensus: found.geometryConsensus,
      search: Object.freeze({ maximumOffsetPx: found.shiftLimit, maximumBandWidthPx: found.maximumBandWidth, offsetStepPx: 2, bandWidthStepPx: 4 }),
      ...(candidate ? { diagnosticEllipse: candidate } : {}),
    }), candidate);
  }
  const fitted = fitEllipse(found.points, ellipse);
  if (!fitted) return abstain('ellipse-refit-singular');
  const maximumBoundaryShift = maximumSampledBoundarySeparation(ellipse, fitted.ellipse);
  const trace = traceFor(found, fitted, startedAt, { original: ellipse, maximumBoundaryShiftPx: maximumBoundaryShift });
  if (!validateEllipseBounds(raster.width, raster.height, fitted.ellipse, 0)) return abstain('refined-ellipse-outside-source-bounds', trace, fitted.ellipse);
  if (fitted.afterMedianPx > Math.max(2.5, fitted.beforeMedianPx * 0.8)) return abstain('ellipse-refit-did-not-converge', trace, fitted.ellipse);
  if (maximumBoundaryShift > found.shiftLimit + 8) return abstain('refined-ellipse-exceeds-search-bound', trace, fitted.ellipse);
  if (maximumBoundaryShift < 0.75) return abstain('no-material-geometry-change', trace, fitted.ellipse);

  return result('MAYBE', fitted.ellipse, originalForReturn, 'paired-rim-evidence-refined-review-only', trace);
}
