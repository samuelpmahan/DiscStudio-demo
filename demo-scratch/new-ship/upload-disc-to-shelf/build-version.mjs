import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Read the canonical manifest before hashing the public build. A standalone
 * checkout must receive an explicit manifest path; it never invents a version. */
export function readBuildVersion(appDirectory, explicitManifest = process.env.NCTK_VERSION_MANIFEST) {
  const manifest = explicitManifest ? path.resolve(explicitManifest) : path.resolve(appDirectory, '../../../version.json');
  if (!fs.existsSync(manifest)) throw Error('Canonical nctk version.json is required. For a standalone build set NCTK_VERSION_MANIFEST to its explicit manifest path.');
  const bytes = fs.readFileSync(manifest), value = JSON.parse(bytes);
  if (![value.x, value.y, value.z].every(n => Number.isInteger(n) && n >= 0)) throw Error('Canonical version manifest needs non-negative integer x, y, z.');
  return { version: `${value.x}.${value.y}.${value.z}`, bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}
