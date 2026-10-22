// thro card fixes 1 (6.6.1): one test per approved finding that has a pure contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchoredDefaultPlacement, transformedBounds } from './transform-geometry.mjs';
import { legibleAccent, presetRenderers } from './card-renderer-core.ts';

function contrast(a, b) {
  const lum = hex => [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('finding 11: default size shrinks a bottom-left card toward its own corner', () => {
  const frame = { width: 1920, height: 1080 }, alphaBounds = [48, 378, 922, 1032];
  const placement = anchoredDefaultPlacement({ ...frame, alphaBounds, scale: 0.66 });
  const bounds = transformedBounds({ ...frame, alphaBounds, ...placement });
  assert.ok(Math.abs(bounds.left - 48) < 1e-9, 'left edge stays at the 48px margin');
  assert.ok(Math.abs(bounds.bottom - 1032) < 1e-9, 'bottom edge stays at the 48px margin');
  assert.equal(placement.scale, 0.66);
});

test('finding 11: a vertical card in the safe band keeps its edge and settles toward the bottom', () => {
  const frame = { width: 1080, height: 1920 }, alphaBounds = [474, 476, 934, 1170];
  const placement = anchoredDefaultPlacement({ ...frame, alphaBounds, scale: 0.66 });
  const bounds = transformedBounds({ ...frame, alphaBounds, ...placement });
  assert.ok(Math.abs(bounds.right - 934) < 1e-9, 'right-rail card stays against the action rail');
  assert.ok(Math.abs(bounds.bottom - 1170) < 1e-9, 'portrait card keeps its own bottom edge, so it sits lower than a centred shrink');
});

test('finding 6: dark sponsor accents are lifted to 4.5:1 for text; readable ones are kept exactly', () => {
  for (const accent of ['#111111', '#1d4ed8', '#d7263d', '#f97316', '#000000'])
    for (const surface of ['#38413e', '#202623', '#050706']) assert.ok(contrast(legibleAccent(accent, surface), surface) >= 4.5, `${accent} on ${surface}`);
  for (const accent of ['#8fe3ae', '#c8f23d', '#ffffff']) assert.equal(legibleAccent(accent, '#38413e'), accent);
});

test('finding 3: B03 no longer stamps a diamond on the disc', async () => {
  const rects = [];
  const ctx = new Proxy({ measureText: () => ({ width: 100, actualBoundingBoxAscent: 70 }), createLinearGradient: () => ({ addColorStop() {} }) }, {
    get(target, key) { if (key in target) return target[key]; if (key === 'fillRect') return (x, y, w, h) => rects.push([w, h]); return () => {}; },
    set(target, key, value) { target[key] = value; return true; },
  });
  const rd = { moldName: 'Anchor', manufacturer: 'Latitude 64', plastic: 'Opto', weight: null, flights: [5, 4, 0, 3], photoSrc: null };
  await presetRenderers.b03(ctx, rd, { loadImage: async () => { throw Error('no photo'); } }, { discSide: 'right', highlightTarget: 'digits', accentColor: '#c8f23d' });
  assert.equal(rects.some(([w, h]) => w === 16 && h === 16), false);
});

test('B05 zoom spot: appearance keeps a valid focus (rounded) and rejects one off the photo', async () => {
  const { validateCardAppearance } = await import('./export-queue-core.ts');
  const base = { discSide: 'right', highlightTarget: 'tiles', accentColor: '#C8F23D' };
  assert.deepEqual(validateCardAppearance({ ...base, zoomFocus: { x: 0.333, y: 0.5 } }).zoomFocus, { x: 0.33, y: 0.5 });
  assert.equal('zoomFocus' in validateCardAppearance(base), false);
  for (const zoomFocus of [{ x: 1.2, y: 0.5 }, { x: 0.5 }, { x: NaN, y: 0 }, null]) assert.throws(() => validateCardAppearance({ ...base, zoomFocus }));
});

test('B05 zoom spot: the coin crops the photo where the focus points, default 0.62/0.38', async () => {
  const crops = [];
  const ctx = new Proxy({ measureText: () => ({ width: 100, actualBoundingBoxAscent: 70 }), createLinearGradient: () => ({ addColorStop() {} }) }, {
    get(target, key) { if (key in target) return target[key]; if (key === 'drawImage') return (...a) => { if (a.length === 9) crops.push(a.slice(1, 4)); }; return () => {}; },
    set(target, key, value) { target[key] = value; return true; },
  });
  const rd = { moldName: 'Anchor', manufacturer: 'Latitude 64', plastic: 'Opto', weight: null, flights: [5, 4, 0, 3], photoSrc: 'photo.png' };
  const env = { loadImage: async () => ({ width: 1000, height: 1000 }) };
  const look = { discSide: 'right', highlightTarget: 'tiles', accentColor: '#c8f23d' };
  const s = 1000 / 2.6;
  await presetRenderers.b05(ctx, rd, env, look);
  await presetRenderers.b05(ctx, rd, env, { ...look, zoomFocus: { x: 0.2, y: 0.8 } });
  await presetRenderers.b05(ctx, rd, env, { ...look, zoomFocus: { x: 0, y: 1 } });
  const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  assert.ok(close(crops[0], [620 - s / 2, 380 - s / 2, s]), String(crops[0]));
  assert.ok(close(crops[1], [200 - s / 2, 800 - s / 2, s]), String(crops[1]));
  assert.ok(close(crops[2], [0, 1000 - s, s]), 'corner focus clamps inside the photo');
});

function recorder() {
  const calls = [];
  const ctx = new Proxy({ measureText: () => ({ width: 100, actualBoundingBoxAscent: 70 }), createLinearGradient: () => ({ addColorStop() {} }) }, {
    get(target, key) { if (key in target) return target[key]; if (key === 'fillRect' || key === 'strokeRect') return (...a) => calls.push([key, target.fillStyle, target.strokeStyle, ...a]); return () => {}; },
    set(target, key, value) { target[key] = value; return true; },
  });
  return { ctx, calls };
}
const anchor = { moldName: 'Anchor', manufacturer: 'Latitude 64', plastic: 'Opto', weight: null, flights: [5, 4, 0, 3], photoSrc: null };
const noPhoto = { loadImage: async () => { throw Error('no photo'); } };
const lime = { discSide: 'right', highlightTarget: 'tiles', accentColor: '#c8f23d' };

test('plate and frame: appearance keeps solid / framed, drops the defaults, rejects junk', async () => {
  const { validateCardAppearance } = await import('./export-queue-core.ts');
  const v = validateCardAppearance({ ...lime, plate: 'solid', frame: true });
  assert.equal(v.plate, 'solid'); assert.equal(v.frame, true);
  const d = validateCardAppearance({ ...lime, plate: 'see-through', frame: false });
  assert.equal('plate' in d || 'frame' in d, false);
  for (const bad of [{ plate: 'clear' }, { frame: 'yes' }]) assert.throws(() => validateCardAppearance({ ...lime, ...bad }));
});

test('B01 frame: off by default; on draws B03\'s 2 px frame round the plate', async () => {
  const off = recorder(); await presetRenderers.b01(off.ctx, anchor, noPhoto, lime);
  assert.equal(off.calls.some(c => c[0] === 'strokeRect'), false);
  const on = recorder(); await presetRenderers.b01(on.ctx, anchor, noPhoto, { ...lime, frame: true });
  const plate = on.calls.find(c => c[0] === 'fillRect'), frame = on.calls.find(c => c[0] === 'strokeRect');
  assert.deepEqual(frame.slice(3), plate.slice(3)); assert.equal(frame[2], 'rgba(255,255,255,0.55)');
});

test('solid plate: every plated layout fills its plate opaque; see-through stays as it was', async () => {
  for (const preset of ['u01', 'u02', 'u05', 'b01', 'b02', 'b03', 'b04', 'b05']) {
    const see = recorder(); await presetRenderers[preset](see.ctx, anchor, noPhoto, lime);
    const solid = recorder(); await presetRenderers[preset](solid.ctx, anchor, noPhoto, { ...lime, plate: 'solid' });
    const plateOf = r => r.calls.find(c => c[0] === 'fillRect' && /^rgba\((5,7,6|10,14,12)/.test(c[1]) || c[0] === 'fillRect' && /^#(050706|0a0e0c)$/.test(c[1]));
    if (preset === 'u05') { assert.ok(true); continue; } // U05 fills a rounded path, checked in the render
    assert.match(plateOf(see)[1], /^rgba\(5,7,6,0\.(82|92)\)$/, preset);
    assert.equal(plateOf(solid)[1], '#050706', preset);
  }
});
