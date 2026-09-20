// Mold library: lite-first with prefix trie for instant search.
// Lite loads id+manufacturer+mold (<50ms). Full details lazy on selection.

import { catalogLite } from './catalog-lite.ts';

export type LiteMold = { id: string; manufacturer: string; mold: string };

// Prefix trie: each node maps char -> child, plus list of mold ids at this prefix.
type TrieNode = { children: Map<string, TrieNode>; ids: string[] };

function buildTrie(molds: LiteMold[]): TrieNode {
  const root: TrieNode = { children: new Map(), ids: [] };
  for (const { id, mold, manufacturer } of molds) {
    // Index by mold name and by "manufacturer mold" for "discraft buzzz" queries.
    for (const key of [mold.toLowerCase(), `${manufacturer} ${mold}`.toLowerCase()]) {
      let node = root;
      for (const ch of key) {
        if (!node.children.has(ch)) node.children.set(ch, { children: new Map(), ids: [] });
        node = node.children.get(ch)!;
        if (!node.ids.includes(id)) node.ids.push(id);
      }
    }
  }
  return root;
}

const trie = buildTrie(catalogLite);
const byId = new Map(catalogLite.map(m => [m.id, m]));

/** Prefix search via trie. O(k) where k = query length. */
export function searchMolds(query: string, limit = 20): LiteMold[] {
  const q = query.toLowerCase().trim();
  if (!q) return catalogLite.slice(0, limit);
  let node = trie;
  for (const ch of q) {
    const next = node.children.get(ch);
    if (!next) return [];
    node = next;
  }
  return node.ids.slice(0, limit).map(id => byId.get(id)!).filter(Boolean);
}

/** Get full mold details (lazy: imports full catalog on first call). */
let fullCatalog: any[] | null = null;
export async function getMoldDetails(id: string) {
  if (!fullCatalog) {
    const { catalog } = await import('./catalog.ts');
    fullCatalog = catalog;
  }
  return fullCatalog.find((m: any) => m.id === id) ?? null;
}

export { catalogLite };
