import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Part, PxC } from '../part-first-kernel/src/pxc.mjs';
import { selectCalculation, type CalculationSelectClause } from './calculation-select.ts';

test('SELECT chooses one matching clause, binds its exact function Part, and composes from addressed Parts', async () => {
  const pxc = new PxC(); let chosenCalls = 0, otherCalls = 0;
  pxc.set('px.seed.full', new Part({ flight: { speed: 5, glide: 4, turn: -1, fade: 1 } }));
  pxc.set('px.draft', new Part({ turn: 0 }));
  pxc.set('fn.full', new Part(({ seed, draft }: any) => { chosenCalls++; return { ...seed.flight, ...draft }; }));
  pxc.set('fn.other', new Part(() => { otherCalls++; return 'wrong branch'; }));
  const clauses: CalculationSelectClause[] = [
    { name: 'full', calculationAddress: 'fn.full', matches: inputs => Object.hasOwn(inputs.seed.value.flight, 'fade') },
    { name: 'other', calculationAddress: 'fn.other', matches: () => false },
  ];
  const selection = selectCalculation(pxc, 'fixture.resolve', clauses, { seed: 'px.seed.full', draft: 'px.draft' });
  assert.equal(selection.clause, 'full');
  assert.equal(selection.calculationAddress, 'fn.full');
  assert.deepEqual(selection.inputPartAddresses, { seed: 'px.seed.full', draft: 'px.draft' });
  const bindingAddress = 'ds.px.binding.fixture';
  pxc.set(bindingAddress, selection.calculation);
  const output = await pxc.compose({ into: 'px.resolved', calculation: bindingAddress, inputs: selection.inputPartAddresses });
  assert.equal(output.composition.calculation, pxc.get('fn.full'));
  assert.equal(output.composition.calculation, selection.calculation);
  assert.deepEqual(output.composition.inputs, { seed: pxc.get('px.seed.full'), draft: pxc.get('px.draft') });
  assert.deepEqual(output.value, { speed: 5, glide: 4, turn: 0, fade: 1 });
  assert.equal(chosenCalls, 1);
  assert.equal(otherCalls, 0);
});

for (const [name, clauses] of [
  ['no match', [{ name: 'miss', calculationAddress: 'fn.a', matches: () => false }]],
  ['ambiguity', [
    { name: 'left', calculationAddress: 'fn.a', matches: () => true },
    { name: 'right', calculationAddress: 'fn.b', matches: () => true },
  ]],
] as const) {
  test(`SELECT ${name} fails before binding, output, or success receipt`, () => {
    const pxc = new PxC();
    pxc.set('px.input', new Part({ shape: 'candidate' }));
    pxc.set('fn.a', new Part(() => 'a'));
    pxc.set('fn.b', new Part(() => 'b'));
    const before = pxc.entries().length;
    assert.throws(() => selectCalculation(pxc, 'fixture.choose', clauses as CalculationSelectClause[], { input: 'px.input' }), name === 'no match' ? /found no matching clause/ : /is ambiguous/);
    assert.equal(pxc.entries().length, before);
    assert.equal(pxc.receipts().length, 0);
    assert.throws(() => pxc.get('ds.px.binding.fixture'));
    assert.throws(() => pxc.get('px.output'));
    assert.throws(() => pxc.get('ds.px.receipt.select.fixture'));
  });
}
