import { createExperience } from './model.ts';
import { archive } from './persistence.ts';
import { createFreshSession } from './session-storage.ts';

export async function openExperience(storage: Pick<Storage, 'getItem' | 'setItem'>, log?: (event: Record<string, unknown>) => void) {
  let status = 'Fresh session · saved discs stay on this browser for future recovery.', blocked = false;
  const session = createFreshSession();
  if (!session.ok) { blocked = true; status = `Storage setup failed: ${session.error.message} Nothing will be claimed as saved.`; }
  try {
    // Touch only the new session's storage path. A legacy archive and every
    // prior session remain untouched and intentionally hidden from this MVP.
    if (!blocked) storage.getItem(session.session.currentKey);
  } catch (error) { blocked = true; status = `Storage unavailable: ${String(error)} Nothing will be claimed as saved.`; }
  const experience = createExperience(log, { status: () => status, persist(next) {
    if (blocked) throw Error(status);
    try {
      const raw = archive(next);
      storage.setItem(session.session.currentKey, raw);
      status = 'Saved in this session archive · previous sessions remain retained but hidden.';
    } catch (error) { status = `Not saved locally: ${String(error)} Existing session archives were not replaced.`; throw Error(status); }
  } });
  return experience;
}
