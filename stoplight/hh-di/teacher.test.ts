// inject -> run ONE step -> assert. Each test builds a fresh board, injects
// the starting state straight into px.teachers.* addresses (skipping earlier
// steps), runs one Teacher step, and asserts the end state and `has`.
// HH_IMPL=reference|mutantA|mutantB|mutantC picks the calculations under test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createExecBoard, type PxC } from '../board.ts';
import { selectedCalculations } from './mutants.ts';
import {
	registerTeacher,
	Teacher,
	TeacherPxC,
	type ApprovedUser,
	type PendingUser,
	type TeacherProfile,
	type TodPick
} from './teacher.ts';

const IMPL = process.env.HH_IMPL ?? 'reference';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 2);
const A = { state: 'TX', county: 'Travis', district: 'Austin ISD' };
const B = { state: 'TX', county: 'Travis', district: 'Eanes ISD' };

function board(): PxC {
	const pxc = createExecBoard();
	registerTeacher(pxc, selectedCalculations(IMPL));
	return pxc;
}
const pending = (email: string, loc = A): PendingUser => ({
	name: email.split('@')[0], email, school: 'Lincoln El', ...loc,
	has: { register: { fn: 'fn.Teacher.register' } }
});
const approved = (email: string, loc = A): ApprovedUser => ({
	...pending(email, loc),
	has: { register: { fn: 'fn.Teacher.register' }, approve: { fn: 'fn.Teacher.approve', by: { role: 'admin' } } }
});
const profile = (email: string, loc = A, lastTod: number | null = null): TeacherProfile => ({
	email, name: email.split('@')[0], school: 'Lincoln El', ...loc, aboutMe: '', lastTod,
	wishlistUrl: 'https://www.amazon.com/hz/wishlist/ls/X1?tag=h0mer00mher0-20',
	has: { location: { fn: 'fn.Teacher.approve' }, createProfile: { fn: 'fn.Teacher.createProfile', wishlistInput: '' } }
});
const emails = (pxc: PxC, key: { address: string }) =>
	pxc.has(key) ? pxc.get<readonly { email: string }[]>(key).map((u) => u.email) : [];

// ---- ordinary passing cases -------------------------------------------------

test('register: new email lands in px.teachers.pending with has.register', () => {
	const pxc = board();
	pxc.set(TeacherPxC.pending, []);
	pxc.set(TeacherPxC.approved, []);
	const out = Teacher.register(pxc, { name: 'Ann', email: 'ann@x.org', school: 'Lincoln El', ...A });
	assert.equal(out.ok, true);
	assert.deepEqual(emails(pxc, TeacherPxC.pending), ['ann@x.org']);
	assert.deepEqual(pxc.get(TeacherPxC.pending)[0].has, { register: { fn: 'fn.Teacher.register' } });
});

test('register: duplicate email (pending or approved) is refused, state unchanged', () => {
	for (const where of ['pending', 'approved'] as const) {
		const pxc = board();
		pxc.set(TeacherPxC.pending, where === 'pending' ? [pending('dup@x.org')] : []);
		pxc.set(TeacherPxC.approved, where === 'approved' ? [approved('dup@x.org')] : []);
		const out = Teacher.register(pxc, { name: 'D', email: 'dup@x.org', school: 'S', ...A });
		assert.equal(out.ok, false, `duplicate in ${where} must be refused`);
		assert.deepEqual(emails(pxc, TeacherPxC.pending), where === 'pending' ? ['dup@x.org'] : []);
	}
});

test('approve: same-district teacher moves user pending -> approved; admin approves anyone', () => {
	const pxc = board();
	pxc.set(TeacherPxC.pending, [pending('new@x.org', A), pending('far@x.org', B)]);
	pxc.set(TeacherPxC.approved, [approved('t@x.org', A)]);
	pxc.set(TeacherPxC.profiles, [profile('t@x.org', A)]);
	const out = Teacher.approve(pxc, { role: 'teacher', email: 't@x.org' }, 'new@x.org');
	assert.equal(out.ok, true);
	assert.deepEqual(emails(pxc, TeacherPxC.pending), ['far@x.org']);
	assert.deepEqual(emails(pxc, TeacherPxC.approved), ['t@x.org', 'new@x.org']);
	assert.deepEqual(pxc.get(TeacherPxC.approved)[1].has.approve, {
		fn: 'fn.Teacher.approve', by: { role: 'teacher', email: 't@x.org' }
	});

	const admin = board();
	admin.set(TeacherPxC.pending, [pending('far@x.org', B)]);
	admin.set(TeacherPxC.approved, []);
	assert.equal(Teacher.approve(admin, { role: 'admin' }, 'far@x.org').ok, true);
	assert.deepEqual(emails(admin, TeacherPxC.pending), []);
});

test('createProfile: once per account; Amazon wishlist gets the affiliate tag', () => {
	const pxc = board();
	pxc.set(TeacherPxC.approved, [approved('t@x.org', A)]);
	pxc.set(TeacherPxC.profiles, []);
	const input = { email: 't@x.org', aboutMe: 'hi', wishlist: 'https://www.amazon.com/hz/wishlist/ls/3ABC?ref_=wl_share' };
	const out = Teacher.createProfile(pxc, input);
	assert.equal(out.ok, true);
	const [p] = pxc.get(TeacherPxC.profiles);
	assert.equal(new URL(p.wishlistUrl).searchParams.get('tag'), 'h0mer00mher0-20');
	assert.equal(new URL(p.wishlistUrl).searchParams.get('ref_'), 'wl_share');
	assert.equal(p.has.createProfile.fn, 'fn.Teacher.createProfile');

	const again = board();
	again.set(TeacherPxC.approved, [approved('t@x.org', A)]);
	again.set(TeacherPxC.profiles, [p]);
	assert.equal(Teacher.createProfile(again, input).ok, false, 'second profile must be refused');
	assert.equal(again.get(TeacherPxC.profiles).length, 1);
});

test('pickOfDay: picks a never/long-ago featured teacher and stamps lastTod', () => {
	const pxc = board();
	pxc.set(TeacherPxC.now, NOW);
	pxc.set(TeacherPxC.profiles, [profile('recent@x.org', A, NOW - 10 * DAY), profile('old@x.org', A, NOW - 200 * DAY)]);
	const pick = Teacher.pickOfDay(pxc);
	assert.deepEqual(pick, { kind: 'picked', email: 'old@x.org', has: { fn: 'fn.Teacher.pickOfDay' } });
	const old = pxc.get(TeacherPxC.profiles).find((p) => p.email === 'old@x.org')!;
	assert.equal(old.lastTod, NOW);
	assert.deepEqual(old.has.pickOfDay, { fn: 'fn.Teacher.pickOfDay', at: NOW });
});

// ---- (A) district must come from the approved record ------------------------

test('(A) profile retyped to district B cannot approve a district-B pending user', () => {
	const pxc = board();
	// Approved in A; profile (as the live site would have stored it) lists B.
	pxc.set(TeacherPxC.approved, [approved('t@x.org', A)]);
	pxc.set(TeacherPxC.profiles, [profile('t@x.org', B)]);
	pxc.set(TeacherPxC.pending, [pending('stranger@x.org', B)]);
	const out = Teacher.approve(pxc, { role: 'teacher', email: 't@x.org' }, 'stranger@x.org');
	assert.equal(out.ok, false, 'approval across districts must be refused');
	assert.deepEqual(emails(pxc, TeacherPxC.pending), ['stranger@x.org']);
	assert.deepEqual(emails(pxc, TeacherPxC.approved), ['t@x.org']);
});

test('(A) createProfile cannot retype the district away from the approved record', () => {
	const pxc = board();
	pxc.set(TeacherPxC.approved, [approved('t@x.org', A)]);
	pxc.set(TeacherPxC.profiles, []);
	Teacher.createProfile(pxc, {
		email: 't@x.org', aboutMe: '', wishlist: 'https://www.amazon.com/hz/wishlist/ls/3ABC', location: B
	});
	for (const p of pxc.get(TeacherPxC.profiles)) {
		assert.equal(p.district, A.district, 'stored district must equal the approved record');
		assert.equal(p.has.location.fn, 'fn.Teacher.approve', 'location provenance must be the approval');
	}
});

// ---- (B) wishlist validation and tagging ------------------------------------

test('(B) a non-Amazon-wishlist URL is refused', () => {
	for (const wishlist of ['https://evil.example.com/phish', 'https://www.amazon.com/dp/B000123', 'not a url']) {
		const pxc = board();
		pxc.set(TeacherPxC.approved, [approved('t@x.org', A)]);
		pxc.set(TeacherPxC.profiles, []);
		const out = Teacher.createProfile(pxc, { email: 't@x.org', aboutMe: '', wishlist });
		assert.equal(out.ok, false, `${wishlist} must be refused`);
		assert.deepEqual(pxc.get(TeacherPxC.profiles), []);
	}
});

test('(B) tagging a wishlist URL with no "?" still yields a valid URL with tag param', () => {
	const pxc = board();
	pxc.set(TeacherPxC.approved, [approved('t@x.org', A)]);
	pxc.set(TeacherPxC.profiles, []);
	const out = Teacher.createProfile(pxc, { email: 't@x.org', aboutMe: '', wishlist: 'https://www.amazon.com/hz/wishlist/ls/3ABC' });
	assert.equal(out.ok, true);
	const url = new URL(pxc.get(TeacherPxC.profiles)[0].wishlistUrl);
	assert.equal(url.pathname, '/hz/wishlist/ls/3ABC');
	assert.equal(url.searchParams.get('tag'), 'h0mer00mher0-20');
});

// ---- (C) Teacher of the Day must terminate ----------------------------------

function pickInWorker(profiles: TeacherProfile[], ms: number): Promise<{ pick: TodPick } | 'timeout'> {
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL('./pick-worker.ts', import.meta.url), {
			workerData: { impl: IMPL, now: NOW, profiles }
		});
		const timer = setTimeout(() => {
			void worker.terminate();
			resolve('timeout');
		}, ms);
		worker.once('message', (m) => { clearTimeout(timer); void worker.terminate(); resolve(m); });
		worker.once('error', (e) => { clearTimeout(timer); reject(e); });
	});
}

test('(C) everyone featured within 90 days: pickOfDay returns none-eligible, no loop', { timeout: 5000 }, async () => {
	const profiles = [profile('a@x.org', A, NOW - 1 * DAY), profile('b@x.org', A, NOW - 89 * DAY)];
	const result = await pickInWorker(profiles, 2000);
	assert.notEqual(result, 'timeout', 'pickOfDay did not return within 2s (infinite loop)');
	assert.deepEqual((result as { pick: TodPick }).pick, { kind: 'none-eligible', has: { fn: 'fn.Teacher.pickOfDay' } });
});
