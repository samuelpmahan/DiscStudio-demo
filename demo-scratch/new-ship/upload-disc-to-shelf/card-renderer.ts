// Native Canvas adapter. All card layouts live in card-renderer-core.ts so the
// browser export uses the same routines and preset registry.
import { createFrameRenderer } from './frame-seek.mjs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { getMoldDetails } from './mold-library.ts';
import type { CardAppearance } from './export-queue-core.ts';
import {
  CARD_SIZE,
  drawCard,
  presetRenderers,
  type CardOrientation,
  type CardPreset,
  type RendererDisc,
} from './card-renderer-core.ts';

export { CARD_SIZE, presetRenderers };
export const nativeFrames = createFrameRenderer({createCanvas});
const photos = new Map<string,Promise<any>>();
export type { CardOrientation, CardPreset };

export async function renderCard(disc: RendererDisc, orientation: CardOrientation, preset?: CardPreset, appearance?: CardAppearance): Promise<Buffer> {
  if (orientation !== 'horizontal' && orientation !== 'vertical') throw new Error(`orientation must be 'horizontal' or 'vertical', got ${String(orientation)}`);
  const { w, h } = CARD_SIZE[orientation];
  const canvas = createCanvas(w, h);
  // NAPI Canvas accepts SVG bytes but not our percent-encoded SVG data URI.
  // The browser adapter continues to pass that URI directly to Image.
  const decodeCardImage = (source: string) => source.startsWith('data:image/svg+xml;charset=utf-8,')
    ? loadImage(Buffer.from(decodeURIComponent(source.slice(source.indexOf(',') + 1))))
    : loadImage(source);
  const loadCardImage = (source:string) => { if (!photos.has(source)) { photos.set(source,decodeCardImage(source)); if(photos.size>8) photos.delete(photos.keys().next().value!); } return photos.get(source)!; };
  await drawCard(canvas.getContext('2d'), disc, orientation, preset, { loadImage: loadCardImage, getMoldDetails, createCanvas, frameRenderer:nativeFrames }, appearance);
  return canvas.toBuffer('image/png');
}

export async function renderCardDataUrl(disc: RendererDisc, orientation: CardOrientation, preset?: CardPreset, appearance?: CardAppearance): Promise<string> {
  const buf = await renderCard(disc, orientation, preset, appearance);
  return `data:image/png;base64,${buf.toString('base64')}`;
}
