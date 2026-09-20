import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Part, PxC } from '../part-first-kernel/src/pxc.mjs';
import { create, read, update, destroy, runStage } from './operations.ts';
import { createExperience, initialDraft } from './model.ts';

test('one update/read handles specialization, zero, null and inheritance without mutating inputs', () => {
  const base = Object.freeze({ speed: 5, glide: 5, turn: 0, fade: 0 });
  const a = create({ mold: 'fixture.mold' }), b = create({ mold: 'fixture.mold' });
  const changed = update({ value: a, patch: { turn: -1 } });
  assert.deepEqual(read({ base, own: changed }), { ...base, mold: 'fixture.mold', turn: -1 });
  assert.equal(read({ base, own: b }).turn, 0);
  assert.equal(base.turn, 0);
  assert.equal(read({ base: { turn: -1 }, own: { turn: 0 } }).turn, 0);
  assert.equal(read({ base, own: { turn: null } }).turn, null);
  assert.equal(read({ base, own: update({ value: changed, remove: ['turn'] }) }).turn, 0);
  assert.equal(Object.hasOwn(a, 'turn'), false);
});
test('destroy removes membership from a fresh collection, not the retained object', () => {
  const object = create({ name: 'disc' }), collection = create({ disc: object });
  assert.deepEqual(destroy({ collection, key: 'disc' }), {});
  assert.equal(collection.disc, object);
});
test('actual saved disc holds only its override; generic edits retain prior versions', async () => {
  const app = createExperience(() => {}), draft = { ...initialDraft(), turn: 0 };
  const address = await app.save(draft, await app.selectDraftDepiction(() => 0));
  const own = app.pxc.get(address).value;
  assert.equal(own.turn, 0); assert.equal(Object.hasOwn(own, 'speed'), false);
  assert.equal(app.resolve(own).speed, 5);
  const edited = await app.updateDisc(address, { turn: null });
  assert.equal(app.resolve(app.pxc.get(edited).value).turn, null);
  const inherited = await app.updateDisc(edited, {}, ['turn']);
  assert.equal(app.resolve(app.pxc.get(inherited).value).turn, -1);
  assert.equal(app.pxc.get(address).value.turn, 0);
  assert.equal(app.shelf()[0].address, address); // A candidate edit is not automatic promotion.
  await assert.rejects(app.updateDisc(address, { turn: NaN }));
  await assert.rejects(app.updateDisc(address, {}, ['mold']));
});
test('save records three ordered boundaries linking the actual produced Parts', async () => {
  const app = createExperience(() => {});
  await app.save(initialDraft(), await app.selectDraftDepiction(() => 0));
  const receipt = app.events.at(-1)!;
  const ticks = receipt.ticks as string[];
  assert.deepEqual(ticks.map(x => x.split('.').at(-1)), ['specialize', 'depict', 'retain']);
  for (const address of ticks) {
    const tick = app.pxc.get(address);
    for (const output of tick.value.outputs) assert.equal(tick.composition.inputs[output], app.pxc.get(output));
  }
});
test('next runs exactly one Tick; a failure neither yields nor runs downstream work', async () => {
  const pxc = new PxC(); let calls = 0;
  pxc.set('fn.tick', new Part(outputs => ({ outputs: Object.keys(outputs) })));
  pxc.set('ok', new Part(() => ++calls));
  pxc.set('fail', new Part(() => { throw Error('fixture failure'); }));
  const stage = runStage(pxc, [
    { into: 'tick.a', calculations: [{ into: 'a', calculation: 'ok', inputs: {} }] },
    { into: 'tick.b', calculations: [{ into: 'b', calculation: 'fail', inputs: {} }] },
    { into: 'tick.c', calculations: [{ into: 'c', calculation: 'ok', inputs: {} }] },
  ]);
  assert.equal(calls, 0);
  assert.equal((await stage.next()).value, 'tick.a'); assert.equal(calls, 1);
  await assert.rejects(stage.next(), /fixture failure/);
  assert.throws(() => pxc.get('tick.b')); assert.throws(() => pxc.get('c'));
  assert.equal(calls, 1);
});
test('same find supports mold rows and owned disc rows', () => {
  const app = createExperience(() => {}), find = app.pxc.get('fn.find').value;
  assert.ok(app.seedOptions('discraft buzzz').some(row => row.seed.name === 'Buzzz'));
  const collection = Array.from({ length: 120 }, (_, i) => ({ nickname: `disc ${i}`, plastic: i % 2 ? 'ESP' : 'Z' }));
  assert.equal(find({ collection, query: '119 esp', fields: row => [row.nickname, row.plastic] }).length, 1);
});
