// Build the portable Pages directory without a bundler. Node strips authored
// TypeScript and rewrites only relative source suffixes; the browser receives
// ordinary ES modules with every required local dependency beside index.html.
import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
const ignored = new Set(['node_modules', 'dist', 'renders', 'renders-real', 'mvp-output']);
const skip = name => /(?:\.test\.|\.bundle\.js$|^(?:drive-real-ui|paired-capture|capture-output|url-free-materializer|capture-initial-scenario|instrumented-run|mvp-run|render-presets|render-breakout)\.mjs$|^(?:test-page|preset-gallery))/.test(name);
const rewriteImports = text => text
  .replace(/(from\s*['"][^'"]+)\.ts(['"])/g, '$1.js$2')
  .replace(/(import\s*\(\s*['"][^'"]+)\.ts(['"]\s*\))/g, '$1.js$2')
  .replaceAll("'../part-first-kernel/src/pxc.mjs'", "'./kernel/pxc.mjs'");
function copyTree(source, relative = '') {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (ignored.has(entry.name) || skip(entry.name)) continue;
    const from = path.join(source, entry.name), rel = path.join(relative, entry.name);
    if (entry.isDirectory()) { copyTree(from, rel); continue; }
    if (!entry.isFile()) continue;
    if (!/\.(?:ts|mjs|css|html|svg)$/.test(entry.name)) continue;
    const targetRel = entry.name.endsWith('.ts') ? rel.slice(0, -3) + '.js' : rel;
    const to = path.join(dist, targetRel); fs.mkdirSync(path.dirname(to), { recursive: true });
    if (entry.name.endsWith('.ts')) fs.writeFileSync(to, rewriteImports(stripTypeScriptTypes(fs.readFileSync(from, 'utf8'))));
    else if (entry.name.endsWith('.mjs')) fs.writeFileSync(to, rewriteImports(fs.readFileSync(from, 'utf8')));
    else fs.copyFileSync(from, to);
  }
}
fs.rmSync(dist, { recursive: true, force: true }); fs.mkdirSync(dist, { recursive: true });
copyTree(here);
// Native-only adapters have bare Node imports and are deliberately absent from
// the Pages graph. The shared Canvas2D renderer is browser-card-renderer.js.
for (const file of ['card-renderer.js', 'export-queue.js']) fs.rmSync(path.join(dist, file), { force: true });
fs.mkdirSync(path.join(dist, 'kernel'), { recursive: true });
fs.copyFileSync(path.join(here, '../part-first-kernel/src/pxc.mjs'), path.join(dist, 'kernel/pxc.mjs'));
const index = path.join(dist, 'index.html');
fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('src="./app.ts"', 'src="./app.js"'));
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
fs.writeFileSync(path.join(dist, 'BUILD_INFO.json'), JSON.stringify({ artifact: 'discstudio-tournament-pages', source: 'new-ship/upload-disc-to-shelf', build: 'node-strip-types', static: true }, null, 2) + '\n');
console.log(`Built ${dist}`);
