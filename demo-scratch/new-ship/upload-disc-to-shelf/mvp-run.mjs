// MVP end-to-end: bag -> pick -> render cards -> queue -> zip.
// Run: node --experimental-strip-types mvp-run.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { createExperience, initialDraft } from './model.ts';
import { renderCard } from './card-renderer.ts';
import { queueCards, exportZip } from './export-queue.ts';

const outDir = './mvp-output';
mkdirSync(outDir, { recursive: true });

// 1. Create experience, add 3 discs to bag
const app = createExperience();
const discs = [
  { mold: 'ds.px.seed.buzzz', nickname: 'Workhorse', plastic: 'ESP', weight: 177 },
  { mold: 'ds.px.seed.destroyer', nickname: 'Bomber', plastic: 'Star', weight: 175 },
  { mold: 'ds.px.seed.buzzz', nickname: 'Beat Up', plastic: 'Z', weight: 178 },
];
for (const d of discs) {
  const draft = { ...initialDraft(), mold: d.mold, nickname: d.nickname, plastic: d.plastic, weight: d.weight };
  const photo = { kind: 'photo', src: 'data:image/png;base64,iVBORw0KGgo=', name: 'test.png' };
  await app.save(draft, photo);
}
const bag = app.bag();
console.log(`Bag: ${bag.length} discs`);

// 2. Pick 2 discs, render horizontal cards
const picks = [bag[0], bag[1]];
const items = picks.map(b => ({
  disc: b.disc,
  orientation: 'horizontal',
  cardDesign: 'spotlight',
}));
const queue = queueCards(items);
console.log(`Queue: ${queue.length} cards`);

// 3. Adapter: card-renderer -> export-queue interface
const realRenderer = async (card) => {
  const buf = await renderCard(card.disc, card.orientation);
  return new Uint8Array(buf);
};

// 4. Export zip with real cards
const zipBuf = await exportZip(queue, { renderCard: realRenderer });
writeFileSync(`${outDir}/discstudio-mvp-export.zip`, zipBuf);
console.log(`Zip: ${zipBuf.length} bytes -> ${outDir}/discstudio-mvp-export.zip`);

// 5. Also write individual PNGs for review
for (let i = 0; i < picks.length; i++) {
  const png = await renderCard(picks[i].disc, 'horizontal');
  writeFileSync(`${outDir}/card-${i + 1}-horizontal.png`, png);
  const pngV = await renderCard(picks[i].disc, 'vertical');
  writeFileSync(`${outDir}/card-${i + 1}-vertical.png`, pngV);
}
console.log(`Cards written to ${outDir}/`);
console.log('MVP run complete.');
