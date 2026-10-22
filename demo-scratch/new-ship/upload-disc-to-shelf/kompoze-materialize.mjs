import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const overlayIndex = args.indexOf('--overlay');
const overlays = overlayIndex >= 0 ? args.slice(overlayIndex + 1).filter(arg => !arg.startsWith('--')) : [];
const unknown = overlays.filter(name => name !== 'painted-discs');
if (unknown.length) throw Error(`Unknown overlay: ${unknown.join(', ')}`);
const target = args.includes('--in-place') ? path.join(here, 'kompozition.ts') : path.join(here, 'kompozition.materialized.ts');
const source = `export const activeOverlays = Object.freeze(${JSON.stringify(overlays)} as string[]);\n\nexport const kompozition = Object.freeze({\n  id: 'discstudio-demo-photo-first',\n  overlays: activeOverlays,\n  capabilities: Object.freeze({\n    paintedDiscs: activeOverlays.includes('painted-discs'),\n  }),\n});\n\nexport const paintedDiscsEnabled = kompozition.capabilities.paintedDiscs;\n`;
fs.writeFileSync(target, source);
console.log(JSON.stringify({ target: path.relative(here, target), base: 'discstudio-demo-photo-first', overlays }, null, 2));
