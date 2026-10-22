import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { presetRenderers, type CardPreset } from './card-renderer-core.ts';

const presets: CardPreset[] = ['b01', 'b02', 'b03', 'b04', 'b05'];
const env = { loadImage: async () => null };
const resolved = { moldName: 'Long Mold Name Example', manufacturer: 'Discraft', plastic: 'ESP', weight: 177, flights: [5, 4, -1, 1], photoSrc: null };

test('breakout appearance options render on either edge without clipping the canvas', async () => {
  for (const preset of presets) for (const discSide of ['left', 'right'] as const) {
    const canvas = createCanvas(1920, 1080);
    await presetRenderers[preset](canvas.getContext('2d'), resolved, env, {
      discSide, highlightTarget: 'digits', accentColor: '#ef39ae',
    });
    const png = canvas.toBuffer('image/png');
    assert.equal(png.readUInt32BE(16), 1920, `${preset}/${discSide} width`);
    assert.equal(png.readUInt32BE(20), 1080, `${preset}/${discSide} height`);
    const ctx = canvas.getContext('2d');
    for (const [x, y] of [[0, 0], [1919, 0], [0, 1079], [1919, 1079]]) {
      assert.equal(ctx.getImageData(x, y, 1, 1).data[3], 0, `${preset}/${discSide} canvas corner remains clear`);
    }
  }
});

test('breakout tile and digit highlighting both render for each preset', async () => {
  for (const preset of presets) for (const highlightTarget of ['digits', 'tiles'] as const) {
    const canvas = createCanvas(1920, 1080);
    await presetRenderers[preset](canvas.getContext('2d'), resolved, env, {
      discSide: 'right', highlightTarget, accentColor: '#c8f23d',
    });
    assert.ok(canvas.toBuffer('image/png').length > 10_000, `${preset}/${highlightTarget} has visible output`);
  }
});

test('dark digit accents keep the recipe-neutral tile surface', async () => {
  const canvas = createCanvas(1920, 1080);
  await presetRenderers.b01(canvas.getContext('2d'), resolved, env, {
    discSide: 'right', highlightTarget: 'digits', accentColor: '#000000',
  });
  // B01 first flight tile starts at (84, 914) on the fitted 330px plate; sample its clear upper interior.
  const pixel = canvas.getContext('2d').getImageData(110, 920, 1, 1).data;
  assert.deepEqual([...pixel], [32,38,35,255]);
});
