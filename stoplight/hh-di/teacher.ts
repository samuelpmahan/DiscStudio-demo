// Homeroom Heroes teacher flow, reference version, in the Basket.ts style:
// typed board addresses (TeacherPxC), named calculations (TeacherFn), pure
// fn.* calculations registered on a PxC, and step functions that read the
// board, call one fn, and write the board. Every object carries `has`,
// naming the fn that produced each piece.

import { pxFn, pxKey, type PxC } from '../board.ts';

export const AFFILIATE_TAG = 'h0mer00mher0-20';
export const TOD_COOLDOWN_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Location {
	readonly state: string;
	readonly county: string;
	readonly district: string;
}

export interface RegisterInput extends Location {
	readonly name: string;
	readonly email: string;
	readonly school: string;
}

export type Actor = { readonly role: 'admin' } | { readonly role: 'teacher'; readonly email: string };

export interface PendingUser extends RegisterInput {
	readonly has: { readonly register: { readonly fn: 'fn.Teacher.register' } };
}

export interface ApprovedUser extends RegisterInput {
	readonly has: {
		readonly register: { readonly fn: 'fn.Teacher.register' };
		readonly approve: { readonly fn: 'fn.Teacher.approve'; readonly by: Actor };
	};
}

export interface ProfileInput {
	readonly email: string;
	readonly aboutMe: string;
	readonly wishlist: string;
	/** Optional retyped location. The reference refuses it if it differs from the approved record. */
	readonly location?: Location;
}

export interface TeacherProfile extends Location {
	readonly email: string;
	readonly name: string;
	readonly school: string;
	readonly aboutMe: string;
	readonly wishlistUrl: string;
	readonly lastTod: number | null;
	readonly has: {
		readonly location: { readonly fn: 'fn.Teacher.approve' | 'fn.Teacher.createProfile' };
		readonly createProfile: { readonly fn: 'fn.Teacher.createProfile'; readonly wishlistInput: string };
		readonly pickOfDay?: { readonly fn: 'fn.Teacher.pickOfDay'; readonly at: number };
	};
}

export type TodPick =
	| { readonly kind: 'picked'; readonly email: string; readonly has: { readonly fn: 'fn.Teacher.pickOfDay' } }
	| { readonly kind: 'none-eligible'; readonly has: { readonly fn: 'fn.Teacher.pickOfDay' } };

export type Refusal = { readonly ok: false; readonly reason: string };
export type Outcome<T> = ({ readonly ok: true } & T) | Refusal;

export const TeacherPxC = {
	pending: pxKey<readonly PendingUser[]>('px.teachers.pending'),
	approved: pxKey<readonly ApprovedUser[]>('px.teachers.approved'),
	profiles: pxKey<readonly TeacherProfile[]>('px.teachers.profiles'),
	ofDay: pxKey<TodPick>('px.teachers.ofDay'),
	now: pxKey<number>('px.clock.now')
} as const;

interface RegisterArgs {
	readonly pending: readonly PendingUser[];
	readonly approved: readonly ApprovedUser[];
	readonly input: RegisterInput;
}
interface ApproveArgs {
	readonly actor: Actor;
	readonly email: string;
	readonly pending: readonly PendingUser[];
	readonly approved: readonly ApprovedUser[];
	readonly profiles: readonly TeacherProfile[];
}
interface CreateProfileArgs {
	readonly approved: readonly ApprovedUser[];
	readonly profiles: readonly TeacherProfile[];
	readonly input: ProfileInput;
}
interface PickArgs {
	readonly profiles: readonly TeacherProfile[];
	readonly now: number;
}

export const TeacherFn = {
	register: pxFn<RegisterArgs, Outcome<{ user: PendingUser }>>('fn.Teacher.register'),
	approve: pxFn<ApproveArgs, Outcome<{ user: ApprovedUser }>>('fn.Teacher.approve'),
	createProfile: pxFn<CreateProfileArgs, Outcome<{ profile: TeacherProfile }>>('fn.Teacher.createProfile'),
	pickOfDay: pxFn<PickArgs, TodPick>('fn.Teacher.pickOfDay')
} as const;

export interface TeacherCalculations {
	register(args: RegisterArgs): Outcome<{ user: PendingUser }>;
	approve(args: ApproveArgs): Outcome<{ user: ApprovedUser }>;
	createProfile(args: CreateProfileArgs): Outcome<{ profile: TeacherProfile }>;
	pickOfDay(args: PickArgs): TodPick;
}

const refuse = (reason: string): Refusal => ({ ok: false, reason });
const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const sameLocation = (a: Location, b: Location) =>
	a.state === b.state && a.county === b.county && a.district === b.district;

/** Amazon wishlist only; returns the URL with tag set via URLSearchParams, or null. */
export function tagWishlist(raw: string): string | null {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return null;
	}
	const amazonHost = /^(www\.|smile\.)?amazon\.[a-z.]{2,6}$/i.test(url.hostname);
	const wishlistPath = /^\/(hz\/wishlist\/ls|registry\/wishlist|gp\/registry\/wishlist)\/[A-Za-z0-9]+/.test(url.pathname);
	if (url.protocol !== 'https:' || !amazonHost || !wishlistPath) return null;
	url.searchParams.set('tag', AFFILIATE_TAG);
	return url.toString();
}

/** createProfile with a pluggable wishlist tagger (the reference uses tagWishlist). */
export function makeCreateProfile(tag: (raw: string) => string | null): TeacherCalculations['createProfile'] {
	return ({ approved, profiles, input }) => {
		const account = approved.find((u) => sameEmail(u.email, input.email));
		if (!account) return refuse('not an approved account');
		if (profiles.some((p) => sameEmail(p.email, input.email))) return refuse('profile already created');
		if (input.location && !sameLocation(input.location, account)) return refuse('location differs from approved record');
		const wishlistUrl = tag(input.wishlist);
		if (!wishlistUrl) return refuse('wishlist is not an Amazon wishlist URL');
		return {
			ok: true,
			profile: {
				email: account.email,
				name: account.name,
				school: account.school,
				state: account.state,
				county: account.county,
				district: account.district,
				aboutMe: input.aboutMe,
				wishlistUrl,
				lastTod: null,
				has: {
					location: { fn: 'fn.Teacher.approve' },
					createProfile: { fn: 'fn.Teacher.createProfile', wishlistInput: input.wishlist }
				}
			}
		};
	};
}

export const referenceCalculations: TeacherCalculations = {
	register: ({ pending, approved, input }) => {
		if (pending.some((u) => sameEmail(u.email, input.email))) return refuse('email already pending');
		if (approved.some((u) => sameEmail(u.email, input.email))) return refuse('email already approved');
		return { ok: true, user: { ...input, has: { register: { fn: 'fn.Teacher.register' } } } };
	},

	approve: ({ actor, email, pending, approved }) => {
		const user = pending.find((u) => sameEmail(u.email, email));
		if (!user) return refuse('not pending');
		if (actor.role === 'teacher') {
			// The approver's district comes from the APPROVED record, never from the profile.
			const approver = approved.find((u) => sameEmail(u.email, actor.email));
			if (!approver) return refuse('approver is not an approved teacher');
			if (!sameLocation(approver, user)) return refuse('outside approver district');
		}
		return {
			ok: true,
			user: { ...user, has: { ...user.has, approve: { fn: 'fn.Teacher.approve', by: actor } } }
		};
	},

	createProfile: makeCreateProfile(tagWishlist),

	pickOfDay: ({ profiles, now }) => {
		const cutoff = now - TOD_COOLDOWN_DAYS * DAY_MS;
		const eligible = profiles
			.filter((p) => p.lastTod === null || p.lastTod < cutoff)
			.sort((a, b) => (a.lastTod ?? -Infinity) - (b.lastTod ?? -Infinity) || a.email.localeCompare(b.email));
		const has = { fn: 'fn.Teacher.pickOfDay' } as const;
		return eligible[0] ? { kind: 'picked', email: eligible[0].email, has } : { kind: 'none-eligible', has };
	}
};

export function registerTeacher(pxc: PxC, calcs: TeacherCalculations = referenceCalculations): void {
	pxc.register(TeacherFn.register, calcs.register);
	pxc.register(TeacherFn.approve, calcs.approve);
	pxc.register(TeacherFn.createProfile, calcs.createProfile);
	pxc.register(TeacherFn.pickOfDay, calcs.pickOfDay);
}

const list = <T>(pxc: PxC, key: { address: string }): readonly T[] =>
	pxc.has(key) ? pxc.get<readonly T[]>(key) : [];

/** Steps: read board, call ONE fn, write board. */
export const Teacher = {
	register(pxc: PxC, input: RegisterInput) {
		const out = pxc.call(TeacherFn.register, {
			pending: list<PendingUser>(pxc, TeacherPxC.pending),
			approved: list<ApprovedUser>(pxc, TeacherPxC.approved),
			input
		});
		if (out.ok) pxc.set(TeacherPxC.pending, [...list<PendingUser>(pxc, TeacherPxC.pending), out.user]);
		return out;
	},

	approve(pxc: PxC, actor: Actor, email: string) {
		const pending = list<PendingUser>(pxc, TeacherPxC.pending);
		const out = pxc.call(TeacherFn.approve, {
			actor,
			email,
			pending,
			approved: list<ApprovedUser>(pxc, TeacherPxC.approved),
			profiles: list<TeacherProfile>(pxc, TeacherPxC.profiles)
		});
		if (out.ok) {
			pxc.set(TeacherPxC.pending, pending.filter((u) => !sameEmail(u.email, email)));
			pxc.set(TeacherPxC.approved, [...list<ApprovedUser>(pxc, TeacherPxC.approved), out.user]);
		}
		return out;
	},

	createProfile(pxc: PxC, input: ProfileInput) {
		const out = pxc.call(TeacherFn.createProfile, {
			approved: list<ApprovedUser>(pxc, TeacherPxC.approved),
			profiles: list<TeacherProfile>(pxc, TeacherPxC.profiles),
			input
		});
		if (out.ok) pxc.set(TeacherPxC.profiles, [...list<TeacherProfile>(pxc, TeacherPxC.profiles), out.profile]);
		return out;
	},

	pickOfDay(pxc: PxC): TodPick {
		const now = pxc.get(TeacherPxC.now);
		const profiles = list<TeacherProfile>(pxc, TeacherPxC.profiles);
		const pick = pxc.call(TeacherFn.pickOfDay, { profiles, now });
		pxc.set(TeacherPxC.ofDay, pick);
		if (pick.kind === 'picked') {
			pxc.set(
				TeacherPxC.profiles,
				profiles.map((p) =>
					p.email === pick.email
						? { ...p, lastTod: now, has: { ...p.has, pickOfDay: { fn: 'fn.Teacher.pickOfDay', at: now } } }
						: p
				)
			);
		}
		return pick;
	}
};
