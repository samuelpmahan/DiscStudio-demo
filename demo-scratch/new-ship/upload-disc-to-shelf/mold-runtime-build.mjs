#!/usr/bin/env node
// Build-time generator for the compact mold runtime table. The authoritative
// source remains catalog.ts; this module is excluded from the browser graph.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileMoldWildcardTrie } from './mold-wildcard-trie.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HEADER_BYTES = 176;
const MAGIC = Buffer.from('MOLDRUN1', 'ascii');
const NORMALIZER_TAG = 'MOLD-WILD1';
const FIELDS = ['speed', 'glide', 'turn', 'fade'];
const FLAG_SOURCE_ORDER = 1;
const FLAG_SINGLE_DISPLAY = 2;
const FLAG_ID_EXCEPTIONS = 4;
const FLAG_STABLE_SLUG_V1 = 8;
const FLAGS = FLAG_SOURCE_ORDER | FLAG_SINGLE_DISPLAY | FLAG_ID_EXCEPTIONS | FLAG_STABLE_SLUG_V1;

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest();
const hex = bytes => Buffer.from(bytes).toString('hex');
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function sourceArray(file, exportName) {
  const source = fs.readFileSync(file, 'utf8');
  const marker = `export const ${exportName} =`;
  const start = source.indexOf(marker), end = source.lastIndexOf('];');
  if (start < 0 || end <= start) throw Error(`Could not locate ${exportName} in ${file}`);
  const jsonStart = source.indexOf('[', start + marker.length);
  if (jsonStart < 0 || jsonStart >= end) throw Error(`Could not parse ${exportName} in ${file}`);
  return JSON.parse(source.slice(jsonStart, end + 1));
}

function packStrings(values) {
  const strings = values.map(value => Buffer.from(value, 'utf8'));
  const byteLength = strings.reduce((sum, value) => sum + value.byteLength, 0);
  if (byteLength > 0xffff) throw Error('UTF-8 string pool exceeds the 16-bit offset limit');
  const offsets = Buffer.alloc((strings.length + 1) * 2);
  const pool = Buffer.alloc(byteLength);
  let cursor = 0;
  for (let index = 0; index < strings.length; index++) {
    offsets.writeUInt16LE(cursor, index * 2);
    strings[index].copy(pool, cursor); cursor += strings[index].byteLength;
  }
  offsets.writeUInt16LE(cursor, strings.length * 2);
  return { pool, offsets };
}

const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'card';
const derivedId = row => `${slug(row.manufacturer)}--${slug(row.mold)}`;

export function encodeMoldRuntime(root = HERE) {
  const catalogPath = path.join(root, 'catalog.ts');
  const litePath = path.join(root, 'catalog-lite.ts');
  const versionPath = path.resolve(root, '../../../version.json');
  const fullBytes = fs.readFileSync(catalogPath);
  const rows = sourceArray(catalogPath, 'catalog');
  const lite = sourceArray(litePath, 'catalogLite');
  const version = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
  if (!rows.length || rows.length > 0xffff || rows.length !== lite.length) throw Error('Catalog and lite index row counts differ');
  const ids = new Set();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], liteRow = lite[index];
    if (!row || typeof row.id !== 'string' || !/^[\w.-]+$/.test(row.id) || ids.has(row.id)) throw Error(`Invalid or duplicate stable catalog ID at ${index}`);
    ids.add(row.id);
    if (row.id !== liteRow.id || row.manufacturer !== liteRow.manufacturer || row.mold !== liteRow.mold) throw Error(`catalog-lite order or facts differ at ${index}`);
    if (typeof row.manufacturer !== 'string' || typeof row.mold !== 'string') throw Error(`Invalid runtime display fact at ${row.id}`);
    if (row.flight !== undefined && (!Array.isArray(row.flight) || row.flight.length !== 4)) throw Error(`Invalid flight tuple at ${row.id}`);
    for (const field of FIELDS) {
      const value = row.flight?.[FIELDS.indexOf(field)];
      if (value !== undefined && value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw Error(`Invalid ${field} at ${row.id}`);
    }
  }

  const manufacturerNames = [...new Set(rows.map(row => row.manufacturer))].sort(compareText);
  if (manufacturerNames.length > 128) throw Error('Schema v1 supports at most 128 manufacturers');
  const manufacturerCodes = new Map(manufacturerNames.map((value, index) => [value, index]));
  const codebooks = FIELDS.map((_, fieldIndex) => {
    const values = [...new Set(rows.map(row => row.flight?.[fieldIndex]).filter(value => typeof value === 'number'))].sort((a, b) => a - b);
    if (values.length > 30 || values.some(value => Math.fround(value) !== value)) throw Error(`${FIELDS[fieldIndex]} cannot round-trip in the 5-bit Float32 codebook`);
    return values;
  });
  const codebookMaps = codebooks.map(values => new Map(values.map((value, index) => [value, index])));
  const namePool = packStrings(rows.map(row => row.mold));
  const manufacturerPool = packStrings(manufacturerNames);
  const codebookBytes = Buffer.concat(codebooks.map(values => {
    const bytes = Buffer.alloc(values.length * 4);
    values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
    return bytes;
  }));
  const records = Buffer.alloc(rows.length * 4);
  const idExceptions = [];
  rows.forEach((row, ordinal) => {
    let bits = manufacturerCodes.get(row.manufacturer);
    for (let fieldIndex = 0; fieldIndex < FIELDS.length; fieldIndex++) {
      const value = row.flight?.[fieldIndex];
      const code = value === undefined ? 31 : value === null ? 30 : codebookMaps[fieldIndex].get(value);
      if (!Number.isInteger(code) || code < 0 || code > 31) throw Error(`Unencodable ${FIELDS[fieldIndex]} value at ${row.id}`);
      bits |= code << (8 + 5 * fieldIndex);
    }
    records.writeUInt32LE(bits >>> 0, ordinal * 4);
    if (derivedId(row) !== row.id) {
      const id = Buffer.from(row.id, 'utf8');
      if (!id.byteLength || id.byteLength > 255) throw Error(`Stable ID exception too long at ${ordinal}`);
      idExceptions.push({ ordinal, id });
    }
  });
  const exceptionBytes = Buffer.alloc(idExceptions.reduce((size, row) => size + 3 + row.id.byteLength, 0));
  let exceptionCursor = 0;
  for (const row of idExceptions) {
    exceptionBytes.writeUInt16LE(row.ordinal, exceptionCursor); exceptionCursor += 2;
    exceptionBytes.writeUInt8(row.id.byteLength, exceptionCursor); exceptionCursor += 1;
    row.id.copy(exceptionBytes, exceptionCursor); exceptionCursor += row.id.byteLength;
  }

  const wildcardTrieBytes = Buffer.from(compileMoldWildcardTrie(rows.map(row => row.mold)));

  const payload = Buffer.concat([
    namePool.pool, namePool.offsets,
    manufacturerPool.pool, manufacturerPool.offsets,
    codebookBytes, records, exceptionBytes, wildcardTrieBytes,
  ]);
  const sourceHash = sha256(fullBytes);
  const dictionaryBytes = Buffer.concat([manufacturerPool.pool, manufacturerPool.offsets, codebookBytes]);
  const dictionaryHash = sha256(dictionaryBytes);
  const payloadHash = sha256(payload);
  const header = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(header, 0);
  header.writeUInt16LE(1, 8); header.writeUInt16LE(FLAGS, 10);
  header.writeUInt16LE(rows.length, 12); header.writeUInt16LE(manufacturerNames.length, 14);
  codebooks.forEach((values, fieldIndex) => header.writeUInt8(values.length, 16 + fieldIndex));
  header.writeUInt32LE(HEADER_BYTES, 20);
  header.writeUInt32LE(namePool.pool.byteLength, 24); header.writeUInt32LE(namePool.offsets.byteLength, 28);
  header.writeUInt32LE(manufacturerPool.pool.byteLength, 32); header.writeUInt32LE(manufacturerPool.offsets.byteLength, 36);
  header.writeUInt32LE(codebookBytes.byteLength, 40); header.writeUInt32LE(records.byteLength, 44);
  header.writeUInt32LE(exceptionBytes.byteLength, 48); header.writeUInt32LE(wildcardTrieBytes.byteLength, 52);
  header.writeUInt32LE(payload.byteLength, 56);
  sourceHash.copy(header, 60); dictionaryHash.copy(header, 92); payloadHash.copy(header, 124);
  const normalizerTag = Buffer.from(NORMALIZER_TAG, 'ascii');
  normalizerTag.copy(header, 156); // bytes 166..167 are reserved
  header.writeUInt16LE(idExceptions.length, 168);
  const binary = Buffer.concat([header, payload]);
  const artifactSha256 = hex(sha256(binary));
  const manifest = {
    schema: 1, catalogVersion: `${version.x}.${version.y}.${version.z}`,
    sourceCatalogSha256: hex(sourceHash), dictionarySha256: hex(dictionaryHash),
    payloadSha256: hex(payloadHash), wildcardTrieSha256: hex(sha256(wildcardTrieBytes)), assetSha256: artifactSha256,
    recordCount: rows.length, byteLength: binary.byteLength, headerBytes: HEADER_BYTES,
    normalizer: NORMALIZER_TAG, stableIdExceptions: idExceptions.length,
    wildcardTrieBytes: wildcardTrieBytes.byteLength,
    wildcardTrieNodes: wildcardTrieBytes.readUInt16LE(14),
  };
  return { binary, manifest, rows };
}

export function verifyMoldRuntimeArtifact(root = HERE) {
  const built = encodeMoldRuntime(root);
  const binaryPath = path.join(root, 'mold-runtime.bin');
  const manifestPath = path.join(root, 'mold-runtime-manifest.ts');
  if (!fs.existsSync(binaryPath) || !fs.existsSync(manifestPath)) throw Error('Missing generated packed mold runtime; run mold-runtime-build.mjs --write');
  const committed = fs.readFileSync(binaryPath);
  if (!committed.equals(built.binary)) throw Error('Packed mold runtime differs from catalog.ts; regenerate and review it');
  const manifestSource = fs.readFileSync(manifestPath, 'utf8');
  const expectedManifestSource = `export const moldRuntimeManifest = Object.freeze(${JSON.stringify(built.manifest, null, 2)});\n`;
  if (manifestSource !== expectedManifestSource) throw Error('Packed mold runtime manifest is stale; regenerate and review it');
  return built.manifest;
}

function direct() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
if (direct()) {
  const built = encodeMoldRuntime(HERE);
  const binaryPath = path.join(HERE, 'mold-runtime.bin');
  const manifestPath = path.join(HERE, 'mold-runtime-manifest.ts');
  if (process.argv.includes('--write')) {
    fs.writeFileSync(binaryPath, built.binary);
    fs.writeFileSync(manifestPath, `export const moldRuntimeManifest = Object.freeze(${JSON.stringify(built.manifest, null, 2)});\n`);
    console.log(JSON.stringify({ ...built.manifest, binaryPath, manifestPath }, null, 2));
  } else {
    const verified = verifyMoldRuntimeArtifact(HERE);
    console.log(JSON.stringify({ ...verified, verified: true }, null, 2));
  }
}
