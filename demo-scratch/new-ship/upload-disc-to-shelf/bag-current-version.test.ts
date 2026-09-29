import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExperience, initialDraft } from './model.ts';

test('Today’s Bag resolves a kept shelf edit to the same physical disc without rewriting historical refs', async () => {
  const app = createExperience(() => {});
  const image = { kind: 'photo' as const, name: 'disc.webp', src: 'data:image/webp;base64,AAAA' };
  const original = await app.save(initialDraft(), image);
  const retainedBagAddress = app.bagAddress;
  const candidate = await app.updateDisc(original, { speed: 11 });
  await app.keepDisc(original, candidate);
  assert.equal(app.pxc.get(retainedBagAddress).value[0], original);
  assert.equal(app.bag()[0].address, candidate);
  assert.equal(app.bag()[0].disc.speed, 11);
  assert.equal(app.bag()[0].art, image.src);
  assert.equal(app.shelf()[0].address, candidate);
});
