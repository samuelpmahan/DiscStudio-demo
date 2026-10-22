import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { kompozition, paintedDiscsEnabled } from './kompozition.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

test('base Kompozition is photo-first and painted discs are not active', () => {
  assert.equal(kompozition.id, 'discstudio-demo-photo-first');
  assert.deepEqual([...kompozition.overlays], []);
  assert.equal(paintedDiscsEnabled, false);
});

test('painted-disc capability is preserved as one named overlay spanning multiple Ticks', () => {
  const overlay = JSON.parse(fs.readFileSync(path.join(here, 'overlays/painted-discs.overlay.json'), 'utf8'));
  assert.equal(overlay.id, 'painted-discs');
  assert.equal(overlay.deltas.length, 3);
  assert.ok(overlay.deltas.some((row: any) => row.address.includes('SelectDraftDepiction')));
  assert.ok(overlay.deltas.some((row: any) => row.address.includes('MaterializeChosenDepiction')));
  assert.ok(overlay.deltas.some((row: any) => row.address.includes('EditDiscDepiction')));
});

test('Kompoze materialization activates painted discs without changing the base declaration', () => {
  execFileSync(process.execPath, ['kompoze-materialize.mjs', '--overlay', 'painted-discs'], { cwd: here });
  const materialized = fs.readFileSync(path.join(here, 'kompozition.materialized.ts'), 'utf8');
  assert.match(materialized, /\["painted-discs"\]/);
  assert.match(fs.readFileSync(path.join(here, 'kompozition.ts'), 'utf8'), /Object\.freeze\(\[\] as string\[\]\)/);
  fs.rmSync(path.join(here, 'kompozition.materialized.ts'));
});
