// Render the 5 Breakout SpotlightCard presets for Sam's review.
// Run: node --experimental-strip-types render-breakout.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { renderCard } from './card-renderer.ts';

/** Synthetic disc photo: white disc, teal stamp, off-center detail for the macro coin. */
function makeDiscPhoto(label) {
  const S = 1024;
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext('2d');
  const cx = S / 2, cy = S / 2, r = 500;
  const g = ctx.createRadialGradient(cx - 120, cy - 140, 80, cx, cy, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.75, '#e9edf0');
  g.addColorStop(1, '#c3c9ce');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // Rim.
  ctx.strokeStyle = '#98a0a6';
  ctx.lineWidth = 26;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 14, 0, Math.PI * 2);
  ctx.stroke();
  // Stamp ring + mold name.
  ctx.strokeStyle = '#0f5c46';
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.arc(cx, cy, 300, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#0f5c46';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 150px "Noto Sans","DejaVu Sans",sans-serif';
  ctx.fillText(label, cx, cy - 30);
  ctx.font = '700 52px "DejaVu Sans Mono",monospace';
  ctx.fillText('MID-RANGE', cx, cy + 105);
  // Off-center detail so the B05 macro coin shows something interesting.
  ctx.fillStyle = '#0f5c46';
  ctx.beginPath();
  ctx.arc(cx + 330, cy - 190, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 64px "Noto Sans","DejaVu Sans",sans-serif';
  ctx.fillText('Z', cx + 330, cy - 188);
  return `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`;
}

const disc = {
  id: 'test-buzzz',
  mold: 'ds.px.seed.buzzz',
  nickname: 'Workhorse',
  plastic: 'ESP',
  weight: 177,
  speed: null, glide: null, turn: null, fade: null,
  depiction: { kind: 'photo', src: makeDiscPhoto('BUZZZ'), name: 'buzzz.png' },
};

mkdirSync('./mvp-output', { recursive: true });
for (const p of ['b01', 'b02', 'b03', 'b04', 'b05']) {
  const png = await renderCard(disc, 'horizontal', p);
  const path = `./mvp-output/preset-${p}.png`;
  writeFileSync(path, png);
  console.log(`${p}: ${png.length} bytes -> ${path}`);
}
console.log('done');
