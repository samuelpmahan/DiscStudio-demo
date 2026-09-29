import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileCreatorSelection, setReviewMembership } from './creator-selection.ts';

test('a restored Bag starts with one checked active preview', () => {
  const selection = reconcileCreatorSelection(['luna', 'crave'], { active: '', checked: new Set() }, true);
  assert.equal(selection.active, 'luna');
  assert.deepEqual([...selection.checked], ['luna']);
});

test('checking a card activates an empty preview; unchecking the active card falls back or clears', () => {
  const addresses = ['luna', 'crave'];
  const first = setReviewMembership(addresses, { active: '', checked: new Set() }, 'luna', true);
  assert.equal(first.active, 'luna');
  const both = setReviewMembership(addresses, first, 'crave', true);
  assert.equal(both.active, 'luna');
  const next = setReviewMembership(addresses, both, 'luna', false);
  assert.equal(next.active, 'crave');
  assert.deepEqual([...next.checked], ['crave']);
  const empty = setReviewMembership(addresses, next, 'crave', false);
  assert.equal(empty.active, '');
  assert.equal(empty.checked.size, 0);
  assert.equal(reconcileCreatorSelection(addresses, empty).active, '', 'an explicit empty choice stays empty');
});

test('stale Bag references are dropped without choosing an unrelated card', () => {
  const selection = reconcileCreatorSelection(['crave'], { active: 'luna', checked: new Set(['luna', 'crave']) });
  assert.equal(selection.active, 'crave');
  assert.deepEqual([...selection.checked], ['crave']);
});
