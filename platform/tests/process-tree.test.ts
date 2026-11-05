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

// One-shot A3 (L2, L3 from the A2 final review): what spawnTree does after a tool exits is the caller's choice.
const helperOf = (parent: ReturnType<typeof spawnTree>) => new Promise<number>((resolve, reject) => {
  let text = '';
  parent.stdout!.on('data', chunk => { text += String(chunk); const pid = Number.parseInt(text, 10); if (Number.isSafeInteger(pid) && text.includes('\n')) resolve(pid); });
  setTimeout(() => reject(new Error('no helper')), 10_000);
});
/** A tool that starts a helper (detached on Windows, as a browser a sign-in opens is), prints its pid, and then exits or waits. */
const helperScript = (exits: boolean) => "const { spawn } = require('node:child_process'); const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: " + String(process.platform === 'win32') + " }); g.unref(); console.log(g.pid); " + (exits ? 'setTimeout(() => process.exit(0), 300);' : 'setInterval(() => {}, 1000);');
const stop = (pid: number) => { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } };

test('A3 L2: afterExit never leaves what the tool started running after it exits on its own (a sign-in\'s browser)', { timeout: 30_000 }, async t => {
  const parent = spawnTree(process.execPath, ['-e', helperScript(true)], { stdio: ['ignore', 'pipe', 'ignore'] }, { afterExit: 'never' });
  const helper = await helperOf(parent);
  t.after(() => stop(helper));
  await new Promise(done => parent.once('exit', done));
  // Longer than the sweep takes when it runs (one PowerShell search on Windows).
  await wait(4_000);
  assert.equal(alive(helper), true, 'the helper is still running');
});

test('A3 L2: afterExit never still ends the whole tree on kill (a cancelled sign-in)', { timeout: 30_000 }, async () => {
  const parent = spawnTree(process.execPath, ['-e', helperScript(false)], { stdio: ['ignore', 'pipe', 'ignore'] }, { afterExit: 'never' });
  const helper = await helperOf(parent);
  parent.kill();
  for (let n = 0; n < 50 && (alive(helper) || alive(parent.pid!)); n++) await wait(100);
  assert.equal(alive(parent.pid!), false);
  assert.equal(alive(helper), false, 'kill ends what it started');
});

test('A3 L3: afterExit killed searches nothing after a tool that ended on its own, and ends the tree when it was killed', { timeout: 30_000 }, async t => {
  const ended = spawnTree(process.execPath, ['-e', helperScript(true)], { stdio: ['ignore', 'pipe', 'ignore'] }, { afterExit: 'killed' });
  const left = await helperOf(ended);
  t.after(() => stop(left));
  await new Promise(done => ended.once('exit', done));
  // A3 review M3: only Windows skips its PowerShell search after an ordinary exit. Elsewhere the tool's group is
  // still ended after every exit (it costs nothing), so the helper it left in that group is gone.
  if (process.platform === 'win32') {
    await wait(4_000);
    assert.equal(alive(left), true, 'no search after a tool that ended on its own');
  } else {
    for (let n = 0; n < 80 && alive(left); n++) await wait(100);
    assert.equal(alive(left), false, 'the group is still ended after an ordinary exit');
  }
  const killed = spawnTree(process.execPath, ['-e', helperScript(false)], { stdio: ['ignore', 'pipe', 'ignore'] }, { afterExit: 'killed' });
  const helper = await helperOf(killed);
  killed.kill();
  for (let n = 0; n < 80 && (alive(helper) || alive(killed.pid!)); n++) await wait(100);
  assert.equal(alive(helper), false, 'a killed tool leaves nothing behind');
});

test('A3 L3: the exec route (defaultProcess) searches for helpers only after a time-out', { timeout: 40_000 }, async t => {
  const { defaultProcess } = await import('../runtime/gateway.ts');
  const dir = await mkdtemp(join(tmpdir(), 'chausar-exec-tree-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const pidFile = (name: string) => join(dir, name);
  const script = (file: string, exits: boolean) => `const { spawn } = require('node:child_process'); const { writeFileSync } = require('node:fs'); const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: ${String(process.platform === 'win32')} }); g.unref(); writeFileSync(${JSON.stringify(file)}, String(g.pid)); ${exits ? 'setTimeout(() => process.exit(0), 2500);' : 'setInterval(() => {}, 1000);'}`;
  const request = (file: string, exits: boolean, timeoutMs: number) => ({ command: process.execPath, args: ['-e', script(file, exits)], cwd: tmpdir(), env: { ...process.env } as Record<string, string>, stdin: '', timeoutMs });
  // A call that ran a while (over the old 2 s mark) and ended on its own.
  const done = await defaultProcess(request(pidFile('ended.pid'), true, 20_000) as never);
  assert.equal(done.exitCode, 0);
  const left = Number.parseInt(await readFile(pidFile('ended.pid'), 'utf8'), 10);
  t.after(() => stop(left));
  // A3 review M3: no PowerShell search after an ordinary call on Windows; elsewhere the group is ended as ever.
  if (process.platform === 'win32') {
    await wait(4_000);
    assert.equal(alive(left), true, 'no PowerShell search after an ordinary call');
  } else {
    for (let n = 0; n < 80 && alive(left); n++) await wait(100);
    assert.equal(alive(left), false, 'the group is still ended after an ordinary call');
  }
  // A call that timed out.
  await assert.rejects(defaultProcess(request(pidFile('timed.pid'), false, 3_000) as never), (error: any) => error.code === 'MODEL_TIMEOUT');
  const helper = Number.parseInt(await readFile(pidFile('timed.pid'), 'utf8'), 10);
  for (let n = 0; n < 80 && alive(helper); n++) await wait(100);
  assert.equal(alive(helper), false, 'a timed-out call leaves nothing behind');
});

// A3 review (M3, L1): what runs after a tool exits, by platform. Elsewhere the group kill after every exit stays, except
// for the sign-in ('never'), whose browser must survive; after Chausar killed a tool the clean-up always runs.
test('A3 review M3 and L1: the clean-up after an exit, by mode, platform and whether Chausar killed the tool', async () => {
  const { afterExitAction } = await import('../runtime/process-tree.ts');
  const run = (mode: 'sweep' | 'killed' | 'never' | undefined, platform: NodeJS.Platform, killed: boolean, ranMs = 5_000, sweepAfterMs?: number) =>
    afterExitAction({ ...(mode ? { afterExit: mode } : {}), ...(sweepAfterMs === undefined ? {} : { sweepAfterMs }) }, platform, killed, ranMs);
  // Elsewhere: the group is ended after every exit, for the default and the exec route alike.
  for (const killed of [false, true]) {
    assert.equal(run(undefined, 'linux', killed), 'clean-up');
    assert.equal(run('killed', 'linux', killed), 'clean-up', `linux killed=${killed}`);
    assert.equal(run('killed', 'darwin', killed), 'clean-up');
  }
  // The sign-in: nothing after it ends on its own, on every platform; after a cancel or a time-out, the clean-up runs.
  for (const platform of ['linux', 'darwin', 'win32'] as const) {
    assert.equal(run('never', platform, false), 'none', platform);
    assert.equal(run('never', platform, true), 'clean-up', `${platform} after a kill`);
  }
  // Windows: the exec route searches only after a kill; the default after any exit that ran long enough.
  assert.equal(run('killed', 'win32', false), 'none');
  assert.equal(run('killed', 'win32', true), 'clean-up');
  assert.equal(run(undefined, 'win32', false, 500, 2_000), 'none');
  assert.equal(run(undefined, 'win32', false, 2_500, 2_000), 'clean-up');
  assert.equal(run(undefined, 'win32', true, 100, 2_000), 'clean-up');
});
