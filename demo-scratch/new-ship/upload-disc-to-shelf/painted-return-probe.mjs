import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createExperience, initialDraft } from './model.ts';
import { archive, restore } from './persistence.ts';
import { createDiscView } from './disc-view.ts';
import { paintedDiscsEnabled } from './kompozition.ts';

const [phase, file] = process.argv.slice(2);
if (!file || !['overlay', 'base'].includes(phase)) throw Error('Usage: node --experimental-strip-types painted-return-probe.mjs overlay|base <archive-path>');
if (phase === 'overlay') {
  assert.equal(paintedDiscsEnabled, true);
  let bytes = '';
  const app = createExperience(() => {}, { persist: state => { bytes = archive(state); } });
  const paint = await app.selectDraftDepiction(() => 0);
  await app.save({ ...initialDraft(), nickname: 'Parked fern' }, paint);
  fs.writeFileSync(file, bytes);
  console.log(JSON.stringify({ phase, saved: app.shelf().length, kind: app.shelf()[0].disc.depiction.kind, bytes: bytes.length }));
} else {
  assert.equal(paintedDiscsEnabled, false);
  const before = fs.readFileSync(file, 'utf8');
  const state = await restore(before, createExperience(() => {}).pxc);
  const app = createExperience(() => {}, { state });
  const row = app.shelf()[0];
  assert.equal(row.disc.depiction.kind, 'painted');
  assert.equal(app.bag()[0].address, row.address);
  assert.match(row.art, /^data:image\/svg\+xml;/);
  await assert.rejects(app.selectDraftDepiction(), /No draft photo/);
  await assert.rejects(app.save(initialDraft(), row.disc.depiction), /photo-only/);
  const previousDocument = globalThis.document;
  globalThis.document = { createElement(tag) { return { tag, children: [], append(...children) { this.children.push(...children); } }; } };
  try {
    const view = createDiscView(app)(row.disc, row.disc.depiction, row.art);
    assert.equal(view.children[1].textContent, 'Painting parked · activate painted-discs to view');
    assert.equal(view.children.some(child => child.tag === 'img'), false);
  } finally { globalThis.document = previousDocument; }
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'return-to-base does not rewrite parked archive bytes');
  console.log(JSON.stringify({ phase, retained: app.shelf().length, bag: app.bag().length, kind: row.disc.depiction.kind, artRetained: true, visiblePainting: false, archiveUnchanged: true }));
}
