import { initialDraft, flightFields, type Draft, type Depiction, type createExperience } from './model.ts';
import { plasticGuides } from './plastics.ts';
import { createDiscView } from './disc-view.ts';
import { recipeFromDraft, validatePaintRecipe, renderDepiction } from './paint-recipe.ts';
import { fuzzyMoldOptions } from './mold-search.ts';
import { cropForSourceSamples, drawRotatedCrop, normalizeCropRotation } from './crop-geometry.ts';
import { composeCircleCandidateChoices, createCircleCandidateSession, type CircleCandidate, type CircleCandidateSession, type DiscCircle } from './circle-fit.ts';
export { detectDiscCircle } from './circle-fit.ts';
export type { CircleCandidate, DiscCircle } from './circle-fit.ts';

export type PhotoCrop = { centerX: number; centerY: number; radiusX: number; radiusY: number; rotation: number };

export const cropZoomNudges = [-10, -5, -3, -1, 1, 3, 5, 10] as const;
const minCropRadiusRatio = .03;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
function validDimensions(width: number, height: number) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw Error('Photo dimensions must be positive.');
}

/** Selection center and ellipse radii are normalized independently to source width/height. */
export function clampCropSelection(width: number, height: number, crop: PhotoCrop): PhotoCrop {
  validDimensions(width, height);
  const minimum = minCropRadiusRatio, rotation = normalizeCropRotation(crop?.rotation);
  const rawRadiusX = Math.max(minimum, Number.isFinite(crop?.radiusX) ? crop.radiusX : .4);
  const rawRadiusY = Math.max(minimum, Number.isFinite(crop?.radiusY) ? crop.radiusY : .4);
  // Fit the rotated ellipse itself, rather than incorrectly clipping axes to .5.
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const halfX = Math.hypot(rawRadiusX * cos, rawRadiusY * sin), halfY = Math.hypot(rawRadiusX * sin, rawRadiusY * cos);
  const scale = Math.min(1, .5 / halfX, .5 / halfY);
  const radiusX = rawRadiusX * scale, radiusY = rawRadiusY * scale;
  const boundedHalfX = halfX * scale, boundedHalfY = halfY * scale;
  const centerX = clamp(Number.isFinite(crop?.centerX) ? crop.centerX : .5, boundedHalfX, 1 - boundedHalfX);
  const centerY = clamp(Number.isFinite(crop?.centerY) ? crop.centerY : .5, boundedHalfY, 1 - boundedHalfY);
  return { centerX, centerY, radiusX, radiusY, rotation };
}

export function cropForDetectedCircle(width: number, height: number, circle: DiscCircle): PhotoCrop {
  return clampCropSelection(width, height, cropForSourceSamples(width, height, circle));
}

export function resizeCrop(width: number, height: number, crop: PhotoCrop, deltaPercent: number): PhotoCrop {
  if (!cropZoomNudges.includes(deltaPercent as typeof cropZoomNudges[number])) throw Error('Unsupported crop selection nudge.');
  const bounded = clampCropSelection(width, height, crop);
  const radiusDelta = deltaPercent / 200;
  return clampCropSelection(width, height, { ...bounded, radiusX: bounded.radiusX + radiusDelta, radiusY: bounded.radiusY + radiusDelta });
}

/** Active creator aperture: one source-pixel radius, zero rotation. */
export function clampCircleCropSelection(width: number, height: number, crop: PhotoCrop): PhotoCrop {
  validDimensions(width, height);
  const minRadius = minCropRadiusRatio * Math.min(width, height);
  const xRadius = Number.isFinite(crop?.radiusX) ? crop.radiusX * width : NaN;
  const yRadius = Number.isFinite(crop?.radiusY) ? crop.radiusY * height : NaN;
  const radius = clamp(Math.max(Number.isFinite(xRadius) ? xRadius : 0, Number.isFinite(yRadius) ? yRadius : 0, minRadius), minRadius, Math.min(width, height) / 2);
  const centerX = clamp(Number.isFinite(crop?.centerX) ? crop.centerX * width : width / 2, radius, width - radius);
  const centerY = clamp(Number.isFinite(crop?.centerY) ? crop.centerY * height : height / 2, radius, height - radius);
  return { centerX: centerX / width, centerY: centerY / height, radiusX: radius / width, radiusY: radius / height, rotation: 0 };
}

/** Cap a manual resize at the current center, never translating the photo. */
export function resizeCircleAtFixedCenter(width: number, height: number, crop: PhotoCrop, requestedRadius: number): PhotoCrop {
  if (!Number.isFinite(requestedRadius)) throw Error('Circle resize needs a finite radius.');
  const bounded = clampCircleCropSelection(width, height, crop), centerX = bounded.centerX * width, centerY = bounded.centerY * height;
  const minRadius = minCropRadiusRatio * Math.min(width, height), maxRadius = Math.min(centerX, width - centerX, centerY, height - centerY);
  const radius = clamp(requestedRadius, minRadius, maxRadius);
  return { centerX: bounded.centerX, centerY: bounded.centerY, radiusX: radius / width, radiusY: radius / height, rotation: 0 };
}

export function resizeCircleCrop(width: number, height: number, crop: PhotoCrop, deltaPercent: number): PhotoCrop {
  if (!cropZoomNudges.includes(deltaPercent as typeof cropZoomNudges[number])) throw Error('Unsupported crop selection nudge.');
  const bounded = clampCircleCropSelection(width, height, crop), radius = bounded.radiusX * width + Math.min(width, height) * deltaPercent / 200;
  return resizeCircleAtFixedCenter(width, height, bounded, radius);
}

/** Move the source photo beneath the fixed preview aperture. */
export function panCircleCrop(width: number, height: number, crop: PhotoCrop, sourceDeltaX: number, sourceDeltaY: number): PhotoCrop {
  if (![sourceDeltaX, sourceDeltaY].every(Number.isFinite)) throw Error('Photo pan needs finite source movement.');
  const bounded = clampCircleCropSelection(width, height, crop);
  return clampCircleCropSelection(width, height, { ...bounded, centerX: bounded.centerX - sourceDeltaX / width, centerY: bounded.centerY - sourceDeltaY / height });
}

/** Resize from a captured screen-space delta; zero movement never changes size. */
export function resizeCircleCropByScreenDelta(width: number, height: number, crop: PhotoCrop, screenDelta: number, sourceToScreenScale: number): PhotoCrop {
  if (![screenDelta, sourceToScreenScale].every(Number.isFinite) || sourceToScreenScale <= 0) throw Error('Circle resize needs finite screen geometry.');
  const bounded = clampCircleCropSelection(width, height, crop), radius = bounded.radiusX * width + screenDelta / sourceToScreenScale;
  return resizeCircleAtFixedCenter(width, height, bounded, radius);
}

export function circleCropExportMapping(width: number, height: number, size: number, crop: PhotoCrop) {
  validDimensions(width, height);
  if (!Number.isFinite(size) || size <= 0) throw Error('Output size must be positive.');
  const selection = clampCircleCropSelection(width, height, crop), radius = selection.radiusX * width;
  const centerX = selection.centerX * width, centerY = selection.centerY * height;
  return { sourceX: centerX - radius, sourceY: centerY - radius, sourceWidth: radius * 2, sourceHeight: radius * 2, sourceCenterX: centerX, sourceCenterY: centerY, sourceRadiusX: radius, sourceRadiusY: radius, outputSize: size, rotation: 0, selection };
}

/** Screen geometry for one fixed aperture with a translated source photo. */
export function fixedCirclePreviewGeometry(width: number, height: number, crop: PhotoCrop, size: number) {
  validDimensions(width, height);
  if (!Number.isFinite(size) || size <= 0) throw Error('Preview size must be positive.');
  const selection = clampCircleCropSelection(width, height, crop), placement = sourceImagePlacement(width, height, size), centerX = size / 2, centerY = size / 2;
  return { scale: placement.scale, centerX, centerY, radius: selection.radiusX * width * placement.scale, imageX: centerX - selection.centerX * placement.width, imageY: centerY - selection.centerY * placement.height, imageWidth: placement.width, imageHeight: placement.height };
}

export function sourceImagePlacement(width: number, height: number, size: number) {
  validDimensions(width, height);
  if (!Number.isFinite(size) || size <= 0) throw Error('Preview size must be positive.');
  const scale = Math.min(size / width, size / height);
  return { x: (size - width * scale) / 2, y: (size - height * scale) / 2, width: width * scale, height: height * scale, scale };
}

export function cropExportMapping(width: number, height: number, size: number, crop: PhotoCrop) {
  validDimensions(width, height);
  if (!Number.isFinite(size) || size <= 0) throw Error('Output size must be positive.');
  const selection = clampCropSelection(width, height, crop), radiusX = selection.radiusX * width, radiusY = selection.radiusY * height;
  const centerX = selection.centerX * width, centerY = selection.centerY * height;
  return { sourceX: centerX - radiusX, sourceY: centerY - radiusY, sourceWidth: radiusX * 2, sourceHeight: radiusY * 2, sourceCenterX: centerX, sourceCenterY: centerY, sourceRadiusX: radiusX, sourceRadiusY: radiusY, outputSize: size, rotation: selection.rotation, selection };
}

// No store, persistence, sibling view or app boot is created by importing this module.
export async function mountUpload({ root, experience, onSaved = (_address: string) => {}, random = Math.random }: {
  root: ParentNode; experience: ReturnType<typeof createExperience>; onSaved?: (address: string) => void; random?: () => number;
}) {
const $ = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
const input = (id: string) => $(id) as HTMLInputElement;
const discView = createDiscView(experience);
// A fresh photo-first experience has no draft photo. Keep a valid painter
// fallback only for the local preview; saving remains disabled until a photo
// has been cropped and retained.
let painting: Depiction = { kind: 'painted', name: 'pressed-fern', src: './art/pressed-fern.svg' };
let depiction: Depiction = painting, photo: Depiction | null = null;
let savedPhotoConsumed = false;
function photoDraftView(image: Depiction) {
  const figure = document.createElement('figure');
  const art = document.createElement('div'); art.className = 'disc-art photo-art';
  const img = document.createElement('img'); img.src = image.src; img.alt = 'Prepared photo of your disc'; art.append(img);
  const title = document.createElement('h3'); title.textContent = 'Photo ready';
  const note = document.createElement('p'); note.textContent = 'Select a manufacturer and mold.';
  figure.append(title, art, note); return figure;
}
function nextUploadView() {
  const figure = document.createElement('figure');
  const title = document.createElement('h3'); title.textContent = 'Add another disc';
  const note = document.createElement('p'); note.textContent = 'Added to Today’s Bag.';
  figure.append(title, note); return figure;
}
function resetPaintSeed() { input('paint-seed').value = String(recipeFromDraft(initialDraft(), painting).seed); }
function recipe(material: Draft) {
  if (!input('paint-seed').value.trim()) throw Error('Enter a painting seed.');
  const selected = experience.seedAt(material.mold);
  const label = input('customize-label').checked ? (input('paint-label').value.trim() || `${selected.manufacturer} · ${selected.name}`) : null;
  return validatePaintRecipe({ ...recipeFromDraft(material, painting), seed: Number(input('paint-seed').value), label });
}
let photoBusy = false;
const defaults = initialDraft();
type SeedOption = ReturnType<typeof experience.seedOptions>[number];
const seedLabel = ({ seed }: SeedOption) => `${seed.manufacturer} · ${seed.name}`;
let visibleSeeds: SeedOption[] = [], activeSeed = -1;
let selectionSerial = 0;
function eligibleSeeds(query = '') { return experience.seedOptions(query); }
function closeSeedChoices() {
  $('mold-options').hidden = true; input('mold-search').setAttribute('aria-expanded', 'false'); input('mold-search').removeAttribute('aria-activedescendant'); activeSeed = -1;
}
function renderSeedChoices(query = input('mold-search').value) {
  // Ask the catalog index for this query before fuzzy ranking it; caching the
  // first 20 rows would make most of the catalog impossible to reach.
  visibleSeeds = fuzzyMoldOptions(eligibleSeeds(query), query, seedLabel);
  $('mold-options').replaceChildren(...visibleSeeds.map((row, index) => {
    const option = document.createElement('div'); option.id = `mold-option-${index}`; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false'); option.textContent = seedLabel(row);
    option.addEventListener('pointerdown', event => { event.preventDefault(); chooseSeed(row); }); return option;
  }));
  $('mold-options').hidden = visibleSeeds.length === 0; input('mold-search').setAttribute('aria-expanded', String(visibleSeeds.length > 0)); activeSeed = -1;
}
async function chooseSeed(row: SeedOption) {
  const token = ++selectionSerial;
  // Load catalog facts before committing the address, so the crop, metadata,
  // card renderer, and retained bag all start from the same mold values.
  const hydrated = await experience.hydrateSeed(row.address);
  if (token !== selectionSerial) return;
  input('seed').value = hydrated.address; input('mold-search').value = seedLabel({ ...row, seed: hydrated.seed }); closeSeedChoices(); suggestPlastics();
  const next = photo ? await experience.selectDraftDepiction(random) : painting;
  // Photo-first: a draft photo wins over a fresh painting. `painting` must stay
  // painted because recipeFromDraft throws otherwise. A photo Part from a
  // previous (already saved) draft is stale, so only take the photo when the
  // in-memory draft photo agrees with it.
  if (next.kind === 'painted') { painting = next; depiction = next; }
  else if (photo && next.src === photo.src) depiction = next;
  resetPaintSeed(); preview();
}
// Start with an honest empty composer. The mold input is the first decision;
// no catalog item or plastic should be implied before the user chooses one.
input('mold-search').value = '';
input('seed').value = '';
const overrides = document.createElement('details');
overrides.innerHTML = '<summary>Override flight numbers</summary><p>Use catalog values unless overridden. Leave an override blank if unknown.</p>' + flightFields.map(field => `<label><span><input id="own-${field}" type="checkbox"> Override ${field}</span><input id="disc-${field}" aria-label="Disc ${field}" type="number" step="any" disabled></label>`).join('');
$('flight').after(overrides);
for (const field of flightFields) input(`own-${field}`).addEventListener('change', () => { input(`disc-${field}`).disabled = !input(`own-${field}`).checked; });
function draft(): Draft {
  const mold = input('seed').value;
  return { mold, nickname: mold ? experience.seedAt(mold).name : '', plastic: input('plastic').value.trim(), weight: input('weight').value === '' ? null : Number(input('weight').value), Color1: input('Color1').value, Color2: input('Color2').value, paintMode: input('paint-mode').value as Draft['paintMode'], colorPainting: input('color-painting').checked,
    ...Object.fromEntries(flightFields.filter(field => input(`own-${field}`).checked).map(field => [field, input(`disc-${field}`).value === '' ? null : Number(input(`disc-${field}`).value)])) };
}
function preview() {
 try {
  syncDepictionControls();
  const material = draft();
  if (savedPhotoConsumed && !photo) {
   $('flight').textContent = ''; $('depiction-name').textContent = '';
   $('preview').replaceChildren(nextUploadView());
   input('photo').disabled = photoBusy; input('save').disabled = true;
   return;
  }
  if (!material.mold) {
   $('flight').textContent = '';
   $('depiction-name').textContent = photo ? photo.name : '';
   $('preview').replaceChildren(...(photo ? [photoDraftView(photo)] : savedPhotoConsumed ? [nextUploadView()] : []));
   input('plastic').disabled = true;
   input('photo').disabled = photoBusy;
   input('save').disabled = true;
   return;
  }
  const resolved = experience.resolve(material);
  input('photo').disabled = photoBusy;
  $('flight').textContent = `FLIGHT  ${flightFields.map(field => resolved[field] ?? '?').join(' / ')}`;
  for (const field of flightFields) input(`disc-${field}`).placeholder = String(experience.seedAt(material.mold)[field] ?? 'Unknown');
  $('depiction-name').textContent = depiction.name.replaceAll('-', ' ');
  input('color-painting').disabled = depiction.kind === 'photo';
  $('paint-help').textContent = depiction.kind === 'photo' ? 'Photos stay untouched; mode changes the backing only.' : '50/50 swaps palettes across the disc. Halo blends center into rim.';
  const customizeLabel = input('customize-label').checked;
  $('paint-label-controls').hidden = !customizeLabel; input('customize-label').setAttribute('aria-expanded', String(customizeLabel));
  (input('depiction-choice') as unknown as HTMLSelectElement).querySelector<HTMLOptionElement>('option[value="photo"]')!.disabled = !photo;
  input('depiction-choice').value = depiction.kind;
  const art = renderDepiction({ recipe: recipe(material), photo, choice: depiction.kind, seed: experience.seedAt(material.mold) });
  const view=discView(material, depiction, art); $('preview').replaceChildren(view); applyFinishPreview();
 } catch (error) { $('status').textContent = String(error); }
}
$('composer').addEventListener('input', event => { const id=(event.target as HTMLElement).id; if (event.target !== $('depiction-choice') && !finishIds.includes(id)) preview(); });
function suggestPlastics() {
  if (!input('seed').value) {
   input('plastic').replaceChildren(new Option('Choose a mold first', ''));
   input('plastic').value = '';
   input('plastic').disabled = true;
   input('save').disabled = true;
   ($('plastic-source') as HTMLAnchorElement).hidden = true;
   return;
  }
  const seed = experience.seedAt(input('seed').value);
  const guide = plasticGuides[seed.manufacturer] ?? { values: [], source: '' };
  const preferred = input('plastic').value;
  const unavailable = guide.values.length === 0;
  // A guide is a suggestion, not a gate: tournament players can retain an
  // explicit unknown blend when the manufacturer is not in the small guide.
  const choices = unavailable ? ['', 'Unknown / not listed'] : ['', ...guide.values];
  input('plastic').replaceChildren(...choices.map(value => { const option = document.createElement('option'); option.value = value; option.textContent = value || 'Not specified'; return option; }));
  input('plastic').value = choices.includes(preferred) ? preferred : '';
  input('plastic').disabled = false;
  updateSaveState();
  const link = $('plastic-source') as HTMLAnchorElement; link.href = guide.source; link.textContent = `${seed.manufacturer} plastic guide`; link.hidden = !guide.source;
}
function updateSaveState() {
 input('save').disabled = photoBusy || !photo || input('plastic').disabled || !input('seed').value;
}
['change', 'input'].forEach(event => input('plastic').addEventListener(event, updateSaveState));
input('mold-search').addEventListener('focus', () => renderSeedChoices(''));
input('mold-search').addEventListener('input', () => {
  selectionSerial++;
  input('seed').value = '';
  // Typing is exploratory even when it happens to equal a catalog label;
  // commitment only occurs through an option click or keyboard Enter.
  suggestPlastics(); renderSeedChoices(); preview();
});
input('mold-search').addEventListener('keydown', event => {
  if (event.key === 'Escape') { closeSeedChoices(); return; }
  if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
  if (!visibleSeeds.length) return;
  if (event.key === 'Enter' && activeSeed < 0 && visibleSeeds.length === 1) activeSeed = 0;
  else if (event.key === 'ArrowDown') activeSeed = (activeSeed + 1) % visibleSeeds.length;
  else if (event.key === 'ArrowUp') activeSeed = (activeSeed - 1 + visibleSeeds.length) % visibleSeeds.length;
  if (event.key === 'Enter' && activeSeed >= 0) { event.preventDefault(); chooseSeed(visibleSeeds[activeSeed]); return; }
  if (activeSeed >= 0) {
    event.preventDefault(); root.querySelectorAll<HTMLElement>('#mold-options [role="option"]').forEach((option, index) => option.setAttribute('aria-selected', String(index === activeSeed)));
    input('mold-search').setAttribute('aria-activedescendant', `mold-option-${activeSeed}`);
  }
});
input('mold-search').addEventListener('blur', () => { setTimeout(() => { if (!input('seed').value) $('status').textContent = 'Choose a mold from the suggestions.'; closeSeedChoices(); }); });
$('shuffle').addEventListener('click', async () => { const next = await experience.selectDraftDepiction(random); if (next.kind === 'painted') { painting = next; depiction = next; } resetPaintSeed(); preview(); });
$('depiction-choice').addEventListener('change', () => { depiction = input('depiction-choice').value === 'photo' && photo ? photo : painting; preview(); });
const finishIds = ['rim-size', 'underglow', 'stamp-x', 'stamp-y'];
const paintingControls = [...root.querySelectorAll<HTMLElement>('.painting-only')];
function syncDepictionControls() {
  const photoMode = depiction.kind === 'photo';
  root.classList.toggle('photo-mode', photoMode);
  paintingControls.forEach(control => { control.hidden = photoMode; });
  if (photoMode) {
    input('customize-label').checked = false;
    input('customize-label').setAttribute('aria-expanded', 'false');
    $('paint-label-controls').hidden = true;
  }
}
function applyFinishPreview() {
  const view = $('preview').querySelector<HTMLElement>('figure'); if (!view) return;
  const glow = Number(input('underglow').value), painted = depiction.kind !== 'photo';
  view.classList.add('experimental-preview');
  view.style.setProperty('--exp-rim', `${painted ? Number(input('rim-size').value) : 0}px`);
  view.style.setProperty('--exp-glow-blur', `${Math.round(glow * 34)}px`);
  view.style.setProperty('--exp-glow-spread', `${Math.round(glow * 8)}px`);
  view.style.setProperty('--exp-glow-color', `rgba(230,182,110,${(.25 + glow * .65).toFixed(2)})`);
  view.style.setProperty('--exp-x', `${painted ? Number(input('stamp-x').value) * 8 : 0}%`);
  view.style.setProperty('--exp-y', `${painted ? Number(input('stamp-y').value) * 8 : 0}%`);
}
for (const id of finishIds) input(id).addEventListener('input', applyFinishPreview);
type CropSource = { image: CanvasImageSource; width: number; height: number; dispose: () => void };
let cropBitmap: CropSource | null = null; let cropFile: File | null = null; let cropWorking: HTMLCanvasElement | null = null;
let candidateSession: CircleCandidateSession | null = null, candidateChoices: CircleCandidate[] = [], seenCandidates: CircleCandidate[] = [], selectedCandidate: CircleCandidate | null = null, candidateBusy = false;
const cropIds = ['crop-center-x', 'crop-center-y', 'crop-radius-x', 'crop-radius-y'];
let cropRotation = 0;
// Every new photo or crop action supersedes an in-flight circle request.
let circleFitRequest = 0, circleFitSerial = 0, candidateRequest = 0;
function invalidateCircleFit() { circleFitRequest++; candidateRequest++; candidateBusy = false; syncCandidateApply(); }
function cropState(): PhotoCrop { return { centerX: Number(input('crop-center-x').value), centerY: Number(input('crop-center-y').value), radiusX: Number(input('crop-radius-x').value), radiusY: Number(input('crop-radius-y').value), rotation: cropRotation }; }
function setCrop(next: PhotoCrop, { invalidate = true }: { invalidate?: boolean } = {}) {
  if (!cropWorking || !cropBitmap) return;
  if (invalidate) invalidateCircleFit();
  const crop = clampCircleCropSelection(cropBitmap.width, cropBitmap.height, next);
  input('crop-center-x').value = String(crop.centerX); input('crop-center-y').value = String(crop.centerY);
  cropRotation = 0;
  input('crop-radius-x').value = String(crop.radiusX); input('crop-radius-y').value = String(crop.radiusY);
  scheduleCropPreview();
}
function circleLockedCrop(width: number, height: number, ratio = .48): PhotoCrop {
  const radius = Math.min(width, height) * ratio;
  return { centerX:.5, centerY:.5, radiusX:radius / width, radiusY:radius / height, rotation:0 };
}
function resetCrop({ invalidate = true }: { invalidate?: boolean } = {}) { if (cropBitmap) setCrop(circleLockedCrop(cropBitmap.width, cropBitmap.height), { invalidate }); }
type CropView = { scale: number; centerX: number; centerY: number; radius: number; imageX: number; imageY: number; imageWidth: number; imageHeight: number };
function fixedCropView(crop: PhotoCrop, size: number): CropView | null {
  return cropBitmap ? fixedCirclePreviewGeometry(cropBitmap.width, cropBitmap.height, crop, size) : null;
}
type CropGesture = { mode: 'pan' | 'resize'; pointerId: number; startClientX: number; startClientY: number; startPointerRadius: number; crop: PhotoCrop; view: CropView };
let cropGesture: CropGesture | null = null;
const cropStage = $('crop-stage');
const resizeHandle = $('crop-resize-handle') as HTMLButtonElement;
const gestureState = $('crop-gesture-state');
function setGestureState(mode: CropGesture['mode'] | null) {
  cropStage.dataset.mode = mode ?? 'ready';
  gestureState.textContent = mode === 'resize' ? 'Resizing circle' : mode === 'pan' ? 'Panning photo' : 'Circle ready';
}
function drawTransparentGutter(ctx: CanvasRenderingContext2D, size: number) {
  const cell = Math.max(8, Math.round(size / 28));
  for (let y = 0; y < size; y += cell) for (let x = 0; x < size; x += cell) {
    ctx.fillStyle = ((x / cell + y / cell) & 1) ? '#eef0ec' : '#f8f8f5';
    ctx.fillRect(x, y, cell, cell);
  }
}
/** One candidate tap shows the same full circular cutout that Apply prepares. */
function drawCandidateCutoutPreview(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  if (!cropBitmap) return;
  const gutter = Math.max(12, Math.round(canvas.width * .05)), size = canvas.width - gutter * 2;
  drawTransparentGutter(ctx, canvas.width);
  const mapping = circleCropExportMapping(cropBitmap.width, cropBitmap.height, size, cropState());
  ctx.save(); ctx.beginPath(); ctx.ellipse(canvas.width / 2, canvas.height / 2, size / 2, size / 2, 0, 0, Math.PI * 2); ctx.clip();
  ctx.translate(gutter, gutter); drawRotatedCrop(ctx, cropBitmap.image, mapping); ctx.restore();
}
function updateCropPreview() {
  if (!cropWorking || !cropBitmap) return;
  const canvas = $('crop-preview') as HTMLCanvasElement, ctx = canvas.getContext('2d')!, showCandidate = !!selectedCandidate && !manualCrop.open;
  cropStage.dataset.candidate = String(showCandidate);
  if (showCandidate) { drawCandidateCutoutPreview(canvas, ctx); return; }
  const crop = cropState(), view = fixedCropView(crop, canvas.width); if (!view) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#dfe5db'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(cropWorking, view.imageX, view.imageY, view.imageWidth, view.imageHeight);
  const mode = cropGesture?.mode, stroke = mode === 'resize' ? '#d88938' : mode === 'pan' ? '#168a87' : 'rgba(255,255,255,.96)';
  // The source image moves beneath one fixed circular aperture. The whole
  // outline changes only while a captured gesture is active.
  ctx.save(); ctx.fillStyle = 'rgba(18,39,31,.68)'; ctx.beginPath(); ctx.rect(0, 0, canvas.width, canvas.height); ctx.arc(view.centerX, view.centerY, view.radius, 0, Math.PI * 2, true); ctx.fill('evenodd'); ctx.beginPath(); ctx.arc(view.centerX, view.centerY, view.radius, 0, Math.PI * 2); ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(2, canvas.width / 260); ctx.stroke(); ctx.restore();
  cropStage.style.setProperty('--crop-handle-x', `${view.radius / Math.SQRT2 / canvas.width * 100}%`);
  cropStage.style.setProperty('--crop-handle-y', `${view.radius / Math.SQRT2 / canvas.height * 100}%`);
  const circleSize = Math.round(crop.radiusX * cropBitmap.width * 200 / Math.min(cropBitmap.width, cropBitmap.height));
  ($('crop-zoom-value') as HTMLOutputElement).value = `Circle size ${circleSize}%`;
}
const candidatePicker = $('circle-candidate-picker'), candidateList = $('circle-candidates'), candidateHeading = $('circle-candidate-heading'), refineButton = $('crop-refine') as HTMLButtonElement, otherButton = $('crop-other') as HTMLButtonElement, cropApply = $('crop-apply') as HTMLButtonElement;
const manualCrop = $('crop-manual') as HTMLDetailsElement;
function syncCandidateApply() { cropApply.disabled = candidateBusy || !cropBitmap || !cropFile || (!selectedCandidate && !manualCrop.open); }
function syncManualMode() {
  cropStage.dataset.manual = String(manualCrop.open);
  cropStage.dataset.candidate = String(!!selectedCandidate && !manualCrop.open);
  resizeHandle.disabled = !manualCrop.open;
  syncCandidateApply(); requestAnimationFrame(sizeCropStage);
}
function candidateCrop(candidate: CircleCandidate) {
  return cropBitmap ? cropForDetectedCircle(cropBitmap.width, cropBitmap.height, candidate.circle) : null;
}
function drawCandidateThumbnail(canvas: HTMLCanvasElement, candidate: CircleCandidate, selected: boolean) {
  if (!cropWorking || !cropBitmap) return;
  const crop = candidateCrop(candidate); if (!crop) return;
  const context = canvas.getContext('2d')!, view = fixedCirclePreviewGeometry(cropBitmap.width, cropBitmap.height, crop, canvas.width);
  context.clearRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#dfe5db'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(cropWorking, view.imageX, view.imageY, view.imageWidth, view.imageHeight);
  context.save(); context.fillStyle = 'rgba(18,39,31,.58)'; context.beginPath(); context.rect(0, 0, canvas.width, canvas.height); context.arc(view.centerX, view.centerY, view.radius, 0, Math.PI * 2, true); context.fill('evenodd'); context.beginPath(); context.arc(view.centerX, view.centerY, view.radius, 0, Math.PI * 2); context.strokeStyle = selected ? '#168a87' : '#fff'; context.lineWidth = 2; context.stroke(); context.restore();
}
function renderCandidateChoices() {
  candidateList.replaceChildren();
  candidatePicker.hidden = candidateChoices.length === 0;
  candidateHeading.textContent = candidateChoices.length ? 'Pick the closest circle' : 'No circle choices yet';
  const fragment = document.createDocumentFragment();
  candidateChoices.forEach((candidate, index) => {
    const selected = selectedCandidate?.id === candidate.id;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'circle-candidate'; button.setAttribute('aria-pressed', String(selected)); button.setAttribute('aria-label', `Circle ${index + 1}${selected ? ', selected' : ''}`);
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128; canvas.setAttribute('aria-hidden', 'true'); drawCandidateThumbnail(canvas, candidate, selected);
    const label = document.createElement('span'); label.textContent = `Circle ${index + 1}`;
    button.append(canvas, label); button.addEventListener('click', () => chooseCandidate(candidate)); fragment.append(button);
  });
  candidateList.append(fragment); refineButton.disabled = candidateBusy || !selectedCandidate; otherButton.disabled = candidateBusy || candidateChoices.length === 0; syncCandidateApply(); requestAnimationFrame(sizeCropStage);
}
function clearCandidateSelection() { if (!selectedCandidate) return; selectedCandidate = null; renderCandidateChoices(); }
function chooseCandidate(candidate: CircleCandidate) {
  const crop = candidateCrop(candidate); if (!crop) return;
  invalidateCircleFit(); manualCrop.open = false; syncManualMode(); selectedCandidate = candidate; setCrop(crop, { invalidate: false }); renderCandidateChoices();
  $('photo-crop-help').textContent = 'Circle selected. Refine choice stays near it, or use this circle as-is.';
}
function resetCandidateChoices() {
  candidateChoices = []; seenCandidates = []; selectedCandidate = null; renderCandidateChoices();
}
function sameCandidateCircle(a: CircleCandidate, b: CircleCandidate) {
  return a.id === b.id && a.circle.x === b.circle.x && a.circle.y === b.circle.y && a.circle.radius === b.circle.radius && a.circle.confidence === b.circle.confidence;
}
async function loadCircleCandidates(operation: 'initial' | 'refine' | 'other') {
  const session = candidateSession, bitmap = cropBitmap, working = cropWorking, anchor = selectedCandidate;
  if (!session || !bitmap || !working || (operation === 'refine' && !anchor)) return;
  const previousChoices = candidateChoices, previousSelection = selectedCandidate;
  const request = ++candidateRequest;
  if (operation === 'initial') { candidateChoices = []; seenCandidates = []; selectedCandidate = null; manualCrop.open = false; syncManualMode(); }
  candidateBusy = true; renderCandidateChoices(); refineButton.disabled = true; otherButton.disabled = true;
  $('photo-crop-help').textContent = operation === 'refine' ? 'Refining around your selected circle…' : operation === 'other' ? 'Finding other circles…' : 'Finding circle choices…';
  try {
    const result = await composeCircleCandidateChoices(experience.pxc, session, ++circleFitSerial, { operation, ...(operation === 'refine' && anchor ? { selected: anchor } : {}), ...(operation === 'other' ? { excluded: seenCandidates } : {}) });
    if (request !== candidateRequest || session !== candidateSession || bitmap !== cropBitmap || working !== cropWorking) return;
    candidateBusy = false;
    const rows = result.proposal.status === 'accepted' ? result.proposal.candidates as CircleCandidate[] : [];
    if (!rows.length) {
      if (operation === 'other' && previousSelection) {
        candidateChoices = previousChoices; selectedCandidate = previousSelection; renderCandidateChoices();
        $('photo-crop-help').textContent = 'No other supported circles were found. Your selected circle is still ready to use.';
        return;
      }
      candidateChoices = []; selectedCandidate = null; renderCandidateChoices(); manualCrop.open = true; syncManualMode();
      $('photo-crop-help').textContent = 'Could not confirm distinct circles. Adjust manually if needed.';
      return;
    }
    if (operation === 'refine') {
      if (!anchor || !sameCandidateCircle(rows[0], anchor)) throw Error('Refine did not retain the selected circle.');
      selectedCandidate = rows[0];
    }
    candidateChoices = rows;
    if (operation === 'initial' || operation === 'other') { seenCandidates = [...seenCandidates, ...rows]; if (operation === 'other') selectedCandidate = null; }
    renderCandidateChoices();
    $('photo-crop-help').textContent = operation === 'refine' ? 'Your circle is kept first. Choose a nearby alternative only if it looks better.' : 'Pick the closest circle, then refine it if needed.';
  } catch {
    if (request !== candidateRequest || session !== candidateSession) return;
    candidateBusy = false; candidateChoices = previousChoices; selectedCandidate = previousSelection; renderCandidateChoices(); manualCrop.open = true; syncManualMode();
    $('photo-crop-help').textContent = 'Circle choices were unavailable. Adjust manually if needed.';
  }
}
let cropFrame = 0;
function scheduleCropPreview() { if (cropFrame) return; cropFrame = requestAnimationFrame(() => { cropFrame = 0; updateCropPreview(); }); }
function sizeCropStage() {
  if (cropGesture) return;
  cropStage.style.width = ''; cropStage.style.height = '';
  const side = Math.floor(Math.min(cropStage.clientWidth, cropStage.clientHeight));
  if (side > 0) { cropStage.style.width = `${side}px`; cropStage.style.height = `${side}px`; scheduleCropPreview(); }
}
const cropStageResize = new ResizeObserver(sizeCropStage); cropStageResize.observe(cropStage.parentElement!);
function stagePoint(event: PointerEvent) { const rect = cropStage.getBoundingClientRect(); return { x:event.clientX - rect.left, y:event.clientY - rect.top }; }
function currentStageView(crop: PhotoCrop) { const rect = cropStage.getBoundingClientRect(); return fixedCropView(crop, Math.min(rect.width, rect.height)); }
function beginCropGesture(event: PointerEvent, mode: CropGesture['mode']) {
  if (!manualCrop.open || cropGesture || !event.isPrimary || event.button !== 0 || !cropWorking || !cropBitmap) return;
  const crop = cropState(), view = currentStageView(crop); if (!view) return;
  const point = stagePoint(event);
  cropGesture = { mode, pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, startPointerRadius: Math.hypot(point.x - view.centerX, point.y - view.centerY), crop, view };
  invalidateCircleFit(); clearCandidateSelection(); setGestureState(mode); cropStage.setPointerCapture(event.pointerId); scheduleCropPreview(); event.preventDefault();
}
function endCropGesture(event?: PointerEvent) {
  if (!cropGesture || (event && event.pointerId !== cropGesture.pointerId)) return;
  cropGesture = null; setGestureState(null); scheduleCropPreview();
}
resizeHandle.addEventListener('pointerdown', event => { event.stopPropagation(); beginCropGesture(event, 'resize'); });
cropStage.addEventListener('pointerdown', event => beginCropGesture(event, 'pan'));
cropStage.addEventListener('pointermove', event => {
  const gesture = cropGesture; if (!gesture || event.pointerId !== gesture.pointerId || !cropBitmap) return;
  if (gesture.mode === 'pan') {
    const sourceX = (event.clientX - gesture.startClientX) / gesture.view.scale, sourceY = (event.clientY - gesture.startClientY) / gesture.view.scale;
    setCrop(panCircleCrop(cropBitmap.width, cropBitmap.height, gesture.crop, sourceX, sourceY), { invalidate: false });
  } else {
    const point = stagePoint(event), delta = Math.hypot(point.x - gesture.view.centerX, point.y - gesture.view.centerY) - gesture.startPointerRadius;
    setCrop(resizeCircleCropByScreenDelta(cropBitmap.width, cropBitmap.height, gesture.crop, delta, gesture.view.scale), { invalidate: false });
  }
});
for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) cropStage.addEventListener(eventName, event => endCropGesture(event as PointerEvent));
function stepZoom(deltaPercent:number){ if (cropBitmap) { invalidateCircleFit(); clearCandidateSelection(); setCrop(resizeCircleCrop(cropBitmap.width, cropBitmap.height, cropState(), deltaPercent), { invalidate:false }); } }
for (const button of root.querySelectorAll<HTMLButtonElement>('[data-zoom-delta]')) button.addEventListener('click',()=>stepZoom(Number(button.dataset.zoomDelta)));
function startOverCircleChoices() {
  if (!candidateSession || !cropBitmap) return;
  invalidateCircleFit(); resetCrop({ invalidate: false }); loadCircleCandidates('initial');
}
$('crop-auto').addEventListener('click', startOverCircleChoices);
refineButton.addEventListener('click', () => loadCircleCandidates('refine'));
otherButton.addEventListener('click', () => loadCircleCandidates('other'));
manualCrop.addEventListener('toggle', () => { if (manualCrop.open) invalidateCircleFit(); syncManualMode(); }); syncManualMode();
function discardPendingPhoto() {
  endCropGesture(); invalidateCircleFit(); candidateSession = null; resetCandidateChoices(); manualCrop.open = false; syncManualMode();
  if (cropBitmap) cropBitmap.dispose(); cropBitmap = null; cropFile = null; cropWorking = null; input('photo').value = '';
}
async function decodePhoto(file: File): Promise<CropSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { image: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    } catch { /* Safari can decode some camera formats through HTMLImageElement only. */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const candidate = new Image(); candidate.decoding = 'async';
      candidate.onload = () => resolve(candidate); candidate.onerror = () => reject(Error('This browser could not decode that photo. Choose another image or export it as JPEG.'));
      candidate.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw Error('This photo has no usable dimensions.');
    return { image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}
$('photo').addEventListener('change', async () => {
  const file = input('photo').files?.[0]; if (!file) return;
  photoBusy = true; input('photo').disabled = true; input('save').disabled = true; input('shuffle').disabled = true; $('photo-status').textContent = `Preparing ${file.name} on this device…`;
  try {
    if (file.size > 15_000_000) throw Error('Choose a photo under 15 MB. Your prepared photo is unchanged.');
    discardPendingPhoto(); cropFile = file; cropBitmap = await decodePhoto(file);
    const workingScale = Math.min(1, 720 / Math.max(cropBitmap.width, cropBitmap.height)); cropWorking = document.createElement('canvas'); cropWorking.width = Math.max(1, Math.round(cropBitmap.width * workingScale)); cropWorking.height = Math.max(1, Math.round(cropBitmap.height * workingScale)); cropWorking.getContext('2d')!.drawImage(cropBitmap.image,0,0,cropWorking.width,cropWorking.height);
    resetCrop({ invalidate: false }); candidateSession = createCircleCandidateSession(experience.pxc, cropBitmap.image, cropBitmap.width, cropBitmap.height, cropWorking, ++circleFitSerial, { clampCropSelection });
    ($('photo-crop') as HTMLDialogElement).showModal(); requestAnimationFrame(sizeCropStage); $('crop-cancel').focus(); loadCircleCandidates('initial');
  } catch (error) { discardPendingPhoto(); photoBusy = false; input('photo').disabled = false; input('shuffle').disabled = false; const message = `Photo could not open: ${String(error).replace(/^Error: /, '')}`; $('photo-status').textContent = message; $('status').textContent = message; updateSaveState(); }
});
function finishPhotoPreparation() { photoBusy = false; input('photo').disabled = false; input('shuffle').disabled = false; updateSaveState(); }
$('crop-cancel').addEventListener('click', () => { invalidateCircleFit(); ($('photo-crop') as HTMLDialogElement).close(); discardPendingPhoto(); const message = photo ? 'Photo crop cancelled. Your prepared photo is unchanged.' : 'Photo crop cancelled.'; $('photo-status').textContent = message; $('status').textContent = message; finishPhotoPreparation(); });
$('photo-crop').addEventListener('cancel', event => { event.preventDefault(); $('crop-cancel').click(); });
$('photo-crop').addEventListener('close', () => { endCropGesture(); invalidateCircleFit(); });
for (const id of cropIds) input(id).addEventListener('input', scheduleCropPreview);
$('crop-reset').addEventListener('click', () => {
  invalidateCircleFit(); clearCandidateSelection(); resetCrop({ invalidate: false });
  $('photo-crop-help').textContent = 'Circle centered and reset. Drag the photo anywhere to position it, or use the handle to resize.';
});
$('crop-apply').addEventListener('click', async () => {
  if (!cropBitmap || !cropFile || (!selectedCandidate && !manualCrop.open)) return;
  const apply = cropApply; apply.disabled = true;
  try {
    const bitmap = cropBitmap, fileName = cropFile.name, size = Math.min(1024, Math.max(256, Math.min(bitmap.width, bitmap.height)));
    const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
    invalidateCircleFit();
    const ctx = canvas.getContext('2d')!, mapping = circleCropExportMapping(bitmap.width, bitmap.height, size, cropState());
    ctx.save(); ctx.beginPath(); ctx.ellipse(size / 2, size / 2, size / 2, size / 2, 0, 0, Math.PI * 2); ctx.clip(); drawRotatedCrop(ctx, bitmap.image, mapping); ctx.restore();
    const photoDepiction: Depiction = { kind: 'photo', name: fileName, src: canvas.toDataURL('image/webp', .86) };
    await experience.addDraftPhoto(photoDepiction);
    photo = photoDepiction; depiction = photoDepiction; savedPhotoConsumed = false;
    ($('photo-crop') as HTMLDialogElement).close(); discardPendingPhoto(); const message = input('seed').value ? 'Photo ready.' : 'Photo ready. Select a manufacturer and mold.'; $('photo-status').textContent = message; $('status').textContent = message; finishPhotoPreparation(); preview();
  } catch (error) {
    ($('photo-crop') as HTMLDialogElement).close(); discardPendingPhoto(); const message = `Photo could not be kept: ${String(error).replace(/^Error: /, '')}`; $('photo-crop-help').textContent = message; $('photo-status').textContent = message; $('status').textContent = message; finishPhotoPreparation(); preview();
  } finally { syncCandidateApply(); }
});
$('composer').addEventListener('submit', async event => {
  event.preventDefault(); if (photoBusy || input('save').disabled) return;
  input('save').disabled = true;
  try {
    const material = draft();
    const address = await experience.save(material, depiction, { photo });
    onSaved(address);
    const storage = experience.persistenceStatus;
    $('status').textContent = storage.startsWith('Saved in this session archive')
      ? 'Saved to Today’s Bag.'
      : `Added to Today’s Bag. ${storage}`;
    input('photo').value = '';
    for (const field of flightFields) { input(`own-${field}`).checked = false; input(`disc-${field}`).value = ''; input(`disc-${field}`).disabled = true; }
    // The saved photo is consumed by model.save(). A new composition waits
    // for its own crop instead of reusing an older draft-photo Part.
    depiction = painting; photo = null; savedPhotoConsumed = true;
    $('photo-status').textContent = storage.startsWith('Saved in this session archive')
      ? 'Photo saved to Today’s Bag.'
      : 'Photo added for this session only.';
    input('customize-label').checked = false; input('paint-label').value = ''; resetPaintSeed(); preview();
  } catch (error) { $('status').textContent = `Not saved: ${String(error)}`; }
  finally { updateSaveState(); }
});
input('Color1').value = defaults.Color1; input('Color2').value = defaults.Color2; resetPaintSeed(); suggestPlastics(); preview();
return { refresh: preview };
}
