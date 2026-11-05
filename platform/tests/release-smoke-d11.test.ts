// D11f task 29: scripts/release-smoke.mjs starts an installed build with a fresh user data folder, waits for first paint
// in diagnostics/startup.jsonl, quits it and checks no process of it is left. Here a stand-in "app" (a small Node
// script) takes the installed app's place through --app, so nothing is installed and no window opens.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/release-smoke.mjs', import.meta.url));

// The stand-in: reads --smoke-user-data, writes the start phases (all, or not the paint), may leave a detached child.
const STAND_IN = `import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
const dir = process.argv.find(arg => arg.startsWith('--smoke-user-data=')).slice('--smoke-user-data='.length);
mkdirSync(join(dir, 'diagnostics'), { recursive: true });
const phase = name => appendFileSync(join(dir, 'diagnostics', 'startup.jsonl'), JSON.stringify({ phase: name, at: Date.now() }) + '\\n');
const mode = process.env.STAND_IN_MODE;
phase('main-ready');
if (mode === 'leaves-child') {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  writeFileSync(join(dir, '..', process.env.STAND_IN_PID_FILE), String(child.pid));
}
setTimeout(() => { phase('window-shown'); if (mode !== 'never-paints') phase('first-paint'); }, 200);
setInterval(() => {}, 1000);
`;

async function fixture(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'chausar-release-smoke-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const app = join(folder, 'stand-in-app.mjs');
  await writeFile(app, STAND_IN);
  const run = (args: string[], mode = 'paints', extra: Record<string, string> = {}) => spawnSync(process.execPath, [SCRIPT, '--app', app, '--timeout-ms', '4000', '--quit-ms', '1500', ...args],
    { encoding: 'utf8', windowsHide: true, timeout: 60_000, env: { ...process.env, STAND_IN_MODE: mode, ...extra } });
  return { folder, run };
}

const userDataOf = (stdout: string) => /user data: (.+)$/m.exec(stdout)?.[1].trim() ?? '';
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('an app that paints and quits cleanly passes, one line per step, and its temp user data is removed', async t => {
  const f = await fixture(t);
  const result = f.run([]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const step of ['launch', 'first paint', 'quit', 'no process left', 'clean up']) assert.match(result.stdout, new RegExp(`^ok +${step}`, 'm'), step);
  const userData = userDataOf(result.stdout);
  assert.ok(userData.includes('chausar-smoke-'), result.stdout);
  assert.equal(existsSync(userData), false, 'removed');
});

test('--keep keeps the user data folder, with the start phases in it', async t => {
  const f = await fixture(t);
  const result = f.run(['--keep']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const userData = userDataOf(result.stdout);
  t.after(() => rm(userData, { recursive: true, force: true }));
  assert.match(await readFile(join(userData, 'diagnostics', 'startup.jsonl'), 'utf8'), /"phase":"first-paint"/);
});

test('an app that never paints fails at the wait, named, and is not left running', async t => {
  const f = await fixture(t);
  const result = f.run([], 'never-paints');
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /^FAIL first paint: no first-paint phase in .*startup\.jsonl within 4 s/m);
  assert.match(result.stdout, /^ok +quit/m, 'it still quits the app');
});

test('an app that leaves a process behind fails, names it, and the smoke ends it', async t => {
  const f = await fixture(t);
  const pidFile = 'leftover.pid';
  const result = f.run(['--keep'], 'leaves-child', { STAND_IN_PID_FILE: pidFile });
  const userData = userDataOf(result.stdout);
  t.after(() => rm(userData, { recursive: true, force: true }));
  const pid = Number(await readFile(join(userData, '..', pidFile), 'utf8'));
  t.after(async () => { if (alive(pid)) process.kill(pid); await rm(join(userData, '..', pidFile), { force: true }); });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, new RegExp(`^FAIL no process left: 1 process still running: ${pid}\\b`, 'm'));
  assert.equal(alive(pid), false, 'the smoke ended the leftover');
});

test('usage: an installer or an app is needed, and an unknown installer kind is refused before anything runs', async t => {
  const f = await fixture(t);
  assert.equal(spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', windowsHide: true }).status, 2);
  const odd = spawnSync(process.execPath, [SCRIPT, '--installer', join(f.folder, 'chausar.zip')], { encoding: 'utf8', windowsHide: true });
  assert.equal(odd.status, 2);
  assert.match(odd.stderr, /\.exe \(Windows NSIS\), \.AppImage or \.deb/);
});

// D11f task 30: the Linux run, ready for the VPS (a fresh Ubuntu 24.04). Text checks: it installs what the AppImage and
// Electron need, runs the smoke on the build it is given, stops at the first error, and is stored with LF endings.
test('release-smoke-linux.sh installs the Ubuntu 24.04 packages, runs the smoke and keeps LF line endings', async () => {
  const text = await readFile(new URL('../../scripts/release-smoke-linux.sh', import.meta.url), 'utf8');
  assert.equal(text.includes('\r'), false, 'LF only: bash on Linux refuses CRLF');
  assert.match(text, /^#!\/usr\/bin\/env bash\n/);
  assert.match(text, /^set -euo pipefail$/m);
  for (const name of ['xvfb', 'libfuse2t64', 'libnss3', 'libgtk-3-0t64', 'libasound2t64', 'libgbm1']) assert.match(text, new RegExp(`(?<![\\w-])${name}(?![\\w-])`), name);
  assert.match(text, /node "\$here\/release-smoke\.mjs" --installer "\$build"/);
  assert.doesNotMatch(text, /curl[^\n]*\|\s*(?:sudo\s+)?(?:ba)?sh/, 'nothing is piped from the network into a shell');
  assert.match(await readFile(new URL('../../.gitattributes', import.meta.url), 'utf8'), /^\*\.sh text eol=lf$/m);
});
