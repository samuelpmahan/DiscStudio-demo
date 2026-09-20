import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openExperience } from './persistent-experience.ts';
import { initialDraft } from './model.ts';
const image = { kind: 'photo' as const, src: 'data:image/webp;base64,AAAA', name: 'fixture' };
function memory() { let raw: string | null = null; return { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } }; }
test('retains two discs, override, base, receipts and producing input links after restore', async () => {
  const storage = memory(), a = await openExperience(storage, () => {});
  const first = await a.save(initialDraft(), image), second = await a.save(initialDraft(), image);
  const candidate = await a.updateDisc(first, { turn: 0 }); await a.keepDisc(first, candidate);
  const b = await openExperience(storage, () => {});
  assert.deepEqual(b.shelf().map(row => row.address), [candidate, second]);
  assert.equal(b.resolve(b.shelf()[0].disc).turn, 0);
  assert.equal(b.resolve(b.shelf()[1].disc).turn, -1);
  assert.equal(b.pxc.get(candidate).composition.calculation, b.pxc.get('oc.update'));
  assert.equal(b.pxc.get(candidate).composition.inputs.value, b.pxc.get(first));
  const inherited = await b.updateDisc(candidate, {}, ['turn']); await b.keepDisc(candidate, inherited);
  const c = await openExperience(storage, () => {});
  assert.equal(c.resolve(c.shelf()[0].disc).turn, -1);
  assert.equal(c.pxc.get(candidate).value.turn, 0);
  await c.save(initialDraft(), image); assert.equal(c.shelf().length, 3);
});
test('corrupt archive blocks writes and preserves exact bytes', async () => {
  const storage = memory(); storage.setItem('', '{corrupt');
  const app = await openExperience(storage, () => {});
  assert.match(app.persistenceStatus, /Recovery required/);
  await assert.rejects(app.save(initialDraft(), image), /writes blocked/);
  assert.equal(storage.getItem(), '{corrupt');
});
test('failed writes preserve stored and selected shelf without durable success', async () => {
  const storage = memory(), first = await openExperience(storage, () => {});
  const a = await first.save(initialDraft(), image), raw = storage.getItem();
  const app = await openExperience({ getItem: storage.getItem, setItem() { throw Error('quota fixture'); } }, () => {});
  const candidate = await app.updateDisc(a, { turn: 0 });
  await assert.rejects(app.keepDisc(a, candidate), /Not saved locally/);
  assert.equal(app.shelf()[0].address, a); assert.equal(storage.getItem(), raw);
  assert.equal(app.events.some(event => event.event === 'disc.edit.kept'), false);
});
test('changed produced output is rejected on restore, not trusted as historical truth', async () => {
  const storage = memory(), app = await openExperience(storage, () => {});
  await app.save(initialDraft(), image);
  const saved = JSON.parse(storage.getItem()!);
  const node = saved.nodes.find((node: any) => node.calculation !== undefined && node.material.object?.some(([key]: any) => key === 'nickname'));
  node.material.object.find(([key]: any) => key === 'nickname')[1] = { scalar: 'tampered' };
  const changed = JSON.stringify(saved); storage.setItem('', changed);
  const restored = await openExperience(storage, () => {});
  assert.match(restored.persistenceStatus, /Recovery required/); assert.equal(storage.getItem(), changed);
});
test('painted art and corrected mold selections survive without losing the saved original base', async () => {
  const storage = memory(), app = await openExperience(storage, () => {});
  const draft = { ...initialDraft(), nickname: 'Painted proof', colorPainting: true };
  await app.save(draft, await app.selectDraftDepiction(() => 0));
  const originalArt = app.shelf()[0].art, seed = app.seedAt(draft.mold);
  const corrected = await app.reviewSeed(draft.mold, 'corrected', { manufacturer: seed.manufacturer, name: seed.name, turn: 0 });
  const restored = await openExperience(storage, () => {});
  assert.equal(restored.shelf()[0].art, originalArt);
  assert.equal(restored.shelf()[0].disc.mold, draft.mold);
  assert.equal(restored.seedOptions().find(row => row.seed.id === seed.id)?.address, corrected);
  assert.equal(restored.seedAt(corrected).turn, 0);
});
