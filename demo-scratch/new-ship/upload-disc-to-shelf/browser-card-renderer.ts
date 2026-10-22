// Browser Canvas2D adapter for the shared SpotlightCard draw routines.
import { createFrameRenderer, imageLayer } from './frame-seek.mjs';
import { CARD_SIZE, drawCard, type CardOrientation, type CardPreset, type RendererDisc } from './card-renderer-core.ts';
import { getMoldDetails } from './mold-library.ts';
import { identityTransform } from './transform-geometry.mjs';
import type { CardTransform, CardAppearance } from './export-queue-core.ts';
import { alphaBounds, cardRasterIdentity, createStickerSizer, stickerOrigin } from './sticker-raster.mjs';
export { CARD_SIZE };
export type { CardOrientation, CardPreset };

function decodeBrowserImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Prepared photo could not be read for this card.'));
    image.src = source;
  });
}

const createBrowserCanvas = (width:number,height:number) => { const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;return canvas; };
export const browserFrames = createFrameRenderer({createCanvas:createBrowserCanvas});
export const browserStickerSizer = createStickerSizer({createCanvas:createBrowserCanvas,frameRenderer:browserFrames});
export function sizeBrowserSticker(image: CanvasImageSource, nativeWidth: number, nativeHeight: number, nativeBounds: readonly number[], identity: string, scale: number) {
  return browserStickerSizer.size({image,nativeWidth,nativeHeight,nativeBounds,identity,scale});
}
const photos = new Map<string,Promise<HTMLImageElement>>();
function browserImage(source:string) { if(!photos.has(source)){photos.set(source,decodeBrowserImage(source));if(photos.size>8)photos.delete(photos.keys().next().value!);}return photos.get(source)!; }

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Browser could not encode the card PNG.')), 'image/png'));
}

export async function renderCardBlob(disc: RendererDisc, orientation: CardOrientation, preset?: CardPreset, appearance?: CardAppearance): Promise<Blob> {
  const { w, h } = CARD_SIZE[orientation];
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas2D is unavailable in this browser.');
  await drawCard(context, disc, orientation, preset, { loadImage: browserImage, getMoldDetails, strictPhoto: true,createCanvas:createBrowserCanvas,frameRenderer:browserFrames }, appearance);
  return canvasBlob(canvas);
}

export async function renderCardPreview(disc: RendererDisc, orientation: CardOrientation, preset?: CardPreset, appearance?: CardAppearance): Promise<string> {
  return URL.createObjectURL(await renderCardBlob(disc, orientation, preset, appearance));
}

export async function renderPlacedCardBlob(disc: RendererDisc, orientation: CardOrientation, preset?: CardPreset, placement?: CardTransform, appearance?: CardAppearance): Promise<Blob> {
  const transform = placement ?? identityTransform;
  if (transform.scale === 1 && transform.dx === 0 && transform.dy === 0) return renderCardBlob(disc, orientation, preset, appearance);
  const sticker = await renderStickerCardRaster(disc,orientation,preset,transform.scale,appearance);
  const { w, h } = CARD_SIZE[orientation], canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas2D is unavailable in this browser.');
  const origin=stickerOrigin({width:w,height:h,nativeBounds:sticker.nativeBounds,placement:transform,sticker});
  browserFrames.seek(context,{width:w,height:h,layers:[{...imageLayer('placement-card',sticker.identity,sticker.canvas,sticker.width,sticker.height),...origin}]},0);
  return canvasBlob(canvas);
}

export async function renderStickerCardRaster(disc: RendererDisc, orientation: CardOrientation, preset?: CardPreset, scale = 1, appearance?: CardAppearance) {
  const source=await renderCardBlob(disc,orientation,preset,appearance),url=URL.createObjectURL(source);
  try {
    const image=await decodeBrowserImage(url),{w,h}=CARD_SIZE[orientation],native=createBrowserCanvas(w,h),ctx=native.getContext('2d')!;
    ctx.drawImage(image,0,0);
    const bounds=alphaBounds(ctx.getImageData(0,0,w,h).data,w,h);
    return sizeBrowserSticker(image,w,h,bounds,cardRasterIdentity(disc,orientation,preset,appearance),scale);
  } finally { URL.revokeObjectURL(url); }
}
export async function renderStickerCardBlob(disc: RendererDisc, orientation: CardOrientation, preset?: CardPreset, scale = 1, appearance?: CardAppearance): Promise<Blob> {
  return canvasBlob((await renderStickerCardRaster(disc,orientation,preset,scale,appearance)).canvas);
}
