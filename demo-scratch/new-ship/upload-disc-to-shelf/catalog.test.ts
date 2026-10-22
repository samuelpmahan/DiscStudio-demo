import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from './catalog.ts';
import { createExperience, initialDraft, flightFields } from './model.ts';
import { renderDiscPainting } from './paint.ts';

test('catalog has unique usable addresses, sources and no inferred human acceptance', () => {
  assert.equal(catalog.length, 724);
  assert.equal(new Set(catalog.map(x => x.id)).size, catalog.length);
  for (const seed of catalog) {
    assert.match(seed.id, /^[\w.-]+$/);
    assert.match(seed.source!, /^https:\/\//);
    assert.equal(seed.reviewStatus, 'unreviewed');
    assert.equal(seed.flight.length, 4);
    assert.ok(seed.flight.every(n => n === null || Number.isFinite(n)));
  }
  assert.equal(catalog.filter(x => x.conflicting).length, 21);
  assert.ok(catalog.some(x => x.id === 'innova--roc'));
  assert.ok(catalog.some(x => x.id === 'innova--roc-plus'));
  assert.deepEqual(catalog.find(x => x.mold === 'Sten')!.flight, [null, null, null, null]);
});
test('human correction retains imported source and original saved disc', async () => {
  const app = createExperience(() => {}), draft = initialDraft();
  await app.addDraftPhoto({ kind: 'photo', src: 'data:image/png;base64,iVBORw0KGgo=', name: 'fixture.png' });
  await app.save(draft, await app.selectDraftDepiction(() => 0));
  const original = app.seedAt(draft.mold);
  const corrected = await app.reviewSeed(draft.mold, 'corrected', { manufacturer: original.manufacturer, name: original.name, turn: 0 });
  assert.deepEqual(app.seedAt(corrected).provenance, original.provenance, 'correction retains the exact catalog-row pointer');
  assert.equal(app.seedAt(corrected).reviewStatus, 'corrected');
  assert.deepEqual(flightFields.map(field => app.shelf()[0].seed[field]), [5, 4, -1, 1]);
  assert.equal(app.pxc.get(corrected).composition.inputs.value, app.pxc.get(draft.mold));
  assert.equal(app.seedAt(corrected).turn, 0);
  await assert.rejects(app.reviewSeed(draft.mold, 'confirmed'), /newer correction/);
});
test('confirmation produces a reviewed Part without mutating catalog, unknowns stay unknown', async () => {
  const app = createExperience(() => {});
  const original = (await app.hydrateSeed('ds.px.seed.kastaplast--sten')).address;
  const address = await app.reviewSeed(original, 'confirmed');
  assert.notEqual(app.seedAt(original).reviewStatus, 'confirmed', 'the source selected Part was not rewritten in place');
  assert.equal(app.seedAt(address).reviewStatus, 'confirmed');
  assert.deepEqual(flightFields.map(field => app.seedAt(address)[field]), [null, null, null, null]);
});
test('painting colors and modes change art, opt-out preserves colors and nickname is escaped', async () => {
  const depiction = { kind: 'painted' as const, name: 'pressed-fern', src: './art/pressed-fern.svg' };
  const draft = { ...initialDraft(), nickname: '<Sam &>' };
  const render = (changes = {}) => renderDiscPainting({ draft: { ...draft, ...changes }, depiction });
  assert.equal(render(), render({ Color1: '#ff0000' }));
  assert.notEqual(render({ colorPainting: true }), render({ colorPainting: true, paintMode: 'halo' }));
  assert.notEqual(render({ colorPainting: true }), render({ colorPainting: true, Color1: '#ff0000' }));
  assert.ok(decodeURIComponent(render()).includes('&lt;Sam &amp;&gt;'));
});
