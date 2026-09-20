// Native Canvas adapter. All card layouts live in card-renderer-core.ts so the
// browser export uses the same routines and preset registry.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { getMoldDetails } from './mold-library.ts';
import {
  CARD_SIZE,
  drawCard,
  presetRenderers,
  type CardOrientation,
  type CardPreset,
  type RendererDisc,
} from './card-renderer-core.ts';

export { CARD_SIZE, presetRenderers };
export type { CardOrientation, CardPreset };

export async function renderCard(disc: RendererDisc, orientation: CardOrientation, preset?: CardPreset): Promise<Buffer> {
  if (orientation !== 'horizontal' && orientation !== 'vertical') throw new Error(`orientation must be 'horizontal' or 'vertical', got ${String(orientation)}`);
  const { w, h } = CARD_SIZE[orientation];
  const canvas = createCanvas(w, h);
  await drawCard(canvas.getContext('2d'), disc, orientation, preset, { loadImage, getMoldDetails });
  return canvas.toBuffer('image/png');
}

export async function renderCardDataUrl(disc: RendererDisc, orientation: CardOrientation, preset?: CardPreset): Promise<string> {
  const buf = await renderCard(disc, orientation, preset);
  return `data:image/png;base64,${buf.toString('base64')}`;
}
