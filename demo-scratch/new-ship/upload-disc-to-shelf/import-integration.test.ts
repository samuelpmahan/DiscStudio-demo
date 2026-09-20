import test from 'node:test';
import assert from 'node:assert/strict';
import { createExperience, initialDraft } from './model.ts';
import { openExperience } from './persistent-experience.ts';

const photo = { kind: 'photo' as const, src: 'data:image/webp;base64,AAAA', name: 'fixture.webp' };
const liveRecipe = { family: 'pressed-fern', seed: 12, base: '#123456', accent: '#abcdef', target: 96 as const, label: null, mode: 'solid' as const };
const fixedRecipe = { ...liveRecipe, label: 'Fixed studio label' };
function memory() { let raw: string | null = null; return { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } }; }

test('save retains both depiction sources, switch/Keep chooses one, and restore verifies the recipe composition', async () => {
  const storage = memory(), app = await openExperience(storage, () => {});
  const draft = { ...initialDraft(), nickname: 'Private nickname', plastic: 'ESP', weight: 174 };
  const address = await app.save(draft, await app.selectDraftDepiction(() => 0), { recipe: liveRecipe, photo });
  const sources = app.depictionSources(address);
  assert.deepEqual(sources.recipe, liveRecipe);
  assert.deepEqual(sources.photo, photo);
  assert.equal(sources.choice, 'painted');
  const photoCandidate = await app.updateDepiction(address, { choice: 'photo' });
  await app.keepDisc(address, photoCandidate);
  assert.equal(app.shelf()[0].art, photo.src);
  const restored = await openExperience(storage, () => {}), current = restored.shelf()[0];
  assert.equal(current.address, photoCandidate);
  assert.deepEqual(restored.depictionSources(photoCandidate).recipe, liveRecipe);
  assert.deepEqual(restored.depictionSources(photoCandidate).photo, photo);
  const art = restored.pxc.get(current.disc.art!);
  assert.equal(art.composition.inputs.recipe, restored.pxc.get(current.disc.paintRecipe!));
  assert.equal(art.composition.inputs.seed, restored.pxc.get(current.disc.mold));
});

test('label-free recipes stay stable while fixed labels ignore corrected mold facts', async () => {
  const app = createExperience(() => {}), draft = initialDraft();
  const live = await app.save(draft, await app.selectDraftDepiction(() => 0), { recipe: liveRecipe });
  const fixed = await app.save(draft, await app.selectDraftDepiction(() => 0), { recipe: fixedRecipe });
  const beforeLive = app.shelf().find(row => row.address === live)!.art;
  const beforeFixed = app.shelf().find(row => row.address === fixed)!.art;
  const seed = app.seedAt(draft.mold);
  const corrected = await app.reviewSeed(draft.mold, 'corrected', { manufacturer: `${seed.manufacturer} Revised`, name: `${seed.name} Revised` });
  const liveCandidate = await app.updateDepiction(live, { mold: corrected });
  const fixedCandidate = await app.updateDepiction(fixed, { mold: corrected });
  await app.keepDisc(live, liveCandidate); await app.keepDisc(fixed, fixedCandidate);
  const after = new Map(app.shelf().map(row => [row.address, row.art]));
  assert.equal(after.get(liveCandidate), beforeLive, 'null label stays label-free when mold facts change');
  assert.equal(after.get(fixedCandidate), beforeFixed, 'fixed recipe label does not change with mold facts');
});

test('Bag retains selected creation versions but follows the same physical disc after Keep and restore', async () => {
  const storage = memory(), app = await openExperience(storage, () => {}), painting = await app.selectDraftDepiction(() => 0);
  const first = await app.save({ ...initialDraft(), plastic: 'ESP', weight: 175 }, painting);
  const second = await app.save({ ...initialDraft(), plastic: 'Z', weight: 172 }, painting);
  const bagAddress = await app.createBag('Round one', [second, first]);
  const created = app.bags()[0];
  assert.equal(created.address, bagAddress);
  assert.deepEqual(created.bag.discIds, [app.pxc.get(second).value.id, app.pxc.get(first).value.id]);
  assert.deepEqual(created.bag.versions.map((value: any) => value.address), [second, first]);
  const candidate = await app.updateDisc(first, { turn: 0 }); await app.keepDisc(first, candidate);
  const live = app.bags()[0];
  assert.equal(live.discs[1].address, candidate);
  assert.equal(live.bag.versions[1].address, first, 'creation evidence is not silently rewritten');
  const restored = await openExperience(storage, () => {}), restoredBag = restored.bags()[0];
  assert.equal(restoredBag.discs[1].address, candidate);
  assert.equal(restoredBag.bag.versions[1].address, first);
});

test('invalid, duplicate, stale, and failed Bag writes leave collection pointers and stored bytes unchanged', async () => {
  const storage = memory(), first = await openExperience(storage, () => {}), disc = await first.save(initialDraft(), photo);
  const beforePointer = first.bagsAddress, beforeBytes = storage.getItem();
  for (const selection of [[], [disc, disc], ['missing']]) await assert.rejects(first.createBag('Round', selection), /Select at least one|selected more than once|stale or absent/);
  assert.equal(first.bagsAddress, beforePointer); assert.equal(storage.getItem(), beforeBytes);
  const edited = await first.updateDisc(disc, { turn: 0 }); await first.keepDisc(disc, edited);
  const afterKeepBytes = storage.getItem();
  await assert.rejects(first.createBag('Round', [disc]), /stale or absent/);
  assert.equal(first.bagsAddress, beforePointer); assert.equal(storage.getItem(), afterKeepBytes, 'stale selection never writes');

  const failing = await openExperience({ getItem: storage.getItem, setItem() { throw Error('quota fixture'); } }, () => {});
  const failedPointer = failing.bagsAddress, bytes = storage.getItem();
  await assert.rejects(failing.createBag('Round', [edited]), /Not saved locally/);
  assert.equal(failing.bagsAddress, failedPointer); assert.equal(storage.getItem(), bytes);
});

test('queryShelf binds real retained rows, excludes nickname, and applies inclusive filters with accepted copy order', async () => {
  const app = createExperience(() => {}), painting = await app.selectDraftDepiction(() => 0);
  const z172 = await app.save({ ...initialDraft(), nickname: 'Secret retrieval token', plastic: 'Z', weight: 172 }, painting);
  const z175 = await app.save({ ...initialDraft(), plastic: 'Z', weight: 175 }, painting);
  const esp = await app.save({ ...initialDraft(), plastic: 'ESP', weight: 174 }, painting);
  const none = await app.queryShelf({ query: 'secret' });
  assert.equal(none.shown, 0);
  const view = await app.queryShelf({ manufacturers: ['Discraft'], plastics: ['Z'], speedRange: [5, 5], weightRange: [172, 175] });
  assert.deepEqual(view.rows.map((row: any) => row.address), [z175, z172]);
  assert.equal(view.groups[0].rows[0].address, z175);
  const queryPart = app.pxc.get(view.address), rowsPart = queryPart.composition.inputs.rows;
  assert.equal(rowsPart.composition.calculation, app.pxc.get('fn.shelfRows'));
  assert.equal(rowsPart.composition.inputs.disc0, app.pxc.get(z172));
  assert.equal(rowsPart.composition.inputs.disc2, app.pxc.get(esp));
});

test('archive rejects a tampered retained paint recipe rather than trusting it on restore', async () => {
  const storage = memory(), app = await openExperience(storage, () => {});
  await app.save(initialDraft(), await app.selectDraftDepiction(() => 0), { recipe: liveRecipe, photo });
  const saved = JSON.parse(storage.getItem()!);
  const recipe = saved.nodes.find((node: any) => node.material?.object?.some(([key]: [string]) => key === 'family')
    && node.material.object.some(([key]: [string]) => key === 'accent')
    && node.calculation !== undefined);
  assert.ok(recipe, 'fixture archive contains the calculated retained recipe');
  const label = recipe.material.object.find(([key]: [string]) => key === 'label');
  label[1] = { scalar: 'tampered recipe label' };
  const bytes = JSON.stringify(saved); storage.setItem('', bytes);
  const restored = await openExperience(storage, () => {});
  assert.match(restored.persistenceStatus, /Recovery required/);
  assert.equal(storage.getItem(), bytes);
});
