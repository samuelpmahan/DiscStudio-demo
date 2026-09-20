import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startSandbox, inspectExperience } from './experience-fixtures.ts';
import { initialDraft } from './model.ts';
import { mountUpload } from './upload-ui.ts';
import { mountShelf } from './shelf-ui.ts';
import { experiences } from './experiences.ts';

test('Experience modules import without starting an app or requiring the DOM', () => {
  assert.equal(typeof mountUpload, 'function'); assert.equal(typeof mountShelf, 'function');
  assert.equal(experiences.length, 2);
  assert.equal(experiences[1].variants[0].inspectable, false);
  assert.equal(experiences[1].variants[1].inspectable, true);
});
test('demo upload surface does not mount the catalog review workflow', () => {
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('./upload-ui.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /seed-review|Quick-check the seeds/);
  assert.doesNotMatch(ui, /showReview|scheduleIdle/);
  assert.match(ui, /seedOptions\(query\)/); // every query reaches the catalog index
});
test('isolated Upload and Shelf fixtures have independent stores and explicit starting material', async () => {
  const upload = await startSandbox('upload'), shelf = await startSandbox('shelf');
  assert.equal(upload.shelf().length, 0); assert.equal(shelf.shelf().length, 3);
  assert.notEqual(upload.pxc.get(initialDraft().mold), shelf.pxc.get(initialDraft().mold));
  const start = inspectExperience(shelf), original = shelf.shelf()[0].address;
  const edit = await shelf.updateDisc(original, { turn: 0 }); await shelf.keepDisc(original, edit);
  assert.equal(start.discs[0].resolved.turn, -1);
  assert.equal(inspectExperience(shelf).discs[0].resolved.turn, 0);
  assert.equal(upload.shelf().length, 0);
  const reset = await startSandbox('shelf');
  assert.deepEqual(inspectExperience(reset), start);
});
test('the same model naturally carries upload output into shelf editing', async () => {
  const context = await startSandbox('upload');
  await context.addDraftPhoto({ kind: 'photo', name: 'upload-fixture.png', src: 'data:image/png;base64,iVBORw0KGgo=' });
  const address = await context.save(initialDraft(), await context.selectDraftDepiction());
  assert.equal(context.shelf()[0].address, address);
  const candidate = await context.updateDisc(address, { turn: null }); await context.keepDisc(address, candidate);
  assert.equal(context.resolve(context.shelf()[0].disc).turn, null);
  assert.equal(context.pxc.get(candidate).composition.inputs.value, context.pxc.get(address));
});
