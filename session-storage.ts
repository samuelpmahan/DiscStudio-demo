import { storageKey } from './persistence.ts';

/** The original single-shelf archive is retained verbatim for future recovery. */
export const legacyStorageKey = storageKey;
export const sessionKeyPrefix = 'discstudio.pxc.session.v1.';

type KeyStorage = Pick<Storage, 'getItem' | 'key'> & { readonly length: number };
type ClearableStorage = Pick<Storage, 'key' | 'removeItem'> & { readonly length: number };

export type FreshSession = Readonly<{ id: string; currentKey: string }>;
export type FreshSessionResult = Readonly<{ ok: true; session: FreshSession }> | Readonly<{ ok: false; error: Error }>;

function errorOf(error: unknown): Error { return error instanceof Error ? error : Error(String(error)); }

/**
 * Every launch gets its own durable slot. We deliberately do not copy or
 * rewrite the legacy shelf: a later release can discover both that untouched
 * archive and every prefixed session key without a shared merge point.
 */
export function createFreshSession(options: { sessionId?: string; randomUUID?: () => string } = {}): FreshSessionResult {
  try {
    const id = options.sessionId ?? options.randomUUID?.() ?? globalThis.crypto?.randomUUID();
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{16,}$/.test(id)) throw Error('Secure session id unavailable.');
    return { ok: true, session: Object.freeze({ id, currentKey: `${sessionKeyPrefix}${id}` }) };
  } catch (error) { return { ok: false, error: errorOf(error) }; }
}

/** Read-only discovery for a future archive browser; never changes old bytes. */
export function discoverSessionKeys(storage: KeyStorage): readonly string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key && (key === legacyStorageKey || key.startsWith(sessionKeyPrefix))) keys.push(key);
  }
  return Object.freeze(keys.sort());
}


export type ClearLocalDataResult = Readonly<{ ok: true; removed: readonly string[] }> | Readonly<{ ok: false; removed: readonly string[]; error: Error }>;

/** Removes only DiscStudio's durable archives, never unrelated local storage. */
export function clearLocalData(storage: ClearableStorage): ClearLocalDataResult {
  let matching: string[];
  try {
    matching = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key === legacyStorageKey || key?.startsWith(sessionKeyPrefix) || key?.startsWith('tick-part-checklist:discstudio-creator-review:')) matching.push(key);
    }
  } catch (error) { return { ok: false, removed: Object.freeze([]), error: errorOf(error) }; }

  const removed: string[] = [];
  try {
    for (const key of matching) {
      storage.removeItem(key);
      removed.push(key);
    }
    return { ok: true, removed: Object.freeze(removed) };
  } catch (error) { return { ok: false, removed: Object.freeze(removed), error: errorOf(error) }; }
}
