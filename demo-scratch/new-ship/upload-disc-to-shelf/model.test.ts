import { prepareExport } from './export-queue-core.ts';
import { encodeTransparentPng } from './export-queue.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExperience, initialDraft, flightFields } from './model.ts';
import { Part } from '../part-first-kernel/src/pxc.mjs';
import { moldRuntimeManifest } from './mold-runtime-manifest.ts';

const testPhoto = { kind: 'photo' as const, src: 'data:image/png;base64,iVBORw0KGgo=', name: 'test-photo.png' };

test('UploadDiscToShelf composes catalog suggestions and materializes only a selected Part', async () => {
  const app = createExperience(() => {});
  const seedParts = () => app.pxc.entries().filter(([name]: [string, unknown]) => name.startsWith('ds.px.seed.'));
  assert.equal(app.catalogAvailable, true);
  assert.deepEqual(seedParts(), [], 'fresh PxC does not preload the 724 source rows');

  const suggestions = app.seedOptions('Buz');
  assert.ok(suggestions.some(row => row.seed.id === 'buzzz'), 'the composed search resolves a real catalog mold');
  assert.deepEqual(seedParts(), [], 'querying suggestions does not write catalog rows into PxC');

  const selected = await app.hydrateSeed(suggestions.find(row => row.seed.id === 'buzzz')!.address);
  assert.equal(selected.address, 'ds.px.seed.buzzz', 'a fresh selection keeps the stable source address');
  assert.deepEqual(flightFields.map(field => selected.seed[field]), [5, 4, -1, 1]);
  assert.deepEqual(selected.seed.provenance, {
    stableId: 'buzzz', catalogVersion: moldRuntimeManifest.catalogVersion,
    catalogSourceSha256: '40c30c8599e9d7b396de23bb07a722ae20812e03ea0b18a9cf2d228feecdfa6c',
    sourceRowIdentity: 'buzzz',
  });
  assert.deepEqual(seedParts().map(([name]: [string, unknown]) => name), [selected.address], 'only the selected catalog row is materialized');
});

async function appWithPhoto() {
  const app = createExperience(() => {});
  await app.addDraftPhoto(testPhoto);
  const depiction = await app.selectDraftDepiction();
  return { app, depiction };
}

test('save composes a disc and a shelf, retaining inputs and readback evidence', async () => {
  const { app, depiction } = await appWithPhoto();
  const selectedSeed = await app.hydrateSeed(initialDraft().mold);
  const draft = { ...initialDraft(), mold: selectedSeed.address, nickname: 'Minty', plastic: 'ESP', weight: 177, turn: 0, glide: null };
  const address = await app.save(draft, depiction);
  const part = app.pxc.get(address);
  assert.equal(part.composition.calculation, app.pxc.get('oc.create'));
  const resolvedAddress = `ds.px.resolved.${part.value.id}`, resolved = app.pxc.get(resolvedAddress);
  const selection = app.pxc.get(`ds.px.receipt.select.${part.value.id}`).value;
  assert.equal(resolved.composition.calculation, app.pxc.get('fn.disc.resolveFacts.complete'));
  assert.equal(resolved.composition.inputs.seed, app.pxc.get(draft.mold));
  assert.equal(resolved.composition.inputs.draft, app.pxc.get(`ds.px.draft.${part.value.id}`));
  assert.equal(resolved.value.speed, 5, 'absent override inherits the full seed value');
  assert.equal(resolved.value.turn, 0, 'zero is a real override');
  assert.equal(resolved.value.glide, null, 'explicit null overrides a known seed value');
  assert.equal(resolved.value.flightFactSources.speed, 'seed');
  assert.equal(resolved.value.flightFactSources.glide, 'draft-override');
  assert.equal(selection.clause, 'complete-seed-flight-facts');
  assert.equal(selection.calculationAddress, 'fn.disc.resolveFacts.complete');
  assert.deepEqual(selection.inputPartAddresses, { seed: draft.mold, draft: `ds.px.draft.${part.value.id}` });
  assert.equal(selection.outputAddress, resolvedAddress);
  assert.equal(selection.calculationInvoked, true);
  assert.equal(app.pxc.get(`ds.px.binding.${part.value.id}.resolvedFacts`), resolved.composition.calculation);
  assert.equal(app.shelf()[0].disc.nickname, 'Minty');
  assert.equal(app.shelf()[0].disc.depiction.src, depiction.src);
  assert.deepEqual(flightFields.map(field => selectedSeed.seed[field]), [5, 4, -1, 1]);
  assert.equal(app.pxc.get(app.shelfAddress).composition.inputs.disc, part);
  assert.equal(app.pxc.get(part.value.paintRecipe).value, null); // photo-only save does not stage a duplicate recipe write
  assert.equal(app.events.at(-1)?.event, 'disc.save.completed');
  assert.equal(app.events.at(-1)?.shelfContainsDisc, true);
  assert.equal(app.events.at(-1)?.expectedShelfHead, 'ds.px.shelf.0');
  assert.equal(app.events.at(-1)?.expectedBagHead, 'ds.px.bag.0');
  assert.equal(app.events.at(-1)?.storage, 'session-memory');
  draft.nickname = 'Later edit';
  assert.equal(app.shelf()[0].disc.nickname, 'Minty');
});
test('UploadDiscToShelf does not publish either collection head when the commit write fails', async () => {
  const app = createExperience(() => {}, { persist() { throw Error('fixture commit failure'); } });
  await app.addDraftPhoto(testPhoto);
  const depiction = await app.selectDraftDepiction();
  await assert.rejects(app.save(initialDraft(), depiction), /fixture commit failure/);
  assert.deepEqual(app.pxc.get(app.shelfAddress).value, []);
  assert.deepEqual(app.pxc.get(app.bagAddress).value, []);
  assert.equal(app.events.some(event => event.event === 'disc.save.completed'), false);
  assert.equal((await app.selectDraftDepiction()).src, depiction.src, 'draft stays retryable');
});

test('SELECT binds and executes the sparse resolver, normalizing missing facts while preserving overrides', async () => {
  const { app, depiction } = await appWithPhoto();
  const mold = 'ds.px.seed.test-sparse';
  app.pxc.set(mold, new Part(Object.freeze({ id: 'test-sparse', manufacturer: 'Fixture', name: 'Sparse Mold' })));
  const draft = { ...initialDraft(), mold, turn: 0, fade: null };
  const address = await app.save(draft, depiction), id = app.pxc.get(address).value.id;
  const resolved = app.pxc.get(`ds.px.resolved.${id}`), receipt = app.pxc.get(`ds.px.receipt.select.${id}`).value;
  assert.equal(resolved.composition.calculation, app.pxc.get('fn.disc.resolveFacts.sparse'));
  assert.deepEqual(flightFields.map(field => resolved.value[field]), [null, null, 0, null]);
  assert.deepEqual(resolved.value.factResolution.missingSeedFlights, [...flightFields]);
  assert.equal(resolved.value.flightFactSources.speed, 'missing-seed');
  assert.equal(resolved.value.flightFactSources.turn, 'draft-override');
  assert.equal(resolved.value.flightFactSources.fade, 'draft-override');
  assert.equal(receipt.clause, 'sparse-seed-flight-facts');
  assert.equal(receipt.calculationAddress, 'fn.disc.resolveFacts.sparse');
  assert.equal(resolved.composition.inputs.seed, app.pxc.get(draft.mold));
  assert.equal(resolved.composition.inputs.draft, app.pxc.get(`ds.px.draft.${id}`));
  assert.equal(app.events.find(event => event.event === 'pxc.select.completed')?.outputAddress, `ds.px.resolved.${id}`);
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
test('a SELECT with no structural match fails before shelf publication or success testimony', async () => {
  const { app, depiction } = await appWithPhoto();
  const invalidSeeds = [
    ['invalid-shape', { id: 'invalid-shape', manufacturer: 'Fixture', name: 'Invalid', speed: 'fast' }],
    ['empty-manufacturer', { id: 'empty-manufacturer', manufacturer: '  ', name: 'No Manufacturer', speed: 5, glide: 4, turn: -1, fade: 1 }],
  ] as const;
  for (const [id, facts] of invalidSeeds) {
    const mold = `ds.px.seed.${id}`;
    app.pxc.set(mold, new Part(facts));
    await assert.rejects(app.save({ ...initialDraft(), mold }, depiction), /SELECT disc\.facts\.resolve found no matching clause/);
  }
  assert.deepEqual(app.pxc.get(app.shelfAddress).value, []);
  assert.deepEqual(app.pxc.get(app.bagAddress).value, []);
  assert.equal(app.pxc.entries().some(([name]) => name.startsWith('ds.px.disc.save-')), false);
  assert.equal(app.pxc.entries().some(([name]) => name.startsWith('ds.px.resolved.save-')), false);
  assert.equal(app.pxc.entries().some(([name]) => name.startsWith('ds.px.receipt.select.')), false);
  assert.equal(app.events.some(event => event.event === 'disc.save.completed' || event.event === 'pxc.select.completed'), false);
  assert.equal(app.events.at(-1)?.event, 'disc.save.failed');
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

test('approved output holds an immutable queue snapshot and receipts its identity', async () => {
  const { app, depiction } = await appWithPhoto();
  const address = await app.save(initialDraft(), depiction);
  const row = app.bag().find(item => item.address === address)!;
  const queued = [{ disc: { ...row.disc, depiction: { ...row.disc.depiction }, renderer: { moldName: row.seed.name, flights: [5, 4, -1, 1] } } as any, orientation: 'vertical' as const, cardDesign: 'u02' }];
  await app.enqueueOutput(queued);
  queued[0].disc.nickname = 'mutated after approval';
  const approval = app.latestOutputApproval!;
  assert.equal(approval.event, 'output.queue.approved');
  assert.match(approval.approvalSnapshotId as string, /^sha256:[a-f0-9]{64}$/);
  assert.match(approval.outputQueueSnapshotId as string, /^sha256:[a-f0-9]{64}$/);
  assert.equal(app.outputQueue()[0].disc.nickname, row.disc.nickname);
  const exportReceipt = await app.recordOutputExport({ manifest: { cardCount: 1 }, manifestId: 'sha256:manifest', zipId: 'sha256:zip', expectedOutputQueueSnapshotId: approval.outputQueueSnapshotId as string, downloadRequested: true });
  assert.equal(exportReceipt.approvalSnapshotId, approval.approvalSnapshotId);
  assert.equal(exportReceipt.event, 'output.zip.prepared');
  assert.equal(exportReceipt.downloadRequested, true);
  assert.equal(exportReceipt.manifestId, 'sha256:manifest');
});

test('removing a card invalidates approval until the actual remaining queue is reapproved', async () => {
  const { app, depiction } = await appWithPhoto();
  const first = await app.save({ ...initialDraft(), nickname: 'First' }, depiction);
  await app.addDraftPhoto({ ...testPhoto, name: 'second.png' });
  const second = await app.save({ ...initialDraft(), nickname: 'Second' }, await app.selectDraftDepiction());
  for (const address of [first, second]) {
    const row = app.bag().find(item => item.address === address)!;
    await app.enqueueOutput([{ disc: { ...row.disc, depiction: { ...row.disc.depiction } }, orientation: 'vertical', cardDesign: 'u02' }]);
  }
  assert.equal(app.latestOutputApproval?.count, 2, 'the second approval covers the accumulated queue');
  await app.removeOutput(1);
  assert.equal(app.latestOutputApproval, null);
  await assert.rejects(app.recordOutputExport({ manifest: {}, manifestId: 'sha256:manifest', zipId: 'sha256:zip', expectedOutputQueueSnapshotId: 'sha256:old' }), /Approve the current output queue/);
  await app.approveOutputQueue();
  const receipt = await app.recordOutputExport({ manifest: { cardCount: 1 }, manifestId: 'sha256:manifest', zipId: 'sha256:zip', expectedOutputQueueSnapshotId: app.latestOutputApproval!.outputQueueSnapshotId as string, downloadRequested: true });
  assert.equal(receipt.outputQueueSnapshotId, app.latestOutputApproval?.outputQueueSnapshotId);
});

test('a prepared ZIP cannot borrow a later queue approval', async () => {
  const { app, depiction } = await appWithPhoto();
  const first = await app.save({ ...initialDraft(), nickname: 'First' }, depiction);
  const card = (address: string) => ({ disc: { ...app.bag().find(row => row.address === address)!.disc }, orientation: 'vertical' as const, cardDesign: 'u02' });
  await app.enqueueOutput([card(first)]);
  const preparedFor = app.latestOutputApproval!.outputQueueSnapshotId as string;
  await app.addDraftPhoto({ ...testPhoto, name: 'second.png' });
  const second = await app.save({ ...initialDraft(), nickname: 'Second' }, await app.selectDraftDepiction());
  await app.enqueueOutput([card(second)]);
  assert.notEqual(preparedFor, app.latestOutputApproval!.outputQueueSnapshotId);
  await assert.rejects(app.recordOutputExport({ manifest: { cards: [{ discId: 'First' }] }, manifestId: 'sha256:old-manifest', zipId: 'sha256:old-zip', expectedOutputQueueSnapshotId: preparedFor }), /does not match the current approval snapshot/);
  assert.equal(app.latestOutputExport, null);
});

test('saved seed provenance retains its historical catalog version across fresh current lookups', async () => {
  const { app, depiction } = await appWithPhoto();
  const selected = await app.hydrateSeed(initialDraft().mold);
  const held = Object.freeze({ ...selected.seed, id: 'fixture-held-version', provenance: Object.freeze({ ...selected.seed.provenance!, catalogVersion: '0.0.0' }) });
  const address = 'ds.px.seed.fixture-held-version';
  app.pxc.set(address, new Part(held));
  await app.save({ ...initialDraft(), mold: address }, depiction);
  const saved = structuredClone(app.shelf()[0].seed.provenance);
  app.seedOptions('Buz');
  await app.hydrateSeed(initialDraft().mold);
  assert.equal(saved!.catalogVersion, '0.0.0');
  assert.deepEqual(app.shelf()[0].seed.provenance, saved);
  assert.equal(Object.isFrozen(app.shelf()[0].seed.provenance), true);
});

test('two identical Add actions retain distinct approval instances and one captured content identity', async () => {
  const { app, depiction } = await appWithPhoto();
  const address = await app.save(initialDraft(), depiction);
  const row = app.bag().find(item => item.address === address)!;
  const card = { disc: { ...row.disc, depiction: { ...row.disc.depiction } }, orientation: 'vertical' as const, cardDesign: 'u04' };
  await app.enqueueOutput([card]);
  const firstCollection = app.latestOutputApproval!.outputQueueSnapshotId as string;
  await app.enqueueOutput([card]);
  const [a,b] = app.outputQueue();
  assert.notEqual(a.approvalId, b.approvalId, 'each Add is a new instance');
  assert.equal(a.approvalContentId, b.approvalContentId, 'identical captured card state has the same content digest');
  assert.match(a.approvalContentId!, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(firstCollection, app.latestOutputApproval!.outputQueueSnapshotId, 'collection identity changes on append');
  (card.disc as any).nickname = 'later editor value';
  assert.notEqual(a.disc.nickname, 'later editor value');
  const { manifest } = await prepareExport(app.outputQueue(), async () => encodeTransparentPng(31,47), async () => 'sha256:fixture');
  assert.deepEqual(manifest.cards.map(item => item.approvalId), [a.approvalId,b.approvalId]);
  assert.deepEqual(manifest.cards.map(item => item.approvalContentId), [a.approvalContentId,b.approvalContentId]);
  assert.equal(new Set(manifest.cards.map(item => item.filename)).size, 2);
  await app.removeOutput(0);
  assert.equal(app.latestOutputApproval, null, 'removal invalidates collection approval');
  await assert.rejects(app.validateOutputExport(firstCollection), /Approve the current output queue/);
  await app.approveOutputQueue();
  assert.equal(app.outputQueue()[0].approvalId, b.approvalId, 'reapproval preserves surviving instance identity');
});


test('reapproval refuses a collection changed after review opened without appending any card', async () => {
  const { app, depiction } = await appWithPhoto(); await app.save(initialDraft(), depiction); const row=app.bag()[0];
  const card={disc:{...row.disc},orientation:'vertical' as const,cardDesign:'u01'}; await app.enqueueOutput([card,card]); const before=app.outputQueueAddress;
  await app.removeOutput(0); await assert.rejects(app.approveOutputQueue(before),/changed during review/); assert.equal(app.outputQueue().length,1); assert.equal(app.latestOutputApproval,null);
  const surviving=app.outputQueue()[0].approvalId; await app.approveOutputQueue(app.outputQueueAddress); assert.equal(app.outputQueue().length,1); assert.equal(app.outputQueue()[0].approvalId,surviving); assert.equal(app.latestOutputApproval!.addedCount,0);
});
