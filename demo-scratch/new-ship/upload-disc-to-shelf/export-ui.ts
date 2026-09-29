import { renderCardBlob, renderPlacedCardBlob, type CardOrientation, type CardPreset } from './browser-card-renderer.ts';
import { cardDimensions, cardFilename, queueCards, type QueuedCard } from './export-queue-core.ts';
import { clampTransform, identityTransform } from './transform-geometry.mjs';
import { exportBrowserZip, downloadBlob } from './browser-export.ts';
import type { createExperience } from './model.ts';
import { paintedDiscsEnabled } from './kompozition.ts';
import { loadSavedSetup, makeReviewCandidates, pendingCards, storeSavedSetup, transitionCandidate, type ReviewCandidate, type SavedCardSetup } from './batch-review.ts';
import { validateTransform } from './transform-geometry.mjs';
import { reconcileCreatorSelection, setReviewMembership } from './creator-selection.ts';

const PRESETS: { id: CardPreset; orientation: CardOrientation; name: string }[] = [
  { id: 'u01', orientation: 'vertical', name: 'U01 · Compact scorebug' }, { id: 'u02', orientation: 'vertical', name: 'U02 · Stacked poster' },
  { id: 'u03', orientation: 'vertical', name: 'U03 · Rail card' }, { id: 'u04', orientation: 'vertical', name: 'U04 · Kinetic name' }, { id: 'u05', orientation: 'vertical', name: 'U05 · Glass drawer' },
  { id: 'b01', orientation: 'horizontal', name: 'B01 · Hero rail' }, { id: 'b02', orientation: 'horizontal', name: 'B02 · Split nameplate' },
  { id: 'b03', orientation: 'horizontal', name: 'B03 · Framed hero' }, { id: 'b04', orientation: 'horizontal', name: 'B04 · Peak mark' }, { id: 'b05', orientation: 'horizontal', name: 'B05 · Stamp macro' },
];
type Experience = ReturnType<typeof createExperience>;
type BagRow = ReturnType<Experience['bag']>[number];
type Transform = { scale: number; dx: number; dy: number };
type Snapshot = Readonly<{ cards: readonly QueuedCard[]; preset: CardPreset; orientation: CardOrientation }>;

export function cloneCard(row: BagRow, orientation: CardOrientation, preset: CardPreset, placement: Transform = identityTransform): QueuedCard {
  const seed = row.seed;
  return { disc: { ...row.disc, depiction: { ...row.disc.depiction }, renderer: { moldName: seed.name, manufacturer: seed.manufacturer, flights: [seed.speed ?? null, seed.glide ?? null, seed.turn ?? null, seed.fade ?? null], ...(row.disc.depiction.kind === 'painted' ? { artSrc: row.art } : {}) } } as any, orientation, cardDesign: preset, placement: Object.freeze({ ...placement }) };
}

/** The creator approves one exact native card plus its transform. Backgrounds remain projection-only. */
export function mountExport(experience: Experience, { root = document }: { root?: ParentNode } = {}) {
  const priorShelf = root.querySelector<HTMLElement>('.shelf-section'); if (priorShelf) priorShelf.hidden = true;
  const section = document.createElement('section'); section.id = 'todays-bag'; section.className = 'todays-bag-export';
  section.innerHTML = `<div class="section-title"><div><p class="eyebrow">TODAY’S BAG</p><h2>Make your card.</h2></div><span>03 — place and approve</span></div>
    <p class="subtle">Choose saved discs, position the whole card once, then review each exact card before it joins export.</p>
    <div class="bag-export-grid"><div><div id="bag-export-list" class="bag-export-list" aria-live="polite"></div><p id="bag-export-empty" class="subtle">Save a cropped disc photo to add it here.</p>
      <section class="output-queue" aria-labelledby="output-queue-title"><h3 id="output-queue-title">Approved output</h3><p id="output-approval" class="subtle">Choose a disc, preview it, then approve the card for export.</p><p id="output-queue-empty" class="subtle">Nothing approved yet.</p><ol id="output-queue-list"></ol></section></div>
    <div class="bag-export-controls"><div class="saved-setup"><strong id="saved-setup-label">No saved setup</strong><button id="setup-save" type="button">Remember this setup</button><button id="setup-apply" type="button">Apply to selected</button></div><label>Orientation<select id="card-orientation"><option value="vertical">Vertical · 9:16</option><option value="horizontal">Horizontal · 16:9</option></select></label><label>Card layout<select id="card-preset"></select></label>
      <div class="canvas-background-controls"><label>Preview background<select id="canvas-background"><option value="example">Example scene</option><option value="none">No background</option><option value="upload">Upload background…</option></select></label><input id="canvas-background-upload" type="file" accept="image/*" hidden><p class="subtle">Backgrounds are for preview. Transparent PNG and ZIP omit them. Export a combined PNG when you want the scene included.</p></div>
      <label>Card size <output id="card-scale-value">100%</output><input id="card-scale" type="range" min="0.5" max="1.5" step="0.01" value="1"></label>
      <div id="card-preview" class="card-preview"><p class="subtle">Select one saved disc to place a card.</p></div><p id="card-export-status" class="subtle" role="status"></p>
      <div class="card-export-actions"><button id="card-enqueue" class="primary" type="button">Review selected cards</button><button id="card-png" type="button">Download transparent PNG</button><button id="card-zip" type="button">Export approved ZIP</button><button id="card-combined" type="button">Export combined PNG</button></div>
    </div></div>`;
  (priorShelf?.parentElement ?? root.querySelector('main')!).insertBefore(section, priorShelf ?? null);
  const $ = (id: string) => section.querySelector<HTMLElement>(`#${id}`)!;
  const reviewDialog = document.createElement('dialog'); reviewDialog.id = 'batch-review'; reviewDialog.innerHTML = `<form method="dialog" class="batch-review-dialog"><header><div><p class="eyebrow">FINAL REVIEW</p><h2>Approve cards</h2></div><label id="review-background-toggle" class="review-background-toggle" hidden><span>No background</span><input type="checkbox" role="switch" aria-label="Show uploaded test background in review"><span>Test background</span></label><button aria-label="Close review" value="cancel" type="submit">Close</button></header><p id="batch-review-summary" class="subtle"></p><div id="batch-review-list" class="batch-review-list"></div><footer><button id="batch-approve-all" class="primary" type="button">Approve remaining</button><button value="cancel" type="submit">Cancel</button></footer></form>`; section.append(reviewDialog);
  const orientation = $('card-orientation') as HTMLSelectElement, preset = $('card-preset') as HTMLSelectElement, scaleInput = $('card-scale') as HTMLInputElement, backgroundChoice = $('canvas-background') as HTMLSelectElement, upload = $('canvas-background-upload') as HTMLInputElement;
  let selectedAddress = '', selectedAddresses = new Set<string>(), reviewUrls = new Map<string,string>(), reviewGeneration = 0, reviewShowTestBackground = false, savedSetup: SavedCardSetup | null = loadSavedSetup(typeof localStorage === 'undefined' ? null : localStorage), reviewCandidates: readonly ReviewCandidate[] = [], previewSerial = 0, drawSerial = 0, backgroundSerial = 0, busy = false, previewSnapshot: Snapshot | null = null, placement: Transform = { ...identityTransform }, backgroundUrl: string | null = null, uploadedBackground: CanvasImageSource | null = null, chosenBackground: CanvasImageSource | null = null, baseBlob: Blob | null = null, alpha: Uint8ClampedArray | null = null, frame = { width:1080,height:1920 };
  const status = (text: string) => { $('card-export-status').textContent = text; };
  const rows = () => experience.bag(), outputQueue = () => experience.outputQueue();
  function updateSetupLabel() { $('saved-setup-label').textContent = savedSetup ? `Saved · ${savedSetup.name}` : 'No saved setup'; ($('setup-apply') as HTMLButtonElement).disabled = !savedSetup || selectedAddresses.size === 0; }
  function selectedRows() { return rows().filter(row => selectedAddresses.has(row.address)); }
  function presets() { const wanted = orientation.value as CardOrientation, previous = preset.value; preset.replaceChildren(...PRESETS.filter(item => item.orientation === wanted).map(item => new Option(item.name, item.id))); preset.value = PRESETS.some(item => item.id === previous && item.orientation === wanted) ? previous : wanted === 'vertical' ? 'u02' : 'b01'; frame = wanted === 'vertical' ? {width:1080,height:1920} : {width:1920,height:1080}; }
  function selectedRow() { return rows().find(row => row.address === selectedAddress) ?? null; }
  function snapshot(): Snapshot | null { const row = selectedRow(); if (!row) return null; const direction = orientation.value as CardOrientation, layout = preset.value as CardPreset; return Object.freeze({ cards: queueCards([cloneCard(row,direction,layout,placement)]), preset:layout, orientation:direction }); }
  function setBusy(value: boolean) { busy = value; for (const button of section.querySelectorAll<HTMLButtonElement>('.card-export-actions button')) button.disabled = value; $('card-enqueue').setAttribute('aria-disabled',String(value)); }
  async function getBackground(): Promise<CanvasImageSource | null> { if (backgroundChoice.value === 'none') return null; if (backgroundChoice.value === 'upload') return uploadedBackground; const image = new Image(); image.src = './sample-background.svg'; await image.decode(); return image; }
  async function refreshBackground() { const serial=++backgroundSerial; try { const background=await getBackground(); if(serial===backgroundSerial){ chosenBackground=background; drawPreview(); } } catch(error) { if(serial===backgroundSerial) status(`Preview background unavailable: ${String(error)}`); } }
  function previewCanvas() { const canvas=document.createElement('canvas'); canvas.id='placement-canvas'; canvas.width=frame.width; canvas.height=frame.height; canvas.setAttribute('aria-label','Card placement preview'); return canvas; }
  function drawPreview() {
    const canvas = section.querySelector<HTMLCanvasElement>('#placement-canvas'), heldBlob = baseBlob;
    if (!canvas) return;
    const context = canvas.getContext('2d')!, token = ++drawSerial;
    const heldFrame = { ...frame }, heldPlacement = { ...placement }, heldBackground = chosenBackground;
    const paintBackground = () => { context.setTransform(1,0,0,1,0,0); context.clearRect(0,0,heldFrame.width,heldFrame.height); if(heldBackground) context.drawImage(heldBackground,0,0,heldFrame.width,heldFrame.height); };
    if (!heldBlob) { paintBackground(); return; }
    const url = URL.createObjectURL(heldBlob), image = new Image();
    void (async () => {
      try {
        image.src = url; await image.decode();
        if (token !== drawSerial || heldBlob !== baseBlob) return;
        paintBackground();
        context.save();
        context.translate(heldFrame.width / 2 + heldPlacement.dx * heldFrame.width, heldFrame.height / 2 + heldPlacement.dy * heldFrame.height);
        context.scale(heldPlacement.scale, heldPlacement.scale);
        context.drawImage(image, -heldFrame.width / 2, -heldFrame.height / 2, heldFrame.width, heldFrame.height);
        context.restore();
      } finally { URL.revokeObjectURL(url); }
    })().catch(error => { if (token === drawSerial) status(`Preview drawing failed: ${String(error)}`); });
  }
  function maxFittingScale(bounds: readonly number[]) {
    const [left, top, right, bottom] = bounds, cx = frame.width / 2, cy = frame.height / 2;
    const limits = [left < cx ? cx / (cx - left) : Infinity, right > cx ? (frame.width - cx) / (right - cx) : Infinity, top < cy ? cy / (cy - top) : Infinity, bottom > cy ? (frame.height - cy) / (bottom - cy) : Infinity];
    return Math.min(1.5, ...limits);
  }
  async function renderPreview() {
    const row = selectedRow(), serial = ++previewSerial; previewSnapshot = null; baseBlob = null; alpha = null;
    if (!row) { const hint=document.createElement('p'); hint.className='placement-hint'; hint.textContent=rows().length?'Select a disc from Today’s Bag to place a card.':'Save a cropped disc photo to place a card.'; $('card-preview').replaceChildren(previewCanvas(),hint); drawPreview(); return; }
    try {
      const card = cloneCard(row,orientation.value as CardOrientation,preset.value as CardPreset,placement);
      const nextBlob = await renderCardBlob(card.disc as any,card.orientation,card.cardDesign);
      if (serial !== previewSerial) return;
      baseBlob = nextBlob;
      const image = new Image(), url = URL.createObjectURL(nextBlob);
      try { image.src = url; await image.decode(); } finally { URL.revokeObjectURL(url); }
      if (serial !== previewSerial) return;
      const sourceCanvas = document.createElement('canvas'); sourceCanvas.width=frame.width; sourceCanvas.height=frame.height; const sourceCtx=sourceCanvas.getContext('2d',{willReadFrequently:true})!; sourceCtx.drawImage(image,0,0);
      const nextAlpha=sourceCtx.getImageData(0,0,frame.width,frame.height).data;
      const bounds=[frame.width,frame.height,0,0]; for(let y=0;y<frame.height;y++) for(let x=0;x<frame.width;x++) if(nextAlpha[(y*frame.width+x)*4+3]) {bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x+1);bounds[3]=Math.max(bounds[3],y+1);}
      if (serial !== previewSerial) return;
      alpha=nextAlpha; (section as any).__alphaBounds=bounds;
      const maxScale=maxFittingScale(bounds); scaleInput.max=String(maxScale);
      placement.scale=Math.min(placement.scale,maxScale);
      placement=clampTransform({width:frame.width,height:frame.height,alphaBounds:bounds,...placement});
      const canvas=previewCanvas();
      const hint=document.createElement('p'); hint.className='placement-hint';hint.textContent='Drag the visible card to place it.'; $('card-preview').replaceChildren(canvas,hint); drawPreview();
      canvas.onpointerdown = event => { const rect=canvas.getBoundingClientRect(), px=(event.clientX-rect.left)*frame.width/rect.width, py=(event.clientY-rect.top)*frame.height/rect.height;
        const ox=(px-frame.width/2-placement.dx*frame.width)/placement.scale+frame.width/2, oy=(py-frame.height/2-placement.dy*frame.height)/placement.scale+frame.height/2;
        if(!alpha || ox<0||oy<0||ox>=frame.width||oy>=frame.height||alpha[(Math.floor(oy)*frame.width+Math.floor(ox))*4+3]===0) return;
        canvas.setPointerCapture(event.pointerId); const startX=event.clientX,startY=event.clientY, start={...placement};
        const move=(next:PointerEvent)=>{const b=(section as any).__alphaBounds as number[]; placement=clampTransform({width:frame.width,height:frame.height,alphaBounds:b,scale:start.scale,dx:start.dx+(next.clientX-startX)/rect.width,dy:start.dy+(next.clientY-startY)/rect.height});previewSnapshot=snapshot();drawPreview();};
        const up=()=>{canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);};
        canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);
      };
      previewSnapshot=snapshot(); scaleInput.value=String(placement.scale); $('card-scale-value').textContent=`${Math.round(placement.scale*100)}%`;
    } catch(error) { if(serial===previewSerial){ $('card-preview').replaceChildren(Object.assign(document.createElement('p'),{className:'subtle',textContent:`Card preview unavailable: ${String(error)}`}));status('Nothing was approved.'); } }
  }
  function renderQueue() { const approval=experience.latestOutputApproval, exported=experience.latestOutputExport; $('output-approval').textContent=exported?`Export prepared · ${exported.zipId}`:approval?`Approved immutable queue snapshot · ${approval.outputQueueSnapshotId}`:outputQueue().length?'Queue changed. Approve the current queue before export.':'Choose a disc, preview it, then approve the card for export.'; const queue=outputQueue(); $('output-queue-list').replaceChildren(...queue.map((card,index)=>{const li=document.createElement('li');li.className='output-queue-item';const label=document.createElement('span');label.textContent=`${index+1}. ${card.disc.nickname||card.disc.mold.split('.').at(-1)} · ${card.cardDesign.toUpperCase()} · ${card.orientation} · ${Math.round((card.placement?.scale??1)*100)}%`;const remove=document.createElement('button');remove.type='button';remove.className='output-queue-remove';remove.textContent='Remove';remove.disabled=busy;remove.onclick=async()=>{await experience.removeOutput(index);renderQueue();};li.append(label,remove);return li;}));$('output-queue-empty').hidden=queue.length>0; }
  function renderBag(activateFirst = false) {
    const bag = rows(), addresses = bag.map(row => row.address);
    ({ active: selectedAddress, checked: selectedAddresses } = reconcileCreatorSelection(addresses, { active: selectedAddress, checked: selectedAddresses }, activateFirst));
    const list = $('bag-export-list');
    list.replaceChildren(...bag.map(row => {
      const wrap = document.createElement('div'); wrap.className = 'bag-export-choice';
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = selectedAddresses.has(row.address);
      check.id = `batch-select-${row.disc.id}`; check.setAttribute('aria-label', `Include ${row.disc.nickname || row.seed.name} in review`);
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
      button.onclick = () => { selectedAddress = row.address; selectedAddresses.add(row.address); placement = { ...identityTransform }; renderBag(); void renderPreview(); };
      wrap.append(check, button); return wrap;
    }));
    $('bag-export-empty').hidden = bag.length > 0; updateSetupLabel();
  }
  function saveSetup(){try{const name=window.prompt('Name this reusable card setup',savedSetup?.name||'My card setup')?.trim();if(!name)return;savedSetup=storeSavedSetup(localStorage,{version:1,name,preset:preset.value as CardPreset,orientation:orientation.value as CardOrientation,placement});updateSetupLabel();status(`Remembered ${name}.`);}catch(error){status(`Setup was not saved: ${String(error)}`);}}
  function applySetup(){if(!savedSetup||!selectedRows().length)return;orientation.value=savedSetup.orientation;presets();preset.value=savedSetup.preset;placement={...savedSetup.placement};selectedAddress=selectedRows()[0].address;scaleInput.value=String(placement.scale);renderBag();void renderPreview();status(`Applied ${savedSetup.name} to ${selectedRows().length} selected discs. Review each before approval.`);}
  async function imageAlphaBounds(blob: Blob, heldFrame: {width:number;height:number}) { const image=new Image(),url=URL.createObjectURL(blob);try{image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=heldFrame.width;canvas.height=heldFrame.height;const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(image,0,0);const alpha=ctx.getImageData(0,0,heldFrame.width,heldFrame.height).data,b=[heldFrame.width,heldFrame.height,0,0];for(let y=0;y<heldFrame.height;y++)for(let x=0;x<heldFrame.width;x++)if(alpha[(y*heldFrame.width+x)*4+3]){b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x+1);b[3]=Math.max(b[3],y+1);}return b;}finally{URL.revokeObjectURL(url);}}
  async function renderReviewCandidate(candidate: ReviewCandidate, generation: number) { try { const original=await renderCardBlob(candidate.card.disc as any,candidate.card.orientation,candidate.card.cardDesign as CardPreset), size=cardDimensions(candidate.card.orientation); let clipping: unknown = null; try{validateTransform({width:size.width,height:size.height,alphaBounds:await imageAlphaBounds(original,size),...(candidate.card.placement??identityTransform)});}catch(error){clipping=error;} const placed=await renderPlacedCardBlob(candidate.card.disc as any,candidate.card.orientation,candidate.card.cardDesign as CardPreset,candidate.card.placement);if(generation!==reviewGeneration)return;const url=URL.createObjectURL(placed);reviewUrls.set(candidate.id,url);reviewCandidates=transitionCandidate(reviewCandidates,candidate.id,clipping?'needs-adjustment':'ready',clipping?'Placement clips visible pixels. Adjust this card on canvas.':undefined); } catch(error) { if(generation!==reviewGeneration)return;reviewCandidates=transitionCandidate(reviewCandidates,candidate.id,'needs-adjustment','Could not render this card. Retry after adjustment.'); } if(generation===reviewGeneration)renderReview(); }
  function syncReviewBackgroundToggle(){const label=reviewDialog.querySelector<HTMLElement>('#review-background-toggle')!,toggle=label.querySelector<HTMLInputElement>('input')!,available=!!uploadedBackground&&!!backgroundUrl;label.hidden=!available;toggle.checked=available&&reviewShowTestBackground;toggle.disabled=!available;}
  function renderReview(){const list=reviewDialog.querySelector<HTMLElement>('#batch-review-list')!, summary=reviewDialog.querySelector<HTMLElement>('#batch-review-summary')!, all=reviewDialog.querySelector<HTMLButtonElement>('#batch-approve-all')!;syncReviewBackgroundToggle();list.classList.toggle('single-card',reviewCandidates.length===1);const ready=pendingCards(reviewCandidates);summary.textContent=`${reviewCandidates.length} exact card${reviewCandidates.length===1?'':'s'} · ${ready.length} ready to approve`;const validating=reviewCandidates.some(candidate=>candidate.state==='rendering'||candidate.state==='checking');all.disabled=busy||validating||!ready.length;all.textContent=validating?'Checking cards…':`Approve all ready (${ready.length})`;list.replaceChildren(...reviewCandidates.map((candidate,index)=>{const article=document.createElement('article');article.className='batch-review-item';article.dataset.state=candidate.state;const thumb=document.createElement('div'),frame=document.createElement('div'),image=document.createElement('img'),copy=document.createElement('div'),title=document.createElement('strong'),state=document.createElement('small'),description=document.createElement('p'),button=document.createElement('button');thumb.className='batch-review-thumb';copy.className='batch-review-copy';frame.className='batch-review-frame';frame.dataset.orientation=candidate.card.orientation;if(reviewShowTestBackground&&backgroundUrl)frame.style.backgroundImage=`url("${backgroundUrl}")`;const name=candidate.card.disc.nickname||candidate.card.disc.mold.split('.').at(-1)||'Disc';image.alt=`Final ${name} card`;const url=reviewUrls.get(candidate.id);if(url) image.src=url;title.textContent=`${index+1}. ${name}`;state.textContent=candidate.state==='approved'?'Approved':candidate.state==='needs-adjustment'?'Needs adjustment':candidate.state==='ready'?'Ready for approval':'Preparing exact preview…';description.textContent=candidate.reason||`${candidate.card.cardDesign.toUpperCase()} · ${candidate.card.orientation} · ${Math.round((candidate.card.placement?.scale??1)*100)}%`;button.type='button';button.textContent=candidate.state==='approved'?'Approved':candidate.state==='needs-adjustment'?'Adjust on canvas':'Approve this card';button.disabled=busy||candidate.state==='approved'||candidate.state==='rendering'||candidate.state==='checking';button.onclick=()=>{if(candidate.state==='needs-adjustment'){reviewDialog.close();selectedAddress=rows().find(row=>row.disc.id===candidate.card.disc.id)?.address??selectedAddress;selectedAddresses=new Set([selectedAddress]);placement={...(candidate.card.placement??identityTransform)};renderBag();void renderPreview();status('Adjust the clipped card, then open review again.');}else if(candidate.state==='ready')void approveCandidates([candidate]);};frame.append(image);thumb.append(frame);copy.append(title,state,description,button);article.append(thumb,copy);if(candidate.state==='rendering'){reviewCandidates=transitionCandidate(reviewCandidates,candidate.id,'checking');void renderReviewCandidate(candidate,reviewGeneration);}return article;}));}
  async function approveCandidates(candidates: readonly ReviewCandidate[]){const eligible=candidates.filter(candidate=>candidate.state==='ready');if(!eligible.length||busy)return;setBusy(true);try{await experience.enqueueOutput(eligible.map(candidate=>candidate.card));for(const candidate of eligible)reviewCandidates=transitionCandidate(reviewCandidates,candidate.id,'approved');renderQueue();status(`Approved ${eligible.length} exact card${eligible.length===1?'':'s'} for export.`);}catch(error){status(`Cards were not approved: ${String(error)}`);}finally{setBusy(false);renderReview();}}
  function openReview(){reviewGeneration++;reviewShowTestBackground=false;for(const url of reviewUrls.values())URL.revokeObjectURL(url);reviewUrls.clear();const chosen=selectedRows();if(!chosen.length){status('Select one or more discs to review.');return;}const layout=preset.value as CardPreset,direction=orientation.value as CardOrientation;reviewCandidates=makeReviewCandidates(chosen.map(row=>cloneCard(row,direction,layout,placement)));reviewDialog.showModal();renderReview();}
  async function exportTransparent(){const card=outputQueue().at(-1);if(!card){status('Approve a card first.');return;}setBusy(true);try{const blob=await renderPlacedCardBlob(card.disc as any,card.orientation,card.cardDesign as CardPreset,card.placement);downloadBlob(blob,cardFilename(card));status('Transparent PNG prepared; the background is omitted.');}catch(error){status(`PNG export failed: ${String(error)}`);}finally{setBusy(false);}}
  async function exportZip(){const queue=outputQueue(),expected=experience.latestOutputApproval?.outputQueueSnapshotId as string|undefined;if(!queue.length||!expected){status('Approve the current output queue before exporting.');return;}setBusy(true);try{const result=await exportBrowserZip(queue,async card=>new Uint8Array(await(await renderPlacedCardBlob(card.disc as any,card.orientation,card.cardDesign as CardPreset,card.placement)).arrayBuffer()));await experience.validateOutputExport(expected);downloadBlob(result.blob,'discstudio-output-queue.zip');await experience.recordOutputExport({...result,expectedOutputQueueSnapshotId:expected,downloadRequested:true});renderQueue();status('Approved transparent PNGs packaged; preview backgrounds are omitted.');}catch(error){status(`ZIP was not prepared: ${String(error)}`);}finally{setBusy(false);}}
  async function exportCombined(){const card=outputQueue().at(-1);if(!card){status('Approve a card first.');return;}setBusy(true);try{const blob=await renderPlacedCardBlob(card.disc as any,card.orientation,card.cardDesign as CardPreset,card.placement),image=new Image(),url=URL.createObjectURL(blob),size=cardDimensions(card.orientation);try{image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;const ctx=canvas.getContext('2d')!;if(chosenBackground)ctx.drawImage(chosenBackground,0,0,size.width,size.height);ctx.drawImage(image,0,0);const combined=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Combined PNG encoding failed.')),'image/png'));downloadBlob(combined,'discstudio-combined-preview.png');status('Combined PNG prepared with the current preview background.');}finally{URL.revokeObjectURL(url);}}catch(error){status(`Combined PNG was not prepared: ${String(error)}`);}finally{setBusy(false);}}
  orientation.onchange=()=>{presets();void renderPreview();};preset.onchange=()=>void renderPreview();
  scaleInput.oninput=()=>{const prior={...placement}; placement.scale=Math.min(Number(scaleInput.value),Number(scaleInput.max));const b=(section as any).__alphaBounds as number[]|undefined;try{if(b)placement=clampTransform({width:frame.width,height:frame.height,alphaBounds:b,...placement});}catch{placement=prior;scaleInput.value=String(prior.scale);} $('card-scale-value').textContent=`${Math.round(placement.scale*100)}%`;previewSnapshot=snapshot();drawPreview();};
  backgroundChoice.onchange=()=>{upload.hidden=backgroundChoice.value!=='upload';void refreshBackground();};
  upload.onchange=async()=>{const file=upload.files?.[0];if(!file)return;const nextUrl=URL.createObjectURL(file),image=new Image();try{image.src=nextUrl;await image.decode();}catch{URL.revokeObjectURL(nextUrl);upload.value='';status('That test background could not be read. Choose another image.');return;}if(backgroundUrl)URL.revokeObjectURL(backgroundUrl);backgroundUrl=nextUrl;uploadedBackground=image;void refreshBackground();};
  reviewDialog.querySelector<HTMLInputElement>('#review-background-toggle input')!.addEventListener('change',event=>{reviewShowTestBackground=(event.currentTarget as HTMLInputElement).checked;renderReview();});reviewDialog.addEventListener('close',()=>{reviewGeneration++;for(const url of reviewUrls.values())URL.revokeObjectURL(url);reviewUrls.clear();});$('card-enqueue').addEventListener('click',openReview);$('setup-save').addEventListener('click',saveSetup);$('setup-apply').addEventListener('click',applySetup);reviewDialog.querySelector<HTMLButtonElement>('#batch-approve-all')!.addEventListener('click',()=>void approveCandidates(reviewCandidates.filter(candidate=>candidate.state==='ready')));$('card-png').addEventListener('click',()=>void exportTransparent());$('card-zip').addEventListener('click',()=>void exportZip());$('card-combined').addEventListener('click',()=>void exportCombined());
  presets();renderBag(true);renderQueue();updateSetupLabel();void renderPreview();void refreshBackground();document.addEventListener('discstudio:bag-changed',()=>{renderBag(true);void renderPreview();});
  return {refresh:renderBag,outputQueue};
}
