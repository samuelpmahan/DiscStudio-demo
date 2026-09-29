import { createExperience } from './model.ts';
import { archive, restore, type State } from './persistence.ts';
import { activeSessionKey, createFreshSession, sessionKeyPrefix } from './session-storage.ts';

/** Browser storage can reject writes because it is full or unavailable in a
 * privacy-restricted context. Those two platform failures leave a fully valid
 * PxC save useful in this tab; all other errors remain save failures. */
export function isRecoverableStorageFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === 'QuotaExceededError' || name === 'SecurityError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

function sessionOnlyStatus(error: unknown) {
  const name = error && typeof error === 'object' ? (error as { name?: unknown }).name : undefined;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
    ? 'Browser storage is full. New work is available in this session only. Export your cards before refreshing or closing this page.'
    : 'Browser storage is unavailable. New work is available in this session only. Export your cards before refreshing or closing this page.';
}

type BrowserStore = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'key' | 'length'>>;

/** Older releases left every archive intact but did not record which was active.
 * Recover a sole archive; multiple independent sessions require an explicit
 * choice and are never guessed from UUID order. */
function solePriorSession(storage: BrowserStore): string | null {
  if (typeof storage.key !== 'function' || typeof storage.length !== 'number') return null;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(sessionKeyPrefix)) keys.push(key);
  }
  return keys.length === 1 ? keys[0] : null;
}

export async function openExperience(storage: BrowserStore, log?: (event: Record<string, unknown>) => void) {
  let status = 'Fresh Bag · saved discs reopen after reload. Approved output is current-session only.';
  const session = createFreshSession();
  let currentKey = session.ok ? session.session.currentKey : null;
  let setupError: unknown = session.ok ? null : session.error;
  let state: State | undefined;
  let pointerMatches = false;
  if (!session.ok) status = `Storage setup failed: ${session.error.message} New work cannot be saved locally.`;
  try {
    const pointer = storage.getItem(activeSessionKey);
    if (pointer !== null && !pointer.startsWith(sessionKeyPrefix)) throw Error('Invalid active Bag pointer.');
    const candidate = pointer ?? solePriorSession(storage);
    if (candidate) {
      const raw = storage.getItem(candidate);
      if (!raw) throw Error('Active Bag archive is missing.');
      state = await restore(raw, createExperience(() => {}).pxc);
      currentKey = candidate;
      pointerMatches = candidate === pointer;
      setupError = null;
      status = 'Restored Today’s Bag from this browser. Approved output starts empty after reload.';
    }
  } catch (error) {
    if (isRecoverableStorageFailure(error)) { setupError = error; status = sessionOnlyStatus(error); }
    else if (session.ok) { status = `Saved Bag could not be reopened: ${String(error)} Prior archives remain untouched; new work starts fresh.`; }
    else { setupError = error; status = `Storage setup failed: ${String(error)} New work cannot be saved locally.`; }
  }
  const experience = createExperience(log, { state, status: () => status, persist(next) {
    if (!currentKey || (setupError && !isRecoverableStorageFailure(setupError))) throw Error(status);
    // Serialization is deliberately outside the recoverable storage boundary:
    // an invalid archive is a save failure, never a session-only success.
    let raw: string;
    try { raw = archive(next); }
    catch (error) { status = `Not saved locally: ${String(error)} Existing session archives were not replaced.`; throw Error(status); }
    try {
      storage.setItem(currentKey, raw);
      setupError = null;
      status = 'Saved on this browser · Today’s Bag reopens after reload. Approved output is current-session only.';
      if (!pointerMatches) {
        try { storage.setItem(activeSessionKey, currentKey); pointerMatches = true; }
        catch (error) { status = `Bag archive saved, but automatic reopen is unavailable: ${String(error)}. Export before reloading.`; }
      }
    } catch (error) {
      if (!isRecoverableStorageFailure(error)) { status = `Not saved locally: ${String(error)} Existing session archives were not replaced.`; throw Error(status); }
      status = sessionOnlyStatus(error);
    }
  } });
  return experience;
}
