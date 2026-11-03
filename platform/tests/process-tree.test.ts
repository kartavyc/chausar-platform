// A2 review: stopping a tool stops everything it started, so a closed Codex leaves no helper running (Windows included).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, copyFile, link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnTree } from '../runtime/process-tree.ts';

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = (ms: number) => new Promise(done => setTimeout(done, ms));

test('kill ends the child and the grandchild it started', async () => {
  // A parent that starts a long-running grandchild and prints its pid. On Windows the grandchild is started outside the
  // parent's own job, as a native helper may be, so only a tree kill ends it; elsewhere it stays in the tool's group.
  const script = "const { spawn } = require('node:child_process'); const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: " + String(process.platform === 'win32') + " }); console.log(g.pid); setInterval(() => {}, 1000);";
  const parent = spawnTree(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  const grandchild = await new Promise<number>((resolve, reject) => {
    let text = '';
    parent.stdout!.on('data', chunk => { text += String(chunk); const pid = Number.parseInt(text, 10); if (Number.isSafeInteger(pid) && text.includes('\n')) resolve(pid); });
    setTimeout(() => reject(new Error('no grandchild')), 10_000);
  });
  assert.ok(alive(grandchild));
  parent.kill();
  for (let n = 0; n < 50 && (alive(grandchild) || alive(parent.pid!)); n++) await wait(100);
  assert.equal(alive(parent.pid!), false, 'the tool is gone');
  assert.equal(alive(grandchild), false, 'and nothing it started is left behind');
});

// A2 second review (L1): a tool that ends on its own is not allowed to leave its helpers running either.
test('a tool that exits on its own leaves nothing it started behind', { timeout: 30_000 }, async () => {
  // On Windows the helper is started detached, as a native helper may be, so only a sweep after the exit ends it;
  // elsewhere it stays in the tool's own process group.
  const script = "const { spawn } = require('node:child_process'); const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: " + String(process.platform === 'win32') + " }); g.unref(); console.log(g.pid); setTimeout(() => process.exit(0), 300);";
  const parent = spawnTree(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  const helper = await new Promise<number>((resolve, reject) => {
    let text = '';
    parent.stdout!.on('data', chunk => { text += String(chunk); const pid = Number.parseInt(text, 10); if (Number.isSafeInteger(pid) && text.includes('\n')) resolve(pid); });
    setTimeout(() => reject(new Error('no helper')), 10_000);
  });
  await new Promise(done => parent.once('exit', done));
  for (let n = 0; n < 150 && alive(helper); n++) await wait(100);
  assert.equal(alive(helper), false, 'the helper left behind is ended');
});

// A2 second review (L1): cancelling Codex's sign-in through npm's shim (node runs codex.js, which runs the native
// codex.exe, which starts a helper of its own outside node's job, as a native program may) ends every codex program,
// not only node.
test('cancelling a sign-in started through the npm shim leaves no codex program running', { timeout: 30_000 }, async t => {
  const { LoginDesk } = await import('../runtime/venture/models/login.ts');
  const root = await mkdtemp(join(tmpdir(), 'chausar-login-tree-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  // The fake native Codex: a copy of node under Codex's own name, started by the fake entry script.
  const native = join(root, process.platform === 'win32' ? 'codex.exe' : 'codex');
  try { await link(process.execPath, native); } catch { await copyFile(process.execPath, native); }
  await chmod(native, 0o755);
  const pidFile = join(root, 'native.pid'), helperFile = join(root, 'helper.pid');
  const helperScript = `const { spawn } = require('node:child_process'); const { writeFileSync } = require('node:fs'); const h = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: ${String(process.platform === 'win32')} }); h.unref(); writeFileSync(${JSON.stringify(helperFile)}, String(h.pid)); setInterval(() => {}, 1000);`;
  const entry = join(root, 'node_modules', '@openai', 'codex', 'bin');
  await mkdir(entry, { recursive: true });
  await writeFile(join(entry, 'codex.js'), [
    "const { spawn } = require('node:child_process'); const { writeFileSync } = require('node:fs');",
    "if (process.argv.includes('status')) { console.log('Not logged in'); process.exit(1); }",
    `const child = spawn(${JSON.stringify(native)}, ['-e', ${JSON.stringify(helperScript)}], { stdio: 'ignore' });`,
    `writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
    "console.log('Open https://auth.openai.com/codex/device and enter this one-time code');",
    "console.log('code: WXYZ-12345');",
    'setInterval(() => {}, 1000);',
  ].join('\n'));
  const shim = join(root, 'codex.cmd');
  await writeFile(shim, await readFile(new URL('./fixtures/venture/models/npm-shims/codex.cmd', import.meta.url), 'utf8'));
  const desk = new LoginDesk({ claudeTerms: 'accepted', statusCacheMs: 0, locate: command => (command === 'codex' ? shim : command === 'node' ? process.execPath : null) });
  const started = await desk.start('codex');
  assert.equal(started.login.state, 'starting');
  const pidOf = (file: string) => readFile(file, 'utf8').then(text => Number.parseInt(text, 10) || 0, () => 0);
  let pid = 0, helper = 0;
  for (let n = 0; n < 100 && !(pid && helper); n++) { await wait(100); pid = await pidOf(pidFile); helper = await pidOf(helperFile); }
  assert.ok(pid && alive(pid) && helper && alive(helper), 'the native program and its helper are running');
  await desk.cancel('codex');
  for (let n = 0; n < 150 && (alive(pid) || alive(helper)); n++) await wait(100);
  assert.equal(alive(pid), false, 'no codex program is left after the cancel');
  assert.equal(alive(helper), false, 'nor the helper it started');
});
