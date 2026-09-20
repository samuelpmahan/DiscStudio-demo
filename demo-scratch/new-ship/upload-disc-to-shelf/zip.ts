// Deterministic ZIP32 STORE writer. No clocks, random IDs, network, or compression side effects.
const encoder = new TextEncoder();
function crc32(bytes: Uint8Array) { let c = 0xffffffff; for (const byte of bytes) { c ^= byte; for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
const u16 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255]);
const u32 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const concat = (parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0)); let at = 0; for (const part of parts) { out.set(part, at); at += part.length; } return out; };
export function storedZip(files: { name: string; bytes: Uint8Array }[]): Blob {
  if (!files.length || files.length > 65535 || new Set(files.map(file => file.name)).size !== files.length) throw new Error('ZIP needs distinct filenames.');
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = []; let offset = 0;
  for (const file of files) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(file.name) || file.name === '.' || file.name === '..') throw new Error('Unsafe export filename.');
    if (!(file.bytes instanceof Uint8Array) || file.bytes.length > 0xffffffff) throw new Error('ZIP requires Uint8Array data within ZIP32 limits.');
    const name = encoder.encode(file.name), crc = crc32(file.bytes);
    const local = concat([u32(0x04034b50), u16(20), u16(0x800), u16(0), u16(0), u16(33), u32(crc), u32(file.bytes.length), u32(file.bytes.length), u16(name.length), u16(0), name, file.bytes]);
    locals.push(local); centrals.push(concat([u32(0x02014b50), u16(20), u16(20), u16(0x800), u16(0), u16(0), u16(33), u32(crc), u32(file.bytes.length), u32(file.bytes.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name])); offset += local.length;
  }
  if (offset > 0xffffffff) throw new Error('Export exceeds ZIP32 limits.');
  const central = concat(centrals), end = concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(central.length), u32(offset), u16(0)]);
  return new Blob([...locals, central, end], { type: 'application/zip' });
}
