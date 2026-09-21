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
