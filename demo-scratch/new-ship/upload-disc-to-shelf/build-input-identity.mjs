import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ignored = new Set(['node_modules', 'dist', 'renders', 'renders-real', 'mvp-output', 'candidate-evidence', 'evidence']);
const skipped = name => /(?:\.test\.|\.bundle\.js$|^(?:drive-real-ui|paired-capture|capture-output|url-free-materializer|capture-initial-scenario|instrumented-run|mvp-run|render-presets|render-breakout|painted-card-evidence|painted-return-probe|photo-bag-two-card-evidence)\.mjs$|^(?:test-page|preset-gallery))/.test(name);
function sourceFiles(root, relative = '') {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
    if (ignored.has(entry.name) || skipped(entry.name)) return [];
    const rel = path.join(relative, entry.name);
    if (entry.isDirectory()) return sourceFiles(root, rel);
    return entry.isFile() && (/\.(?:ts|mjs|css|html|svg)$/.test(entry.name) || rel === 'vendor/neat/tick-part-checklist.js') ? [rel] : [];
  });
}
export function buildInputIdentity() {
  const hash = crypto.createHash('sha256');
  for (const relative of sourceFiles(here).sort()) hash.update(relative).update('\0').update(fs.readFileSync(path.join(here, relative))).update('\0');
  hash.update('../part-first-kernel/src/pxc.mjs').update('\0').update(fs.readFileSync(path.join(here, '../part-first-kernel/src/pxc.mjs')));
  return hash.digest('hex');
}
