import test from 'node:test';
import assert from 'node:assert/strict';
import { bagMembership, createBag, duplicateBag, reorderBag } from './bags.ts';

const rows = [
  { address: 'ds.px.disc.a', disc: { id: 'a' } },
  { address: 'ds.px.disc.b', disc: { id: 'b' } },
  { address: 'ds.px.disc.a.next', disc: { id: 'a' } },
] as const;

test('createBag retains ordered physical ids and exact selected-version evidence without mutation', () => {
  const selection = ['ds.px.disc.b', 'ds.px.disc.a'] as const;
  const bag = createBag({ id: 'round-one', name: ' Round one ', selection, rows });
  assert.deepEqual(bag, {
    id: 'round-one', name: 'Round one', discIds: ['b', 'a'],
    versions: [{ id: 'b', address: 'ds.px.disc.b' }, { id: 'a', address: 'ds.px.disc.a' }],
  });
  assert.ok(Object.isFrozen(bag) && Object.isFrozen(bag.discIds) && Object.isFrozen(bag.versions));
  assert.deepEqual(selection, ['ds.px.disc.b', 'ds.px.disc.a']);
});

test('createBag rejects absent/stale addresses and repeated physical specimens instead of dropping either', () => {
  assert.throws(() => createBag({ id: 'x', name: 'Bag', selection: ['missing'], rows }), /stale or absent/);
  assert.throws(() => createBag({ id: 'x', name: 'Bag', selection: ['ds.px.disc.a', 'ds.px.disc.a.next'], rows }), /selected more than once/);
  assert.throws(() => createBag({ id: 'x', name: ' ', selection: ['ds.px.disc.a'], rows }), /nonempty/);
  assert.throws(() => createBag({ id: 'x', name: 'Bag', selection: [], rows }), /Select at least one/);
});

test('membership is immutable and requires exact evidence only for a new physical reference', () => {
  const bag = createBag({ id: 'round-one', name: 'Round one', selection: ['ds.px.disc.a'], rows });
  assert.equal(bagMembership({ bag, discId: 'a', include: true }), bag, 'repeat add is idempotent');
  assert.throws(() => bagMembership({ bag, discId: 'b', include: true }), /exact version evidence/);
  const withB = bagMembership({ bag, discId: 'b', version: { id: 'b', address: 'ds.px.disc.b' }, include: true });
  assert.deepEqual(withB.discIds, ['a', 'b']);
  assert.deepEqual(withB.versions.map(version => version.address), ['ds.px.disc.a', 'ds.px.disc.b']);
  assert.deepEqual(bag.discIds, ['a'], 'prior Bag stays unchanged');
  assert.deepEqual(bagMembership({ bag: withB, discId: 'a', include: false }).discIds, ['b']);
});

test('reorder and duplicate retain paired references, order, and original Bag', () => {
  const bag = createBag({ id: 'round-one', name: 'Round one', selection: ['ds.px.disc.a', 'ds.px.disc.b'], rows });
  const moved = reorderBag({ bag, discId: 'b', toIndex: 0 });
  assert.deepEqual(moved.discIds, ['b', 'a']);
  assert.deepEqual(moved.versions.map(version => version.address), ['ds.px.disc.b', 'ds.px.disc.a']);
  assert.deepEqual(bag.discIds, ['a', 'b']);
  assert.throws(() => reorderBag({ bag, discId: 'missing', toIndex: 0 }), /not in this bag/);
  const copy = duplicateBag({ bag: moved, id: 'round-two' });
  assert.deepEqual(copy.discIds, moved.discIds);
  assert.deepEqual(copy.versions, moved.versions);
  assert.notEqual(copy, moved);
  assert.throws(() => duplicateBag({ bag, id: 'round-one' }), /differ/);
});
