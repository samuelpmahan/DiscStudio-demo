import { mountUpload } from './upload-ui.ts';
import { createDiscView } from './disc-view.ts';
import { mountDevTools } from './devtools.mjs';
import { mountShelf } from './shelf-ui.ts';
import { inspectExperience } from './experience-fixtures.ts';
import { mountSandboxCase } from './sandbox-ui.ts';
import { mountExport } from './export-ui.ts';
import { printable } from './devtools-data.mjs';
import { Part } from '../part-first-kernel/src/pxc.mjs';
import type { createExperience } from './model.ts';

// One document per mounted instance. The caller owns context creation and lifetime.
// No context, DOM access or app boot occurs merely by importing this module.
export async function mountExperiencePage(experience: ReturnType<typeof createExperience>, { sandbox = null, inspector = false }: { sandbox?: 'upload' | 'shelf' | null; inspector?: boolean } = {}) {
const $ = (id: string) => document.getElementById(id)!;
const input = (id: string) => $(id) as HTMLInputElement;
Object.assign(window, { discStudio: experience });
const persistenceNotice = document.createElement('p'); persistenceNotice.id = 'persistence-status'; persistenceNotice.setAttribute('role', 'status');
document.querySelector('main')!.prepend(persistenceNotice);
const showPersistence = () => { persistenceNotice.textContent = experience.persistenceStatus; };
showPersistence();
$('status').textContent = experience.persistenceStatus;
document.addEventListener('click', () => setTimeout(showPersistence, 0));
document.addEventListener('submit', () => setTimeout(showPersistence, 0));
const devtools = (sandbox || inspector) ? mountDevTools(experience.pxc, { label: sandbox ? (sandbox === 'shelf' ? 'ExploreShelf · sandbox' : 'UploadDiscToShelf · sandbox') : 'DiscStudio · local instrumentation' }) : null;
const root = document.querySelector('main')!;
if (sandbox === 'upload') root.querySelector('.shelf-section')!.remove();
if (sandbox === 'shelf') for (const selector of ['.intro', '.workspace', '.seed-review']) root.querySelector(selector)!.remove();
// Shelf remains retained by PxC, while the tournament path is Today’s Bag.
const shelf = sandbox && sandbox !== 'upload' ? mountShelf(experience, createDiscView(experience), address => devtools!.open(address), { root }) : null;
if (!sandbox) root.querySelector<HTMLElement>('.shelf-section')!.hidden = true;
if (sandbox !== 'shelf') await mountUpload({ root, experience, onSaved: () => { shelf?.refresh(); document.dispatchEvent(new CustomEvent('discstudio:bag-changed')); }, ...(sandbox ? { random: () => 0 } : {}) });
if (!sandbox) mountExport(experience, { root });
let bridge: ReturnType<typeof mountSandboxCase> | null = null;
if (sandbox) {
  bridge = mountSandboxCase(sandbox, experience, address => devtools!.open(address));
  Object.assign(window, { experienceSandbox: bridge });
  const start = inspectExperience(experience);
  experience.pxc.set('ds.px.sandbox.start', new Part(start));
  const panel = document.createElement('details'); panel.id = 'sandbox-inspection';
  const summary = document.createElement('summary'); summary.textContent = 'Inspect this Experience · starting / ending PxC';
  const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Capture ending PxC';
  const inspectStart = document.createElement('button'); inspectStart.type = 'button'; inspectStart.textContent = 'Inspect starting Part'; inspectStart.onclick = () => devtools!.open('ds.px.sandbox.start');
  const result = document.createElement('pre'); result.id = 'sandbox-result'; result.textContent = printable({ starting: start });
  let captures = 0;
  button.onclick = () => { const ending = inspectExperience(experience), address = `ds.px.sandbox.end.${++captures}`; experience.pxc.set(address, new Part(ending)); result.textContent = printable({ starting: start, ending, endingAddress: address }); };
  panel.append(summary, inspectStart, button, result); root.prepend(panel);
}

return { experience, pxc: experience.pxc, devtools, sandbox: bridge };
}
