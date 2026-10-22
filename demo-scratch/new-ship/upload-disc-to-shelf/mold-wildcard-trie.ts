/**
 * A small build-time compiler and allocation-light reader for the mold-name
 * prefix index. The serialized form stores trie edges and terminal ordinals,
 * not JavaScript Maps or display strings, so opening it never rebuilds a trie.
 */

const MAGIC = 'MWTRIE01';
const VERSION = 1;
const HEADER_BYTES = 24;
const NODE_BYTES = 8;
const EDGE_BYTES = 4;
const MAX_RECORDS = 0xffff;
const MAX_NODES = 0xffff;
const MAX_NAME_CODE_POINTS = 512;
const MAX_TOTAL_INPUT_CODE_POINTS = 250_000;
const MAX_SERIALIZED_BYTES = 1_000_000;
const DEFAULT_LIMIT = 12;
const NO_SYMBOL = 0x1_0000;

/** Thrown when a query contains adjacent interior wildcards after normalization. */
export class MoldWildcardQueryError extends Error {
  readonly code = 'ADJACENT_WILDCARD';

  constructor(query: string) {
    super(`Mold search query has adjacent interior wildcards: ${JSON.stringify(query)}`);
    this.name = 'MoldWildcardQueryError';
  }
}

type MutableNode = {
  children: Map<number, MutableNode>;
  ordinals: number[];
  index: number;
  firstEdge: number;
  edgeCount: number;
  terminalStart: number;
};

const makeNode = (): MutableNode => ({
  children: new Map(), ordinals: [], index: -1, firstEdge: 0, edgeCount: 0, terminalStart: 0,
});

function normalizeName(value: string): string {
  if (typeof value !== 'string') throw new TypeError('Mold names must be strings.');
  const normalized = value.toLowerCase().trim();
  if (!normalized) throw new RangeError('Mold names must not be empty.');
  return normalized;
}

function normalizeQuery(query: string): number[] {
  if (typeof query !== 'string') throw new TypeError('Mold search query must be a string.');
  let normalized = query.toLowerCase().trim();
  // A trailing wildcard can only extend a prefix search, so it changes nothing.
  normalized = normalized.replace(/\*+$/u, '');
  if (normalized.includes('**')) throw new MoldWildcardQueryError(query);
  const characters = Array.from(normalized);
  if (characters.length > MAX_NAME_CODE_POINTS) throw new RangeError(`Mold search query exceeds ${MAX_NAME_CODE_POINTS} characters.`);
  return characters.map(character => character === '*' ? -1 : character.codePointAt(0)!);
}

function compareNumber(a: number, b: number): number { return a - b; }

/** Compile catalog names into deterministic, compact binary trie bytes. */
export function compileMoldWildcardTrie(names: readonly string[]): Uint8Array {
  if (!Array.isArray(names)) throw new TypeError('Mold names must be an array.');
  if (names.length > MAX_RECORDS) throw new RangeError(`Mold wildcard trie supports at most ${MAX_RECORDS} names.`);

  const root = makeNode();
  let nodeCount = 1;
  let totalCodePoints = 0;
  const alphabet = new Set<number>();

  for (let ordinal = 0; ordinal < names.length; ordinal++) {
    const normalized = normalizeName(names[ordinal]);
    const characters = Array.from(normalized);
    if (characters.length > MAX_NAME_CODE_POINTS) throw new RangeError(`Mold name at ordinal ${ordinal} exceeds ${MAX_NAME_CODE_POINTS} characters.`);
    totalCodePoints += characters.length;
    if (totalCodePoints > MAX_TOTAL_INPUT_CODE_POINTS) throw new RangeError('Mold name input exceeds the trie compiler size bound.');

    let node = root;
    for (const character of characters) {
      const codePoint = character.codePointAt(0)!;
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) throw new RangeError(`Mold name at ordinal ${ordinal} contains an invalid Unicode scalar.`);
      alphabet.add(codePoint);
      let child = node.children.get(codePoint);
      if (!child) {
        if (nodeCount >= MAX_NODES) throw new RangeError(`Mold wildcard trie supports at most ${MAX_NODES} nodes.`);
        child = makeNode();
        node.children.set(codePoint, child);
        nodeCount++;
      }
      node = child;
    }
    node.ordinals.push(ordinal);
  }

  const symbols = [...alphabet].sort(compareNumber);
  if (symbols.length > MAX_RECORDS) throw new RangeError('Mold wildcard trie alphabet exceeds its 16-bit symbol bound.');
  const symbolCode = new Map(symbols.map((codePoint, index) => [codePoint, index]));

  // Assign deterministic breadth-first node IDs and edge ranges.
  const nodes: MutableNode[] = [root];
  const edges: Array<{ symbol: number; child: number }> = [];
  root.index = 0;
  for (let cursor = 0; cursor < nodes.length; cursor++) {
    const node = nodes[cursor];
    const children = [...node.children.entries()].sort((a, b) => a[0] - b[0]);
    node.firstEdge = edges.length;
    node.edgeCount = children.length;
    for (const [codePoint, child] of children) {
      child.index = nodes.length;
      nodes.push(child);
      edges.push({ symbol: symbolCode.get(codePoint)!, child: child.index });
    }
  }

  let terminalCount = 0;
  for (const node of nodes) {
    node.ordinals.sort(compareNumber);
    node.terminalStart = terminalCount;
    terminalCount += node.ordinals.length;
  }
  if (terminalCount !== names.length) throw new Error('Mold wildcard trie lost a source ordinal while compiling.');

  const byteLength = HEADER_BYTES + symbols.length * 4 + nodes.length * NODE_BYTES + edges.length * EDGE_BYTES + terminalCount * 2;
  if (byteLength > MAX_SERIALIZED_BYTES) throw new RangeError('Mold wildcard trie exceeds its serialized size bound.');

  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < MAGIC.length; index++) view.setUint8(index, MAGIC.charCodeAt(index));
  view.setUint16(8, VERSION, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, names.length, true);
  view.setUint16(14, nodes.length, true);
  view.setUint16(16, edges.length, true);
  view.setUint16(18, symbols.length, true);
  view.setUint16(20, terminalCount, true);
  view.setUint16(22, 0, true);

  let offset = HEADER_BYTES;
  const alphabetOffset = offset;
  for (const symbol of symbols) { view.setUint32(offset, symbol, true); offset += 4; }
  const nodesOffset = offset;
  for (const node of nodes) {
    view.setUint16(offset, node.firstEdge, true);
    view.setUint16(offset + 2, node.edgeCount, true);
    view.setUint16(offset + 4, node.terminalStart, true);
    view.setUint16(offset + 6, node.ordinals.length, true);
    offset += NODE_BYTES;
  }
  const edgesOffset = offset;
  for (const edge of edges) {
    view.setUint16(offset, edge.symbol, true);
    view.setUint16(offset + 2, edge.child, true);
    offset += EDGE_BYTES;
  }
  for (const node of nodes) {
    for (const ordinal of node.ordinals) { view.setUint16(offset, ordinal, true); offset += 2; }
  }
  if (offset !== byteLength || alphabetOffset !== HEADER_BYTES || nodesOffset < alphabetOffset || edgesOffset < nodesOffset) {
    throw new Error('Mold wildcard trie compiler produced inconsistent section boundaries.');
  }
  return bytes;
}

export type MoldWildcardTrie = Readonly<{
  recordCount: number;
  nodeCount: number;
  byteLength: number;
  query(query: string, limit?: number): number[];
}>;

type PostingCursor = { ordinal: number; position: number; end: number };

/** Open and validate a compiled trie once; repeated queries use typed-array views only. */
export function openMoldWildcardTrie(bytes: Uint8Array): MoldWildcardTrie {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Mold wildcard trie bytes must be a Uint8Array.');
  if (bytes.byteLength < HEADER_BYTES || bytes.byteLength > MAX_SERIALIZED_BYTES) throw new Error('Mold wildcard trie byte length is out of bounds.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < MAGIC.length; index++) {
    if (view.getUint8(index) !== MAGIC.charCodeAt(index)) throw new Error('Mold wildcard trie magic is unsupported.');
  }
  const version = view.getUint16(8, true), flags = view.getUint16(10, true);
  const recordCount = view.getUint16(12, true), nodeCount = view.getUint16(14, true);
  const edgeCount = view.getUint16(16, true), alphabetCount = view.getUint16(18, true);
  const terminalCount = view.getUint16(20, true), reserved = view.getUint16(22, true);
  if (version !== VERSION || flags !== 0 || reserved !== 0) throw new Error('Mold wildcard trie version or flags are unsupported.');
  if (nodeCount < 1 || edgeCount !== nodeCount - 1 || terminalCount !== recordCount) throw new Error('Mold wildcard trie counts are inconsistent.');

  const alphabetOffset = HEADER_BYTES;
  const nodesOffset = alphabetOffset + alphabetCount * 4;
  const edgesOffset = nodesOffset + nodeCount * NODE_BYTES;
  const terminalsOffset = edgesOffset + edgeCount * EDGE_BYTES;
  if (terminalsOffset + terminalCount * 2 !== bytes.byteLength) throw new Error('Mold wildcard trie sections do not match its byte length.');

  let previousSymbol = -1;
  for (let symbolIndex = 0; symbolIndex < alphabetCount; symbolIndex++) {
    const codePoint = view.getUint32(alphabetOffset + symbolIndex * 4, true);
    if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff) || codePoint <= previousSymbol) {
      throw new Error('Mold wildcard trie alphabet is invalid or unsorted.');
    }
    previousSymbol = codePoint;
  }

  const seenChildren = new Uint8Array(nodeCount);
  const seenOrdinals = new Uint8Array(recordCount);
  let expectedEdge = 0, expectedTerminal = 0;
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex++) {
    const nodeOffset = nodesOffset + nodeIndex * NODE_BYTES;
    const firstEdge = view.getUint16(nodeOffset, true), childCount = view.getUint16(nodeOffset + 2, true);
    const firstTerminal = view.getUint16(nodeOffset + 4, true), nodeTerminalCount = view.getUint16(nodeOffset + 6, true);
    if (firstEdge !== expectedEdge || firstTerminal !== expectedTerminal || firstEdge + childCount > edgeCount || firstTerminal + nodeTerminalCount > terminalCount) {
      throw new Error('Mold wildcard trie node ranges are invalid.');
    }
    expectedEdge += childCount;
    expectedTerminal += nodeTerminalCount;

    let previousEdgeSymbol = -1;
    for (let edgeIndex = firstEdge; edgeIndex < firstEdge + childCount; edgeIndex++) {
      const edgeOffset = edgesOffset + edgeIndex * EDGE_BYTES;
      const symbol = view.getUint16(edgeOffset, true), child = view.getUint16(edgeOffset + 2, true);
      if (symbol >= alphabetCount || symbol <= previousEdgeSymbol || child <= nodeIndex || child >= nodeCount || seenChildren[child]) {
        throw new Error('Mold wildcard trie edge is invalid, duplicated, or unsorted.');
      }
      previousEdgeSymbol = symbol;
      seenChildren[child] = 1;
    }

    let previousOrdinal = -1;
    for (let index = firstTerminal; index < firstTerminal + nodeTerminalCount; index++) {
      const ordinal = view.getUint16(terminalsOffset + index * 2, true);
      if (ordinal >= recordCount || ordinal <= previousOrdinal || seenOrdinals[ordinal]) throw new Error('Mold wildcard trie terminal ordinals are invalid or duplicated.');
      previousOrdinal = ordinal;
      seenOrdinals[ordinal] = 1;
    }
  }
  if (expectedEdge !== edgeCount || expectedTerminal !== terminalCount || seenChildren[0] !== 0 || seenChildren.some((seen, index) => index > 0 && seen !== 1) ||
      seenOrdinals.some(seen => seen !== 1)) throw new Error('Mold wildcard trie does not contain one complete source-ordered tree.');

  const edgeByteOffset = (edgeIndex: number) => edgesOffset + edgeIndex * EDGE_BYTES;
  const nodeField = (nodeIndex: number, fieldOffset: number) => view.getUint16(nodesOffset + nodeIndex * NODE_BYTES + fieldOffset, true);

  function findSymbol(codePoint: number): number {
    let low = 0, high = alphabetCount - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const candidate = view.getUint32(alphabetOffset + middle * 4, true);
      if (candidate === codePoint) return middle;
      if (candidate < codePoint) low = middle + 1;
      else high = middle - 1;
    }
    return NO_SYMBOL;
  }

  function childFor(nodeIndex: number, symbol: number): number {
    const first = nodeField(nodeIndex, 0), count = nodeField(nodeIndex, 2);
    let low = 0, high = count - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1, edgeOffset = edgeByteOffset(first + middle);
      const candidate = view.getUint16(edgeOffset, true);
      if (candidate === symbol) return view.getUint16(edgeOffset + 2, true);
      if (candidate < symbol) low = middle + 1;
      else high = middle - 1;
    }
    return -1;
  }

  function query(queryText: string, limit = DEFAULT_LIMIT): number[] {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Mold result limit must be a nonnegative safe integer.');
    const pattern = normalizeQuery(queryText);
    if (limit === 0 || recordCount === 0) return [];
    if (pattern.length === 0) return Array.from({ length: Math.min(limit, recordCount) }, (_, ordinal) => ordinal);

    let states = [0];
    for (const codePoint of pattern) {
      const next: number[] = [];
      if (codePoint === -1) {
        for (const nodeIndex of states) {
          const first = nodeField(nodeIndex, 0), count = nodeField(nodeIndex, 2);
          for (let offset = 0; offset < count; offset++) {
            next.push(view.getUint16(edgeByteOffset(first + offset) + 2, true));
          }
        }
      } else {
        const symbol = findSymbol(codePoint);
        if (symbol === NO_SYMBOL) return [];
        for (const nodeIndex of states) {
          const child = childFor(nodeIndex, symbol);
          if (child >= 0) next.push(child);
        }
      }
      states = next;
      if (states.length === 0) return [];
    }

    // Each matching state contributes a sorted terminal range from its subtree.
    const stack = states.slice();
    const cursors: PostingCursor[] = [];
    const pushCursor = (cursor: PostingCursor) => {
      let index = cursors.length;
      cursors.push(cursor);
      while (index > 0) {
        const parent = (index - 1) >>> 1;
        if (cursors[parent].ordinal <= cursor.ordinal) break;
        cursors[index] = cursors[parent];
        index = parent;
      }
      cursors[index] = cursor;
    };
    const popCursor = (): PostingCursor => {
      const first = cursors[0], last = cursors.pop()!;
      if (cursors.length) {
        let index = 0;
        while (true) {
          const left = index * 2 + 1;
          if (left >= cursors.length) break;
          const right = left + 1;
          const child = right < cursors.length && cursors[right].ordinal < cursors[left].ordinal ? right : left;
          if (cursors[child].ordinal >= last.ordinal) break;
          cursors[index] = cursors[child];
          index = child;
        }
        cursors[index] = last;
      }
      return first;
    };
    while (stack.length) {
      const nodeIndex = stack.pop()!;
      const firstTerminal = nodeField(nodeIndex, 4), count = nodeField(nodeIndex, 6);
      if (count) {
        const position = firstTerminal;
        pushCursor({
          position,
          end: firstTerminal + count,
          ordinal: view.getUint16(terminalsOffset + position * 2, true),
        });
      }
      const first = nodeField(nodeIndex, 0), childCount = nodeField(nodeIndex, 2);
      for (let offset = 0; offset < childCount; offset++) stack.push(view.getUint16(edgeByteOffset(first + offset) + 2, true));
    }

    const results: number[] = [];
    let previousOrdinal = -1;
    while (cursors.length && results.length < limit) {
      const cursor = popCursor();
      if (cursor.ordinal !== previousOrdinal) {
        results.push(cursor.ordinal);
        previousOrdinal = cursor.ordinal;
      }
      cursor.position++;
      if (cursor.position < cursor.end) {
        cursor.ordinal = view.getUint16(terminalsOffset + cursor.position * 2, true);
        pushCursor(cursor);
      }
    }
    return results;
  }

  return Object.freeze({ recordCount, nodeCount, byteLength: bytes.byteLength, query });
}

/** Convenience one-shot form; callers that search repeatedly should open once. */
export function queryMoldWildcardTrie(bytes: Uint8Array, query: string, limit = DEFAULT_LIMIT): number[] {
  return openMoldWildcardTrie(bytes).query(query, limit);
}
