import { Part } from '../part-first-kernel/src/pxc.mjs';
import { cropForSourceSamples } from './crop-geometry.ts';

export type DiscCircle = { x: number; y: number; radius: number; confidence: number };
type Raster = { width: number; height: number; rgba: Uint8ClampedArray };
export type CircleCandidate = { id: string; circle: DiscCircle; score: number; ellipse?: { x: number; y: number; radiusX: number; radiusY: number; rotation: number } };
export type CircleCandidateRequest = { operation: 'initial' | 'refine' | 'other'; selected?: CircleCandidate; excluded?: readonly CircleCandidate[]; rimFit?: boolean };
export type CircleCandidateSession = { photoIntake: string; serial: number };

type CircleCropHelpers = {
  clampCropSelection: (width: number, height: number, crop: any) => any;
};

// Bounded coarse ring search, recovered from the pre-RimFit creator. It only
// runs on the 720px working raster; full-resolution work is refinement below.
export function detectDiscCircle(data: Uint8ClampedArray, width: number, height: number): DiscCircle | null {
  if (width < 32 || height < 32 || data.length < width * height * 4) return null;
  const sample = (x: number, y: number) => {
    const i = (Math.max(0, Math.min(height - 1, Math.round(y))) * width + Math.max(0, Math.min(width - 1, Math.round(x)))) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const distance = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  const shortest = Math.min(width, height), minRadius = Math.max(12, Math.floor(shortest * .18)), maxRadius = Math.floor(shortest * .48);
  let best: DiscCircle | null = null;
  for (let radius = minRadius; radius <= maxRadius; radius += 4) {
    const step = Math.max(3, Math.floor(radius / 8));
    for (let y = radius; y <= height - radius; y += step) for (let x = radius; x <= width - radius; x += step) {
      let score = 0;
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 18) {
        const dx = Math.cos(angle), dy = Math.sin(angle);
        score += distance(sample(x + dx * (radius - 2), y + dy * (radius - 2)), sample(x + dx * (radius + 2), y + dy * (radius + 2)));
      }
      score = score / 36 * (1 + radius / shortest);
      if (!best || score > best.confidence) best = { x, y, radius, confidence: score };
    }
  }
  return best && best.confidence >= 18 ? best : null;
}

function foregroundModel(data: Uint8ClampedArray, width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 32 || height < 32 || data.length < width * height * 4) return null;
  const at = (x: number, y: number) => { const i = (Math.min(height - 1, y) * width + Math.min(width - 1, x)) * 4; return [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255]; };
  const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
  const border: number[][] = [];
  for (let x = 0; x < width; x++) border.push(at(x, 0), at(x, height - 1));
  for (let y = 0; y < height; y++) border.push(at(0, y), at(width - 1, y));
  const background = [0, 1, 2].map(channel => median(border.map(pixel => pixel[channel])));
  const distance = (pixel: number[]) => Math.hypot(pixel[0] - background[0], pixel[1] - background[1], pixel[2] - background[2]);
  const noise = border.map(distance).sort((a, b) => a - b);
  return { at, distance, threshold: Math.max(.14, (noise[Math.floor(noise.length * .9)] ?? 0) * 1.8) };
}

// Recovered from the 2026-09-18 CircleFit checkpoint. It refines only the
// component supported by the coarse proposal, at source-pixel resolution.
function refineSupportedComponent(data: Uint8ClampedArray, width: number, height: number, proposal: DiscCircle) {
  const model = foregroundModel(data, width, height); if (!model) return null;
  const { at, distance, threshold } = model, mask = new Uint8Array(width * height), seen = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) mask[y * width + x] = distance(at(x, y)) > threshold ? 1 : 0;
  let start = -1, startScore = Infinity;
  for (let y = Math.max(0, Math.floor(proposal.y - proposal.radius * .9)); y <= Math.min(height - 1, Math.ceil(proposal.y + proposal.radius * .9)); y++) for (let x = Math.max(0, Math.floor(proposal.x - proposal.radius * .9)); x <= Math.min(width - 1, Math.ceil(proposal.x + proposal.radius * .9)); x++) {
    if (!mask[y * width + x]) continue;
    const normalized = ((x - proposal.x) / proposal.radius) ** 2 + ((y - proposal.y) / proposal.radius) ** 2;
    if (normalized > .9) continue;
    const score = Math.abs(normalized - .6);
    if (score < startScore) { start = y * width + x; startScore = score; }
  }
  if (start < 0) return null;
  const stack = [start]; seen[start] = 1; let count = 0, left = width, right = 0, top = height, bottom = 0;
  while (stack.length) {
    const node = stack.pop()!, x = node % width, y = Math.floor(node / width); count++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    for (const [nextX, nextY] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
      const next = nextY * width + nextX;
      if (mask[next] && !seen[next]) { seen[next] = 1; stack.push(next); }
    }
  }
  const spanX = right - left, spanY = bottom - top, fill = count / ((spanX + 1) * (spanY + 1));
  if (left < 1 || top < 1 || right >= width - 2 || bottom >= height - 2 || Math.min(spanX, spanY) < Math.min(width, height) * .16 || Math.max(spanX / spanY, spanY / spanX) > 1.85 || fill < .50 || fill > .88) return null;
  const refined = { x: (left + right) / 2, y: (top + bottom) / 2, radiusX: spanX / 2, radiusY: spanY / 2 };
  const centerDistance = Math.hypot(refined.x - proposal.x, refined.y - proposal.y), agreement = Math.max(3, proposal.radius * .16);
  if (centerDistance > agreement || refined.radiusX < proposal.radius * .75 || refined.radiusY < proposal.radius * .75 || refined.radiusX > proposal.radius * 1.35 || refined.radiusY > proposal.radius * 1.35) return null;
  return refined;
}

export function refineDiscCircle(data: Uint8ClampedArray, width: number, height: number, circle: DiscCircle): DiscCircle {
  const refined = refineSupportedComponent(data, width, height, circle);
  return refined ? { ...circle, x: refined.x, y: refined.y, radius: Math.max(refined.radiusX, refined.radiusY) } : circle;
}

export function mapWorkingCircleToSource(circle: DiscCircle, workingWidth: number, workingHeight: number, sourceWidth: number, sourceHeight: number): DiscCircle {
  const scaleX = sourceWidth / workingWidth, scaleY = sourceHeight / workingHeight;
  if (![scaleX, scaleY, circle.x, circle.y, circle.radius].every(Number.isFinite) || scaleX <= 0 || scaleY <= 0) throw Error('Circle fit needs finite raster dimensions.');
  return { ...circle, x: (circle.x + .5) * scaleX - .5, y: (circle.y + .5) * scaleY - .5, radius: circle.radius * (scaleX + scaleY) / 2 };
}

export function ensureCircleFitCalculations(pxc: any, helpers: CircleCropHelpers) {
  const names = new Set(pxc.entries().map(([address]: [string, unknown]) => address));
  if (!names.has('oc.studio.circleFit')) pxc.set('oc.studio.circleFit', new Part(({ photo }: { photo: { working: Raster; source: Raster } }) => {
    const coarse = detectDiscCircle(photo.working.rgba, photo.working.width, photo.working.height);
    if (!coarse) return Object.freeze({ schema: 'CircleFitEvidence@1', status: 'abstained', circle: null, reason: 'no-supported-ring' });
    const mapped = mapWorkingCircleToSource(coarse, photo.working.width, photo.working.height, photo.source.width, photo.source.height);
    const circle = refineDiscCircle(photo.source.rgba, photo.source.width, photo.source.height, mapped);
    return Object.freeze({ schema: 'CircleFitEvidence@1', status: 'accepted', detector: 'detectDiscCircle + refineDiscCircle', circle });
  }));
  if (!names.has('fn.studio.circleCropProposal')) pxc.set('fn.studio.circleCropProposal', new Part(({ photo, evidence }: any) => {
    if (evidence.status !== 'accepted' || !evidence.circle) return Object.freeze({ schema: 'CircleCropProposal@1', status: 'abstained', crop: null, reason: evidence.reason ?? 'no-supported-ring' });
    const crop = helpers.clampCropSelection(photo.source.width, photo.source.height, cropForSourceSamples(photo.source.width, photo.source.height, evidence.circle));
    return Object.freeze({ schema: 'CircleCropProposal@1', status: 'accepted', crop, circle: evidence.circle });
  }));
}

/** Register the transient circle-choice calculations without retaining a new photo raster per round. */
export function ensureCircleCandidateCalculations(pxc: any, helpers: CircleCropHelpers) {
  ensureCircleFitCalculations(pxc, helpers);
  const names = new Set(pxc.entries().map(([address]: [string, unknown]) => address));
  if (!names.has('oc.studio.circleCandidates')) pxc.set('oc.studio.circleCandidates', new Part(async ({ photo, request }: { photo: { working: Raster; source: Raster }; request: CircleCandidateRequest }) => {
    const candidates = await import('./circle-candidates.ts');
    const operation = request?.operation;
    const rows = operation === 'refine' && request.selected
      ? candidates.refineCircleCandidates(photo.source, request.selected)
      : operation === 'other'
        ? candidates.findOtherCircleCandidates(photo.working, photo.source, request.excluded ?? [])
        : operation === 'initial'
          ? candidates.findInitialCircleCandidates(photo.working, photo.source)
          : [];
    return Object.freeze({ schema: 'CircleCandidates@1', status: rows.length ? 'accepted' : 'abstained', operation, candidates: rows, reason: rows.length ? null : 'no-distinct-supported-circles' });
  }));
  if (!names.has('oc.studio.opposingRimFit')) pxc.set('oc.studio.opposingRimFit', new Part(async ({ photo, evidence }: any) => {
    const { fitOpposingRim } = await import('./exp/opposing-rim-fit.ts');
    return fitOpposingRim(photo.source, evidence.candidates?.[0]);
  }));
  if (!names.has('oc.studio.ellipseRimFit')) pxc.set('oc.studio.ellipseRimFit', new Part(async ({ photo, evidence, rimFit }: any) => {
    const { fitEllipseRim } = await import('./exp/ellipse-rim-fit.ts');
    return fitEllipseRim(photo.source, evidence.candidates?.[0], rimFit);
  }));
  if (!names.has('fn.studio.circleCandidateCrops')) pxc.set('fn.studio.circleCandidateCrops', new Part(({ photo, evidence, rimFit, ellipseFit }: any) => {
    if (evidence.status !== 'accepted') return Object.freeze({ schema: 'CircleCandidateCrops@1', status: 'abstained', candidates: [], reason: evidence.reason });
    const rows = [...evidence.candidates];
    // This is a sibling derivation of the selected semantic circle. Keep the
    // selected choice and supported small trim; spend the remaining slot on
    // the independently fitted outer rim only when the geometric evidence is
    // supported around the entire circumference.
    if (evidence.operation === 'refine' && rimFit?.status === 'accepted' && rimFit.candidate) {
      if (rows.length < 3) rows.push(rimFit.candidate);
      else rows[2] = rimFit.candidate;
    }
    if (evidence.operation === 'refine' && ellipseFit?.status === 'accepted' && ellipseFit.candidate) {
      if (rows.length < 3) rows.push(ellipseFit.candidate);
      else rows[2] = ellipseFit.candidate;
    }
    const candidates = rows.map((entry: CircleCandidate) => Object.freeze({ ...entry, crop: helpers.clampCropSelection(photo.source.width, photo.source.height, cropForSourceSamples(photo.source.width, photo.source.height, entry.ellipse ?? entry.circle)) }));
    return Object.freeze({ schema: 'CircleCandidateCrops@1', status: 'accepted', candidates, ...(rimFit ? { rimFit: { status: rimFit.status, reason: rimFit.reason ?? null, selected: rimFit.selected ?? null } } : {}), ...(ellipseFit ? { ellipseFit: { status: ellipseFit.status, reason: ellipseFit.reason ?? null, ellipse: ellipseFit.ellipse ?? null } } : {}) });
  }));
}

/** Create one full-resolution transient photo Part for this upload. Subsequent rounds reuse it. */
export function createCircleCandidateSession(pxc: any, source: CanvasImageSource, sourceWidth: number, sourceHeight: number, working: HTMLCanvasElement, serial: number, helpers: CircleCropHelpers): CircleCandidateSession {
  ensureCircleCandidateCalculations(pxc, helpers);
  const workingContext = working.getContext('2d', { willReadFrequently: true }); if (!workingContext) throw Error('Circle-choice working raster is unavailable.');
  const full = document.createElement('canvas'); full.width = sourceWidth; full.height = sourceHeight;
  const fullContext = full.getContext('2d', { willReadFrequently: true }); if (!fullContext) throw Error('Circle-choice source raster is unavailable.');
  fullContext.drawImage(source, 0, 0, sourceWidth, sourceHeight);
  const photoIntake = `ds.px.PhotoIntake.circlefit.${serial}`;
  const photo = Object.freeze({ schema: 'PhotoRaster@1', working: { width: working.width, height: working.height, rgba: workingContext.getImageData(0, 0, working.width, working.height).data }, source: { width: sourceWidth, height: sourceHeight, rgba: fullContext.getImageData(0, 0, sourceWidth, sourceHeight).data } });
  pxc.set(photoIntake, new Part(photo));
  full.width = 0; full.height = 0;
  return Object.freeze({ photoIntake, serial });
}

/** Compose a small round request against the upload's retained transient raster. */
export async function composeCircleCandidateChoices(pxc: any, session: CircleCandidateSession, serial: number, request: CircleCandidateRequest) {
  const requestPart = `ds.px.CircleCandidateRequest.circlefit.${session.serial}.${serial}`, candidates = `ds.px.CircleCandidates.circlefit.${session.serial}.${serial}`, cropChoices = `ds.px.CircleCandidateCrops.circlefit.${session.serial}.${serial}`;
  pxc.set(requestPart, new Part(Object.freeze({ operation: request.operation, ...(request.selected ? { selected: request.selected } : {}), ...(request.excluded?.length ? { excluded: [...request.excluded] } : {}), ...(request.rimFit ? { rimFit: true } : {}) })));
  await pxc.compose({ into: candidates, calculation: 'oc.studio.circleCandidates', inputs: { photo: session.photoIntake, request: requestPart } });
  const rimFit = request.operation === 'refine' && request.rimFit && pxc.get(candidates).value.status === 'accepted'
    ? `ds.px.OpposingRimFit.circlefit.${session.serial}.${serial}` : null;
  if (rimFit) await pxc.compose({ into: rimFit, calculation: 'oc.studio.opposingRimFit', inputs: { photo: session.photoIntake, evidence: candidates } });
  const ellipseFit = rimFit ? `ds.px.EllipseRimFit.circlefit.${session.serial}.${serial}` : null;
  if (ellipseFit) await pxc.compose({ into: ellipseFit, calculation: 'oc.studio.ellipseRimFit', inputs: { photo: session.photoIntake, evidence: candidates, rimFit } });
  await pxc.compose({ into: cropChoices, calculation: 'fn.studio.circleCandidateCrops', inputs: { photo: session.photoIntake, evidence: candidates, ...(rimFit ? { rimFit } : {}), ...(ellipseFit ? { ellipseFit } : {}) } });
  return { requestPart, candidates, rimFit, ellipseFit, cropChoices, evidence: pxc.get(candidates).value, proposal: pxc.get(cropChoices).value };
}

export async function composeCircleFitCrop(pxc: any, source: CanvasImageSource, sourceWidth: number, sourceHeight: number, working: HTMLCanvasElement, serial: number, helpers: CircleCropHelpers) {
  ensureCircleFitCalculations(pxc, helpers);
  const workingContext = working.getContext('2d', { willReadFrequently: true }); if (!workingContext) throw Error('Circle-fit working raster is unavailable.');
  const full = document.createElement('canvas'); full.width = sourceWidth; full.height = sourceHeight;
  const fullContext = full.getContext('2d', { willReadFrequently: true }); if (!fullContext) throw Error('Circle-fit source raster is unavailable.');
  fullContext.drawImage(source, 0, 0, sourceWidth, sourceHeight);
  const photoIntake = `ds.px.PhotoIntake.circlefit.${serial}`, circleFit = `ds.px.CircleFit.circlefit.${serial}`, cropEdit = `ds.px.CropEdit.circlefit.${serial}`;
  const photo = Object.freeze({ schema: 'PhotoRaster@1', working: { width: working.width, height: working.height, rgba: workingContext.getImageData(0, 0, working.width, working.height).data }, source: { width: sourceWidth, height: sourceHeight, rgba: fullContext.getImageData(0, 0, sourceWidth, sourceHeight).data } });
  pxc.set(photoIntake, new Part(photo));
  await pxc.compose({ into: circleFit, calculation: 'oc.studio.circleFit', inputs: { photo: photoIntake } });
  await pxc.compose({ into: cropEdit, calculation: 'fn.studio.circleCropProposal', inputs: { photo: photoIntake, evidence: circleFit } });
  full.width = 0; full.height = 0;
  return { photoIntake, circleFit, cropEdit, evidence: pxc.get(circleFit).value, proposal: pxc.get(cropEdit).value };
}
