import { createExperience } from './model.ts';
import { archive } from './persistence.ts';
import { createFreshSession } from './session-storage.ts';

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

export async function openExperience(storage: Pick<Storage, 'getItem' | 'setItem'>, log?: (event: Record<string, unknown>) => void) {
  let status = 'Fresh session · saved discs stay on this browser for future recovery.';
  const session = createFreshSession();
  let setupError: unknown = session.ok ? null : session.error;
  if (!session.ok) status = `Storage setup failed: ${session.error.message} New work cannot be saved locally.`;
  try {
    // Touch only the new session's storage path. A legacy archive and every
    // prior session remain untouched and intentionally hidden from this MVP.
    if (session.ok) storage.getItem(session.session.currentKey);
  } catch (error) {
    setupError = error;
    status = isRecoverableStorageFailure(error) ? sessionOnlyStatus(error) : `Storage setup failed: ${String(error)} New work cannot be saved locally.`;
  }
  const experience = createExperience(log, { status: () => status, persist(next) {
    if (!session.ok || (setupError && !isRecoverableStorageFailure(setupError))) throw Error(status);
    // Serialization is deliberately outside the recoverable storage boundary:
    // an invalid archive is a save failure, never a session-only success.
    let raw: string;
    try { raw = archive(next); }
    catch (error) { status = `Not saved locally: ${String(error)} Existing session archives were not replaced.`; throw Error(status); }
    try {
      storage.setItem(session.session.currentKey, raw);
      setupError = null;
      status = 'Saved in this session archive · previous sessions remain retained but hidden.';
    } catch (error) {
      if (!isRecoverableStorageFailure(error)) { status = `Not saved locally: ${String(error)} Existing session archives were not replaced.`; throw Error(status); }
      status = sessionOnlyStatus(error);
    }
  } });
  return experience;
}
