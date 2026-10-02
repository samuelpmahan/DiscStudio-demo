// Mutant copies of the reference: each replaces ONE behaviour with what the
// live site (Engsmallz/hithero app.py) does, so the matching test must go red.

import { AFFILIATE_TAG, makeCreateProfile, referenceCalculations, type TeacherCalculations } from './teacher.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const sameLoc = (a: { state: string; county: string; district: string }, b: typeof a) =>
	a.state === b.state && a.county === b.county && a.district === b.district;

/** A: move_user checks the approver's TeacherList profile, and create_teacher_profile stores the retyped district. */
export const mutantA: TeacherCalculations = {
	...referenceCalculations,
	approve: (args) => {
		const { actor, email, pending } = args;
		const user = pending.find((u) => u.email === email);
		if (!user) return { ok: false, reason: 'not pending' };
		if (actor.role === 'teacher') {
			const profile = args.profiles.find((p) => p.email === actor.email);
			if (!profile || !sameLoc(profile, user)) return { ok: false, reason: 'outside approver district' };
		}
		return { ok: true, user: { ...user, has: { ...user.has, approve: { fn: 'fn.Teacher.approve', by: actor } } } };
	},
	createProfile: (args) => {
		const { location, ...rest } = args.input;
		const out = referenceCalculations.createProfile({ ...args, input: rest });
		if (!out.ok || !location) return out;
		return { ok: true, profile: { ...out.profile, ...location, has: { ...out.profile.has, location: { fn: 'fn.Teacher.createProfile' } } } };
	}
};

/** B: aa_link = wishlist + "&tag=h0mer00mher0-20", no validation. */
export const mutantB: TeacherCalculations = {
	...referenceCalculations,
	createProfile: makeCreateProfile((raw) => raw + '&tag=' + AFFILIATE_TAG)
};

/** C: fetch_teacher_for_tod: draw a random teacher until one is eligible; `while True` with no exit. */
export const mutantC: TeacherCalculations = {
	...referenceCalculations,
	pickOfDay: ({ profiles, now }) => {
		const cutoff = now - 90 * DAY_MS;
		const has = { fn: 'fn.Teacher.pickOfDay' } as const;
		while (true) {
			if (profiles.length === 0) return { kind: 'none-eligible', has };
			const candidate = profiles[Math.floor(Math.random() * profiles.length)];
			if (candidate.lastTod === null || candidate.lastTod < cutoff) return { kind: 'picked', email: candidate.email, has };
		}
	}
};

export const IMPLS: Record<string, TeacherCalculations> = {
	reference: referenceCalculations,
	mutantA,
	mutantB,
	mutantC
};

/** HH_IMPL=reference|mutantA|mutantB|mutantC selects what the tests run against. */
export function selectedCalculations(name = process.env.HH_IMPL ?? 'reference'): TeacherCalculations {
	const calcs = IMPLS[name];
	if (!calcs) throw new Error(`HH_IMPL '${name}' unknown; use one of ${Object.keys(IMPLS).join(', ')}`);
	return calcs;
}
