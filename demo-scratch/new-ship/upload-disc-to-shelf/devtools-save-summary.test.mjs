import test from 'node:test';
import assert from 'node:assert/strict';
import { Part } from '../part-first-kernel/src/pxc.mjs';
import { createExperience, initialDraft } from './model.ts';
import { summarizeSaveReceipt } from './devtools-data.mjs';

const photo = { kind: 'photo', src: 'data:image/webp;base64,AAAA', name: 'semantic-test.webp' };

test('Save receipt summary follows the live CREATE, Bag delta, and READ outputs', async () => {
  const app = createExperience(() => {});
  await app.addDraftPhoto(photo);
  const discAddress = await app.save(initialDraft(), await app.selectDraftDepiction());
  const operationId = discAddress.split('.').at(-1);
  const receiptAddress = 'ds.px.receipt.' + operationId;
  const summary = summarizeSaveReceipt(app.pxc, receiptAddress);

  assert.equal(summary.title, 'Saved Discraft Buzzz');
  assert.equal(summary.discAddress, discAddress);
  assert.equal(summary.create.verified, true);
  assert.deepEqual(summary.bag.added, [discAddress]);
  assert.equal(summary.bag.beforeCount, 0);
  assert.equal(summary.bag.afterCount, 1);
  assert.equal(summary.readback.disc.matches, true);
  assert.equal(summary.readback.shelf.matches, true);
  assert.equal(summary.readback.verified, true);
  assert.equal(summary.verified, true);
});

test('Save receipt summary refuses a receipt whose retained Bag cannot prove its claimed delta', async () => {
  const app = createExperience(() => {});
  await app.addDraftPhoto(photo);
  const discAddress = await app.save(initialDraft(), await app.selectDraftDepiction());
  const operationId = discAddress.split('.').at(-1);
  const original = app.pxc.get('ds.px.receipt.' + operationId).value;
  const tamperedBag = 'ds.px.bag.tampered';
  app.pxc.set(tamperedBag, new Part([discAddress, 'ds.px.disc.unrelated']));
  const tamperedReceipt = 'ds.px.receipt.save-tampered';
  app.pxc.set(tamperedReceipt, new Part({ ...original, operationId: 'save-tampered', bagAddress: tamperedBag }));

  const summary = summarizeSaveReceipt(app.pxc, tamperedReceipt);
  assert.equal(summary.bag.verified, false);
  assert.equal(summary.verified, false);
});
