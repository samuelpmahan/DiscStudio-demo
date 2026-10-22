import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlacementGesture, createPreviewDrawScheduler } from './preview-draw-scheduler.mjs';

function frameClock() {
  let nextId = 0;
  const frames = new Map();
  return {
    frames,
    requestFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelFrame(id) { frames.delete(id); },
    runNext() { const [id, callback] = frames.entries().next().value ?? []; if (id === undefined) return false; frames.delete(id); callback(); return true; },
  };
}

test('rapid drag and resize inputs schedule one paint per animation frame', () => {
  const clock = frameClock(); let paints = 0;
  const preview = createPreviewDrawScheduler({ ...clock, draw: () => paints++ });
  for (let i = 0; i < 80; i++) preview.schedule();
  assert.equal(clock.frames.size, 1);
  assert.equal(paints, 0);
  clock.runNext();
  assert.equal(paints, 1);
  for (let i = 0; i < 20; i++) preview.schedule();
  clock.runNext();
  assert.equal(paints, 2);
  assert.equal(preview.pending, false);
});

test('flush paints the latest synchronous placement before review or approval', () => {
  const clock = frameClock(); let paints = 0;
  const preview = createPreviewDrawScheduler({ ...clock, draw: () => paints++ });
  preview.schedule(); preview.schedule();
  assert.equal(preview.flush(), true);
  assert.equal(paints, 1);
  assert.equal(clock.frames.size, 0);
  assert.equal(preview.flush(), false);
});

test('cancel discards a pending paint without changing the last placement', () => {
  const clock = frameClock(); let paints = 0;
  const preview = createPreviewDrawScheduler({ ...clock, draw: () => paints++ });
  preview.schedule();
  assert.equal(preview.cancel(), true);
  assert.equal(clock.frames.size, 0);
  assert.equal(paints, 0);
});

test('pointercancel keeps the last applied placement instead of reverting the drag', () => {
  const gesture = createPlacementGesture({ x: 0, y: 0 }, (start, point) => ({ x: point.x, y: point.y }));
  gesture.move({ x: 12, y: 9 });
  gesture.move({ x: 17, y: 13 });
  assert.deepEqual(gesture.cancel(), { x: 17, y: 13 });
  assert.deepEqual(gesture.finish(), { x: 17, y: 13 });
});
