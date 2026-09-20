import test from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyMoldOptions } from './mold-search.ts';

const molds = [
  { manufacturer: 'Discraft', mold: 'Buzzz' },
  { manufacturer: 'Innova', mold: 'Roc' },
  { manufacturer: 'Kastaplast', mold: 'Berg' },
  { manufacturer: 'Discraft', mold: 'Buzzz OS' },
  { manufacturer: 'ABC', mold: 'Flying Squirrel' },
];
const find = (query: string) => fuzzyMoldOptions(molds, query, row => `${row.manufacturer} ${row.mold}`);

test('combined mold search ranks exact fragments and accepts manufacturer plus mold tokens', () => {
  assert.deepEqual(find('buz disc').map(row => row.mold), ['Buzzz', 'Buzzz OS']);
  assert.equal(find('Kast Berg')[0], molds[2]);
});

test('combined mold search tolerates a small typo without admitting unrelated molds', () => {
  assert.equal(find('Discraft Buzx')[0], molds[0]);
  assert.equal(find('flyng squrrel')[0], molds[4], 'molds without loaded plastic guides remain searchable');
  assert.deepEqual(find('totally absent'), []);
});
