import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function buildOutputIdentity(root) {
  const files = (directory, relative = '') => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(relative, entry.name);
    if (name === 'BUILD_INFO.json') return [];
    return entry.isDirectory() ? files(path.join(directory, entry.name), name) : entry.isFile() ? [name] : [];
  });
  const hash = crypto.createHash('sha256');
  for (const name of files(root).sort()) hash.update(name).update('\0').update(fs.readFileSync(path.join(root, name))).update('\0');
  return hash.digest('hex');
}
