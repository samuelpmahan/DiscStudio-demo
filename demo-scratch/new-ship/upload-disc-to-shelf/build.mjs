// Build the portable Pages directory without a bundler. Node strips authored
// TypeScript and rewrites only relative source suffixes; the browser receives
// ordinary ES modules with every required local dependency beside index.html.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
const ignored = new Set(['node_modules', 'dist', 'renders', 'renders-real', 'mvp-output', 'candidate-evidence']);
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
function filesIn(root, relative = '') {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
    const rel = path.join(relative, entry.name);
    return entry.isDirectory() ? filesIn(root, rel) : entry.isFile() ? [rel] : [];
  });
}
function buildIdFor(root) {
  const hash = crypto.createHash('sha256');
  for (const relative of filesIn(root).sort()) {
    hash.update(relative).update('\0').update(fs.readFileSync(path.join(root, relative))).update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}
function versionModuleImports(text, buildId) {
  const suffix = `?v=${buildId}`;
  return text.replace(/((?:from\s*|import\s*\(\s*|import\s*)['"])(\.{1,2}\/[^'"]+\.(?:js|mjs))(['"])/g, `$1$2${suffix}$3`);
}
function versionStylesheetHrefs(text, buildId) {
  return text.replace(/(stylesheet\.href\s*=\s*['"])(\.{1,2}\/[^'"]+\.css)(['"])/g, `$1$2?v=${buildId}$3`);
}
function verifyVersionedImports(root, buildId) {
  const matcher = /(?:from\s*|import\s*\(\s*|import\s*)['"](\.{1,2}\/[^'"]+\.(?:js|mjs))(?:\?v=([^'"]+))?['"]/g;
  for (const relative of filesIn(root).filter(file => /\.(?:js|mjs)$/.test(file))) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    const cssMatcher = /stylesheet\.href\s*=\s*['"](\.{1,2}\/[^'"]+\.css)(?:\?v=([^'"]+))?['"]/g; let cssMatch;
    while ((cssMatch = cssMatcher.exec(source))) {
      if (cssMatch[2] !== buildId) throw Error(`Unversioned or mismatched stylesheet reference in ${relative}: ${cssMatch[1]}`);
      const target = path.resolve(path.dirname(path.join(root, relative)), cssMatch[1]);
      if (!target.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(target)) throw Error(`Missing built stylesheet from ${relative}: ${cssMatch[1]}`);
    }
    let match;
    while ((match = matcher.exec(source))) {
      if (match[2] !== buildId) throw Error(`Unversioned or mismatched module import in ${relative}: ${match[1]}`);
      const target = path.resolve(path.dirname(path.join(root, relative)), match[1]);
      if (!target.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(target)) throw Error(`Missing built module from ${relative}: ${match[1]}`);
    }
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
const buildId = buildIdFor(dist);
for (const relative of filesIn(dist).filter(file => /\.(?:js|mjs)$/.test(file))) {
  const file = path.join(dist, relative); fs.writeFileSync(file, versionStylesheetHrefs(versionModuleImports(fs.readFileSync(file, 'utf8'), buildId), buildId));
}
fs.writeFileSync(index, fs.readFileSync(index, 'utf8')
  .replace('href="./style.css"', `href="./style.css?v=${buildId}"`)
  .replace('src="./app.ts"', `src="./app.js?v=${buildId}"`));
verifyVersionedImports(dist, buildId);
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
fs.writeFileSync(path.join(dist, 'BUILD_INFO.json'), JSON.stringify({ artifact: 'discstudio-tournament-pages', source: 'new-ship/upload-disc-to-shelf', build: 'node-strip-types', static: true, buildId }, null, 2) + '\n');
console.log(`Built ${dist} (${buildId})`);
