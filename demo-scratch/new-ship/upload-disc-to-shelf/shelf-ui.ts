import { flightFields, type createExperience } from './model.ts';
import { update } from './operations.ts';

// A lens over the model's shelf references. Selection/draft state is local UI state;
// only updateDisc and keepDisc retain candidates or change the selected shelf.
export function mountShelf(experience: ReturnType<typeof createExperience>, discView: Function, inspect: (address: string) => void, { root = document, onAddDisc }: { root?: ParentNode; onAddDisc?: () => void } = {}) {
  const grid = root.querySelector<HTMLElement>('#shelf')!;
  const section = grid.closest<HTMLElement>('.shelf-section')!;
  section.id = 'explore-shelf'; section.classList.add('shelf-experience');
  section.setAttribute('aria-label', 'Explore your shelf');
  const title = section.querySelector<HTMLElement>('.section-title')!;
  title.innerHTML = '<div><p class="shelf-kicker">02 / explore shelf</p><h2>Your shelf <span id="count">0</span></h2><p class="shelf-intro">The familiar ones. The next round.</p></div><a class="shelf-jump" href="#composer">+ Add a disc</a>';
  const add = title.querySelector<HTMLAnchorElement>('.shelf-jump')!;
  add.hidden = !onAddDisc;
  add.onclick = event => { event.preventDefault(); onAddDisc?.(); };
  const workspace = document.createElement('div'); workspace.className = 'shelf-workspace';
  workspace.innerHTML = `<aside class="shelf-context" aria-label="Find and orient">
      <p class="shelf-kicker">Find your disc</p>
      <label for="shelf-query">Search the shelf</label><input id="shelf-query" type="search" placeholder="Manufacturer, mold, plastic…" aria-describedby="shelf-search-help">
      <p id="shelf-search-help" class="shelf-note">Try “Discraft Buzzz ESP”.<br>Blank shows everything.</p>
      <div class="shelf-search-state"><span id="shelf-results" role="status"></span><button id="shelf-clear" type="button" hidden>Clear</button></div>
      <div class="shelf-bookmark" id="shelf-bookmark" hidden><p class="shelf-kicker">In your hand</p><strong id="shelf-held-name"></strong><p id="shelf-held-location" class="shelf-note"></p><button id="shelf-show-held" type="button">Show on shelf</button></div>
      <div class="shelf-context-foot"><p class="shelf-kicker">Before you head out</p><p>Pick one up.<br>Check the flight.<br>Keep what fits.</p><p id="shelf-storage" class="shelf-note"></p></div>
    </aside>
    <div class="shelf-main"><div class="shelf-main-heading"><span>Your discs</span><span>Pick one to take a closer look</span></div></div>
    <aside class="shelf-inspector" aria-label="Selected disc">
      <div id="shelf-rest"><p class="shelf-kicker">In your hand</p><div class="shelf-rest-mark" aria-hidden="true">↖</div><h3>Pick up a disc.</h3><p>Its own flight and mold defaults will be here, while your place stays on the shelf.</p></div>
      <form id="shelf-editor" hidden>
        <div class="shelf-inspector-heading"><p class="shelf-kicker">In your hand</p><button id="shelf-cancel" type="button">Put back</button></div>
        <div id="shelf-held-art"></div><h3 id="shelf-selection" tabindex="-1"></h3><p id="shelf-selected-description" class="shelf-note"></p><p id="shelf-nickname" class="shelf-note" hidden></p>
        <button id="shelf-swap-depiction" type="button" hidden>Switch depiction</button><button id="shelf-bag-add" type="button">Add to bag draft</button>
        <p id="shelf-filter-note" class="shelf-selection-note" hidden></p>
        <fieldset><legend>This disc’s flight</legend><p class="shelf-note">Check a field to use your disc’s value. Unchecked uses its mold; checked + blank means unknown.</p>
        <div class="shelf-flight-head" aria-hidden="true"><span>Own value</span><span>This disc</span><span>Mold</span></div>
        <div class="flight-edit">${flightFields.map(field => `<div class="shelf-flight-row"><label class="check" for="shelf-own-${field}"><input id="shelf-own-${field}" type="checkbox">${field[0].toUpperCase() + field.slice(1)}</label><input id="shelf-${field}" type="number" step="any" aria-label="Shelf ${field}" aria-describedby="shelf-base-${field}"><small id="shelf-base-${field}"></small></div>`).join('')}</div></fieldset>
        <div class="shelf-resolved-wrap"><span class="shelf-kicker">With these settings</span><p id="shelf-resolved"></p><small id="shelf-draft-state">On shelf · no changes yet</small></div>
        <div class="shelf-edit-actions"><button id="shelf-preview" type="submit">Preview candidate</button><button id="shelf-keep" type="button" disabled>Keep on shelf</button></div>
        <p class="shelf-note">Preview keeps a candidate. Keep updates this disc on the shelf.</p>
        <details class="shelf-evidence"><summary>Parts &amp; original upload</summary><p id="shelf-selected-address"></p><button id="shelf-inspect" type="button">Inspect selected Part</button><div id="shelf-original-ticks"></div></details>
      </form>
      <p id="shelf-status" role="status" aria-live="polite" hidden></p>
      <button id="shelf-reopen" type="button" hidden>Open current version</button>
    </aside>`;
  workspace.querySelector('.shelf-main')!.append(grid);
  section.append(workspace);
  const el = (id: string) => section.querySelector<HTMLElement>(`#${id}`)!;
  const input = (id: string) => el(id) as HTMLInputElement;
  const form = el('shelf-editor') as HTMLFormElement;
  let selected = '', candidate = '', generation = 0, previewing = false, keeping = false;
  const cards = new Map<string, HTMLElement>(); // DOM reuse only; values always come from shelf().
  let bagDraft: string[] = [], bagBusy = false;
  const bagPanel = document.createElement('section'); bagPanel.className = 'bag-draft';
  bagPanel.innerHTML = '<h3>Bag draft</h3><ul id="bag-draft-list"></ul><form id="bag-create"><label>Bag name<input id="bag-name" required maxlength="80" placeholder="For the next round"></label><button id="bag-create-button" type="submit">Create bag</button></form><p id="bag-status" role="status"></p><div id="bag-saved"></div>';
  workspace.querySelector('.shelf-main')!.append(bagPanel);
  function renderBags() {
    el('bag-draft-list').replaceChildren(...bagDraft.map(address => {
      const disc = experience.pxc.get(address).value, mold = experience.seedAt(disc.mold), item = document.createElement('li');
      const text = document.createElement('span'); text.textContent = `${mold.name} · ${disc.plastic} · ${disc.weight ?? '?'} g`;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.disabled = bagBusy;
      remove.onclick = () => { bagDraft = bagDraft.filter(ref => ref !== address); renderBags(); };
      item.append(text, remove); return item;
    }));
    input('bag-create-button').disabled = bagBusy || bagDraft.length === 0;
    el('bag-saved').replaceChildren(...experience.bags().map(({bag}) => {
      const item = document.createElement('p'); item.textContent = `${bag.name} · ${bag.discIds.length} discs`; return item;
    }));
  }
  el('shelf-bag-add').onclick = () => {
    if (!selected || !currentSelection() || bagBusy || keeping) return;
    const id = experience.pxc.get(selected).value.id;
    const existing = bagDraft.findIndex(ref => experience.pxc.get(ref).value.id === id);
    if (existing < 0) bagDraft.push(selected); else bagDraft[existing] = selected;
    renderBags(); el('bag-status').textContent = 'Exact copy added. Your draft stays while you explore.';
  };
  el('bag-create').addEventListener('submit', async event => {
    event.preventDefault(); if (bagBusy) return;
    bagBusy = true; renderBags();
    try { await experience.createBag(input('bag-name').value, bagDraft); bagDraft = []; el('bag-status').textContent = `Created ${input('bag-name').value}. ${storage()}`; }
    catch (error) { el('bag-status').textContent = `Not created: ${String(error)}`; }
    finally { bagBusy = false; renderBags(); }
  });
  const storage = () => (experience as typeof experience & { persistenceStatus?: string }).persistenceStatus || 'Session shelf · reload starts fresh.';
  function status(message: string, error = false) {
    const node = el('shelf-status'); node.textContent = message; node.hidden = !message;
    node.classList.toggle('is-error', error);
  }
  function patch() {
    return { patch: Object.fromEntries(flightFields.filter(f => input(`shelf-own-${f}`).checked).map(f => [f, input(`shelf-${f}`).value === '' ? null : Number(input(`shelf-${f}`).value)])),
      remove: flightFields.filter(f => !input(`shelf-own-${f}`).checked) };
  }
  function currentSelection() { return selected && experience.shelf().find(row => row.address === selected); }
  function buttons() {
    input('shelf-preview').disabled = keeping || previewing || !selected || !currentSelection();
    input('shelf-keep').disabled = keeping || previewing || !candidate || !currentSelection();
    input('shelf-cancel').disabled = keeping;
    input('shelf-swap-depiction').disabled = keeping || previewing || !currentSelection();
    input('shelf-bag-add').disabled = keeping || !currentSelection();
    for (const field of flightFields) {
      input(`shelf-own-${field}`).disabled = keeping;
      input(`shelf-${field}`).disabled = keeping || !input(`shelf-own-${field}`).checked;
    }
    for (const card of cards.values()) (card.querySelector('button') as HTMLButtonElement).disabled = keeping;
    form.setAttribute('aria-busy', String(keeping || previewing));
  }
  function showResolution() {
    if (!selected) return;
    const material = update({ value: experience.pxc.get(selected).value, ...patch() });
    const resolved = experience.resolve(material);
    const mold = experience.seedAt(material.mold);
    for (const field of flightFields) input(`shelf-${field}`).placeholder = input(`shelf-own-${field}`).checked ? '?' : String(mold[field] ?? '?');
    el('shelf-resolved').replaceChildren(...flightFields.map(field => {
      const item = document.createElement('span'), value = document.createElement('strong'), label = document.createElement('small');
      value.textContent = String(resolved[field] ?? '?'); label.textContent = field;
      item.append(value, label); return item;
    }));
    buttons();
  }
  function bookmark() {
    el('shelf-storage').textContent = storage();
    el('shelf-bookmark').hidden = !selected;
    section.classList.toggle('has-selection', !!selected);
    for (const [address, card] of cards) {
      const active = selected === address; card.classList.toggle('is-selected', active);
      const choose = card.querySelector('button')!; choose.setAttribute('aria-pressed', String(active));
      choose.querySelector('.shelf-pick-label')!.textContent = active ? 'In your hand' : 'Pick up';
    }
    if (selected) {
      const disc = experience.pxc.get(selected).value;
      const visible = experience.shelf(input('shelf-query').value).some(row => row.address === selected);
      const current = !!currentSelection();
      const mold = experience.seedAt(disc.mold);
      el('shelf-held-name').textContent = `${mold.name} · ${mold.manufacturer}`;
      const note = !current ? 'The shelf now holds a newer version. This retained version is still here for inspection.' : visible ? 'Your place is marked on the shelf.' : 'Outside this search. Still selected here.';
      el('shelf-held-location').textContent = note;
      el('shelf-filter-note').textContent = note; el('shelf-filter-note').hidden = current && visible;
      el('shelf-show-held').hidden = !current;
      el('shelf-reopen').hidden = current || !experience.shelf().some(row => row.disc.id === disc.id);
    } else el('shelf-reopen').hidden = true;
    buttons();
  }
  function select(address: string) {
    if (keeping) return;
    generation++; selected = address; candidate = ''; status('');
    const disc = experience.pxc.get(address).value, mold = experience.seedAt(disc.mold);
    el('shelf-selection').textContent = mold.name;
    el('shelf-selected-description').textContent = [mold.manufacturer, disc.plastic, disc.weight == null ? '' : `${disc.weight} g`].filter(Boolean).join(' · ');
    el('shelf-nickname').textContent = disc.nickname ? `Nickname · ${disc.nickname}` : '';
    el('shelf-nickname').hidden = !disc.nickname;
    const sources = experience.depictionSources(address);
    el('shelf-swap-depiction').hidden = !sources.photo;
    el('shelf-swap-depiction').textContent = sources.choice === 'photo' ? 'Use painting · keep photo' : 'Use photo · keep painting';
    const art = experience.shelf().find(row => row.address === address)?.art;
    const view = discView(disc, disc.depiction, art) as HTMLElement;
    el('shelf-held-art').replaceChildren(view.querySelector('.disc-art')!);
    el('shelf-selected-address').textContent = address;
    el('shelf-original-ticks').replaceChildren(...['specialize', 'depict', 'retain'].map(name => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `Original ${name}`;
      button.onclick = () => inspect(`ds.px.tick.${disc.id}.${name}`); return button;
    }));
    for (const field of flightFields) {
      input(`shelf-own-${field}`).checked = Object.hasOwn(disc, field);
      input(`shelf-${field}`).value = disc[field] == null ? '' : String(disc[field]);
      input(`shelf-${field}`).placeholder = String(mold[field] ?? '?');
      el(`shelf-base-${field}`).textContent = String(mold[field] ?? '?');
      el(`shelf-base-${field}`).setAttribute('aria-label', `Mold ${field}: ${mold[field] ?? 'unknown'}`);
    }
    el('shelf-draft-state').textContent = 'On shelf · no changes yet';
    form.querySelector('.shelf-edit-actions')!.before(el('shelf-status'), el('shelf-reopen'));
    form.hidden = false; el('shelf-rest').hidden = true;
    showResolution(); bookmark(); el('shelf-selection').focus({preventScroll:true});
    if (matchMedia('(max-width: 1000px)').matches) form.scrollIntoView({block:'nearest'});
  }
  function makeCard(row: ReturnType<typeof experience.shelf>[number]) {
    const {disc, seed, address, art} = row;
    const view = discView(disc, disc.depiction, art) as HTMLElement;
    const card = document.createElement('article'); card.dataset.address = address; card.className = 'shelf-disc';
    const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'shelf-pick';
    choose.setAttribute('aria-label', `Pick up ${seed.name}, ${seed.manufacturer}, ${disc.plastic || 'plastic unknown'}, ${disc.weight == null ? 'weight unknown' : `${disc.weight} g`}`);
    choose.setAttribute('aria-controls', 'shelf-editor'); choose.setAttribute('aria-pressed', 'false');
    choose.onclick = () => select(address);
    const image = view.querySelector('.disc-art')!; image.querySelector('img')?.setAttribute('loading','lazy');
    const title = document.createElement('h3'); title.textContent = seed.name;
    const mold = document.createElement('p'); mold.className = 'shelf-mold'; mold.textContent = seed.manufacturer;
    const spec = document.createElement('p'); spec.className = 'shelf-spec'; spec.textContent = [disc.plastic || 'Plastic unknown', disc.weight == null ? 'Weight unknown' : `${disc.weight} g`].join(' · ');
    const picked = document.createElement('span'); picked.className = 'shelf-pick-label'; picked.textContent = 'Pick up';
    choose.append(image, title, mold, spec, picked);
    const flight = document.createElement('div'); flight.className = 'shelf-card-flight'; const resolved = experience.resolve(disc);
    flight.setAttribute('aria-label', flightFields.map(f => `${f} ${resolved[f] ?? 'unknown'}`).join(', '));
    for (const field of flightFields) { const item = document.createElement('span'); const value = document.createElement('strong'), label = document.createElement('small'); value.textContent = String(resolved[field] ?? '?'); label.textContent = field; item.append(value,label); flight.append(item); }
    card.append(choose,flight); return card;
  }
  function refresh() {
    const all = experience.shelf(), rows = experience.shelf(input('shelf-query').value);
    // Stable neighborhoods; the model's retained order breaks ties within a mold.
    // Filtering and specimen edits never introduce a nickname/relevance ranking.
    rows.sort((a, b) => a.seed.manufacturer.localeCompare(b.seed.manufacturer, 'en') || a.seed.name.localeCompare(b.seed.name, 'en'));
    el('count').textContent = String(all.length);
    el('shelf-results').textContent = `${rows.length} of ${all.length} discs`;
    el('shelf-clear').hidden = !input('shelf-query').value;
    const addresses = new Set(all.map(row => row.address));
    for (const address of cards.keys()) if (!addresses.has(address)) cards.delete(address);
    grid.replaceChildren(...rows.map(row => {
      if (!cards.has(row.address)) cards.set(row.address, makeCard(row));
      return cards.get(row.address)!;
    }));
    if (!rows.length) {
      const empty = document.createElement('div'); empty.className = 'shelf-empty';
      const title = document.createElement('h3'); title.textContent = all.length ? 'Nothing in this corner.' : 'Make a little room.';
      const text = document.createElement('p'); text.textContent = all.length ? 'No discs match this search. The rest of your shelf is still here.' : 'Add your first disc above. A painting is all you need; a photo is optional.';
      const action = document.createElement('button'); action.type = 'button'; action.textContent = all.length ? 'Clear search' : 'Add your first disc';
      action.hidden = !all.length && !onAddDisc;
      action.onclick = () => { if (all.length) clearSearch(); else onAddDisc?.(); };
      empty.append(title,text,action); grid.append(empty);
    }
    bookmark(); renderBags();
  }
  el('shelf-swap-depiction').onclick = async () => {
    if (keeping || previewing || !selected || !currentSelection()) return;
    const before = selected, sources = experience.depictionSources(before); keeping = true; buttons();
    try {
      const next = await experience.updateDepiction(before, { choice: sources.choice === 'photo' ? 'painted' : 'photo' });
      await experience.keepDisc(before, next); keeping = false; refresh(); select(next); status('Depiction changed. Both sources are retained.');
    } catch (error) { status(`Not changed: ${String(error)}`, true); }
    finally { keeping = false; buttons(); }
  };
  function clearSearch() { input('shelf-query').value = ''; refresh(); input('shelf-query').focus({preventScroll:true}); }
  function returnToCard(address: string) {
    const button = grid.querySelector<HTMLElement>(`[data-address="${address}"] button`);
    (button || input('shelf-query')).focus({preventScroll:true});
    if (matchMedia('(max-width: 1000px)').matches) (button || grid).scrollIntoView({block:'nearest'});
  }
  function closeEditor() {
    generation++; selected = ''; candidate = ''; form.hidden = true;
    el('shelf-rest').before(el('shelf-status'), el('shelf-reopen'));
    el('shelf-rest').hidden = false; bookmark();
  }
  input('shelf-query').addEventListener('input', refresh);
  el('shelf-clear').onclick = clearSearch;
  el('shelf-show-held').onclick = () => { const address = selected; input('shelf-query').value = ''; refresh(); returnToCard(address); cards.get(address)?.scrollIntoView({block:'nearest'}); };
  el('shelf-reopen').onclick = () => { const id = experience.pxc.get(selected).value.id; const current = experience.shelf().find(row => row.disc.id === id); if (current) { refresh(); select(current.address); } };
  form.addEventListener('input', () => {
    if (keeping) return;
    generation++; candidate = ''; status(''); el('shelf-selected-address').textContent = selected;
    el('shelf-draft-state').textContent = 'Draft settings · shelf unchanged'; showResolution();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!selected || previewing || keeping) return;
    const version = ++generation, before = selected; previewing = true; candidate = ''; buttons();
    status('Preparing a candidate…');
    try {
      const changes = patch(), result = await experience.updateDisc(before, changes.patch, changes.remove);
      if (version !== generation) return;
      candidate = result; el('shelf-selected-address').textContent = candidate;
      el('shelf-draft-state').textContent = 'Candidate retained · shelf unchanged';
      status('Candidate ready. Keep it on the shelf, or put the original back unchanged.');
    } catch (error) { if (version === generation) status(`Preview failed. ${String(error)}`, true); }
    finally { previewing = false; bookmark(); }
  });
  el('shelf-keep').onclick = async () => {
    if (keeping || previewing || !candidate || !selected) return;
    keeping = true; buttons(); status('Keeping and checking the shelf…');
    const before = selected, after = candidate;
    try {
      const kept = await experience.keepDisc(before, after);
      keeping = false; closeEditor(); refresh();
      status(`Kept and read back. Original Part retained. ${storage()}`); returnToCard(kept);
    } catch (error) { status(`Could not keep this edit. ${String(error)}`, true); }
    finally { keeping = false; bookmark(); }
  };
  el('shelf-inspect').onclick = () => inspect(candidate || selected);
  el('shelf-cancel').onclick = () => {
    if (keeping) return;
    const before = selected; closeEditor(); status('Put back unchanged. Any preview Part remains available for inspection.'); returnToCard(before);
  };
  refresh(); return { refresh };
}
