// Stoplight: every item's light is computed from its crucibles, never decided.
// Built on ChainSpot's PxC board (board.ts, copied from lab/s0-viewer).
//   green  = every crucible ran and came out as expected
//   yellow = no crucible yet, or a crucible could not run (not evidence)
//   red    = a crucible ran and came out wrong
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pxFn, pxKey, type PxC } from './board.ts';

export interface Crucible {
	readonly id: string;
	readonly cmd: string;
	readonly cwd: string;
	/** 'fail' for an adversarial crucible: a broken copy that must be caught. */
	readonly expect?: 'pass' | 'fail';
	/** Files/folders this crucible depends on. Declared inputs make it reusable (delta); none means always re-run. */
	readonly inputs?: readonly string[];
}

export interface Item {
	readonly id: string;
	readonly what: string;
	readonly crucibles: readonly Crucible[];
}

export interface CrucibleResult {
	readonly id: string;
	readonly expect: 'pass' | 'fail';
	readonly verdict: 'pass' | 'fail' | 'could-not-run';
	readonly tests: number;
	readonly pass: number;
	readonly fail: number;
	readonly outputSha256: string;
	readonly note?: string;
	/** sha256 of node version + cmd + expect + every input file; null when inputs are undeclared or missing. */
	readonly fingerprint?: string | null;
	/** true when this result was taken from the previous run because the fingerprint matched. */
	readonly reused?: boolean;
}

export type Light = 'green' | 'yellow' | 'red';

export interface ItemLight {
	readonly item: string;
	readonly light: Light;
	readonly why: string;
	readonly has: {
		readonly crucibles: { readonly fn: typeof StoplightFn.runCrucible.address; readonly results: readonly CrucibleResult[] };
		readonly light: { readonly fn: typeof StoplightFn.light.address };
	};
}

export const StoplightPxC = {
	items: pxKey<readonly Item[]>('px.items'),
	results: (item: string) => pxKey<readonly CrucibleResult[]>(`px.crucibles.${item}`),
	lights: pxKey<readonly ItemLight[]>('px.lights'),
	/** Previous run's results by item, e.g. fetched from the published Page. Absent = no reuse. */
	previous: pxKey<Readonly<Record<string, readonly CrucibleResult[]>>>('px.previous'),
	/** Folder that inputs are relative to. */
	root: pxKey<string>('px.root')
} as const;

export const StoplightFn = {
	runCrucible: pxFn<Crucible, CrucibleResult>('fn.Crucible.run'),
	light: pxFn<{ results: readonly CrucibleResult[] }, { light: Light; why: string }>('fn.Stoplight.light'),
	fingerprint: pxFn<{ crucible: Crucible; root: string }, string | null>('fn.Crucible.fingerprint')
} as const;

const SKIP = new Set(['node_modules', 'stoplight.json', 'index.html']);
function files(path: string): string[] {
	if (!statSync(path).isDirectory()) return [path];
	return readdirSync(path).filter((name) => !SKIP.has(name)).flatMap((name) => files(join(path, name)));
}

/** The runner and classifier: any change to them invalidates every reused result. */
export const RUNNER_INPUTS = ['stoplight.ts', 'board.ts'] as const;

export const fingerprintCalculation = ({ crucible, root }: { crucible: Crucible; root: string }): string | null => {
	if (!crucible.inputs?.length) return null;
	const paths = [...new Set([...crucible.inputs, ...RUNNER_INPUTS])].map((input) => join(root, input));
	if (paths.some((path) => !existsSync(path))) return null;
	const config = [process.version, process.platform, process.arch, crucible.cmd, relative(root, crucible.cwd), crucible.expect ?? 'pass'];
	const hash = createHash('sha256').update(JSON.stringify(config));
	for (const file of paths.flatMap(files).sort()) {
		hash.update(`\0${relative(root, file)}\0`).update(readFileSync(file));
	}
	return hash.digest('hex');
};

const count = (out: string, key: string): number | null => {
	const match = out.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
	return match ? Number(match[1]) : null;
};

export const runCrucibleCalculation = (crucible: Crucible): CrucibleResult => {
	if (!existsSync(crucible.cwd)) {
		return { id: crucible.id, expect: crucible.expect ?? 'pass', verdict: 'could-not-run', tests: 0, pass: 0, fail: 0, outputSha256: '', note: `not present here: ${crucible.cwd}` };
	}
	// A clean env: an inherited NODE_TEST_CONTEXT would switch a nested `node --test` away from TAP counts.
	const { NODE_TEST_CONTEXT: _ignored, ...env } = process.env;
	const run = spawnSync(crucible.cmd, { cwd: crucible.cwd, shell: true, encoding: 'utf8', maxBuffer: 64 << 20, env });
	const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
	const tests = count(out, 'tests'), pass = count(out, 'pass'), fail = count(out, 'fail');
	const cancelled = count(out, 'cancelled') ?? 0;
	const expect = crucible.expect ?? 'pass';
	const base = { id: crucible.id, expect, outputSha256: createHash('sha256').update(out).digest('hex') };
	const unrun = (note: string): CrucibleResult =>
		({ ...base, verdict: 'could-not-run', tests: tests ?? 0, pass: pass ?? 0, fail: fail ?? 0, note });
	// Anything short of a complete, consistent run proves nothing either way.
	if (run.error) return unrun(run.error.message);
	if (run.signal) return unrun(`killed by ${run.signal}`);
	if (tests === null || pass === null || fail === null || tests === 0) return unrun('no test counts in output');
	if (/ERR_MODULE_NOT_FOUND/.test(out)) return unrun('missing module (environment, not code)');
	if (cancelled > 0) return unrun(`${cancelled} test(s) cancelled; the run is incomplete`);
	if (fail === 0 && run.status !== 0) return unrun(`exit ${run.status} with no failing test`);
	if (fail > 0 && run.status === 0) return unrun('failing tests but exit 0');
	// A broken copy is only "caught" if the suite otherwise ran: every test failing looks like a crash.
	if (expect === 'fail' && fail > 0 && pass === 0) return unrun('every test failed; cannot tell a caught copy from a crash');
	return { ...base, verdict: fail > 0 ? 'fail' : 'pass', tests, pass, fail };
};

export const lightCalculation = ({ results }: { results: readonly CrucibleResult[] }): { light: Light; why: string } => {
	if (results.length === 0) return { light: 'yellow', why: 'no crucible yet' };
	const wrong = results.filter((r) => r.verdict !== 'could-not-run' && r.verdict !== r.expect);
	if (wrong.length) return { light: 'red', why: wrong.map((r) => `${r.id}: expected ${r.expect}, got ${r.verdict} (${r.fail}/${r.tests} failed)`).join('; ') };
	const unrun = results.filter((r) => r.verdict === 'could-not-run');
	if (unrun.length) return { light: 'yellow', why: unrun.map((r) => `${r.id} could not run: ${r.note}`).join('; ') };
	return { light: 'green', why: results.map((r) => `${r.id}: ${r.pass}/${r.tests} pass${r.expect === 'fail' ? ' — broken copy caught' : ''}${r.reused ? ' (reused)' : ''}`).join('; ') };
};

export interface StoplightImpl {
	readonly runCrucible: typeof runCrucibleCalculation;
	readonly light: typeof lightCalculation;
	readonly fingerprint?: typeof fingerprintCalculation;
}

export function registerStoplight(pxc: PxC, impl: StoplightImpl = { runCrucible: runCrucibleCalculation, light: lightCalculation }): void {
	pxc.register(StoplightFn.runCrucible, impl.runCrucible);
	pxc.register(StoplightFn.light, impl.light);
	pxc.register(StoplightFn.fingerprint, impl.fingerprint ?? fingerprintCalculation);
}

/**
 * Stage 1: run every crucible into px.crucibles.<item>. Skip it by injecting those addresses.
 * Delta: a crucible whose fingerprint matches the previous run's result is reused, not re-run.
 * A previous result that could not run is never reused.
 */
export function runCrucibles(pxc: PxC): void {
	const root = pxc.has(StoplightPxC.root) ? pxc.get(StoplightPxC.root) : '.';
	const previous = pxc.has(StoplightPxC.previous) ? pxc.get(StoplightPxC.previous) : {};
	for (const item of pxc.get(StoplightPxC.items)) {
		if (pxc.has(StoplightPxC.results(item.id))) continue;
		pxc.set(StoplightPxC.results(item.id), item.crucibles.map((c): CrucibleResult => {
			const fingerprint = pxc.call(StoplightFn.fingerprint, { crucible: c, root });
			const prior = previous[item.id]?.find((r) => r.id === c.id);
			if (fingerprint && prior?.fingerprint === fingerprint && prior.verdict !== 'could-not-run') {
				return { ...prior, reused: true };
			}
			return { ...pxc.call(StoplightFn.runCrucible, c), fingerprint, reused: false };
		}));
	}
}

/** Stage 2: crucible results -> one light per item, each carrying how it was made. */
export function computeLights(pxc: PxC): readonly ItemLight[] {
	const lights = pxc.get(StoplightPxC.items).map((item): ItemLight => {
		const results = pxc.get(StoplightPxC.results(item.id));
		const { light, why } = pxc.call(StoplightFn.light, { results });
		return {
			item: item.id, light, why,
			has: { crucibles: { fn: StoplightFn.runCrucible.address, results }, light: { fn: StoplightFn.light.address } }
		};
	});
	pxc.set(StoplightPxC.lights, lights);
	return lights;
}
