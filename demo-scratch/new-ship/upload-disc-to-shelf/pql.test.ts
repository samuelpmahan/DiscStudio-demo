import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Part, PxC } from '../part-first-kernel/src/pxc.mjs';
import { create, read } from './operations.ts';
import { executePql } from './pql.ts';

function fixture() {
  const pxc = new PxC();
  pxc.set('fn.CREATE', new Part(create));
  pxc.set('fn.READ', new Part(read));
  pxc.set('ds.px.input', new Part(Object.freeze({ mold: 'fixture' })));
  return pxc;
}

test('PQL INSERT and SELECT compile to the registered universal PxC calculations', async () => {
  const pxc = fixture();
  const created = await executePql(pxc, 'INSERT INTO ds.px.disc.one VALUES :value', {
    bindings: { value: 'ds.px.input', id: new Part('one') },
  });
  const readback = await executePql(pxc, 'SELECT * FROM ds.px.disc.one', { into: 'ds.px.pql.one' });
  assert.equal(pxc.get('ds.px.disc.one').composition.calculation, pxc.get('fn.CREATE'));
  assert.equal(pxc.get('ds.px.pql.one').composition.calculation, pxc.get('fn.READ'));
  assert.deepEqual(pxc.get('ds.px.pql.one').value, { mold: 'fixture', id: 'one' });
  assert.deepEqual(created, { query: 'INSERT INTO ds.px.disc.one VALUES :value', operation: 'INSERT', calculation: 'fn.CREATE', into: 'ds.px.disc.one', actualInputs: [{ name: 'id', reference: 'inline Part' }, { name: 'value', reference: 'ds.px.input' }] });
  assert.deepEqual(readback, { query: 'SELECT * FROM ds.px.disc.one', operation: 'SELECT', calculation: 'fn.READ', into: 'ds.px.pql.one', actualInputs: [{ name: 'base', reference: 'ds.px.disc.one' }, { name: 'own', reference: 'inline Part' }] });
});

test('PQL rejects unsupported grammar and never treats parameter text as query syntax', async () => {
  const pxc = fixture();
  await assert.rejects(executePql(pxc, 'UPDATE ds.px.disc.one SET weight = :weight'), /Unsupported PQL statement/);
  await assert.rejects(executePql(pxc, 'SELECT id FROM ds.px.disc.one', { into: 'ds.px.out' }), /Unsupported PQL statement/);
  await assert.rejects(executePql(pxc, 'INSERT INTO ds.px.disc.one VALUES :value', { bindings: {} }), /requires the :value binding/);
  assert.equal(pxc.entries().some(([address]) => address === 'ds.px.disc.one'), false);
});

test('PQL SELECT preserves a non-object Part value exactly', async () => {
  const pxc = fixture();
  pxc.set('ds.px.scalar', new Part(42));
  await executePql(pxc, 'SELECT * FROM ds.px.scalar', { into: 'ds.px.pql.scalar' });
  assert.equal(pxc.get('ds.px.pql.scalar').value, 42);
});

test('PQL accepts another semantic PxC namespace without owning its storage', async () => {
  const pxc = fixture();
  pxc.set('px.example.input', new Part(Object.freeze({ mold: 'alternate' })));
  await executePql(pxc, 'INSERT INTO px.example.disc.one VALUES :value', { bindings: { value: 'px.example.input' } });
  await executePql(pxc, 'SELECT * FROM px.example.disc.one', { into: 'px.example.readback.one' });
  assert.deepEqual(pxc.get('px.example.readback.one').value, { mold: 'alternate' });
});
