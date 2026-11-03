// One-shot A3, from the A2 final review. L2: Codex's sign-in runs through spawnTree; a sign-in that ends on its own must
// not take the browser it opened with it (elsewhere the whole process group was ended after the exit), while a cancel
// still ends everything it started. The nit: with a Codex setup in use, its sign-in and its status run on the setup's own
// program only after the program's digest is checked again (the trust's verifiedProgram), as every model call and agent
// job already does; a changed program is never started.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, copyFile, link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChausarError } from '../runtime/contracts.ts';
import { LoginDesk, type LoginLaunch } from '../runtime/venture/models/login.ts';

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = (ms: number) => new Promise(done => setTimeout(done, ms));
const stop = (pid: number) => { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } };

test('A3 L2: a sign-in that finishes on its own leaves the browser it opened running', { timeout: 40_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-login-browser-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const browserFile = join(root, 'browser.pid');
  // The sign-in opens a "browser" (a helper it starts itself, on its own on Windows as a real browser is), prints the
  // device code, and finishes a moment later, as Codex does once the owner signed in on the page.
  const browser = `const { spawn } = require('node:child_process'); const b = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: ${String(process.platform === 'win32')} }); b.unref(); require('node:fs').writeFileSync(${JSON.stringify(browserFile)}, String(b.pid));`;
  const entry = join(root, 'node_modules', '@openai', 'codex', 'bin');
  await mkdir(entry, { recursive: true });
  await writeFile(join(entry, 'codex.js'), [
    "if (process.argv.includes('status')) { console.log('Not logged in'); process.exit(1); }",
    browser,
    "console.log('Open https://auth.openai.com/codex/device and enter this one-time code');",
    "console.log('code: WXYZ-12345');",
    'setTimeout(() => process.exit(0), 600);',
  ].join('\n'));
  const shim = join(root, 'codex.cmd');
  await writeFile(shim, await readFile(new URL('./fixtures/venture/models/npm-shims/codex.cmd', import.meta.url), 'utf8'));
  const desk = new LoginDesk({ claudeTerms: 'accepted', statusCacheMs: 0, locate: command => (command === 'codex' ? shim : command === 'node' ? process.execPath : null) });
  await desk.start('codex');
  let pid = 0;
  for (let n = 0; n < 100 && !pid; n++) { await wait(100); pid = await readFile(browserFile, 'utf8').then(text => Number.parseInt(text, 10) || 0, () => 0); }
  assert.ok(pid && alive(pid), 'the sign-in opened its browser');
  t.after(() => stop(pid));
  // The sign-in finished (exit 0): the desk says so, and the browser is not ended with it.
  for (let n = 0; n < 50; n++) { await wait(100); if ((await desk.tools()).tools.find(tool => tool.cli === 'codex')!.login.state !== 'starting') break; }
  await wait(4_000);
  assert.equal(alive(pid), true, 'the browser the sign-in opened is still running');
});

/** A Codex setup in use whose program is at `program`, and whose digest check says `changed` when told to. */
function trust(program: string, state: { changed: boolean; checked: number }) {
  return {
    review: async () => ({ state: 'trusted' as const, origin: 'owner' as const, path: program, version: '0.166.0', sha256: 'c'.repeat(64), line: 'Uses your Codex 0.166.0, which you chose.' }),
    profile: () => ({ mode: 'local-cli', capabilities: { evidence: { kind: 'installed-help', executable: program, version: '0.166.0' } } }),
    async verifiedProgram() {
      state.checked += 1;
      if (state.changed) throw new ChausarError('CODEX_SETUP_CHANGED', 'That Codex changed since you looked at it. Check it again.');
      return program;
    },
  };
}

test('A3 nit: Codex\'s sign-in and status on the setup\'s own program pass the digest check first; a changed program never starts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-login-digest-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const program = join(root, process.platform === 'win32' ? 'codex.exe' : 'codex');
  try { await link(process.execPath, program); } catch { await copyFile(process.execPath, program); }
  await chmod(program, 0o755);
  const state = { changed: false, checked: 0 };
  const started: LoginLaunch[] = [];
  const fakeChild = () => {
    const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
    const on = (name: string, handler: (...args: unknown[]) => void) => { handlers.set(name, [...(handlers.get(name) ?? []), handler]); };
    const child = { stdout: { on: () => undefined }, stderr: { on: () => undefined }, stdin: { end: () => undefined }, on, kill: () => true };
    setTimeout(() => { for (const handler of handlers.get('exit') ?? []) handler(1); }, 10);
    return child as never;
  };
  const desk = new LoginDesk({ claudeTerms: 'accepted', statusCacheMs: 0, locate: () => null, codex: trust(program, state), spawn: launch => { started.push(launch); return fakeChild(); } });
  // In use and unchanged: the status runs on the setup's program, after the check.
  await desk.tools();
  assert.ok(state.checked >= 1, 'the digest was checked before the status');
  assert.ok(started.length >= 1 && started.every(launch => launch.command === program));
  // The program changed: neither the status nor the sign-in starts it.
  state.changed = true;
  const before = started.length;
  const view = (await desk.tools()).tools.find(tool => tool.cli === 'codex')!;
  assert.equal(view.signedIn, 'unknown');
  await assert.rejects(desk.start('codex'), (error: any) => error.code === 'CODEX_SETUP_CHANGED');
  assert.equal(started.length, before, 'a changed program is never started');
});
