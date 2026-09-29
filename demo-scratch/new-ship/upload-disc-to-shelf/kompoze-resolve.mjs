// Declaration only. crisp owns changing the running materialization.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--overlay' || args[1] !== 'painted-discs')) throw Error('Usage: node kompoze-resolve.mjs [--overlay painted-discs]');
const requested = args.length ? ['painted-discs'] : [];
const overlay = JSON.parse(fs.readFileSync(path.join(here, 'overlays/painted-discs.overlay.json'), 'utf8'));
if (overlay.id !== 'painted-discs' || overlay.base !== 'discstudio-demo-photo-first' || overlay.deltas.length !== 3) throw Error('Painted overlay declaration changed; inspect its Contract before resolving.');
const graph = { base: overlay.base, overlays: requested, capabilities: { paintedDiscs: requested.includes(overlay.id) }, ticks: requested.length ? overlay.deltas.map(({ address, effect }) => ({ address, effect })) : [], observe: requested.length ? overlay.observe : ['Contract.AddDiscToTodaysBag', 'Contract.ApprovePhotoFirstCardForExport', 'Contract.ExportApprovedZip', 'Part.Disc.depiction', 'Part.Art', 'Part.Bag', 'Part.Shelf', 'Part.OutputQueue'] };
const identity = crypto.createHash('sha256').update(JSON.stringify(graph)).digest('hex');
process.stdout.write(JSON.stringify({ kind: 'kompoze.resolved/v1', identity, graph }, null, 2) + '\n');
