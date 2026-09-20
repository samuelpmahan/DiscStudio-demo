import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { openExperience } from './persistent-experience.ts';
import { initialDraft } from './model.ts';
import { composeRimFitCrop } from './rimfit.ts';
import { clampCropSelection } from './upload-ui.ts';
import { cropForSourceSamples } from './crop-geometry.ts';

test('RimFit correction remains transient while a photo-only save restores', async () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
  const app = await openExperience(storage, () => {});
  const canvas = createCanvas(96, 96), ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1c2930'; ctx.fillRect(0, 0, 96, 96); ctx.fillStyle = '#75b7db'; ctx.beginPath(); ctx.ellipse(48, 48, 34, 31, .2, 0, Math.PI * 2); ctx.fill();
  const fit = await composeRimFitCrop(app.pxc, { width: 96, height: 96 }, canvas as any, 1, { clampCropSelection, cropForSourceSamples });
  assert.ok(['accepted', 'abstained'].includes(fit.proposal.status));
  await app.addDraftPhoto({ kind: 'photo', name: 'rimfit.png', src: 'data:image/png;base64,iVBORw0KGgo=' });
  const depiction = await app.selectDraftDepiction(), hydrated = await app.hydrateSeed(initialDraft().mold);
  await app.save({ ...initialDraft(), mold: hydrated.address, plastic: 'ESP' }, depiction);
  const raw = values.get('discstudio.pxc.shelf.v1')!;
  assert.doesNotMatch(raw, /(?:PhotoIntake|CircleFit|CropEdit)\.rimfit/);
  const restored = await openExperience(storage, () => {});
  assert.equal(restored.bag().length, 1);
  assert.match(restored.persistenceStatus, /Restored Today’s Bag/);
});
