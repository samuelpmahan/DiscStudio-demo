import { createCaseRun, stepsFor, type CaseControls } from './sandbox-cases.ts';
import type { createExperience } from './model.ts';

export function mountSandboxCase(name: 'upload' | 'shelf', experience: ReturnType<typeof createExperience>, inspect: (address: string) => void) {
  const control = (selector: string) => {
    const node = document.querySelector<HTMLInputElement>(selector);
    if (!node || node.disabled) throw Error(`Control unavailable: ${selector}`);
    node.scrollIntoView({ block: 'nearest' }); return node;
  };
  const ui: CaseControls = {
    input(selector, value) {
      const node = control(selector); node.focus();
      if (typeof value === 'boolean') node.checked = value; else node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
    },
    click(selector) { control(selector).click(); },
    text(selector) { return document.querySelector(selector)?.textContent?.trim() ?? ''; },
    enabled(selector) { const node = document.querySelector<HTMLInputElement>(selector); return !!node && !node.disabled; },
    async until(predicate) {
      const deadline = performance.now() + 15000;
      while (!predicate()) { if (performance.now() > deadline) throw Error('Action did not reach its expected boundary within 15 s; inspect the page and retained Parts.'); await new Promise(resolve => setTimeout(resolve, 30)); }
    },
  };
  const runner = createCaseRun(experience, name, stepsFor(name, experience, ui));
  const panel = document.createElement('section'); panel.id = 'sandbox-case'; panel.className = 'sandbox-case';
  panel.innerHTML = `<h2>Debug this Experience</h2><p>Each action uses the visible controls, then checks this page’s actual Parts. Inspect the result and record what the interaction needs.</p>
    <p id="case-next-label"></p><button id="case-next" type="button">Next action</button> <button id="case-play" type="button">Run remaining actions</button>
    <p id="case-status" role="status">Not run · visual review pending</p><ol id="case-results"></ol>
    <button id="case-export" type="button">Export this Case report</button>
    <details><summary>Your review · separate from test results</summary><form id="case-review">
      <label>Judgment<select id="case-verdict"><option value="needs-work">Needs work</option><option value="ready-to-combine">Ready to combine</option></select></label>
      <label>What worked, what needs changing, or what is still uncertain<textarea id="case-notes" required rows="3"></textarea></label>
      <button type="submit">Record this review</button><p id="case-review-status" role="status">No human review recorded.</p>
    </form></details>`;
  document.querySelector('main')!.prepend(panel);
  const get = (id: string) => panel.querySelector<HTMLElement>(`#${id}`)!;
  let playing = false, active = false, playGeneration = 0;
  function render() {
    const state = runner.state();
    (get('case-next') as HTMLButtonElement).disabled = active || playing || state.done || state.failed;
    (get('case-play') as HTMLButtonElement).disabled = !playing && (active || state.done || state.failed);
    get('case-play').textContent = playing ? 'Pause after this action' : 'Run remaining actions';
    get('case-next-label').textContent = runner.steps[state.next]?.name ?? 'All actions completed. Try it yourself and inspect the result.';
    get('case-results').replaceChildren(...state.records.map(address => {
      const result = experience.pxc.get(address).value, item = document.createElement('li');
      const title = document.createElement('strong'); title.textContent = `${result.passed ? 'Pass' : 'Fail'} · ${result.name}`;
      const checks = document.createElement('ul');
      for (const check of result.checks) { const row = document.createElement('li'); row.textContent = `${check.pass ? '✓' : '✕'} ${check.name}`; checks.append(row); }
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Inspect actual Parts'; button.onclick = () => inspect(address);
      item.append(title, checks, button); return item;
    }));
  }
  async function advance() {
    if (active) return; active = true; render();
    get('case-status').textContent = `Running action ${runner.state().next + 1}…`;
    try {
      // Paint the running state before the real handler starts.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await runner.next(); const state = runner.state();
      get('case-status').textContent = state.failed ? 'A check failed. State retained for debugging; reset for a fresh Case.' : `${state.next}/${state.total} actions checked. Visual review is still yours.`;
    } catch (error) { get('case-status').textContent = `Case runner failed: ${String(error)}`; playing = false; }
    finally { active = false; render(); }
  }
  get('case-next').onclick = advance;
  get('case-play').onclick = async () => {
    if (playing) { playing = false; playGeneration++; render(); return; }
    const generation = ++playGeneration;
    playing = true; render();
    while (generation === playGeneration && playing && !runner.state().done && !runner.state().failed) { await advance(); if (playing) await new Promise(resolve => setTimeout(resolve, 700)); }
    if (generation === playGeneration) { playing = false; render(); }
  };
  get('case-review').onsubmit = event => {
    event.preventDefault();
    try {
      const address = runner.review((get('case-verdict') as HTMLSelectElement).value as 'needs-work' | 'ready-to-combine', (get('case-notes') as HTMLTextAreaElement).value);
      get('case-review-status').textContent = `Recorded ${address} for the current state. Later edits are not covered.`;
    } catch (error) { get('case-review-status').textContent = String(error); }
  };
  get('case-export').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(runner.report(), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${name}-case.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  render(); return Object.freeze({ name, experience, pxc: experience.pxc, runner, inspect });
}
