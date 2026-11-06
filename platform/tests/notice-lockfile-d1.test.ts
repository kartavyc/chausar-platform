// D1 fix: NOTICE must be the same on every operating system. CI checks it on Ubuntu after `npm ci`, and a NOTICE built
// from a Windows node_modules named the Windows builds only (the Agent SDK and DuckDB bindings), so the check failed.
// NOTICE is now built from package-lock.json, which records the builds for every system, and never from node_modules.
// D5: the Agent SDK's platform builds (its Claude Code program file) ship in no installer, so NOTICE leaves them out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('the NOTICE check passes with no node_modules at all: nothing installed on this system decides it', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-notice-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'scripts'));
  // C5: the fonts' lines come from their manifest and licence files, which are tracked, not installed.
  await mkdir(join(directory, 'app/ui/assets/fonts'), { recursive: true });
  for (const name of await readdir(join(ROOT, 'app/ui/assets/fonts'))) if (!name.endsWith('.woff2')) await copyFile(join(ROOT, 'app/ui/assets/fonts', name), join(directory, 'app/ui/assets/fonts', name));
  // D5 task 3: the check reads the fonts' licences beside the notices too; both are tracked.
  await mkdir(join(directory, 'app/desktop/notices/fonts'), { recursive: true });
  for (const name of await readdir(join(ROOT, 'app/desktop/notices/fonts'))) await copyFile(join(ROOT, 'app/desktop/notices/fonts', name), join(directory, 'app/desktop/notices/fonts', name));
  await copyFile(join(ROOT, 'app/desktop/notices/THIRD-PARTY-NOTICES.md'), join(directory, 'app/desktop/notices/THIRD-PARTY-NOTICES.md'));
  for (const file of ['package.json', 'package-lock.json', 'NOTICE', 'scripts/third-party-notices.mjs']) await copyFile(join(ROOT, file), join(directory, file));
  const result = spawnSync(process.execPath, [join(directory, 'scripts', 'third-party-notices.mjs'), '--check'], { cwd: directory, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr + result.stdout);
});

test('NOTICE lists the build of each platform-specific shipped package for every system the lockfile records', async () => {
  const notice = (await readFile(join(ROOT, 'NOTICE'), 'utf8')).replace(/\r\n/g, '\n');
  const lock = JSON.parse(await readFile(join(ROOT, 'package-lock.json'), 'utf8')) as { packages: Record<string, { version: string; os?: string[]; cpu?: string[]; dev?: boolean }> };
  const builds = (pattern: RegExp) => Object.entries(lock.packages).filter(([path, entry]) => (entry.os || entry.cpu) && !entry.dev && pattern.test(path))
    .map(([path, entry]) => ({ name: path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length), version: entry.version }));
  const listed = (item: { name: string; version: string }) => new RegExp(`^${item.name.replace(/[.*+?^${}()|[\]\/]/g, '\$&')} ${item.version.replace(/\./g, '\.')} `, 'm').test(notice);
  const duckdb = builds(/^node_modules\/@duckdb\/node-bindings-/);
  assert.ok(duckdb.length >= 4, 'the lockfile records the DuckDB builds for several systems');
  for (const item of duckdb) assert.ok(listed(item), item.name);
  // D5 (founder, 5 Nov): no installer carries the Agent SDK's Claude Code program file, so its builds are not listed.
  const claude = builds(/^node_modules\/@anthropic-ai\/claude-agent-sdk-/);
  assert.ok(claude.length >= 4, 'the lockfile still records them');
  for (const item of claude) assert.equal(listed(item), false, item.name);
  assert.match(notice, /^@anthropic-ai\/claude-agent-sdk \d/m, 'the Agent SDK itself still ships');
  assert.doesNotMatch(notice, /run it on\s+the packaging machine/, 'the old instruction to write it per system is gone');
});
