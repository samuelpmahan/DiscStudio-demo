import { Part, PxC } from '../part-first-kernel/src/pxc.mjs';
import { validatePaintRecipe } from './paint-recipe.ts';

export const storageKey = 'discstudio.pxc.shelf.v1';
export type State = { pxc: any; serial: number; shelfAddress: string; currentSeeds: [string, string][]; bagsAddress?: string; bagAddress?: string };
// This archive is an OnTop format, not serialization of arbitrary JavaScript.
export function archive(state: State) {
  const nodes: any[] = [], ids = new Map<any, number>();
  const known = new Map(state.pxc.entries().filter(([name]: any) => /^(fn|oc)\./.test(name)).map(([name, part]: any) => [part, name]));
  function value(item: any): any {
    if (item instanceof Part) return { part: visit(item) };
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) return { scalar: item };
    if (Array.isArray(item)) return { array: item.map(value) };
    if (item && Object.getPrototypeOf(item) === Object.prototype) return { object: Object.entries(item).map(([k, v]) => [k, value(v)]) };
    throw Error('Unsupported persistent material. Original stored shelf was not replaced.');
  }
  function visit(part: any): number {
    if (ids.has(part)) return ids.get(part)!;
    const id = ids.size; ids.set(part, id);
    if (known.has(part)) { nodes.push({ id, function: known.get(part) }); return id; }
    const composition = part.composition;
    const inputs = composition ? Object.entries(composition.inputs).map(([key, input]) => [key, visit(input)]) : undefined;
    const calculation = composition ? visit(composition.calculation) : undefined;
    const material = value(part.value);
    nodes.push({ id, material, ...(composition ? { calculation, inputs } : {}) });
    return id;
  }
  // RimFit rasters and their derived proposals are session-only correction
  // scratch work. They can contain Uint8ClampedArray pixels and are not part
  // of a saved disc; retaining them would make a normal Save fail archival.
  const bindings = state.pxc.entries().filter(([name]: any) => name.startsWith('ds.px.') && !/^ds\.px\.(?:PhotoIntake|CircleFit|CropEdit)\.rimfit\./.test(name)).map(([name, part]: any) => [name, visit(part)]);
  return JSON.stringify({ version: 1, serial: state.serial, shelfAddress: state.shelfAddress, currentSeeds: state.currentSeeds, ...(state.bagsAddress ? { bagsAddress: state.bagsAddress } : {}), ...(state.bagAddress ? { bagAddress: state.bagAddress } : {}), nodes, bindings });
}

export async function restore(raw: string, knownStore: any): Promise<State> {
  const data = JSON.parse(raw), pxc = new PxC(), parts = new Map<number, any>();
  if (data.version !== 1 || !Number.isSafeInteger(data.serial) || data.serial < 0 || !Array.isArray(data.nodes) || data.nodes.length > 100000 || !Array.isArray(data.bindings) || !Array.isArray(data.currentSeeds)) throw Error('Invalid shelf archive.');
  const destinations = new Map<number, string>(), names = new Set<string>();
  for (const [name, id] of data.bindings) {
    if (typeof name !== 'string' || !name.startsWith('ds.px.') || names.has(name)) throw Error('Invalid binding.');
    names.add(name); if (!destinations.has(id)) destinations.set(id, name);
  }
  for (const [name, part] of knownStore.entries()) if (/^(fn|oc)\./.test(name)) pxc.set(name, part);
  const part = (id: number) => { if (!parts.has(id)) throw Error('Unread Part link.'); return parts.get(id); };
  function value(item: any): any {
    if (!item || typeof item !== 'object' || Object.keys(item).length !== 1) throw Error('Invalid material.');
    if (Object.hasOwn(item, 'scalar') && (item.scalar === null || ['string', 'boolean', 'number'].includes(typeof item.scalar))) return item.scalar;
    if (Object.hasOwn(item, 'part')) return part(item.part);
    if (Array.isArray(item.array)) return Object.freeze(item.array.map(value));
    if (Array.isArray(item.object)) return Object.freeze(Object.fromEntries(item.object.map(([key, val]: any) => { if (typeof key !== 'string') throw Error('Invalid field.'); return [key, value(val)]; })));
    throw Error('Invalid material shape.');
  }
  for (const node of data.nodes) {
    if (!Number.isSafeInteger(node.id) || node.id < 0 || parts.has(node.id)) throw Error('Invalid Part identity.');
    if (node.function) {
      if (!/^(fn|oc)\./.test(node.function)) throw Error('Unknown Calculation.');
      parts.set(node.id, pxc.get(node.function)); continue;
    }
    const expected = value(node.material);
    if (Object.hasOwn(node, 'calculation')) {
      const result = await pxc.compose({ into: destinations.get(node.id) ?? `restore.${node.id}`, calculation: part(node.calculation), inputs: Object.fromEntries(node.inputs.map(([key, id]: any) => [key, part(id)])) });
      if (JSON.stringify(result.value) !== JSON.stringify(expected)) throw Error('Restored Calculation output differs from saved material.');
      parts.set(node.id, result);
    } else parts.set(node.id, new Part(expected));
  }
  for (const [name, id] of data.bindings) {
    if (typeof name !== 'string' || !name.startsWith('ds.px.')) throw Error('Invalid binding.');
    if (!pxc.entries().some(([address]) => address === name)) pxc.set(name, part(id));
  }
  const shelf = pxc.get(data.shelfAddress).value;
  if (!Array.isArray(shelf) || new Set(shelf).size !== shelf.length) throw Error('Invalid shelf.');
  for (const address of shelf) {
    const disc = pxc.get(address).value;
    pxc.get(disc.mold); pxc.get(disc.art ?? `ds.px.art.${disc.id}`);
    const links = ['paintRecipe', 'photo', 'choice', 'art'];
    if (links.some(link => Object.hasOwn(disc, link))) {
      if (links.some(link => typeof disc[link] !== 'string')) throw Error('Incomplete depiction sources.');
      const recipe = pxc.get(disc.paintRecipe), photo = pxc.get(disc.photo), choice = pxc.get(disc.choice), art = pxc.get(disc.art);
      if (photo.value !== null && (photo.value?.kind !== 'photo' || typeof photo.value?.src !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(photo.value.src))) throw Error('Invalid retained photo.');
      if (!['painted', 'photo'].includes(choice.value) || choice.value !== disc.depiction?.kind) throw Error('Invalid depiction choice.');
      if (choice.value === 'photo') {
        // Photo-first saves deliberately retain a null recipe; the prepared
        // image itself is the declared artwork source.
        if (recipe.value !== null || !photo.value || disc.depiction.src !== photo.value.src) throw Error('Photo source differs from selected depiction.');
      } else {
        validatePaintRecipe(recipe.value);
        if (disc.depiction.name !== recipe.value.family) throw Error('Painting source differs from selected depiction.');
      }
      const composition = art.composition;
      if (composition?.calculation !== pxc.get('fn.renderDepiction') || composition.inputs.recipe !== recipe || composition.inputs.photo !== photo || composition.inputs.choice !== choice || composition.inputs.seed !== pxc.get(disc.mold)) throw Error('Art does not retain the declared depiction inputs.');
    }
  }
  if (data.bagAddress !== undefined) {
    const bag = pxc.get(data.bagAddress).value;
    if (!Array.isArray(bag) || new Set(bag).size !== bag.length) throw Error('Invalid bag collection.');
    for (const address of bag) {
      const disc = pxc.get(address).value;
      if (!disc.id || !disc.mold) throw Error('Invalid bag disc reference.');
    }
  }
  if (data.bagsAddress !== undefined) {
    const bags = pxc.get(data.bagsAddress).value;
    if (!Array.isArray(bags) || new Set(bags).size !== bags.length) throw Error('Invalid bags collection.');
    const physicalIds = new Set(shelf.map((address: string) => pxc.get(address).value.id));
    for (const address of bags) {
      const bag = pxc.get(address).value;
      if (typeof bag.id !== 'string' || !bag.id.trim() || typeof bag.name !== 'string' || !bag.name.trim() || !Array.isArray(bag.discIds) || !Array.isArray(bag.versions) || bag.versions.length !== bag.discIds.length || new Set(bag.discIds).size !== bag.discIds.length) throw Error('Invalid Bag.');
      for (let i = 0; i < bag.discIds.length; i++) {
        const id = bag.discIds[i], version = bag.versions[i];
        if (!physicalIds.has(id) || version.id !== id || pxc.get(version.address).value.id !== id) throw Error('Invalid Bag specimen reference.');
      }
    }
  }
  for (const [id, address] of data.currentSeeds) if (pxc.get(address).value.id !== id) throw Error('Invalid mold selection.');
  return { pxc, serial: data.serial, shelfAddress: data.shelfAddress, currentSeeds: data.currentSeeds, ...(data.bagsAddress ? { bagsAddress: data.bagsAddress } : {}), ...(data.bagAddress ? { bagAddress: data.bagAddress } : {}) };
}
