/**
 * Pure shelf projection for the accepted shopping shelf.
 *
 * This is deliberately narrower than DiscStudio's `src/shelf.js` at
 * ec1141f: no nickname search/ranking, no stability labels, and no UI shape.
 * It reads the exact retained specimen rows supplied by the caller.
 */
export type ShelfRow = {
  address: string;
  disc: { id: string; mold: string; plastic: string; weight: number | null; nickname?: string; [key: string]: unknown };
  seed: { id: string; manufacturer: string; name: string; speed: number | null; glide: number | null; turn: number | null; fade: number | null; [key: string]: unknown };
  art: string;
};

export type ShelfRequest = {
  query?: string;
  manufacturers?: readonly string[];
  plastics?: readonly string[];
  speedRange?: readonly [number, number] | null;
  weightRange?: readonly [number, number] | null;
};

export type ShelfGroup = Readonly<{
  key: string;
  manufacturer: string;
  mold: string;
  rows: readonly ShelfRow[];
}>;

export type ShelfView = Readonly<{
  rows: readonly ShelfRow[];
  groups: readonly ShelfGroup[];
  total: number;
  shown: number;
}>;

const normalize = (value: unknown) => String(value ?? '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase()
  // Product labels commonly print these between the same searchable facts.
  .replace(/[·•,;|/\\]+/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const terms = (value: unknown) => normalize(value).split(' ').filter(Boolean);
const compareText = (a: unknown, b: unknown) => normalize(a).localeCompare(normalize(b));

function checkedRange(name: string, range: ShelfRequest['speedRange']): readonly [number, number] | null {
  if (range == null) return null;
  if (!Array.isArray(range) || range.length !== 2 || !Number.isFinite(range[0]) || !Number.isFinite(range[1]) || range[0] > range[1])
    throw Error(`${name} must be two finite bounds in ascending order.`);
  return range;
}

function checkedValues(name: string, values: readonly string[] | undefined) {
  if (values == null) return new Set<string>();
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !normalize(value)))
    throw Error(`${name} must be nonempty strings.`);
  return new Set(values.map(normalize));
}

function searchable(row: ShelfRow) {
  // Nickname, artwork, colour, notes, and other own fields are intentionally absent.
  return terms([row.seed.manufacturer, row.seed.name, row.disc.plastic, row.disc.weight ?? ''].join(' '));
}

/**
 * Find physical shelf rows, then organize them as manufacturer → mold → copies.
 * Returned rows are the caller's original references, preserving exact version
 * addresses and physical ids for later selection/create-Bag work.
 */
export function shelfQuery({ rows, request = {} }: { rows: readonly ShelfRow[]; request?: ShelfRequest } = { rows: [] }): ShelfView {
  if (!Array.isArray(rows)) throw Error('rows must be an array of shelf rows.');
  const query = terms(request.query ?? '');
  const manufacturers = checkedValues('manufacturers', request.manufacturers);
  const plastics = checkedValues('plastics', request.plastics);
  const speedRange = checkedRange('speedRange', request.speedRange);
  const weightRange = checkedRange('weightRange', request.weightRange);

  const kept = rows.filter(row => {
    const words = searchable(row);
    if (query.some(term => !words.includes(term))) return false;
    if (manufacturers.size && !manufacturers.has(normalize(row.seed.manufacturer))) return false;
    if (plastics.size && !plastics.has(normalize(row.disc.plastic))) return false;
    if (speedRange && (!Number.isFinite(row.seed.speed) || row.seed.speed < speedRange[0] || row.seed.speed > speedRange[1])) return false;
    if (weightRange && (!Number.isFinite(row.disc.weight) || row.disc.weight < weightRange[0] || row.disc.weight > weightRange[1])) return false;
    return true;
  });

  const buckets = new Map<string, { manufacturer: string; mold: string; indexed: { row: ShelfRow; index: number }[] }>();
  kept.forEach((row, index) => {
    const manufacturer = row.seed.manufacturer, mold = row.seed.name;
    // Seed id keeps two catalog identities with identical printed names distinct.
    const key = `${row.seed.id}\u0000${manufacturer}\u0000${mold}`;
    const bucket = buckets.get(key) ?? { manufacturer, mold, indexed: [] };
    bucket.indexed.push({ row, index }); buckets.set(key, bucket);
  });

  const groups = [...buckets.entries()]
    .sort(([, a], [, b]) => compareText(a.manufacturer, b.manufacturer) || compareText(a.mold, b.mold))
    .map(([key, group]) => {
      const copies = [...group.indexed].sort((a, b) => {
        const plastic = compareText(a.row.disc.plastic, b.row.disc.plastic);
        if (plastic) return plastic;
        const aWeight = a.row.disc.weight, bWeight = b.row.disc.weight;
        const aUnknown = !Number.isFinite(aWeight), bUnknown = !Number.isFinite(bWeight);
        if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
        if (!aUnknown && aWeight !== bWeight) return bWeight! - aWeight!;
        return a.index - b.index;
      }).map(item => item.row);
      return Object.freeze({ key, manufacturer: group.manufacturer, mold: group.mold, rows: Object.freeze(copies) });
    });
  const ordered = groups.flatMap(group => group.rows);
  return Object.freeze({ rows: Object.freeze(ordered), groups: Object.freeze(groups), total: rows.length, shown: ordered.length });
}
