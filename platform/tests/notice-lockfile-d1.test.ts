// D1 fix: NOTICE must be the same on every operating system. CI checks it on Ubuntu after `npm ci`, and a NOTICE built
// from a Windows node_modules named the Windows builds only (the Agent SDK and DuckDB bindings), so the check failed.
// NOTICE is now built from package-lock.json, which records the builds for every system, and never from node_modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('the NOTICE check passes with no node_modules at all: nothing installed on this system decides it', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-notice-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'scripts'));
  for (const file of ['package.json', 'package-lock.json', 'NOTICE', 'scripts/third-party-notices.mjs']) await copyFile(join(ROOT, file), join(directory, file));
  const result = spawnSync(process.execPath, [join(directory, 'scripts', 'third-party-notices.mjs'), '--check'], { cwd: directory, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr + result.stdout);
});

test('NOTICE lists the build of each platform-specific shipped package for every system the lockfile records', async () => {
  const notice = (await readFile(join(ROOT, 'NOTICE'), 'utf8')).replace(/\r\n/g, '\n');
  const lock = JSON.parse(await readFile(join(ROOT, 'package-lock.json'), 'utf8')) as { packages: Record<string, { version: string; os?: string[]; cpu?: string[]; dev?: boolean }> };
  const builds = Object.entries(lock.packages).filter(([path, entry]) => (entry.os || entry.cpu) && !entry.dev
    && /^node_modules\/(@anthropic-ai\/claude-agent-sdk-|@duckdb\/node-bindings-)/.test(path));
  assert.ok(builds.length >= 8, 'the lockfile records the Agent SDK and DuckDB builds for several systems');
  for (const [path, entry] of builds) {
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    assert.match(notice, new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} ${entry.version.replace(/\./g, '\\.')} `, 'm'), name);
  }
  assert.doesNotMatch(notice, /run it on\s+the packaging machine/, 'the old instruction to write it per system is gone');
});
