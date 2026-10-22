import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { catalog } from './catalog.ts';
import { moldRuntimeManifest } from './mold-runtime-manifest.ts';
import { encodeMoldRuntime, verifyMoldRuntimeArtifact } from './mold-runtime-build.mjs';
import { packedMoldIndex, parsePackedMoldRuntime, verifyPackedMoldAsset } from './mold-runtime-index.ts';

const runtimeURL = new URL('./mold-runtime.bin', import.meta.url);
const runtimeBytes = new Uint8Array(await readFile(runtimeURL));
const HEADER_BYTES = new DataView(runtimeBytes.buffer, runtimeBytes.byteOffset, runtimeBytes.byteLength).getUint32(20, true);

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const cloneRuntime = () => Uint8Array.from(runtimeBytes);
const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'card';
const derivedStableId = (manufacturer: string, mold: string) => `${slug(manufacturer)}--${slug(mold)}`;
const DEFAULT_LIMIT = 12;

function nameMatchesWildcardPrefix(name: string, rawPattern: string): boolean {
  const pattern = rawPattern.toLowerCase().trim().replace(/\*+$/u, '');
  if (pattern.includes('**')) throw Error('adjacent interior wildcards are invalid');
  const nameChars = Array.from(name.toLowerCase());
  const patternChars = Array.from(pattern);
  return patternChars.length <= nameChars.length && patternChars.every((character, index) => character === '*' || character === nameChars[index]);
}

function canonicalWildcardIds(rawQuery: string): string[] {
  const query = rawQuery.toLowerCase().trim().replace(/\*+$/u, '').replace(/\s+/gu, ' ');
  if (query.includes('**')) throw Error('adjacent interior wildcards are invalid');
  if (!query) return catalog.map(row => row.id);

  const separator = query.indexOf(' ');
  if (separator >= 0) {
    const manufacturerPrefix = query.slice(0, separator);
    const namePattern = query.slice(separator + 1);
    return catalog.filter(row => row.manufacturer.toLowerCase().startsWith(manufacturerPrefix) && nameMatchesWildcardPrefix(row.mold, namePattern)).map(row => row.id);
  }

  const manufacturerRows = catalog.filter(row => row.manufacturer.toLowerCase().startsWith(query));
  if (manufacturerRows.length) return manufacturerRows.map(row => row.id);
  return catalog.filter(row => nameMatchesWildcardPrefix(row.mold, query)).map(row => row.id);
}

test('builder verifies the committed runtime bytes and manifest without rewriting them', () => {
  const built = encodeMoldRuntime();
  assert.ok(Buffer.from(runtimeBytes).equals(built.binary));
  assert.deepEqual(built.manifest, moldRuntimeManifest);
  assert.deepEqual(verifyMoldRuntimeArtifact(), moldRuntimeManifest);
  assert.equal(HEADER_BYTES, moldRuntimeManifest.headerBytes);
  assert.equal(packedMoldIndex.assetSha256, hash(runtimeBytes));
  assert.equal(packedMoldIndex.sourceCatalogSha256, moldRuntimeManifest.sourceCatalogSha256);

  const view = viewOf(runtimeBytes);
  assert.equal(hash(runtimeBytes.subarray(HEADER_BYTES)), moldRuntimeManifest.payloadSha256);
  assert.equal(view.getUint32(20, true), HEADER_BYTES);
});

test('all 724 packed rows round-trip names, manufacturers, four flight slots, and stable IDs', () => {
  assert.equal(catalog.length, 724);
  assert.equal(packedMoldIndex.recordCount, catalog.length);
  assert.deepEqual(packedMoldIndex.stableIds, catalog.map(row => row.id));

  const explicitStableIdExceptions = catalog.filter(row => row.id !== derivedStableId(row.manufacturer, row.mold));
  assert.equal(explicitStableIdExceptions.length, 10);
  assert.equal(moldRuntimeManifest.stableIdExceptions, 10);

  let nullFlights = 0, undefinedFlights = 0;
  catalog.forEach((source, ordinal) => {
    const packed = packedMoldIndex.decodeRecord(ordinal);
    assert.equal(packed.id, source.id, `stable ID at ordinal ${ordinal}`);
    assert.equal(packed.manufacturer, source.manufacturer, `manufacturer at ordinal ${ordinal}`);
    assert.equal(packed.mold, source.mold, `mold name at ordinal ${ordinal}`);
    assert.equal(packed.flight.length, 4, `flight tuple width at ordinal ${ordinal}`);
    assert.deepEqual(packed.flight, Array.from({ length: 4 }, (_, index) => source.flight?.[index]), `flight tuple at ${source.id}`);
    assert.equal(packedMoldIndex.recordForId(source.id)?.id, source.id);

    for (let index = 0; index < 4; index++) {
      if (source.flight?.[index] === null) nullFlights++;
      if (source.flight?.[index] === undefined) undefinedFlights++;
    }
  });

  assert.ok(nullFlights > 0, 'fixture includes explicit null flight values');
  assert.equal(undefinedFlights, 0, 'canonical rows represent all unknown flight values as explicit nulls');
  assert.equal(packedMoldIndex.recordForId('not-a-real-catalog-id'), null, 'an unknown ID is not treated as ordinal zero');
});

test('packed trie search matches source-ordered name-prefix and one-codepoint wildcard results', () => {
  for (const query of ['buz', 'Buz', 'bu*z', 'fl*ing', 'flyng squrrel', 'buzx']) {
    const expected = canonicalWildcardIds(query);
    assert.deepEqual(packedMoldIndex.search(query, catalog.length).map(row => row.id), expected, `wildcard-prefix results for ${query}`);
  }
  assert.deepEqual(packedMoldIndex.search('buzx'), [], 'a spelling error is not accepted by Levenshtein fallback');
  assert.deepEqual(packedMoldIndex.search('destryer'), [], 'a transposition typo is not accepted by Levenshtein fallback');
  assert.deepEqual(packedMoldIndex.search('flyng squrrel'), [], 'a multi-token typo is not accepted by Levenshtein fallback');
  assert.deepEqual(packedMoldIndex.search('bu*z*', catalog.length).map(row => row.id), packedMoldIndex.search('bu*z', catalog.length).map(row => row.id), 'trailing wildcard runs are stripped before matching');
  assert.deepEqual(packedMoldIndex.search('buz***', catalog.length).map(row => row.id), packedMoldIndex.search('buz', catalog.length).map(row => row.id), 'trailing wildcard runs do not change prefix semantics');
  assert.throws(() => packedMoldIndex.search('bu**z'), error => error instanceof Error && error.name === 'MoldWildcardQueryError');
  assert.throws(() => packedMoldIndex.search('bu**z***'), error => error instanceof Error && error.name === 'MoldWildcardQueryError', 'trailing stars are stripped before interior adjacency is rejected');
});

test('packed trie search supports manufacturer prefixes and combined manufacturer-plus-name patterns', () => {
  const allRows = (query: string) => packedMoldIndex.search(query, catalog.length).map(row => row.id);
  assert.deepEqual(allRows('Discraft B*zz'), canonicalWildcardIds('Discraft B*zz'));
  assert.deepEqual(allRows('Discraft'), catalog.filter(row => row.manufacturer === 'Discraft').map(row => row.id));
  assert.deepEqual(allRows('Disc'), canonicalWildcardIds('Disc'), 'a manufacturer prefix lists all matching manufacturers in source order');
  assert.deepEqual(allRows('Nonexistent Buz'), []);
});

test('packed trie search preserves source order, empty-query, and result-limit behavior', () => {
  assert.deepEqual(packedMoldIndex.search('buz').map(row => row.id), canonicalWildcardIds('buz').slice(0, DEFAULT_LIMIT));
  assert.deepEqual(packedMoldIndex.search('', 20).map(row => row.id), catalog.slice(0, 20).map(row => row.id));
  assert.deepEqual(packedMoldIndex.search('').map(row => row.id), catalog.slice(0, DEFAULT_LIMIT).map(row => row.id));
  assert.deepEqual(packedMoldIndex.search('buz', 0), []);
  assert.throws(() => packedMoldIndex.search('buz', -1), /limit/);
  assert.throws(() => packedMoldIndex.search('buz', 1.5), /limit/);
});

test('parser rejects truncated and unsupported or inconsistent headers', () => {
  assert.throws(() => parsePackedMoldRuntime(new Uint8Array(0)), /truncated before its header/);
  assert.throws(() => parsePackedMoldRuntime(new Uint8Array(HEADER_BYTES - 1)), /truncated before its header/);

  const badMagic = cloneRuntime();
  badMagic[0] ^= 0xff;
  assert.throws(() => parsePackedMoldRuntime(badMagic), /magic differs/);

  const badFlags = cloneRuntime();
  viewOf(badFlags).setUint16(10, 0, true);
  assert.throws(() => parsePackedMoldRuntime(badFlags), /schema or flags are unsupported/);

  const badHeaderSize = cloneRuntime();
  viewOf(badHeaderSize).setUint32(20, HEADER_BYTES + 1, true);
  assert.throws(() => parsePackedMoldRuntime(badHeaderSize), /section sizes are inconsistent/);

  const badPayloadLength = cloneRuntime();
  viewOf(badPayloadLength).setUint32(56, viewOf(badPayloadLength).getUint32(56, true) + 1, true);
  assert.throws(() => parsePackedMoldRuntime(badPayloadLength), /section sizes are inconsistent/);

  const badTrieLength = cloneRuntime();
  viewOf(badTrieLength).setUint32(52, viewOf(badTrieLength).getUint32(52, true) + 1, true);
  assert.throws(() => parsePackedMoldRuntime(badTrieLength), /section sizes are inconsistent/);

  const badTag = cloneRuntime();
  badTag[156] ^= 1;
  assert.throws(() => parsePackedMoldRuntime(badTag), /normalizer\/header tag is unsupported/);
});

test('parser rejects name-pool offsets outside their pool and invalid flight codes', () => {
  const badOffsets = cloneRuntime();
  const offsetTable = HEADER_BYTES + viewOf(badOffsets).getUint32(24, true);
  const namePoolBytes = viewOf(badOffsets).getUint32(24, true);
  viewOf(badOffsets).setUint16(offsetTable + 2, namePoolBytes + 1, true);
  assert.throws(() => parsePackedMoldRuntime(badOffsets), /nonmonotone\/out-of-bounds string offsets/);

  const badFlightCode = cloneRuntime();
  const view = viewOf(badFlightCode);
  const codebookCounts = Array.from({ length: 4 }, (_, index) => view.getUint8(16 + index));
  const fieldIndex = codebookCounts.findIndex(count => count < 30);
  assert.notEqual(fieldIndex, -1, 'at least one 5-bit codebook leaves an invalid data code');
  const recordsOffset = HEADER_BYTES + view.getUint32(24, true) + view.getUint32(28, true) +
    view.getUint32(32, true) + view.getUint32(36, true) + view.getUint32(40, true);
  const shift = 8 + 5 * fieldIndex;
  const word = view.getUint32(recordsOffset, true);
  view.setUint32(recordsOffset, ((word & ~(0x1f << shift)) | (codebookCounts[fieldIndex] << shift)) >>> 0, true);
  assert.throws(() => parsePackedMoldRuntime(badFlightCode), /code .* out of range/);
});

test('parser rejects nonzero initial offsets, empty display strings, and a zero-manufacturer header', () => {
  const nonzeroFirstNameOffset = cloneRuntime();
  const nameOffsetsOffset = HEADER_BYTES + viewOf(nonzeroFirstNameOffset).getUint32(24, true);
  viewOf(nonzeroFirstNameOffset).setUint16(nameOffsetsOffset, 1, true);
  assert.throws(() => parsePackedMoldRuntime(nonzeroFirstNameOffset), Error, 'the first name offset must be zero');

  const emptyMoldName = cloneRuntime();
  const nameOffsets = HEADER_BYTES + viewOf(emptyMoldName).getUint32(24, true);
  viewOf(emptyMoldName).setUint16(nameOffsets + 2, 0, true);
  assert.throws(() => parsePackedMoldRuntime(emptyMoldName), Error, 'mold display names must be nonempty');

  const emptyManufacturer = cloneRuntime();
  const emptyManufacturerView = viewOf(emptyManufacturer);
  const manufacturerPoolOffset = HEADER_BYTES + emptyManufacturerView.getUint32(24, true) + emptyManufacturerView.getUint32(28, true);
  const manufacturerOffsetsOffset = manufacturerPoolOffset + emptyManufacturerView.getUint32(32, true);
  emptyManufacturerView.setUint16(manufacturerOffsetsOffset + 2, 0, true);
  assert.throws(() => parsePackedMoldRuntime(emptyManufacturer), Error, 'manufacturer display names must be nonempty');

  const noManufacturers = cloneRuntime();
  viewOf(noManufacturers).setUint16(14, 0, true);
  assert.throws(() => parsePackedMoldRuntime(noManufacturers), Error, 'a nonempty catalog needs a manufacturer dictionary');
});

test('parser rejects reserved high bits in packed records', () => {
  const reservedBits = cloneRuntime();
  const view = viewOf(reservedBits);
  const recordsOffset = HEADER_BYTES + view.getUint32(24, true) + view.getUint32(28, true) +
    view.getUint32(32, true) + view.getUint32(36, true) + view.getUint32(40, true);
  view.setUint32(recordsOffset, view.getUint32(recordsOffset, true) | 0xf0000000, true);
  assert.throws(() => parsePackedMoldRuntime(reservedBits), Error, 'bits 28–31 are reserved by schema v1');
});

test('asset verifier rejects a payload digest mismatch even when the full-asset digest is current', async () => {
  const tampered = cloneRuntime();
  tampered[HEADER_BYTES] ^= 1; // keep the header digest stale while refreshing only the manifest's full-asset digest
  const expectedManifest = { ...moldRuntimeManifest, assetSha256: hash(tampered) };
  await assert.rejects(verifyPackedMoldAsset(tampered, expectedManifest), /payload checksum differs/);
});

test('record decoding rejects negative, past-end, noninteger, and nonfinite ordinals', () => {
  for (const ordinal of [-1, packedMoldIndex.recordCount, packedMoldIndex.recordCount + 1, 0.5, NaN, Infinity]) {
    assert.throws(() => packedMoldIndex.decodeRecord(ordinal), /ordinal .* out of range/, `ordinal ${ordinal}`);
  }
});
