import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { storedZip } from './zip.ts';
import { cardDimensions, prepareExport, type CardRenderer, type QueuedCard } from './export-queue-core.ts';
export * from './export-queue-core.ts';

const crcTable = (() => { const table = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c; } return table; })();
function crc32(buf: Buffer): number { let c = -1; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function pngChunk(type: string, data: Buffer): Buffer { const length = Buffer.alloc(4); length.writeUInt32BE(data.length, 0); const kind = Buffer.from(type, 'ascii'); const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([kind, data])), 0); return Buffer.concat([length, kind, data, checksum]); }
/** Test-only transparent encoder. Production browser export always supplies the shared card renderer. */
export function encodeTransparentPng(width: number, height: number): Buffer { if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) throw new Error(`encodeTransparentPng: bad dimensions ${width}x${height}.`); const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6; const raw = Buffer.alloc(height * (1 + width * 4)); return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]); }
export function pngDimensions(png: Uint8Array) { const bytes = Buffer.from(png); if (bytes.length < 33 || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Not a PNG with an IHDR where expected.'); return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }; }
export const stubCardRenderer: CardRenderer = async card => { const { width, height } = cardDimensions(card.orientation); return encodeTransparentPng(width, height); };
export interface ExportOptions { renderCard?: CardRenderer; }
export async function exportZip(queue: readonly QueuedCard[], options: ExportOptions = {}): Promise<Buffer> {
  const renderCard = options.renderCard ?? stubCardRenderer;
  const { rendered, manifest } = await prepareExport(queue, renderCard, async bytes => createHash('sha256').update(bytes).digest('hex'));
  const blob = storedZip([...rendered.map(({ filename, png }) => ({ name: filename, bytes: png })), { name: 'manifest.json', bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) }]);
  return Buffer.from(await blob.arrayBuffer());
}
