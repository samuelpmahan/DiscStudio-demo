import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import JSZip from 'jszip';
import {
  queueCards, cardFilename, cardDimensions, moldSlug,
  encodeTransparentPng, pngDimensions, stubCardRenderer, exportZip,
  type QueuedCard, type Disc,
} from './export-queue.ts';

const disc = (over: Partial<Disc> = {}): Disc => ({
  id: 'disc-1',
  mold: 'ds.px.seed.buzzz',
  nickname: 'Minty',
  weight: 177,
  plastic: 'ESP',
  Color1: '#98d4ba',
  Color2: '#f8b393',
  paintMode: 'split',
  colorPainting: false,
  speed: 5, glide: 4, turn: -1, fade: 1,
  depiction: { kind: 'photo', src: 'data:image/png;base64,AAA=', name: 'p.png' },
  ...over,
});

const card = (over: Partial<QueuedCard> = {}): QueuedCard => ({
  disc: disc(),
  orientation: 'horizontal',
  cardDesign: 'spotlight',
  ...over,
});

test('queueCards freezes a validated copy', () => {
  const input = [card(), card({ orientation: 'vertical', cardDesign: 'crest' })];
  const q = queueCards(input);
  assert.equal(q.length, 2);
  assert.ok(Object.isFrozen(q));
  assert.notEqual(q, input);
  assert.equal(q[1].orientation, 'vertical');
});

test('queueCards snapshots nested renderer and depiction data', () => {
  const input = card({ disc: disc({
    depiction: { kind: 'photo', src: 'data:image/png;base64,ORIGINAL=', name: 'original.png' },
    renderer: { flights: [7, 5, -2, 1], options: { frame: 'original' } },
  } as any) });
  const q = queueCards([input]);
  (input.disc.depiction as any).src = 'data:image/png;base64,MUTATED=';
  (input.disc as any).renderer.flights[0] = 99;
  (input.disc as any).renderer.options.frame = 'mutated';
  assert.equal(q[0].disc.depiction.src, 'data:image/png;base64,ORIGINAL=');
  assert.deepEqual((q[0].disc as any).renderer, { flights: [7, 5, -2, 1], options: { frame: 'original' } });
  assert.ok(Object.isFrozen(q[0].disc.depiction));
  assert.ok(Object.isFrozen((q[0].disc as any).renderer.flights));
  assert.ok(Object.isFrozen((q[0].disc as any).renderer.options));
});

test('queueCards rejects bad input', () => {
  assert.throws(() => queueCards('nope' as any), /expected an array/);
  assert.throws(() => queueCards([card({ orientation: 'diagonal' as any })]), /orientation/);
  assert.throws(() => queueCards([card({ cardDesign: '  ' })]), /cardDesign/);
  assert.throws(() => queueCards([card({ disc: disc({ id: '' }) })]), /non-empty id/);
  assert.throws(() => queueCards([card({ disc: disc({ mold: '' }) })]), /mold address/);
});

test('cardFilename follows {mold}-{design}-{orientation}.png and dedupes', () => {
  const taken = new Set<string>();
  const c = card();
  assert.equal(cardFilename(c, taken), 'buzzz-spotlight-horizontal.png');
  assert.equal(cardFilename(c, taken), 'buzzz-spotlight-horizontal-2.png');
  assert.equal(cardFilename(card({ orientation: 'vertical' }), taken), 'buzzz-spotlight-vertical.png');
});

test('moldSlug pulls the tail off a mold address', () => {
  assert.equal(moldSlug(disc()), 'buzzz');
  assert.equal(moldSlug(disc({ mold: 'ds.px.seed.discraft--buzzz-ss' })), 'discraft-buzzz-ss');
});

test('cardDimensions are full-frame per orientation', () => {
  assert.deepEqual(cardDimensions('horizontal'), { width: 1920, height: 1080 });
  assert.deepEqual(cardDimensions('vertical'), { width: 1080, height: 1920 });
});

test('encodeTransparentPng makes a parseable PNG at the right size', () => {
  const png = encodeTransparentPng(1920, 1080);
  assert.deepEqual(pngDimensions(png), { width: 1920, height: 1080 });
  assert.deepEqual(pngDimensions(encodeTransparentPng(1080, 1920)), { width: 1080, height: 1920 });
  assert.throws(() => encodeTransparentPng(0, 100), /bad dimensions/);
});

test('stubCardRenderer honors orientation dimensions', async () => {
  assert.deepEqual(pngDimensions(await stubCardRenderer(card())), { width: 1920, height: 1080 });
  assert.deepEqual(pngDimensions(await stubCardRenderer(card({ orientation: 'vertical' }))), { width: 1080, height: 1920 });
});

test('exportZip refuses an empty queue', async () => {
  await assert.rejects(() => exportZip([]), /empty/);
});

test('exportZip packs PNGs plus a manifest with matching metadata', async () => {
  const q = queueCards([
    card(),
    card({ disc: disc({ id: 'disc-2', mold: 'ds.px.seed.zone', nickname: 'Beef' }), orientation: 'vertical', cardDesign: 'crest' }),
  ]);
  const bytes = await exportZip(q);
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).sort();
  assert.deepEqual(names, ['buzzz-spotlight-horizontal.png', 'manifest.json', 'zone-crest-vertical.png']);

  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  assert.equal(manifest.type, 'discstudio-export');
  assert.equal(manifest.version, 1);
  assert.equal(manifest.cardCount, 2);

  for (const entry of manifest.cards) {
    const data = await zip.file(entry.filename)!.async('nodebuffer');
    assert.equal(data.length, entry.byteLength, `${entry.filename} byteLength`);
    const { createHash } = await import('node:crypto');
    assert.equal(createHash('sha256').update(data).digest('hex'), entry.sha256, `${entry.filename} sha256`);
  }
  assert.equal(manifest.cards[0].discId, 'disc-1');
  assert.equal(manifest.cards[0].nickname, 'Minty');
  assert.equal(manifest.cards[0].flight.speed, 5);
  assert.deepEqual(manifest.cards[1], { ...manifest.cards[1], width: 1080, height: 1920 });
});

test('exportZip dedupes identical mold+design+orientation', async () => {
  const q = queueCards([card(), card({ disc: disc({ id: 'disc-2' }) })]);
  const zip = await JSZip.loadAsync(await exportZip(q));
  const names = Object.keys(zip.files).sort();
  assert.deepEqual(names, ['buzzz-spotlight-horizontal-2.png', 'buzzz-spotlight-horizontal.png', 'manifest.json']);
});

test('exportZip holds the queued snapshot through rendering and ZIP metadata', async () => {
  const heldDisc: any = disc({
    nickname: 'Before mutation',
    depiction: { kind: 'photo', src: 'data:image/png;base64,BEFORE=', name: 'before.png' },
    renderer: { flights: [8, 6, -3, 2] },
  } as any);
  for (const field of ['speed', 'glide', 'turn', 'fade']) delete heldDisc[field];
  const source = card({ disc: heldDisc });
  const q = queueCards([source]);
  const first = await exportZip(q, { renderCard: async held => {
    assert.equal(held.disc.nickname, 'Before mutation');
    assert.equal(held.disc.depiction.src, 'data:image/png;base64,BEFORE=');
    assert.deepEqual((held.disc as any).renderer.flights, [8, 6, -3, 2]);
    return encodeTransparentPng(...Object.values(cardDimensions(held.orientation)) as [number, number]);
  } });
  (source.disc as any).nickname = 'After mutation';
  (source.disc as any).depiction.src = 'data:image/png;base64,AFTER=';
  (source.disc as any).renderer.flights[0] = 99;
  const second = await exportZip(q, { renderCard: stubCardRenderer });
  const firstZip = await JSZip.loadAsync(first), secondZip = await JSZip.loadAsync(second);
  const firstManifest = JSON.parse(await firstZip.file('manifest.json')!.async('string'));
  const secondManifest = JSON.parse(await secondZip.file('manifest.json')!.async('string'));
  assert.equal(firstManifest.cards[0].nickname, 'Before mutation');
  assert.equal(firstManifest.cards[0].flight.speed, 8);
  assert.equal(firstManifest.cards[0].flightSource.speed, 'mold');
  assert.deepEqual(secondManifest, firstManifest);
  assert.deepEqual(await firstZip.file(firstManifest.cards[0].filename)!.async('uint8array'), await secondZip.file(secondManifest.cards[0].filename)!.async('uint8array'));
  const png = Buffer.from(await secondZip.file(secondManifest.cards[0].filename)!.async('uint8array'));
  assert.deepEqual(pngDimensions(png), { width: 1920, height: 1080 });
  assert.equal(png[25], 6, 'PNG must use RGBA color type');
  const idat = png.subarray(41, 41 + png.readUInt32BE(33));
  const pixels = inflateSync(idat);
  for (let row = 0; row < 1080; row++) for (let x = 0; x < 1920; x++) assert.equal(pixels[row * (1 + 1920 * 4) + 1 + x * 4 + 3], 0);
});

test('exportZip uses the injected renderer', async () => {
  const seen: QueuedCard[] = [];
  const fake = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic, enough for the pipeline
  const bytes = await exportZip(queueCards([card()]), {
    renderCard: async (c) => { seen.push(c); return fake; },
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].cardDesign, 'spotlight');
  const zip = await JSZip.loadAsync(bytes);
  assert.deepEqual(Buffer.from(await zip.file('buzzz-spotlight-horizontal.png')!.async('nodebuffer')), fake);
});

test('exportZip is deterministic: same queue, same bytes', async () => {
  const q = queueCards([card(), card({ disc: disc({ id: 'd2', mold: 'ds.px.seed.heat' }), orientation: 'vertical' })]);
  const a = await exportZip(q);
  const b = await exportZip(q);
  assert.deepEqual(a, b);
});
