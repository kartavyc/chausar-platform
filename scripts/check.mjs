import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.cwd();
const files = [];
async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', '.git', 'data', 'vaults', 'dist', 'release'].includes(item.name)) continue;
    const path = join(directory, item.name);
    if (item.isDirectory()) await walk(path);
    else if (/\.(?:ts|js|mjs|cjs)$/.test(path)) files.push(path);
    else if (item.name.endsWith('.json')) JSON.parse(await readFile(path, 'utf8'));
  }
}
await walk(join(root, 'platform'));
await walk(join(root, 'app'));
await walk(join(root, 'scripts'));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { process.stderr.write(result.stderr || result.error?.message || 'Syntax check failed'); process.exit(1); }
}
// C7: the in-app help quotes the guide as indexed at build; a guide that changed needs `node scripts/guide-index.mjs`.
const guide = spawnSync(process.execPath, [join(root, 'scripts', 'guide-index.mjs'), '--check'], { encoding: 'utf8' });
if (guide.status !== 0) { process.stderr.write(guide.stderr || guide.stdout || 'The guide index is out of date.'); process.exit(1); }
console.log(`Syntax and JSON validation passed for ${files.length} source files.`);
