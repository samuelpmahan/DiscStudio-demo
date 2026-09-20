import { renderCardBlob, renderCardPreview, type CardOrientation, type CardPreset } from './browser-card-renderer.ts';
import { cardFilename, type QueuedCard } from './export-queue-core.ts';
import { downloadBlob, exportBrowserZip } from './browser-export.ts';
import type { createExperience } from './model.ts';

const PRESETS: { id: CardPreset; orientation: CardOrientation; name: string }[] = [
  { id: 'u01', orientation: 'vertical', name: 'U01 · Compact scorebug' }, { id: 'u02', orientation: 'vertical', name: 'U02 · Stacked poster' },
  { id: 'u03', orientation: 'vertical', name: 'U03 · Rail card' }, { id: 'u04', orientation: 'vertical', name: 'U04 · Kinetic name' }, { id: 'u05', orientation: 'vertical', name: 'U05 · Glass drawer' },
  { id: 'b01', orientation: 'horizontal', name: 'B01 · Hero rail' }, { id: 'b02', orientation: 'horizontal', name: 'B02 · Split nameplate' },
  { id: 'b03', orientation: 'horizontal', name: 'B03 · Framed hero' }, { id: 'b04', orientation: 'horizontal', name: 'B04 · Peak mark' }, { id: 'b05', orientation: 'horizontal', name: 'B05 · Stamp macro' },
];

type Experience = ReturnType<typeof createExperience>;
type BagRow = ReturnType<Experience['bag']>[number];
type Snapshot = Readonly<{ cards: readonly QueuedCard[]; preset: CardPreset; orientation: CardOrientation }>;

function cloneCard(row: BagRow, orientation: CardOrientation, preset: CardPreset): QueuedCard {
  const seed = row.seed;
  const disc = Object.freeze({ ...row.disc, depiction: Object.freeze({ ...row.disc.depiction }), renderer: Object.freeze({ moldName: seed.name, flights: [seed.speed ?? null, seed.glide ?? null, seed.turn ?? null, seed.fade ?? null] }) });
  return Object.freeze({ disc, orientation, cardDesign: preset });
}

export function mountExport(experience: Experience, { root = document }: { root?: ParentNode } = {}) {
  const priorShelf = root.querySelector<HTMLElement>('.shelf-section');
  if (priorShelf) priorShelf.hidden = true;
  const section = document.createElement('section'); section.id = 'todays-bag'; section.className = 'todays-bag-export';
  section.innerHTML = `<div class="section-title"><div><p class="eyebrow">TODAY’S BAG</p><h2>Make your card.</h2></div><span>03 — transparent export</span></div>
    <p class="subtle">Pick one or more saved discs, choose a fixed layout and orientation, then preview your overlay.</p>
    <div class="bag-export-grid"><div><div id="bag-export-list" class="bag-export-list" aria-live="polite"></div><p id="bag-export-empty" class="subtle">Save a cropped disc photo to add it here.</p></div>
    <div class="bag-export-controls"><label>Orientation<select id="card-orientation"><option value="vertical">Vertical · 9:16</option><option value="horizontal">Horizontal · 16:9</option></select></label><label>Fixed layout<select id="card-preset"></select></label>
      <div id="card-preview" class="card-preview"><p class="subtle">Your selected card will appear here.</p></div><p id="card-export-status" class="subtle" role="status"></p>
      <div class="card-export-actions"><button id="card-png" type="button" class="primary">Download PNG</button><button id="card-zip" type="button">Download selected cards</button></div>
      <p class="subtle">PNG is transparent outside the card. Selected cards download together as a ZIP.</p></div></div>`;
  (priorShelf?.parentElement ?? root.querySelector('main')!).insertBefore(section, priorShelf ?? null);
  const $ = (id: string) => section.querySelector<HTMLElement>(`#${id}`)!;
  const orientation = $('card-orientation') as HTMLSelectElement, preset = $('card-preset') as HTMLSelectElement;
  const selected = new Set<string>(); let previewUrl = '', previewSerial = 0, busy = false, previewSnapshot: Snapshot | null = null;
  const status = (text: string) => { $('card-export-status').textContent = text; };
  const activePreset = () => preset.value as CardPreset;
  const rows = () => experience.bag();
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
    return Object.freeze({ cards: Object.freeze(chosen.map(row => cloneCard(row, direction, layout))), preset: layout, orientation: direction });
  }
  function setBusy(next: boolean) {
    busy = next;
    for (const button of section.querySelectorAll<HTMLButtonElement>('.bag-export-disc')) button.disabled = next;
    const downloadable = !next && !!previewSnapshot && !!previewUrl;
    ($('card-png') as HTMLButtonElement).disabled = !downloadable;
    ($('card-zip') as HTMLButtonElement).disabled = !downloadable;
  }
  async function preview() {
    const current = snapshot(), serial = ++previewSerial;
    if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; previewSnapshot = null;
    if (!current) { $('card-preview').replaceChildren(Object.assign(document.createElement('p'), { className: 'subtle', textContent: 'Choose a saved disc to preview its card.' })); setBusy(false); return; }
    $('card-preview').replaceChildren(Object.assign(document.createElement('p'), { className: 'subtle', textContent: 'Rendering your overlay…' }));
    status(`Rendering ${current.preset.toUpperCase()} for preview…`); setBusy(true);
    try {
      const url = await renderCardPreview(current.cards[0].disc as any, current.orientation, current.preset);
      if (serial !== previewSerial) { URL.revokeObjectURL(url); return; }
      previewUrl = url; previewSnapshot = current;
      const image = document.createElement('img'); image.src = url; image.alt = `${current.preset.toUpperCase()} preview for ${current.cards[0].disc.nickname || current.cards[0].disc.mold}`;
      $('card-preview').replaceChildren(image);
      status(`${current.cards.length > 1 ? `Previewing the first of ${current.cards.length} selected cards. ` : ''}${current.preset.toUpperCase()} ${current.orientation} is ready to download.`);
    } catch (error) { if (serial === previewSerial) { previewSnapshot = null; previewUrl = ''; $('card-preview').replaceChildren(Object.assign(document.createElement('p'), { className: 'subtle', textContent: 'This prepared photo cannot be rendered for export.' })); status(`Preview unavailable: ${String(error)}`); } }
    finally { if (serial === previewSerial) setBusy(false); }
  }
  function renderBag() {
    const bag = rows(), available = new Set(bag.map(row => row.address));
    for (const address of selected) if (!available.has(address)) selected.delete(address);
    if (!selected.size && bag.length) selected.add(bag[0].address);
    const list = $('bag-export-list'); list.replaceChildren(...bag.map(row => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'bag-export-disc'; button.setAttribute('aria-pressed', String(selected.has(row.address)));
      const image = document.createElement('img'); image.src = row.disc.depiction.src; image.alt = '';
      const copy = document.createElement('span'), name = document.createElement('strong'), detail = document.createElement('small');
      name.textContent = row.disc.nickname || row.seed.name; detail.textContent = `${row.seed.manufacturer} · ${row.disc.plastic || 'plastic unknown'}${row.disc.weight == null ? '' : ` · ${row.disc.weight} g`}`;
      copy.append(name, detail); button.append(image, copy); button.onclick = () => { selected.has(row.address) ? selected.delete(row.address) : selected.add(row.address); renderBag(); void preview(); }; return button;
    }));
    $('bag-export-empty').hidden = bag.length > 0;
    setBusy(false);
  }
  orientation.onchange = () => { presets(); void preview(); };
  preset.onchange = () => void preview();
  ($('card-png') as HTMLButtonElement).onclick = async () => {
    const current = previewSnapshot; if (!current || busy) return; setBusy(true); status('Preparing your transparent PNG…');
    try { const card = current.cards[0], blob = await renderCardBlob(card.disc as any, current.orientation, current.preset); downloadBlob(blob, cardFilename(card)); status(`Downloaded ${cardFilename(card)} from ${current.preset.toUpperCase()}.`); }
    catch (error) { status(`PNG not downloaded: ${String(error)}`); } finally { setBusy(false); }
  };
  ($('card-zip') as HTMLButtonElement).onclick = async () => {
    const current = previewSnapshot; if (!current || busy) return; setBusy(true); status(`Preparing ${current.cards.length} selected card${current.cards.length === 1 ? '' : 's'}…`);
    try {
      const result = await exportBrowserZip(current.cards, async card => new Uint8Array(await (await renderCardBlob(card.disc as any, card.orientation, card.cardDesign as CardPreset)).arrayBuffer()));
      downloadBlob(result.blob, 'discstudio-cards.zip'); status(`Downloaded ${current.cards.length} card${current.cards.length === 1 ? '' : 's'} from ${current.preset.toUpperCase()}.`);
    } catch (error) { status(`ZIP not downloaded: ${String(error)}`); } finally { setBusy(false); }
  };
  presets(); renderBag(); void preview();
  document.addEventListener('discstudio:bag-changed', () => { renderBag(); void preview(); });
  return { refresh: renderBag };
}
