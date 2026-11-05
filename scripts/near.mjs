#!/usr/bin/env node
// D11: `npm run near`, the tests near a change. It lists the files changed against a base branch (committed, staged,
// unstaged and untracked), walks the import graph backwards with a plain regex (static, type, re-export, side-effect
// and dynamic imports, plus `new URL('<relative>', import.meta.url)`, which is how tests read scripts and fixtures),
// and runs the engine and UI test files that reach a changed file. It is a fast first pass, not the gate: CI runs all.
// Usage: node scripts/near.mjs [--base=<branch>] [--list] [--changed=<file>[,<file>...]]
//   --base     the branch to compare with (default main)
//   --list     print { engine, ui } as JSON and run nothing
//   --changed  use these repository paths instead of asking git
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = /\.(?:ts|tsx|mts|cts|mjs|cjs|js|jsx)$/;
const TRY = ['', '.ts', '.tsx', '.mts', '.mjs', '.js', '.cjs', '/index.ts', '/index.tsx', '/index.mjs', '/index.js'];
const ENGINE_TEST = /^platform\/tests\/[^/]+\.test\.ts$/;
const UI_TEST = /^app\/ui\/tests\/.+\.test\.tsx?$/;

/** Every module specifier a source file names: imports of every kind, re-exports, and new URL('<path>', import.meta.url). */
export function importsOf(text) {
  const found = [];
  const patterns = [
    /^\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/gm,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bnew\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) found.push({ at: match.index, spec: match[1] });
  return found.sort((left, right) => left.at - right.at).map(item => item.spec);
}

/** The file a relative specifier names, among the known files; null for packages, node: and anything not found. */
function resolveFrom(file, spec, known) {
  if (!spec.startsWith('.')) return null;
  const base = posix.normalize(posix.join(posix.dirname(file), spec.split(/[?#]/)[0]));
  for (const ending of TRY) if (known.has(base + ending)) return base + ending;
  return null;
}

/** The engine and UI test files that reach any changed file. files: repository paths; read(file) gives its text. */
export function nearTests({ changed, files, read }) {
  const known = new Set(files);
  const importers = new Map();
  for (const file of files) {
    if (!SOURCE.test(file)) continue;
    let text;
    try { text = read(file); } catch { continue; }
    for (const spec of importsOf(text)) {
      const target = resolveFrom(file, spec, known);
      if (!target) continue;
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target).add(file);
    }
  }
  const reached = new Set(), queue = changed.filter(file => known.has(file));
  for (const file of queue) reached.add(file);
  while (queue.length) {
    for (const importer of importers.get(queue.shift()) ?? []) if (!reached.has(importer)) { reached.add(importer); queue.push(importer); }
  }
  const sorted = [...reached].sort();
  return { engine: sorted.filter(file => ENGINE_TEST.test(file)), ui: sorted.filter(file => UI_TEST.test(file)) };
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error((result.stderr || `git ${args[0]} failed`).trim());
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let base = 'main', list = false, given = null;
  for (const arg of process.argv.slice(2)) {
    if (arg === '--list') list = true;
    else if (arg.startsWith('--base=')) base = arg.slice(7);
    else if (arg.startsWith('--changed=')) given = arg.slice(10).split(',').map(file => file.trim().replaceAll('\\', '/')).filter(Boolean);
    else { process.stderr.write('Usage: node scripts/near.mjs [--base=<branch>] [--list] [--changed=<file>[,<file>...]]\n'); process.exit(2); }
  }
  let changed = given;
  if (!changed) {
    try {
      changed = [...new Set([...git(root, ['diff', '--name-only', `${base}...HEAD`]), ...git(root, ['diff', '--name-only', 'HEAD']), ...git(root, ['ls-files', '--others', '--exclude-standard'])])];
    } catch (error) {
      process.stderr.write(`Could not compare with ${base}: ${error.message}\nPass --base=<branch> (a branch this checkout has), or --changed=<files>.\n`);
      process.exit(2);
    }
  }
  const files = [...new Set([...git(root, ['ls-files']), ...git(root, ['ls-files', '--others', '--exclude-standard'])])];
  const picked = nearTests({ changed, files, read: file => readFileSync(resolve(root, file), 'utf8') });
  if (list) { process.stdout.write(`${JSON.stringify(picked, null, 2)}\n`); process.exit(0); }
  process.stdout.write(`${changed.length} changed files reach ${picked.engine.length} engine and ${picked.ui.length} UI test files.\n`);
  let failed = false;
  if (picked.engine.length) {
    const workers = Math.max(1, Math.min(4, availableParallelism() - 1));
    failed ||= spawnSync(process.execPath, ['--test', `--test-concurrency=${workers}`, ...picked.engine], { cwd: root, stdio: 'inherit', windowsHide: true }).status !== 0;
  }
  if (picked.ui.length) {
    failed ||= spawnSync(process.execPath, [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'app/ui/vitest.config.ts', ...picked.ui], { cwd: root, stdio: 'inherit', windowsHide: true }).status !== 0;
  }
  process.exitCode = failed ? 1 : 0;
}
