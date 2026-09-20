// Render the 5 Upright SpotlightCard presets for Sam's review.
// Run: node --experimental-strip-types render-presets.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { renderCard } from './card-renderer.ts';

/** Synthetic disc photo: acid-green disc with shading, inner ring, stamp. */
function makeTestPhoto() {
  const s = 640;
  const c = createCanvas(s, s);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(s * 0.38, s * 0.34, 40, s / 2, s / 2, s / 2);
  g.addColorStop(0, '#e4ff70');
  g.addColorStop(0.55, '#c8f23d');
  g.addColorStop(1, '#7fa32a');
  x.fillStyle = g;
  x.beginPath();
  x.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
  x.fill();
  x.strokeStyle = 'rgba(20,30,10,0.35)';
  x.lineWidth = 10;
  x.beginPath();
  x.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2);
  x.stroke();
  x.fillStyle = 'rgba(20,30,10,0.55)';
  x.textAlign = 'center';
  x.font = '900 84px sans-serif';
  x.fillText('BUZZZ', s / 2, s * 0.47);
  x.font = '600 30px sans-serif';
  x.fillText('ESP', s / 2, s * 0.57);
  return `data:image/png;base64,${c.toBuffer('image/png').toString('base64')}`;
}

const disc = {
  id: 'disc-buzzz-1',
  mold: 'ds.px.seed.buzzz',
  nickname: 'Workhorse',
  plastic: 'ESP',
  weight: 177,
  speed: null, glide: null, turn: null, fade: null,
  depiction: { kind: 'photo', src: makeTestPhoto(), name: 'buzzz.png' },
};

mkdirSync('./mvp-output', { recursive: true });
for (const p of ['u01', 'u02', 'u03', 'u04', 'u05']) {
  const buf = await renderCard(disc, 'vertical', p);
  const path = `./mvp-output/preset-${p}.png`;
  writeFileSync(path, buf);
  console.log(p, buf.length, 'bytes ->', path);
}
console.log('done');
