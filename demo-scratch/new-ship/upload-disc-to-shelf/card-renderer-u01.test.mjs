import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawCard, legibleAccent, u01AccentContrastOnScorebug } from './card-renderer-core.ts';
import { renderCard } from './card-renderer.ts';

const MINT = '#8fe3ae';
const photo = 'data:image/png;base64,eyJ3aGl0ZS1kaXNjLXBob3RvLWJ5dGVzIjoiZXhhY3QifQ==';

function context() {
  const calls = [];
  const ctx = {
    fillStyle: '#000',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    closePath() {},
    clip() {},
    fill() { calls.push({ type: 'fill', fill: this.fillStyle }); },
    save() {},
    restore() {},
    stroke() { calls.push({ type: 'stroke', stroke: this.strokeStyle }); },
    fillRect(x, y, w, h) { calls.push({ type: 'rect', x, y, w, h, fill: this.fillStyle }); },
    fillText(text, x, y, maxWidth) { calls.push({ type: 'text', text, x, y, maxWidth, fill: this.fillStyle, font: this.font, align: this.textAlign }); },
    drawImage(image, x, y, w, h) { calls.push({ type: 'image', image, x, y, w, h }); },
    measureText(text) {
      const px = Number.parseFloat(/([\d.]+)px/.exec(this.font)?.[1] ?? '16');
      return { width: [...text].length * px * 0.54 };
    },
  };
  return { ctx, calls };
}

function disc(overrides = {}) {
  return {
    id: 'white-disc-u01',
    mold: 'ds.px.seed.buzzz',
    nickname: 'White disc',
    plastic: 'ESP',
    weight: 177,
    speed: 5, glide: 4, turn: -1, fade: 1,
    depiction: { kind: 'photo', src: photo, name: 'white-disc.png' },
    renderer: { moldName: 'Buzzz', manufacturer: 'Discraft', flights: [5, 4, -1, 1] },
    ...overrides,
  };
}

async function renderU01(input, appearance) {
  const { ctx, calls } = context();
  const loaded = [];
  await drawCard(ctx, input, 'vertical', 'u01', {
    loadImage: async src => { loaded.push(src); return { width: 400, height: 400 }; },
    getMoldDetails: async () => null,
  }, appearance);
  return { calls, loaded };
}

test('U01 keeps the white-disc photo input and puts manufacturer · plastic below accented flight tiles', async () => {
  const { calls, loaded } = await renderU01(disc());
  assert.deepEqual(loaded, [photo]);

  const rule = calls.find(call => call.type === 'rect' && call.x === 48 && call.y === 700 && call.w === 4);
  assert.deepEqual(rule, { type: 'rect', x: 48, y: 700, w: 4, h: 300, fill: MINT });

  const details = calls.find(call => call.type === 'text' && call.text === 'DISCRAFT · ESP');
  const flight = calls.find(call => call.type === 'text' && call.text === '5');
  assert.ok(flight && details);
  assert.equal(flight.fill, MINT);
  assert.equal(details.maxWidth, 460 - 56);
  assert.ok(flight.y < details.y);
  assert.ok(Number.parseFloat(/([\d.]+)px/.exec(details.font)?.[1]) <= 28);
  assert.equal(calls.some(call => call.type === 'text' && call.text.includes('177g')), false);

  const photoDraw = calls.find(call => call.type === 'image');
  assert.ok(photoDraw);
  assert.equal(photoDraw.image.width, 400);
  assert.equal(photoDraw.w, 380);
  assert.equal(photoDraw.h, 380);
});

test('U01 omits absent manufacturer and plastic without reserving empty lines', async () => {
  const { calls } = await renderU01(disc({ renderer: { moldName: 'Buzzz', manufacturer: '', flights: [5, 4, -1, 1] }, plastic: '', weight: null }));
  assert.equal(calls.some(call => call.type === 'text' && /DISCRAFT|ESP/.test(call.text)), false);
  const flight = calls.find(call => call.type === 'text' && call.text === '5');
  assert.ok(flight);
});

test('U01 fits a long manufacturer and plastic within its text column', async () => {
  const { calls } = await renderU01(disc({ renderer: { moldName: 'Buzzz', manufacturer: 'The Long Disc Manufacturer International', flights: [5, 4, -1, 1] } }));
  const manufacturer = calls.find(call => call.type === 'text' && call.text === 'THE LONG DISC MANUFACTURER INTERNATIONAL · ESP');
  assert.ok(manufacturer);
  const px = Number.parseFloat(/([\d.]+)px/.exec(manufacturer.font)?.[1]);
  assert.ok(px >= 12 && px <= 28);
  assert.equal(manufacturer.maxWidth, 460 - 56);
});

test('U01 omits the separator when plastic is unspecified', async () => {
  const { calls } = await renderU01(disc({ plastic: '' }));
  assert.ok(calls.some(call => call.type === 'text' && call.text === 'DISCRAFT'));
  assert.equal(calls.some(call => call.type === 'text' && call.text.includes(' · ')), false);
});

test('U02 and U05 put flight values before one manufacturer · plastic line', async () => {
  for (const preset of ['u02', 'u05']) {
    const { ctx, calls } = context();
    await drawCard(ctx, disc(), 'vertical', preset, {
      loadImage: async () => ({ width: 400, height: 400 }), getMoldDetails: async () => null,
    });
    const name = calls.find(call => call.type === 'text' && call.text === 'BUZZZ');
    const flight = calls.find(call => call.type === 'text' && call.text === '5');
    const details = calls.find(call => call.type === 'text' && call.text === 'DISCRAFT · ESP');
    assert.ok(name && flight && details, preset);
    assert.ok(name.y < flight.y && flight.y < details.y, preset);
    assert.equal(calls.some(call => call.type === 'text' && call.text.includes('177g')), false);
  }
});

test('U01 default output matches the shipped right-rail accent-digits settings', async () => {
  const baseline = await renderU01(disc());
  const explicit = await renderU01(disc(), { discSide: 'right', highlightTarget: 'digits', accentColor: '#8fe3ae' });
  assert.deepEqual(explicit, baseline);
});

test('U01 right rail keeps the shipped compact footprint and exact photo placement', async () => {
  const { calls, loaded } = await renderU01(disc(), { discSide: 'right', highlightTarget: 'digits', accentColor: '#8fe3ae' });
  assert.deepEqual(loaded, [photo]);
  assert.ok(calls.some(call => call.type === 'rect' && call.x === 48 && call.y === 700 && call.w === 4));
  const photoDraw = calls.find(call => call.type === 'image');
  assert.equal(photoDraw.x, 120, 'same 380px photo circle at the prior x=310 center');
  const title = calls.find(call => call.type === 'text' && call.text === 'BUZZZ');
  assert.equal(title.align, 'left');
  assert.equal(title.x, 76);
});

test('U01 left rail reflects content inside its local footprint without flipping photo pixels or flight order', async () => {
  const { calls, loaded } = await renderU01(disc(), { discSide: 'left', highlightTarget: 'digits', accentColor: '#336699' });
  assert.deepEqual(loaded, [photo]);
  const rule = calls.find(call => call.type === 'rect' && call.y === 700 && call.h === 300 && call.w === 4);
  assert.equal(rule.x, 504);
  assert.equal(rule.fill, '#336699');
  const photoDraw = calls.find(call => call.type === 'image');
  assert.equal(photoDraw.x, 56, 'photo circle reflects around the center of the existing scorebug footprint');
  const title = calls.find(call => call.type === 'text' && call.text === 'BUZZZ');
  assert.equal(title.align, 'right');
  assert.equal(title.x, 480);
  const tiles = calls.filter(call => call.type === 'text' && ['5', '4', '-1', '1'].includes(call.text));
  assert.deepEqual(tiles.map(call => call.text), ['5', '4', '-1', '1']);
  assert.ok(tiles.every(call => call.align === 'center' && call.fill === legibleAccent('#336699', '#38413e')), 'dark accent digits are lifted just enough to read');
  assert.ok(calls.some(call => call.type === 'stroke' && call.stroke === 'rgba(51,102,153,0.9)'), 'photo rim follows the selected accent');
});

test('U01 tile highlight colors the four blocks and chooses a readable contrasting ink', async () => {
  const { calls } = await renderU01(disc(), { discSide: 'left', highlightTarget: 'tiles', accentColor: '#888888' });
  const flight = calls.filter(call => call.type === 'text' && ['5', '4', '-1', '1'].includes(call.text));
  assert.deepEqual(flight.map(call => call.text), ['5', '4', '-1', '1']);
  assert.ok(flight.every(call => call.align === 'center' && call.fill === '#111820'), 'mid-light blocks keep the established dark ink when it meets 4.5:1');
  assert.equal(calls.filter(call => call.type === 'fill' && call.fill === '#888888').length, 4);
});

test('U01 keeps recipe-neutral backing and lifts dark digit accents just enough to read', async () => {
  const dark = await renderU01(disc(), { discSide: 'right', highlightTarget: 'digits', accentColor: '#333333' });
  const mid = await renderU01(disc(), { discSide: 'right', highlightTarget: 'digits', accentColor: '#777777' });
  const brick = await renderU01(disc(), { discSide: 'right', highlightTarget: 'digits', accentColor: '#cc5533' });
  const light = await renderU01(disc(), { discSide: 'right', highlightTarget: 'digits', accentColor: '#8fe3ae' });
  const tileFills = (result) => result.calls.filter(call => call.type === 'fill').map(call => call.fill);
  assert.deepEqual(tileFills(dark).slice(0, 4), ['#38413e', '#38413e', '#38413e', '#38413e']);
  assert.deepEqual(tileFills(mid).slice(0, 4), ['#38413e', '#38413e', '#38413e', '#38413e']);
  assert.deepEqual(tileFills(brick).slice(0, 4), ['#38413e', '#38413e', '#38413e', '#38413e']);
  assert.deepEqual(tileFills(light).slice(0, 4), ['#38413e', '#38413e', '#38413e', '#38413e'], 'default MINT keeps the shipped dark tile blocks');
  for (const [result, accent] of [[dark, '#333333'], [mid, '#777777'], [brick, '#cc5533'], [light, '#8fe3ae']]) assert.ok(result.calls.filter(call => call.type === 'text' && ['5', '4', '-1', '1'].includes(call.text)).every(call => call.fill === legibleAccent(accent, '#38413e')));
  assert.equal(legibleAccent('#8fe3ae', '#38413e'), '#8fe3ae', 'readable accents are used exactly');
  const grayBlocks = await renderU01(disc(), { discSide: 'left', highlightTarget: 'tiles', accentColor: '#777777' });
  assert.ok(grayBlocks.calls.filter(call => call.type === 'text' && ['5', '4', '-1', '1'].includes(call.text)).every(call => call.fill === '#000000'), 'pure black closes the #777777 threshold gap');
});

test('U01 warns when the selected accent has low contrast on the dark scorebug', () => {
  assert.ok(u01AccentContrastOnScorebug('#777777') < 4.5);
  assert.ok(u01AccentContrastOnScorebug('#8fe3ae') >= 4.5);
});

test('U02 applies shared Card Details side and accent controls', async () => {
  const baseline = await renderCard(disc(), 'vertical', 'u02');
  const candidate = await renderCard(disc(), 'vertical', 'u02', { discSide: 'right', highlightTarget: 'tiles', accentColor: '#336699' });
  assert.notDeepEqual(candidate, baseline);
});
