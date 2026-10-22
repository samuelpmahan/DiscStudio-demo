import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawCard, cardFrameSnapshot } from './card-renderer-core.ts';

const photo = 'data:image/png;base64,eyJ3aGl0ZS1kaXNjLXBob3RvLWJ5dGVzIjoiZXhhY3QifQ==';
const sample = {
  id: 'appearance-disc', mold: 'ds.px.seed.buzzz', plastic: 'ESP', weight: 177,
  speed: 5, glide: 4, turn: -1, fade: 1,
  depiction: { kind: 'photo', src: photo },
  renderer: { moldName: 'Buzzz', manufacturer: 'Discraft', flights: [5, 4, -1, 1] },
};
function recordContext() {
  const calls = [];
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', font: '', textAlign: 'left', textBaseline: 'alphabetic',
    beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, closePath() {}, clip() {}, save() {}, restore() {},
    fill() { calls.push({ type: 'fill', fill: this.fillStyle }); }, stroke() {}, translate() {}, rotate() {},
    fillRect(x, y, w, h) { calls.push({ type: 'rect', x, y, w, h, fill: this.fillStyle }); },
    fillText(text, x, y, maxWidth) { calls.push({ type: 'text', text, x, y, maxWidth, fill: this.fillStyle, align: this.textAlign }); },
    drawImage(image, x, y, w, h) { calls.push({ type: 'image', x, y, w, h }); },
    measureText(text) { const size = Number.parseFloat(/([\d.]+)px/.exec(this.font)?.[1] ?? 16); return { width: [...text].length * size * .54, actualBoundingBoxAscent: size * .72 }; },
    createLinearGradient() { return { addColorStop() {} }; },
  };
  return { ctx, calls };
}
const env = { loadImage: async () => ({ width: 400, height: 400 }), getMoldDetails: async () => null };

test('U02/U05 honor outside-edge placement, accent, and digits-versus-tiles', async () => {
  for (const preset of ['u02', 'u05']) {
    const { ctx, calls } = recordContext();
    await drawCard(ctx, sample, 'vertical', preset, env, { discSide: 'right', highlightTarget: 'tiles', accentColor: '#336699' });
    const name = calls.find(c => c.type === 'text' && c.text === 'BUZZZ');
    assert.equal(name.align, 'right', preset);
    assert.ok(name.x > 540, `${preset} title on right outside edge`);
    const numerals = calls.filter(c => c.type === 'text' && ['5', '4', '-1', '1'].includes(c.text));
    assert.deepEqual(numerals.map(c => c.text), ['5', '4', '-1', '1']);
    assert.ok(numerals.every(c => c.fill === '#ffffff'), `${preset} accent tiles use contrast ink`);
    assert.ok(calls.some(c => c.fill === '#336699'), `${preset} uses chosen accent`);
    const details = calls.find(c => c.type === 'text' && c.text === 'DISCRAFT · ESP');
    assert.equal(details.align, 'right', `${preset} right edge detail alignment`);
    const photo = calls.find(c => c.type === 'image');
    assert.ok(photo.x + photo.w / 2 > 540, `${preset} photo moves with outside edge`);
  }
});

test('U02/U05 absent appearance keeps legacy rendering byte-for-byte at the draw-call level', async () => {
  for (const preset of ['u02', 'u05']) {
    const base = recordContext(), explicitDefaults = recordContext();
    await drawCard(base.ctx, sample, 'vertical', preset, env);
    // Appearance is intentionally opt-in; the historic look is the baseline.
    await drawCard(explicitDefaults.ctx, sample, 'vertical', preset, env, undefined);
    assert.deepEqual(explicitDefaults.calls, base.calls, preset);
  }
});

test('U03 appearance side overrides legacy id while absent appearance preserves the explicit mirror id', async () => {
  const legacy = await cardFrameSnapshot(sample, 'u03-front-mirror', env);
  const customLeft = await cardFrameSnapshot(sample, 'u03-front-mirror', env, { discSide: 'left', highlightTarget: 'digits', accentColor: '#336699' });
  const customRight = await cardFrameSnapshot(sample, 'u03-front', env, { discSide: 'right', highlightTarget: 'tiles', accentColor: '#336699' });
  const legacyLeft = await cardFrameSnapshot(sample, 'u03-front', env);
  const legacyRight = await cardFrameSnapshot(sample, 'u03-front-mirror', env);
  const imageX = scene => scene.layers.find(layer => layer.id === 'disc-photo').x;
  assert.equal(imageX(customLeft), imageX(legacyRight), 'disc left mirrors the spine composition');
  assert.equal(imageX(customRight), imageX(legacyLeft), 'disc right keeps the original right-side photo');
  assert.equal(imageX(legacy), imageX(legacyRight), 'absent appearance keeps the explicit mirror id');
});

test('U03/U04 apply selected accents and readable digit or tile emphasis', async () => {
  for (const [preset, target] of [['u03', 'digits'], ['u04', 'tiles']]) {
    const scene = await cardFrameSnapshot(sample, preset, env, { discSide: 'left', highlightTarget: target, accentColor: '#336699' });
    const drawn = recordContext();
    scene.layers.find(layer => layer.id === 'card-label').draw(drawn.ctx);
    const values = drawn.calls.filter(c => c.type === 'text' && ['5', '4', '-1', '1'].includes(c.text));
    assert.deepEqual(values.map(c => c.text), ['5', '4', '-1', '1'], preset);
    if (target === 'digits') assert.ok(values.every(c => c.fill === '#336699'), preset);
    else assert.ok(values.every(c => c.fill !== '#336699'), preset);
    assert.ok(drawn.calls.some(c => c.fill === '#336699'), `${preset} uses chosen accent`);
  }
  const u04Left = await cardFrameSnapshot(sample, 'u04', env, { discSide: 'left', highlightTarget: 'digits', accentColor: '#336699' });
  const u04Right = await cardFrameSnapshot(sample, 'u04', env, { discSide: 'right', highlightTarget: 'digits', accentColor: '#336699' });
  const photoX = scene => scene.layers.find(layer => layer.id === 'disc-photo').x;
  assert.equal(photoX(u04Left), 94, 'left group keeps its legacy safe-rail anchor');
  assert.equal(photoX(u04Right), 488.4, 'right group moves the hero with its panel');
});
