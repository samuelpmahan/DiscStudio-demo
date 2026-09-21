import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFreshSession, discoverSessionKeys, legacyStorageKey, sessionKeyPrefix } from './session-storage.ts';

test('fresh sessions produce distinct durable keys without touching legacy bytes', () => {
  const first = createFreshSession({ sessionId: 'session-one-00001' });
  const second = createFreshSession({ sessionId: 'session-two-00001' });
  assert.equal(first.ok, true); assert.equal(second.ok, true);
  if (!first.ok || !second.ok) throw Error('unexpected setup failure');
  assert.notEqual(first.session.currentKey, second.session.currentKey);
  assert.match(first.session.currentKey, new RegExp(`^${sessionKeyPrefix}`));
  assert.equal(legacyStorageKey, 'discstudio.pxc.shelf.v1');
});

test('invalid session id reports setup failure instead of claiming a session', () => {
  const result = createFreshSession({ sessionId: 'too-short' });
  assert.equal(result.ok, false);
  if (result.ok) throw Error('unexpected success');
  assert.match(result.error.message, /Secure session id unavailable/);
});

test('session key discovery includes legacy and session keys in stable order', () => {
  const keys = ['discstudio.pxc.session.v1.z-000000000000', legacyStorageKey, 'discstudio.pxc.session.v1.a-000000000000'];
  const storage = { length: keys.length, key: (index: number) => keys[index] ?? null, getItem: () => null };
  assert.deepEqual(discoverSessionKeys(storage), [...keys].sort());
});

test('clearing local data snapshots every DiscStudio key and preserves unrelated values', async () => {
  const { clearLocalData } = await import('./session-storage.ts');
  const values = new Map([
    [legacyStorageKey, 'legacy'],
    [`${sessionKeyPrefix}one-000000000000`, 'session one'],
    [`${sessionKeyPrefix}two-000000000000`, 'session two'],
    ['tick-part-checklist:discstudio-creator-review:start-fresh', 'done'],
    ['another-app.preference', 'keep'],
    ['discstudio.pxc.session.v2.keep', 'keep'],
    ['tick-part-checklist:another-app', 'keep'],
    ['tick-part-checklist:discstudio-creator-reviewish:keep', 'keep'],
  ]);
  const storage = {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
  };
  const result = clearLocalData(storage);
  assert.equal(result.ok, true);
  assert.deepEqual([...values.entries()], [
    ['another-app.preference', 'keep'],
    ['discstudio.pxc.session.v2.keep', 'keep'],
    ['tick-part-checklist:another-app', 'keep'],
    ['tick-part-checklist:discstudio-creator-reviewish:keep', 'keep'],
  ]);
  assert.equal(result.ok && result.removed.length, 4);
});

test('clearing local data reports a partial removal failure without touching unrelated keys', async () => {
  const { clearLocalData } = await import('./session-storage.ts');
  const first = legacyStorageKey;
  const second = `${sessionKeyPrefix}cannot-remove-000000000000`;
  const values = new Map([[first, 'legacy'], [second, 'session'], ['another-app.preference', 'keep']]);
  const storage = {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => {
      if (key === second) throw Error('storage write blocked');
      values.delete(key);
    },
  };
  const result = clearLocalData(storage);
  assert.equal(result.ok, false);
  if (result.ok) throw Error('unexpected success');
  assert.deepEqual(result.removed, [first]);
  assert.equal(values.has(second), true);
  assert.equal(values.get('another-app.preference'), 'keep');
});


test('clearing local data makes no removals when enumeration is blocked', async () => {
  const { clearLocalData } = await import('./session-storage.ts');
  let removeCalls = 0;
  const storage = {
    get length() { return 2; },
    key: () => { throw Error('SecurityError'); },
    removeItem: () => { removeCalls++; },
  };
  const result = clearLocalData(storage);
  assert.equal(result.ok, false);
  assert.equal(removeCalls, 0);
});
