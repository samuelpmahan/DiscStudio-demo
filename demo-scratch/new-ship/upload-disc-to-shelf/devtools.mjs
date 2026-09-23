import { inventory, inspectPart, printable, find, createScratch, reviseScratch, objectId, objectModel, runCalculation, runMember, createObjectPlayground, summarizeSaveReceipt } from './devtools-data.mjs';

export function mountDevTools(pxc, { label = 'UploadDiscToShelf' } = {}) {
  const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = './devtools.css'; document.head.append(stylesheet);
  const app = document.querySelector('main');
  const nav = document.createElement('nav'); nav.className = 'pxdt-nav'; nav.setAttribute('aria-label', 'Workspace');
  const panel = document.createElement('section'); panel.className = 'pxdt'; panel.hidden = true;
  // Static template only. All material, addresses and code below are textContent.
  panel.innerHTML = `<div class="pxdt-heading"><div><h1>PxC DevTools</h1><p>Live Parts. Actual links. No schema homework.</p></div><div class="pxdt-actions"><button data-action="refresh">Refresh live store</button><button data-action="close" aria-label="Close PxC DevTools">Close</button></div></div>
    <p class="pxdt-notice">Actual PxC of this mounted Experience. The host selects persistence or disposable state. Values are borrowed, not historical snapshots. Scratch results do not change application selections.</p>
    <div class="pxdt-toolbar"><label>Find Parts<input data-field="query" placeholder="Address, field, value…"></label><label>Address prefix<select data-field="prefix"><option value="">All addresses</option></select></label><label>Kind<select data-field="kind"><option value="">All kinds</option><option>Supplied</option><option>Produced</option><option>Calculation</option></select></label></div>
    <p data-view="stats" role="status"></p><div class="pxdt-grid"><section aria-label="Parts"><div data-view="list"></div><button data-action="more">Show 100 more</button></section><section class="pxdt-detail" aria-label="Part inspector"><h2 data-view="title">Select a Part</h2><div data-view="detail"></div></section></div>
    <details open><summary>Execution receipts</summary><div data-view="receipts"></div></details>
    <details><summary>Scratchpad · JSON material, no arbitrary JavaScript</summary><p>Create a supplied Part or derive a new result from the selected Part. Existing Parts remain untouched. This is experimentation, not a disc update.</p><label>JSON material<textarea data-field="json" rows="7">{ "hello": "PxC" }</textarea></label><button data-action="create">Create scratch Part</button> <button data-action="revise">Derive scratch result from selection</button><p data-view="scratch-status" role="status"></p></details>`;
  const $ = selector => panel.querySelector(selector);
  const button = (text, act) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = act; return b; };
  const text = (tag, value) => { const el = document.createElement(tag); el.textContent = value; return el; };
  let selected = null, selectedLabel = '', limit = 100;
  function show(open) {
    panel.hidden = !open;
    nav.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === (open ? 1 : 0))));
    if (open) refresh();
  }
  nav.append(button(label, () => show(false)), button('PxC DevTools', () => show(true)));
  app.before(nav); app.after(panel);
  panel.querySelector('[data-action="close"]').onclick = () => show(false);
  panel.querySelector('.pxdt-heading').append(button('Create object playground',()=>{
    const address=createObjectPlayground(pxc); refresh(); select(pxc.get(address),address);
  }));
  panel.querySelector('.pxdt-notice').append(' Object browsing does not call ordinary getters or toJSON. Proxy reflection traps may still execute. Live calls are opt-in and can have effects. The object playground is a labeled test fixture, not a disc.');
  function select(part, label) { selected = part; selectedLabel = label; renderDetail(); }
  function sourceLink(label, address) {
    if (!address) return text('span', 'UNVERIFIED');
    return button(label + ' ↗', () => select(pxc.get(address), address));
  }
  function verdict(ok) { const node = text('strong', ok ? 'PASS' : 'UNVERIFIED'); node.className = ok ? 'pxdt-pass' : 'pxdt-unverified'; return node; }
  function renderSaveSummary(host) {
    const summary = summarizeSaveReceipt(pxc, selectedLabel, selected);
    if (!summary) return false;
    const section = document.createElement('section'); section.className = 'pxdt-save-summary';
    section.append(text('h3', summary.title));
    const created = document.createElement('p'); created.append(text('strong', 'Disc Part: '), sourceLink(summary.discAddress, summary.discAddress), text('span', ' · '), sourceLink('fn.CREATE', summary.create.calculationAddress), text('span', ' · '), verdict(summary.create.verified)); section.append(created);
    const execution = document.createElement('p'); execution.append(text('strong', 'Save execution: '), sourceLink(summary.readback.pqlAddress.replace('ds.px.receipt.pql.', ''), selectedLabel), text('span', ' · stage, Tick, receipt and PQL trace; the Disc Part address is the physical-disc identity.')); section.append(execution);
    const bag = document.createElement('p'); bag.append(text('strong', 'Today’s Bag: '), sourceLink(String(summary.bag.beforeCount), summary.bag.beforeAddress), text('span', ' → '), sourceLink(String(summary.bag.afterCount), summary.bag.afterAddress), text('span', ' · added Part reference: '), ...(summary.bag.added.length ? summary.bag.added.flatMap(address => [sourceLink(address, address), text('span', ' ')]) : [text('span', 'none')]), verdict(summary.bag.verified)); section.append(bag);
    const read = document.createElement('p'); read.append(text('strong', 'Readback: '), sourceLink('PQL', summary.readback.pqlAddress), text('span', ' · Disc '), sourceLink(summary.readback.disc.into ?? 'UNVERIFIED', summary.readback.disc.into), text('span', ' · Shelf '), sourceLink(summary.readback.shelf.into ?? 'UNVERIFIED', summary.readback.shelf.into), text('span', ' · flags ' + (summary.readback.receiptFlags.readbackMatched && summary.readback.receiptFlags.shelfContainsDisc && summary.readback.receiptFlags.bagContainsDisc ? 'confirmed' : 'incomplete') + ' · '), verdict(summary.readback.verified)); section.append(read);
    host.append(section); return true;
  }
  function invocation(title, execute, initial) {
    const box = document.createElement('details'); box.className = 'pxdt-invoke';
    box.append(text('summary', title), text('p', 'Runs live code with the actual receiver/inputs. May mutate data or perform external effects. Not sandboxed, reversible, or cancellable.'));
    const label = text('label', 'Arguments / input bindings (JSON)');
    const editor = document.createElement('textarea'); editor.rows = 4; editor.value = initial; label.append(editor);
    const agree = document.createElement('input'); agree.type = 'checkbox'; agree.style.width = 'auto';
    const consent = text('label', ' Allow this live invocation'); consent.prepend(agree);
    const status = text('p', 'Not run'); status.setAttribute('role','status');
    const run = button('Run and inspect result', async () => {
      if (!agree.checked) { status.textContent = 'Enable live invocation first.'; return; }
      run.disabled = true; agree.checked = false; status.textContent = 'Running…';
      try {
        if (editor.value.length > 200000) throw Error('Input limit: 200,000 characters.');
        const pending = execute(JSON.parse(editor.value));
        renderList();
        const result = await pending;
        status.textContent = 'Produced ' + result.into;
        refresh(); select(result.output, result.into);
      } catch (error) { status.textContent = 'Failed: ' + String(error); renderList(); renderReceipts(); }
      finally { run.disabled = false; }
    });
    box.append(label, consent, run, status); return box;
  }
  function material(value, depth = 0, ancestors = new Set(), receiver = value) {
    if (typeof value === 'string') {
      const node = document.createElement('span');
      const target = pxc.entries().find(([address]) => address === value);
      if (target) node.append(button('↗ ' + value, () => select(target[1], value)), text('small', 'address-valued string'));
      else if (/^data:image\/(png|jpeg|webp|svg\\+xml)[;,]/.test(value)) {
        const img = document.createElement('img'); img.src = value; img.alt = 'Retained image material'; img.className = 'pxdt-image';
        node.append(img, text('small', value.length + ' characters; image bytes hidden'));
      } else node.textContent = value;
      return node;
    }
    if (value === null || !['object','function'].includes(typeof value)) return text('pre', printable(value));
    const wrap = document.createElement('div'), model = objectModel(value);
    wrap.append(text('p', model.id + ' · ' + (typeof value === 'function' ? 'function' : 'object') + (model.frozen ? ' · frozen' : '') + (model.extensible ? ' · extensible' : ' · non-extensible')));
    if (model.error) { wrap.append(text('p', model.error)); return wrap; }
    if (ancestors.has(value)) { wrap.append(text('small','Same object as an ancestor (cycle); identity preserved.')); return wrap; }
    const next = new Set(ancestors); next.add(value);
    const bindings = pxc.entries().filter(([,part])=>part === value || part.value === value);
    for (const [address, part] of bindings) wrap.append(button('Bound object → ' + address, ()=>select(part,address)));
    if (typeof value === 'function') {
      try { wrap.append(text('pre',Function.prototype.toString.call(value))); } catch (e) { wrap.append(text('pre',String(e))); }
    }
    const lazy = (label, build) => {
      const row = document.createElement('details'); row.append(text('summary', label));
      row.addEventListener('toggle', () => { if (row.open && row.childNodes.length === 1) {
        try { row.append(build()); } catch(e) { row.append(text('pre','Inspection failed: '+String(e))); }
      } }); return row;
    };
    let offset = 0;
    const rows = document.createElement('div');
    const more = button('Show next 100 properties', appendProperties);
    function appendProperties() {
      for (const d of model.properties.slice(offset,offset+100)) {
        const label = String(d.key) + ' · ' + ('value' in d ? typeof d.value : 'accessor') +
          (d.enumerable ? '' : ' · non-enumerable') + (d.configurable ? '' : ' · non-configurable') +
          ('writable' in d ? (d.writable ? ' · writable' : ' · read-only') : '');
        rows.append(lazy(label, () => {
          const content = document.createElement('div');
          if ('value' in d) {
            content.append(material(d.value,depth+1,next));
            if (typeof d.value === 'function') content.append(invocation('Call method on ' + objectId(receiver), args=>runMember(pxc,receiver,d.value,args), '[]'));
          } else {
            if (d.get) {
              content.append(text('pre',Function.prototype.toString.call(d.get)));
              content.append(invocation('Evaluate getter on ' + objectId(receiver), ()=>runMember(pxc,receiver,d.get,[],'getter'), '[]'));
            }
            if (d.set) {
              content.append(text('pre',Function.prototype.toString.call(d.set)));
              content.append(invocation('Invoke setter on ' + objectId(receiver), args=>{
                if (!Array.isArray(args) || args.length !== 1) throw Error('Setter requires exactly one argument.');
                return runMember(pxc,receiver,d.set,args);
              }, '[null]'));
            }
          }
          return content;
        }));
      }
      offset += 100; more.hidden = offset >= model.properties.length;
    }
    wrap.append(text('small',model.properties.length + ' own properties, including symbols and non-enumerables. Accessors not evaluated.'),rows,more);
    appendProperties();
    if (value instanceof Map) wrap.append(lazy('[[Map entries]]',()=>material([...Map.prototype.entries.call(value)],depth+1,next)));
    if (value instanceof Set) wrap.append(lazy('[[Set values]]',()=>material([...Set.prototype.values.call(value)],depth+1,next)));
    wrap.append(lazy('[[Prototype]] ' + (model.prototype === null ? 'null' : objectId(model.prototype)),()=>material(model.prototype,depth+1,next,receiver)));
    return wrap;
  }
  function renderDetail() {
    if (!selected) return;
    $('[data-view="title"]').textContent = selectedLabel;
    const host = $('[data-view="detail"]'); host.replaceChildren();
    const info = inspectPart(pxc, selected);
    host.append(text('p', info.addresses.length ? `Bindings: ${info.addresses.join(', ')}` : 'Inline Part — retained in a composition, not bound to an address.'));
    const semanticSave = renderSaveSummary(host);
    if (semanticSave) {
      const raw = document.createElement('details'); raw.append(text('summary', 'Raw fields'));
      raw.addEventListener('toggle', () => { if (raw.open && raw.childNodes.length === 1) raw.append(text('h3', 'Live JavaScript object'), material(selected.value)); });
      host.append(raw);
    } else host.append(text('h3', 'Live JavaScript object'), material(selected.value));
    const wrapper = document.createElement('details'); wrapper.append(text('summary','Inspect the Part wrapper itself'));
    wrapper.addEventListener('toggle',()=>{ if(wrapper.open && wrapper.childNodes.length === 1) wrapper.append(material(selected)); }); host.append(wrapper);
    if (typeof selected.value === 'function') {
      const calculation = selected;
      const previous = pxc.receipts().find(r=>r.composition.calculation === calculation);
      const suggestion = Object.fromEntries(Object.entries(previous?.composition.inputs ?? {}).map(([name,part])=>{
        const address = pxc.entries().find(([,p])=>p===part)?.[0];
        return [name,address ? {ref:address} : {value:null}];
      }));
      host.append(text('p','Calculation inputs: {"name":{"ref":"address"}} or {"name":{"value":...}}. Suggestions use observed calls; inline null placeholders must be supplied.'));
      host.append(invocation('Run selected Calculation through PxC',bindings=>runCalculation(pxc,calculation,bindings),JSON.stringify(suggestion,null,2)));
    }
    const json = document.createElement('details'); json.append(text('summary', 'JSON view · functions/images represented, not a lossless export'), text('pre', printable(selected.value))); host.append(json);
    host.append(text('h3', 'Produced by · actual Part references'));
    if (!info.edges.length) host.append(text('p', 'Supplied material: no producing composition.'));
    for (const edge of info.edges) host.append(button(`${edge.role} → ${edge.addresses.join(', ') || '(inline Part)'}`, () => select(edge.part, edge.addresses[0] || `Inline ${edge.role}`)));
    host.append(text('h3', 'Used by · retained compositions'));
    if (!info.consumers.length) host.append(text('p', 'No retained direct consumers found.'));
    for (const use of info.consumers) host.append(button(use.address, () => select(use.part, use.address)));
    host.append(button('Serialize to scratchpad (may invoke getters / toJSON)', () => {
      try { const json = JSON.stringify(selected.value, null, 2); if (json === undefined || json.length > 200000) throw Error('Not a small JSON value');
        $('[data-field="json"]').value = json; $('[data-view="scratch-status"]').textContent = 'Copied as JSON, not a lossless clone of arbitrary JS. Open Scratchpad below.';
      } catch { $('[data-view="scratch-status"]').textContent = 'This material cannot be copied as small JSON. Enter explicit scratch material instead.'; }
    }));
  }
  function renderList() {
    const all = inventory(pxc), prefix = $('[data-field="prefix"]').value, kind = $('[data-field="kind"]').value;
    const rows = find({ collection: all.filter(row => (!prefix || row.address.startsWith(prefix + '.')) && (!kind || row.kind === kind)), query: $('[data-field="query"]').value, fields: row => [row.address, printable(row.part.value)] });
    $('[data-view="stats"]').textContent = `${all.length} live bindings · ${rows.length} matches · ${pxc.receipts().length} execution receipts`;
    $('[data-view="list"]').replaceChildren(...rows.slice(0, limit).map(row => {
      const b = button(`${row.address}  ·  ${row.kind}`, () => select(row.part, row.address)); b.className = 'pxdt-row'; return b;
    }));
    if (!rows.length) $('[data-view="list"]').append(text('p', 'No matching Parts. Clear a filter or try different text.'));
    $('[data-action="more"]').hidden = rows.length <= limit;
  }
  function refresh() {
    const prefix = $('[data-field="prefix"]'), previous = prefix.value;
    const prefixes = new Set(inventory(pxc).flatMap(row => {
      const bits = row.address.split('.'); return bits.slice(0, -1).map((_, i) => bits.slice(0, i + 1).join('.'));
    }));
    prefix.replaceChildren(new Option('All addresses', ''), ...[...prefixes].sort().map(p => new Option(p, p))); prefix.value = previous;
    renderList(); renderDetail();
    renderReceipts();
  }
  function renderReceipts() {
    const receipts = pxc.receipts();
    $('[data-view="receipts"]').replaceChildren(...receipts.slice(-100).reverse().map(receipt => {
      const row = document.createElement('div'); row.append(text('span', `${receipt.status} · `));
      if (receipt.output) row.append(button(receipt.into, () => select(receipt.output, receipt.into)));
      else row.append(text('span', `${receipt.into}: ${String(receipt.error)}`));
      row.append(button('Inspect execution', () => {
        const host = $('[data-view="detail"]'); host.replaceChildren(text('h3',receipt.status + ' → ' + receipt.into));
        host.append(text('p',receipt.error ? String(receipt.error) : 'Execution produced a Part.'));
        host.append(button('Calculation',()=>select(receipt.composition.calculation,'Execution Calculation')));
        for (const [role,part] of Object.entries(receipt.composition.inputs)) host.append(button('Input: '+role,()=>select(part,'Input '+role)));
        if(receipt.output) host.append(button('Output',()=>select(receipt.output,receipt.into)));
        $('[data-view="title"]').textContent='Execution '+receipt.into;
      }));
      return row;
    }));
    if (!receipts.length) $('[data-view="receipts"]').append(text('p', 'No executions yet. Supplied Parts are not execution receipts.'));
    if (receipts.length > 100) $('[data-view="receipts"]').prepend(text('p', 'Showing latest 100 execution receipts.'));
  }
  $('[data-action="refresh"]').onclick = refresh;
  for (const field of ['query', 'prefix', 'kind']) $('[data-field="' + field + '"]').addEventListener('input', () => { limit = 100; renderList(); });
  $('[data-action="more"]').onclick = () => { limit += 100; renderList(); };
  async function scratch(revise) {
    const status = $('[data-view="scratch-status"]');
    try {
      const raw = $('[data-field="json"]').value; if (raw.length > 200000) throw Error('Scratch input limit: 200,000 characters.');
      const value = JSON.parse(raw); if (revise && !selected) throw Error('Select a Part first.');
      const address = revise ? await reviseScratch(pxc, selected, value) : createScratch(pxc, value);
      status.textContent = `Retained ${address}. Application selections unchanged.`; refresh(); select(pxc.get(address), address);
    } catch (error) { status.textContent = `Not created: ${String(error)}`; }
  }
  $('[data-action="create"]').onclick = () => scratch(false);
  $('[data-action="revise"]').onclick = () => scratch(true);
  show(false);
  return { open(address) { show(true); if (address) select(pxc.get(address), address); panel.querySelector('[data-view="detail"]').scrollIntoView({ block: 'nearest' }); }, refresh };
}
