#!/usr/bin/env node
// D3: the clean-tree guard. Runtime and test data never live in the code folder; this checks it in two layers.
//   --tracked   (layer A): no tracked file looks like data: data/, results/, .shots/, a .tap log outside
//               docs/verification/ (those are known until D10 moves them), a vault, backup or encrypted record, a
//               custody key, tenants/ or custody/ outside platform/ source, a raw vitest report, or a file over 1 MB
//               that is not on the short list below with its reason.
//   --after-run (layer B): after a run, git status (ignored files included) shows nothing outside the folders a build
//               or an install makes. CI runs it last in every test job; on a fresh checkout it must be empty.
// Usage (from anywhere): node scripts/check-clean-tree.mjs --tracked | --after-run
// It checks the checkout this script sits in, reads only, and never moves or deletes anything.
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.slice(2);
if (mode.length !== 1 || !['--tracked', '--after-run'].includes(mode[0])) {
  process.stderr.write('Usage: node scripts/check-clean-tree.mjs --tracked | --after-run\n');
  process.exit(2);
}

/** Tracked files over 1 MB that are allowed, each with its reason. Keep it short; a raise goes to the founder. */
const LARGE_FILES_ALLOWED = [
  // { path: 'docs/example.pdf', reason: 'why this large file belongs in the source' },
];
const MEGABYTE = 1024 * 1024;

/** What a tracked path must not look like, each with the plain words printed for it. */
const DATA_PATTERNS = [
  [/^data\//, 'runtime data (data/)'],
  [/^results\//, 'run outputs (results/)'],
  [/(^|\/)\.shots\//, 'screenshot walk output (.shots/)'],
  [/\.tap$/, 'a test log (.tap)'],
  [/\.backup$/, 'a vault backup'],
  [/\.vault$/, 'a vault file'],
  [/(^|\/)dev-custody\.key$/, 'a development custody key'],
  [/(^|\/)tenants\//, 'hosted tenant data (tenants/)'],
  [/(^|\/)custody\//, 'custody data (custody/)'],
  [/\.encrypted\.json$/, 'an encrypted record'],
  [/\.vitest\.json$/, 'a raw vitest report'],
];
/** Tracked paths that match a pattern on purpose, until the batch named moves them. */
const KNOWN = [
  [/^docs\/verification\/[^/]+\.tap$/, 'test logs in docs/verification/, known until D10 moves them'],
  [/^platform\/.*(^|\/)custody\//, 'custody source code under platform/, not data'],
];

/** Folders a run, a build or an install may leave in the checkout (layer B; any nested node_modules/ too, such as
 * app/ui/node_modules/.vite, vitest's cache), and files npm may rewrite. */
const RUN_ALLOWED = ['node_modules/', 'app/ui/dist/', 'release/', 'vendor/codex-bundle/', 'vendor/feedback/'];
const RUN_ALLOWED_FILES = ['package-lock.json'];

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) {
    process.stderr.write(`git ${args[0]} failed: ${(result.stderr || '').trim()}\n`);
    process.exit(2);
  }
  return result.stdout;
}

function report(found, words) {
  for (const line of found.slice(0, 40)) process.stderr.write(`  ${line}\n`);
  if (found.length > 40) process.stderr.write(`  ... and ${found.length - 40} more\n`);
  process.stderr.write(`${words}\n`);
  process.exitCode = 1;
}

if (mode[0] === '--tracked') {
  const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
  const found = [], known = [];
  for (const path of files) {
    const hit = DATA_PATTERNS.find(([pattern]) => pattern.test(path));
    if (hit) {
      const reason = KNOWN.find(([pattern]) => pattern.test(path));
      if (reason) known.push(`${path} (${reason[1]})`);
      else found.push(`${path}: ${hit[1]}`);
      continue;
    }
    let size = 0;
    try { size = statSync(join(root, path)).size; } catch { continue; } // deleted in the working tree
    if (size > MEGABYTE && !LARGE_FILES_ALLOWED.some(entry => entry.path === path)) found.push(`${path}: ${(size / MEGABYTE).toFixed(1)} MB, over 1 MB and not on the list in scripts/check-clean-tree.mjs`);
  }
  if (known.length) process.stdout.write(`${known.length} tracked files match a data pattern and are known: ${known[0]}${known.length > 1 ? ' and the like' : ''}.\n`);
  if (found.length) report(found, 'Data is tracked in the repo. Remove it from git and keep it in the data home or the run root instead (platform/runtime/data-home.ts).');
  else process.stdout.write(`No tracked data: ${files.length} files checked.\n`);
} else {
  const entries = git(['status', '--porcelain=v1', '--ignored', '--untracked-files=all', '-z']).split('\0');
  const found = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry) continue;
    const status = entry.slice(0, 2), path = entry.slice(3);
    if (status[0] === 'R' || status[0] === 'C') index++; // a rename carries its old path next
    if (RUN_ALLOWED.some(folder => path.startsWith(folder)) || path.includes('/node_modules/') || RUN_ALLOWED_FILES.includes(path)) continue;
    found.push(`${status} ${path}`);
  }
  if (found.length) report(found, 'Runtime or test data landed in the repo. Write to the data home or the run root instead (platform/runtime/data-home.ts).');
  else process.stdout.write('The checkout is clean after the run.\n');
}
