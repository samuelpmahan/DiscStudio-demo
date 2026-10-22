import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from './catalog.ts';
import {
  compileMoldWildcardTrie,
  MoldWildcardQueryError,
  openMoldWildcardTrie,
  queryMoldWildcardTrie,
} from './mold-wildcard-trie.ts';

const names = catalog.map(row => row.mold);
const compiled = compileMoldWildcardTrie(names);
const trie = openMoldWildcardTrie(compiled);

function expectedOrdinals(query: string): number[] {
  const normalized = query.toLowerCase().trim().replace(/\*+$/u, '');
  const pattern = Array.from(normalized);
  return names.flatMap((name, ordinal) => {
    const characters = Array.from(name.toLowerCase().trim());
    return pattern.length <= characters.length && pattern.every((character, index) => character === '*' || character === characters[index]) ? [ordinal] : [];
  });
}

test('the compiled index covers the 724 unique mold-name ordinals compactly and deterministically', () => {
  assert.equal(names.length, 724);
  assert.equal(new Set(names.map(name => name.toLowerCase().trim())).size, 724);
  assert.equal(trie.recordCount, 724);
  assert.deepEqual(compileMoldWildcardTrie(names), compiled);
  assert.ok(compiled.byteLength < 40_000, `compiled name-only trie is ${compiled.byteLength} bytes`);
  assert.deepEqual(trie.query('', 4), [0, 1, 2, 3]);
  assert.deepEqual(trie.query('   ', 3), [0, 1, 2]);
  assert.deepEqual(trie.query('***', 5), [0, 1, 2, 3, 4]);
});

test('ordinary queries are case-insensitive prefix searches over mold names', () => {
  for (const query of ['buz', '  BUZ  ', 'Roc', 'not-a-mold']) {
    assert.deepEqual(trie.query(query, 724), expectedOrdinals(query), query);
  }
  assert.deepEqual(trie.query('BUZ', 1), expectedOrdinals('BUZ').slice(0, 1));
  assert.deepEqual(trie.query('Buz', 0), []);
  assert.deepEqual(queryMoldWildcardTrie(compiled, 'buz', 3), expectedOrdinals('buz').slice(0, 3));
});

test('one star consumes exactly one Unicode code point and remaining text stays a prefix', () => {
  for (const query of ['bu*z', 'b*z*z', '*oc', 'r*c', 'a*e']) {
    assert.deepEqual(trie.query(query, 724), expectedOrdinals(query), query);
  }
  const buzzOrdinal = names.indexOf('Buzzz');
  assert.ok(trie.query('bu*z', 724).includes(buzzOrdinal), 'bu*z matches the Buz prefix of Buzzz');
  assert.ok(trie.query('*oc', 724).includes(names.indexOf('Roc')));

  const unicodeTrie = openMoldWildcardTrie(compileMoldWildcardTrie(['Éclair', 'Éclair', '🚀ship', '🛸ship']));
  assert.deepEqual(unicodeTrie.query('é*', 10), [0]);
  assert.deepEqual(unicodeTrie.query('e\u0301*', 10), [1]);
  assert.deepEqual(unicodeTrie.query('🚀*', 10), [2]);
  assert.deepEqual(unicodeTrie.query('*ship', 10), [2, 3], 'the wildcard consumes each astral symbol as one code point');
});

test('trailing wildcard runs are redundant; only adjacent interior stars are invalid', () => {
  assert.deepEqual(trie.query('bu*', 724), trie.query('bu', 724));
  assert.deepEqual(trie.query('bu**', 724), trie.query('bu', 724));
  assert.deepEqual(trie.query('*****', 6), [0, 1, 2, 3, 4, 5]);
  for (const invalid of ['bu**z', '**buz', 'b***uz']) {
    assert.throws(() => trie.query(invalid), (error: unknown) => error instanceof MoldWildcardQueryError && error.code === 'ADJACENT_WILDCARD');
  }
  assert.throws(() => trie.query('bu**z', 0), MoldWildcardQueryError);
});

test('duplicate normalized names and wildcard branches retain source order', () => {
  const duplicateTrie = openMoldWildcardTrie(compileMoldWildcardTrie(['Mold', 'MOLD', 'Mold OS', 'Other']));
  assert.deepEqual(duplicateTrie.query('mold', 10), [0, 1, 2]);
  assert.deepEqual(duplicateTrie.query('m*', 10), [0, 1, 2]);
  assert.deepEqual(duplicateTrie.query('', 10), [0, 1, 2, 3]);
});

test('limits are bounded to nonnegative safe integers and results clamp to the catalog size', () => {
  for (const limit of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => trie.query('', limit), RangeError);
  }
  assert.deepEqual(trie.query('', Number.MAX_SAFE_INTEGER), Array.from({ length: 724 }, (_, ordinal) => ordinal));
  assert.deepEqual(openMoldWildcardTrie(compileMoldWildcardTrie([])).query('', 12), []);
  assert.throws(() => compileMoldWildcardTrie(['', 'Name']), RangeError);
  assert.throws(() => compileMoldWildcardTrie([123 as unknown as string]), TypeError);
});

test('the reader supports byte subviews and rejects damaged serialized structures', () => {
  const wrapper = new Uint8Array(compiled.byteLength + 13);
  wrapper.set(compiled, 7);
  assert.deepEqual(openMoldWildcardTrie(wrapper.subarray(7, 7 + compiled.byteLength)).query('bu*z', 724), expectedOrdinals('bu*z'));

  const damagedMagic = compiled.slice();
  damagedMagic[0] ^= 0xff;
  assert.throws(() => openMoldWildcardTrie(damagedMagic), /magic/);
  const damagedChild = compiled.slice();
  const alphabetCount = new DataView(damagedChild.buffer).getUint16(18, true);
  const nodesOffset = 24 + alphabetCount * 4;
  const edgesOffset = nodesOffset + trie.nodeCount * 8;
  new DataView(damagedChild.buffer).setUint16(edgesOffset + 2, 0xffff, true);
  assert.throws(() => openMoldWildcardTrie(damagedChild), /edge/);
});
