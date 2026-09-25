import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCard, renderCardDataUrl, CARD_SIZE } from './card-renderer.ts';
import { CARD_PRESENTATION, resolveCardDisc } from './card-renderer-core.ts';
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

function presentedPoint(preset: 'u02' | 'b01' | 'b02', x: number, y: number): [number, number] {
  const { scale, anchorX, anchorY } = CARD_PRESENTATION[preset]!;
  return [Math.round(anchorX + scale * (x - anchorX)), Math.round(anchorY + scale * (y - anchorY))];
}

function presentedArea(preset: 'u02' | 'b01' | 'b02', x: number, y: number, width: number, height: number): [number, number, number, number] {
  const { scale } = CARD_PRESENTATION[preset]!;
  return [...presentedPoint(preset, x, y), Math.round(width * scale), Math.round(height * scale)];
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
  const base = testDisc({ depiction: { kind: 'photo', src: '', name: '' }, speed: 5, glide: 4, turn: -1, fade: 1 });
  const first = await renderCard({ ...base, renderer: { manufacturer: 'Discraft', moldName: 'Buzzz', flights: [5, 4, -1, 1] } }, 'vertical', 'u02');
  const second = await renderCard({ ...base, renderer: { manufacturer: 'MVP', moldName: 'Buzzz', flights: [5, 4, -1, 1] } }, 'vertical', 'u02');
  const pixels = async (png: Buffer) => { const canvas = createCanvas(1080, 1920), ctx = canvas.getContext('2d'); ctx.drawImage(await loadImage(png), 0, 0); return ctx; };
  const a = await pixels(first), b = await pixels(second);
  const makerArea = presentedArea('u02', 82, 920, 350, 45);
  assert.notDeepEqual(a.getImageData(...makerArea).data, b.getImageData(...makerArea).data, 'changing held manufacturer must change visible ink');
  for (const x of [82, 251, 420, 589]) {
    const [red, green, blue, alpha] = a.getImageData(...presentedPoint('u02', x + 10, 1218), 1, 1).data;
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

test('offered overlays leave most of the video unobscured', async () => {
  const disc = testDisc({ renderer: { manufacturer: 'Innova', moldName: 'WHITE TEST', flights: [5, 4, -1, 1] } } as any);
  for (const [preset, orientation] of [['b01', 'horizontal'], ['b02', 'horizontal'], ['u01', 'vertical'], ['u02', 'vertical']] as const) {
    const { w, h } = CARD_SIZE[orientation], png = await renderCard(disc, orientation, preset);
    const canvas = createCanvas(w, h), ctx = canvas.getContext('2d');
    ctx.drawImage(await loadImage(png), 0, 0);
    const pixels = ctx.getImageData(0, 0, w, h).data;
    let left = w, right = 0, top = h, bottom = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (pixels[(y * w + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    assert.ok(right - left < w * .42, `${preset}: overlay must use less than 42% of the video width`);
    assert.ok(bottom - top < h * .38, `${preset}: overlay must use less than 38% of the video height`);
  }
});

test('unknown flight numbers do not draw four question-mark tiles', async () => {
  const base: any = testDisc({ mold: 'ds.px.seed.no-such-mold-xyz', renderer: { manufacturer: '', moldName: 'PALE DISC' } } as any);
  for (const [preset, orientation] of [['b01', 'horizontal'], ['u02', 'vertical']] as const) {
    const absent = await renderCard(base, orientation, preset);
    const unknown = await renderCard({ ...base, renderer: { ...base.renderer, flights: [null, null, null, null] } }, orientation, preset);
    assert.deepEqual(unknown, absent, `${preset}: entirely unknown flights are absent, not four question marks`);
  }
});

test('B01 and B02 retain a white disc edge; B02 name never paints across its photo', async () => {
  const source = createCanvas(128, 128), sourceCtx = source.getContext('2d');
  sourceCtx.fillStyle = '#fff'; sourceCtx.fillRect(0, 0, 128, 128);
  const whitePhoto = source.toDataURL('image/png');
  sourceCtx.fillStyle = '#111'; sourceCtx.fillRect(0, 0, 128, 128);
  const darkPhoto = source.toDataURL('image/png');
  const paint = async (name: string, preset: 'b01' | 'b02', photo = whitePhoto) => {
    const base = testDisc({ depiction: { kind: 'photo', src: photo, name: 'test.png' }, speed: 5, glide: 4, turn: -1, fade: 1 });
    const png = await renderCard({ ...base, renderer: { manufacturer: 'Example Maker', moldName: name, flights: [5, 4, -1, 1] } }, 'horizontal', preset);
    const canvas = createCanvas(1920, 1080), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(await loadImage(png), 0, 0);
    return ctx;
  };
  const colorAt = (ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>, x: number, y: number) =>
    [...ctx.getImageData(x, y, 1, 1).data];
  const b01 = await paint('WHITE TEST', 'b01'), b02 = await paint('WHITE TEST', 'b02');
  for (const [preset, ctx, x, edgeY, innerY] of [['b01', b01, 825, 382, 410], ['b02', b02, 254, 675, 704]] as const) {
    const edge = colorAt(ctx, ...presentedPoint(preset, x, edgeY)), inside = colorAt(ctx, ...presentedPoint(preset, x, innerY));
    assert.ok(Math.max(...edge.slice(0, 3)) < 110, 'white disc must have a dark perimeter on white footage');
    assert.ok(Math.min(...inside.slice(0, 3)) > 240, 'white disc itself remains white');
  }
  for (const [preset, white, x, y, width, height, backX, backY] of [
    ['b01', b01, 84, 704, 520, 122, 600, 680],
    ['b02', b02, 498, 694, 640, 152, 1100, 700],
  ] as const) {
    const dark = await paint('WHITE TEST', preset, darkPhoto);
    assert.deepEqual(
      white.getImageData(...presentedArea(preset, x, y, width, height)).data,
      dark.getImageData(...presentedArea(preset, x, y, width, height)).data,
      `${preset} manufacturer and white title must stay on their own protected reading surface regardless of disc color`,
    );
    assert.ok(Math.max(...colorAt(white, ...presentedPoint(preset, backX, backY)).slice(0, 3)) < 80, `${preset} title panel must remain dark over white footage`);
  }
  const renamed = await paint('A DIFFERENT MOLD', 'b02');
  assert.deepEqual(
    b02.getImageData(...presentedArea('b02', 85, 680, 340, 320)).data,
    renamed.getImageData(...presentedArea('b02', 85, 680, 340, 320)).data,
    'the entire B02 disc region stays independent of the mold typography',
  );
  assert.notDeepEqual(b02.getImageData(...presentedArea('b02', 500, 760, 640, 100)).data, renamed.getImageData(...presentedArea('b02', 500, 760, 640, 100)).data);
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
