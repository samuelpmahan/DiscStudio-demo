// Narrow DiscStudio adapter: compare the resolved overlay binding to source and
// browser materialization; invoke the established generator/build only on delta.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildInputIdentity } from './build-input-identity.mjs';
import { buildOutputIdentity } from './build-output-identity.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const desiredPath = process.argv[2];
if (!desiredPath || process.argv.length !== 3) throw Error('Usage: node crisp-recompose.mjs <resolved-desired.json>');
const desired = JSON.parse(fs.readFileSync(desiredPath, 'utf8'));
const graph = desired.graph;
const identity = crypto.createHash('sha256').update(JSON.stringify(graph)).digest('hex');
if (desired.kind !== 'kompoze.resolved/v1' || desired.identity !== identity || graph.base !== 'discstudio-demo-photo-first' || !Array.isArray(graph.overlays) || graph.overlays.length > 1 || graph.overlays.some(name => name !== 'painted-discs') || graph.capabilities?.paintedDiscs !== graph.overlays.includes('painted-discs')) throw Error('Desired graph is not a valid DiscStudio Kompoze resolution.');
const canonical = JSON.parse(execFileSync(process.execPath, ['kompoze-resolve.mjs', ...(graph.overlays.length ? ['--overlay', ...graph.overlays] : [])], { cwd: here, encoding: 'utf8' }));
if (canonical.identity !== identity || JSON.stringify(canonical.graph) !== JSON.stringify(graph)) throw Error('Desired graph diverges from the current overlay declaration.');
const source = path.join(here, 'kompozition.ts');
const built = path.join(here, 'dist/kompozition.js');
const binding = `Object.freeze(${JSON.stringify(graph.overlays)} as string[])`;
const builtBinding = new RegExp(`activeOverlays\\s*=\\s*Object\\.freeze\\(${JSON.stringify(graph.overlays).replace(/[\[\]]/g, '\\$&')}\\s*\\)`);
const sourceMatches = fs.readFileSync(source, 'utf8').includes(binding);
const sourceId = buildInputIdentity();
const priorBuildInfo = fs.existsSync(path.join(here, 'dist/BUILD_INFO.json')) ? JSON.parse(fs.readFileSync(path.join(here, 'dist/BUILD_INFO.json'), 'utf8')) : null;
const builtMatches = fs.existsSync(built) && builtBinding.test(fs.readFileSync(built, 'utf8')) && priorBuildInfo?.sourceId === sourceId && priorBuildInfo?.outputId === buildOutputIdentity(path.join(here, 'dist'));
const actions = [];
if (!sourceMatches) {
  execFileSync(process.execPath, ['kompoze-materialize.mjs', ...(graph.overlays.length ? ['--overlay', ...graph.overlays] : []), '--in-place'], { cwd: here });
  actions.push('bind-overlay');
}
if (!sourceMatches || !builtMatches) {
  execFileSync(process.execPath, ['build.mjs'], { cwd: here });
  actions.push('build-browser-materialization');
}
const finalSource = fs.readFileSync(source, 'utf8');
const finalBuilt = fs.readFileSync(built, 'utf8');
if (!finalSource.includes(binding) || !builtBinding.test(finalBuilt)) throw Error('crisp binding readback failed.');
const finalBuildInfo = JSON.parse(fs.readFileSync(path.join(here, 'dist/BUILD_INFO.json'), 'utf8'));
if (finalBuildInfo.sourceId !== buildInputIdentity() || finalBuildInfo.outputId !== buildOutputIdentity(path.join(here, 'dist'))) throw Error('Build identity changed during recomposition.');
const receipt = { kind: 'crisp.recomposition/v1', desiredIdentity: identity, base: graph.base, overlays: graph.overlays, ticks: graph.ticks.map(tick => tick.address), declaredObservations: graph.observe, observedFulfillment: 'BINDING_ONLY', outcome: actions.length ? 'EXTEND' : 'REUSE', actions, sourceSha256: crypto.createHash('sha256').update(finalSource).digest('hex'), sourceId: finalBuildInfo.sourceId, outputId: finalBuildInfo.outputId, buildId: finalBuildInfo.buildId };
process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
