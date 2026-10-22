import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExperience, initialDraft } from './model.ts';
import { paintedDiscsEnabled } from './kompozition.ts';
import { validatePaintRecipe } from './paint-recipe.ts';
import { cloneCard } from './export-ui.ts';
import { resolveCardDisc } from './card-renderer-core.ts';
import { renderCard } from './card-renderer.ts';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { exportZip } from './export-queue.ts';

const photo = { kind: 'photo' as const, src: 'data:image/png;base64,iVBORw0KGgo=', name: 'retained-photo.png' };
const recipe = validatePaintRecipe({
  family: 'pressed-fern', seed: 41, base: '#98d4ba', accent: '#f8b393',
  target: 96, label: null, mode: 'split',
});
const painted = { kind: 'painted' as const, name: recipe.family, src: `./art/${recipe.family}.svg` };

test('photo-first base refuses a save without an uploaded photo', { skip: paintedDiscsEnabled }, async () => {
  const app = createExperience(() => {});
  await assert.rejects(app.selectDraftDepiction(), /No draft photo/);
  await assert.rejects(app.save(initialDraft(), painted, { recipe }), /photo/i);
  assert.equal(app.shelf().length, 0);
  assert.equal(app.bag().length, 0);
  assert.equal(app.events.some(event => event.event === 'disc.save.completed'), false);
});

test('painted-disc overlay saves real art and keeps photo and painting switchable', { skip: !paintedDiscsEnabled }, async () => {
  const app = createExperience(() => {});
  const selectedPainting = await app.selectDraftDepiction(() => 0);
  assert.equal(selectedPainting.kind, 'painted');
  assert.equal(selectedPainting.name, 'pressed-fern');
  const photoAddress = await app.addDraftPhoto(photo);
  const hydrated = await app.hydrateSeed(initialDraft().mold);
  const draft = { ...initialDraft(), mold: hydrated.address, nickname: 'Fern', plastic: 'ESP', weight: 177 };

  const address = await app.save(draft, selectedPainting, { recipe, photo });
  const saved = app.pxc.get(address).value;
  const savedArt = app.pxc.get(saved.art).value as string;
  assert.equal(saved.depiction.kind, 'painted');
  assert.match(savedArt, /^data:image\/svg\+xml;/);
  assert.equal(app.pxc.get(saved.paintRecipe).value.family, 'pressed-fern');
  assert.equal(app.pxc.get(saved.photo).value.src, photo.src);
  assert.equal(app.pxc.get(photoAddress).value.src, photo.src);

  for (const rows of [app.shelf(), app.bag()]) {
    assert.equal(rows.length, 1);
    assert.equal(rows[0].address, address);
    assert.equal(rows[0].disc.depiction.kind, 'painted');
    assert.equal(rows[0].art, savedArt);
  }

  const photoCandidate = await app.updateDepiction(address, { choice: 'photo' });
  assert.equal(app.pxc.get(photoCandidate).value.depiction.src, photo.src);
  assert.equal(app.pxc.get(app.pxc.get(photoCandidate).value.art).value, photo.src);
  assert.equal(app.pxc.get(app.pxc.get(photoCandidate).value.photo).value.src, photo.src);
  await app.keepDisc(address, photoCandidate);
  assert.equal(app.shelf()[0].address, photoCandidate);
  assert.equal(app.shelf()[0].disc.depiction.kind, 'photo');
  assert.equal(app.shelf()[0].art, photo.src);
  assert.equal(app.bag()[0].address, photoCandidate);
  assert.equal(app.bag()[0].art, photo.src);

  const paintedAgain = await app.updateDepiction(photoCandidate, { choice: 'painted' });
  assert.equal(app.pxc.get(paintedAgain).value.depiction.kind, 'painted');
  assert.match(app.pxc.get(app.pxc.get(paintedAgain).value.art).value, /^data:image\/svg\+xml;/);
  assert.equal(app.pxc.get(app.pxc.get(paintedAgain).value.photo).value.src, photo.src);
  await app.keepDisc(photoCandidate, paintedAgain);
  assert.equal(app.shelf()[0].disc.depiction.kind, 'painted');
  assert.equal(app.shelf()[0].art, app.pxc.get(app.shelf()[0].disc.art).value);
  assert.equal(app.pxc.get(app.shelf()[0].disc.photo).value.src, photo.src);
  assert.equal(app.bag()[0].address, paintedAgain);
  assert.equal(app.bag()[0].art, app.shelf()[0].art);
  const card = cloneCard(app.bag()[0], 'vertical', 'u02');
  assert.deepEqual((card.disc as any).renderer.flights, [5, 4, -1, 1]);
  assert.equal((card.disc as any).renderer.manufacturer, 'Discraft');
  assert.equal((card.disc as any).renderer.artSrc, app.bag()[0].art);
  assert.equal((await resolveCardDisc({}, card.disc as any)).photoSrc, app.bag()[0].art);
  const png = await renderCard(card.disc as any, 'vertical', 'u02');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(png.length > 10_000);
  const placeholderDisc: any = { ...card.disc, renderer: { ...(card.disc as any).renderer, artSrc: undefined } };
  const placeholder = await renderCard(placeholderDisc, 'vertical', 'u02');
  assert.notEqual(createHash('sha256').update(png).digest('hex'), createHash('sha256').update(placeholder).digest('hex'), 'painted output must differ from the fallback ring');
  const zip = await exportZip([card], { renderCard: item => renderCard(item.disc as any, item.orientation, item.cardDesign as any) });
  const entries = await JSZip.loadAsync(zip);
  const manifest = JSON.parse(await entries.file('manifest.json')!.async('string'));
  const packaged = await entries.file(manifest.cards[0].filename)!.async('nodebuffer');
  assert.equal(manifest.cardCount, 1);
  assert.equal(manifest.cards[0].width, 1080);
  assert.equal(manifest.cards[0].height, 1920);
  assert.equal(manifest.cards[0].sha256, createHash('sha256').update(packaged).digest('hex'));
  assert.deepEqual(packaged, png);
});
