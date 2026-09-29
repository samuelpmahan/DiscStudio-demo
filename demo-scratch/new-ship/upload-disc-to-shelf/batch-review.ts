import { queueCards, type QueuedCard } from './export-queue-core.ts';
import type { CardOrientation, CardPreset } from './browser-card-renderer.ts';

export type SavedCardSetup = Readonly<{ version: 1; name: string; preset: CardPreset; orientation: CardOrientation; placement: Readonly<{ scale: number; dx: number; dy: number }> }>;
export type CandidateState = 'rendering' | 'checking' | 'ready' | 'approved' | 'needs-adjustment';
export type ReviewCandidate = Readonly<{ id: string; card: QueuedCard; state: CandidateState; reason?: string }>;
export const CARD_SETUP_STORAGE_KEY = 'discstudio.card-setup.v1';

export function validateSavedSetup(value: unknown): SavedCardSetup {
  const setup = value as any, placement = setup?.placement;
  if (!setup || setup.version !== 1 || typeof setup.name !== 'string' || !setup.name.trim()) throw Error('Saved setup needs a name.');
  if (!['vertical', 'horizontal'].includes(setup.orientation)) throw Error('Saved setup has an invalid orientation.');
  if (typeof setup.preset !== 'string' || !/^[ub]0[1-5]$/.test(setup.preset) || (setup.orientation === 'vertical' ? setup.preset[0] !== 'u' : setup.preset[0] !== 'b')) throw Error('Saved setup has an invalid card layout.');
  if (!placement || ![placement.scale, placement.dx, placement.dy].every(Number.isFinite) || placement.scale < .5 || placement.scale > 1.5 || Math.abs(placement.dx) > 1 || Math.abs(placement.dy) > 1) throw Error('Saved setup has an invalid placement.');
  return Object.freeze({ version: 1, name: setup.name.trim(), preset: setup.preset, orientation: setup.orientation, placement: Object.freeze({ scale: placement.scale, dx: placement.dx, dy: placement.dy }) });
}
export function loadSavedSetup(storage: Pick<Storage, 'getItem'> | null | undefined): SavedCardSetup | null {
  try { const raw = storage?.getItem(CARD_SETUP_STORAGE_KEY); return raw ? validateSavedSetup(JSON.parse(raw)) : null; } catch { return null; }
}
export function storeSavedSetup(storage: Pick<Storage, 'setItem'>, setup: unknown): SavedCardSetup {
  const valid = validateSavedSetup(setup); storage.setItem(CARD_SETUP_STORAGE_KEY, JSON.stringify(valid)); return valid;
}
export function makeReviewCandidates(cards: readonly QueuedCard[]): readonly ReviewCandidate[] {
  return queueCards(cards).map((card, index) => Object.freeze({ id: `${card.disc.id}:${index}`, card, state: 'rendering' }));
}
export function transitionCandidate(candidates: readonly ReviewCandidate[], id: string, state: CandidateState, reason?: string): readonly ReviewCandidate[] {
  return candidates.map(candidate => candidate.id !== id || candidate.state === 'approved' ? candidate : Object.freeze({ ...candidate, state, ...(reason ? { reason } : {}) }));
}
export function pendingCards(candidates: readonly ReviewCandidate[]): readonly QueuedCard[] { return candidates.filter(candidate => candidate.state === 'ready').map(candidate => candidate.card); }
