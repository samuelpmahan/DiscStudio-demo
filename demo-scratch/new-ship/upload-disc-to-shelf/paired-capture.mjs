/** Capture one settled UI action as creator and mounted actual PxC DevTools. */
export async function captureSettledAction(adapter, { label, action, settle, creatorPath, inspectorPath }) {
  required(adapter, ['begin', 'settle', 'sequence', 'showCreator', 'showInspector', 'screenshot', 'restore']);
  if (typeof action !== 'function' || typeof settle !== 'function') throw new TypeError('action and settle must be functions');
  const previousView = await adapter.currentView?.(), previousScroll = await adapter.currentScroll?.();
  if (previousView !== undefined && previousView !== 'creator' && previousView !== 'inspector') throw new Error(`unknown prior view: ${previousView}`);
  let primaryError;
  try {
    const ticket = await adapter.begin(label); await action(); await settle();
    const checkpoint = await adapter.settle(ticket), sequence = await adapter.sequence();
    if (!Number.isInteger(checkpoint?.settledEvent) || checkpoint.settledEvent < 0 || checkpoint.settledEvent > sequence) throw new Error('invalid settled checkpoint');
    if (sequence !== checkpoint.settledEvent) throw new Error(`events advanced before capture (${checkpoint.settledEvent} to ${sequence})`);
    if (adapter.assertCapturable) await adapter.assertCapturable();
    await adapter.showCreator(); await adapter.screenshot(creatorPath);
    if (await adapter.sequence() !== sequence) throw new Error('events advanced during creator screenshot; pair discarded');
    await adapter.showInspector(); await adapter.screenshot(inspectorPath);
    if (await adapter.sequence() !== sequence) throw new Error('events advanced during inspector screenshot; pair discarded');
    return Object.freeze({ checkpoint, timing: 'bounded-action-to-settled-screen', creatorPath, inspectorPath });
  } catch (error) { primaryError = error; throw error; }
  finally { try { await adapter.restore({ view: previousView, scroll: previousScroll }); } catch (restoreError) { if (primaryError) primaryError.restoreError = restoreError; else throw restoreError; } }
}
function required(adapter, names) { for (const name of names) if (typeof adapter?.[name] !== 'function') throw new TypeError(`capture adapter requires ${name}()`); }
