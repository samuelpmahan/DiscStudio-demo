// Browser Canvas2D adapter for the shared SpotlightCard draw routines.
import { CARD_SIZE, drawCard, type CardOrientation, type CardPreset, type RendererDisc } from './card-renderer-core.ts';
import { getMoldDetails } from './mold-library.ts';
export { CARD_SIZE };
export type { CardOrientation, CardPreset };

function browserImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Prepared photo could not be read for this card.'));
    image.src = source;
  });
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Browser could not encode the card PNG.')), 'image/png'));
}

export async function renderCardBlob(disc: RendererDisc, orientation: CardOrientation, preset?: CardPreset): Promise<Blob> {
  const { w, h } = CARD_SIZE[orientation];
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas2D is unavailable in this browser.');
  await drawCard(context, disc, orientation, preset, { loadImage: browserImage, getMoldDetails, strictPhoto: true });
  return canvasBlob(canvas);
}

export async function renderCardPreview(disc: RendererDisc, orientation: CardOrientation, preset?: CardPreset): Promise<string> {
  return URL.createObjectURL(await renderCardBlob(disc, orientation, preset));
}
