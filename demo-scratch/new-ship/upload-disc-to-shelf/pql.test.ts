import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Part, PxC } from '../part-first-kernel/src/pxc.mjs';
import { create, read } from './operations.ts';
import { creatorPqlPlans, executePqlPlan } from './pql.ts';
import { compilePql, executePql } from './pql-compiler.ts';

function fixture() {
  const pxc = new PxC();
  pxc.set('fn.CREATE', new Part(create));
  pxc.set('fn.READ', new Part(read));
  pxc.set('ds.px.input', new Part(Object.freeze({ mold: 'fixture' })));
  return pxc;
}

test('literal creator plans match their PQL compilation and are frozen before execution', () => {
  assert.deepEqual(creatorPqlPlans.createDisc, compilePql('INSERT INTO :target VALUES :value', 'discstudio.creator.create-disc.v1'));
  assert.deepEqual(creatorPqlPlans.readDisc, compilePql('SELECT * FROM :source', 'discstudio.creator.read-disc.v1'));
  assert.deepEqual(creatorPqlPlans.readShelf, compilePql('SELECT * FROM :source', 'discstudio.creator.read-shelf.v1'));
  assert.equal(Object.isFrozen(creatorPqlPlans.createDisc), true);
  assert.equal(Object.isFrozen(creatorPqlPlans.readDisc), true);
});

test('a frozen INSERT plan binds its target separately from CREATE Part traffic', async () => {
  const pxc = fixture();
  const created = await executePqlPlan(pxc, creatorPqlPlans.createDisc, {
    target: 'ds.px.disc.one', bindings: { value: 'ds.px.input', id: new Part('one') },
  });
  assert.equal(pxc.get('ds.px.disc.one').composition.calculation, pxc.get('fn.CREATE'));
  assert.equal(pxc.get('ds.px.disc.one').composition.inputs.target, undefined);
  assert.equal(created.plan, creatorPqlPlans.createDisc);
  assert.deepEqual(created.boundAddresses, { target: 'ds.px.disc.one', into: 'ds.px.disc.one' });
  assert.deepEqual(created.actualInputs, [{ name: 'id', reference: 'inline Part' }, { name: 'value', reference: 'ds.px.input' }]);
});

test('a frozen SELECT plan compiles to registered fn.READ and preserves a scalar Part', async () => {
  const pxc = fixture();
  pxc.set('ds.px.scalar', new Part(42));
  const readback = await executePqlPlan(pxc, creatorPqlPlans.readDisc, { source: 'ds.px.scalar', into: 'ds.px.pql.scalar' });
  assert.equal(pxc.get('ds.px.pql.scalar').composition.calculation, pxc.get('fn.READ'));
  assert.equal(pxc.get('ds.px.pql.scalar').value, 42);
  assert.equal(readback.plan, creatorPqlPlans.readDisc);
  assert.deepEqual(readback.boundAddresses, { source: 'ds.px.scalar', into: 'ds.px.pql.scalar' });
});

test('rejects a malformed plan before it can dispatch a mismatched calculation', async () => {
  const pxc = fixture();
  const malformed = Object.freeze({ ...creatorPqlPlans.createDisc, calculation: 'fn.READ' as const });
  await assert.rejects(executePqlPlan(pxc, malformed, { target: 'ds.px.disc.bad', bindings: { value: 'ds.px.input' } }), /matching universal calculation/);
  assert.equal(pxc.entries().some(([entry]) => entry === 'ds.px.disc.bad'), false);
});

test('PQL rejects unsupported grammar and never treats parameter text as query syntax', async () => {
  const pxc = fixture();
  await assert.rejects(executePql(pxc, 'UPDATE ds.px.disc.one SET weight = :weight'), /Unsupported PQL statement/);
  await assert.rejects(executePql(pxc, 'SELECT id FROM ds.px.disc.one', { into: 'ds.px.out' }), /Unsupported PQL statement/);
  await assert.rejects(executePql(pxc, 'INSERT INTO ds.px.disc.one VALUES :value', { bindings: {} }), /requires the :value binding/);
  assert.equal(pxc.entries().some(([address]) => address === 'ds.px.disc.one'), false);
});

test('ad-hoc PQL accepts another semantic PxC namespace without owning its storage', async () => {
  const pxc = fixture();
  pxc.set('px.example.input', new Part(Object.freeze({ mold: 'alternate' })));
  await executePql(pxc, 'INSERT INTO px.example.disc.one VALUES :value', { bindings: { value: 'px.example.input' } });
  await executePql(pxc, 'SELECT * FROM px.example.disc.one', { into: 'px.example.readback.one' });
  assert.deepEqual(pxc.get('px.example.readback.one').value, { mold: 'alternate' });
});
