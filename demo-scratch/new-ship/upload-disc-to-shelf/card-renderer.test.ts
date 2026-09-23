import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCard, renderCardDataUrl, CARD_SIZE } from './card-renderer.ts';
import { resolveCardDisc } from './card-renderer-core.ts';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { Disc } from './model.ts';

// 1x1 red PNG data URL: exercises the photo load path without fixtures.
const redPixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function testDisc(overrides: Partial<Disc> = {}): Disc {
  return {
    id: 'disc-1',
    mold: 'ds.px.seed.buzzz',
    nickname: 'Minty',
    plastic: 'ESP',
    weight: 177,
    speed: null, glide: null, turn: null, fade: null,
    Color1: '#98d4ba', Color2: '#f8b393',
    paintMode: 'split', colorPainting: false,
    depiction: { kind: 'photo', src: redPixel, name: 'test.png' },
    ...overrides,
  } as Disc;
}

/** Read width/height from a PNG's IHDR chunk (no decoder needed). */
function pngSize(buf: Buffer): { w: number; h: number } {
  assert.equal(buf.slice(0, 8).toString('hex'), '89504e470d0a1a0a', 'must be a PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test('horizontal card is a 1920x1080 PNG', async () => {
  const buf = await renderCard(testDisc(), 'horizontal');
  const { w, h } = pngSize(buf);
  assert.equal(w, CARD_SIZE.horizontal.w);
  assert.equal(h, CARD_SIZE.horizontal.h);
  assert.ok(buf.length > 10_000, `expected real content, got ${buf.length} bytes`);
});

test('vertical card is a 1080x1920 PNG', async () => {
  const buf = await renderCard(testDisc(), 'vertical');
  const { w, h } = pngSize(buf);
  assert.equal(w, CARD_SIZE.vertical.w);
  assert.equal(h, CARD_SIZE.vertical.h);
  assert.ok(buf.length > 10_000, `expected real content, got ${buf.length} bytes`);
});

test('data URL form has the right prefix and decodes to the same PNG', async () => {
  const url = await renderCardDataUrl(testDisc(), 'horizontal');
  assert.ok(url.startsWith('data:image/png;base64,'));
  const buf = Buffer.from(url.split(',')[1], 'base64');
  assert.equal(buf.slice(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('renders without a photo (placeholder path)', async () => {
  const disc = testDisc({ depiction: { kind: 'photo', src: '', name: '' } });
  const buf = await renderCard(disc, 'horizontal');
  pngSize(buf); // throws if not a PNG
  assert.ok(buf.length > 5_000);
});

test('renders with blank plastic/weight (lines omitted, no throw)', async () => {
  const disc = testDisc({ plastic: '', weight: null });
  const buf = await renderCard(disc, 'vertical');
  pngSize(buf);
});

test('own flight numbers win over the mold', async () => {
  // Buzzz mold is 5/4/-1/1; override speed to 9. Should render, not throw.
  const disc = testDisc({ speed: 9 });
  const buf = await renderCard(disc, 'horizontal');
  pngSize(buf);
});

test('held renderer facts win over a later catalog lookup', async () => {
  const held: any = testDisc({
    renderer: { manufacturer: 'Held Discraft', moldName: 'Held Buzzz', flights: [5, 4, -1, 1] },
  } as any);
  for (const field of ['speed', 'glide', 'turn', 'fade']) delete held[field];
  const resolved = await resolveCardDisc({ loadImage: async () => null, getMoldDetails: async () => ({ manufacturer: 'Changed catalog maker', mold: 'Changed catalog name', flight: [99, 98, 97, 96] }) }, held);
  assert.equal(resolved.manufacturer, 'Held Discraft');
  assert.equal(resolved.moldName, 'Held Buzzz');
  assert.deepEqual(resolved.flights, [5, 4, -1, 1]);
});

test('U02 retains visible manufacturer and opaque flight cells on a transparent frame', async () => {
  const base = testDisc({ depiction: { kind: 'photo', src: '', name: '' } });
  const first = await renderCard({ ...base, renderer: { manufacturer: 'Discraft', moldName: 'Buzzz', flights: [5, 4, -1, 1] } }, 'vertical', 'u02');
  const second = await renderCard({ ...base, renderer: { manufacturer: 'MVP', moldName: 'Buzzz', flights: [5, 4, -1, 1] } }, 'vertical', 'u02');
  const pixels = async (png: Buffer) => { const canvas = createCanvas(1080, 1920), ctx = canvas.getContext('2d'); ctx.drawImage(await loadImage(png), 0, 0); return ctx; };
  const a = await pixels(first), b = await pixels(second);
  assert.notDeepEqual(a.getImageData(82, 920, 350, 45).data, b.getImageData(82, 920, 350, 45).data, 'changing held manufacturer must change visible ink');
  for (const x of [82, 251, 420, 589]) {
    const [red, green, blue, alpha] = a.getImageData(x + 2, 1213, 1, 1).data;
    assert.equal(alpha, 255, 'flight cell protects type against light footage');
    assert.ok(Math.max(red, green, blue) < 90, 'flight cell has a dark reading surface');
  }
});

test('offered designs show the exact plastic blend and ignore weight', async () => {
  for (const [preset, orientation] of [['u01', 'vertical'], ['u02', 'vertical'], ['b01', 'horizontal'], ['b02', 'horizontal']] as const) {
    const base = testDisc({ renderer: { manufacturer: 'Discraft', moldName: 'Buzzz', flights: [5, 4, -1, 1] } } as any);
    const esp = await renderCard(base, orientation, preset);
    const complex = await renderCard({ ...base, plastic: 'ESP FLX Swirl Special Blend' }, orientation, preset);
    const differentWeight = await renderCard({ ...base, weight: 152 }, orientation, preset);
    assert.notDeepEqual(esp, complex, `${preset}: plastic must change the exported image`);
    assert.deepEqual(esp, differentWeight, `${preset}: weight must not change the exported image`);
  }
});

test('B01 and B02 retain a white disc edge; B02 name never paints across its photo', async () => {
  const source = createCanvas(128, 128), sourceCtx = source.getContext('2d');
  sourceCtx.fillStyle = '#fff'; sourceCtx.fillRect(0, 0, 128, 128);
  const whitePhoto = source.toDataURL('image/png');
  sourceCtx.fillStyle = '#111'; sourceCtx.fillRect(0, 0, 128, 128);
  const darkPhoto = source.toDataURL('image/png');
  const paint = async (name: string, preset: 'b01' | 'b02', photo = whitePhoto) => {
    const base = testDisc({ depiction: { kind: 'photo', src: photo, name: 'test.png' } });
    const png = await renderCard({ ...base, renderer: { manufacturer: 'Example Maker', moldName: name, flights: [5, 4, -1, 1] } }, 'horizontal', preset);
    const canvas = createCanvas(1920, 1080), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(await loadImage(png), 0, 0);
    return ctx;
  };
  const colorAt = (ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>, x: number, y: number) =>
    [...ctx.getImageData(x, y, 1, 1).data];
  const b01 = await paint('WHITE TEST', 'b01'), b02 = await paint('WHITE TEST', 'b02');
  for (const [ctx, x, edgeY, innerY] of [[b01, 825, 382, 410], [b02, 254, 675, 704]] as const) {
    const edge = colorAt(ctx, x, edgeY), inside = colorAt(ctx, x, innerY);
    assert.ok(Math.max(...edge.slice(0, 3)) < 110, 'white disc must have a dark perimeter on white footage');
    assert.ok(Math.min(...inside.slice(0, 3)) > 240, 'white disc itself remains white');
  }
  for (const [preset, white, x, y, width, height, backX, backY] of [
    ['b01', b01, 84, 704, 520, 122, 600, 680],
    ['b02', b02, 498, 694, 640, 152, 1100, 700],
  ] as const) {
    const dark = await paint('WHITE TEST', preset, darkPhoto);
    assert.deepEqual(
      white.getImageData(x, y, width, height).data,
      dark.getImageData(x, y, width, height).data,
      `${preset} manufacturer and white title must stay on their own protected reading surface regardless of disc color`,
    );
    assert.ok(Math.max(...colorAt(white, backX, backY).slice(0, 3)) < 80, `${preset} title panel must remain dark over white footage`);
  }
  const renamed = await paint('A DIFFERENT MOLD', 'b02');
  assert.deepEqual(
    b02.getImageData(85, 680, 340, 320).data,
    renamed.getImageData(85, 680, 340, 320).data,
    'the entire B02 disc region stays independent of the mold typography',
  );
  assert.notDeepEqual(b02.getImageData(500, 760, 640, 100).data, renamed.getImageData(500, 760, 640, 100).data);
});

test('unknown mold id falls back to the id as name', async () => {
  const disc = testDisc({ mold: 'ds.px.seed.no-such-mold-xyz' });
  const buf = await renderCard(disc, 'horizontal');
  pngSize(buf);
});

test('invalid orientation throws', async () => {
  await assert.rejects(
    () => renderCard(testDisc(), 'diagonal' as any),
    /orientation must be 'horizontal' or 'vertical'/,
  );
});

for (const preset of ['u01', 'u02', 'u03', 'u04', 'u05'] as const) {
  test(`upright preset ${preset} renders a 1080x1920 PNG`, async () => {
    const buf = await renderCard(testDisc(), 'vertical', preset);
    const { w, h } = pngSize(buf);
    assert.equal(w, 1080);
    assert.equal(h, 1920);
    assert.ok(buf.length > 20_000, `${preset}: expected real content, got ${buf.length} bytes`);
  });
}

test('upright preset on horizontal orientation throws', async () => {
  await assert.rejects(
    () => renderCard(testDisc(), 'horizontal', 'u01'),
    /vertical-native/,
  );
});

for (const preset of ['b01', 'b02', 'b03', 'b04', 'b05'] as const) {
  test(`breakout preset ${preset} renders a 1920x1080 PNG`, async () => {
    const buf = await renderCard(testDisc(), 'horizontal', preset);
    const { w, h } = pngSize(buf);
    assert.equal(w, 1920);
    assert.equal(h, 1080);
    assert.ok(buf.length > 20_000, `${preset}: expected real content, got ${buf.length} bytes`);
  });
}

test('breakout preset on vertical orientation throws', async () => {
  await assert.rejects(
    () => renderCard(testDisc(), 'vertical', 'b01'),
    /horizontal-native/,
  );
});

test('breakout presets render without a photo (placeholder path)', async () => {
  const disc = testDisc({ depiction: { kind: 'photo', src: '', name: '' } });
  for (const preset of ['b01', 'b02', 'b03', 'b04', 'b05'] as const) {
    const buf = await renderCard(disc, 'horizontal', preset);
    pngSize(buf); // throws if not a PNG
  }
});

test('unknown preset throws', async () => {
  await assert.rejects(
    () => renderCard(testDisc(), 'vertical', 'u99' as any),
    /unknown card preset/,
  );
});

test('no-preset vertical still renders the default card', async () => {
  const buf = await renderCard(testDisc(), 'vertical');
  const { w, h } = pngSize(buf);
  assert.equal(w, 1080);
  assert.equal(h, 1920);
});
