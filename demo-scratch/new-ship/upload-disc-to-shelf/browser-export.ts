import { prepareExport, type CardRenderer, type QueuedCard } from './export-queue-core.ts';
import { storedZip } from './zip.ts';

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
async function sha256(bytes: Uint8Array): Promise<string> { return hex(await crypto.subtle.digest('SHA-256', bytes)); }
export async function exportBrowserZip(queue: readonly QueuedCard[], renderCard: CardRenderer): Promise<{ blob: Blob; manifest: object }> {
  const { rendered, manifest } = await prepareExport(queue, renderCard, sha256);
  const blob = storedZip([...rendered.map(({ filename, png }) => ({ name: filename, bytes: png })), { name: 'manifest.json', bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) }]);
  return { blob, manifest };
}
export function downloadBlob(blob: Blob, filename: string) {
  const anchor = document.createElement('a'), url = URL.createObjectURL(blob); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
