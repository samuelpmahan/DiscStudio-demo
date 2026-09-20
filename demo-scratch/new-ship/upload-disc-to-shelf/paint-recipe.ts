/**
 * PnC adapter for Boone's retained paint recipe and live-label contract.
 * Source: DiscStudio staging ec1141f, introduced by 70cac39.
 */
import { FAMILIES } from './vendor/painter/painter.mjs';
import { TARGETS } from './vendor/painter/core.mjs';
import { renderPalettePainting } from './paint.ts';
import type { Depiction, Draft, Mold } from './model.ts';

export type PaintRecipe = Readonly<{
  family: string;
  seed: number;
  base: string;
  accent: string;
  target: 42 | 96 | 220;
  label: string | null;
  mode: 'solid' | 'split' | 'halo';
}>;

const photoPattern = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
const colorPattern = /^#[0-9a-f]{6}$/i;

export function validatePaintRecipe(recipe: PaintRecipe): PaintRecipe {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) throw new Error('A paint recipe is an object.');
  const { family, seed, base, accent, target, label, mode } = recipe;
  if (!FAMILIES.includes(family)) throw new Error(`Unknown painter family '${family}'.`);
  if (!Number.isFinite(seed)) throw new Error('A paint recipe seed is a finite number.');
  if (!colorPattern.test(base) || !colorPattern.test(accent)) throw new Error('Paint recipe colors must be #rrggbb values.');
  if (!TARGETS.includes(target)) throw new Error(`A paint recipe target is one of ${TARGETS.join(', ')}.`);
  if (label !== null && (typeof label !== 'string' || !label.trim())) throw new Error('A paint recipe label is null for a live label, or fixed nonblank text.');
  if (!['solid', 'split', 'halo'].includes(mode)) throw new Error('A paint recipe mode is solid, split or halo.');
  return Object.freeze({ family, seed, base, accent, target, label: label === null ? null : label.trim(), mode });
}

export function recipeFromDraft(draft: Draft, depiction: Depiction): PaintRecipe {
  if (depiction.kind !== 'painted') throw new Error('A paint recipe requires a painted depiction.');
  const legacyFamilies = ['pressed-fern', 'chevron-run', 'contour-basin'];
  const index = legacyFamilies.indexOf(depiction.name);
  if (index < 0) throw new Error('Unknown painting family.');
  return validatePaintRecipe({
    family: depiction.name,
    seed: 40 + index,
    base: draft.colorPainting ? draft.Color1 : '#f8f1dc',
    accent: draft.colorPainting ? draft.Color2 : '#24594b',
    target: 220,
    label: null,
    mode: draft.colorPainting ? draft.paintMode : 'solid',
  });
}

export function renderDepiction({ recipe, photo, choice, seed }: {
  recipe: PaintRecipe;
  photo: Depiction | null;
  choice: 'painted' | 'photo';
  seed: Pick<Mold, 'manufacturer' | 'name'>;
}): string {
  if (choice === 'photo') {
    if (!photo || photo.kind !== 'photo' || !photoPattern.test(photo.src)) throw new Error('The photo depiction has no valid prepared photo.');
    return photo.src;
  }
  if (choice !== 'painted') throw new Error('Choose the painted or photo depiction.');
  const valid = validatePaintRecipe(recipe);
  if (!seed || typeof seed.manufacturer !== 'string' || !seed.manufacturer.trim() || typeof seed.name !== 'string' || !seed.name.trim()) throw new Error('Live depiction labels require manufacturer and mold facts.');
  // null is an intentionally label-free painting. Checked compose labels are
  // materialized by the UI as either custom text or the manufacturer+mold.
  return renderPalettePainting({ ...valid, label: valid.label ?? '' });
}
