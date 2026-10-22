import { Part } from '../part-first-kernel/src/pxc.mjs';
import { inspectExperience } from './experience-fixtures.ts';
import type { createExperience } from './model.ts';

type Experience = ReturnType<typeof createExperience>;
export type Check = { name: string; pass: boolean };
export type CaseStep = { name: string; run(): Promise<{ checks: Check[]; refs: string[] }> };
export type CaseControls = {
  input(selector: string, value: string | boolean): void;
  click(selector: string): void;
  text(selector: string): string;
  enabled(selector: string): boolean;
  until(predicate: () => boolean): Promise<void>;
};

// These Cases operate the page's controls; domain writes stay in its handlers.
export function stepsFor(name: 'upload' | 'shelf', experience: Experience, ui: CaseControls): CaseStep[] {
  if (name === 'upload') return [
    { name: 'Set an ESP Buzzz, 174 g, painting seed 123 and a fixed label', async run() {
      ui.input('#mold-search', 'Buzzz'); ui.input('#plastic', 'ESP'); ui.input('#weight', '174');
      ui.input('#paint-seed', '123'); ui.input('#customize-label', true); ui.input('#paint-label', 'Practice round');
      return { checks: [{ name: 'Preview has not saved a Disc', pass: experience.shelf().length === 0 }], refs: [experience.shelfAddress] };
    } },
    { name: 'Click Save and inspect the Disc, recipe and actual render inputs', async run() {
      ui.click('#save'); await ui.until(() => ui.enabled('#save'));
      const rows = experience.shelf();
      if (rows.length !== 1) throw Error(`Expected one saved Disc; found ${rows.length}. ${ui.text('#status')}`);
      const { address, disc } = rows[0], pxc = experience.pxc;
      const recipe = pxc.get(disc.paintRecipe!).value, art = pxc.get(disc.art!);
      return { refs: [address, disc.paintRecipe!, disc.art!, experience.shelfAddress], checks: [
        { name: 'The saved physical Disc has the requested mold, plastic and weight', pass: disc.mold === 'ds.px.seed.buzzz' && disc.plastic === 'ESP' && disc.weight === 174 },
        { name: 'Recipe retains seed 123 and the fixed label', pass: recipe.seed === 123 && recipe.label === 'Practice round' },
        { name: 'Art consumes this exact recipe Part and this exact mold Part', pass: art.composition.inputs.recipe === pxc.get(disc.paintRecipe!) && art.composition.inputs.seed === pxc.get(disc.mold) },
        { name: 'The selected shelf contains this exact Disc address', pass: pxc.get(experience.shelfAddress).value.includes(address) },
      ] };
    } },
  ];
  const original = experience.shelf()[0];
  if (!original) throw Error('Shelf Case needs the explicit three-disc fixture.');
  let candidate = '';
  return [
    { name: 'Pick up the first physical Buzzz', async run() {
      ui.click(`[data-address="${original.address}"] .shelf-pick`);
      return { refs: [original.address], checks: [{ name: 'The inspector selects the physical Part clicked', pass: ui.text('#shelf-selected-address') === original.address }] };
    } },
    { name: 'Set own turn to zero and Preview; leave the shelf unchanged', async run() {
      ui.input('#shelf-own-turn', true); ui.input('#shelf-turn', '0'); ui.click('#shelf-preview');
      await ui.until(() => ui.enabled('#shelf-keep'));
      candidate = ui.text('#shelf-selected-address'); const part = experience.pxc.get(candidate);
      return { refs: [original.address, candidate, experience.shelfAddress], checks: [
        { name: 'Candidate has explicit zero and derives from the selected original Part', pass: part.value.turn === 0 && part.composition.inputs.value === experience.pxc.get(original.address) },
        { name: 'Preview leaves the selected shelf and original value intact', pass: experience.shelf()[0].address === original.address && !Object.hasOwn(original.disc, 'turn') },
      ] };
    } },
    { name: 'Keep the candidate; preserve physical identity and sibling copies', async run() {
      ui.click('#shelf-keep'); await ui.until(() => experience.shelf()[0].address === candidate);
      return { refs: [original.address, candidate, experience.shelfAddress], checks: [
        { name: 'Same physical ID, new selected version, resolved turn zero', pass: experience.shelf()[0].disc.id === original.disc.id && experience.resolve(experience.shelf()[0].disc).turn === 0 },
        { name: 'The other two physical copies still inherit turn -1', pass: experience.shelf().length === 3 && experience.shelf().slice(1).every(row => experience.resolve(row.disc).turn === -1) },
      ] };
    } },
    { name: 'Pick up the kept copy and add it to a named Bag', async run() {
      ui.click(`[data-address="${candidate}"] .shelf-pick`);
      await ui.until(() => ui.enabled('#shelf-bag-add'));
      ui.click('#shelf-bag-add'); ui.input('#bag-name', 'Practice bag'); ui.click('#bag-create-button');
      await ui.until(() => experience.bags().length === 1);
      const { address, bag } = experience.bags()[0];
      return { refs: [candidate, address, experience.bagsAddress], checks: [
        { name: 'Bag names exactly this physical copy and its kept version', pass: bag.name === 'Practice bag' && bag.discIds.length === 1 && bag.discIds[0] === original.disc.id && bag.versions[0].address === candidate },
        { name: 'The Bag is produced by the actual registered Calculation Part', pass: experience.pxc.get(address).composition.calculation === experience.pxc.get('fn.createBag') },
      ] };
    } },
  ];
}

export function createCaseRun(experience: Experience, name: string, steps: CaseStep[]) {
  const pxc = experience.pxc, prefix = 'ds.px.sandbox.case';
  pxc.set(`${prefix}.definition`, new Part(Object.freeze({ name, steps: Object.freeze(steps.map(step => step.name)) })));
  pxc.set(`${prefix}.start`, new Part(inspectExperience(experience)));
  pxc.set('fn.sandbox.caseResult', new Part(({ observation, ...inputs }: any) => Object.freeze({ ...observation, contributors: Object.freeze(Object.keys(inputs)) })));
  let index = 0, failed = false, pending: Promise<string | null> | null = null;
  const records: string[] = [], reviews: string[] = [];
  const state = () => ({ next: index, total: steps.length, failed, busy: pending !== null, done: index === steps.length, records: [...records], reviews: [...reviews] });
  const next = (): Promise<string | null> => {
    if (pending) return pending;
    if (failed || index === steps.length) return Promise.resolve(null);
    pending = (async () => {
      const step = steps[index]; let checks: Check[], refs: string[], error: string | null = null;
      try { ({ checks, refs } = await step.run()); }
      catch (caught) { error = String(caught); checks = [{ name: error, pass: false }]; refs = []; }
      failed = !checks.length || checks.some(check => !check.pass);
      const address = `${prefix}.step.${index + 1}`;
      await pxc.compose({ into: address, calculation: 'fn.sandbox.caseResult', inputs: {
        definition: `${prefix}.definition`, starting: `${prefix}.start`, ending: new Part(inspectExperience(experience)),
        observation: new Part(Object.freeze({ step: index + 1, name: step.name, checks: Object.freeze(checks.map(check => Object.freeze({ ...check }))), refs: Object.freeze([...refs]), passed: !failed, error })),
        ...Object.fromEntries(refs.map((ref, i) => [`inspected${i}`, pxc.get(ref)])),
      } });
      records.push(address); index++; return address;
    })().catch(error => { failed = true; throw error; }).finally(() => { pending = null; });
    return pending;
  };
  return { experience, pxc, steps, state, next,
    review(verdict: 'needs-work' | 'ready-to-combine', notes: string) {
      if (pending) throw Error('Wait for the current action before recording a review.');
      if (!['needs-work', 'ready-to-combine'].includes(verdict) || !notes.trim()) throw Error('Supply a review choice and your observations.');
      const address = `${prefix}.review.${reviews.length + 1}`;
      pxc.set(address, new Part(Object.freeze({ source: 'explicit review form', verdict, notes: notes.trim(), caseRecords: Object.freeze([...records]), observed: inspectExperience(experience) })));
      reviews.push(address); return address;
    },
    report() { return { name, starting: pxc.get(`${prefix}.start`).value, state: state(), records: records.map(address => ({ address, value: pxc.get(address).value })), reviews: reviews.map(address => ({ address, value: pxc.get(address).value })) }; },
  };
}
