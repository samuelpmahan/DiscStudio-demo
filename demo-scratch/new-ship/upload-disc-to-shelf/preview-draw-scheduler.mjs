/** Coalesce rapid input events to one preview paint per animation frame. */
export function createPreviewDrawScheduler({ requestFrame, cancelFrame, draw }) {
  if (typeof requestFrame !== 'function' || typeof cancelFrame !== 'function' || typeof draw !== 'function') {
    throw new TypeError('Preview draw scheduler requires frame and draw functions.');
  }
  let pending = null;
  const schedule = () => {
    if (pending !== null) return;
    pending = requestFrame(() => {
      pending = null;
      draw();
    });
  };
  const flush = () => {
    if (pending === null) return false;
    const frame = pending;
    pending = null;
    cancelFrame(frame);
    draw();
    return true;
  };
  const cancel = () => {
    if (pending === null) return false;
    cancelFrame(pending);
    pending = null;
    return true;
  };
  return Object.freeze({ schedule, flush, cancel, get pending() { return pending !== null; } });
}

/** Preserve the last applied transform on both pointer-up and pointer-cancel. */
export function createPlacementGesture(initial, update) {
  if (!initial || typeof update !== 'function') throw new TypeError('Placement gesture requires an initial transform and update function.');
  let latest = initial;
  return Object.freeze({
    move(input) { latest = update(latest, input); return latest; },
    finish() { return latest; },
    cancel() { return latest; },
  });
}
