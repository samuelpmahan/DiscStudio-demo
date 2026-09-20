import { prepareExport, type CardRenderer, type QueuedCard } from './export-queue-core.ts';
import { storedZip } from './zip.ts';

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
async function sha256(bytes: Uint8Array): Promise<string> { return hex(await crypto.subtle.digest('SHA-256', bytes)); }
export async function exportBrowserZip(queue: readonly QueuedCard[], renderCard: CardRenderer): Promise<{ blob: Blob; manifest: object }> {
  const { rendered, manifest } = await prepareExport(queue, renderCard, sha256);
  const blob = storedZip([...rendered.map(({ filename, png }) => ({ name: filename, bytes: png })), { name: 'manifest.json', bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) }]);
  return { blob, manifest };
}
export function downloadUrl(url: string, filename: string) {
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.style.position = 'fixed'; anchor.style.left = '-10000px';
  document.body.append(anchor); anchor.click(); anchor.remove();
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); downloadUrl(url, filename); setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
