import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExperience, initialDraft, flightFields } from './model.ts';
import { creatorPqlPlans } from './pql.ts';

const testPhoto = { kind: 'photo' as const, src: 'data:image/png;base64,iVBORw0KGgo=', name: 'test-photo.png' };

async function appWithPhoto() {
  const app = createExperience(() => {});
  await app.addDraftPhoto(testPhoto);
  const depiction = await app.selectDraftDepiction();
  return { app, depiction };
}

test('save composes a disc and a shelf, retaining inputs and readback evidence', async () => {
  const { app, depiction } = await appWithPhoto();
  const draft = { ...initialDraft(), nickname: 'Minty', plastic: 'ESP', weight: 177 };
  const address = await app.save(draft, depiction);
  const part = app.pxc.get(address);
  const operationId = (app.events.at(-1) as any).operationId;
  assert.equal(part.composition.calculation, app.pxc.get('fn.CREATE'));
  assert.equal(app.pxc.get(`ds.px.resolved.${operationId}`).composition.inputs.base, app.pxc.get(draft.mold));
  assert.equal(app.shelf()[0].disc.nickname, 'Minty');
  assert.equal(app.shelf()[0].disc.depiction.src, depiction.src);
  // Lite-first: full flights are explicitly hydrated before UI selection/save.
  const hydrated = await app.hydrateSeed(draft.mold);
  assert.deepEqual(flightFields.map(field => hydrated.seed[field]), [5, 4, -1, 1]);
  assert.equal(app.pxc.get(app.shelfAddress).composition.inputs.disc, part);
  const specialize = app.pxc.get(`ds.px.tick.${operationId}.specialize`);
  assert.equal(specialize.composition.inputs[address], part, 'specialize Tick acknowledges the actual PQL CREATE output');
  const declared = app.pxc.get(`ds.px.stage.${operationId}`).value[0];
  assert.equal(declared.calculations[0].inputs.id, part.composition.inputs.id, 'Stage retains the actual PQL CREATE binding Part');
  assert.equal(app.pxc.get(declared.calculations[0].inputs.value).value, part.composition.inputs.value.value, 'address binding resolves to the actual CREATE input Part');
  const resolved = app.pxc.get(`ds.px.resolved.${operationId}`);
  assert.equal(declared.calculations[1].calculation, 'fn.READ');
  assert.equal(app.pxc.get(declared.calculations[1].inputs.base), resolved.composition.inputs.base);
  assert.equal(app.pxc.get(declared.calculations[1].inputs.own), resolved.composition.inputs.own);
  assert.equal(specialize.composition.inputs[`ds.px.resolved.${operationId}`], resolved, 'specialize Tick acknowledges the resolved Disc output');
  assert.equal(app.pxc.get(part.value.paintRecipe).value, null); // photo-only save does not stage a duplicate recipe write
  assert.equal(app.events.at(-1)?.event, 'disc.save.completed');
  assert.equal(app.events.at(-1)?.shelfContainsDisc, true);
  assert.deepEqual(app.events.at(-1)?.pql.map((entry: any) => entry.calculation), ['fn.CREATE', 'fn.READ', 'fn.READ']);
  const executedPql = app.pxc.get(`ds.px.receipt.pql.${operationId}`).value as any[];
  assert.deepEqual(executedPql.map(entry => entry.query), [
    'INSERT INTO :target VALUES :value', 'SELECT * FROM :source', 'SELECT * FROM :source',
  ]);
  assert.deepEqual(executedPql.map(entry => entry.boundAddresses), [
    { target: address, into: address },
    { source: address, into: `ds.px.pql.${operationId}.disc` },
    { source: app.shelfAddress, into: `ds.px.pql.${operationId}.shelf` },
  ]);
  draft.nickname = 'Later edit';
  assert.equal(app.shelf()[0].disc.nickname, 'Minty');
});

test('two saves execute the same frozen plans while binding distinct Disc and Shelf addresses', async () => {
  const { app, depiction } = await appWithPhoto();
  const first = await app.save({ ...initialDraft(), nickname: 'First' }, depiction);
  const firstOperationId = (app.events.at(-1) as any).operationId;
  await app.addDraftPhoto({ ...testPhoto, name: 'second.png' });
  const second = await app.save({ ...initialDraft(), nickname: 'Second' }, await app.selectDraftDepiction());
  const secondOperationId = (app.events.at(-1) as any).operationId;
  const firstPlans = app.pxc.get(`ds.px.receipt.pql.${firstOperationId}`).value as any[];
  const secondPlans = app.pxc.get(`ds.px.receipt.pql.${secondOperationId}`).value as any[];
  assert.equal(firstPlans[0].plan, creatorPqlPlans.createDisc);
  assert.equal(secondPlans[0].plan, creatorPqlPlans.createDisc);
  assert.equal(firstPlans[1].plan, creatorPqlPlans.readDisc);
  assert.equal(secondPlans[1].plan, creatorPqlPlans.readDisc);
  assert.equal(firstPlans[2].plan, creatorPqlPlans.readShelf);
  assert.equal(secondPlans[2].plan, creatorPqlPlans.readShelf);
  assert.notEqual(firstPlans[0].boundAddresses.target, secondPlans[0].boundAddresses.target);
  assert.equal(firstPlans[0].boundAddresses.target, first);
  assert.equal(secondPlans[0].boundAddresses.target, second);
  assert.notEqual(firstPlans[2].boundAddresses.source, secondPlans[2].boundAddresses.source);
});

test('two specimens share a seed without replacing each other or prior shelf', async () => {
  const { app, depiction: image } = await appWithPhoto();
  const a = await app.save(initialDraft(), image), previous = app.shelfAddress;
  // Second save needs a fresh photo (first was consumed).
  await app.addDraftPhoto({ ...testPhoto, name: 'test-photo-2.png' });
  const image2 = await app.selectDraftDepiction();
  const b = await app.save({ ...initialDraft(), Color1: '#ff0000' }, image2);
  assert.notEqual(a, b); assert.equal(app.shelf().length, 2);
  assert.deepEqual(app.pxc.get(previous).value, [a]);
  assert.equal(app.shelf()[0].disc.Color1, '#98d4ba');
});
test('invalid inputs do not publish a shelf or a success receipt', async () => {
  const { app, depiction: image } = await appWithPhoto();
  for (const bad of [{ weight: NaN }, { mold: 'missing' }, { Color1: '<script>' }]) {
    await assert.rejects(app.save({ ...initialDraft(), ...bad }, image));
  }
  assert.equal(app.shelf().length, 0);
  assert.equal(app.events.filter(e => e.event === 'disc.save.completed').length, 0);
  assert.equal(app.events.length, 3);
});
test('photo depiction stays with the disc and logs never contain image bytes', async () => {
  const app = createExperience(() => {});
  await app.save(initialDraft(), { kind: 'photo', src: 'data:image/webp;base64,AAAA', name: 'local.webp' });
  assert.equal(app.shelf()[0].disc.depiction.kind, 'photo');
  assert.equal(JSON.stringify(app.events).includes('base64'), false);
});
test('selection is explicit and retained, not randomized by reads', async () => {
  const { app, depiction } = await appWithPhoto();
  await app.save(initialDraft(), depiction);
  app.shelf(); app.shelf();
  assert.equal(depiction.kind, 'photo');
  assert.equal(depiction.name, 'test-photo.png');
});
test('overlapping saves are refused and cannot lose shelf membership', async () => {
  const { app, depiction } = await appWithPhoto();
  const first = app.save(initialDraft(), depiction);
  await assert.rejects(app.save(initialDraft(), depiction), /in progress/);
  await first; assert.equal(app.shelf().length, 1);
});
test('draft photo is retained at ds.px.draft.photos.N and wins selection', async () => {
  const app = createExperience(() => {});
  const photoAddress = await app.addDraftPhoto(testPhoto);
  assert.match(photoAddress, /^ds\.px\.draft\.photos\.\d+$/);
  assert.equal(app.pxc.get(photoAddress).value.kind, 'photo');
  const picked = await app.selectDraftDepiction();
  assert.equal(picked.kind, 'photo');
  assert.equal(picked.name, 'test-photo.png');
});
test('selectDraftDepiction requires a photo; no painting fallback', async () => {
  const app = createExperience(() => {});
  await assert.rejects(app.selectDraftDepiction(), /No draft photo/);
});
test('save consumes draft photos; next draft starts clean', async () => {
  const { app, depiction } = await appWithPhoto();
  await app.save(initialDraft(), depiction);
  // Photo was consumed; selecting again should fail.
  await assert.rejects(app.selectDraftDepiction(), /No draft photo/);
});

// MVP: the bag is the primary collection. Save populates bag and shelf.
test('save adds the disc to the bag (MVP path)', async () => {
  const { app, depiction } = await appWithPhoto();
  const draft = { ...initialDraft(), nickname: 'Baggy', plastic: 'ESP', weight: 175 };
  const address = await app.save(draft, depiction);
  const bag = app.bag();
  assert.equal(bag.length, 1);
  assert.equal(bag[0].address, address);
  assert.equal(bag[0].disc.nickname, 'Baggy');
  assert.equal(bag[0].disc.depiction.src, depiction.src);
});
test('bag and shelf both retain the saved disc', async () => {
  const { app, depiction } = await appWithPhoto();
  const address = await app.save({ ...initialDraft(), nickname: 'Both' }, depiction);
  assert.equal(app.bag()[0].address, address);
  assert.equal(app.shelf()[0].address, address);
  assert.equal(app.bag()[0].disc.nickname, 'Both');
});
test('bagAddress is a real PxC address with fn.addToBag composition', async () => {
  const { app, depiction } = await appWithPhoto();
  await app.save(initialDraft(), depiction);
  const part = app.pxc.get(app.bagAddress);
  assert.equal(part.composition.calculation, app.pxc.get('fn.addToBag'));
});
test('two saves accumulate two discs in the bag', async () => {
  const { app, depiction: image } = await appWithPhoto();
  const a = await app.save({ ...initialDraft(), nickname: 'One' }, image);
  await app.addDraftPhoto({ ...testPhoto, name: 'test-photo-2.png' });
  const image2 = await app.selectDraftDepiction();
  const b = await app.save({ ...initialDraft(), nickname: 'Two' }, image2);
  const bag = app.bag();
  assert.equal(bag.length, 2);
  assert.deepEqual(bag.map(row => row.address), [a, b]);
  assert.deepEqual(bag.map(row => row.disc.nickname), ['One', 'Two']);
});
test('save receipt records the bag address and bag membership', async () => {
  const { app, depiction } = await appWithPhoto();
  await app.save(initialDraft(), depiction);
  const receipt = app.events.at(-1);
  assert.equal(receipt?.event, 'disc.save.completed');
  assert.equal(receipt?.bagAddress, app.bagAddress);
  assert.equal(receipt?.bagContainsDisc, true);
});
test('bag query filters by mold name like shelf does', async () => {
  const { app, depiction: image } = await appWithPhoto();
  await app.save({ ...initialDraft(), nickname: 'First' }, image);
  await app.addDraftPhoto({ ...testPhoto, name: 'test-photo-2.png' });
  const image2 = await app.selectDraftDepiction();
  await app.save({ ...initialDraft(), nickname: 'Second' }, image2);
  assert.equal(app.bag('buzzz').length, 2);
  assert.equal(app.bag('nomatchxyz').length, 0);
});


test('Disc Parts use mold identity ordinals while save executions retain their own trace IDs', async () => {
  const app = createExperience(() => {});
  const crave = app.seedOptions('Crave').find(option => option.seed.id === 'axiom--crave');
  assert.ok(crave, 'canonical Axiom Crave seed exists');
  for (const nickname of ['one', 'two']) {
    await app.addDraftPhoto({ ...testPhoto, name: nickname + '.png' });
    await app.save({ ...initialDraft(), mold: crave.address, nickname }, await app.selectDraftDepiction());
  }
  await app.addDraftPhoto({ ...testPhoto, name: 'buzzz.png' });
  const buzzz = await app.save(initialDraft(), await app.selectDraftDepiction());
  assert.deepEqual(app.bag().map(row => [row.address, row.disc.id]), [
    ['ds.px.disc.crave-1', 'crave-1'],
    ['ds.px.disc.crave-2', 'crave-2'],
    ['ds.px.disc.buzzz-1', 'buzzz-1'],
  ]);
  assert.equal(buzzz, 'ds.px.disc.buzzz-1');
  const saves = app.events.filter(event => event.event === 'disc.save.completed') as any[];
  assert.ok(saves.every(receipt => /^save-[0-9]+$/.test(receipt.operationId)));
  assert.ok(saves.every(receipt => receipt.discAddress.endsWith(receipt.discId)));
});
