import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSandbox } from './experience-fixtures.ts';
import { createCaseRun } from './sandbox-cases.ts';
import { mountExperiencePage } from './experience-page.ts';

test('page mounting is import-safe and accepts the caller-owned context', () => {
  assert.equal(typeof mountExperiencePage, 'function');
});

test('overlapping Next requests coalesce and the result retains actual inspected Parts', async () => {
  const experience = await startSandbox('upload'); let release!: () => void, calls = 0;
  const paused = new Promise<void>(resolve => { release = resolve; });
  const runner = createCaseRun(experience, 'concurrency', [{ name: 'One delayed action', async run() {
    calls++; await paused; return { refs: [experience.shelfAddress], checks: [{ name: 'Empty shelf', pass: experience.shelf().length === 0 }] };
  } }]);
  const first = runner.next(), second = runner.next(); assert.equal(first, second); assert.equal(runner.state().busy, true);
  release(); const address = (await first)!;
  assert.equal(calls, 1); assert.equal(runner.state().next, 1); assert.equal(await runner.next(), null);
  const part = experience.pxc.get(address);
  assert.equal(part.composition.inputs.inspected0, experience.pxc.get(experience.shelfAddress));
  assert.equal(part.composition.calculation, experience.pxc.get('fn.sandbox.caseResult'));
  assert.equal(runner.pxc, experience.pxc); assert.equal(runner.experience, experience);
  assert.equal(part.value.passed, true); assert.deepEqual(runner.state().reviews, []);
});

test('failed checks stop later actions while retaining their evidence', async () => {
  const experience = await startSandbox('upload'); let futureCalls = 0;
  const runner = createCaseRun(experience, 'failure', [
    { name: 'Deliberate mismatch', async run() { return { refs: [experience.shelfAddress], checks: [{ name: 'Expected an absent Disc', pass: false }] }; } },
    { name: 'Must not run', async run() { futureCalls++; return { refs: [], checks: [] }; } },
  ]);
  const address = (await runner.next())!;
  assert.equal(experience.pxc.get(address).value.passed, false);
  assert.equal(runner.state().failed, true); assert.equal(await runner.next(), null); assert.equal(futureCalls, 0);
  assert.throws(() => runner.review('needs-work', '  '), /observations/);
  const review = runner.review('needs-work', 'This failure needs investigation before combining.');
  assert.deepEqual(experience.pxc.get(review).value.caseRecords, [address]);
  assert.equal(experience.pxc.get(review).value.source, 'explicit review form');
  assert.doesNotThrow(() => JSON.stringify(runner.report()));
});

test('action errors are inspectable and independent sandbox reports do not share state', async () => {
  const a = await startSandbox('upload'), b = await startSandbox('upload');
  const runner = createCaseRun(a, 'throws', [{ name: 'Missing control', async run() { throw Error('Missing Save control'); } }]);
  const other = createCaseRun(b, 'other', [{ name: 'Untouched', async run() { return { refs: [], checks: [{ name: 'yes', pass: true }] }; } }]);
  const address = (await runner.next())!;
  assert.match(a.pxc.get(address).value.error, /Missing Save control/);
  assert.throws(() => b.pxc.get(address), /Missing Part/);
  assert.equal(other.state().next, 0); assert.deepEqual(other.report().records, []);
});
