import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCard, renderCardDataUrl, CARD_SIZE } from './card-renderer.ts';
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
