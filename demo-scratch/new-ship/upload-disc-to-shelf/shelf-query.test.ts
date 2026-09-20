import test from 'node:test';
import assert from 'node:assert/strict';
import { shelfQuery, type ShelfRow } from './shelf-query.ts';

const row = (address: string, id: string, { manufacturer = 'Discraft', name = 'Buzzz', seedId = 'buzzz', plastic = 'ESP', weight = 175, speed = 5, nickname = 'Secret nickname' } = {}): ShelfRow => ({
  address,
  disc: { id, mold: `ds.px.seed.${seedId}`, plastic, weight, nickname },
  seed: { id: seedId, manufacturer, name, speed, glide: 4, turn: -1, fade: 1 },
  art: `art:${id}`,
});

test('query normalizes printed separators, requires every term, and excludes nicknames', () => {
  const esp = row('disc.esp', 'physical-esp', { plastic: 'ESP', weight: 174 });
  const z = row('disc.z', 'physical-z', { plastic: 'Z', weight: 172, nickname: 'Discraft Buzzz ESP 174' });
  assert.deepEqual(shelfQuery({ rows: [esp, z], request: { query: 'DISCRAFT · Buzzz, ESP / 174' } }).rows, [esp]);
  assert.deepEqual(shelfQuery({ rows: [esp, z], request: { query: 'secret' } }).rows, []);
  assert.deepEqual(shelfQuery({ rows: [esp, z], request: { query: 'buzzz ESP 172' } }).rows, []);
});

test('all optional filters conjunct and active ranges reject missing or nonfinite fields', () => {
  const wanted = row('wanted', 'wanted', { manufacturer: 'Discraft', plastic: 'ESP', weight: 174, speed: 5 });
  const wrongMaker = row('maker', 'maker', { manufacturer: 'Innova', plastic: 'ESP', weight: 174, speed: 5 });
  const wrongPlastic = row('plastic', 'plastic', { plastic: 'Z', weight: 174, speed: 5 });
  const wrongSpeed = row('speed', 'speed', { plastic: 'ESP', weight: 174, speed: 6 });
  const unknown = row('unknown', 'unknown', { plastic: 'ESP', weight: null, speed: null });
  const view = shelfQuery({ rows: [wrongMaker, wrongPlastic, wrongSpeed, unknown, wanted], request: {
    manufacturers: ['discraft'], plastics: ['ESP'], speedRange: [5, 5], weightRange: [174, 174],
  } });
  assert.deepEqual(view.rows, [wanted]);
  assert.throws(() => shelfQuery({ rows: [wanted], request: { speedRange: [6, 5] } }), /ascending/);
  assert.throws(() => shelfQuery({ rows: [wanted], request: { weightRange: [Number.NaN, 175] } }), /finite/);
});

test('manufacturer/mold groups retain the exact rows and copies order plastic then descending known weight', () => {
  const zUnknown = row('z-unknown', 'z-unknown', { plastic: 'Z', weight: null });
  const z172 = row('z-172', 'z-172', { plastic: 'Z', weight: 172 });
  const z175 = row('z-175', 'z-175', { plastic: 'Z', weight: 175 });
  const esp = row('esp', 'esp', { plastic: 'ESP', weight: 170 });
  const roc = row('roc', 'roc', { manufacturer: 'Innova', name: 'Roc', seedId: 'roc', plastic: 'KC', weight: 180, speed: 4 });
  const source = [zUnknown, z172, roc, z175, esp];
  const view = shelfQuery({ rows: source });
  assert.deepEqual(view.groups.map(group => [group.manufacturer, group.mold]), [['Discraft', 'Buzzz'], ['Innova', 'Roc']]);
  assert.deepEqual(view.groups[0].rows.map(value => value.address), ['esp', 'z-175', 'z-172', 'z-unknown']);
  assert.equal(view.groups[0].rows[1], z175, 'the projection preserves the original retained row reference');
  assert.equal(view.rows[0], esp);
  assert.equal(view.total, source.length);
  assert.equal(view.shown, source.length);
  assert.deepEqual(source, [zUnknown, z172, roc, z175, esp], 'query never mutates the caller collection');
});

test('same printed manufacturer/mold remains distinct when its mold identity differs', () => {
  const first = row('first', 'first', { seedId: 'buzzz-a' });
  const second = row('second', 'second', { seedId: 'buzzz-b' });
  const view = shelfQuery({ rows: [first, second] });
  assert.equal(view.groups.length, 2);
  assert.notEqual(view.groups[0].key, view.groups[1].key);
});
