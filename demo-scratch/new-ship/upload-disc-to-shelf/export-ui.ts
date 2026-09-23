import { renderCardBlob, renderCardPreview, type CardOrientation, type CardPreset } from './browser-card-renderer.ts';
import { cardFilename, queueCards, type QueuedCard } from './export-queue-core.ts';
import { exportBrowserZip, downloadBlob } from './browser-export.ts';
import type { createExperience } from './model.ts';

const PRESETS: { id: CardPreset; orientation: CardOrientation; name: string }[] = [
  { id: 'u01', orientation: 'vertical', name: 'U01 · Compact scorebug' }, { id: 'u02', orientation: 'vertical', name: 'U02 · Stacked poster' },
  { id: 'b01', orientation: 'horizontal', name: 'B01 · Hero rail' }, { id: 'b02', orientation: 'horizontal', name: 'B02 · Split nameplate' },
];

type Experience = ReturnType<typeof createExperience>;
type BagRow = ReturnType<Experience['bag']>[number];
type Snapshot = Readonly<{ cards: readonly QueuedCard[]; preset: CardPreset; orientation: CardOrientation }>;

function cloneCard(row: BagRow, orientation: CardOrientation, preset: CardPreset): QueuedCard {
  const seed = row.seed;
  return { disc: { ...row.disc, depiction: { ...row.disc.depiction }, renderer: { moldName: seed.name, flights: [seed.speed ?? null, seed.glide ?? null, seed.turn ?? null, seed.fade ?? null] } } as any, orientation, cardDesign: preset };
}

/** The current choice is disposable; only enqueueOutput creates held PxC output. */
export function mountExport(experience: Experience, { root = document }: { root?: ParentNode } = {}) {
  const priorShelf = root.querySelector<HTMLElement>('.shelf-section');
  if (priorShelf) priorShelf.hidden = true;
  const section = document.createElement('section'); section.id = 'ready-discs'; section.className = 'todays-bag-export';
  section.innerHTML = `<div class="section-title"><div><p class="eyebrow">READY TO EXPORT</p><h2>Make your cards.</h2></div><span>02 — choose and export</span></div>
    <p class="subtle">Up to four discs and four cards per ZIP. This tab keeps your work until you leave.</p>
    <div class="bag-export-grid"><div><div id="bag-export-list" class="bag-export-list" aria-live="polite"></div><p id="bag-export-empty" class="subtle">Prepare a disc photo to start.</p>
      <section class="output-queue" aria-labelledby="output-queue-title"><h3 id="output-queue-title">Cards to export <span id="output-count">0 / 4</span></h3><p id="output-queue-empty" class="subtle">Choose a disc and a design, then add a card here.</p><ol id="output-queue-list"></ol></section></div>
    <div class="bag-export-controls"><label>Orientation<select id="card-orientation"><option value="vertical">Vertical · 9:16</option><option value="horizontal">Horizontal · 16:9</option></select></label><label>Fixed layout<select id="card-preset"></select></label>
      <div id="card-preview" class="card-preview"><p class="subtle">Select a ready disc to preview a card.</p></div><p id="card-export-status" class="subtle" role="status"></p>
      <div class="card-export-actions"><button id="card-enqueue" type="button">Add card</button><button id="card-zip" class="primary" type="button">Download ZIP</button></div>
      <p class="subtle">Two portrait and two landscape designs. Download before leaving this tab.</p></div></div>`;
  (priorShelf?.parentElement ?? root.querySelector('main') ?? root).insertBefore(section, priorShelf ?? null);
  const $ = (id: string) => section.querySelector<HTMLElement>(`#${id}`)!;
  const orientation = $('card-orientation') as HTMLSelectElement, preset = $('card-preset') as HTMLSelectElement;
  const selected = new Set<string>(); let previewUrl = '', previewSerial = 0, busy = false, previewSnapshot: Snapshot | null = null;
  const status = (text: string) => { $('card-export-status').textContent = text; };
  const activePreset = () => preset.value as CardPreset;
  const rows = () => experience.intakeAddress ? experience.intake() : experience.bag();
  const outputQueue = () => experience.outputQueue();
  function presets() {
    const wanted = orientation.value as CardOrientation, previous = activePreset();
    preset.replaceChildren(...PRESETS.filter(item => item.orientation === wanted).map(item => new Option(item.name, item.id)));
    const defaultPreset: CardPreset = wanted === 'vertical' ? 'u02' : 'b01';
    preset.value = PRESETS.some(item => item.id === previous && item.orientation === wanted) ? previous : defaultPreset;
  }
  function snapshot(): Snapshot | null {
    const chosen = rows().filter(row => selected.has(row.address));
    if (!chosen.length) return null;
    const direction = orientation.value as CardOrientation, layout = activePreset();
    return Object.freeze({ cards: queueCards(chosen.map(row => cloneCard(row, direction, layout))), preset: layout, orientation: direction });
  }
  function setBusy(next: boolean) {
    busy = next;
    for (const button of section.querySelectorAll<HTMLButtonElement>('.bag-export-disc,.output-queue-remove')) button.disabled = next;
    orientation.disabled = next; preset.disabled = next;
    ($('card-enqueue') as HTMLButtonElement).disabled = next || !previewSnapshot || outputQueue().length + previewSnapshot.cards.length > 4;
    ($('card-zip') as HTMLButtonElement).disabled = next || outputQueue().length === 0;
  }
  function clearPreview() {
    previewSerial++; if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; previewSnapshot = null;
    $('card-preview').replaceChildren(Object.assign(document.createElement('p'), { className: 'subtle', textContent: 'Preview a card before adding it to the ZIP.' }));
    // A saved disc can arrive while an old preview decodes. Cancel that render
    // and release its controls; its finally branch is deliberately stale.
    if (busy) setBusy(false);
  }
  async function preview() {
    const current = snapshot(), serial = ++previewSerial;
    if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; previewSnapshot = null;
    if (!current) { $('card-preview').replaceChildren(Object.assign(document.createElement('p'), { className: 'subtle', textContent: 'Select a ready disc to preview a card.' })); status('Select at least one disc.'); setBusy(false); return; }
    $('card-preview').replaceChildren(Object.assign(document.createElement('p'), { className: 'subtle', textContent: 'Rendering your card preview…' })); status(`Rendering ${current.preset.toUpperCase()} preview for ${current.cards.length} selected disc${current.cards.length === 1 ? '' : 's'}…`); setBusy(true);
    try {
      const url = await renderCardPreview(current.cards[0].disc as any, current.orientation, current.preset);
      if (serial !== previewSerial) { URL.revokeObjectURL(url); return; }
      previewUrl = url; previewSnapshot = current;
      const image = document.createElement('img'); image.src = url; image.alt = `${current.preset.toUpperCase()} preview for ${current.cards[0].disc.nickname || current.cards[0].disc.mold}`;
      $('card-preview').replaceChildren(image);
      status(`${current.cards.length > 1 ? `Previewing the first of ${current.cards.length} selected cards. ` : ''}${current.preset.toUpperCase()} ${current.orientation} preview ready.`);
    } catch (error) { if (serial === previewSerial) { $('card-preview').replaceChildren(Object.assign(document.createElement('p'), { className: 'subtle', textContent: 'This prepared photo cannot be rendered for preview.' })); status(`Preview unavailable: ${String(error)}`); } }
    finally { if (serial === previewSerial) setBusy(false); }
  }
  function renderQueue() {
    const queue = outputQueue(), list = $('output-queue-list');
    list.replaceChildren(...queue.map((card, index) => {
      const row = document.createElement('li'); row.className = 'output-queue-item';
      const label = document.createElement('span'); label.textContent = `${index + 1}. ${card.disc.nickname || card.disc.mold.split('.').at(-1)} · ${card.cardDesign.toUpperCase()} · ${card.orientation}`;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'output-queue-remove'; remove.textContent = 'Remove'; remove.onclick = async () => { if (busy) return; setBusy(true); try { await experience.removeOutput(index); renderQueue(); status('Removed the queued card. Your current preview did not change.'); } catch (error) { status(`Queued card was not removed: ${String(error)}`); } finally { setBusy(false); } };
      row.append(label, remove); return row;
    }));
    $('output-queue-empty').hidden = queue.length > 0; setBusy(busy);
    $('output-count').textContent = `${queue.length} / 4`;
  }
  function renderBag() {
    const bag = rows(), available = new Set(bag.map(row => row.address));
    for (const address of selected) if (!available.has(address)) selected.delete(address);
    const list = $('bag-export-list'); list.replaceChildren(...bag.map(row => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'bag-export-disc'; button.setAttribute('aria-pressed', String(selected.has(row.address)));
      const image = document.createElement('img'); image.src = row.disc.depiction.src; image.alt = '';
      const copy = document.createElement('span'), name = document.createElement('strong'), detail = document.createElement('small');
      name.textContent = row.disc.nickname || row.seed.name; detail.textContent = `${row.seed.manufacturer} · ${row.disc.plastic || 'plastic unknown'}${row.disc.weight == null ? '' : ` · ${row.disc.weight} g`}`;
      copy.append(name, detail); button.append(image, copy);
      button.onclick = () => { selected.has(row.address) ? selected.delete(row.address) : selected.add(row.address); renderBag(); void preview(); };
      return button;
    }));
    $('bag-export-empty').hidden = bag.length > 0; setBusy(busy);
  }
  orientation.onchange = () => { presets(); void preview(); };
  preset.onchange = () => void preview();
  ($('card-enqueue') as HTMLButtonElement).onclick = async () => {
    const held = previewSnapshot; if (!held || busy) return; setBusy(true);
    try { await experience.enqueueOutput(held.cards); renderQueue(); status(`Added ${held.cards.length} card${held.cards.length === 1 ? '' : 's'} to the output queue.`); }
    catch (error) { status(`Nothing was added to the output queue: ${String(error)}`); }
    finally { setBusy(false); }
  };
  ($('card-zip') as HTMLButtonElement).onclick = async () => {
    const queue = outputQueue(); if (!queue.length || busy) return; setBusy(true); status(`Packaging ${queue.length} queued card${queue.length === 1 ? '' : 's'}…`);
    try {
      const result = await exportBrowserZip(queue, async card => new Uint8Array(await (await renderCardBlob(card.disc as any, card.orientation, card.cardDesign as CardPreset)).arrayBuffer()));
      downloadBlob(result.blob, 'discstudio-output-queue.zip');
      status(`ZIP download requested for ${queue.length} queued card${queue.length === 1 ? '' : 's'}. The queue remains available until you remove cards.`);
    } catch (error) { status(`ZIP was not prepared: ${String(error)} The output queue is unchanged.`); }
    finally { setBusy(false); }
  };
  presets(); renderBag(); renderQueue();
  document.addEventListener('discstudio:intake-changed', () => { renderBag(); clearPreview(); renderQueue(); });
  return { refresh: () => { renderBag(); renderQueue(); }, outputQueue };
}
