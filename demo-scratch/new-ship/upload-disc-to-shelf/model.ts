import { Part, PxC } from '../part-first-kernel/src/pxc.mjs';
import { renderDiscPainting } from './paint.ts';
import { validatePaintRecipe, recipeFromDraft, renderDepiction, type PaintRecipe } from './paint-recipe.ts';
import { shelfQuery } from './shelf-query.ts';
import { createBag } from './bags.ts';
import { plasticGuides } from './plastics.ts';
import { catalogLite, searchMolds, getMoldDetails } from './mold-library.ts';
import { create, read, update, destroy, runStage, type Stage } from './operations.ts';
import { creatorPqlPlans, executePqlPlan, type PqlTestimony } from './pql.ts';
import { find } from './devtools-data.mjs';
import type { State } from './persistence.ts';
import { queueCards, type QueuedCard } from './export-queue-core.ts';

export type Seed = { id: string; manufacturer: string; mold: string; flight: (number | null)[]; source?: string; sourceKind?: string; observations?: { flight: (number | null)[]; source: string }[]; conflicting?: boolean; reviewStatus?: string };
export const flightFields = ['speed', 'glide', 'turn', 'fade'] as const;
type Flights = Record<typeof flightFields[number], number | null>;
export type Mold = Omit<Seed, 'mold' | 'flight'> & Flights & { name: string };
type Correction = Pick<Mold, 'manufacturer' | 'name'> & Partial<Flights>;
export type Draft = Partial<Flights> & { mold: string; nickname: string; weight: number | null; plastic: string; Color1: string; Color2: string; paintMode: 'split' | 'halo'; colorPainting: boolean };
export type Depiction = { kind: 'painted' | 'photo'; src: string; name: string };
export type Disc = Draft & { id: string; depiction: Depiction; paintRecipe?: string; photo?: string; choice?: string; art?: string };
export type DepictionSources = { recipe?: PaintRecipe; photo?: Depiction | null };
export const seeds: Seed[] = catalogLite as Seed[];
// {?} Lite-first: id+manufacturer+mold only. Full details lazy via getMoldDetails.
const seedAddress = (id: string) => `ds.px.seed.${id}`;
export const initialDraft = (): Draft => ({ mold: seedAddress('buzzz'), nickname: '', weight: null, plastic: '', Color1: '#98d4ba', Color2: '#f8b393', paintMode: 'split', colorPainting: false });
function checkFlights(value: Partial<Flights>) {
  for (const field of flightFields) if (Object.hasOwn(value, field) && value[field] !== null && !Number.isFinite(value[field])) throw Error(`${field} must be finite or null; remove the field to inherit.`);
}
function checkDraft(draft: Draft) {
  if (!/^ds\.px\.seed\.[\w.-]+$/.test(draft.mold)) throw new Error('Choose a seeded disc.');
  checkFlights(draft);
  if (draft.weight !== null && (!Number.isFinite(draft.weight) || draft.weight <= 0)) throw new Error('Weight must be positive grams, or blank.');
  for (const color of [draft.Color1, draft.Color2]) if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('Choose two valid colors.');
  if (!['split', 'halo'].includes(draft.paintMode) || typeof draft.colorPainting !== 'boolean') throw new Error('Choose a paint mode and color setting.');
}
export function createExperience(log: (event: Record<string, unknown>) => void = event => console.info(JSON.stringify(event)), options: { state?: State; persist?: (state: State) => void; status?: () => string } = {}) {
  const pxc = options.state?.pxc ?? new PxC();
  if (!options.state) {
  // Lite install: id, manufacturer, name only. Flight numbers lazy on selection.
  seeds.forEach(({ mold, ...seed }) => pxc.set(seedAddress(seed.id), new Part(Object.freeze({ ...seed, name: mold }))));
  pxc.set('ds.px.plasticGuides', new Part(plasticGuides));
  for (const [address, implementation] of Object.entries({ 'fn.READ': read, 'fn.CREATE': create, 'fn.UPDATE': update, 'fn.DELETE': destroy,
    // Legacy archives and unported live edit flows still use oc.update. Creator
    // save PQL compiles only to the universal fn.CREATE and fn.READ Parts above.
    'oc.create': create, 'oc.update': update, 'oc.destroy': destroy, 'fn.read': read, 'fn.find': find,
    'fn.tick': (outputs: any) => Object.freeze({ outputs: Object.freeze(Object.keys(outputs)) }),
    'fn.renderPainting': renderDiscPainting,
    'fn.paintRecipe': ({ recipe }: any) => validatePaintRecipe(recipe), 'fn.renderDepiction': renderDepiction,
    'fn.shelfQuery': shelfQuery, 'fn.createBag': createBag,
    // Output is a calculated PxC collection. Each enqueue receives an exact
    // card snapshot Part, so later editor choices cannot rewrite held output.
    'fn.appendOutputQueue': ({ queue, cards }: { queue: readonly QueuedCard[]; cards: readonly QueuedCard[] }) => queueCards([...queue, ...cards]),
    'fn.removeOutputQueueItem': ({ queue, index }: { queue: readonly QueuedCard[]; index: number }) => {
      if (!Number.isSafeInteger(index) || index < 0 || index >= queue.length) throw Error('Queued output no longer exists.');
      return queueCards(queue.filter((_, itemIndex) => itemIndex !== index));
    },
    'fn.shelfRows': ({ references, ...parts }: any) => Object.freeze(references.map((address: string, i: number) => Object.freeze({ address, disc: parts[`disc${i}`], seed: parts[`seed${i}`], art: parts[`art${i}`] }))),
    'fn.addReference': ({ collection, reference, value }: any) => {
      if (!value.id || collection.includes(reference)) throw Error('Reference already retained.');
      return Object.freeze([...collection, reference]);
    },
  })) pxc.set(address, new Part(implementation));
  pxc.set('fn.addToShelf', new Part(({ shelf, reference, disc }: any) => {
    if (!disc.id || shelf.includes(reference)) throw new Error('Disc is already on the shelf.');
    return Object.freeze([...shelf, reference]);
  }));
  pxc.set('fn.addToBag', new Part(({ bag, reference, disc }: any) => {
    if (!disc.id || bag.includes(reference)) throw new Error('Disc is already in the bag.');
    return Object.freeze([...bag, reference]);
  }));
  pxc.set('ds.px.shelf.0', new Part(Object.freeze([])));
  // MVP: the bag is the primary collection. Shelf is retained for legacy.
  pxc.set('ds.px.bag.0', new Part(Object.freeze([])));
  pxc.set('ds.px.output.queue.0', new Part(Object.freeze([])));
  }
  let shelfAddress = options.state?.shelfAddress ?? 'ds.px.shelf.0', serial = options.state?.serial ?? 0;
  let bagAddress = options.state?.bagAddress ?? 'ds.px.bag.0';
  if (!pxc.entries().some(([name]: [string, unknown]) => name === bagAddress)) pxc.set(bagAddress, new Part(Object.freeze([])));
  let bagsAddress = options.state?.bagsAddress ?? 'ds.px.bags.0';
  if (!pxc.entries().some(([name]: [string, unknown]) => name === bagsAddress)) pxc.set(bagsAddress, new Part(Object.freeze([])));
  // Output is deliberately current-session material. It is represented in PxC
  // for calculated provenance, but a fresh launch never restores it into the
  // creator flow.
  let outputQueueAddress = 'ds.px.output.queue.0';
  if (!pxc.entries().some(([name]: [string, unknown]) => name === outputQueueAddress)) pxc.set(outputQueueAddress, new Part(Object.freeze([])));
  let saving = false;
  const events: Record<string, unknown>[] = [];
  const emit = (event: Record<string, unknown>) => { events.push(event); try { log(event); } catch (error) { console.warn('Diagnostic sink failed; receipt remains in PxC.', error); } };
  const selected = new Map<Depiction, string>();
  const currentSeeds = new Map(options.state?.currentSeeds ?? seeds.map(seed => [seed.id, seedAddress(seed.id)]));
  // Keep the immutable catalog index outside PxC for read/search paths. PxC
  // remains authoritative for corrections and persistence, but asking for
  // suggestions should not perform hundreds of browser-side Part lookups on
  // every keystroke.
  const baseSeedOptions = new Map(seeds.map(({ mold, ...seed }) => [seedAddress(seed.id), Object.freeze({ ...seed, name: mold })]));
  let seedCacheKey = '', seedCache: { address: string; seed: Mold }[] = [];
  const indexedSeeds = () => {
    const key = [...currentSeeds].map(([id, address]) => `${id}:${address}`).join('|');
    if (key === seedCacheKey) return seedCache;
    seedCacheKey = key;
    seedCache = [...currentSeeds].map(([id, address]) => ({ address, seed: (address === seedAddress(id) ? baseSeedOptions.get(address) : pxc.get(address).value) as Mold }));
    return seedCache;
  };
  const persist = (nextShelf = shelfAddress, molds = currentSeeds, nextBags = bagsAddress, nextBag = bagAddress) => options.persist?.({ pxc, serial, shelfAddress: nextShelf, currentSeeds: [...molds], bagsAddress: nextBags, bagAddress: nextBag });
  const candidates = new Map<string, string>();
  const artAt = (disc: Disc) => disc.art ?? `ds.px.art.${disc.id}`;
  async function projectRows(operationId: string) {
    const inputs: Record<string, any> = { references: shelfAddress };
    (pxc.get(shelfAddress).value as string[]).forEach((address, i) => {
      const disc = pxc.get(address).value as Disc;
      inputs[`disc${i}`] = address; inputs[`seed${i}`] = disc.mold; inputs[`art${i}`] = artAt(disc);
    });
    const into = `ds.px.shelf.rows.${operationId}`;
    await pxc.compose({ into, calculation: 'fn.shelfRows', inputs });
    return into;
  }
  function checkPhoto(photo: Depiction | null) {
    if (photo !== null && (photo.kind !== 'photo' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(photo.src))) throw Error('Invalid prepared photo.');
  }
  return {
    pxc, events,
    get persistenceStatus() { return options.status?.() ?? 'Session only · reload starts fresh.'; },
    get shelfAddress() { return shelfAddress; },
    get bagAddress() { return bagAddress; },
    get bagsAddress() { return bagsAddress; },
    get outputQueueAddress() { return outputQueueAddress; },
    seedOptions(query = ''): { address: string; seed: Mold }[] {
      // Trie-based prefix search. O(k) where k = query length.
      const matches = searchMolds(query, 20);
      return matches.map(({ id, manufacturer, mold }) => {
        const address = currentSeeds.get(id) ?? seedAddress(id);
        return { address, seed: pxc.get(address).value as Mold ?? { id, manufacturer, name: mold } as Mold };
      });
    },
    // UI callers inspect retained seed Parts synchronously. Full catalog facts are
    // an optional renderer effect, not a prerequisite for authoring a photo.
    seedAt(address: string): Mold { return pxc.get(address).value as Mold; },
    async hydrateSeed(address: string): Promise<{ address: string; seed: Mold }> {
      const base = pxc.get(address).value as Mold;
      const id = base.id ?? address.replace(/^ds\.px\.seed\./, '').split('.')[0];
      const current = currentSeeds.get(id);
      if (current && current !== address) return { address: current, seed: pxc.get(current).value as Mold };
      if (flightFields.every(field => Object.hasOwn(base, field))) return { address, seed: base };
      const details = await getMoldDetails(id);
      if (!details) return { address, seed: base };
      const { mold, flight = [], ...detail } = details;
      const hydrated = Object.freeze({ ...base, ...detail, name: mold ?? base.name, ...Object.fromEntries(flightFields.map((field, index) => [field, flight[index] ?? null])) }) as Mold;
      const into = `ds.px.seed.${id}.hydrated.${++serial}`;
      pxc.set(into, new Part(hydrated)); currentSeeds.set(id, into); seedCacheKey = '';
      persist();
      return { address: into, seed: hydrated };
    },
    resolve(disc: Draft) { return read({ base: pxc.get(disc.mold).value, own: disc }); },
    depictionSources(address: string) {
      const disc = pxc.get(address).value as Disc;
      return { recipe: disc.paintRecipe ? pxc.get(disc.paintRecipe).value as PaintRecipe : recipeFromDraft(disc, disc.depiction),
        photo: disc.photo ? pxc.get(disc.photo).value as Depiction | null : disc.depiction.kind === 'photo' ? disc.depiction : null,
        choice: disc.choice ? pxc.get(disc.choice).value as 'painted' | 'photo' : disc.depiction.kind };
    },
    async queryShelf(request: Parameters<typeof shelfQuery>[0]['request'] = {}) {
      const id = `query-${++serial}`, rows = await projectRows(id), into = `ds.px.shelf.query.${id}`;
      // Snapshot request arrays: later control changes must not rewrite this query's inputs.
      const snapshot = structuredClone(request);
      await pxc.compose({ into, calculation: 'fn.shelfQuery', inputs: { rows, request: new Part(snapshot) } });
      return { address: into, ...pxc.get(into).value };
    },
    bags() {
      const current = new Map((pxc.get(shelfAddress).value as string[]).map(address => [pxc.get(address).value.id, address]));
      return (pxc.get(bagsAddress).value as string[]).map(address => {
        const bag = pxc.get(address).value;
        return { address, bag, discs: bag.discIds.map((id: string) => {
          const version = current.get(id); if (!version) throw Error(`Bag disc ${id} is missing from the shelf.`);
          const disc = pxc.get(version).value as Disc;
          return { address: version, disc, seed: pxc.get(disc.mold).value as Mold, art: pxc.get(artAt(disc)).value as string };
        }) };
      });
    },
    async createBag(name: string, selection: string[]) {
      if (saving) throw Error('A collection write is already in progress.');
      saving = true;
      const id = `bag-${++serial}`, into = `ds.px.bag.${id}`, next = `ds.px.bags.${id}`;
      try {
        const rows = await projectRows(id);
        await pxc.compose({ into, calculation: 'fn.createBag', inputs: { name: new Part(name), selection: new Part(Object.freeze([...selection])), rows, id: new Part(id) } });
        await pxc.compose({ into: next, calculation: 'fn.addReference', inputs: { collection: bagsAddress, reference: new Part(into), value: into } });
        const bag = pxc.get(into).value;
        if (bag.versions.length !== selection.length || bag.versions.some((v: any, i: number) => v.address !== selection[i]) || pxc.get(next).value.at(-1) !== into) throw Error('Bag readback failed.');
        persist(shelfAddress, currentSeeds, next);
        bagsAddress = next;
        emit({ event: 'bag.create.completed', bagAddress: into, bagsAddress: next, discIds: bag.discIds, readbackMatched: true });
        return into;
      } finally { saving = false; }
    },
    async updateDepiction(address: string, changes: { recipe?: PaintRecipe; photo?: Depiction | null; choice?: 'painted' | 'photo'; mold?: string }) {
      const disc = pxc.get(address).value as Disc, retained = this.depictionSources(address);
      const recipe = validatePaintRecipe(changes.recipe === undefined ? retained.recipe : changes.recipe);
      const photo = changes.photo === undefined ? retained.photo : changes.photo;
      checkPhoto(photo);
      const choice = changes.choice ?? retained.choice;
      if (!['painted', 'photo'].includes(choice) || (choice === 'photo' && !photo)) throw Error('Choose a retained depiction source.');
      const mold = changes.mold ?? disc.mold; pxc.get(mold); checkDraft({ ...disc, mold });
      const id = `depict-${++serial}`, into = `ds.px.disc.${id}`;
      const recipeAddress = `ds.px.recipe.${id}`, photoAddress = `ds.px.photo.${id}`, choiceAddress = `ds.px.choice.${id}`, artAddress = `ds.px.art.${id}`;
      await pxc.compose({ into: recipeAddress, calculation: 'fn.paintRecipe', inputs: { recipe: new Part(recipe) } });
      pxc.set(photoAddress, new Part(photo ? Object.freeze({ ...photo }) : null)); pxc.set(choiceAddress, new Part(choice));
      await pxc.compose({ into: artAddress, calculation: 'fn.renderDepiction', inputs: { recipe: recipeAddress, photo: photoAddress, choice: choiceAddress, seed: mold } });
      const depiction: Depiction = choice === 'photo' ? photo! : Object.freeze({ kind: 'painted', name: recipe.family, src: `./art/${recipe.family}.svg` });
      await pxc.compose({ into, calculation: 'oc.update', inputs: { value: address, patch: new Part(Object.freeze({ mold, depiction, paintRecipe: recipeAddress, photo: photoAddress, choice: choiceAddress, art: artAddress })) } });
      candidates.set(into, address);
      return into;
    },
    async updateDisc(address: string, patch: Partial<Flights>, remove: string[] = []) {
      if (!pxc.get(address).value.mold) throw Error('Select a Disc.');
      if ([...Object.keys(patch), ...remove].some(key => !(flightFields as readonly string[]).includes(key))) throw Error('This editor updates flight fields only.');
      checkFlights(patch);
      const into = `ds.px.disc.edit-${++serial}`;
      await pxc.compose({ into, calculation: 'oc.update', inputs: { value: address, patch: new Part(Object.freeze({ ...patch })), remove: new Part(Object.freeze([...remove])) } });
      candidates.set(into, address);
      return into;
    },
    async keepDisc(before: string, candidate: string) {
      if (saving) throw Error('A shelf write is already in progress.');
      saving = true;
      const operationId = `keep-${++serial}`;
      try {
        const previousShelf = shelfAddress, members = pxc.get(previousShelf).value as string[];
        const index = members.indexOf(before);
        if (index < 0 || candidates.get(candidate) !== before) throw Error('This selection changed. Reopen the current disc before keeping an edit.');
        const into = `ds.px.shelf.${operationId}`;
        await pxc.compose({ into, calculation: 'oc.update', inputs: { value: previousShelf, patch: new Part(Object.freeze({ [index]: candidate })) } });
        const actual = pxc.get(into).value as string[];
        if (actual.length !== members.length || actual.some((ref, i) => ref !== (i === index ? candidate : members[i]))) throw Error('Shelf readback failed.');
        const receipt = Object.freeze({ event: 'disc.edit.kept', operationId, before, candidate, previousShelf, shelfAddress: into, readbackMatched: true, storage: 'session-memory' });
        pxc.set(`ds.px.receipt.${operationId}`, new Part(receipt));
        persist(into);
        shelfAddress = into; emit(receipt);
        return candidate;
      } finally { saving = false; }
    },
    async reviewSeed(address: string, verdict: 'confirmed' | 'corrected', correction?: Correction) {
      const seed = pxc.get(address).value as Mold;
      if (currentSeeds.get(seed.id) !== address) throw new Error('This seed has a newer correction. Review the current one.');
      if (!['confirmed', 'corrected'].includes(verdict)) throw new Error('Choose a review result.');
      const operationId = `review-${++serial}`;
      if (verdict === 'corrected' && !correction) throw new Error('Supply the correction.');
      const into = `ds.px.seed.${seed.id}.${operationId}`;
      const patch: Partial<Correction> = verdict === 'confirmed' ? {} : correction!;
      checkFlights(patch);
      if (verdict === 'corrected' && (!patch.manufacturer?.trim() || !patch.name?.trim())) throw Error('Enter manufacturer and mold.');
      await pxc.compose({ into, calculation: 'oc.update', inputs: { value: address, patch: new Part(Object.freeze({ ...patch, reviewStatus: verdict })) } });
      const receipt = Object.freeze({ event: 'seed.review.completed', operationId, verdict, before: address, after: into, flight: flightFields.map(field => pxc.get(into).value[field]) });
      pxc.set(`ds.px.receipt.${operationId}`, new Part(receipt));
      persist(shelfAddress, new Map([...currentSeeds, [seed.id, into]]));
      currentSeeds.set(seed.id, into);
      seedCacheKey = '';
      emit(receipt);
      return into;
    },
    async addDraftPhoto(photo: Depiction): Promise<string> {
      checkPhoto(photo);
      const id = ++serial;
      const address = `ds.px.draft.photos.${id}`;
      pxc.set(address, new Part(Object.freeze({ ...photo })));
      return address;
    },
    outputQueue(): readonly QueuedCard[] { return pxc.get(outputQueueAddress).value as readonly QueuedCard[]; },
    async enqueueOutput(cards: readonly QueuedCard[]) {
      const held = queueCards(cards);
      if (!held.length) throw Error('Select at least one disc before adding output.');
      const operationId = `enqueue-${++serial}`, cardsAddress = `ds.px.output.cards.${operationId}`, next = `ds.px.output.queue.${operationId}`;
      pxc.set(cardsAddress, new Part(held));
      await pxc.compose({ into: next, calculation: 'fn.appendOutputQueue', inputs: { queue: outputQueueAddress, cards: cardsAddress } });
      const result = pxc.get(next).value as readonly QueuedCard[];
      if (result.length !== this.outputQueue().length + held.length || result.slice(-held.length).some((card, index) => card !== held[index] && JSON.stringify(card) !== JSON.stringify(held[index]))) throw Error('Output queue readback failed.');
      const receipt = Object.freeze({ event: 'output.queue.enqueued', operationId, inputCards: cardsAddress, previousQueue: outputQueueAddress, outputQueue: next, count: held.length });
      pxc.set(`ds.px.receipt.${operationId}`, new Part(receipt)); outputQueueAddress = next; emit(receipt);
      return next;
    },
    async removeOutput(index: number) {
      const operationId = `remove-output-${++serial}`, next = `ds.px.output.queue.${operationId}`;
      await pxc.compose({ into: next, calculation: 'fn.removeOutputQueueItem', inputs: { queue: outputQueueAddress, index: new Part(index) } });
      const receipt = Object.freeze({ event: 'output.queue.removed', operationId, previousQueue: outputQueueAddress, outputQueue: next, index });
      pxc.set(`ds.px.receipt.${operationId}`, new Part(receipt)); outputQueueAddress = next; emit(receipt);
      return next;
    },
    async selectDraftDepiction(): Promise<Depiction> {
      const id = ++serial;
      const depictionAddress = `ds.px.draft.depiction.${id}`;
      // Photo-only: the demo requires a draft photo. No painting fallback.
      const consumed = new Set([...pxc.entries()].filter(([name]) => name.startsWith('ds.px.draft.consumedPhotos.')).flatMap(([, part]) => (part.value as string[]) ?? []));
      const photoKeys = [...pxc.entries()].filter(([name]) => name.startsWith('ds.px.draft.photos.') && !consumed.has(name)).map(([name]) => name).sort((a, b) => Number(a.split('.').pop()) - Number(b.split('.').pop()));
      if (photoKeys.length === 0) throw new Error('No draft photo. Upload a photo first.');
      const photo = pxc.get(photoKeys[photoKeys.length - 1]).value as Depiction;
      const depiction = Object.freeze({ ...photo });
      pxc.set(depictionAddress, new Part(depiction));
      selected.set(depiction, depictionAddress);
      return depiction;
    },
    async save(draft: Draft, depiction: Depiction, sources: DepictionSources = {}) {
      if (saving) throw new Error('A save is already in progress.');
      saving = true;
      const operationId = `save-${++serial}`;
      const discAddress = `ds.px.disc.${operationId}`, nextShelf = `ds.px.shelf.${operationId}`, nextBag = `ds.px.bag.${operationId}`;
      try {
        checkDraft(draft);
        if (depiction.kind !== 'photo') throw new Error('Demo is photo-only. Upload a photo.');
        if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(depiction.src)) throw new Error('Invalid prepared photo.');
        const draftAddress = `ds.px.draft.${operationId}`, depictionAddress = `ds.px.depiction.${operationId}`;
        pxc.get(draft.mold);
        pxc.set(draftAddress, new Part(Object.freeze({ ...draft })));
        const selectedAddress = selected.get(depiction);
        pxc.set(depictionAddress, selectedAddress ? pxc.get(selectedAddress) : new Part(Object.freeze({ ...depiction })));
        const artAddress = `ds.px.art.${operationId}`;
        // Photo-only demo: photos don't need a paint recipe. The photo is the art.
        const recipe = sources.recipe === undefined ? null : validatePaintRecipe(sources.recipe);
        const photo = sources.photo === undefined ? depiction : sources.photo;
        checkPhoto(photo);
        if (!photo || photo.src !== depiction.src) throw Error('Selected photo must match the retained source.');
        const recipeAddress = `ds.px.recipe.${operationId}`, photoAddress = `ds.px.photo.${operationId}`, choiceAddress = `ds.px.choice.${operationId}`;
        if (recipe) pxc.set(recipeAddress, new Part(Object.freeze({ ...recipe })));
        else pxc.set(recipeAddress, new Part(null));
        pxc.set(photoAddress, new Part(photo ? Object.freeze({ ...photo }) : null));
        pxc.set(choiceAddress, new Part(depiction.kind));
        const pql: PqlTestimony[] = [];
        const createBindings = {
          value: draftAddress, id: new Part(operationId), depiction: depictionAddress,
          paintRecipe: new Part(recipeAddress), photo: new Part(photoAddress),
          choice: new Part(choiceAddress), art: new Part(artAddress),
        };
        const resolvedAddress = `ds.px.resolved.${operationId}`;
        const resolvedInputs = { base: draft.mold, own: discAddress };
        pql.push(await executePqlPlan(pxc, creatorPqlPlans.createDisc, { target: discAddress, bindings: createBindings }));
        await pxc.compose({ into: resolvedAddress, calculation: 'fn.READ', inputs: resolvedInputs });
        // CREATE and the inherited Disc projection already executed above. The
        // Tick boundary consumes their actual outputs and does not rerun either.
        const specializeTick = `ds.px.tick.${operationId}.specialize`;
        await pxc.compose({ into: specializeTick, calculation: 'fn.tick', inputs: { [discAddress]: discAddress, [resolvedAddress]: resolvedAddress } });
        const stage: Stage = [
          { into: specializeTick, calculations: [
            { into: discAddress, calculation: 'fn.CREATE', inputs: createBindings },
            { into: resolvedAddress, calculation: 'fn.READ', inputs: resolvedInputs },
          ] },
          ...(recipe ? [{ into: `ds.px.tick.${operationId}.recipe`, calculations: [{ into: recipeAddress, calculation: 'fn.paintRecipe', inputs: { recipe: new Part(recipe) } }] }] : []),
          { into: `ds.px.tick.${operationId}.depict`, calculations: [{ into: artAddress, calculation: 'fn.renderDepiction', inputs: { recipe: recipeAddress, photo: photoAddress, choice: choiceAddress, seed: draft.mold } }] },
          { into: `ds.px.tick.${operationId}.retain`, calculations: [
            { into: nextShelf, calculation: 'fn.addToShelf', inputs: { shelf: shelfAddress, reference: new Part(discAddress), disc: discAddress } },
            { into: nextBag, calculation: 'fn.addToBag', inputs: { bag: bagAddress, reference: new Part(discAddress), disc: discAddress } },
          ] },
        ];
        pxc.set(`ds.px.stage.${operationId}`, new Part(Object.freeze(stage)));
        for await (const _boundary of runStage(pxc, stage.slice(1))) { /* Boundary Parts are inspectable in DevTools. */ }
        const discReadback = `ds.px.pql.${operationId}.disc`;
        const shelfReadback = `ds.px.pql.${operationId}.shelf`;
        pql.push(await executePqlPlan(pxc, creatorPqlPlans.readDisc, { source: discAddress, into: discReadback }));
        pql.push(await executePqlPlan(pxc, creatorPqlPlans.readShelf, { source: nextShelf, into: shelfReadback }));
        pxc.set(`ds.px.receipt.pql.${operationId}`, new Part(Object.freeze(pql)));
        const disc = pxc.get(discAddress).value as Disc;
        const shelf = pxc.get(shelfReadback).value as string[];
        const bag = pxc.get(nextBag).value as string[];
        const expected = { ...draft, id: operationId, depiction, paintRecipe: recipeAddress, photo: photoAddress, choice: choiceAddress, art: artAddress };
        if (JSON.stringify(pxc.get(discReadback).value) !== JSON.stringify(expected) || !shelf.includes(discAddress)) throw new Error('Save readback failed.');
        if (!bag.includes(discAddress)) throw new Error('Bag readback failed.');
        const receipt = Object.freeze({ event: 'disc.save.completed', operationId, calculation: 'fn.addToShelf', discAddress, shelfAddress: nextShelf, bagAddress: nextBag, artAddress, ticks: stage.map(tick => tick.into), pql: pql.map(entry => ({ operation: entry.operation, calculation: entry.calculation, into: entry.into })), paintMode: disc.paintMode, colorPainting: disc.colorPainting, seedAddress: disc.mold, depictionRef: disc.depiction.src.startsWith('data:') ? 'local-photo' : disc.depiction.src, readbackMatched: true, shelfContainsDisc: true, bagContainsDisc: true, storage: 'session-memory' });
        pxc.set(`ds.px.receipt.${operationId}`, new Part(receipt));
        persist(nextShelf, currentSeeds, bagsAddress, nextBag);
        // Do not consume a retryable draft until a save has either reached the
        // durable archive or been explicitly accepted as this-tab-only work.
        // Unexpected persistence failures still leave the photo retryable.
        const photoKeys = [...pxc.entries()].filter(([name]) => name.startsWith('ds.px.draft.photos.')).map(([name]) => name);
        if (photoKeys.length > 0) pxc.set(`ds.px.draft.consumedPhotos.${operationId}`, new Part(Object.freeze(photoKeys)));
        shelfAddress = nextShelf;
        bagAddress = nextBag;
        emit(receipt);
        return discAddress;
      } catch (error) {
        emit({ event: 'disc.save.failed', operationId, message: String(error) });
        throw error;
      } finally { saving = false; }
    },
    shelf(query = ''): { address: string; disc: Disc; seed: Mold; art: string }[] {
      const collection = pxc.get(shelfAddress).value.map((address: string) => {
        const disc = pxc.get(address).value as Disc;
        return { address, disc, seed: pxc.get(disc.mold).value, art: pxc.get(artAt(disc)).value };
      });
      // Shelf navigation uses shared disc facts. Nickname is retained for final
      // recognition in the inspector, never an index or a search field.
      return find({ collection, query: query.replace(/[·•,]/g, ' '), fields: (row: any) => [row.seed.manufacturer, row.seed.name, row.disc.plastic, String(row.disc.weight ?? '')] });
    },
    // MVP: the bag is the primary collection. Mirrors shelf() for the MVP path.
    bag(query = ''): { address: string; disc: Disc; seed: Mold; art: string }[] {
      const collection = pxc.get(bagAddress).value.map((address: string) => {
        const disc = pxc.get(address).value as Disc;
        return { address, disc, seed: pxc.get(disc.mold).value, art: pxc.get(artAt(disc)).value };
      });
      return find({ collection, query: query.replace(/[·•,]/g, ' '), fields: (row: any) => [row.seed.manufacturer, row.seed.name, row.disc.plastic, String(row.disc.weight ?? '')] });
    },
  };
}
// {?} Persist the retained compositions across reload; this first shelf is session-local.
