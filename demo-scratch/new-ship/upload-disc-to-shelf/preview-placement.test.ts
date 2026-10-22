import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneCard, fitPreviewPlacement, rescalePreviewPlacement } from './export-ui.ts';

const frame = { width: 1080, height: 1920 };
const bounds = [190, 260, 890, 1660];

test('checking a Bag disc can render repeatedly from a frozen placement', () => {
  const saved = Object.freeze({ scale: 1, dx: 0, dy: 0 });
  const first = fitPreviewPlacement(saved, frame, bounds, 1.1);
  const again = fitPreviewPlacement(first, frame, bounds, 1.1);
  assert.deepEqual(again, first);
  assert.equal(Object.isFrozen(first), false);
  assert.deepEqual(saved, { scale: 1, dx: 0, dy: 0 });
});

test('size slider changes a previously frozen placement without mutating it', () => {
  const placed = Object.freeze({ scale: 1, dx: .04, dy: -.02 });
  const resized = rescalePreviewPlacement(placed, 1.2, 1.1, frame, bounds);
  assert.equal(resized.scale, 1.1);
  assert.equal(placed.scale, 1);
  assert.equal(Object.isFrozen(resized), false);
  assert.deepEqual(fitPreviewPlacement(resized, frame, bounds, 1.1), resized);
});

test('card details travel with each exact card snapshot across orientations', () => {
  const row: any = { address: 'bag.1', disc: { id: 'disc-1', mold: 'ds.px.seed.buzzz', depiction: { kind: 'photo', src: 'data:image/png;base64,AA==' } }, seed: { name: 'Buzzz', manufacturer: 'Discraft', speed: 5, glide: 4, turn: -1, fade: 1 } };
  const appearance = { discSide: 'left' as const, highlightTarget: 'digits' as const, accentColor: '#336699' };
  const exact = cloneCard(row, 'vertical', 'u01', { scale: 1, dx: 0, dy: 0 }, appearance);
  assert.deepEqual(exact.cardAppearance, appearance);
  assert.deepEqual(cloneCard(row, 'vertical', 'u02', { scale: 1, dx: 0, dy: 0 }, appearance).cardAppearance, appearance);
  assert.deepEqual(cloneCard(row, 'horizontal', 'b05', { scale: 1, dx: 0, dy: 0 }, appearance).cardAppearance, appearance);
  assert.deepEqual(cloneCard(row, 'horizontal', 'b01').cardAppearance, { discSide: 'right', highlightTarget: 'digits', accentColor: '#c8f23d' });
});


test('held resize anchor returns to the same placement after edge clamping and reordered sizes', () => {
  const alphaBounds = [48, 530, 508, 1222];
  const anchor = Object.freeze({ scale: 1, dx: 0, dy: 0 });
  const derive = (scale: number) => rescalePreviewPlacement(anchor, scale, 1.5, frame, alphaBounds);
  const first125 = derive(1.25), at150 = derive(1.5);
  assert.equal(at150.scale, 1.5);
  assert.notEqual(at150.dx, anchor.dx); // Enlargement reaches the left frame boundary.
  assert.deepEqual(derive(.7), derive(.7));
  assert.deepEqual(derive(1.25), first125);
  assert.deepEqual(derive(1), anchor);
  // A real drag supplies a new anchor; neither anchor is mutated by resizing.
  const dragged = Object.freeze({ ...at150, dx: at150.dx + .04, dy: .03 });
  const afterDrag = rescalePreviewPlacement(dragged, 1, 1.5, frame, alphaBounds);
  assert.notDeepEqual(afterDrag, anchor);
  assert.deepEqual(anchor, { scale: 1, dx: 0, dy: 0 });
});
