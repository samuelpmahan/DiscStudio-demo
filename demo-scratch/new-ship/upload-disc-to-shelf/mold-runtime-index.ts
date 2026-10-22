import { openMoldWildcardTrie } from './mold-wildcard-trie.ts';
import { moldRuntimeManifest } from './mold-runtime-manifest.ts';

const HEADER_BYTES = 176;
const MAGIC = 'MOLDRUN1';
const FLAGS = 15;
const TAG = 'MOLD-WILD1';
const FIELD_NAMES = ['speed', 'glide', 'turn', 'fade'] as const;
const decoder = new TextDecoder('utf-8', { fatal: true });

export type MoldProvenanceRef = Readonly<{
  stableId: string;
  catalogVersion: string;
  catalogSourceSha256: string;
  sourceRowIdentity: string;
}>;
export type PackedMold = Readonly<{
  id: string; manufacturer: string; mold: string;
  flight: readonly (number | null | undefined)[];
  provenance: MoldProvenanceRef;
}>;
export type PackedMoldIndex = Readonly<{
  recordCount: number; sourceCatalogSha256: string; assetSha256: string;
  stableIds: readonly string[];
  decodeRecord(ordinal: number): PackedMold;
  recordForId(id: string): PackedMold | null;
  search(query: string, limit?: number): PackedMold[];
}>;

export const moldCatalogVersion = moldRuntimeManifest.catalogVersion;

const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest));
}
function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'card'; }
function derivedStableId(manufacturer: string, mold: string) { return `${slug(manufacturer)}--${slug(mold)}`; }

function readUrlBytes(view: DataView, offset: number, length: number) {
  return new Uint8Array(view.buffer, view.byteOffset + offset, length);
}
function readFixedAscii(view: DataView, offset: number, length: number) {
  return Array.from(readUrlBytes(view, offset, length), value => String.fromCharCode(value)).join('');
}

/** Structural parser. Digest and source identity checks are completed by openPackedMoldIndex before export. */
export function parsePackedMoldRuntime(bytes: Uint8Array): PackedMoldIndex {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < HEADER_BYTES) throw Error('Packed mold runtime is truncated before its header.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readFixedAscii(view, 0, 8) !== MAGIC) throw Error('Packed mold runtime magic differs.');
  const schema = view.getUint16(8, true), flags = view.getUint16(10, true);
  if (schema !== 1 || flags !== FLAGS) throw Error('Packed mold runtime schema or flags are unsupported.');
  const recordCount = view.getUint16(12, true), manufacturerCount = view.getUint16(14, true);
  if (!recordCount || !manufacturerCount || manufacturerCount > 128) throw Error('Packed mold runtime counts are invalid.');
  const codebookCounts = FIELD_NAMES.map((_, index) => view.getUint8(16 + index));
  if (codebookCounts.some(count => count > 30)) throw Error('Packed mold runtime flight codebook exceeds its 5-bit limit.');
  const headerBytes = view.getUint32(20, true), namePoolBytes = view.getUint32(24, true), nameOffsetsBytes = view.getUint32(28, true);
  const manufacturerPoolBytes = view.getUint32(32, true), manufacturerOffsetsBytes = view.getUint32(36, true);
  const codebookBytes = view.getUint32(40, true), recordBytes = view.getUint32(44, true);
  const idExceptionBytes = view.getUint32(48, true), wildcardTrieBytes = view.getUint32(52, true), payloadBytes = view.getUint32(56, true);
  const idExceptionCount = view.getUint16(168, true);
  if (headerBytes !== HEADER_BYTES || nameOffsetsBytes !== (recordCount + 1) * 2 || manufacturerOffsetsBytes !== (manufacturerCount + 1) * 2 ||
      codebookBytes !== codebookCounts.reduce((sum, count) => sum + count * 4, 0) || recordBytes !== recordCount * 4 ||
      payloadBytes !== namePoolBytes + nameOffsetsBytes + manufacturerPoolBytes + manufacturerOffsetsBytes + codebookBytes + recordBytes + idExceptionBytes + wildcardTrieBytes ||
      bytes.byteLength !== headerBytes + payloadBytes) throw Error('Packed mold runtime section sizes are inconsistent.');
  if (idExceptionCount > recordCount) throw Error('Packed mold runtime has too many ID exceptions.');
  if (readFixedAscii(view, 156, 10) !== TAG || view.getUint16(166, true) !== 0 || view.getUint16(170, true) !== 0 || view.getUint32(172, true) !== 0) throw Error('Packed mold runtime normalizer/header tag is unsupported.');

  let cursor = headerBytes;
  const namePoolOffset = cursor; cursor += namePoolBytes;
  const nameOffsetsOffset = cursor; cursor += nameOffsetsBytes;
  const manufacturerPoolOffset = cursor; cursor += manufacturerPoolBytes;
  const manufacturerOffsetsOffset = cursor; cursor += manufacturerOffsetsBytes;
  const codebookOffset = cursor; cursor += codebookBytes;
  const recordsOffset = cursor; cursor += recordBytes;
  const exceptionsOffset = cursor; cursor += idExceptionBytes;
  const wildcardTrieOffset = cursor;
  if (cursor + wildcardTrieBytes !== bytes.byteLength) throw Error('Packed mold runtime has an invalid section boundary.');

  const checkOffsets = (tableOffset: number, count: number, poolBytes: number, requireNonempty: boolean) => {
    let previous = 0;
    if (view.getUint16(tableOffset, true) !== 0) throw Error('Packed mold runtime string offsets must start at zero.');
    for (let index = 0; index <= count; index++) {
      const next = view.getUint16(tableOffset + index * 2, true);
      if (next < previous || next > poolBytes) throw Error('Packed mold runtime has nonmonotone/out-of-bounds string offsets.');
      if (requireNonempty && index > 0 && next === previous) throw Error('Packed mold runtime contains an empty required string.');
      previous = next;
    }
    if (previous !== poolBytes) throw Error('Packed mold runtime string offsets do not end at the pool boundary.');
  };
  checkOffsets(nameOffsetsOffset, recordCount, namePoolBytes, true);
  checkOffsets(manufacturerOffsetsOffset, manufacturerCount, manufacturerPoolBytes, true);
  const stringAt = (poolOffset: number, offsetsOffset: number, index: number, count: number, poolBytes: number) => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= count) throw Error(`Packed mold runtime string index ${index} is out of range.`);
    const start = view.getUint16(offsetsOffset + index * 2, true), end = view.getUint16(offsetsOffset + (index + 1) * 2, true);
    if (start > end || end > poolBytes) throw Error('Packed mold runtime string boundaries are invalid.');
    return decoder.decode(readUrlBytes(view, poolOffset + start, end - start));
  };
  const manufacturers = Array.from({ length: manufacturerCount }, (_, index) => stringAt(manufacturerPoolOffset, manufacturerOffsetsOffset, index, manufacturerCount, manufacturerPoolBytes));
  if (new Set(manufacturers).size !== manufacturerCount) throw Error('Packed mold runtime manufacturer dictionary has duplicates.');

  const codebooks: number[][] = [];
  let codeCursor = codebookOffset;
  for (const count of codebookCounts) {
    const values: number[] = [];
    for (let index = 0; index < count; index++) {
      const value = view.getFloat32(codeCursor, true); codeCursor += 4;
      if (!Number.isFinite(value) || (index > 0 && values[index - 1] >= value)) throw Error('Packed mold runtime codebook values are invalid.');
      values.push(value);
    }
    codebooks.push(values);
  }

  const exceptionIds = new Map<number, string>(), usedIds = new Set<string>();
  let exceptionCursor = exceptionsOffset;
  for (let index = 0; index < idExceptionCount; index++) {
    if (exceptionCursor + 3 > bytes.byteLength) throw Error('Packed mold runtime ID exception table is truncated.');
    const ordinal = view.getUint16(exceptionCursor, true); exceptionCursor += 2;
    const length = view.getUint8(exceptionCursor); exceptionCursor++;
    if (ordinal >= recordCount || exceptionIds.has(ordinal) || length === 0 || exceptionCursor + length > bytes.byteLength) throw Error('Packed mold runtime ID exception is out of bounds.');
    const id = decoder.decode(readUrlBytes(view, exceptionCursor, length)); exceptionCursor += length;
    if (!/^[\w.-]+$/.test(id) || usedIds.has(id)) throw Error('Packed mold runtime ID exception is invalid or duplicated.');
    exceptionIds.set(ordinal, id); usedIds.add(id);
  }
  if (exceptionCursor !== wildcardTrieOffset) throw Error('Packed mold runtime ID exception table has trailing bytes.');

  const wildcardTrie = openMoldWildcardTrie(readUrlBytes(view, wildcardTrieOffset, wildcardTrieBytes));
  if (wildcardTrie.recordCount !== recordCount) throw Error('Packed mold runtime wildcard index has a different source row count.');

  const manufacturerCodeAt = (ordinal: number) => {
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= recordCount) throw Error(`Packed mold runtime ordinal ${ordinal} is out of range.`);
    const word = view.getUint32(recordsOffset + ordinal * 4, true), code = word & 0xff;
    if (code >= manufacturerCount) throw Error(`Packed mold runtime manufacturer code ${code} is out of range.`);
    return code;
  };
  const flightAt = (ordinal: number, fieldIndex: number): number | null | undefined => {
    const word = view.getUint32(recordsOffset + ordinal * 4, true);
    const code = (word >>> (8 + 5 * fieldIndex)) & 0x1f;
    if (code === 30) return null;
    if (code === 31) return undefined;
    if (code >= codebooks[fieldIndex].length) throw Error(`Packed mold runtime ${FIELD_NAMES[fieldIndex]} code ${code} is out of range.`);
    return codebooks[fieldIndex][code];
  };
  for (let ordinal = 0; ordinal < recordCount; ordinal++) {
    const word = view.getUint32(recordsOffset + ordinal * 4, true);
    if ((word & 0xf0000000) !== 0) throw Error('Packed mold runtime record has nonzero reserved high bits.');
    manufacturerCodeAt(ordinal);
    for (let fieldIndex = 0; fieldIndex < FIELD_NAMES.length; fieldIndex++) flightAt(ordinal, fieldIndex);
  }
  let stableIdsCache: string[] | null = null, ordinalById: Map<string, number> | null = null;
  const nameAt = (ordinal: number) => stringAt(namePoolOffset, nameOffsetsOffset, ordinal, recordCount, namePoolBytes);
  const stableIdAt = (ordinal: number) => exceptionIds.get(ordinal) ?? derivedStableId(manufacturers[manufacturerCodeAt(ordinal)], nameAt(ordinal));
  const getStableIds = () => {
    if (stableIdsCache) return stableIdsCache;
    const values = Array.from({ length: recordCount }, (_, ordinal) => stableIdAt(ordinal));
    if (values.some(id => !/^[\w.-]+$/.test(id)) || new Set(values).size !== recordCount) throw Error('Packed mold runtime stable IDs are invalid or duplicated.');
    stableIdsCache = values;
    return values;
  };
  const getOrdinalMap = () => {
    if (!ordinalById) ordinalById = new Map(getStableIds().map((id, ordinal) => [id, ordinal]));
    return ordinalById;
  };
  const decodeRecord = (ordinal: number): PackedMold => {
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= recordCount) throw Error(`Packed mold runtime ordinal ${ordinal} is out of range.`);
    const manufacturer = manufacturers[manufacturerCodeAt(ordinal)], mold = nameAt(ordinal), id = stableIdAt(ordinal);
    const flight = FIELD_NAMES.map((_, fieldIndex) => flightAt(ordinal, fieldIndex));
    return Object.freeze({ id, manufacturer, mold, flight: Object.freeze(flight), provenance: Object.freeze({
      stableId: id, catalogVersion: moldRuntimeManifest.catalogVersion,
      catalogSourceSha256: moldRuntimeManifest.sourceCatalogSha256, sourceRowIdentity: id,
    }) });
  };
  return Object.freeze({
    recordCount, sourceCatalogSha256: bytesToHex(readUrlBytes(view, 60, 32)),
    assetSha256: moldRuntimeManifest.assetSha256,
    get stableIds() { return Object.freeze([...getStableIds()]); },
    decodeRecord,
    recordForId(id: string) { const ordinal = getOrdinalMap().get(id); return ordinal === undefined ? null : decodeRecord(ordinal); },
    search(query: string, limit = 12) {
      if (!Number.isSafeInteger(limit) || limit < 0) throw Error('Mold result limit must be a nonnegative integer.');
      if (limit === 0 || recordCount === 0) return [];
      const normalized = query.toLowerCase().trim().replace(/\*+$/u, '');
      let ordinals: number[] = [];
      const matchingManufacturerCodes = manufacturers.map((manufacturer, code) => ({ code, key: manufacturer.toLowerCase() }))
        .filter(({ key }) => normalized && key.startsWith(normalized));
      if (normalized && matchingManufacturerCodes.length) {
        for (let ordinal = 0; ordinal < recordCount; ordinal++) {
          const manufacturerCode = manufacturerCodeAt(ordinal);
          if (matchingManufacturerCodes.some(({ code }) => code === manufacturerCode)) ordinals.push(ordinal);
        }
      }
      // Preserve manufacturer-first input without duplicating compound labels
      // in the trie. The manufacturer dictionary filters name-index ordinals.
      if (ordinals.length === 0 && normalized.includes(' ')) {
        const candidates = new Set<number>();
        for (let split = normalized.indexOf(' '); split >= 0; split = normalized.indexOf(' ', split + 1)) {
          const manufacturerPrefix = normalized.slice(0, split).trim();
          const moldQuery = normalized.slice(split + 1).trim();
          if (!manufacturerPrefix || !moldQuery) continue;
          const codes = manufacturers.map((manufacturer, code) => ({ code, key: manufacturer.toLowerCase() }))
            .filter(({ key }) => key.startsWith(manufacturerPrefix));
          if (!codes.length) continue;
          const byCode = new Set(codes.map(({ code }) => code));
          for (const ordinal of wildcardTrie.query(moldQuery, recordCount)) {
            if (byCode.has(manufacturerCodeAt(ordinal))) candidates.add(ordinal);
          }
        }
        ordinals = [...candidates].sort((a, b) => a - b).slice(0, limit);
      }
      if (ordinals.length === 0) ordinals = wildcardTrie.query(query, limit);
      return ordinals.map(decodeRecord);
    },
  });
}

const asHex = (view: DataView, offset: number, length: number) => bytesToHex(readUrlBytes(view, offset, length));
async function readRuntimeBytes(assetURL: URL): Promise<Uint8Array> {
  const processObject = (globalThis as any).process;
  if (processObject?.versions?.node) {
    const [{ readFile }, { fileURLToPath }] = await Promise.all([import('node:fs/promises'), import('node:url')]);
    return new Uint8Array(await readFile(fileURLToPath(new URL('./mold-runtime.bin', import.meta.url))));
  }
  const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(10000) : undefined;
  const response = await fetch(assetURL, signal ? { signal } : undefined);
  if (!response.ok) throw Error(`Packed mold runtime request failed with HTTP ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Verify actual payload and full-asset bytes, plus the separate catalog/dictionary identities. */
export async function verifyPackedMoldAsset(bytes: Uint8Array, expected = moldRuntimeManifest): Promise<PackedMoldIndex> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < HEADER_BYTES) throw Error('Packed mold runtime is truncated before its header.');
  const actualAssetSha256 = await sha256(bytes);
  if (actualAssetSha256 !== expected.assetSha256) throw Error('Packed mold runtime asset SHA-256 differs from its build manifest.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(20, true) !== HEADER_BYTES) throw Error('Packed mold runtime header is invalid.');
  const headerPayloadSha = asHex(view, 124, 32), payload = bytes.subarray(HEADER_BYTES);
  const actualPayloadSha = await sha256(payload);
  if (actualPayloadSha !== headerPayloadSha || actualPayloadSha !== expected.payloadSha256) throw Error('Packed mold runtime payload checksum differs.');
  const expectedSourceSha = asHex(view, 60, 32), expectedDictionarySha = asHex(view, 92, 32);
  if (expectedSourceSha !== expected.sourceCatalogSha256 || expectedDictionarySha !== expected.dictionarySha256) throw Error('Packed mold runtime header identity differs from its build manifest.');
  const manufacturerPoolOffset = HEADER_BYTES + view.getUint32(24, true) + view.getUint32(28, true);
  const dictionaryLength = view.getUint32(32, true) + view.getUint32(36, true) + view.getUint32(40, true);
  const actualDictionarySha = await sha256(bytes.subarray(manufacturerPoolOffset, manufacturerPoolOffset + dictionaryLength));
  if (actualDictionarySha !== expectedDictionarySha) throw Error('Packed mold runtime dictionary checksum differs.');
  const trieOffset = bytes.byteLength - view.getUint32(52, true);
  if (await sha256(bytes.subarray(trieOffset)) !== expected.wildcardTrieSha256) throw Error('Packed mold runtime wildcard index checksum differs.');
  if (bytes.byteLength !== expected.byteLength) throw Error('Packed mold runtime byte length differs from its build manifest.');
  return parsePackedMoldRuntime(bytes);
}

async function openPackedMoldIndex(): Promise<PackedMoldIndex> {
  const assetURL = new URL('./mold-runtime.bin', import.meta.url);
  assetURL.searchParams.set('v', moldRuntimeManifest.assetSha256);
  const bytes = await readRuntimeBytes(assetURL);
  return verifyPackedMoldAsset(bytes);
}

const emptyIndex: PackedMoldIndex = Object.freeze({
  recordCount: 0, sourceCatalogSha256: moldRuntimeManifest.sourceCatalogSha256, assetSha256: moldRuntimeManifest.assetSha256,
  stableIds: Object.freeze([]),
  decodeRecord() { throw Error('Mold catalog is unavailable. Reload DiscStudio to retry.'); },
  recordForId() { return null; },
  search() { return []; },
});
const runtimeLoad = await openPackedMoldIndex().then(
  index => ({ index, error: null as string | null }),
  error => ({ index: null, error: String(error instanceof Error ? error.message : error) }),
);
/** Failure is represented so the page can mount an error state instead of rejecting its module graph. */
export const moldRuntimeAvailable = runtimeLoad.index !== null;
export const moldRuntimeError = runtimeLoad.error;
export const packedMoldIndex: PackedMoldIndex = runtimeLoad.index ?? emptyIndex;
