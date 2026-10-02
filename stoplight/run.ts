// node --experimental-strip-types run.ts   -> prints the stoplight, writes stoplight.json and index.html
// Reads items.json. Crucible folders and inputs are relative to this folder; a missing one is yellow.
// STOPLIGHT_PREVIOUS=<path to an earlier stoplight.json> turns on delta reuse.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExecBoard, trackAccess } from './board.ts';
import { renderPage } from './page.ts';
import { StoplightPxC, computeLights, registerStoplight, runCrucibles, type CrucibleResult, type Item, type ItemLight } from './stoplight.ts';

const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(here, 'items.json'), 'utf8')) as { items: Item[] };
const items: Item[] = spec.items.map((item) => ({
	...item,
	crucibles: item.crucibles.map((c) => ({ ...c, cwd: resolve(here, c.cwd) }))
}));

const pxc = createExecBoard();
registerStoplight(pxc);
pxc.set(StoplightPxC.root, here);
pxc.set(StoplightPxC.items, items);
const previousPath = process.env.STOPLIGHT_PREVIOUS;
if (previousPath && existsSync(previousPath)) {
	try {
		const prior = JSON.parse(readFileSync(previousPath, 'utf8')) as { lights?: ItemLight[] };
		const byItem: Record<string, readonly CrucibleResult[]> = {};
		for (const l of prior.lights ?? []) byItem[l.item] = l.has.crucibles.results;
		pxc.set(StoplightPxC.previous, byItem);
	} catch {
		console.log('(previous stoplight.json unreadable; running everything)');
	}
}
const stage1 = trackAccess(pxc, { id: 'stage1.runCrucibles', consumes: [StoplightPxC.items.address] });
runCrucibles(stage1.tracked);
const stage2 = trackAccess(pxc, { id: 'stage2.computeLights', consumes: [] });
const lights = computeLights(stage2.tracked);

const dot = { green: '🟢', yellow: '🟡', red: '🔴' } as const;
const tally = (l: string) => lights.filter((x) => x.light === l).length;
console.log(`Stoplight: ${tally('green')} green, ${tally('yellow')} yellow, ${tally('red')} red`);
for (const l of lights) console.log(`${dot[l.light]} ${l.item.padEnd(14)} ${l.why}`);
const testimony = (tick: string, t: ReturnType<typeof trackAccess>) => ({ tick, read: [...t.consumed], wrote: t.writes });
const receipt = {
	schema: 'lane-stoplight@0',
	commit: process.env.GITHUB_SHA,
	ranAt: new Date().toISOString(),
	items: spec.items.map(({ id, what }) => ({ id, what })),
	lights,
	ticks: [testimony('stage1.runCrucibles', stage1), testimony('stage2.computeLights', stage2)]
};
writeFileSync(join(here, 'stoplight.json'), JSON.stringify(receipt, null, 2) + '\n');
writeFileSync(join(here, 'index.html'), renderPage(receipt));
