import { openExperience } from './persistent-experience.ts';
import { startSandbox } from './experience-fixtures.ts';
import { mountExperiencePage } from './experience-page.ts';
import { clearLocalData } from './session-storage.ts';

async function main() {
const $ = (id: string) => document.getElementById(id)!;
const clearDataDialog = $('clear-local-data') as HTMLDialogElement;
const clearDataError = $('clear-local-data-error');
const clearDataConfirm = $('clear-local-data-confirm') as HTMLButtonElement;
$('clear-local-data-button').addEventListener('click', () => {
  clearDataError.textContent = '';
  clearDataDialog.showModal();
});
$('clear-local-data-cancel').addEventListener('click', () => clearDataDialog.close());
clearDataConfirm.addEventListener('click', () => {
  clearDataError.textContent = '';
  clearDataConfirm.disabled = true;
  try {
    const result = clearLocalData(window.localStorage);
    if (result.ok) location.reload();
    else {
      clearDataConfirm.disabled = false;
      clearDataError.textContent = result.removed.length ? 'Some local DiscStudio data was removed, but the rest could not be cleared. Your current session remains open.' : 'Local DiscStudio data could not be cleared. Your current session remains open.';
    }
  } catch {
    clearDataConfirm.disabled = false;
    clearDataError.textContent = 'Local DiscStudio data could not be accessed. Your current session remains open.';
  }
});
const requested = new URLSearchParams(location.search).get('sandbox');
const sandbox = requested === 'upload' || requested === 'shelf' ? requested : null;
const instrument = new URLSearchParams(location.search).get('instrument') === '1' || (window as any).__dsCaptureInstrumentation === true;
const lines: string[] = [];
const log = (event: Record<string, unknown>) => {
  const line = JSON.stringify(event);
  console.info(line);
  lines.push(line); $('receipts').textContent = lines.join('\n');
  // Pages is static. Keep receipts in PxC and the console; only a local demo server receives diagnostics.
  if (!sandbox && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) fetch(new URL('./events', location.href), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: line }).catch(() => console.warn('Terminal logging unavailable; receipt retained in PxC and console.'));
};
const experience = sandbox ? await startSandbox(sandbox, log) : await openExperience({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }, log);
// Instrumentation hook: expose experience immediately (before mount) when
// ?instrument=1 so the PxCube inspector strip can read live addresses
// even if mount throws.
if (instrument) {
  // Local capture groups synchronous log events with a later settled DOM.
  // It never claims a screenshot was taken at the exact emit call.
  let checkpointSerial = 0;
  Object.assign(window as any, {
    __dsExperience: experience,
    __dsScreenshot: {
      begin: (label: string) => Object.freeze({ id: `checkpoint-${++checkpointSerial}`, label, afterEvent: experience.events.length }),
      settle: (ticket: { id: string; label: string; afterEvent: number }) => {
        if (!Number.isInteger(ticket.afterEvent) || ticket.afterEvent < 0 || ticket.afterEvent > experience.events.length) throw Error('invalid screenshot checkpoint ticket');
        return Object.freeze({
          id: ticket.id, label: ticket.label, afterEvent: ticket.afterEvent,
          settledEvent: experience.events.length,
          events: experience.events.slice(ticket.afterEvent).map((event, index) => Object.freeze({ sequence: ticket.afterEvent + index + 1, event })),
          timing: 'bounded-action-to-settled-screen',
        });
      },
      sequence: () => experience.events.length,
    },
  });
}
await mountExperiencePage(experience, { sandbox, inspector: instrument });
if (instrument) (window as any).__dsScreenshotReady = true;
}
main();
