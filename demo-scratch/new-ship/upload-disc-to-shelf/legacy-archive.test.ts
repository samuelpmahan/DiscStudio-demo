import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Part } from '../part-first-kernel/src/pxc.mjs';
import { createExperience, initialDraft } from './model.ts';
import { catalogLite } from './catalog-lite.ts';
import { archive } from './persistence.ts';
import { openExperience } from './persistent-experience.ts';
import { activeSessionKey, sessionKeyPrefix } from './session-storage.ts';

function memory(raw: string) {
  const sessionKey = `${sessionKeyPrefix}legacy-fixture-session-001`;
  const values = new Map([[activeSessionKey, sessionKey], [sessionKey, raw]]);
  return { sessionKey, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
function seedLegacyCatalog(pxc: ReturnType<typeof createExperience>['pxc']) {
  for (const { mold, ...seed } of catalogLite) {
    const address = `ds.px.seed.${seed.id}`;
    try { pxc.get(address); }
    catch { pxc.set(address, new Part(Object.freeze({ ...seed, name: mold }))); }
  }
  return catalogLite.map(seed => [seed.id, `ds.px.seed.${seed.id}`]);
}

test('restores an actual legacy fn.renderPainting graph and can extend it with new depiction Parts', async () => {
  const legacy = createExperience(() => {}), pxc = legacy.pxc;
  const currentSeeds = seedLegacyCatalog(pxc);
  const draft = Object.freeze({ ...initialDraft(), nickname: 'Legacy bytes', colorPainting: true, paintMode: 'split' as const });
  const depiction = Object.freeze({ kind: 'painted' as const, name: 'pressed-fern', src: './art/pressed-fern.svg' });
  pxc.set('ds.px.legacy.draft', new Part(draft));
  pxc.set('ds.px.legacy.depiction', new Part(depiction));
  await pxc.compose({ into: 'ds.px.disc.legacy', calculation: 'oc.create', inputs: {
    value: 'ds.px.legacy.draft', id: new Part('legacy'), depiction: 'ds.px.legacy.depiction',
  } });
  await pxc.compose({ into: 'ds.px.art.legacy', calculation: 'fn.renderPainting', inputs: {
    draft: 'ds.px.disc.legacy', depiction: 'ds.px.legacy.depiction',
  } });
  await pxc.compose({ into: 'ds.px.shelf.legacy', calculation: 'fn.addToShelf', inputs: {
    shelf: 'ds.px.shelf.0', reference: new Part('ds.px.disc.legacy'), disc: 'ds.px.disc.legacy',
  } });
  pxc.set('ds.px.bag.legacy', new Part(Object.freeze(['ds.px.disc.legacy'])));
  const oldArt = pxc.get('ds.px.art.legacy').value;
  const raw = archive({ pxc, serial: 7, shelfAddress: 'ds.px.shelf.legacy', bagAddress: 'ds.px.bag.legacy', currentSeeds });

  const restored = await openExperience(memory(raw), () => {});
  const oldDisc = restored.pxc.get('ds.px.disc.legacy');
  assert.equal(restored.shelf()[0].art, oldArt);
  assert.equal(oldDisc.value.paintRecipe, undefined);
  assert.equal(oldDisc.composition.calculation, restored.pxc.get('oc.create'));
  assert.equal(restored.pxc.get('ds.px.art.legacy').composition.calculation, restored.pxc.get('fn.renderPainting'));
  assert.equal(restored.pxc.get('ds.px.art.legacy').composition.inputs.draft, oldDisc);
  assert.deepEqual(restored.pxc.get('ds.px.shelf.legacy').value, ['ds.px.disc.legacy']);

  const nextPhoto = { kind: 'photo' as const, src: 'data:image/png;base64,iVBORw0KGgo=', name: 'next-photo.png' };
  await restored.addDraftPhoto(nextPhoto);
  const selectedPhoto = await restored.selectDraftDepiction();
  const candidate = await restored.updateDepiction('ds.px.disc.legacy', { choice: 'photo', photo: selectedPhoto });
  await restored.keepDisc('ds.px.disc.legacy', candidate);
  const current = restored.shelf()[0];
  assert.equal(current.address, candidate);
  assert.equal(typeof current.disc.paintRecipe, 'string');
  assert.equal(current.disc.depiction.kind, 'photo');
  assert.equal(restored.pxc.get(candidate).composition.inputs.value, oldDisc);
  assert.equal(restored.pxc.get(current.disc.art!).composition.calculation, restored.pxc.get('fn.renderDepiction'));
  assert.equal(restored.pxc.get('ds.px.art.legacy').value, oldArt, 'the legacy output stays retained after extension');
});

test('rejects replay-consistent archives whose disc metadata forges depiction graph links', async () => {
  for (const forged of ['art', 'paintRecipe'] as const) {
    const app = createExperience(() => {}), pxc = app.pxc;
    await app.addDraftPhoto({ kind: 'photo', src: 'data:image/png;base64,iVBORw0KGgo=', name: 'fixture.png' });
    const original = await app.save(initialDraft(), await app.selectDraftDepiction());
    const disc = pxc.get(original).value;
    const unrelated = forged === 'art' ? 'ds.px.forged.art' : 'ds.px.forged.recipe';
    pxc.set(unrelated, new Part(forged === 'art' ? 'data:image/svg+xml,unrelated' : Object.freeze({ family: 'not-a-painter' })));
    const candidate = `ds.px.disc.forged-${forged}`;
    await pxc.compose({ into: candidate, calculation: 'oc.update', inputs: {
      value: original, patch: new Part(Object.freeze({ [forged]: unrelated })),
    } });
    const fakeShelf = `ds.px.shelf.forged-${forged}`;
    await pxc.compose({ into: fakeShelf, calculation: 'oc.update', inputs: {
      value: app.shelfAddress, patch: new Part(Object.freeze({ 0: candidate })),
    } });
    const raw = archive({
      pxc, serial: 99, shelfAddress: fakeShelf, bagsAddress: app.bagsAddress,
      currentSeeds: seedLegacyCatalog(pxc),
    });
    const storage = memory(raw), restored = await openExperience(storage, () => {});
    assert.match(restored.persistenceStatus, forged === 'art' ? /Art does not retain/ : /Unknown painter family/);
    assert.equal(storage.getItem(storage.sessionKey), raw, 'rejected archive bytes remain untouched');
    assert.equal(disc[forged] === unrelated, false, 'the legitimate disc was not mutated to construct the forgery');
  }
});
