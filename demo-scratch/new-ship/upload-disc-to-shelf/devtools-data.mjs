import { Part } from '../part-first-kernel/src/pxc.mjs';

// Views of the actual store, not a second registry. Borrowed values stay borrowed.
const identities = new WeakMap();
let nextIdentity = 0;
export function objectId(value) {
  if (value === null || !['object', 'function'].includes(typeof value)) return null;
  if (!identities.has(value)) identities.set(value, ++nextIdentity);
  return `object#${identities.get(value)}`;
}
export function objectModel(value) {
  try {
    return { id: objectId(value), prototype: Object.getPrototypeOf(value),
      extensible: Object.isExtensible(value), frozen: Object.isFrozen(value),
      properties: Reflect.ownKeys(value).map(key => ({ key, ...Object.getOwnPropertyDescriptor(value, key) })) };
  } catch (error) { return { id: objectId(value), error: String(error), properties: [] }; }
}
export function printable(value) {
  const seen = new WeakSet();
  let budget = 2000;
  function visit(item, depth = 0) {
    if (--budget < 0 || depth > 8) return '[display limit]';
    if (typeof item === 'function') return `[Calculation ${objectId(item)}]`;
    if (typeof item === 'bigint') return `${item}n`;
    if (typeof item === 'symbol' || typeof item === 'undefined') return String(item);
    if (typeof item === 'string' && item.startsWith('data:image/')) return `[image material: ${item.length} characters]`;
    if (!item || typeof item !== 'object') return item;
    if (seen.has(item)) return `[repeated/circular reference ${objectId(item)}]`;
    seen.add(item);
    try {
      if (item instanceof Map) return { Map: [...Map.prototype.entries.call(item)].slice(0, 150).map(([k,v]) => [visit(k,depth+1),visit(v,depth+1)]) };
      if (item instanceof Set) return { Set: [...Set.prototype.values.call(item)].slice(0,150).map(x=>visit(x,depth+1)) };
      return Object.fromEntries(Reflect.ownKeys(item).slice(0,150).map(key => {
        const d = Object.getOwnPropertyDescriptor(item,key);
        return [String(key), 'value' in d ? visit(d.value,depth+1) : '[accessor — not evaluated]'];
      }));
    } catch (error) { return `[inspection failed: ${String(error)}]`; }
  }
  return JSON.stringify(visit(value), null, 2) ?? String(value);
}

export async function runCalculation(pxc, calculation, bindings) {
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) throw Error('Inputs must be a named object.');
  const inputs = Object.fromEntries(Object.entries(bindings).map(([name, binding]) => {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) throw Error(`Input ${name}: use {"ref":"address"} or {"value":...}.`);
    const keys = Object.keys(binding);
    if (keys.length !== 1 || !['ref','value'].includes(keys[0])) throw Error(`Input ${name}: supply exactly ref or value.`);
    return [name, keys[0] === 'ref' ? pxc.get(binding.ref) : new Part(binding.value)];
  }));
  return runObserved(pxc, calculation, inputs);
}
export async function runObserved(pxc, calculation, inputs) {
  let serial = 1;
  const occupied = new Set(pxc.entries().map(([a])=>a));
  while (occupied.has(`devtools.run.${serial}.started`)) serial++;
  const base = `devtools.run.${serial}`, into = base + '.result';
  const startedAt = Date.now();
  pxc.set(base + '.started', new Part({ state:'running', into, startedAt, calculation, inputs }));
  try {
    const output = await pxc.compose({ into, calculation, inputs });
    pxc.set(base + '.finished', new Part({ state:'produced', into, elapsedMs:Date.now()-startedAt }));
    return { into, output };
  } catch (error) {
    pxc.set(base + '.finished', new Part({ state:'failed', into, elapsedMs:Date.now()-startedAt, error:String(error) }));
    throw error;
  }
}
export function runMember(pxc, receiver, member, args = [], kind = 'method') {
  if (typeof member !== 'function' || !Array.isArray(args)) throw Error('Select a callable member and supply a JSON argument array.');
  // Retains the actual receiver and callable as contributors; no source eval.
  const invoke = new Part(({ receiver, member, args }) => Reflect.apply(member, receiver, args));
  return runObserved(pxc, invoke, { receiver:new Part(receiver), member:new Part(member), args:new Part(kind === 'getter' ? [] : args) });
}

export function createObjectPlayground(pxc) {
  const symbol = Symbol('example metadata');
  class Counter {
    constructor() { this.count = 2; this.getterCalls = 0; }
    get doubled() { this.getterCalls++; return this.count * 2; }
    increment(amount = 1) { this.count += amount; return this.count; }
    async later(amount = 1) { return this.increment(amount); }
    fail() { throw new Error('Deliberate playground failure'); }
  }
  const counter = new Counter();
  Object.defineProperty(counter, 'hiddenNote', { value:'Non-enumerable property', enumerable:false });
  counter[symbol] = 'Symbol-keyed material';
  counter.self = counter;
  counter.map = new Map([['same counter', counter]]);
  return createScratch(pxc, counter);
}

// Shared plain-text operation: collection and searchable fields are explicit.
export function find({ collection, query = '', fields }) {
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return collection.filter(row => {
    const text = fields(row).join(' ').toLocaleLowerCase();
    return tokens.every(token => text.includes(token));
  });
}
export function inventory(pxc) {
  return pxc.entries().map(([address, part]) => ({
    address, part, namespace: address.split('.').slice(0, -1).join('.') || '(root)',
    kind: typeof part.value === 'function' ? 'Calculation' : part.composition ? 'Produced' : 'Supplied',
  }));
}
export function inspectPart(pxc, part) {
  const entries = pxc.entries();
  const addresses = target => entries.filter(([, value]) => value === target).map(([address]) => address);
  const edges = part.composition ? [
    { role: 'Calculation', part: part.composition.calculation, addresses: addresses(part.composition.calculation) },
    ...Object.entries(part.composition.inputs).map(([role, input]) => ({ role, part: input, addresses: addresses(input) })),
  ] : [];
  const consumers = entries.filter(([, candidate]) => candidate.composition &&
    (candidate.composition.calculation === part || Object.values(candidate.composition.inputs).includes(part)))
    .map(([address, candidate]) => ({ address, part: candidate }));
  return { addresses: addresses(part), edges, consumers };
}
export function createScratch(pxc, value) {
  let serial = 1;
  const occupied = new Set(pxc.entries().map(([address]) => address));
  while (occupied.has(`devtools.scratch.${serial}`)) serial++;
  const address = `devtools.scratch.${serial}`;
  pxc.set(address, new Part(value));
  return address;
}
export async function reviseScratch(pxc, source, value) {
  // A fresh result, not a mutation of the inspected Part or application selection.
  const calc = new Part(({ replacement }) => replacement);
  let serial = 1;
  const occupied = new Set(pxc.entries().map(([address]) => address));
  while (occupied.has(`devtools.result.${serial}`)) serial++;
  const address = `devtools.result.${serial}`;
  await pxc.compose({ into: address, calculation: calc, inputs: { original: source, replacement: new Part(value) } });
  return address;
}

// Semantic projection of one actual creator Save receipt. It borrows only live
// Parts, retained compositions, and execution receipts; it never replays Save.
export function summarizeSaveReceipt(pxc, receiptAddress, receiptPart = pxc.get(receiptAddress)) {
  const receipt = receiptPart?.value;
  if (!/^ds\.px\.receipt\.save-/.test(receiptAddress) || receipt?.event !== 'disc.save.completed') return null;
  const entries = new Map(pxc.entries()), addressOf = part => [...entries].find(([, candidate]) => candidate === part)?.[0] ?? null;
  const get = address => { try { return typeof address === 'string' ? pxc.get(address) : null; } catch { return null; } };
  const disc = get(receipt.discAddress), mold = get(disc?.value?.mold), bag = get(receipt.bagAddress);
  const produced = pxc.receipts().filter(row => row.status === 'produced');
  const create = produced.find(row => row.into === receipt.discAddress && row.composition.calculation === get('fn.CREATE'));
  const previousBag = bag?.composition?.inputs?.bag;
  const before = Array.isArray(previousBag?.value) ? previousBag.value : null;
  const after = Array.isArray(bag?.value) ? bag.value : null;
  const added = before && after ? after.filter(address => !before.includes(address)) : [];
  const bagVerified = Boolean(before && after && create && after.length === before.length + 1 && added.length === 1 && added[0] === receipt.discAddress && after.includes(receipt.discAddress));
  const operationId = receipt.operationId, pqlAddress = 'ds.px.receipt.pql.' + operationId, pql = get(pqlAddress)?.value;
  const compareRead = source => {
    const testimony = Array.isArray(pql) && pql.find(row => row?.calculation === 'fn.READ' && row?.boundAddresses?.source === source);
    const execution = testimony && produced.find(row => row.into === testimony.into && row.composition.calculation === get('fn.READ'));
    const sourcePart = get(source), outputPart = execution?.output;
    return { source, into: testimony?.into ?? null, testimony: Boolean(testimony), execution: Boolean(execution), matches: Boolean(execution && sourcePart && outputPart && Object.is(outputPart.value, sourcePart.value)) };
  };
  const discRead = compareRead(receipt.discAddress);
  const shelfRead = compareRead(receipt.shelfAddress);
  const pqlCreate = Array.isArray(pql) && pql.some(row => row?.calculation === 'fn.CREATE' && row?.boundAddresses?.target === receipt.discAddress);
  const flagsVerified = receipt.readbackMatched === true && receipt.shelfContainsDisc === true && receipt.bagContainsDisc === true;
  const readVerified = Boolean(pqlCreate && discRead.testimony && discRead.execution && discRead.matches && shelfRead.testimony && shelfRead.execution && shelfRead.matches && flagsVerified);
  return Object.freeze({
    title: 'Saved ' + (mold?.value?.manufacturer ?? 'Unknown') + ' ' + (mold?.value?.name ?? 'disc'),
    discAddress: receipt.discAddress, moldAddress: disc?.value?.mold ?? null,
    create: Object.freeze({ into: create?.into ?? null, calculationAddress: addressOf(get('fn.CREATE')), verified: Boolean(create) }),
    bag: Object.freeze({ beforeAddress: addressOf(previousBag), afterAddress: receipt.bagAddress, beforeCount: before?.length ?? null, afterCount: after?.length ?? null, added: Object.freeze(added), verified: bagVerified }),
    readback: Object.freeze({ pqlAddress, disc: Object.freeze(discRead), shelf: Object.freeze(shelfRead), receiptFlags: Object.freeze({ readbackMatched: receipt.readbackMatched === true, shelfContainsDisc: receipt.shelfContainsDisc === true, bagContainsDisc: receipt.bagContainsDisc === true }), verified: readVerified }),
    verified: Boolean(create && bagVerified && readVerified),
  });
}
