import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIES, render } from './vendor/painter/painter.mjs';
import { initialDraft } from './model.ts';
import { renderDiscPainting } from './paint.ts';
import { recipeFromDraft, renderDepiction, validatePaintRecipe, type PaintRecipe } from './paint-recipe.ts';

const seed = { manufacturer: 'Discraft', name: 'Buzzz' };
const base: PaintRecipe = { family: 'pressed-fern', seed: 42, base: '#f8f1dc', accent: '#24594b', target: 220, label: null, mode: 'solid' };
const asImage = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

test('legacy renderDiscPainting keeps its archived byte behavior', () => {
  const depiction = { kind: 'painted' as const, name: 'chevron-run', src: './art/chevron-run.svg' };
  const plain = { ...initialDraft(), nickname: 'Archive fixture' };
  assert.equal(renderDiscPainting({ draft: plain, depiction }), asImage(render('chevron-run', 41, '#f8f1dc', '#24594b', 220, 'Archive fixture')));
  const photo = { kind: 'photo' as const, name: 'exact.webp', src: 'data:image/webp;base64,AAAA' };
  assert.equal(renderDiscPainting({ draft: plain, depiction: photo }), photo.src);
});

test('validates a frozen null-live or trimmed fixed-label recipe and rejects malformed present recipes', () => {
  assert.equal(validatePaintRecipe(base).label, null);
  const fixed = validatePaintRecipe({ ...base, label: '  Ace disc  ' });
  assert.equal(fixed.label, 'Ace disc'); assert.equal(Object.isFrozen(fixed), true);
  for (const recipe of [
    { ...base, family: 'missing' }, { ...base, seed: NaN }, { ...base, base: 'red' },
    { ...base, target: 100 }, { ...base, label: '' }, { ...base, mode: 'gradient' },
  ]) assert.throws(() => validatePaintRecipe(recipe as PaintRecipe));
});

test('derives legacy recipe inputs without implying a painting label', () => {
  const plain = recipeFromDraft(initialDraft(), { kind: 'painted', name: 'pressed-fern', src: './art/pressed-fern.svg' });
  assert.deepEqual(plain, { ...base, seed: 40 });
  const colored = recipeFromDraft({ ...initialDraft(), colorPainting: true, paintMode: 'halo' }, { kind: 'painted', name: 'contour-basin', src: './art/contour-basin.svg' });
  assert.deepEqual(colored, { family: 'contour-basin', seed: 42, base: '#98d4ba', accent: '#f8b393', target: 220, label: null, mode: 'halo' });
});

test('same bound inputs render byte-identically and every bundled family renders', () => {
  assert.equal(renderDepiction({ recipe: base, photo: null, choice: 'painted', seed }), renderDepiction({ recipe: base, photo: null, choice: 'painted', seed }));
  for (const family of FAMILIES) assert.match(decodeURIComponent(renderDepiction({ recipe: { ...base, family }, photo: null, choice: 'painted', seed })), /<svg/);
});

test('photo passes through exactly and a selected missing or invalid photo refuses', () => {
  const photo = { kind: 'photo' as const, name: 'exact.webp', src: 'data:image/webp;base64,AAAA' };
  assert.equal(renderDepiction({ recipe: base, photo, choice: 'photo', seed }), photo.src);
  assert.throws(() => renderDepiction({ recipe: base, photo: null, choice: 'photo', seed }), /no valid prepared photo/);
  assert.throws(() => renderDepiction({ recipe: base, photo: { ...photo, src: 'javascript:bad' }, choice: 'photo', seed }), /no valid prepared photo/);
});

test('solid, split and halo palettes differ; labels are optional and bounded', () => {
  const solid = renderDepiction({ recipe: base, photo: null, choice: 'painted', seed });
  const split = renderDepiction({ recipe: { ...base, mode: 'split' }, photo: null, choice: 'painted', seed });
  const halo = renderDepiction({ recipe: { ...base, mode: 'halo' }, photo: null, choice: 'painted', seed });
  assert.notEqual(solid, split); assert.notEqual(split, halo); assert.notEqual(solid, halo);
  const renamed = { ...seed, name: 'Buzzz GT' };
  assert.equal(renderDepiction({ recipe: base, photo: null, choice: 'painted', seed }), renderDepiction({ recipe: base, photo: null, choice: 'painted', seed: renamed }));
  assert.doesNotMatch(decodeURIComponent(solid), /Discraft|Buzzz/);
  const labeled = { ...base, label: 'MVP · Servo' };
  for (const family of FAMILIES) {
    const unlabeledSvg = decodeURIComponent(renderDepiction({ recipe: { ...base, family }, photo: null, choice: 'painted', seed }));
    const labeledSvg = decodeURIComponent(renderDepiction({ recipe: { ...labeled, family }, photo: null, choice: 'painted', seed }));
    assert.doesNotMatch(unlabeledSvg, /Discraft|Buzzz|id="plaque"/);
    assert.match(labeledSvg, /MVP · Servo/);
    const labelFont = labeledSvg.match(/<text[^>]*font-size="([0-9.]+)"[^>]*>MVP · Servo/);
    if (labelFont) assert.ok(Number(labelFont[1]) >= 18, `${family} label font is too small: ${labelFont[1]}`);
  }
  const long = decodeURIComponent(renderDepiction({ recipe: { ...base, label: 'A very long custom painting label that should degrade gracefully' }, photo: null, choice: 'painted', seed }));
  assert.match(long, /A very long/); assert.doesNotMatch(long, /<text[^>]*>A very long custom painting label/);
  const fixed = { ...base, label: 'My ace disc' };
  assert.equal(renderDepiction({ recipe: fixed, photo: null, choice: 'painted', seed }), renderDepiction({ recipe: fixed, photo: null, choice: 'painted', seed: renamed }));
});
