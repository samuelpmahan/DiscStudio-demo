import { createFrameRenderer, imageLayer } from './frame-seek.mjs';
import { renderCardBlob, renderPlacedCardBlob, renderStickerCardBlob, sizeBrowserSticker, browserStickerSizer, type CardOrientation, type CardPreset } from './browser-card-renderer.ts';
import { cardDimensions, cardFilename, defaultCardAppearance, type QueuedCard, type CardAppearance } from './export-queue-core.ts';
import { clampTransform, identityTransform, maxCardScale, resizeCardTransform } from './transform-geometry.mjs';
import { exportBrowserZip, downloadBlob } from './browser-export.ts';
import type { createExperience } from './model.ts';
import { paintedDiscsEnabled } from './kompozition.ts';
import { loadSavedSetup, makeReviewCandidates, pendingCards, storeSavedSetup, transitionCandidate, type ReviewCandidate, type SavedCardSetup } from './batch-review.ts';
import { validateTransform } from './transform-geometry.mjs';
import { reconcileCreatorSelection, setReviewMembership } from './creator-selection.ts';
import { createPlacementGesture, createPreviewDrawScheduler } from './preview-draw-scheduler.mjs';
import { cardRasterIdentity, stickerOrigin } from './sticker-raster.mjs';
import { cardDigitAccentContrast } from './card-renderer-core.ts';
import { drawBackgroundCover, framedCoverSourceRect, effectiveCoverFraming } from './background-cover.mjs';

const PRESETS: { id: CardPreset; orientation: CardOrientation; name: string }[] = [
  { id: 'u01', orientation: 'vertical', name: 'U01 · Compact scorebug' }, { id: 'u02', orientation: 'vertical', name: 'U02 · Stacked poster' },
  { id: 'u03-front', orientation: 'vertical', name: 'U03 · Disc in front' }, { id: 'u03-behind', orientation: 'vertical', name: 'U03 · Disc behind' }, { id: 'u04', orientation: 'vertical', name: 'U04 · Kinetic name' }, { id: 'u05', orientation: 'vertical', name: 'U05 · Glass drawer' },
  { id: 'b01', orientation: 'horizontal', name: 'B01 · Hero rail' }, { id: 'b02', orientation: 'horizontal', name: 'B02 · Split nameplate' },
  { id: 'b03', orientation: 'horizontal', name: 'B03 · Framed hero' }, { id: 'b04', orientation: 'horizontal', name: 'B04 · Peak mark' }, { id: 'b05', orientation: 'horizontal', name: 'B05 · Stamp macro' },
];
type Experience = ReturnType<typeof createExperience>;
type BagRow = ReturnType<Experience['bag']>[number];
type Transform = { scale: number; dx: number; dy: number };
type SceneFraming = { x: number; y: number; zoom: number };
const DEFAULT_CARD_SCALE = .66;
const defaultCardPlacement = (): Transform => ({ scale: DEFAULT_CARD_SCALE, dx: 0, dy: 0 });
const sizePercent = (scale: number) => Math.round(scale / DEFAULT_CARD_SCALE * 100);
export function fitPreviewPlacement(current: Readonly<Transform>, frame: { width: number; height: number }, bounds: readonly number[], maxScale: number): Transform {
  return { ...clampTransform({ width: frame.width, height: frame.height, alphaBounds: [...bounds], scale: Math.min(current.scale, maxScale), dx: current.dx, dy: current.dy }) };
}

export function rescalePreviewPlacement(anchor: Readonly<Transform>, requestedScale: number, maxScale: number, frame: { width: number; height: number }, bounds?: readonly number[]): Transform {
  const next = { ...anchor, scale: Math.min(requestedScale, maxScale) };
  return bounds ? { ...resizeCardTransform({ width: frame.width, height: frame.height, alphaBounds: [...bounds], current: anchor, requestedScale, maxScale }) } : next;
}

export function cloneCard(row: BagRow, orientation: CardOrientation, preset: CardPreset, placement: Transform = identityTransform, cardAppearance?: CardAppearance): QueuedCard {
  const seed = row.seed;
  return { disc: { ...row.disc, depiction: { ...row.disc.depiction }, renderer: { moldName: seed.name, manufacturer: seed.manufacturer, flights: [seed.speed ?? null, seed.glide ?? null, seed.turn ?? null, seed.fade ?? null], ...(row.disc.depiction.kind === 'painted' ? { artSrc: row.art } : {}) } } as any, orientation, cardDesign: preset, placement: Object.freeze({ ...placement }), cardAppearance: { ...(cardAppearance ?? defaultCardAppearance(preset)) } };
}

/** The creator approves one exact native card plus its transform. Backgrounds remain projection-only. */
export function mountExport(experience: Experience, { root = document }: { root?: ParentNode } = {}) {
  const priorShelf = root.querySelector<HTMLElement>('.shelf-section'); if (priorShelf) priorShelf.hidden = true;
  const section = document.createElement('section'); section.id = 'todays-bag'; section.className = 'todays-bag-export';
  section.innerHTML = `<div class="section-title"><div><p class="eyebrow">TODAY’S BAG</p><h2>Make your card.</h2></div><span>03 — place and approve</span></div>
    <p class="subtle">Choose saved discs, size the card, optionally arrange a background preview, then Add to Export. PNG and ZIP contain tightly cropped transparent card stickers.</p>
    <div class="bag-export-grid"><div><div id="bag-export-list" class="bag-export-list" aria-live="polite"></div><p id="bag-export-empty" class="subtle">Save a cropped disc photo to add it here.</p>
      <section class="output-queue" aria-labelledby="output-queue-title"><h3 id="output-queue-title">Approved output</h3><p id="output-approval" class="subtle">Choose a disc, size its card, then Add to Export.</p><p id="output-queue-empty" class="subtle">Nothing approved yet.</p><ol id="output-queue-list"></ol><button id="output-review" type="button" hidden>Review remaining cards</button></section></div>
    <div class="bag-export-controls"><div class="saved-setup"><strong id="saved-setup-label">No saved setup</strong><button id="setup-save" type="button">Save recipe</button><button id="setup-apply" type="button">Apply to selected</button></div><label>Orientation<select id="card-orientation"><option value="vertical">Vertical · 9:16</option><option value="horizontal">Horizontal · 16:9</option></select></label><label>Card layout<select id="card-preset"></select></label>
      <fieldset id="card-style-controls" class="card-style-controls"><legend id="card-style-title">Card details</legend><label><span id="card-side-label">Disc on outside edge</span><select id="card-disc-side"><option value="right">Right</option><option value="left">Left</option></select></label><label>Highlight on<select id="card-highlight-target"><option value="digits">Digits</option><option value="tiles">Tile blocks</option></select></label><label>Highlight color<input id="card-accent-color" type="color" value="#8fe3ae"></label><p id="card-accent-warning" class="card-accent-warning subtle" role="status" hidden>Low contrast: accented text and details may be hard to read. You can still Add to Export. Your chosen color will be kept.</p><p class="subtle">Mirroring moves the layout; the disc photo, text, and flight-value order stay upright. These details stay with each approved card.</p></fieldset>
      <div class="canvas-background-controls"><label>Preview background<select id="canvas-background"><option value="example">Example scene</option><option value="none">No background</option><option value="upload">Upload background…</option></select></label><input id="canvas-background-upload" type="file" accept="image/*" hidden><p class="subtle">Backgrounds fill the selected frame without stretching. Transparent PNG and ZIP omit them. Combined PNG uses the current background fitted to the approved card’s orientation.</p></div>
      <label>Card size <output id="card-scale-value">100%</output> · <output id="card-sticker-size">— pixels</output><input id="card-scale" type="range" min="0.5" max="1.5" step="0.01" value="0.66" aria-valuetext="100%"></label>
      <div id="scene-framing-controls" class="scene-framing-controls" hidden><button id="scene-adjust" type="button" aria-pressed="false">Adjust preview image</button><label>Image focus left / right<input id="scene-pan-x" type="range" min="0" max="100" step="1" value="50"></label><label>Image focus up / down<input id="scene-pan-y" type="range" min="0" max="100" step="1" value="50"></label><label>Scene zoom <output id="scene-zoom-value">100%</output><input id="scene-zoom" type="range" min="1" max="2" step="0.01" value="1"></label><button id="scene-reset" type="button">Reset this frame</button></div>
      <div id="card-preview" class="card-preview"><p class="subtle">Select one saved disc to place a card.</p></div><p id="card-export-status" class="subtle" role="status"></p>
      <div class="card-export-actions"><button id="card-enqueue" class="primary" type="button">Add to Export</button><button id="card-png" type="button">Download sticker PNG</button><button id="card-zip" type="button">Export sticker ZIP</button><button id="card-combined" type="button">Export combined PNG</button></div>
    </div></div>`;
  (priorShelf?.parentElement ?? root.querySelector('main')!).insertBefore(section, priorShelf ?? null);
  const $ = (id: string) => section.querySelector<HTMLElement>(`#${id}`)!;
  const reviewDialog = document.createElement('dialog'); reviewDialog.id = 'batch-review'; reviewDialog.innerHTML = `<form method="dialog" class="batch-review-dialog"><header><div><p class="eyebrow">FINAL REVIEW</p><h2>Approve cards</h2></div><label id="review-background-toggle" class="review-background-toggle" hidden><span>No background</span><input type="checkbox" role="switch" aria-label="Show uploaded test background in review"><span>Test background</span></label><button aria-label="Close review" value="cancel" type="submit">Close</button></header><p id="batch-review-summary" class="subtle"></p><div id="batch-review-list" class="batch-review-list"></div><footer><button id="batch-approve-all" class="primary" type="button">Approve remaining</button><button value="cancel" type="submit">Cancel</button></footer></form>`; section.append(reviewDialog);
  const orientation = $('card-orientation') as HTMLSelectElement, preset = $('card-preset') as HTMLSelectElement, scaleInput = $('card-scale') as HTMLInputElement, backgroundChoice = $('canvas-background') as HTMLSelectElement, upload = $('canvas-background-upload') as HTMLInputElement;
  const cardControls = $('card-style-controls') as HTMLFieldSetElement, cardSide = $('card-disc-side') as HTMLSelectElement, cardHighlight = $('card-highlight-target') as HTMLSelectElement, cardAccent = $('card-accent-color') as HTMLInputElement;
  let selectedAddress = '', selectedAddresses = new Set<string>(), reviewUrls = new Map<string,string>(), reviewGeneration = 0, reviewShowTestBackground = false, savedSetup: SavedCardSetup | null = loadSavedSetup(typeof localStorage === 'undefined' ? null : localStorage), reviewCandidates: readonly ReviewCandidate[] = [], previewSerial = 0, backgroundSerial = 0, busy = false, placement: Transform = defaultCardPlacement(), cardAppearance: CardAppearance = { ...defaultCardAppearance('u02') }, backgroundUrl: string | null = null, uploadedBackground: CanvasImageSource | null = null, chosenBackground: CanvasImageSource | null = null, baseBlob: Blob | null = null, baseImage: HTMLImageElement | null = null, baseImageUrl: string | null = null, alpha: Uint8ClampedArray | null = null, frame = { width:1080,height:1920 };
  let outputReviewAddress: string | null = null;
  let activeBackgroundChoice = backgroundChoice.value;
  let sceneAdjusting = false, uploadGeneration = 0;
  const freshSceneFraming = (): SceneFraming => ({ x: .5, y: .5, zoom: 1 });
  const sceneFraming: Record<CardOrientation, SceneFraming> = { vertical: freshSceneFraming(), horizontal: freshSceneFraming() };
  const framingFor = (direction: CardOrientation) => sceneFraming[direction];
  const reviewBackgroundThumbs = new Map<CardOrientation,string>();
  const perPresetAppearance = new Map<CardPreset, CardAppearance>();
  // A resize sequence derives every requested size from this held placement.
  // Reset only when the card or actual placement changes, never after scale clamping.
  let resizeAnchor: Readonly<Transform> = Object.freeze({ ...placement });
  const resetResizeAnchor = () => { resizeAnchor = Object.freeze({ ...placement }); };
  const showCardSize = () => { const label = `${sizePercent(placement.scale)}%`; $('card-scale-value').textContent = label; scaleInput.setAttribute('aria-valuetext', label); };
  function syncSceneFramingControls() {
    const available = backgroundChoice.value === 'upload' && !!uploadedBackground;
    $('scene-framing-controls').hidden = !available;
    const adjust = $('scene-adjust') as HTMLButtonElement, zoom = $('scene-zoom') as HTMLInputElement, framing=framingFor(orientation.value as CardOrientation);
    adjust.setAttribute('aria-pressed', String(available && sceneAdjusting));
    adjust.textContent = available && sceneAdjusting ? 'Done adjusting image' : 'Adjust preview image';
    zoom.value = String(framing.zoom);
    ($('scene-pan-x') as HTMLInputElement).value=String(Math.round(framing.x*100));
    ($('scene-pan-y') as HTMLInputElement).value=String(Math.round(framing.y*100));
    if(available) { const image=uploadedBackground as HTMLImageElement,size=cardDimensions(orientation.value as CardOrientation),crop=framedCoverSourceRect(image.naturalWidth,image.naturalHeight,size.width,size.height,framing);($('scene-pan-x') as HTMLInputElement).disabled=crop.width>=image.naturalWidth-2;($('scene-pan-y') as HTMLInputElement).disabled=crop.height>=image.naturalHeight-2; }
    $('scene-zoom-value').textContent = `${Math.round(Number(zoom.value) * 100)}%`;
    const canvas = section.querySelector<HTMLCanvasElement>('#placement-canvas');
    if (canvas) canvas.dataset.sceneAdjusting = String(available && sceneAdjusting);
    const hint = section.querySelector<HTMLElement>('#card-preview .placement-hint');
    if (hint) hint.textContent = available && sceneAdjusting ? 'Drag the image to frame the scene. Select Done adjusting image to drag the card.' : baseImage ? 'Drag the card to place it. Sticker export contains only the card.' : hint.dataset.defaultText || hint.textContent;
  }
  function setSceneFraming(direction: CardOrientation, next: SceneFraming) {
    const zoom=Math.min(2,Math.max(1,next.zoom)),image=uploadedBackground as HTMLImageElement|null;
    if(image){const size=cardDimensions(direction);sceneFraming[direction]=effectiveCoverFraming(image.naturalWidth,image.naturalHeight,size.width,size.height,{...next,zoom});}
    else sceneFraming[direction]={x:Math.min(1,Math.max(0,next.x)),y:Math.min(1,Math.max(0,next.y)),zoom};
    backgroundIdentity++;
    reviewBackgroundThumbs.delete(direction);
    syncSceneFramingControls();
    previewDraw.schedule();
  }
  let previewReady=false, baseCardIdentity='';
  const status = (text: string) => { $('card-export-status').textContent = text; };
  const rows = () => experience.bag(), outputQueue = () => experience.outputQueue();
  function updateSetupLabel() { $('saved-setup-label').textContent = savedSetup ? `Saved · ${savedSetup.name}` : 'No saved setup'; ($('setup-apply') as HTMLButtonElement).disabled = !savedSetup || selectedAddresses.size === 0; }
  function selectedRows() { return rows().filter(row => selectedAddresses.has(row.address)); }
  function syncCardControls() {
    const selected = preset.value as CardPreset;
    cardAppearance = perPresetAppearance.get(selected) ?? defaultCardAppearance(selected);
    cardControls.hidden = !selected;
    $('card-style-title').textContent = `${selected.toUpperCase()} card details`; $('card-side-label').textContent = ['u02','u04','u05'].includes(selected) ? 'Card group side' : 'Disc on outside edge';
    const value = cardAppearance;
    cardSide.value = value.discSide; cardHighlight.value = value.highlightTarget; cardAccent.value = value.accentColor;
    $('card-accent-warning').hidden = cardDigitAccentContrast(value.accentColor, preset.value) >= 4.5;
  }
  function readCardControls() {
    cardAppearance = Object.freeze({ discSide: cardSide.value as CardAppearance['discSide'], highlightTarget: cardHighlight.value as CardAppearance['highlightTarget'], accentColor: cardAccent.value.toLowerCase() });
    perPresetAppearance.set(preset.value as CardPreset, cardAppearance);
    $('card-accent-warning').hidden = cardDigitAccentContrast(cardAppearance.accentColor, preset.value) >= 4.5;
    void renderPreview();
  }
  function presets() { const wanted = orientation.value as CardOrientation, previous = preset.value; preset.replaceChildren(...PRESETS.filter(item => item.orientation === wanted).map(item => new Option(item.name, item.id))); preset.value = PRESETS.some(item => item.id === previous && item.orientation === wanted) ? previous : wanted === 'vertical' ? 'u02' : 'b01'; frame = wanted === 'vertical' ? {width:1080,height:1920} : {width:1920,height:1080}; $('card-preview').dataset.orientation=wanted; syncCardControls(); }
  function selectedRow() { return rows().find(row => row.address === selectedAddress) ?? null; }
  function setBusy(value: boolean) { busy = value; for (const button of section.querySelectorAll<HTMLButtonElement>('.card-export-actions button, .output-queue-item button')) button.disabled = value || (button.classList.contains('output-queue-png') && (!experience.latestOutputApproval || !button.closest('li')?.dataset.approvalId)); ($('card-enqueue') as HTMLButtonElement).disabled=value||!previewReady; $('card-enqueue').setAttribute('aria-disabled',String(value||!previewReady)); ($('output-review') as HTMLButtonElement).disabled=value; }
  async function getBackground(direction: CardOrientation, choice = backgroundChoice.value): Promise<CanvasImageSource | null> { if (choice === 'none') return null; if (choice === 'upload') return uploadedBackground; const image = new Image(); image.src = direction === 'vertical' ? './sample-background.svg' : './sample-background-horizontal.svg'; await image.decode(); return image; }
  async function refreshBackground() { const serial=++backgroundSerial, direction=orientation.value as CardOrientation; try { const background=await getBackground(direction); if(serial===backgroundSerial){ chosenBackground=background; backgroundIdentity++; drawPreview();syncSceneFramingControls(); } } catch(error) { if(serial===backgroundSerial) status(`Preview background unavailable: ${String(error)}`); } }
  function previewCanvas() { const canvas=document.createElement('canvas'); canvas.id='placement-canvas'; canvas.width=frame.width; canvas.height=frame.height; canvas.setAttribute('aria-label','Card placement preview'); return canvas; }
  function bindSceneDrag(canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', event=>{
      if(!sceneAdjusting || backgroundChoice.value!=='upload' || !uploadedBackground)return;
      const rect=canvas.getBoundingClientRect(),direction=orientation.value as CardOrientation,image=uploadedBackground as HTMLImageElement,start={...framingFor(direction)},crop=framedCoverSourceRect(image.naturalWidth,image.naturalHeight,frame.width,frame.height,start),startX=event.clientX,startY=event.clientY;
      canvas.setPointerCapture(event.pointerId);
      const move=(next:PointerEvent)=>setSceneFraming(direction,{...start,x:start.x-(next.clientX-startX)/rect.width*crop.width/image.naturalWidth,y:start.y-(next.clientY-startY)/rect.height*crop.height/image.naturalHeight});
      const cleanup=()=>{canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',finish);canvas.removeEventListener('pointercancel',cancel);};
      const finish=(next:PointerEvent)=>{move(next);previewDraw.flush();cleanup();};
      const cancel=()=>{setSceneFraming(direction,start);previewDraw.flush();cleanup();};
      canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',cancel);
    });
  }
  function showCanvas(canvas: HTMLCanvasElement, hintText: string) { const header=document.createElement('div'),label=document.createElement('p'),choose=document.createElement('button'),hint=document.createElement('p'); header.className='canvas-preview-header';label.className='canvas-frame-label'; label.textContent=`${orientation.value === 'vertical' ? 'Vertical · 9:16' : 'Horizontal · 16:9'} canvas · ${frame.width} × ${frame.height}`;choose.id='choose-preview-image';choose.type='button';choose.textContent='Choose preview image';choose.setAttribute('aria-label','Choose preview image');choose.onclick=()=>upload.click();header.append(label,choose);hint.className='placement-hint';hint.textContent=hintText;hint.dataset.defaultText=hintText;$('card-preview').replaceChildren(header,canvas,hint);bindSceneDrag(canvas);syncSceneFramingControls(); }
  const placementFrames=createFrameRenderer({createCanvas:(w:number,h:number)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;}});
  let backgroundIdentity=0,cardIdentity=0;
  function drawPreview() {
    const canvas = section.querySelector<HTMLCanvasElement>('#placement-canvas'), image = baseImage;
    if (!canvas) return;
    const context = canvas.getContext('2d')!, heldFrame = frame, heldPlacement = placement;
    const layers=[];
    if(chosenBackground) { const background=chosenBackground,framing=backgroundChoice.value==='upload'?{...framingFor(orientation.value as CardOrientation)}:undefined;layers.push({id:'preview-background',identity:String(backgroundIdentity),width:heldFrame.width,height:heldFrame.height,draw:(ctx:CanvasRenderingContext2D)=>drawBackgroundCover(ctx,background,heldFrame.width,heldFrame.height,framing)}); }
    if(baseBlob && image) {
      const b=(section as any).__alphaBounds as number[];
      const sticker=sizeBrowserSticker(image,heldFrame.width,heldFrame.height,b,baseCardIdentity,heldPlacement.scale);
      const origin=stickerOrigin({width:heldFrame.width,height:heldFrame.height,nativeBounds:b,placement:heldPlacement,sticker});
      layers.push({...imageLayer('preview-card',sticker.identity,sticker.canvas,sticker.width,sticker.height),...origin});
      (section as any).__stickerReceipt={identity:sticker.identity,width:sticker.width,height:sticker.height,origin,scale:heldPlacement.scale,backgroundIdentity};
      (section as any).__stickerMetrics=browserStickerSizer.metrics();
      (section as any).__sizedSticker=sticker;
      $('card-sticker-size').textContent=`${sticker.width} × ${sticker.height} pixels`;
    }
    const receipt=placementFrames.seek(context,{width:heldFrame.width,height:heldFrame.height,layers},0);
    (canvas as any).__seekReceipt=receipt;
    (section as any).__frameReuse=placementFrames.metrics();
  }
  const previewDraw = createPreviewDrawScheduler({ requestFrame: callback => requestAnimationFrame(callback), cancelFrame: id => cancelAnimationFrame(id), draw: drawPreview });
  function releaseBasePreview() { baseImage = null; baseBlob = null; if (baseImageUrl) URL.revokeObjectURL(baseImageUrl); baseImageUrl = null; }
  function maxFittingScale(bounds: readonly number[]) {
    return maxCardScale({ width: frame.width, height: frame.height, alphaBounds: [...bounds] });
  }
  async function renderPreview() {
    previewDraw.flush();
    const row = selectedRow(), serial = ++previewSerial; previewReady=false;setBusy(busy);releaseBasePreview(); alpha = null; $('card-sticker-size').textContent='— pixels';
    if (!row) { showCanvas(previewCanvas(),rows().length?'Select a disc from Today’s Bag to place a card.':'Save a cropped disc photo to place a card.'); drawPreview(); return; }
    try {
      const card = cloneCard(row,orientation.value as CardOrientation,preset.value as CardPreset,placement,cardAppearance);
      const nextBlob = await renderCardBlob(card.disc as any,card.orientation,card.cardDesign,card.cardAppearance);
      if (serial !== previewSerial) return;
      const image = new Image(), url = URL.createObjectURL(nextBlob); let retainUrl = false;
      try { image.src = url; await image.decode(); if (serial !== previewSerial) return; baseBlob = nextBlob; cardIdentity++; baseCardIdentity=cardRasterIdentity(card.disc,card.orientation,card.cardDesign,card.cardAppearance); baseImage = image; baseImageUrl = url; retainUrl = true; }
      finally { if (!retainUrl) URL.revokeObjectURL(url); }
      if (serial !== previewSerial) return;
      const sourceCanvas = document.createElement('canvas'); sourceCanvas.width=frame.width; sourceCanvas.height=frame.height; const sourceCtx=sourceCanvas.getContext('2d',{willReadFrequently:true})!; sourceCtx.drawImage(image,0,0);
      const nextAlpha=sourceCtx.getImageData(0,0,frame.width,frame.height).data;
      const bounds=[frame.width,frame.height,0,0]; for(let y=0;y<frame.height;y++) for(let x=0;x<frame.width;x++) if(nextAlpha[(y*frame.width+x)*4+3]) {bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x+1);bounds[3]=Math.max(bounds[3],y+1);}
      if (serial !== previewSerial) return;
      alpha=nextAlpha; (section as any).__alphaBounds=bounds;
      const maxScale=maxFittingScale(bounds); scaleInput.max=String(maxScale);
      placement=fitPreviewPlacement(placement,frame,bounds,maxScale);
      // Fit the measured sticker too: interpolation may add a boundary pixel.
      while(true){try{const sized=sizeBrowserSticker(image,frame.width,frame.height,bounds,baseCardIdentity,placement.scale);stickerOrigin({width:frame.width,height:frame.height,nativeBounds:bounds,placement,sticker:sized});break;}catch(error){if(placement.scale<=.5)throw error;placement=fitPreviewPlacement({...placement,scale:Math.max(.5,placement.scale-.01)},frame,bounds,maxScale);}}
      resetResizeAnchor(); previewReady=true;setBusy(busy);
      const canvas=previewCanvas();
      showCanvas(canvas,'Drag to arrange the scene. Sticker export contains only the card.'); drawPreview();
      canvas.onpointerdown = event => { const rect=canvas.getBoundingClientRect(), px=(event.clientX-rect.left)*frame.width/rect.width, py=(event.clientY-rect.top)*frame.height/rect.height;
        if(sceneAdjusting && backgroundChoice.value==='upload')return;
        const sticker=(section as any).__sizedSticker,origin=(section as any).__stickerReceipt?.origin;
        if(!sticker||!origin)return;const ox=Math.floor(px-origin.x),oy=Math.floor(py-origin.y);
        if(ox<0||oy<0||ox>=sticker.width||oy>=sticker.height||sticker.canvas.getContext('2d').getImageData(ox,oy,1,1).data[3]===0)return;
        canvas.setPointerCapture(event.pointerId); const startX=event.clientX,startY=event.clientY, start={...placement};
        const gesture=createPlacementGesture(start,(_current,next:PointerEvent)=>{const b=(section as any).__alphaBounds as number[];return clampTransform({width:frame.width,height:frame.height,alphaBounds:b,scale:start.scale,dx:start.dx+(next.clientX-startX)/rect.width,dy:start.dy+(next.clientY-startY)/rect.height});});
        const move=(next:PointerEvent)=>{placement=gesture.move(next);previewDraw.schedule();};
        const finish=()=>{placement=gesture.finish();resetResizeAnchor();previewDraw.flush();cleanup();};
        const cancel=()=>{placement=gesture.cancel();resetResizeAnchor();previewDraw.flush();cleanup();};
        const cleanup=()=>{canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',finish);canvas.removeEventListener('pointercancel',cancel);};
        canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',cancel);
      };
      scaleInput.value=String(placement.scale); showCardSize();
    } catch(error) { if(serial===previewSerial){ $('card-preview').replaceChildren(Object.assign(document.createElement('p'),{className:'subtle',textContent:`Card preview unavailable: ${String(error)}`}));status('Nothing was approved.'); } }
  }
  function renderQueue() {
    const approval=experience.latestOutputApproval, exported=experience.latestOutputExport;
    const currentExport=exported&&exported.outputQueueSnapshotId===approval?.outputQueueSnapshotId;
    $('output-approval').textContent=currentExport?`Export prepared · ${exported.zipId}`:approval?`Approved immutable queue snapshot · ${approval.outputQueueSnapshotId}`:outputQueue().length?'Queue changed. Approve the current queue before export.':'Choose a disc, size its card, then Add to Export.';
    const queue=outputQueue();
    $('output-queue-list').replaceChildren(...queue.map((card,index)=>{
      const li=document.createElement('li');li.className='output-queue-item';
      if(card.approvalId)li.dataset.approvalId=card.approvalId;
      const label=document.createElement('span');label.textContent=`${index+1}. ${card.disc.nickname||card.disc.mold.split('.').at(-1)} · ${card.cardDesign.toUpperCase()} · ${card.orientation} · ${sizePercent(card.placement?.scale??1)}%`;
      const png=document.createElement('button');png.type='button';png.className='output-queue-png';png.textContent='Download PNG';png.disabled=busy||!approval||!card.approvalId;png.onclick=()=>void exportTransparent(card.approvalId);
      const remove=document.createElement('button');remove.type='button';remove.className='output-queue-remove';remove.textContent='Remove';remove.disabled=busy;remove.onclick=async()=>{await experience.removeOutput(index);renderQueue();};
      li.append(label,png,remove);return li;
    }));
    $('output-queue-empty').hidden=queue.length>0;
    $('output-review').hidden=queue.length===0||!!approval; ($('output-review') as HTMLButtonElement).disabled=busy;
  }
  function renderBag(activateFirst = false) {
    const bag = rows(), addresses = bag.map(row => row.address);
    ({ active: selectedAddress, checked: selectedAddresses } = reconcileCreatorSelection(addresses, { active: selectedAddress, checked: selectedAddresses }, activateFirst));
    const list = $('bag-export-list');
    list.replaceChildren(...bag.map(row => {
      const wrap = document.createElement('div'); wrap.className = 'bag-export-choice';
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = selectedAddresses.has(row.address);
      check.id = `batch-select-${row.disc.id}`; check.setAttribute('aria-label', `Include ${row.disc.nickname || row.seed.name} in Export`);
      check.onchange = () => {
        const before = selectedAddress;
        ({ active: selectedAddress, checked: selectedAddresses } = setReviewMembership(addresses, { active: selectedAddress, checked: selectedAddresses }, row.address, check.checked));
        list.querySelectorAll<HTMLButtonElement>('.bag-export-disc').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.address === selectedAddress)));
        updateSetupLabel();
        if (before !== selectedAddress) void renderPreview();
      };
      const button = document.createElement('button'); button.type = 'button'; button.className = 'bag-export-disc';
      button.dataset.address = row.address; button.setAttribute('aria-pressed', String(row.address === selectedAddress));
      const parked = !paintedDiscsEnabled && row.disc.depiction.kind === 'painted'; button.dataset.parked = String(parked);
      const img = document.createElement(parked ? 'span' : 'img');
      if (parked) img.textContent = 'Painting parked';
      else { (img as HTMLImageElement).src = row.disc.depiction.kind === 'painted' ? row.art : row.disc.depiction.src; (img as HTMLImageElement).alt = ''; }
      const copy = document.createElement('span'), name = document.createElement('strong'), detail = document.createElement('small');
      name.textContent = row.disc.nickname || row.seed.name; detail.textContent = `${row.seed.manufacturer} · ${row.disc.plastic || 'plastic unknown'}`;
      copy.append(name, detail); button.append(img, copy);
      button.onclick = () => { selectedAddress = row.address; selectedAddresses.add(row.address); placement = defaultCardPlacement(); renderBag(); void renderPreview(); };
      wrap.append(check, button);
      if (experience.depictionSources(row.address).photo?.refit) {
        const refit = document.createElement('button'); refit.type = 'button'; refit.className = 'bag-refit-photo'; refit.textContent = 'Re-crop';
        refit.setAttribute('aria-label', `Re-fit ${row.disc.nickname || row.seed.name} photo`);
        refit.onclick = () => document.dispatchEvent(new CustomEvent('discstudio:refit-disc', { detail: { address: row.address } })); wrap.append(refit);
      }
      return wrap;
    }));
    $('bag-export-empty').hidden = bag.length > 0; updateSetupLabel();
  }
  function saveSetup(){previewDraw.flush();try{const name=window.prompt('Name this reusable card setup',savedSetup?.name||'My card setup')?.trim();if(!name)return;savedSetup=storeSavedSetup(localStorage,{version:1,name,preset:preset.value as CardPreset,orientation:orientation.value as CardOrientation,placement,...(cardAppearance?{cardAppearance}:{})});updateSetupLabel();status(`Remembered ${name}.`);}catch(error){status(`Setup was not saved: ${String(error)}`);}}
  function applySetup(){if(!savedSetup||!selectedRows().length)return;orientation.value=savedSetup.orientation;presets();chosenBackground=null;void refreshBackground();preset.value=savedSetup.preset==='u03'?'u03-front':savedSetup.preset.endsWith('-mirror')?savedSetup.preset.replace('-mirror',''):savedSetup.preset;const remembered=savedSetup.cardAppearance??savedSetup.u01Appearance??(savedSetup.preset.endsWith('-mirror')?{...defaultCardAppearance(savedSetup.preset)}:defaultCardAppearance(preset.value));perPresetAppearance.set(preset.value as CardPreset,{...remembered});syncCardControls();placement={...savedSetup.placement};selectedAddress=selectedRows()[0].address;scaleInput.value=String(placement.scale);renderBag();void renderPreview();status(`Applied ${savedSetup.name} to ${selectedRows().length} selected discs. Add to Export to approve these layouts.`);}
  async function imageAlphaBounds(blob: Blob, heldFrame: {width:number;height:number}) { const image=new Image(),url=URL.createObjectURL(blob);try{image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=heldFrame.width;canvas.height=heldFrame.height;const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(image,0,0);const alpha=ctx.getImageData(0,0,heldFrame.width,heldFrame.height).data,b=[heldFrame.width,heldFrame.height,0,0];for(let y=0;y<heldFrame.height;y++)for(let x=0;x<heldFrame.width;x++)if(alpha[(y*heldFrame.width+x)*4+3]){b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x+1);b[3]=Math.max(b[3],y+1);}return b;}finally{URL.revokeObjectURL(url);}}
  async function renderReviewCandidate(candidate: ReviewCandidate, generation: number) { try { const appearance=candidate.card.cardAppearance??candidate.card.u01Appearance, original=await renderCardBlob(candidate.card.disc as any,candidate.card.orientation,candidate.card.cardDesign as CardPreset,appearance), size=cardDimensions(candidate.card.orientation); let clipping: unknown = null; try{validateTransform({width:size.width,height:size.height,alphaBounds:await imageAlphaBounds(original,size),...(candidate.card.placement??identityTransform)});}catch(error){clipping=error;} const placed=await renderPlacedCardBlob(candidate.card.disc as any,candidate.card.orientation,candidate.card.cardDesign as CardPreset,candidate.card.placement,appearance);if(generation!==reviewGeneration)return;const url=URL.createObjectURL(placed);reviewUrls.set(candidate.id,url);reviewCandidates=transitionCandidate(reviewCandidates,candidate.id,clipping?'needs-adjustment':'ready',clipping?'Placement clips visible pixels. Adjust this card on canvas.':undefined); } catch(error) { if(generation!==reviewGeneration)return;reviewCandidates=transitionCandidate(reviewCandidates,candidate.id,'needs-adjustment','Could not render this card. Retry after adjustment.'); } if(generation===reviewGeneration)renderReview(); }
  function syncReviewBackgroundToggle(){const label=reviewDialog.querySelector<HTMLElement>('#review-background-toggle')!,toggle=label.querySelector<HTMLInputElement>('input')!,available=!!uploadedBackground&&!!backgroundUrl;label.hidden=!available;toggle.checked=available&&reviewShowTestBackground;toggle.disabled=!available;}
  function reviewBackgroundThumb(direction: CardOrientation) {
    const cached=reviewBackgroundThumbs.get(direction);if(cached)return cached;
    const image=uploadedBackground;if(!image)return '';
    const canvas=document.createElement('canvas');canvas.width=direction==='vertical'?180:320;canvas.height=direction==='vertical'?320:180;
    drawBackgroundCover(canvas.getContext('2d')!,image,canvas.width,canvas.height,{...framingFor(direction)});
    const url=canvas.toDataURL('image/png');reviewBackgroundThumbs.set(direction,url);return url;
  }
  function renderReview(){const list=reviewDialog.querySelector<HTMLElement>('#batch-review-list')!, summary=reviewDialog.querySelector<HTMLElement>('#batch-review-summary')!, all=reviewDialog.querySelector<HTMLButtonElement>('#batch-approve-all')!;syncReviewBackgroundToggle();list.classList.toggle('single-card',reviewCandidates.length===1);const ready=pendingCards(reviewCandidates);summary.textContent=`${reviewCandidates.length} exact card${reviewCandidates.length===1?'':'s'} · ${ready.length} ready to approve`;const validating=reviewCandidates.some(candidate=>candidate.state==='rendering'||candidate.state==='checking');all.disabled=busy||validating||!ready.length||(!!outputReviewAddress&&ready.length!==reviewCandidates.length);all.textContent=validating?'Checking cards…':outputReviewAddress?'Approve remaining collection':`Approve all ready (${ready.length})`;list.replaceChildren(...reviewCandidates.map((candidate,index)=>{const article=document.createElement('article');article.className='batch-review-item';article.dataset.state=candidate.state;const thumb=document.createElement('div'),frame=document.createElement('div'),image=document.createElement('img'),copy=document.createElement('div'),title=document.createElement('strong'),state=document.createElement('small'),description=document.createElement('p'),button=document.createElement('button');thumb.className='batch-review-thumb';copy.className='batch-review-copy';frame.className='batch-review-frame';frame.dataset.orientation=candidate.card.orientation;if(reviewShowTestBackground&&backgroundUrl)frame.style.backgroundImage=`url("${reviewBackgroundThumb(candidate.card.orientation)}")`;const name=candidate.card.disc.nickname||candidate.card.disc.mold.split('.').at(-1)||'Disc';image.alt=`Final ${name} card`;const url=reviewUrls.get(candidate.id);if(url) image.src=url;title.textContent=`${index+1}. ${name}`;state.textContent=candidate.state==='approved'?'Approved':candidate.state==='needs-adjustment'?'Needs adjustment':candidate.state==='ready'?'Ready for approval':'Preparing exact preview…';const appearance=candidate.card.cardAppearance??candidate.card.u01Appearance;const look=appearance?` · disc ${appearance.discSide} · highlight ${appearance.highlightTarget} · ${appearance.accentColor}`:'';description.textContent=candidate.reason||`${candidate.card.cardDesign.toUpperCase()} · ${candidate.card.orientation} · ${sizePercent(candidate.card.placement?.scale??1)}%${look}`;button.type='button';button.textContent=candidate.state==='approved'?'Approved':outputReviewAddress?candidate.state==='needs-adjustment'?'Remove or replace this card':'Included in review':candidate.state==='needs-adjustment'?'Adjust on canvas':'Approve this card';button.disabled=busy||!!outputReviewAddress||candidate.state==='approved'||candidate.state==='rendering'||candidate.state==='checking';button.onclick=()=>{if(candidate.state==='needs-adjustment'){reviewDialog.close();selectedAddress=rows().find(row=>row.disc.id===candidate.card.disc.id)?.address??selectedAddress;selectedAddresses=new Set([selectedAddress]);placement={...(candidate.card.placement??identityTransform)};orientation.value=candidate.card.orientation;presets();preset.value=candidate.card.cardDesign.endsWith('-mirror')?candidate.card.cardDesign.replace('-mirror',''):candidate.card.cardDesign;perPresetAppearance.set(preset.value as CardPreset,{...(candidate.card.cardAppearance??candidate.card.u01Appearance??defaultCardAppearance(candidate.card.cardDesign))});syncCardControls();renderBag();void renderPreview();status('Adjust the clipped card, then open review again.');}else if(candidate.state==='ready')void approveCandidates([candidate]);};frame.append(image);thumb.append(frame);copy.append(title,state,description,button);article.append(thumb,copy);if(candidate.state==='rendering'){reviewCandidates=transitionCandidate(reviewCandidates,candidate.id,'checking');void renderReviewCandidate(candidate,reviewGeneration);}return article;}));}
  async function approveCandidates(candidates: readonly ReviewCandidate[]){const eligible=candidates.filter(candidate=>candidate.state==='ready');if(!eligible.length||busy)return;setBusy(true);try{if(outputReviewAddress){if(eligible.length!==reviewCandidates.length)throw Error('Review all remaining cards together.');await experience.approveOutputQueue(outputReviewAddress);}else await experience.enqueueOutput(eligible.map(candidate=>candidate.card));for(const candidate of eligible)reviewCandidates=transitionCandidate(reviewCandidates,candidate.id,'approved');renderQueue();status(`Approved ${eligible.length} exact card${eligible.length===1?'':'s'} for export.`);}catch(error){status(`Cards were not approved: ${String(error)}`);}finally{setBusy(false);renderReview();}}
  async function addToExport(){
    previewDraw.flush();if(busy||!previewReady){status('Wait for the current card preview.');return;}
    const chosen=selectedRows();if(!chosen.length){status('Select a disc before adding to Export.');return;}
    const cards=chosen.map(row=>cloneCard(row,orientation.value as CardOrientation,preset.value as CardPreset,placement,cardAppearance));
    setBusy(true);try{await experience.enqueueOutput(cards);renderQueue();status(`Added ${cards.length} exact card${cards.length===1?'':'s'} to Export.`);}catch(error){status(`Card was not added: ${String(error)}`);}finally{setBusy(false);}
  }
  function openReview(){outputReviewAddress=null;previewDraw.flush();reviewGeneration++;reviewShowTestBackground=false;for(const url of reviewUrls.values())URL.revokeObjectURL(url);reviewUrls.clear();const chosen=selectedRows();if(!chosen.length){status('Select one or more discs to review.');return;}const layout=preset.value as CardPreset,direction=orientation.value as CardOrientation;reviewCandidates=makeReviewCandidates(chosen.map(row=>cloneCard(row,direction,layout,placement,cardAppearance)));reviewDialog.showModal();renderReview();}
  function reviewRemainingOutput(){
    if(busy||!outputQueue().length)return;
    outputReviewAddress=experience.outputQueueAddress; reviewGeneration++; reviewShowTestBackground=false;
    for(const url of reviewUrls.values())URL.revokeObjectURL(url);reviewUrls.clear();
    reviewCandidates=makeReviewCandidates(outputQueue()); reviewDialog.showModal(); renderReview();
  }
  async function exportTransparent(approvalId?: string){
    if(busy)return;previewDraw.flush();const queue=outputQueue(),card=approvalId?queue.find(item=>item.approvalId===approvalId):queue.at(-1);
    const expected=experience.latestOutputApproval?.outputQueueSnapshotId as string|undefined;
    if(!card||!expected){status('Approve the current output queue and choose an approved card.');return;}
    setBusy(true);try{
      const blob=await renderStickerCardBlob(card.disc as any,card.orientation,card.cardDesign as CardPreset,card.placement?.scale??1,card.cardAppearance??card.u01Appearance);
      await experience.validateOutputExport(expected);
      if(approvalId&&!experience.outputQueue().some(item=>item.approvalId===approvalId))throw Error('The selected approval changed during PNG preparation.');
      downloadBlob(blob,cardFilename(card));status(`Transparent card sticker PNG prepared for ${card.approvalId??'the selected card'}.`);
    }catch(error){status(`PNG export failed: ${String(error)}`);}finally{setBusy(false);}
  }
  async function exportZip(){previewDraw.flush();const queue=outputQueue(),expected=experience.latestOutputApproval?.outputQueueSnapshotId as string|undefined;if(!queue.length||!expected){status('Add a card to Export before exporting.');return;}setBusy(true);try{const result=await exportBrowserZip(queue,async card=>new Uint8Array(await(await renderStickerCardBlob(card.disc as any,card.orientation,card.cardDesign as CardPreset,card.placement?.scale??1,card.cardAppearance??card.u01Appearance)).arrayBuffer()));await experience.validateOutputExport(expected);downloadBlob(result.blob,'discstudio-output-queue.zip');await experience.recordOutputExport({...result,expectedOutputQueueSnapshotId:expected,downloadRequested:true});renderQueue();status('Transparent card stickers packaged.');}catch(error){status(`ZIP was not prepared: ${String(error)}`);}finally{setBusy(false);}}
  async function exportCombined(){previewDraw.flush();const card=outputQueue().at(-1);if(!card){status('Add a card to Export first.');return;}setBusy(true);try{const choice=backgroundChoice.value, framing=choice==='upload'?{...framingFor(card.orientation)}:undefined, background=await getBackground(card.orientation,choice),blob=await renderPlacedCardBlob(card.disc as any,card.orientation,card.cardDesign as CardPreset,card.placement,card.cardAppearance??card.u01Appearance),image=new Image(),url=URL.createObjectURL(blob),size=cardDimensions(card.orientation);try{image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;const ctx=canvas.getContext('2d')!;if(background)drawBackgroundCover(ctx,background,size.width,size.height,framing);ctx.drawImage(image,0,0);const combined=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Combined PNG encoding failed.')),'image/png'));downloadBlob(combined,'discstudio-combined-preview.png');status(`Combined PNG prepared with the current ${choice==='none'?'transparent scene':'background'} fitted to the approved ${card.orientation} card.`);}finally{URL.revokeObjectURL(url);}}catch(error){status(`Combined PNG was not prepared: ${String(error)}`);}finally{setBusy(false);}}
  orientation.onchange=()=>{presets();chosenBackground=null;void renderPreview();void refreshBackground();};preset.onchange=()=>{syncCardControls();void renderPreview();};
  cardSide.onchange=readCardControls; cardHighlight.onchange=readCardControls; cardAccent.onchange=readCardControls;
  scaleInput.oninput=()=>{const prior={...placement};const b=(section as any).__alphaBounds as number[]|undefined;try{placement=rescalePreviewPlacement(resizeAnchor,Number(scaleInput.value),Number(scaleInput.max),frame,b);if(baseImage&&b){const sized=sizeBrowserSticker(baseImage,frame.width,frame.height,b,baseCardIdentity,placement.scale);stickerOrigin({width:frame.width,height:frame.height,nativeBounds:b,placement,sticker:sized});}}catch{placement=prior;scaleInput.value=String(prior.scale);status('That size cannot fit inside this scene.');} showCardSize();previewDraw.schedule();};
  scaleInput.onchange=()=>previewDraw.flush();
  $('scene-adjust').onclick=()=>{sceneAdjusting=!sceneAdjusting;syncSceneFramingControls();};
  for(const [id,field] of [['scene-pan-x','x'],['scene-pan-y','y'],['scene-zoom','zoom']] as const) {
    ($(id) as HTMLInputElement).oninput=event=>{const direction=orientation.value as CardOrientation, value=Number((event.currentTarget as HTMLInputElement).value);setSceneFraming(direction,{...framingFor(direction),[field]:field==='zoom'?value:value/100});};
  }
  $('scene-reset').onclick=()=>setSceneFraming(orientation.value as CardOrientation,freshSceneFraming());
  backgroundChoice.onchange=()=>{uploadGeneration++;if(backgroundChoice.value==='upload'&&!uploadedBackground){backgroundChoice.value=activeBackgroundChoice;upload.click();return;}activeBackgroundChoice=backgroundChoice.value;sceneAdjusting=false;syncSceneFramingControls();void refreshBackground();};
  upload.onchange=async()=>{const file=upload.files?.[0];if(!file)return;const generation=++uploadGeneration,nextUrl=URL.createObjectURL(file),image=new Image();upload.value='';try{image.src=nextUrl;await image.decode();}catch{URL.revokeObjectURL(nextUrl);if(generation===uploadGeneration)status('That preview image could not be read. Choose another image.');return;}if(generation!==uploadGeneration){URL.revokeObjectURL(nextUrl);return;}if(backgroundUrl)URL.revokeObjectURL(backgroundUrl);backgroundUrl=nextUrl;uploadedBackground=image;sceneFraming.vertical=freshSceneFraming();sceneFraming.horizontal=freshSceneFraming();reviewBackgroundThumbs.clear();sceneAdjusting=false;backgroundChoice.value='upload';activeBackgroundChoice='upload';await refreshBackground();status('Preview image added to the canvas.');};
  reviewDialog.querySelector<HTMLInputElement>('#review-background-toggle input')!.addEventListener('change',event=>{reviewShowTestBackground=(event.currentTarget as HTMLInputElement).checked;renderReview();});reviewDialog.addEventListener('close',()=>{outputReviewAddress=null;reviewGeneration++;for(const url of reviewUrls.values())URL.revokeObjectURL(url);reviewUrls.clear();});$('output-review').addEventListener('click',reviewRemainingOutput);$('card-enqueue').addEventListener('click',()=>void addToExport());$('setup-save').addEventListener('click',saveSetup);$('setup-apply').addEventListener('click',applySetup);reviewDialog.querySelector<HTMLButtonElement>('#batch-approve-all')!.addEventListener('click',()=>void approveCandidates(reviewCandidates.filter(candidate=>candidate.state==='ready')));$('card-png').addEventListener('click',()=>void exportTransparent());$('card-zip').addEventListener('click',()=>void exportZip());$('card-combined').addEventListener('click',()=>void exportCombined());
  presets();renderBag(true);renderQueue();updateSetupLabel();void renderPreview();void refreshBackground();document.addEventListener('discstudio:bag-changed',()=>{renderBag(true);void renderPreview();});
  return {refresh:renderBag,outputQueue};
}
