// DI tests: inject crucible results straight into px.crucibles.<item>
// (stage 1 never runs), run stage 2, assert the lights.
// STOPLIGHT_IMPL=mutant runs the same tests against a light that treats
// "could not run" as a pass (the F09 mistake); those tests must go red.
// STOPLIGHT_IMPL=stale uses a fingerprint that ignores input file contents,
// so an edited input would wrongly reuse an old result; the delta test must go red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createExecBoard } from './board.ts';
import {
	StoplightPxC, computeLights, fingerprintCalculation, lightCalculation, registerStoplight, runCrucibleCalculation,
	runCrucibles, type Crucible, type CrucibleResult, type Light
} from './stoplight.ts';

const IMPL = process.env.STOPLIGHT_IMPL ?? 'reference';
const mutantLight: typeof lightCalculation = ({ results }) =>
	lightCalculation({ results: results.map((r) => (r.verdict === 'could-not-run' ? { ...r, verdict: r.expect } : r)) });
const staleFingerprint: typeof fingerprintCalculation = ({ crucible }) =>
	crucible.inputs?.length ? createHash('sha256').update(crucible.cmd).digest('hex') : null;
const impls = {
	reference: { light: lightCalculation, fingerprint: fingerprintCalculation },
	mutant: { light: mutantLight, fingerprint: fingerprintCalculation },
	stale: { light: lightCalculation, fingerprint: staleFingerprint }
}[IMPL];
if (!impls) throw new Error(`STOPLIGHT_IMPL '${IMPL}' unknown; use reference, mutant or stale`);
const { light, fingerprint } = impls;

const r = (id: string, verdict: CrucibleResult['verdict'], expect: 'pass' | 'fail' = 'pass', fail = verdict === 'fail' ? 1 : 0): CrucibleResult =>
	({ id, expect, verdict, tests: 3, pass: 3 - fail, fail, outputSha256: 'x', note: verdict === 'could-not-run' ? 'missing module' : undefined });

function lightFor(results: readonly CrucibleResult[]): Light {
	const pxc = createExecBoard();
	registerStoplight(pxc, { runCrucible: () => { throw new Error('stage 1 must not run: results were injected'); }, light });
	pxc.set(StoplightPxC.items, [{ id: 'it', what: 'x', crucibles: [] }]);
	pxc.set(StoplightPxC.results('it'), results);
	const [only] = computeLights(pxc);
	assert.deepEqual(only.has.crucibles.results, results);
	assert.equal(only.has.light.fn, 'fn.Stoplight.light');
	return only.light;
}

test('no crucible is yellow', () => assert.equal(lightFor([]), 'yellow'));
test('all crucibles pass is green', () => assert.equal(lightFor([r('a', 'pass'), r('b', 'pass')]), 'green'));
test('one failing crucible is red', () => assert.equal(lightFor([r('a', 'pass'), r('b', 'fail')]), 'red'));
test('a broken copy that is caught counts toward green', () => assert.equal(lightFor([r('m', 'fail', 'fail')]), 'green'));
test('a broken copy that slips through is red', () => assert.equal(lightFor([r('m', 'pass', 'fail')]), 'red'));
test('a crucible that could not run is yellow, never green', () => assert.equal(lightFor([r('a', 'pass'), r('b', 'could-not-run')]), 'yellow'));
test('a real failure beats could-not-run', () => assert.equal(lightFor([r('a', 'fail'), r('b', 'could-not-run')]), 'red'));

test('stage 1 reads real test counts and flags runs that never happened', () => {
	const ok = runCrucibleCalculation({ id: 'ok', cwd: '.', cmd: `printf '# tests 2\\n# pass 2\\n# fail 0\\n'` });
	assert.equal(ok.verdict, 'pass');
	const bad = runCrucibleCalculation({ id: 'bad', cwd: '.', cmd: `printf '# tests 2\\n# pass 1\\n# fail 1\\n'` });
	assert.equal(bad.verdict, 'fail');
	const silent = runCrucibleCalculation({ id: 'silent', cwd: '.', cmd: 'true' });
	assert.equal(silent.verdict, 'could-not-run');
	const env = runCrucibleCalculation({ id: 'env', cwd: '.', cmd: `printf 'ERR_MODULE_NOT_FOUND\\n# tests 1\\n# pass 0\\n# fail 1\\n'` });
	assert.equal(env.verdict, 'could-not-run');
	const gone = runCrucibleCalculation({ id: 'gone', cwd: './no-such-tree', cmd: `printf '# tests 1\\n# pass 1\\n# fail 0\\n'` });
	assert.equal(gone.verdict, 'could-not-run');
});

// ---- delta: reuse only when every declared input is byte-identical ----------

/** A temp root holding stand-in runner files, so fingerprints can be computed. */
function mkroot(): string {
	const root = mkdtempSync(join(tmpdir(), 'stoplight-delta-'));
	writeFileSync(join(root, 'stoplight.ts'), 'runner v1');
	writeFileSync(join(root, 'board.ts'), 'board v1');
	return root;
}

function stage1(root: string, crucible: Crucible, previous?: Record<string, readonly CrucibleResult[]>): CrucibleResult {
	const pxc = createExecBoard();
	registerStoplight(pxc, { runCrucible: runCrucibleCalculation, light, fingerprint });
	pxc.set(StoplightPxC.root, root);
	if (previous) pxc.set(StoplightPxC.previous, previous);
	pxc.set(StoplightPxC.items, [{ id: 'it', what: 'x', crucibles: [crucible] }]);
	runCrucibles(pxc);
	return pxc.get(StoplightPxC.results('it'))[0];
}

test('delta: same inputs reuse the previous result; an edited input re-runs', () => {
	const root = mkroot();
	writeFileSync(join(root, 'input.txt'), 'v1');
	const failing: Crucible = { id: 'c', cwd: root, inputs: ['input.txt'], cmd: `printf '# tests 1\\n# pass 0\\n# fail 1\\n'` };
	const fp = fingerprintCalculation({ crucible: failing, root });
	const prior: CrucibleResult = { id: 'c', expect: 'pass', verdict: 'pass', tests: 1, pass: 1, fail: 0, outputSha256: 'old', fingerprint: fp };
	const reused = stage1(root, failing, { it: [prior] });
	assert.equal(reused.reused, true);
	assert.equal(reused.verdict, 'pass', 'unchanged inputs: old pass is reused, the failing command never runs');
	writeFileSync(join(root, 'input.txt'), 'v2');
	const rerun = stage1(root, failing, { it: [prior] });
	assert.equal(rerun.reused, false, 'edited input must not reuse');
	assert.equal(rerun.verdict, 'fail');
});

test('delta: no declared inputs, or a prior could-not-run, always re-runs', () => {
	const root = mkroot();
	writeFileSync(join(root, 'input.txt'), 'v1');
	const ok = `printf '# tests 1\\n# pass 1\\n# fail 0\\n'`;
	const undeclared = stage1(root, { id: 'c', cwd: root, cmd: ok }, { it: [{ id: 'c', expect: 'pass', verdict: 'fail', tests: 1, pass: 0, fail: 1, outputSha256: 'x', fingerprint: null }] });
	assert.equal(undeclared.reused, false);
	assert.equal(undeclared.verdict, 'pass');
	const declared: Crucible = { id: 'c', cwd: root, cmd: ok, inputs: ['input.txt'] };
	const fp = fingerprintCalculation({ crucible: declared, root });
	const unrun = stage1(root, declared, { it: [{ id: 'c', expect: 'pass', verdict: 'could-not-run', tests: 0, pass: 0, fail: 0, outputSha256: '', fingerprint: fp }] });
	assert.equal(unrun.reused, false);
	assert.equal(unrun.verdict, 'pass');
});

test('delta: a changed runner/classifier, cwd or command invalidates reuse', () => {
	const root = mkroot();
	writeFileSync(join(root, 'input.txt'), 'v1');
	const base: Crucible = { id: 'c', cwd: root, inputs: ['input.txt'], cmd: 'true' };
	const fp = fingerprint({ crucible: base, root });
	assert.ok(fp);
	writeFileSync(join(root, 'stoplight.ts'), 'runner v2');
	assert.notEqual(fingerprint({ crucible: base, root }), fp, 'runner change must invalidate');
	writeFileSync(join(root, 'stoplight.ts'), 'runner v1');
	assert.equal(fingerprint({ crucible: base, root }), fp);
	assert.notEqual(fingerprint({ crucible: { ...base, cwd: join(root, 'sub') }, root }), fp, 'cwd change must invalidate');
	assert.notEqual(fingerprint({ crucible: { ...base, cmd: 'false' }, root }), fp, 'command change must invalidate');
});
