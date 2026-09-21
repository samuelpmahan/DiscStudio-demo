import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openExperience } from './persistent-experience.ts';
import { createExperience, initialDraft } from './model.ts';
import { restore } from './persistence.ts';
import { legacyStorageKey, sessionKeyPrefix } from './session-storage.ts';
import { exportZip } from './export-queue.ts';
import { Part } from '../part-first-kernel/src/pxc.mjs';

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
function storageError(name: 'QuotaExceededError' | 'SecurityError') { const error = Error(name); error.name = name; return error; }
function heldCard(app: Awaited<ReturnType<typeof openExperience>>) {
  const row = app.bag().at(-1)!;
  return { disc: { ...row.disc, depiction: { ...row.disc.depiction }, renderer: { moldName: row.seed.name, flights: [row.seed.speed ?? null, row.seed.glide ?? null, row.seed.turn ?? null, row.seed.fade ?? null] } } as any, orientation: 'vertical' as const, cardDesign: 'u02' };
}
function inlinePhotoReferences(value: any, photos: string[]): any {
  if (Array.isArray(value)) return value.map(item => inlinePhotoReferences(item, photos));
  if (!value || typeof value !== 'object') return value;
  if (Object.keys(value).length === 1 && Object.hasOwn(value, 'photo')) return { scalar: photos[value.photo] };
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, inlinePhotoReferences(item, photos)]));
}
function replaceFirstPhotoReference(value: any, replacement = 999): boolean {
  if (Array.isArray(value)) return value.some(item => replaceFirstPhotoReference(item, replacement));
  if (!value || typeof value !== 'object') return false;
  if (Object.keys(value).length === 1 && Object.hasOwn(value, 'photo')) { value.photo = replacement; return true; }
  return Object.values(value).some(item => replaceFirstPhotoReference(item, replacement));
}

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

test('quota keeps a valid current bag and export queue in memory, preserves prior bytes, and later retries the complete session', async () => {
  const legacy = '{legacy bytes retained verbatim}', storage = memory({ [legacyStorageKey]: legacy }); let failWrites = false;
  const app = await openExperience({ ...storage, setItem(key: string, value: string) { if (failWrites) throw storageError('QuotaExceededError'); storage.setItem(key, value); } }, () => {});
  await app.save(initialDraft(), image);
  const priorKey = sessionKeys(storage)[0], priorBytes = storage.getItem(priorKey);
  failWrites = true;
  await app.save({ ...initialDraft(), nickname: 'Session-only disc' }, image);
  assert.equal(app.shelf().length, 2);
  assert.equal(storage.getItem(priorKey), priorBytes);
  assert.equal(storage.getItem(legacyStorageKey), legacy);
  assert.match(app.persistenceStatus, /storage is full.*session only.*Export your cards/i);
  await app.enqueueOutput([heldCard(app)]);
  assert.equal(app.outputQueue().length, 1);
  assert.ok((await exportZip(app.outputQueue())).length > 0, 'session-only work remains exportable');

  failWrites = false;
  await app.save({ ...initialDraft(), nickname: 'Durable retry' }, image);
  assert.match(app.persistenceStatus, /^Saved in this session archive/);
  assert.notEqual(storage.getItem(priorKey), priorBytes);
  const state = await restore(storage.getItem(priorKey)!, createExperience(() => {}).pxc);
  assert.equal(createExperience(() => {}, { state }).bag().length, 3, 'the later write retains prior session-only work too');
});

test('SecurityError at boot still attempts every save and keeps usable session-only work', async () => {
  const storage = memory(); let writes = 0;
  const unavailable = {
    ...storage,
    getItem(_key: string) { throw storageError('SecurityError'); },
    setItem(_key: string, _value: string) { writes++; throw storageError('SecurityError'); },
  };
  const app = await openExperience(unavailable, () => {});
  await app.save(initialDraft(), image);
  assert.equal(writes, 1);
  assert.equal(app.bag().length, 1);
  assert.match(app.persistenceStatus, /storage is unavailable.*session only.*Export your cards/i);
});

test('unrecognized storage failures reject, preserve the bag, and leave the draft photo retryable', async () => {
  const storage = memory();
  const app = await openExperience({ ...storage, setItem() { throw Error('broken test storage adapter'); } }, () => {});
  await app.addDraftPhoto(image);
  const draftPhoto = await app.selectDraftDepiction();
  await assert.rejects(app.save(initialDraft(), draftPhoto, { photo: draftPhoto }), /Not saved locally: Error: broken test storage adapter/);
  assert.equal(app.bag().length, 0);
  assert.equal(sessionKeys(storage).length, 0);
  assert.match(app.persistenceStatus, /^Not saved locally:/);
  assert.equal((await app.selectDraftDepiction()).src, image.src);
});

test('serialization failures reject without a write or an in-memory bag commit', async () => {
  const storage = memory(); let writes = 0;
  const app = await openExperience({ ...storage, setItem(key: string, value: string) { writes++; storage.setItem(key, value); } }, () => {});
  await app.addDraftPhoto(image);
  const draftPhoto = await app.selectDraftDepiction();
  app.pxc.set('ds.px.unsupported-persistence-fixture', new Part(new Uint8Array([1])));
  await assert.rejects(app.save(initialDraft(), draftPhoto, { photo: draftPhoto }), /Unsupported persistent material/);
  assert.equal(writes, 0);
  assert.equal(app.bag().length, 0);
  assert.equal(app.events.filter(event => event.event === 'disc.save.completed').length, 0);
  assert.equal((await app.selectDraftDepiction()).src, image.src);
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

test('v2 archives retain repeated prepared photo bytes once and v1 inline photo archives still restore', async () => {
  const photo = { kind: 'photo' as const, src: `data:image/webp;base64,${'A'.repeat(16_384)}`, name: 'large-fixture' };
  const other = { kind: 'photo' as const, src: `data:image/webp;base64,${'B'.repeat(16_384)}`, name: 'other-fixture' };
  const storage = memory(), app = await openExperience(storage, () => {});
  await app.save({ ...initialDraft(), nickname: 'One' }, photo);
  await app.save({ ...initialDraft(), nickname: 'Two' }, other);
  const raw = storage.getItem(sessionKeys(storage)[0])!, encoded = JSON.parse(raw);
  assert.equal(encoded.version, 2);
  assert.deepEqual(encoded.photos, [photo.src, other.src]);
  assert.equal(raw.split(photo.src).length - 1, 1, 'the exact photo URI occupies one archive table entry, not every PxC material site');
  assert.equal(raw.split(other.src).length - 1, 1, 'a distinct photo retains its own single exact table entry');
  const restored = createExperience(() => {}, { state: await restore(raw, createExperience(() => {}).pxc) });
  assert.equal(restored.bag().length, 2);
  assert.equal(restored.bag()[0].disc.depiction.src, photo.src);
  assert.equal(restored.bag()[1].disc.depiction.src, other.src);

  const v1 = { ...encoded, version: 1, nodes: inlinePhotoReferences(encoded.nodes, encoded.photos) };
  delete v1.photos;
  const oldRestored = createExperience(() => {}, { state: await restore(JSON.stringify(v1), createExperience(() => {}).pxc) });
  assert.equal(oldRestored.bag().length, 2, 'existing inline-photo v1 archives remain recoverable');
});

test('v2 photo reference edits in a produced node still fail restored calculation readback', async () => {
  const first = { kind: 'photo' as const, src: `data:image/webp;base64,${'A'.repeat(80)}`, name: 'first' };
  const second = { kind: 'photo' as const, src: `data:image/webp;base64,${'B'.repeat(80)}`, name: 'second' };
  const storage = memory(), app = await openExperience(storage, () => {});
  await app.save(initialDraft(), first);
  await app.save(initialDraft(), second);
  const encoded = JSON.parse(storage.getItem(sessionKeys(storage)[0])!);
  const changed = encoded.nodes.some((node: any) => Object.hasOwn(node, 'calculation') && replaceFirstPhotoReference(node.material, 1));
  assert.equal(changed, true);
  await assert.rejects(restore(JSON.stringify(encoded), createExperience(() => {}).pxc), /Restored Calculation output differs/);
});

test('v2 archives reject malformed photo table references before restore can trust them', async () => {
  const storage = memory(), app = await openExperience(storage, () => {});
  await app.save(initialDraft(), image);
  const encoded = JSON.parse(storage.getItem(sessionKeys(storage)[0])!);
  assert.equal(replaceFirstPhotoReference(encoded.nodes), true);
  await assert.rejects(restore(JSON.stringify(encoded), createExperience(() => {}).pxc), /Invalid retained photo reference/);
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
