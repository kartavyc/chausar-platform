#!/usr/bin/env node
// D11: the boundary check. platform/shared and platform/contract stay browser-safe: no node: module and nothing from
// platform/runtime. app/ui/src value-imports from platform/ only through platform/shared or platform/contract;
// `import type` (or every name marked `type`) from platform/runtime is allowed, since it is erased.
// Usage: node scripts/check-boundaries.mjs [--report]   (--report prints the crossings and exits 0; CI's lint job uses it
// until D11a task 2 moves the helpers the UI imports, then the flag goes and a crossing fails the build.)
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--report')) { process.stderr.write('Usage: node scripts/check-boundaries.mjs [--report]\n'); process.exit(2); }
const report = args.includes('--report');
const SOURCE = /\.(?:ts|tsx|mts|mjs|js|jsx)$/;

async function walk(folder) {
  const found = [];
  for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
    const path = join(folder, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') found.push(...await walk(path));
    else if (entry.isFile() && SOURCE.test(entry.name)) found.push(path);
  }
  return found;
}

/** Each import or re-export statement: its line, specifier, and whether it is type-only. */
function statements(text) {
  const found = [];
  const pattern = /^[ \t]*(import|export)\b([^'"`;]*?)\bfrom\s*['"]([^'"]+)['"]|^[ \t]*import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;
  for (const match of text.matchAll(pattern)) {
    const line = text.slice(0, match.index).split('\n').length;
    if (match[3]) {
      const clause = match[2].trim();
      const names = /^\{([\s\S]*)\}$/.exec(clause)?.[1].split(',').map(name => name.trim()).filter(Boolean);
      const typeOnly = /^type\b/.test(clause) || (names !== undefined && names.length > 0 && names.every(name => /^type\s/.test(name)));
      found.push({ line, spec: match[3], typeOnly });
    } else found.push({ line, spec: match[4] ?? match[5], typeOnly: false });
  }
  return found;
}

const crossings = [];
const repoPath = path => relative(root, path).replaceAll('\\', '/');
for (const area of ['platform/shared', 'platform/contract', 'app/ui/src']) {
  for (const file of await walk(join(root, area))) {
    const from = repoPath(file);
    for (const { line, spec, typeOnly } of statements(await readFile(file, 'utf8'))) {
      const target = spec.startsWith('.') ? posix.normalize(posix.join(posix.dirname(from), spec)) : null;
      if (area !== 'app/ui/src') {
        if (spec.startsWith('node:')) crossings.push(`${from}:${line}: ${area} imports '${spec}', a Node module`);
        else if (target?.startsWith('platform/runtime/')) crossings.push(`${from}:${line}: ${area} imports '${spec}' from platform/runtime`);
      } else if (!typeOnly && target?.startsWith('platform/') && !/^platform\/(?:shared|contract)\//.test(target)) {
        crossings.push(`${from}:${line}: the UI value-imports '${spec}'; go through platform/shared or platform/contract, or import type`);
      }
    }
  }
}

if (!crossings.length) process.stdout.write('No boundary crossings.\n');
else {
  process.stdout.write(`${crossings.length} boundary crossings${report ? ' (report only)' : ''}:\n${crossings.map(line => `  ${line}`).join('\n')}\n`);
  if (!report) process.exitCode = 1;
}
