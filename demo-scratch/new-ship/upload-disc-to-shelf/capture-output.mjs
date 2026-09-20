import fs from 'node:fs';
import path from 'node:path';
export function captureFiles(out, label) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(label)) throw new Error('label must be a safe filename stem');
  const root = path.resolve(out), files = { creatorPath: path.join(root, `${label}-creator.png`), inspectorPath: path.join(root, `${label}-pxc-devtools.png`), manifestPath: path.join(root, `${label}.json`) };
  for (const file of Object.values(files)) if (path.dirname(file) !== root) throw new Error('capture output escapes directory');
  return files;
}
export function clearCaptureFiles(files) { for (const file of Object.values(files)) fs.rmSync(file, { force: true }); }
