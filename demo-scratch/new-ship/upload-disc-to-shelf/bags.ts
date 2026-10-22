/**
 * Immutable Bag values.  The ordered `discIds` are the durable shared physical
 * references; `versions` records the exact selected shelf version that justified
 * membership at creation or explicit add time.
 *
 * Bag operations existed in DiscStudio baseline f0d561c.  This small adapter
 * keeps that useful reference/order behavior without importing its mutable world.
 */
export type BagVersion = Readonly<{ id: string; address: string }>;
export type Bag = Readonly<{ id: string; name: string; discIds: readonly string[]; versions: readonly BagVersion[] }>;
export type Selection = readonly string[];
export type PhysicalRow = Readonly<{ address: string; disc: Readonly<{ id: string }> }>;

const nonempty = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !value.trim()) throw Error(`${label} must be a nonempty string.`);
  return value.trim();
};

const freezeBag = (bag: { id: string; name: string; discIds: readonly string[]; versions: readonly BagVersion[] }): Bag => Object.freeze({
  id: bag.id,
  name: bag.name,
  discIds: Object.freeze([...bag.discIds]),
  versions: Object.freeze(bag.versions.map(version => Object.freeze({ id: version.id, address: version.address }))),
});

function checkedBag(bag: Bag): Bag {
  nonempty(bag.id, 'Bag id'); nonempty(bag.name, 'Bag name');
  if (!Array.isArray(bag.discIds) || !Array.isArray(bag.versions) || bag.discIds.length !== bag.versions.length)
    throw Error('Bag membership and version evidence must have the same length.');
  const ids = new Set<string>(), addresses = new Set<string>();
  for (let index = 0; index < bag.discIds.length; index++) {
    const id = nonempty(bag.discIds[index], 'Disc id'), version = bag.versions[index];
    if (!version || version.id !== id || !nonempty(version.address, 'Version address')) throw Error('Bag version evidence must match its physical disc id.');
    if (ids.has(id) || addresses.has(version.address)) throw Error('A bag cannot contain duplicate physical or version references.');
    ids.add(id); addresses.add(version.address);
  }
  return bag;
}

/** Create a Bag only from exact current shelf-address selections; no stale row is dropped. */
export function createBag({ id, name, selection, rows }: { id: string; name: string; selection: Selection; rows: readonly PhysicalRow[] }): Bag {
  const bagId = nonempty(id, 'Bag id'), bagName = nonempty(name, 'Bag name');
  if (!Array.isArray(selection) || !selection.length) throw Error('Select at least one exact shelf version.');
  if (!Array.isArray(rows)) throw Error('rows must be an array of physical shelf rows.');
  const byAddress = new Map<string, PhysicalRow>();
  for (const row of rows) {
    const address = nonempty(row?.address, 'Shelf address'), discId = nonempty(row?.disc?.id, 'Physical disc id');
    if (byAddress.has(address)) throw Error(`Shelf has duplicate version address '${address}'.`);
    byAddress.set(address, row);
  }
  const versions: BagVersion[] = [], ids = new Set<string>();
  for (const address of selection) {
    const selected = nonempty(address, 'Selected shelf address'), row = byAddress.get(selected);
    if (!row) throw Error(`Selected shelf version '${selected}' is stale or absent.`);
    const discId = row.disc.id;
    if (ids.has(discId)) throw Error(`Physical disc '${discId}' was selected more than once.`);
    ids.add(discId); versions.push({ id: discId, address: selected });
  }
  return freezeBag({ id: bagId, name: bagName, discIds: versions.map(version => version.id), versions });
}

/** Add/remove one shared physical reference without mutating the prior Bag. */
export function bagMembership({ bag, discId, version, include }: { bag: Bag; discId: string; version?: BagVersion; include: boolean }): Bag {
  checkedBag(bag);
  const id = nonempty(discId, 'Disc id'), present = bag.discIds.indexOf(id);
  if (!include) return present < 0 ? bag : freezeBag({ ...bag, discIds: bag.discIds.filter(value => value !== id), versions: bag.versions.filter(value => value.id !== id) });
  if (present >= 0) return bag;
  if (!version || version.id !== id) throw Error('Adding a disc requires matching exact version evidence.');
  const address = nonempty(version.address, 'Version address');
  if (bag.versions.some(value => value.address === address)) throw Error(`Version '${address}' is already in this bag.`);
  return freezeBag({ ...bag, discIds: [...bag.discIds, id], versions: [...bag.versions, { id, address }] });
}

/** Reorder an existing shared reference; membership and evidence stay paired. */
export function reorderBag({ bag, discId, toIndex }: { bag: Bag; discId: string; toIndex: number }): Bag {
  checkedBag(bag);
  const id = nonempty(discId, 'Disc id'), from = bag.discIds.indexOf(id);
  if (from < 0) throw Error(`Physical disc '${id}' is not in this bag.`);
  if (!Number.isInteger(toIndex)) throw Error('Bag position must be an integer.');
  const target = Math.max(0, Math.min(bag.discIds.length - 1, toIndex));
  if (from === target) return bag;
  const entries = bag.versions.map((version, index) => ({ id: bag.discIds[index], version }));
  const [entry] = entries.splice(from, 1); entries.splice(target, 0, entry);
  return freezeBag({ ...bag, discIds: entries.map(entry => entry.id), versions: entries.map(entry => entry.version) });
}

/** Copy references and their current creation evidence; it never duplicates a physical disc. */
export function duplicateBag({ bag, id, name }: { bag: Bag; id: string; name?: string }): Bag {
  checkedBag(bag);
  const nextId = nonempty(id, 'New bag id');
  if (nextId === bag.id) throw Error('New bag id must differ from the original.');
  return freezeBag({ ...bag, id: nextId, name: typeof name === 'string' && name.trim() ? name.trim() : `${bag.name} · copy` });
}
