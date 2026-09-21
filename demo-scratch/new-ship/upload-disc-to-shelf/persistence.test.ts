import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openExperience } from './persistent-experience.ts';
import { createExperience, initialDraft } from './model.ts';
import { restore } from './persistence.ts';
import { legacyStorageKey, sessionKeyPrefix } from './session-storage.ts';

const image = { kind: 'photo' as const, src: 'data:image/webp;base64,AAAA', name: 'fixture' };
function memory(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}
function sessionKeys(storage: ReturnType<typeof memory>) { return [...storage.values.keys()].filter(key => key.startsWith(sessionKeyPrefix)); }

test('legacy archive survives startup and save while every launch starts with an empty bag', async () => {
  const legacy = '{legacy bytes retained verbatim}', storage = memory({ [legacyStorageKey]: legacy });
  const first = await openExperience(storage, () => {});
  assert.deepEqual(first.shelf(), []);
  await first.save(initialDraft(), image);
  assert.equal(storage.getItem(legacyStorageKey), legacy);
  assert.equal(sessionKeys(storage).length, 1);
  const second = await openExperience(storage, () => {});
  assert.deepEqual(second.shelf(), []);
  assert.equal(storage.getItem(legacyStorageKey), legacy);
});

test('each save writes only its unique session key', async () => {
  const storage = memory(), app = await openExperience(storage, () => {});
  assert.deepEqual(sessionKeys(storage), []);
  await app.save(initialDraft(), image);
  const keysAfterFirstSave = sessionKeys(storage);
  assert.equal(keysAfterFirstSave.length, 1);
  const firstKey = keysAfterFirstSave[0];
  assert.match(firstKey, /^discstudio\.pxc\.session\.v1\.[A-Za-z0-9-]{16,}$/);
  const firstBytes = storage.getItem(firstKey);
  await app.save(initialDraft(), image);
  assert.deepEqual(sessionKeys(storage), [firstKey]);
  assert.notEqual(storage.getItem(firstKey), firstBytes);
});

test('quota failure leaves prior archive bytes, visible bag, and completion receipt unchanged', async () => {
  const storage = memory(); let failWrites = false;
  const app = await openExperience({ ...storage, setItem(key: string, value: string) { if (failWrites) throw Error('quota fixture'); storage.setItem(key, value); } }, () => {});
  await app.save(initialDraft(), image);
  const priorKey = sessionKeys(storage)[0], priorBytes = storage.getItem(priorKey);
  const completedBefore = app.events.filter(event => event.event === 'disc.save.completed').length;
  await app.addDraftPhoto(image);
  const retryablePhoto = await app.selectDraftDepiction();
  failWrites = true;
  await assert.rejects(app.save(initialDraft(), retryablePhoto, { photo: retryablePhoto }), /Not saved locally/);
  assert.equal(app.shelf().length, 1);
  assert.equal(storage.getItem(priorKey), priorBytes);
  assert.equal(app.events.filter(event => event.event === 'disc.save.completed').length, completedBefore);
  assert.equal((await app.selectDraftDepiction()).src, retryablePhoto.src, 'failed persistence leaves the draft photo retryable');
});

test('malformed legacy bytes are preserved and do not block a fresh empty session', async () => {
  const legacy = '{corrupt legacy bytes}', storage = memory({ [legacyStorageKey]: legacy });
  const app = await openExperience(storage, () => {});
  assert.deepEqual(app.shelf(), []);
  assert.equal(storage.getItem(legacyStorageKey), legacy);
  await app.save(initialDraft(), image);
  assert.equal(storage.getItem(legacyStorageKey), legacy);
});

test('current output queue is PxC-backed but excluded from later bag archives', async () => {
  const storage = memory(), app = await openExperience(storage, () => {});
  await app.save(initialDraft(), image);
  const row = app.bag()[0];
  await app.enqueueOutput([{ disc: { ...row.disc, depiction: { ...row.disc.depiction }, renderer: { moldName: row.seed.name, flights: [row.seed.speed ?? null, row.seed.glide ?? null, row.seed.turn ?? null, row.seed.fade ?? null] } } as any, orientation: 'vertical', cardDesign: 'u02' }]);
  assert.equal(app.outputQueue().length, 1);
  await app.save(initialDraft(), image);
  const raw = storage.getItem(sessionKeys(storage)[0])!;
  assert.doesNotMatch(raw, /ds\.px\.output\./, 'a later disc save does not duplicate output queue snapshots into the archive');
});

test('a saved session archive restores directly into a PxC experience with photo and bag links', async () => {
  const storage = memory(), app = await openExperience(storage, () => {});
  const draft = { ...initialDraft(), nickname: 'Recoverable proof' };
  await app.save(draft, image);
  const raw = storage.getItem(sessionKeys(storage)[0])!;
  const state = await restore(raw, createExperience(() => {}).pxc);
  const recovered = createExperience(() => {}, { state });
  const row = recovered.bag()[0];
  assert.equal(recovered.shelf().length, 1);
  assert.equal(row.disc.depiction.src, image.src);
  assert.equal(recovered.resolve(row.disc).nickname, draft.nickname);
  assert.equal(recovered.pxc.get(row.disc.art).composition.inputs.photo.value.src, image.src);
});

test('interleaved fresh sessions retain independent recoverable archives and legacy bytes', async () => {
  const legacy = '{legacy bytes retained verbatim}', storage = memory({ [legacyStorageKey]: legacy });
  const first = await openExperience(storage, () => {}), second = await openExperience(storage, () => {});
  await first.save({ ...initialDraft(), nickname: 'First session' }, image);
  await second.save({ ...initialDraft(), nickname: 'Second session' }, image);
  const keys = sessionKeys(storage);
  assert.equal(keys.length, 2);
  for (const [key, nickname] of [[keys[0], 'First session'], [keys[1], 'Second session']] as const) {
    const state = await restore(storage.getItem(key)!, createExperience(() => {}).pxc);
    const recovered = createExperience(() => {}, { state });
    assert.equal(recovered.resolve(recovered.bag()[0].disc).nickname, nickname);
  }
  assert.equal(storage.getItem(legacyStorageKey), legacy);
});

test('tampered produced output is rejected by direct restore', async () => {
  const storage = memory(), app = await openExperience(storage, () => {});
  await app.save({ ...initialDraft(), nickname: 'Original output' }, image);
  const saved = JSON.parse(storage.getItem(sessionKeys(storage)[0])!);
  const node = saved.nodes.find((candidate: any) => candidate.calculation !== undefined && candidate.material.object?.some(([key]: any) => key === 'nickname'));
  node.material.object.find(([key]: any) => key === 'nickname')[1] = { scalar: 'Tampered output' };
  await assert.rejects(restore(JSON.stringify(saved), createExperience(() => {}).pxc), /Restored Calculation output differs/);
});
