import { anchorForEllipseDrag, makeEllipsePin, boundedEllipseAdjustment } from './refinement-ellipse-adjust.mjs';
import { classifyDotMovement, dotMovementDescription } from './refinement-dot-status.mjs';
import { paintBoundary } from './boundary-paint.mjs';
import { boundaryHandles, supportPoint, refinementPrecisionGain, boundedAnchoredDrag } from './refinement-drag.mjs';
import { createRefinementRenderer } from './refinement-view.mjs';
import { prepareCirclePhoto, prepareEllipsePhoto, validateRefitSource, type RefitSource } from './photo-refit.ts';
import { initialDraft, flightFields, type Draft, type Depiction, type createExperience } from './model.ts';
import { plasticGuides } from './plastics.ts';
import { createDiscView } from './disc-view.ts';
import { recipeFromDraft, validatePaintRecipe, renderDepiction } from './paint-recipe.ts';
import { cropForSourceSamples, drawRotatedCrop, normalizeCropRotation } from './crop-geometry.ts';
import { composeCircleCandidateChoices, createCircleCandidateSession, type CircleCandidate, type CircleCandidateSession, type DiscCircle } from './circle-fit.ts';
import { paintedDiscsEnabled } from './kompozition.ts';
import { sampleDiscs } from './sample-discs.ts';
import { createRimFitWorkerClient } from './rimfit-v3/worker-client.mjs';
import { validateEllipseBounds } from './experimental/ellipse-fit-fix/ellipse-geometry.mjs';
import { runEllipseFitReview } from './experimental/ellipse-fit-fix/ellipse-review-flow.mjs';
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

/** Active creator aperture: one source-pixel radius with independent orientation. */
export function clampCircleCropSelection(width: number, height: number, crop: PhotoCrop): PhotoCrop {
  validDimensions(width, height);
  const minRadius = minCropRadiusRatio * Math.min(width, height);
  const xRadius = Number.isFinite(crop?.radiusX) ? crop.radiusX * width : NaN;
  const yRadius = Number.isFinite(crop?.radiusY) ? crop.radiusY * height : NaN;
  const radius = clamp(Math.max(Number.isFinite(xRadius) ? xRadius : 0, Number.isFinite(yRadius) ? yRadius : 0, minRadius), minRadius, Math.min(width, height) / 2);
  const centerX = clamp(Number.isFinite(crop?.centerX) ? crop.centerX * width : width / 2, radius, width - radius);
  const centerY = clamp(Number.isFinite(crop?.centerY) ? crop.centerY * height : height / 2, radius, height - radius);
  return { centerX: centerX / width, centerY: centerY / height, radiusX: radius / width, radiusY: radius / height, rotation: Number.isFinite(crop.rotation) ? crop.rotation : 0 };
}

/** Cap a manual resize at the current center, never translating the photo. */
export function resizeCircleAtFixedCenter(width: number, height: number, crop: PhotoCrop, requestedRadius: number): PhotoCrop {
  if (!Number.isFinite(requestedRadius)) throw Error('Circle resize needs a finite radius.');
  const bounded = clampCircleCropSelection(width, height, crop), centerX = bounded.centerX * width, centerY = bounded.centerY * height;
  const minRadius = minCropRadiusRatio * Math.min(width, height), maxRadius = Math.min(centerX, width - centerX, centerY, height - centerY);
  const radius = clamp(requestedRadius, minRadius, maxRadius);
  return { centerX: bounded.centerX, centerY: bounded.centerY, radiusX: radius / width, radiusY: radius / height, rotation: bounded.rotation };
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
  return { sourceX: centerX - radius, sourceY: centerY - radius, sourceWidth: radius * 2, sourceHeight: radius * 2, sourceCenterX: centerX, sourceCenterY: centerY, sourceRadiusX: radius, sourceRadiusY: radius, outputSize: size, rotation: selection.rotation, selection };
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
const catalogReady = experience.catalogAvailable;
if (!catalogReady) {
  const notice = document.createElement('p'); notice.className = 'subtle mold-catalog-error'; notice.setAttribute('role', 'alert');
  notice.textContent = 'The mold catalog could not be verified. Mold search and saving are unavailable. Reload DiscStudio to retry.';
  root.querySelector('.workspace')?.prepend(notice);
  $('mold-search-status').textContent = 'Mold catalog unavailable. Reload DiscStudio to retry.';
}
const samplePicker = $('sample-discs');
samplePicker.replaceChildren(...sampleDiscs.map(sample => {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'sample-disc';
  button.dataset.sampleId = sample.id; button.setAttribute('aria-label', `Try ${sample.manufacturer} ${sample.mold} sample photo`);
  const image = document.createElement('img'); image.src = sample.photo; image.alt = '';
  const copy = document.createElement('span'); copy.textContent = `${sample.manufacturer} · ${sample.mold}`;
  button.append(image, copy); return button;
}));
if (!catalogReady) {
  input('mold-search').disabled = true; input('photo').disabled = true;
  input('save').disabled = true; input('shuffle').disabled = true;
  samplePicker.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.disabled = true);
}
function enforceCatalogAvailability() {
  if (catalogReady) return;
  input('mold-search').disabled = true; input('photo').disabled = true;
  input('save').disabled = true; input('shuffle').disabled = true;
  samplePicker.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.disabled = true);
}
// Painting machinery remains available as a solved capability, but the base
// Kompozition is photo-first. The painted-discs overlay binds it back into
// the creator experience without deleting or forking the underlying code.
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
  if (!catalogReady) { visibleSeeds = []; $('mold-options').replaceChildren(); closeSeedChoices(); return; }
  // Query the complete compiled name trie; never prefix-gate a fuzzy ranking
  // or cache only the first source rows.
  try { visibleSeeds = eligibleSeeds(query); }
  catch (error) {
    if (!(error instanceof Error) || error.name !== 'MoldWildcardQueryError') throw error;
    visibleSeeds = []; $('mold-options').replaceChildren(); closeSeedChoices();
    input('mold-search').setAttribute('aria-invalid', 'true'); input('save').disabled = true;
    $('mold-search-status').textContent = 'Adjacent * characters are invalid inside a query. A trailing run is treated as a prefix.';
    $('status').textContent = 'Use one * for one character; adjacent * characters are only valid at the end.';
    return;
  }
  input('mold-search').removeAttribute('aria-invalid');
  $('mold-search-status').textContent = visibleSeeds.length ? `${visibleSeeds.length} matching mold names. Choose one.` : 'No matching mold names.';
  $('mold-options').replaceChildren(...visibleSeeds.map((row, index) => {
    const option = document.createElement('div'); option.id = `mold-option-${index}`; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false'); option.textContent = seedLabel(row);
    option.addEventListener('pointerdown', event => { event.preventDefault(); chooseSeed(row); }); return option;
  }));
  $('mold-options').hidden = visibleSeeds.length === 0; input('mold-search').setAttribute('aria-expanded', String(visibleSeeds.length > 0)); activeSeed = -1;
}
async function chooseSeed(row: SeedOption) {
  if (!catalogReady) return;
  const token = ++selectionSerial;
  // Load catalog facts before committing the address, so the crop, metadata,
  // card renderer, and retained bag all start from the same mold values.
  const hydrated = await experience.hydrateSeed(row.address);
  if (token !== selectionSerial) return;
  input('seed').value = hydrated.address; input('mold-search').value = seedLabel({ ...row, seed: hydrated.seed }); closeSeedChoices(); suggestPlastics();
  if (photo) { $('photo-status').textContent = 'Photo ready.'; $('status').textContent = 'Photo ready.'; }
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
  return { mold, nickname: mold ? experience.seedAt(mold).name : '', plastic: input('plastic').value.trim(), weight: null, Color1: input('Color1').value, Color2: input('Color2').value, paintMode: input('paint-mode').value as Draft['paintMode'], colorPainting: input('color-painting').checked,
    ...Object.fromEntries(flightFields.filter(field => input(`own-${field}`).checked).map(field => [field, input(`disc-${field}`).value === '' ? null : Number(input(`disc-${field}`).value)])) };
}
function preview() {
 try {
  $('photo-recrop').hidden = !photo; ( $('photo-recrop') as HTMLButtonElement).disabled = photoBusy;
  syncDepictionControls();
  const material = draft();
  if (material.mold) {
    const effective = experience.resolve(material);
    $('flight').textContent = `FLIGHT  ${flightFields.map(field => effective[field] ?? '?').join(' / ')}`;
    for (const field of flightFields) input(`disc-${field}`).placeholder = String(experience.seedAt(material.mold)[field] ?? 'Unknown');
  } else $('flight').textContent = '';
  if (!paintedDiscsEnabled && !photo && material.mold) {
   $('depiction-name').textContent = '';
   $('preview').replaceChildren();
   $('status').textContent = 'Add a photo to continue.';
   input('plastic').disabled = false; input('photo').disabled = photoBusy; input('save').disabled = true;
   return;
  }
  if (savedPhotoConsumed && !photo && !paintedDiscsEnabled) {
   $('depiction-name').textContent = '';
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
 finally { enforceCatalogAvailability(); }
}
$('composer').addEventListener('input', event => { const id=(event.target as HTMLElement).id; if (event.target !== $('depiction-choice') && !finishIds.includes(id)) preview(); });
function suggestPlastics() {
  const list = $('plastic-options');
  if (!input('seed').value) {
   list.replaceChildren();
   input('plastic').value = '';
   input('plastic').placeholder = 'Choose a mold first';
   input('plastic').disabled = true;
   input('save').disabled = true;
   ($('plastic-source') as HTMLAnchorElement).hidden = true;
   return;
  }
  const seed = experience.seedAt(input('seed').value);
  const guide = plasticGuides[seed.manufacturer] ?? { values: [], source: '' };
  // The plastic box is free text: whatever the player types is kept and printed on the card. The manufacturer's
  // guide only fills the suggestions. A suggestion from a different manufacturer's guide is cleared when the mold
  // changes; anything typed by hand stays.
  const choices = [...guide.values.filter(value => value !== 'Unknown / not listed'), 'Unknown / not listed'];
  list.replaceChildren(...choices.map(value => new Option(value, value)));
  const preferred = input('plastic').value.trim();
  const fromAnotherGuide = Object.values(plasticGuides).some(other => other.values.includes(preferred)) && !choices.includes(preferred);
  if (fromAnotherGuide) input('plastic').value = '';
  input('plastic').placeholder = guide.values.length ? `${seed.manufacturer} plastic, or type your own` : 'Type the plastic (optional)';
  input('plastic').disabled = false;
  updateSaveState();
  const link = $('plastic-source') as HTMLAnchorElement; link.href = guide.source; link.textContent = `${seed.manufacturer} plastic guide`; link.hidden = !guide.source;
}
function updateSaveState() {
 if (!catalogReady) { input('save').disabled = true; return; }
 input('save').disabled = photoBusy || (!photo && !(paintedDiscsEnabled && depiction.kind === 'painted')) || input('plastic').disabled || !input('seed').value;
}
['change', 'input'].forEach(event => input('plastic').addEventListener(event, updateSaveState));
input('mold-search').addEventListener('focus', () => { if (!input('seed').value) renderSeedChoices(); });
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
$('shuffle').addEventListener('click', async () => { if (!paintedDiscsEnabled) return; const next = await experience.selectDraftDepiction(random, true); if (next.kind === 'painted') { painting = next; depiction = next; } resetPaintSeed(); preview(); });
$('depiction-choice').addEventListener('change', () => { if (!paintedDiscsEnabled) { if (photo) depiction = photo; preview(); return; } depiction = input('depiction-choice').value === 'photo' && photo ? photo : painting; preview(); });
const finishIds = ['rim-size', 'underglow', 'stamp-x', 'stamp-y'];
const paintingControls = [...root.querySelectorAll<HTMLElement>('.painting-only')];
function syncDepictionControls() {
  const photoMode = depiction.kind === 'photo';
  root.classList.toggle('photo-mode', photoMode);
  root.classList.toggle('painted-disc-overlay', paintedDiscsEnabled);
  paintingControls.forEach(control => { control.hidden = !paintedDiscsEnabled || photoMode; });
  const switcher = root.querySelector<HTMLElement>('.depiction-switcher');
  if (switcher) switcher.hidden = !paintedDiscsEnabled;
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
type EllipseGeometry = { centerX: number; centerY: number; radiusX: number; radiusY: number; axisAngle: number };
let ellipseFitActive = false, ellipseFitBusy = false, ellipseFitRequest = 0, ellipseDecisionRequired = false;
let automaticFitBusy = false, automaticFitReady = false, automaticFitRequest = 0;
let ellipseGeometry: EllipseGeometry | null = null, ellipseFitWorker: ReturnType<typeof createRimFitWorkerClient> | null = null;
let ellipseControlSnapshot: EllipseGeometry | null = null, ellipseEditedControls = new Set<string>();
let ellipseRefinement: { status: 'MAYBE' | 'ABSTAIN'; reason: string; trace: any } | null = null, ellipseUserEdited = false;
const cropIds = ['crop-center-x', 'crop-center-y', 'crop-radius-x', 'crop-radius-y'];
let cropRotation = 0;
let refitAttempt: { address: string | null; source: RefitSource; name: string } | null = null;
let pendingSampleDetails: { row: SeedOption; plastic: string } | null = null;
// Every new photo or crop action supersedes an in-flight circle request.
let circleFitRequest = 0, circleFitSerial = 0, candidateRequest = 0;
function invalidateCircleFit() { circleFitRequest++; candidateRequest++; candidateBusy = false; syncCandidateApply(); }
function cropState(): PhotoCrop { return { centerX: Number(input('crop-center-x').value), centerY: Number(input('crop-center-y').value), radiusX: Number(input('crop-radius-x').value), radiusY: Number(input('crop-radius-y').value), rotation: cropRotation }; }
function setCrop(next: PhotoCrop, { invalidate = true }: { invalidate?: boolean } = {}) {
  if (!cropWorking || !cropBitmap) return;
  if (invalidate) invalidateCircleFit();
  const crop = clampCircleCropSelection(cropBitmap.width, cropBitmap.height, next);
  input('crop-center-x').value = String(crop.centerX); input('crop-center-y').value = String(crop.centerY);
  cropRotation = crop.rotation;
  input('crop-rotation').value = String(cropRotation * 180 / Math.PI);
  $('crop-rotation-value').textContent = `${Math.round(cropRotation * 180 / Math.PI)}°`;
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
type CropGesture = { mode: 'pan' | 'resize'; pointerId: number; startClientX: number; startClientY: number; startPointerRadius: number; crop: PhotoCrop; view: CropView; ellipse?: EllipseGeometry; ellipseCenterScreen?: { x: number; y: number } };
let cropGesture: CropGesture | null = null;
const cropStage = $('crop-stage');
const resizeHandle = $('crop-resize-handle') as HTMLButtonElement;
function publishEllipseReviewInspection(dotsVisible = false, sampleCount = 0, fitInlierCount = 0) {
  const instrumented = new URLSearchParams(location.search).get('instrument') === '1' || (window as any).__dsCaptureInstrumentation === true;
  if (!instrumented) return;
  Object.assign(window as any, { __dsEllipseReview: Object.freeze({
    proposalStatus: ellipseFitActive && validEllipse(ellipseGeometry) ? 'MAYBE' : null,
    refinementStatus: ellipseRefinement?.status ?? 'NOT_RUN',
    ellipse: ellipseGeometry ? Object.freeze({ ...ellipseGeometry }) : null,
    edited: ellipseUserEdited,
    dotsVisible,
    sampleCount,
    fitInlierCount,
    trace: ellipseRefinement?.trace ?? null,
  }) });
}
function setGestureState(mode: CropGesture['mode'] | null) {
  if (ellipseFitActive || ellipseDecisionRequired) {
    cropStage.dataset.mode = 'ellipse';
    resizeHandle.hidden = !manualCrop.open || ellipseDecisionRequired;
    return;
  }
  cropStage.dataset.mode = mode ?? 'ready';
  resizeHandle.hidden = false;
}
function drawTransparentGutter(ctx: CanvasRenderingContext2D, size: number) {
  const cell = Math.max(8, Math.round(size / 28));
  for (let y = 0; y < size; y += cell) for (let x = 0; x < size; x += cell) {
    ctx.fillStyle = ((x / cell + y / cell) & 1) ? '#eef0ec' : '#f8f8f5';
    ctx.fillRect(x, y, cell, cell);
  }
}
/** One candidate tap shows the same full circular cutout that Apply prepares. */
function previewCssPixelScale(canvas: HTMLCanvasElement) { return canvas.width / (canvas.getBoundingClientRect().width || canvas.width); }
function drawCandidateCutoutPreview(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  if (!cropBitmap) return;
  const gutter = Math.max(12, Math.round(canvas.width * .05)), size = canvas.width - gutter * 2;
  drawTransparentGutter(ctx, canvas.width);
  const mapping = circleCropExportMapping(cropBitmap.width, cropBitmap.height, size, cropState());
  ctx.save(); ctx.beginPath(); ctx.ellipse(canvas.width / 2, canvas.height / 2, size / 2, size / 2, 0, 0, Math.PI * 2); ctx.clip();
  ctx.translate(gutter, gutter); drawRotatedCrop(ctx, cropBitmap.image, mapping); ctx.restore();
}
function drawEllipseProposalPreview(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  if (!cropBitmap || !cropWorking || !ellipseGeometry) return false;
  const placement = sourceImagePlacement(cropBitmap.width, cropBitmap.height, canvas.width), { centerX, centerY, radiusX, radiusY, axisAngle } = ellipseGeometry;
  const sampledPoints = ellipseRefinement?.status === 'MAYBE' && !ellipseUserEdited
    ? (ellipseRefinement.trace?.perRayEvidence ?? []).filter((ray: any) => ray.geometryIncluded === true &&
      Number.isFinite(ray.outerBoundaryPointSourcePx?.x) && Number.isFinite(ray.outerBoundaryPointSourcePx?.y))
    : [];
  cropStage.dataset.ellipseRefinement = ellipseRefinement?.status ?? 'none';
  cropStage.dataset.ellipseDots = sampledPoints.length ? 'visible' : 'hidden';
  cropStage.dataset.ellipseSampleCount = String(ellipseRefinement?.trace?.perRayEvidence?.length ?? 0);
  cropStage.dataset.ellipseFitInlierCount = String(ellipseRefinement?.trace?.geometryConsensus?.geometryInlierSamples ?? 0);
  publishEllipseReviewInspection(sampledPoints.length > 0, ellipseRefinement?.trace?.perRayEvidence?.length ?? 0, ellipseRefinement?.trace?.geometryConsensus?.geometryInlierSamples ?? 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#dfe5db'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(cropWorking, placement.x, placement.y, placement.width, placement.height);
  const x = placement.x + centerX * placement.scale, y = placement.y + centerY * placement.scale;
  ctx.save();
  paintBoundary(ctx, { width:canvas.width, height:canvas.height, centerX:x, centerY:y, radiusX:radiusX * placement.scale, radiusY:radiusY * placement.scale, axisAngle, cssPixelScale:previewCssPixelScale(canvas) });
  for (const ray of sampledPoints) {
    const px = placement.x + ray.outerBoundaryPointSourcePx.x * placement.scale;
    const py = placement.y + ray.outerBoundaryPointSourcePx.y * placement.scale;
    const dotRadius = Math.max(2.5, canvas.width / 155);
    ctx.beginPath(); ctx.arc(px, py, dotRadius + 1, 0, Math.PI * 2); ctx.fillStyle = 'rgba(12,30,27,.92)'; ctx.fill();
    ctx.beginPath(); ctx.arc(px, py, dotRadius, 0, Math.PI * 2); ctx.fillStyle = '#08a98f'; ctx.fill();
  }
  ctx.restore();
  return true;
}
const refinementCanvas = $('refinement-preview') as HTMLCanvasElement;
const refinementRenderer = createRefinementRenderer({ drawDots: false, createCanvas: (width: number, height: number) => {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
} });
const refinementSourceIds = new WeakMap<object, string>();
let refinementSourceSerial = 0;
let refinementFrozenProjection: { scale: number; dx: number; dy: number } | null = null;
let refinementViewportKey = '', refinementLastSource: CropSource | null = null;
let refinementLastSnapshot: any = null, refinementLastResult: any = null;
type RefinementCheckpoint = { source: CropSource; crop: PhotoCrop; ellipse: EllipseGeometry | null; active: boolean; edited: boolean; refinement: typeof ellipseRefinement; candidate: CircleCandidate | null; decision: boolean; manual: boolean; controlSnapshot: EllipseGeometry | null; editedControls: string[]; values: Array<[string,string]>; observation: any[]; observationTrace: any[]; ellipseMode: boolean; ellipsePin: any; ellipseAdjustment: any };
type RefinementGesture = { pointerId: number; index: number; startX: number; startY: number; geometry: EllipseGeometry; circle: boolean; checkpoint: RefinementCheckpoint; projection: { scale:number; dx:number; dy:number }; changed: boolean; latestX: number; latestY: number; ellipseMode: boolean; anchor: any };
let refinementGesture: RefinementGesture | null = null;
const refinementHistory: RefinementCheckpoint[] = [];
let refinementObservation: any[] = [], refinementObservationTrace: any[] = [];
let refinementEllipseMode=false, refinementEllipsePin:any=null, refinementEllipseAdjustment:any=null;
const refinementUndo = $('refinement-undo') as HTMLButtonElement;
const refinementDots = boundaryHandles({centerX:0,centerY:0,radiusX:1,radiusY:1,axisAngle:0}).map(handle => {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'refinement-dot'; button.dataset.handle = String(handle.index);
  button.setAttribute('aria-label', `Adjust ${handle.name.replace('-', ' ')} edge`); button.setAttribute('aria-describedby','refinement-help');
  $('refinement-handles').append(button); return button;
});
function refinementGeometry(): EllipseGeometry | null {
  if (!cropBitmap) return null;
  if (ellipseFitActive) return validEllipse(ellipseGeometry) ? { ...ellipseGeometry } : null;
  const crop = cropState(); return { centerX: crop.centerX * cropBitmap.width, centerY: crop.centerY * cropBitmap.height, radiusX: crop.radiusX * cropBitmap.width, radiusY: crop.radiusY * cropBitmap.height, axisAngle: 0 };
}
function captureRefinementCheckpoint(): RefinementCheckpoint {
  return { source: cropBitmap!, crop: cropState(), ellipse: ellipseGeometry && {...ellipseGeometry}, active: ellipseFitActive, edited: ellipseUserEdited, refinement: ellipseRefinement, candidate: selectedCandidate, decision: ellipseDecisionRequired, manual: manualCrop.open, controlSnapshot: ellipseControlSnapshot && {...ellipseControlSnapshot}, editedControls:[...ellipseEditedControls], observation:refinementObservation, observationTrace:refinementObservationTrace, ellipseMode:refinementEllipseMode, ellipsePin:refinementEllipsePin, ellipseAdjustment:refinementEllipseAdjustment, values: [...cropIds,'crop-rotation',...ellipseRangeControls.map(control=>control.id)].map(id=>[id,input(id).value]) };
}
function restoreRefinementCheckpoint(saved: RefinementCheckpoint) {
  if (saved.source !== cropBitmap) return;
  refinementObservation=saved.observation;refinementObservationTrace=saved.observationTrace;refinementEllipseMode=saved.ellipseMode;refinementEllipsePin=saved.ellipsePin;refinementEllipseAdjustment=saved.ellipseAdjustment;
  ellipseRefinement=saved.refinement; ellipseUserEdited=saved.edited; ellipseDecisionRequired=saved.decision;
  if (saved.active && saved.ellipse) syncEllipseControls({geometry:saved.ellipse,activate:true,preserveExact:true});
  else { ellipseFitActive=false; ellipseGeometry=saved.ellipse; ellipseControls.hidden=true; setCrop(saved.crop,{invalidate:false}); }
  for(const [id,value] of saved.values) input(id).value=value;
  ellipseControlSnapshot=saved.controlSnapshot && {...saved.controlSnapshot}; ellipseEditedControls=new Set(saved.editedControls);
  ellipseFitActive=saved.active; ellipseGeometry=saved.ellipse && {...saved.ellipse}; ellipseUserEdited=saved.edited; ellipseRefinement=saved.refinement;
  selectedCandidate=saved.candidate; manualCrop.open=saved.manual; ellipseDecisionRequired=saved.decision;
  renderCandidateChoices(); syncEllipseReviewPresentation(); syncManualMode(); syncCandidateApply(); scheduleCropPreview();
}
function clearRefinementHistory() {
  if(refinementGesture) finishRefinementGesture(false);
  refinementHistory.length=0; refinementUndo.disabled=true; refinementObservation=[];refinementObservationTrace=[];refinementEllipsePin=null;refinementEllipseAdjustment=null;
}
function refinementAccepts(geometry: EllipseGeometry) {
  if(!cropBitmap || !validEllipse(geometry)) return false;
  const short=Math.min(cropBitmap.width,cropBitmap.height);
  return geometry.radiusX>=.03*short && geometry.radiusY>=.03*short && geometry.radiusX<=Math.max(cropBitmap.width,cropBitmap.height)/2 && geometry.radiusY<=short/2;
}
function applyRefinementGeometry(next: EllipseGeometry, circle: boolean) {
  if(!cropBitmap)return;
  if(circle) setCrop({...cropState(),centerX:next.centerX/cropBitmap.width,centerY:next.centerY/cropBitmap.height,radiusX:next.radiusX/cropBitmap.width,radiusY:next.radiusY/cropBitmap.height},{invalidate:false});
  else {ellipseUserEdited=true; syncEllipseControls({geometry:next,activate:true,preserveExact:true});}
  syncCandidateApply(); scheduleCropPreview();
}
function moveRefinementGesture() {
  const gesture=refinementGesture;if(!gesture||gesture.checkpoint.source!==cropBitmap)return;
  const delta={x:(gesture.latestX-gesture.startX)*refinementPrecisionGain/gesture.projection.scale,y:(gesture.latestY-gesture.startY)*refinementPrecisionGain/gesture.projection.scale};
  const adjustment=gesture.ellipseMode?boundedEllipseAdjustment(gesture.geometry,gesture.index,delta,gesture.anchor,{width:cropBitmap!.width,height:cropBitmap!.height,isValid:refinementAccepts}):null;
  const next=adjustment?.geometry??boundedAnchoredDrag(gesture.geometry,gesture.index,delta,{circle:gesture.circle},refinementAccepts);
  const current=refinementGeometry();
  if(current&&Object.keys(next).every(key=>Math.abs(next[key as keyof EllipseGeometry]-current[key as keyof EllipseGeometry])<1e-10))return;
  if(!gesture.changed){invalidateCircleFit();invalidateEllipseFit();clearCandidateSelection();manualCrop.open=true;syncManualMode();gesture.changed=true;}
  applyRefinementGeometry(next,gesture.circle);
  if(adjustment)refinementEllipseAdjustment=adjustment.receipt;
  const actual=refinementGeometry();if(actual)refinementObservation=classifyDotMovement(gesture.geometry,actual,gesture.index);
}
function announceRefinement(message: string) { $('refinement-result').textContent=message; }
function announceRefinementGeometry(index: number) { const g=refinementGeometry(); if(g)announceRefinement(`${boundaryHandles(g)[index].name.replace('-', ' ')} edge adjusted. Undo available.`); }
function finishRefinementGesture(commit: boolean) {
  const gesture=refinementGesture;if(!gesture)return;
  if(commit)moveRefinementGesture();
  refinementGesture=null;
  refinementDots[gesture.index].dataset.dragging='false';
  if(refinementDots[gesture.index].hasPointerCapture(gesture.pointerId))refinementDots[gesture.index].releasePointerCapture(gesture.pointerId);
  if(gesture.changed){
    const current=refinementGeometry(),same=current&&Object.keys(current).every(key=>Math.abs(current[key as keyof EllipseGeometry]-gesture.geometry[key as keyof EllipseGeometry])<1e-10);
    if(!commit||same){restoreRefinementCheckpoint(gesture.checkpoint);if(!commit)announceRefinement('Edge adjustment canceled.');}
    else {if(gesture.ellipseMode&&current)refinementEllipsePin=makeEllipsePin(current,gesture.index,gesture.anchor);refinementObservationTrace=[...refinementObservationTrace,Object.freeze({selectedIndex:gesture.index,before:Object.freeze({...gesture.geometry}),after:Object.freeze({...current!}),handles:refinementObservation,...(gesture.ellipseMode?{ellipseAdjustment:refinementEllipseAdjustment,pin:refinementEllipsePin}:{})})];refinementHistory.push(gesture.checkpoint);if(refinementHistory.length>20)refinementHistory.shift();announceRefinementGeometry(gesture.index);}
  }
  refinementUndo.disabled=!refinementHistory.length;scheduleCropPreview();
}
refinementDots.forEach((button,index)=>{
  button.addEventListener('pointerdown',event=>{
    if(!event.isPrimary||event.button!==0||refinementGesture||cropGesture||automaticFitBusy||candidateBusy||ellipseFitBusy||ellipseDecisionRequired)return;
    const geometry=refinementGeometry();if(!geometry||!refinementLastResult)return;
    event.preventDefault();
    const rect=refinementCanvas.getBoundingClientRect(),projection=refinementLastResult.projection;
    const nearest=boundaryHandles(geometry).filter(handle=>!refinementDots[handle.index].disabled).reduce((best,handle)=>{const distance=Math.hypot(rect.left+handle.point.x*projection.scale+projection.dx-event.clientX,rect.top+handle.point.y*projection.scale+projection.dy-event.clientY);return distance<best.distance?{index:handle.index,distance}:best;},{index,distance:Infinity});
    const selectedButton=refinementDots[nearest.index];selectedButton.focus({preventScroll:true});
    refinementFrozenProjection ??= {...refinementLastResult.projection};
    refinementGesture={pointerId:event.pointerId,index:nearest.index,startX:event.clientX,startY:event.clientY,latestX:event.clientX,latestY:event.clientY,geometry,circle:!ellipseFitActive&&!refinementEllipseMode,ellipseMode:refinementEllipseMode,anchor:refinementEllipseMode?anchorForEllipseDrag(geometry,nearest.index,refinementEllipsePin):null,checkpoint:captureRefinementCheckpoint(),projection:{...refinementFrozenProjection},changed:false};
    selectedButton.dataset.dragging='true';selectedButton.setPointerCapture(event.pointerId);scheduleCropPreview();
  });
  button.addEventListener('pointermove',event=>{const g=refinementGesture;if(!g||g.pointerId!==event.pointerId)return;g.latestX=event.clientX;g.latestY=event.clientY;scheduleCropPreview();});
  button.addEventListener('pointerup',event=>{if(refinementGesture?.pointerId!==event.pointerId)return;refinementGesture.latestX=event.clientX;refinementGesture.latestY=event.clientY;finishRefinementGesture(true);});
  button.addEventListener('pointercancel',event=>{if(refinementGesture?.pointerId===event.pointerId)finishRefinementGesture(false);});
  button.addEventListener('lostpointercapture',event=>{if(refinementGesture?.pointerId===event.pointerId)finishRefinementGesture(false);});
  button.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&refinementGesture){event.preventDefault();finishRefinementGesture(false);return;}
    const arrows:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};const direction=arrows[event.key];
    if(!direction||event.altKey||event.ctrlKey||event.metaKey||refinementGesture||cropGesture||automaticFitBusy||candidateBusy||ellipseFitBusy||ellipseDecisionRequired)return;
    const geometry=refinementGeometry();if(!geometry||!refinementLastResult)return;event.preventDefault();
    refinementFrozenProjection ??= {...refinementLastResult.projection};
    const amount=event.shiftKey?.1:1,delta={x:direction[0]*amount/refinementFrozenProjection.scale,y:direction[1]*amount/refinementFrozenProjection.scale};
    const anchor=refinementEllipseMode?anchorForEllipseDrag(geometry,index,refinementEllipsePin):null;
    const adjustment=refinementEllipseMode?boundedEllipseAdjustment(geometry,index,delta,anchor,{width:cropBitmap!.width,height:cropBitmap!.height,isValid:refinementAccepts}):null;
    const next=adjustment?.geometry??boundedAnchoredDrag(geometry,index,delta,{circle:!ellipseFitActive},refinementAccepts);
    if(Object.keys(next).every(key=>Math.abs(next[key as keyof EllipseGeometry]-geometry[key as keyof EllipseGeometry])<1e-10)){announceRefinement('Movement constrained. Use another dot or the original controls.');return;}
    const saved=captureRefinementCheckpoint(),circle=!ellipseFitActive&&!refinementEllipseMode;invalidateCircleFit();invalidateEllipseFit();clearCandidateSelection();manualCrop.open=true;syncManualMode();applyRefinementGeometry(next,circle);if(adjustment)refinementEllipseAdjustment=adjustment.receipt;const actual=refinementGeometry();if(actual){if(refinementEllipseMode)refinementEllipsePin=makeEllipsePin(actual,index,anchor);refinementObservation=classifyDotMovement(geometry,actual,index);refinementObservationTrace=[...refinementObservationTrace,Object.freeze({selectedIndex:index,before:Object.freeze({...geometry}),after:Object.freeze({...actual}),handles:refinementObservation,...(refinementEllipseMode?{ellipseAdjustment:refinementEllipseAdjustment,pin:refinementEllipsePin}:{})})];}refinementHistory.push(saved);if(refinementHistory.length>20)refinementHistory.shift();refinementUndo.disabled=false;announceRefinementGeometry(index);
  });
});
refinementUndo.addEventListener('click',()=>{if(refinementGesture)finishRefinementGesture(false);const saved=refinementHistory.pop();if(saved){restoreRefinementCheckpoint(saved);announceRefinement('Previous edge adjustment restored.');}refinementUndo.disabled=!refinementHistory.length;});
$('refinement-fit-view').addEventListener('click',()=>{if(refinementGesture)finishRefinementGesture(false);refinementFrozenProjection=null;scheduleCropPreview();});
function resetRefinementFromOriginalControls(){clearRefinementHistory();refinementEllipseMode=false;}
$('crop-editor').addEventListener('input',resetRefinementFromOriginalControls,true);
$('crop-editor').addEventListener('click',event=>{if((event.target as HTMLElement).closest('button'))resetRefinementFromOriginalControls();},true);
cropStage.addEventListener('pointerdown',resetRefinementFromOriginalControls,true);
function updateRefinementPreview() {
  if (!cropBitmap) return;
  const rect = refinementCanvas.getBoundingClientRect();
  if (rect.width <= 32 || rect.height <= 32) return;
  const key=JSON.stringify([rect.width,rect.height,window.devicePixelRatio||1]);
  if(refinementLastSource!==cropBitmap||key!==refinementViewportKey){if(refinementGesture)finishRefinementGesture(false);if(refinementLastSource!==cropBitmap){clearRefinementHistory();refinementEllipseMode=false;}refinementFrozenProjection=null;refinementLastSource=cropBitmap;refinementViewportKey=key;}
  let identity = refinementSourceIds.get(cropBitmap);
  if (!identity) { identity = `source-${++refinementSourceSerial}`; refinementSourceIds.set(cropBitmap, identity); }
  const ellipse=refinementGeometry();
  // Default solver selection is observational: leave the current circle/ellipse
  // preparation path unchanged until an actual accepted dot adjustment.
  if(ellipse&&!automaticFitBusy&&!candidateBusy&&!ellipseFitBusy&&!ellipseDecisionRequired&&(automaticFitReady||!!selectedCandidate||manualCrop.open||ellipseFitActive))refinementEllipseMode=true;
  if(ellipseDecisionRequired&&!automaticFitBusy)($('crop-comparison') as HTMLDetailsElement).open=true;
  if(!ellipse){refinementDots.forEach(button=>button.disabled=true);return;}
  const viewport = Object.freeze({ width: rect.width, height: rect.height, dpr: window.devicePixelRatio || 1 });
  refinementCanvas.width = Math.max(1, Math.round(viewport.width * viewport.dpr));
  refinementCanvas.height = Math.max(1, Math.round(viewport.height * viewport.dpr));
  const snapshot = Object.freeze({ source: Object.freeze({ identity, image: cropBitmap.image, width: cropBitmap.width, height: cropBitmap.height }), ellipse: Object.freeze(ellipse), viewport, view: Object.freeze({ zoom: 1, padding: 24, projection: 'uniform', ...(refinementFrozenProjection?{frozenProjection:Object.freeze({...refinementFrozenProjection})}:{}) }) });
  const result = refinementRenderer.seek(refinementCanvas.getContext('2d')!, snapshot, 0);
  refinementLastSnapshot=snapshot;refinementLastResult=result;
  const handles=boundaryHandles(ellipse).map(handle=>({...handle,screen:{x:handle.point.x*result.projection.scale+result.projection.dx,y:handle.point.y*result.projection.scale+result.projection.dy}}));
  if(!refinementObservation.length)refinementObservation=classifyDotMovement(ellipse,ellipse);
  for(const handle of handles){const button=refinementDots[handle.index],status=refinementObservation[handle.index];button.style.left=`${handle.screen.x}px`;button.style.top=`${handle.screen.y}px`;button.disabled=automaticFitBusy||candidateBusy||ellipseFitBusy||ellipseDecisionRequired;button.dataset.movement=status.kind;button.setAttribute('aria-label',`Adjust ${handle.name.replace('-', ' ')} edge; latest adjustment: ${dotMovementDescription(status)}`);}
  $('refinement-dot-readout').replaceChildren(...refinementObservation.map(status=>{const item=document.createElement('li');const motion=status.direction==='inward'?'in':status.direction==='outward'?'out':status.direction;item.textContent=`${status.name.replace('-', ' ')}: ${status.kind==='stationary'?'stayed':`${status.kind==='direct'?'manual':'other'} ${motion}${status.mixed?' + sideways':''}`}`;item.setAttribute('aria-label',`${status.name.replace('-', ' ')}: ${dotMovementDescription(status)}`);return item;}));
  const loupe=$('refinement-loupe') as HTMLCanvasElement; loupe.hidden=!refinementGesture;
  if(refinementGesture){
    const handle=handles[refinementGesture.index],patch=128/(result.projection.scale*4),ctx=loupe.getContext('2d')!;
    loupe.style.left=handle.direction.x>=0?'10px':'auto';loupe.style.right=handle.direction.x>=0?'auto':'10px';
    loupe.style.top=handle.direction.y>=0?'10px':'auto';loupe.style.bottom=handle.direction.y>=0?'auto':'10px';
    ctx.clearRect(0,0,128,128);ctx.fillStyle='#dfe5db';ctx.fillRect(0,0,128,128);
    ctx.drawImage(cropBitmap.image,handle.point.x-patch/2,handle.point.y-patch/2,patch,patch,0,0,128,128);
    ctx.beginPath();ctx.moveTo(57,64);ctx.lineTo(71,64);ctx.moveTo(64,57);ctx.lineTo(64,71);ctx.strokeStyle='#173a30';ctx.lineWidth=3;ctx.stroke();ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.stroke();
  }
  const instrumented = new URLSearchParams(location.search).get('instrument') === '1' || (window as any).__dsCaptureInstrumentation === true;
  if (instrumented) {
    (window as any).__dsRefinementSeek = (t: number) => refinementRenderer.seek(refinementCanvas.getContext('2d')!, snapshot, t);
    (window as any).__dsRefinementSnapshot = snapshot;
    const g=refinementGesture;
    (window as any).__dsRefinementView = Object.freeze({ sourceIdentity: identity, sourceWidth: cropBitmap.width, sourceHeight: cropBitmap.height, ellipse: snapshot.ellipse, viewport, view: snapshot.view, t: 0, ...result, handles, precisionGain:refinementPrecisionGain, undoDepth:refinementHistory.length, dotMovement:refinementObservation, adjustmentTrace:refinementObservationTrace, ellipseMode:refinementEllipseMode, ellipsePin:refinementEllipsePin, ellipseAdjustment:refinementEllipseAdjustment, gesture:g?{index:g.index,changed:g.changed,geometry:{...g.geometry},projection:{...g.projection},oppositeAnchor:g.ellipseMode?g.anchor.point:supportPoint(g.geometry,boundaryHandles(g.geometry)[(g.index+4)%8].direction),ellipseMode:g.ellipseMode,anchor:g.anchor}:null });
  }
}
const refinementResize = new ResizeObserver(scheduleCropPreview); refinementResize.observe(refinementCanvas);
function updateCropPreview() {
  if (!cropWorking || !cropBitmap) return;
  moveRefinementGesture();
  updateRefinementPreview();
  setGestureState(cropGesture?.mode ?? null);
  const canvas = $('crop-preview') as HTMLCanvasElement, ctx = canvas.getContext('2d')!, showCandidate = !!selectedCandidate && !manualCrop.open;
  const crop = cropState(), circleSize = Math.round(crop.radiusX * cropBitmap.width * 200 / Math.min(cropBitmap.width, cropBitmap.height));
  ($('crop-zoom-value') as HTMLOutputElement).value = `Selection size ${circleSize}%`;
  cropStage.dataset.candidate = String(showCandidate && !ellipseFitActive);
  if (ellipseFitActive && drawEllipseProposalPreview(canvas, ctx)) {
    canvas.setAttribute('aria-label', 'Photo crop preview');
    if (manualCrop.open) {
      const placement = sourceImagePlacement(cropBitmap.width, cropBitmap.height, canvas.width);
      const { centerX, centerY, radiusX, axisAngle } = ellipseGeometry!;
      const handleX = placement.x + centerX * placement.scale + radiusX * placement.scale * Math.cos(axisAngle);
      const handleY = placement.y + centerY * placement.scale + radiusX * placement.scale * Math.sin(axisAngle);
      cropStage.style.setProperty('--crop-handle-x', `${(handleX - canvas.width / 2) / canvas.width * 100}%`);
      cropStage.style.setProperty('--crop-handle-y', `${(handleY - canvas.height / 2) / canvas.height * 100}%`);
      resizeHandle.hidden = false;
    }
    return;
  }
  canvas.setAttribute('aria-label', 'Photo crop preview');
  if (showCandidate) { drawCandidateCutoutPreview(canvas, ctx); return; }
  const view = fixedCropView(crop, canvas.width); if (!view) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#dfe5db'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save(); ctx.translate(view.centerX, view.centerY); ctx.rotate(crop.rotation); ctx.translate(-view.centerX, -view.centerY);
  ctx.drawImage(cropWorking, view.imageX, view.imageY, view.imageWidth, view.imageHeight); ctx.restore();
  // The source still moves beneath the same fixed circular aperture.
  paintBoundary(ctx, { width:canvas.width, height:canvas.height, centerX:view.centerX, centerY:view.centerY, radiusX:view.radius, radiusY:view.radius, cssPixelScale:previewCssPixelScale(canvas) });
  cropStage.style.setProperty('--crop-handle-x', `${view.radius / Math.SQRT2 / canvas.width * 100}%`);
  cropStage.style.setProperty('--crop-handle-y', `${view.radius / Math.SQRT2 / canvas.height * 100}%`);
}
const candidatePicker = $('circle-candidate-picker'), candidateList = $('circle-candidates'), candidateHeading = $('circle-candidate-heading'), refineButton = $('crop-refine') as HTMLButtonElement, otherButton = $('crop-other') as HTMLButtonElement, cropApply = $('crop-apply') as HTMLButtonElement;
const manualCrop = $('crop-manual') as HTMLDetailsElement;
const ellipseFitButton = $('crop-ellipse-fit') as HTMLButtonElement, ellipseControls = $('crop-ellipse-controls') as HTMLElement, ellipseStatus = $('crop-ellipse-status');
const ellipseRecoveryButton = $('crop-ellipse-reset') as HTMLButtonElement, ellipseFineTune = $('crop-ellipse-fine') as HTMLDetailsElement;
const ellipseCenterX = input('crop-ellipse-center-x'), ellipseCenterY = input('crop-ellipse-center-y'), ellipseRadiusX = input('crop-ellipse-radius-x'), ellipseRadiusY = input('crop-ellipse-radius-y'), ellipseAxisAngle = input('crop-ellipse-axis-angle');
const ellipseRangeControls = [ellipseCenterX, ellipseCenterY, ellipseRadiusX, ellipseRadiusY, ellipseAxisAngle];
function syncEllipseReviewPresentation() {
  candidatePicker.hidden = candidateChoices.length === 0;
  candidateHeading.textContent = candidateChoices.length ? 'Other crop options' : '';
  ellipseFitButton.textContent = 'Recheck edge';
  ellipseFitButton.dataset.fitActive = String(ellipseFitActive);
  ellipseRecoveryButton.hidden = !ellipseFitActive || !selectedCandidate;
  ellipseRecoveryButton.textContent = 'Try another crop';
  ($('photo-crop') as HTMLDialogElement).dataset.fitMode = ellipseFitActive ? 'ellipse' : ellipseDecisionRequired ? 'needs-circle-choice' : 'circle';
}
function ellipseShortSide() { return cropBitmap ? Math.min(cropBitmap.width, cropBitmap.height) : 1; }
function ellipseMajorRadiusLimit() { return cropBitmap ? Math.max(cropBitmap.width, cropBitmap.height) / (2 * ellipseShortSide()) : .5; }
function validEllipse(geometry: EllipseGeometry | null): geometry is EllipseGeometry {
  if (!cropBitmap || !geometry || geometry.radiusX < geometry.radiusY) return false;
  return validateEllipseBounds(cropBitmap.width, cropBitmap.height, geometry, 0);
}
function ellipseFitsControlRanges(geometry: EllipseGeometry | null) {
  if (!cropBitmap || !geometry) return false;
  const shortSide = ellipseShortSide(), major = geometry.radiusX / shortSide, minor = geometry.radiusY / shortSide, degrees = geometry.axisAngle * 180 / Math.PI;
  return major >= .03 && major <= ellipseMajorRadiusLimit() && minor >= .03 && minor <= .5 && degrees >= -90 && degrees <= 90;
}
async function reviewEllipsePhoto(bitmap: CropSource, isCurrent: () => boolean) {
  const raster = document.createElement('canvas'); raster.width = bitmap.width; raster.height = bitmap.height;
  try {
    const context = raster.getContext('2d', { willReadFrequently: true });
    if (!context) throw Error('The photo raster is unavailable.');
    context.drawImage(bitmap.image, 0, 0, bitmap.width, bitmap.height);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    ellipseFitWorker ??= createRimFitWorkerClient();
    const review = await runEllipseFitReview({ worker: ellipseFitWorker, image: { width: bitmap.width, height: bitmap.height, data }, isCurrent });
    return review.status === 'READY' ? review.proposal : null;
  } finally { raster.width = 0; raster.height = 0; }
}
function usableAutomaticEllipse(proposal: any) {
  return proposal?.status === 'MAYBE' && proposal.refinement?.status === 'MAYBE' &&
    validEllipse(proposal.ellipse) && ellipseFitsControlRanges(proposal.ellipse);
}
function readEllipseControls(): EllipseGeometry | null {
  if (!cropBitmap) return null;
  const shortSide = ellipseShortSide();
  const values = [ellipseCenterX.value, ellipseCenterY.value, ellipseRadiusX.value, ellipseRadiusY.value, ellipseAxisAngle.value].map(Number);
  if (!values.every(Number.isFinite)) return null;
  return { centerX: values[0] * cropBitmap.width, centerY: values[1] * cropBitmap.height, radiusX: values[2] * shortSide, radiusY: values[3] * shortSide, axisAngle: values[4] * Math.PI / 180 };
}
function syncEllipseControls({ geometry, activate = ellipseFitActive, preserveExact = false }: { geometry?: EllipseGeometry | null; activate?: boolean; preserveExact?: boolean } = {}) {
  if (cropBitmap) {
    ellipseRadiusX.max = String(ellipseMajorRadiusLimit());
    ellipseRadiusY.max = '.5';
  }
  if (geometry && cropBitmap) {
    ellipseCenterX.value = String(geometry.centerX / cropBitmap.width); ellipseCenterY.value = String(geometry.centerY / cropBitmap.height);
    ellipseRadiusX.value = String(geometry.radiusX / ellipseShortSide()); ellipseRadiusY.value = String(geometry.radiusY / ellipseShortSide());
    ellipseAxisAngle.value = String(geometry.axisAngle * 180 / Math.PI);
    // Range inputs quantize their displayed values. Preserve exact physical
    // geometry only when reopening a saved V2; fresh proposals apply the shown
    // range values so the preview, controls, and prepared raster agree.
    ellipseControlSnapshot = preserveExact ? { ...geometry } : null; ellipseEditedControls.clear();
  }
  const centerXValue = $('crop-ellipse-center-x-value'), centerYValue = $('crop-ellipse-center-y-value'), radiusXValue = $('crop-ellipse-radius-x-value'), radiusYValue = $('crop-ellipse-radius-y-value'), axisValue = $('crop-ellipse-axis-angle-value');
  centerXValue.textContent = `${(Number(ellipseCenterX.value) * 100).toFixed(1)}%`; centerYValue.textContent = `${(Number(ellipseCenterY.value) * 100).toFixed(1)}%`;
  radiusXValue.textContent = `${(Number(ellipseRadiusX.value) * 100).toFixed(1)}%`; radiusYValue.textContent = `${(Number(ellipseRadiusY.value) * 100).toFixed(1)}%`;
  axisValue.textContent = `${Math.round(Number(ellipseAxisAngle.value))}°`;
  const enteredGeometry = readEllipseControls();
  if (ellipseControlSnapshot && enteredGeometry) {
    ellipseGeometry = { ...ellipseControlSnapshot };
    const controlKeys: Array<[string, keyof EllipseGeometry]> = [
      [ellipseCenterX.id, 'centerX'], [ellipseCenterY.id, 'centerY'],
      [ellipseRadiusX.id, 'radiusX'], [ellipseRadiusY.id, 'radiusY'],
      [ellipseAxisAngle.id, 'axisAngle'],
    ];
    for (const [controlId, property] of controlKeys) {
      if (ellipseEditedControls.has(controlId)) ellipseGeometry[property] = enteredGeometry[property];
    }
  } else ellipseGeometry = enteredGeometry;
  ellipseFitActive = activate;
  ellipseControls.hidden = !ellipseFitActive; ellipseFitButton.setAttribute('aria-expanded', String(ellipseFitActive));
  ellipseRangeControls.forEach(control => { control.disabled = ellipseFitBusy || !ellipseFitActive; });
  syncEllipseReviewPresentation();
  if (ellipseFitActive) {
    if (!validEllipse(ellipseGeometry)) ellipseStatus.textContent = 'The edge crosses the photo boundary. Move it inward before using the photo.';
    else if (ellipseRefinement?.status === 'ABSTAIN') ellipseStatus.textContent = 'Check the edge in the preview before using the photo.';
    else if (ellipseUserEdited) ellipseStatus.textContent = 'Edge adjusted. Measured points are hidden because they no longer match.';
    else if (ellipseRefinement?.status === 'MAYBE') ellipseStatus.textContent = 'Measured points mark the detected edge.';
    else ellipseStatus.textContent = 'Check the edge before using the photo.';
  }
}
function invalidateEllipseFit() {
  ellipseFitRequest++; ellipseFitBusy = false; ellipseFitButton.disabled = false;
  syncCandidateApply();
}
function clearEllipseFit(message?: string) {
  invalidateEllipseFit(); ellipseFitActive = false; ellipseDecisionRequired = false; ellipseGeometry = null; ellipseControlSnapshot = null; ellipseEditedControls.clear(); ellipseRefinement = null; ellipseUserEdited = false; ellipseControls.hidden = true; ellipseFineTune.open = false; ellipseFitButton.setAttribute('aria-expanded', 'false');
  cropStage.dataset.ellipseRefinement = 'none'; cropStage.dataset.ellipseDots = 'hidden'; cropStage.dataset.ellipseSampleCount = '0'; cropStage.dataset.ellipseFitInlierCount = '0';
  publishEllipseReviewInspection();
  ellipseStatus.textContent = message ?? 'The current edge is ready to use.';
  syncEllipseReviewPresentation();
  syncCandidateApply(); scheduleCropPreview();
}
function syncCandidateApply() {
  const circleReady = !ellipseDecisionRequired && (automaticFitReady || !!selectedCandidate || manualCrop.open);
  const ellipseReady = ellipseFitActive && validEllipse(ellipseGeometry);
  cropApply.disabled = automaticFitBusy || candidateBusy || ellipseFitBusy || !cropBitmap || !cropFile || !(ellipseFitActive ? ellipseReady : circleReady);
  ellipseFitButton.disabled = ellipseFitBusy || !cropBitmap || !cropFile;
}
function syncManualMode() {
  cropStage.dataset.manual = String(manualCrop.open);
  cropStage.dataset.candidate = String(!!selectedCandidate && !manualCrop.open && !ellipseFitActive);
  resizeHandle.disabled = !manualCrop.open || ellipseDecisionRequired;
  resizeHandle.hidden = !manualCrop.open || ellipseDecisionRequired;
  manualCrop.inert = automaticFitBusy || ellipseDecisionRequired;
  syncCandidateApply(); requestAnimationFrame(sizeCropStage);
}
async function tryEllipseFit() {
  if (!cropBitmap || !cropFile || ellipseFitBusy) return;
  const bitmap = cropBitmap, request = ++ellipseFitRequest;
  ellipseDecisionRequired = true;
  invalidateCircleFit(); endCropGesture(); ellipseFitBusy = true;
  syncManualMode();
  ellipseRangeControls.forEach(control => { control.disabled = true; });
  ellipseStatus.textContent = 'Checking the photo edge…';
  syncEllipseReviewPresentation(); ellipseFitButton.disabled = true;
  refineButton.disabled = true; otherButton.disabled = true; syncCandidateApply();
  try {
    const proposal = await reviewEllipsePhoto(bitmap, () => request === ellipseFitRequest && bitmap === cropBitmap);
    if (request !== ellipseFitRequest || bitmap !== cropBitmap) return;
    if (!usableAutomaticEllipse(proposal)) {
      ellipseDecisionRequired = false;
      ellipseStatus.textContent = 'No additional edge suggestion was found.';
      syncEllipseReviewPresentation();
    } else {
      ellipseRefinement = proposal!.refinement ?? null; ellipseUserEdited = false;
      ellipseDecisionRequired = false;
      syncEllipseControls({ geometry: proposal!.ellipse, activate: true });
    }
    scheduleCropPreview(); syncCandidateApply();
  } catch (error) {
    if (request === ellipseFitRequest && bitmap === cropBitmap) {
      ellipseDecisionRequired = false;
      ellipseStatus.textContent = 'This edge suggestion is unavailable.';
      syncEllipseReviewPresentation();
      syncCandidateApply(); scheduleCropPreview();
    }
  } finally {
    if (request === ellipseFitRequest) {
      ellipseFitBusy = false; ellipseFitButton.disabled = false;
      ellipseRangeControls.forEach(control => { control.disabled = !ellipseFitActive; });
      refineButton.disabled = candidateBusy || !selectedCandidate; otherButton.disabled = candidateBusy || candidateChoices.length === 0;
      syncManualMode(); syncCandidateApply();
    }
  }
}
function restoreCircleFit() {
  clearEllipseFit('The alternate crop is ready to use.');
  if (selectedCandidate) { const crop = candidateCrop(selectedCandidate); if (crop) setCrop(crop, { invalidate: false }); }
  syncManualMode(); scheduleCropPreview();
  $('photo-crop-help').hidden = true;
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
  const fragment = document.createDocumentFragment();
  candidateChoices.forEach((candidate, index) => {
    const selected = selectedCandidate?.id === candidate.id;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'circle-candidate'; button.setAttribute('aria-pressed', String(selected));
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128; canvas.setAttribute('aria-hidden', 'true'); drawCandidateThumbnail(canvas, candidate, selected);
    const label = document.createElement('span'); const reference = candidateChoices[0];
    const dr = candidate.circle.radius - reference.circle.radius, dx = candidate.circle.x - reference.circle.x, dy = candidate.circle.y - reference.circle.y;
    const explanation = index === 0 ? 'Initial crop' : Math.abs(dr) > 1 ? dr > 0 ? 'Larger crop' : 'Smaller crop' : Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'Shifted right' : 'Shifted left' : Math.abs(dy) > 1 ? dy > 0 ? 'Shifted downward' : 'Shifted upward' : 'Nearby crop';
    const compactExplanation = explanation === 'Initial crop' ? 'Initial' : explanation.replace(/ crop$/, '').replace(/^Shifted /, 'Move ');
    label.textContent = `${index + 1} · ${compactExplanation}`; button.setAttribute('aria-label', `Crop ${index + 1}, ${explanation}${selected ? ', selected' : ''}`);
    button.append(canvas, label); button.addEventListener('click', () => chooseCandidate(candidate)); fragment.append(button);
  });
  candidateList.append(fragment); syncEllipseReviewPresentation(); refineButton.disabled = candidateBusy || ellipseFitBusy || !selectedCandidate; otherButton.disabled = candidateBusy || ellipseFitBusy || candidateChoices.length === 0; syncCandidateApply(); requestAnimationFrame(sizeCropStage);
}
function clearCandidateSelection() { if (!selectedCandidate) return; selectedCandidate = null; renderCandidateChoices(); }
function chooseCandidate(candidate: CircleCandidate) {
  const crop = candidateCrop(candidate); if (!crop) return;
  clearEllipseFit('Alternate crop selected.'); invalidateCircleFit(); selectedCandidate = candidate; setCrop(crop, { invalidate: false }); renderCandidateChoices(); syncManualMode();
  $('crop-adjust-help').textContent = 'Drag the photo to reposition the edge. Use the handle to resize. Changes stay inside the photo.';
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
  $('crop-adjust-help').textContent = operation === 'refine' ? 'Looking for nearby crop options…' : operation === 'other' ? 'Looking for other crop options…' : 'Looking for crop options…';
  try {
    const result = await composeCircleCandidateChoices(experience.pxc, session, ++circleFitSerial, { operation, ...(operation === 'refine' && anchor ? { selected: anchor } : {}), ...(operation === 'other' ? { excluded: seenCandidates } : {}) });
    if (request !== candidateRequest || session !== candidateSession || bitmap !== cropBitmap || working !== cropWorking) return;
    candidateBusy = false;
    const rows = result.proposal.status === 'accepted' ? result.proposal.candidates as CircleCandidate[] : [];
    if (!rows.length) {
      if ((operation === 'other' || operation === 'refine') && previousSelection) {
        candidateChoices = previousChoices; selectedCandidate = previousSelection; renderCandidateChoices();
        $('crop-adjust-help').textContent = operation === 'refine' ? 'No better option was found. The current edge is still ready.' : 'No other crop options were found. The current edge is still ready.';
        return;
      }
      candidateChoices = []; selectedCandidate = null; renderCandidateChoices(); manualCrop.open = true; syncManualMode();
      $('crop-adjust-help').textContent = 'No crop options were found. Drag the edge or use the precise controls.';
      return;
    }
    if (operation === 'refine') {
      if (!anchor || !sameCandidateCircle(rows[0], anchor)) throw Error('Refine did not retain the selected circle.');
      selectedCandidate = rows[0];
    }
    candidateChoices = rows;
    if (operation === 'initial' || operation === 'other') { seenCandidates = [...seenCandidates, ...rows]; if (operation === 'other') selectedCandidate = null; }
    renderCandidateChoices();
    $('crop-adjust-help').textContent = operation === 'refine' ? 'The current option is kept first. Choose another only if it looks better.' : 'Choose another crop only if it follows the edge more closely.';
  } catch {
    if (request !== candidateRequest || session !== candidateSession) return;
    candidateBusy = false; candidateChoices = previousChoices; selectedCandidate = previousSelection; renderCandidateChoices(); if (!previousSelection) manualCrop.open = true; syncManualMode();
    $('crop-adjust-help').textContent = previousSelection ? 'Options unavailable. The current edge is still ready.' : 'Options unavailable. Drag the edge or use the precise controls.';
  }
}
async function prepareAutomaticCrop() {
  const bitmap = cropBitmap, session = candidateSession;
  if (!bitmap || !session) return;
  const request = ++automaticFitRequest, ellipseRequest = ++ellipseFitRequest;
  const startedAt = performance.now();
  automaticFitBusy = true; automaticFitReady = false; ellipseDecisionRequired = true; ellipseFitBusy = true;
  candidateBusy = true; invalidateCircleFit(); endCropGesture();
  $('photo-crop-help').hidden = true;
  cropApply.textContent = 'Preparing…'; cropApply.disabled = true;
  cropStage.setAttribute('aria-busy', 'true'); cropStage.dataset.automaticFit = 'pending';
  syncManualMode(); syncCandidateApply();
  const circleSearch = composeCircleCandidateChoices(experience.pxc, session, ++circleFitSerial, { operation: 'initial' });
  const ellipseReview = reviewEllipsePhoto(bitmap, () => request === automaticFitRequest && ellipseRequest === ellipseFitRequest && bitmap === cropBitmap);
  const [circleResult, ellipseResult] = await Promise.allSettled([circleSearch, ellipseReview]);
  if (request !== automaticFitRequest || bitmap !== cropBitmap || session !== candidateSession) return;

  const circleRows = circleResult.status === 'fulfilled' && circleResult.value.proposal.status === 'accepted'
    ? circleResult.value.proposal.candidates as CircleCandidate[] : [];
  const usableCircles = circleRows.filter(candidate => !!candidateCrop(candidate));
  candidateChoices = usableCircles; seenCandidates = [...usableCircles]; selectedCandidate = usableCircles[0] ?? null;
  const proposal = ellipseResult.status === 'fulfilled' ? ellipseResult.value : null;
  const useEllipse = usableAutomaticEllipse(proposal);

  if (useEllipse) {
    ellipseRefinement = proposal.refinement ?? null; ellipseUserEdited = false;
    ellipseDecisionRequired = false;
    syncEllipseControls({ geometry: proposal.ellipse, activate: true });
  } else {
    ellipseFitActive = false; ellipseDecisionRequired = false; ellipseGeometry = null; ellipseControlSnapshot = null;
    ellipseEditedControls.clear(); ellipseRefinement = null; ellipseUserEdited = false;
    ellipseControls.hidden = true; ellipseFineTune.open = false; ellipseFitButton.setAttribute('aria-expanded', 'false');
    ellipseRangeControls.forEach(control => { control.disabled = true; });
    if (selectedCandidate) {
      const crop = candidateCrop(selectedCandidate); if (crop) setCrop(crop, { invalidate: false });
      cropStage.dataset.automaticFit = 'circle';
    } else {
      resetCrop({ invalidate: false }); cropStage.dataset.automaticFit = 'manual';
    }
    publishEllipseReviewInspection();
  }
  if (useEllipse) cropStage.dataset.automaticFit = 'ellipse';
  automaticFitBusy = false; automaticFitReady = true; ellipseFitBusy = false; candidateBusy = false;
  ellipseRangeControls.forEach(control => { control.disabled = !ellipseFitActive; });
  const elapsed = Math.max(0, Math.round(performance.now() - startedAt));
  cropStage.dataset.automaticFitElapsedMs = String(elapsed); cropStage.dataset.automaticFit = useEllipse ? 'ellipse' : selectedCandidate ? 'circle' : 'manual';
  cropStage.removeAttribute('aria-busy'); $('photo-crop-help').hidden = true;
  cropApply.textContent = 'OK';
  syncEllipseReviewPresentation(); renderCandidateChoices(); syncManualMode(); scheduleCropPreview(); syncCandidateApply();
  const instrumented = new URLSearchParams(location.search).get('instrument') === '1' || (window as any).__dsCaptureInstrumentation === true;
  if (instrumented) (window as any).__dsAutomaticFit = Object.freeze({ choice: cropStage.dataset.automaticFit, elapsedMs: elapsed, circleChoices: usableCircles.length, ellipseStatus: proposal?.status ?? (ellipseResult.status === 'rejected' ? 'ERROR' : 'NO_RESULT'), refinementStatus: proposal?.refinement?.status ?? null });
}
let cropFrame = 0;
function scheduleCropPreview() { if (cropFrame) return; cropFrame = requestAnimationFrame(() => { cropFrame = 0; updateCropPreview(); }); }
function sizeCropStage() {
  if (cropGesture) return;
  const width = cropStage.parentElement?.clientWidth ?? 0;
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const mobile = window.matchMedia('(max-width: 700px)').matches;
  const side = Math.floor(Math.min(width, mobile ? viewportHeight * .4 : viewportHeight * .52, mobile ? 420 : 480));
  if (side > 0) {
    cropStage.style.width = `${side}px`; cropStage.style.height = `${side}px`; scheduleCropPreview();
  }
}
const cropStageResize = new ResizeObserver(sizeCropStage); cropStageResize.observe(cropStage.parentElement!);
function stagePoint(event: PointerEvent) { const rect = cropStage.getBoundingClientRect(); return { x:event.clientX - rect.left, y:event.clientY - rect.top }; }
function currentStageView(crop: PhotoCrop) { const rect = cropStage.getBoundingClientRect(); return fixedCropView(crop, Math.min(rect.width, rect.height)); }
function ellipseHalfExtents(geometry: EllipseGeometry) {
  const cosine = Math.cos(geometry.axisAngle), sine = Math.sin(geometry.axisAngle);
  return { x: Math.hypot(geometry.radiusX * cosine, geometry.radiusY * sine), y: Math.hypot(geometry.radiusX * sine, geometry.radiusY * cosine) };
}
function moveEllipseWithinSource(geometry: EllipseGeometry, deltaX: number, deltaY: number): EllipseGeometry | null {
  if (!cropBitmap) return null;
  const half = ellipseHalfExtents(geometry);
  const moved = { ...geometry,
    centerX: clamp(geometry.centerX + deltaX, half.x, cropBitmap.width - 1 - half.x),
    centerY: clamp(geometry.centerY + deltaY, half.y, cropBitmap.height - 1 - half.y),
  };
  return validEllipse(moved) ? moved : null;
}
function resizeEllipseWithinSource(geometry: EllipseGeometry, deltaOnMajorAxis: number): EllipseGeometry | null {
  if (!cropBitmap) return null;
  const shortSide = ellipseShortSide(), half = ellipseHalfExtents(geometry);
  const maximumScale = Math.min(
    ellipseMajorRadiusLimit() * shortSide / geometry.radiusX,
    .5 * shortSide / geometry.radiusY,
    geometry.centerX / half.x,
    (cropBitmap.width - 1 - geometry.centerX) / half.x,
    geometry.centerY / half.y,
    (cropBitmap.height - 1 - geometry.centerY) / half.y,
  );
  const minimumScale = Math.max(.03 * shortSide / geometry.radiusX, .03 * shortSide / geometry.radiusY);
  if (!Number.isFinite(maximumScale) || maximumScale < minimumScale) return null;
  const scale = clamp((geometry.radiusX + deltaOnMajorAxis) / geometry.radiusX, minimumScale, maximumScale);
  const resized = { ...geometry, radiusX: geometry.radiusX * scale, radiusY: geometry.radiusY * scale };
  return validEllipse(resized) ? resized : null;
}
function beginCropGesture(event: PointerEvent, mode: CropGesture['mode']) {
  if (!manualCrop.open || automaticFitBusy || ellipseFitBusy || ellipseDecisionRequired || cropGesture || !event.isPrimary || event.button !== 0 || !cropWorking || !cropBitmap) return;
  const ellipse = ellipseFitActive && ellipseGeometry ? { ...ellipseGeometry } : undefined;
  const crop = ellipse ? { centerX: ellipse.centerX / cropBitmap.width, centerY: ellipse.centerY / cropBitmap.height, radiusX: ellipse.radiusX / cropBitmap.width, radiusY: ellipse.radiusY / cropBitmap.height, rotation: 0 } : cropState();
  const view = currentStageView(crop); if (!view) return;
  const point = stagePoint(event), placement = ellipse ? sourceImagePlacement(cropBitmap.width, cropBitmap.height, Math.min(cropStage.clientWidth, cropStage.clientHeight)) : null;
  const ellipseCenterScreen = ellipse && placement ? { x: placement.x + ellipse.centerX * placement.scale, y: placement.y + ellipse.centerY * placement.scale } : undefined;
  const radiusCenter = ellipseCenterScreen ?? { x: view.centerX, y: view.centerY };
  cropGesture = { mode, pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, startPointerRadius: Math.hypot(point.x - radiusCenter.x, point.y - radiusCenter.y), crop, view, ellipse, ellipseCenterScreen };
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
  if (gesture.ellipse) {
    const sourceDx = (event.clientX - gesture.startClientX) / gesture.view.scale, sourceDy = (event.clientY - gesture.startClientY) / gesture.view.scale;
    const next = gesture.mode === 'pan'
      ? moveEllipseWithinSource(gesture.ellipse, sourceDx, sourceDy)
      : resizeEllipseWithinSource(gesture.ellipse, sourceDx * Math.cos(gesture.ellipse.axisAngle) + sourceDy * Math.sin(gesture.ellipse.axisAngle));
    if (next) {
      ellipseUserEdited = true;
      syncEllipseControls({ geometry: next, activate: true, preserveExact: true });
      scheduleCropPreview(); syncCandidateApply();
    }
  } else if (gesture.mode === 'pan') {
    const sourceX = (event.clientX - gesture.startClientX) / gesture.view.scale, sourceY = (event.clientY - gesture.startClientY) / gesture.view.scale;
    setCrop(panCircleCrop(cropBitmap.width, cropBitmap.height, gesture.crop, sourceX * Math.cos(gesture.crop.rotation) + sourceY * Math.sin(gesture.crop.rotation), -sourceX * Math.sin(gesture.crop.rotation) + sourceY * Math.cos(gesture.crop.rotation)), { invalidate: false });
  } else {
    const point = stagePoint(event), delta = Math.hypot(point.x - gesture.view.centerX, point.y - gesture.view.centerY) - gesture.startPointerRadius;
    setCrop(resizeCircleCropByScreenDelta(cropBitmap.width, cropBitmap.height, gesture.crop, delta, gesture.view.scale), { invalidate: false });
  }
});
for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) cropStage.addEventListener(eventName, event => endCropGesture(event as PointerEvent));
function stepZoom(deltaPercent:number){ if (!cropBitmap) return; invalidateCircleFit(); if (ellipseFitActive && ellipseGeometry) { const next = resizeEllipseWithinSource(ellipseGeometry, Math.min(cropBitmap.width, cropBitmap.height) * deltaPercent / 200); if (next) { ellipseUserEdited = true; syncEllipseControls({ geometry: next, activate: true, preserveExact: true }); scheduleCropPreview(); syncCandidateApply(); } } else { clearCandidateSelection(); setCrop(resizeCircleCrop(cropBitmap.width, cropBitmap.height, cropState(), deltaPercent), { invalidate:false }); } }
for (const button of root.querySelectorAll<HTMLButtonElement>('[data-zoom-delta]')) button.addEventListener('click',()=>stepZoom(Number(button.dataset.zoomDelta)));
refineButton.addEventListener('click', () => loadCircleCandidates('refine'));
otherButton.addEventListener('click', () => loadCircleCandidates('other'));
ellipseFitButton.addEventListener('click', () => void tryEllipseFit());
$('crop-ellipse-reset').addEventListener('click', restoreCircleFit);
for (const control of ellipseRangeControls) control.addEventListener('input', () => { ellipseEditedControls.add(control.id); if (ellipseFitActive) ellipseUserEdited = true; syncEllipseControls({ activate: ellipseFitActive }); syncCandidateApply(); scheduleCropPreview(); });
manualCrop.addEventListener('toggle', () => { if (manualCrop.open) { ($('crop-adjust-help') as HTMLElement).textContent = ellipseFitActive ? 'Drag the edge to reposition it. Use the handle to resize. Changes stay inside the photo.' : 'Drag the photo to reposition the edge. Use the handle to resize. Changes stay inside the photo.'; } syncManualMode(); }); syncManualMode();
function discardPendingPhoto() {
  automaticFitRequest++; automaticFitBusy = false; automaticFitReady = false;
  clearEllipseFit(); refitAttempt = null; pendingSampleDetails = null; cropApply.textContent = 'OK'; cropStage.removeAttribute('aria-busy'); cropStage.dataset.automaticFit = 'idle';
  endCropGesture(); invalidateCircleFit(); candidateSession = null; resetCandidateChoices(); manualCrop.open = false; syncManualMode();
  clearRefinementHistory(); refinementEllipseMode=false; refinementFrozenProjection=null; refinementLastSource=null; refinementLastSnapshot=null; refinementLastResult=null;
  if (cropBitmap) cropBitmap.dispose(); cropBitmap = null; cropFile = null; cropWorking = null; refinementRenderer.clear(); input('photo').value = '';
  syncCandidateApply();
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
async function openPhoto(file: File) {
  if (!catalogReady) return;
  photoBusy = true; input('photo').disabled = true; input('save').disabled = true; input('shuffle').disabled = true; $('photo-status').textContent = `Preparing ${file.name} on this device…`;
  try {
    if (file.size > 15_000_000) throw Error('Choose a photo under 15 MB. Your prepared photo is unchanged.');
    discardPendingPhoto(); cropFile = file; cropBitmap = await decodePhoto(file);
    const workingScale = Math.min(1, 720 / Math.max(cropBitmap.width, cropBitmap.height)); cropWorking = document.createElement('canvas'); cropWorking.width = Math.max(1, Math.round(cropBitmap.width * workingScale)); cropWorking.height = Math.max(1, Math.round(cropBitmap.height * workingScale)); cropWorking.getContext('2d')!.drawImage(cropBitmap.image,0,0,cropWorking.width,cropWorking.height);
    resetCrop({ invalidate: false }); candidateSession = createCircleCandidateSession(experience.pxc, cropBitmap.image, cropBitmap.width, cropBitmap.height, cropWorking, ++circleFitSerial, { clampCropSelection });
    ($('photo-crop') as HTMLDialogElement).showModal(); requestAnimationFrame(sizeCropStage); $('crop-cancel').focus(); void prepareAutomaticCrop(); return true;
  } catch (error) { discardPendingPhoto(); photoBusy = false; input('photo').disabled = false; input('shuffle').disabled = false; const message = `Photo could not open: ${String(error).replace(/^Error: /, '')}`; $('photo-status').textContent = message; $('status').textContent = message; updateSaveState(); return false; }
}
async function openRefit(address: string | null = null) {
  if (photoBusy) return;
  try {
    if (address && !experience.shelf().some(row => row.address === address)) throw Error('This disc changed. Open its current version.');
    const held = address ? experience.depictionSources(address).photo : photo;
    if (!held?.refit) throw Error('This earlier photo has no retained crop surroundings. Choose a new photo to replace it.');
    const source = validateRefitSource(held.refit);
    photoBusy = true; input('photo').disabled = true; updateSaveState();
    discardPendingPhoto(); cropFile = new File([await (await fetch(source.src)).blob()], held.name); cropBitmap = await decodePhoto(cropFile);
    if (cropBitmap.width !== source.width || cropBitmap.height !== source.height) throw Error('Saved source dimensions differ.');
    const scale = Math.min(1, 720 / Math.max(source.width, source.height)); cropWorking = document.createElement('canvas'); cropWorking.width = Math.max(1, Math.round(source.width * scale)); cropWorking.height = Math.max(1, Math.round(source.height * scale)); cropWorking.getContext('2d')!.drawImage(cropBitmap.image, 0, 0, cropWorking.width, cropWorking.height);
    refitAttempt = { address, source, name: held.name };
    if (source.version === 2 && source.kind === 'ellipse') {
      if (!ellipseFitsControlRanges(source)) throw Error('Saved ellipse geometry is outside the editable crop bounds.');
      manualCrop.open = false; syncManualMode();
      setCrop({ centerX: source.centerX / source.width, centerY: source.centerY / source.height, radiusX: Math.min(source.radiusX, source.radiusY) / source.width, radiusY: Math.min(source.radiusX, source.radiusY) / source.height, rotation: source.rotation }, { invalidate: false });
      syncEllipseControls({ geometry: source, activate: true, preserveExact: true });
      ellipseStatus.textContent = 'Crop reopened. Adjust the dots, then hit OK.';
    } else {
      manualCrop.open = false; syncManualMode();
      setCrop({ centerX: source.centerX / source.width, centerY: source.centerY / source.height, radiusX: source.radius / source.width, radiusY: source.radius / source.height, rotation: source.rotation }, { invalidate: false });
    }
    automaticFitReady = true;
    cropApply.textContent = 'OK'; $('photo-crop-help').textContent = 'Adjust the dots, then hit OK.';
    ($('photo-crop') as HTMLDialogElement).showModal(); requestAnimationFrame(sizeCropStage); syncCandidateApply();
  } catch (error) { discardPendingPhoto(); finishPhotoPreparation(); const message = `Re-crop could not open: ${String(error).replace(/^Error: /, '')}`; $('status').textContent = message; $('photo-status').textContent = message; }
}
$('photo-recrop').addEventListener('click', () => void openRefit());
document.addEventListener('discstudio:refit-disc', event => { const address = (event as CustomEvent).detail?.address; if (typeof address === 'string') void openRefit(address); });
$('photo').addEventListener('change', () => { const file = input('photo').files?.[0]; if (file) void openPhoto(file); });
samplePicker.addEventListener('click', async event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.sample-disc');
  if (!button || photoBusy) return;
  const sample = sampleDiscs.find(item => item.id === button.dataset.sampleId);
  if (!sample) return;
  samplePicker.querySelectorAll<HTMLButtonElement>('button').forEach(item => { item.disabled = true; });
  try {
    const response = await fetch(sample.photo); if (!response.ok) throw Error('Sample photo is unavailable.');
    const file = new File([await response.blob()], sample.filename, { type: 'image/jpeg' });
    const row = experience.seedOptions(sample.mold).find(item => item.seed.id === sample.id);
    if (!row) throw Error(`${sample.mold} is missing from the mold catalog.`);
    if (await openPhoto(file)) pendingSampleDetails = { row, plastic: sample.plastic };
  } catch (error) { const message = `Sample could not open: ${String(error).replace(/^Error: /, '')}`; $('photo-status').textContent = message; $('status').textContent = message; }
  finally { samplePicker.querySelectorAll<HTMLButtonElement>('button').forEach(item => { item.disabled = false; }); }
});
function finishPhotoPreparation() { photoBusy = false; input('photo').disabled = false; input('shuffle').disabled = false; updateSaveState(); enforceCatalogAvailability(); }
$('crop-cancel').addEventListener('click', () => { const wasRefit = !!refitAttempt?.address; invalidateCircleFit(); ($('photo-crop') as HTMLDialogElement).close(); discardPendingPhoto(); const message = wasRefit ? 'Re-crop cancelled. Saved Disc unchanged.' : photo ? 'Photo crop cancelled. Your prepared photo is unchanged.' : 'Photo crop cancelled.'; $('photo-status').textContent = message; $('status').textContent = message; finishPhotoPreparation(); });
$('photo-crop').addEventListener('cancel', event => { event.preventDefault(); $('crop-cancel').click(); });
$('photo-crop').addEventListener('close', () => { automaticFitRequest++; automaticFitBusy = false; endCropGesture(); invalidateCircleFit(); invalidateEllipseFit(); });
input('crop-rotation').addEventListener('input', () => { cropRotation = Number(input('crop-rotation').value) * Math.PI / 180; $('crop-rotation-value').textContent = `${Math.round(Number(input('crop-rotation').value))}°`; scheduleCropPreview(); });
for (const id of cropIds) input(id).addEventListener('input', scheduleCropPreview);
$('crop-reset').addEventListener('click', () => {
  clearEllipseFit('The edge is centered and ready to adjust.'); invalidateCircleFit(); clearCandidateSelection(); resetCrop({ invalidate: false });
  $('crop-adjust-help').textContent = 'Drag the photo to reposition the edge. Use the handle to resize. Changes stay inside the photo.';
});
$('crop-apply').addEventListener('click', async () => {
  const circleReady = !ellipseDecisionRequired && (automaticFitReady || !!selectedCandidate || manualCrop.open);
  if (!cropBitmap || !cropFile || (ellipseFitActive ? !validEllipse(ellipseGeometry) : !circleReady)) return;
  const apply = cropApply; apply.disabled = true;
  const previousDetails = { seed: input('seed').value, search: input('mold-search').value, plastic: input('plastic').value };
  let sampleDetailsChanged = false;
  try {
    const bitmap = cropBitmap, fileName = cropFile.name, attempt = refitAttempt;
    automaticFitRequest++; automaticFitBusy = false; invalidateCircleFit(); invalidateEllipseFit();
    const photoDepiction: Depiction = ellipseFitActive
      ? prepareEllipsePhoto(bitmap.image, bitmap.width, bitmap.height, { ...ellipseGeometry!, rotation: cropRotation }, fileName, undefined, attempt?.source)
      : prepareCirclePhoto(bitmap.image, bitmap.width, bitmap.height, clampCircleCropSelection(bitmap.width, bitmap.height, cropState()), fileName, undefined, attempt?.source);
    if (attempt?.address) {
      const candidate = await experience.updateDepiction(attempt.address, { photo: photoDepiction, choice: 'photo' });
      const kept = await experience.keepDisc(attempt.address, candidate);
      ($('photo-crop') as HTMLDialogElement).close(); discardPendingPhoto(); finishPhotoPreparation();
      onSaved(kept); $('status').textContent = `Re-crop kept. ${experience.persistenceStatus}`; return;
    }
    if (pendingSampleDetails) {
      const hints = pendingSampleDetails; sampleDetailsChanged = true; await chooseSeed(hints.row);
      input('plastic').value = hints.plastic;
    }
    await experience.addDraftPhoto(photoDepiction);
    photo = photoDepiction; depiction = photoDepiction; savedPhotoConsumed = false;
    ($('photo-crop') as HTMLDialogElement).close(); discardPendingPhoto(); const message = input('seed').value ? 'Photo ready.' : 'Photo ready. Select a manufacturer and mold.'; $('photo-status').textContent = message; $('status').textContent = message; finishPhotoPreparation(); preview();
  } catch (error) {
    if (sampleDetailsChanged) { input('seed').value = previousDetails.seed; input('mold-search').value = previousDetails.search; suggestPlastics(); input('plastic').value = previousDetails.plastic; }
    ($('photo-crop') as HTMLDialogElement).close(); discardPendingPhoto(); const message = `Photo could not be kept: ${String(error).replace(/^Error: /, '')}`; $('photo-crop-help').textContent = message; $('photo-status').textContent = message; $('status').textContent = message; finishPhotoPreparation(); preview();
  } finally { syncCandidateApply(); }
});
$('composer').addEventListener('submit', async event => {
  event.preventDefault(); if (photoBusy || input('save').disabled) return;
  input('save').disabled = true;
  try {
    const material = draft();
    const address = await experience.save(material, depiction, { photo, ...(paintedDiscsEnabled && depiction.kind === 'painted' ? { recipe: recipe(material) } : {}) });
    onSaved(address);
    const storage = experience.persistenceStatus;
    $('status').textContent = storage.startsWith('Saved on this browser')
      ? 'Saved to Today’s Bag.'
      : `Added to Today’s Bag. ${storage}`;
    input('photo').value = '';
    for (const field of flightFields) { input(`own-${field}`).checked = false; input(`disc-${field}`).value = ''; input(`disc-${field}`).disabled = true; }
    // The saved photo is consumed by model.save(). A new composition waits
    // for its own crop instead of reusing an older draft-photo Part.
    depiction = painting; photo = null; savedPhotoConsumed = true;
    $('photo-status').textContent = storage.startsWith('Saved on this browser')
      ? 'Photo saved to Today’s Bag.'
      : 'Photo added for this session only.';
    input('customize-label').checked = false; input('paint-label').value = ''; resetPaintSeed(); preview();
    $('status').textContent = storage.startsWith('Saved on this browser') ? 'Saved to Today’s Bag.' : `Added to Today’s Bag. ${storage}`;
  } catch (error) { $('status').textContent = `Not saved: ${String(error)}`; }
  finally { updateSaveState(); }
});
input('Color1').value = defaults.Color1; input('Color2').value = defaults.Color2; resetPaintSeed(); suggestPlastics(); preview();
// Static HTML keeps actions disabled while the module graph hashes/opens the
// catalog. Enable them only after their listeners and initial view are ready.
if (catalogReady) {
  input('photo').disabled = false; input('mold-search').disabled = false;
  input('shuffle').disabled = !paintedDiscsEnabled; updateSaveState();
  $('mold-search-status').textContent = 'Type a mold prefix; * matches exactly one character.';
} else enforceCatalogAvailability();
if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('discstudio:upload-ui-ready', {
  detail: { catalogAvailable: catalogReady, readyAt: performance.now() },
}));
return { refresh: preview, openRefit };
}
