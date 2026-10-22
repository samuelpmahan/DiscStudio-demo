import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_SETUP_STORAGE_KEY, loadSavedSetup, makeReviewCandidates, pendingCards, storeSavedSetup, transitionCandidate } from './batch-review.ts';
const card = (id: string) => ({ disc: { id, mold: 'ds.px.seed.crave' }, orientation: 'vertical' as const, cardDesign: 'u02', placement: { scale: 1, dx: 0, dy: 0 } });
test('saved setup validates and survives a storage round-trip without background bytes', () => { const values = new Map<string,string>(), storage = { getItem: (key:string) => values.get(key) ?? null, setItem: (key:string,value:string) => values.set(key,value) }; const saved = storeSavedSetup(storage, { version: 1, name: 'TikTok lower third', preset: 'u01', orientation: 'vertical', placement: { scale: .72, dx: .12, dy: -.18 }, u01Appearance: { discSide: 'left', highlightTarget: 'digits', accentColor: '#cc5533' } }); assert.deepEqual(loadSavedSetup(storage), saved); assert.deepEqual(saved.u01Appearance, { discSide: 'left', highlightTarget: 'digits', accentColor: '#cc5533' }); assert.equal(values.get(CARD_SETUP_STORAGE_KEY)!.includes('background'), false); });
test('old saved setups remain valid and preserve their prior U01 layout', () => { const values = new Map<string,string>(), storage = { getItem: (key:string) => values.get(key) ?? null, setItem: (key:string,value:string) => values.set(key,value) }; values.set(CARD_SETUP_STORAGE_KEY, JSON.stringify({ version: 1, name: 'Old', preset: 'u01', orientation: 'vertical', placement: { scale: 1, dx: 0, dy: 0 } })); assert.equal(loadSavedSetup(storage)?.u01Appearance, undefined); });
test('shared card details survive a saved setup round-trip for mirrored U3 and B05', () => {
  const values = new Map<string,string>(), storage = { getItem: (key:string) => values.get(key) ?? null, setItem: (key:string,value:string) => values.set(key,value) };
  const appearance = { discSide: 'left' as const, highlightTarget: 'tiles' as const, accentColor: '#336699' };
  for (const [preset, orientation] of [['u03-behind-mirror','vertical'],['b05','horizontal']] as const) {
    const setup = storeSavedSetup(storage, { version: 1, name: preset, preset, orientation, placement: { scale: 1, dx: 0, dy: 0 }, cardAppearance: appearance });
    assert.deepEqual(loadSavedSetup(storage), setup);
  }
});
test('bad stored setup is ignored', () => assert.equal(loadSavedSetup({getItem: () => '{bad'}), null));
test('review candidates stay immutable and approvals are idempotent', () => { const candidates = makeReviewCandidates([card('one'), card('two')]); const ready = candidates.map(candidate => transitionCandidate(candidates, candidate.id, 'ready').find(row => row.id === candidate.id)!); const approved = transitionCandidate(ready, candidates[0].id, 'approved'); assert.equal(pendingCards(approved).length, 1); assert.deepEqual(pendingCards(approved).map(card => card.disc.id), ['two'], 'only a rendered-ready, unapproved candidate is collectible'); assert.strictEqual(transitionCandidate(approved, candidates[0].id, 'approved')[0], approved[0]); assert.equal(candidates[0].state, 'rendering'); });
