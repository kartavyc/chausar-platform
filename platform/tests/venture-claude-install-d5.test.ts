// D5 (founder, 5 Nov): no installer carries Claude Code. When the owner has none, "Install Claude Code" downloads
// Anthropic's official installer, unmodified, only after the owner's yes, shows progress, runs it, then looks for Claude
// Code again. Chausar never signs in for the owner. Every port here is a fake: nothing is downloaded or started.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLAUDE_CODE_INSTALLERS, CLAUDE_INSTALL_WORDS, installClaudeCode, mintClaudeInstallYes, type ClaudeInstallPorts, type ClaudeInstallProgress,
} from '../runtime/venture/models/claude-code-install.ts';

const SCRIPT = Buffer.from('# synthetic installer script\nWrite-Output "installed"\n');
const YES = { yes: true as const, at: '2026-11-05T09:00:00.000Z' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };

type Fake = { ports: ClaudeInstallPorts; fetched: string[]; ran: { command: string; args: string[]; options: any; script: Buffer }[]; folders: string[] };

/** A computer with no Claude Code until the installer runs; the download answers SCRIPT in two chunks. */
function computer(options: { installs?: boolean; exitCode?: number; body?: Buffer; finalUrl?: string; status?: number; foundBefore?: boolean; length?: boolean } = {}): Fake {
  let installed = options.foundBefore === true;
  const fake: Fake = { fetched: [], ran: [], folders: [], ports: undefined as unknown as ClaudeInstallPorts };
  const body = options.body ?? SCRIPT;
  fake.ports = {
    async fetch(url) {
      fake.fetched.push(url);
      const half = Math.ceil(body.length / 2);
      return {
        ok: (options.status ?? 200) === 200, status: options.status ?? 200, url: options.finalUrl ?? url,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-length' && options.length !== false ? String(body.length) : null) },
        body: (async function* () { yield body.subarray(0, half); yield body.subarray(half); })(),
      };
    },
    async run(command, args, runOptions) {
      const scriptPath = args.at(-1)!;
      fake.ran.push({ command, args, options: runOptions, script: readFileSync(scriptPath) });
      if (options.installs !== false) installed = true;
      return { exitCode: options.exitCode ?? 0 };
    },
    locate: command => (command === 'claude' && installed ? '/synthetic-home/.local/bin/claude.exe' : null),
    async tempFolder() { const folder = mkdtempSync(join(tmpdir(), 'chausar-claude-install-test-')); fake.folders.push(folder); return folder; },
  };
  return fake;
}

test('without the owner yes nothing is downloaded or run', async () => {
  for (const approval of [undefined, null, {}, { yes: false, at: YES.at }, { yes: 'yes', at: YES.at }, { yes: true }]) {
    const fake = computer();
    await assert.rejects(installClaudeCode({ approval, platform: 'win32', host: 'desktop' }, fake.ports), code('CLAUDE_INSTALL_NEEDS_YES'));
    assert.deepEqual([fake.fetched, fake.ran], [[], []]);
  }
});

test('the hosted web server never installs anything', async () => {
  const fake = computer();
  await assert.rejects(installClaudeCode({ approval: mintClaudeInstallYes(), platform: 'linux', host: 'hosted-web' }, fake.ports), code('TIER_UNAVAILABLE'));
  assert.deepEqual([fake.fetched, fake.ran], [[], []]);
});

test('Claude Code already on this computer: nothing is downloaded', async () => {
  const fake = computer({ foundBefore: true });
  const result = await installClaudeCode({ approval: mintClaudeInstallYes(), platform: 'win32', host: 'desktop' }, fake.ports);
  assert.equal(result.outcome, 'already-installed');
  assert.deepEqual([fake.fetched, fake.ran], [[], []]);
});

test('with a yes: the official installer is downloaded with progress, run unmodified with no sign-in, then Claude Code is looked for again', async () => {
  for (const platform of ['win32', 'linux', 'darwin'] as const) {
    const fake = computer();
    const steps: ClaudeInstallProgress[] = [];
    const result = await installClaudeCode({ approval: mintClaudeInstallYes(), platform, host: 'desktop' }, fake.ports, progress => steps.push(progress));
    assert.deepEqual(fake.fetched, [CLAUDE_CODE_INSTALLERS[platform].url]);
    assert.match(CLAUDE_CODE_INSTALLERS[platform].url, /^https:\/\/claude\.ai\/install\.(ps1|sh)$/);
    assert.equal(fake.ran.length, 1);
    const [run] = fake.ran;
    assert.deepEqual(run.script, SCRIPT, 'the bytes run are the bytes downloaded');
    assert.equal(run.command, CLAUDE_CODE_INSTALLERS[platform].command);
    assert.equal(run.args.some(arg => /login|auth|token|key/i.test(arg)), false, 'Chausar never signs in for the owner');
    assert.equal(run.options.windowsHide, true);
    assert.equal(run.options.shell, false);
    assert.equal(Object.keys(run.options.env).some(name => /^CHAUSAR_|TOKEN|SECRET|KEY|PASSWORD|ANTHROPIC/i.test(name)), false, 'no Chausar or secret variable reaches it');
    assert.deepEqual(steps.map(step => step.step), ['downloading', 'downloading', 'downloading', 'installing', 'checking', 'done']);
    assert.deepEqual(steps.filter(step => step.step === 'downloading').map(step => step.receivedBytes), [0, Math.ceil(SCRIPT.length / 2), SCRIPT.length]);
    assert.equal(steps[0].totalBytes, SCRIPT.length);
    assert.equal(result.outcome, 'installed');
    assert.match(result.path!, /claude\.exe$/);
    assert.equal(result.installerSha256, createHash('sha256').update(SCRIPT).digest('hex'));
    assert.equal(result.words, CLAUDE_INSTALL_WORDS.installed);
    assert.match(CLAUDE_INSTALL_WORDS.installed, /sign in/i);
    for (const folder of fake.folders) assert.equal(existsSync(folder), false, 'the downloaded installer is removed after');
  }
});

test('an installer that ran but left no Claude Code, or failed, says so plainly', async () => {
  const notFound = computer({ installs: false });
  const missing = await installClaudeCode({ approval: mintClaudeInstallYes(), platform: 'win32', host: 'desktop' }, notFound.ports);
  assert.equal(missing.outcome, 'not-found-after');
  assert.equal(missing.words, CLAUDE_INSTALL_WORDS.notFoundAfter);
  const failed = computer({ exitCode: 3, installs: false });
  const steps: ClaudeInstallProgress[] = [];
  await assert.rejects(installClaudeCode({ approval: mintClaudeInstallYes(), platform: 'win32', host: 'desktop' }, failed.ports, step => steps.push(step)), code('CLAUDE_INSTALL_FAILED'));
  assert.equal(steps.at(-1)!.step, 'failed');
  for (const folder of [...notFound.folders, ...failed.folders]) assert.equal(existsSync(folder), false);
});

test('a download from anywhere else, refused, empty or too large is never run', async () => {
  const cases: [Parameters<typeof computer>[0], string][] = [
    [{ finalUrl: 'https://example.invalid/install.ps1' }, 'CLAUDE_INSTALL_DOWNLOAD_FAILED'],
    [{ finalUrl: 'http://claude.ai/install.ps1' }, 'CLAUDE_INSTALL_DOWNLOAD_FAILED'],
    [{ status: 404 }, 'CLAUDE_INSTALL_DOWNLOAD_FAILED'],
    [{ body: Buffer.alloc(0) }, 'CLAUDE_INSTALL_DOWNLOAD_FAILED'],
    [{ body: Buffer.alloc(3 * 1024 * 1024, 65), length: false }, 'CLAUDE_INSTALL_DOWNLOAD_FAILED'],
  ];
  for (const [options, expected] of cases) {
    const fake = computer(options);
    await assert.rejects(installClaudeCode({ approval: mintClaudeInstallYes(), platform: 'win32', host: 'desktop' }, fake.ports), code(expected), JSON.stringify(options).slice(0, 80));
    assert.equal(fake.ran.length, 0);
    for (const folder of fake.folders) assert.equal(existsSync(folder), false);
  }
});

test('a system with no official installer is refused before anything', async () => {
  const fake = computer();
  await assert.rejects(installClaudeCode({ approval: mintClaudeInstallYes(), platform: 'aix' as any, host: 'desktop' }, fake.ports), code('CLAUDE_INSTALL_UNSUPPORTED'));
  assert.deepEqual([fake.fetched, fake.ran], [[], []]);
});

// D5 fix (review 1, MEDIUM 2): fail closed. Only an explicit desktop host installs; a missing or unknown host is
// refused. The caller passes the ports: there is no default set that would download and run the real installer.
test('D5 fix: only an explicit desktop host installs; a missing or unknown host is refused before anything', async () => {
  for (const host of [undefined, null, '', 'Desktop', 'desktop-app', 'hosted', 'phone']) {
    const fake = computer();
    await assert.rejects(installClaudeCode({ approval: mintClaudeInstallYes(), platform: 'win32', host } as any, fake.ports), code('TIER_UNAVAILABLE'), String(host));
    assert.deepEqual([fake.fetched, fake.ran], [[], []]);
  }
});

test('D5 fix: no default ports; a call without them is refused before it looks, downloads or runs anything', async () => {
  for (const ports of [undefined, null, {}, { fetch: () => undefined }]) {
    await assert.rejects(installClaudeCode({ approval: undefined, platform: 'win32', host: 'desktop' }, ports as any), code('INVALID_VENTURE_REQUEST'));
  }
});

// D5 fix (review 1, MEDIUM 1): the real ports, with Node's spawn and fetch swapped for recorders, so nothing is
// downloaded or started: the process gets an argument array, no shell, a hidden window and only the filtered variables;
// the download follows redirects and reports the final address, which the host check reads.
type Spawned = { command: string; args: readonly string[]; options: any };
function recorder(exit: { code?: number | null; error?: boolean } = {}) {
  const spawned: Spawned[] = [];
  const spawn = (command: string, args: readonly string[], options: any) => {
    spawned.push({ command, args: [...args], options });
    const listeners = new Map<string, (value?: unknown) => void>();
    queueMicrotask(() => (exit.error ? listeners.get('error')?.(new Error('synthetic spawn failure')) : listeners.get('exit')?.(exit.code === undefined ? 0 : exit.code)));
    return { once(event: string, listener: (value?: unknown) => void) { listeners.set(event, listener); return this; }, kill() { return true; } };
  };
  return { spawned, spawn };
}

test('D5 fix: the real run port spawns with no shell, hidden, ignoring output, with the given folder and variables', async () => {
  const { defaultClaudeInstallPorts } = await import('../runtime/venture/models/claude-code-install.ts');
  const rec = recorder();
  const ports = defaultClaudeInstallPorts({ spawn: rec.spawn as any });
  const env = { PATH: '/usr/bin' };
  const result = await ports.run('/bin/bash', ['/tmp/a folder/install.sh'], { cwd: '/tmp/a folder', env, timeoutMs: 1000, windowsHide: true, shell: false });
  assert.equal(result.exitCode, 0);
  assert.equal(rec.spawned.length, 1);
  const [one] = rec.spawned;
  assert.equal(one.command, '/bin/bash');
  assert.deepEqual(one.args, ['/tmp/a folder/install.sh'], 'one argument, never split or quoted by a shell');
  assert.equal(one.options.shell, false);
  assert.equal(one.options.windowsHide, true);
  assert.equal(one.options.stdio, 'ignore');
  assert.equal(one.options.cwd, '/tmp/a folder');
  assert.deepEqual(one.options.env, env);
  assert.equal((await defaultClaudeInstallPorts({ spawn: recorder({ code: null }).spawn as any }).run('x', [], { cwd: '.', env: {}, timeoutMs: 1000, windowsHide: true, shell: false })).exitCode, -1);
  assert.equal((await defaultClaudeInstallPorts({ spawn: recorder({ code: 4 }).spawn as any }).run('x', [], { cwd: '.', env: {}, timeoutMs: 1000, windowsHide: true, shell: false })).exitCode, 4);
  assert.equal((await defaultClaudeInstallPorts({ spawn: recorder({ error: true }).spawn as any }).run('x', [], { cwd: '.', env: {}, timeoutMs: 1000, windowsHide: true, shell: false })).exitCode, -1);
});

test('D5 fix: through the real run port, each system runs its installer as one argument from a folder with a space', async () => {
  const { defaultClaudeInstallPorts } = await import('../runtime/venture/models/claude-code-install.ts');
  for (const platform of ['win32', 'linux'] as const) {
    const fake = computer();
    const rec = recorder();
    const spaced = mkdtempSync(join(tmpdir(), 'chausar claude install test '));
    const environment = { PATH: '/usr/bin', HOME: '/home/owner', CHAUSAR_HOME: '/secret', ANTHROPIC_API_KEY: 'synthetic' };
    let installed = false;
    const ports: ClaudeInstallPorts = { ...fake.ports, run: defaultClaudeInstallPorts({ spawn: (...args: any[]) => { installed = true; return (rec.spawn as any)(...args); } }).run,
      locate: command => (command === 'claude' && installed ? '/home/owner/.local/bin/claude' : null), tempFolder: async () => spaced };
    const result = await installClaudeCode({ approval: mintClaudeInstallYes(), platform, host: 'desktop', environment }, ports);
    assert.equal(result.outcome, 'installed');
    const installer = CLAUDE_CODE_INSTALLERS[platform];
    assert.equal(rec.spawned.length, 1);
    const [one] = rec.spawned;
    assert.equal(one.command, installer.command);
    assert.deepEqual(one.args, [...installer.lead, join(spaced, installer.file)], 'the script path with its space is one argument');
    assert.equal(one.options.shell, false);
    assert.equal(one.options.windowsHide, true);
    assert.deepEqual(one.options.env, { PATH: '/usr/bin', HOME: '/home/owner' }, 'only the path-type variables reach it');
    assert.equal(existsSync(spaced), false, 'the folder is removed after');
  }
});

test('D5 fix: the real fetch port follows redirects and reports the final address, so a redirect away from Anthropic is never run', async () => {
  const { defaultClaudeInstallPorts } = await import('../runtime/venture/models/claude-code-install.ts');
  const asked: { url: string; init: any }[] = [];
  const fetch = async (url: string, init: any) => {
    asked.push({ url, init });
    return { ok: true, status: 200, url: 'https://example.invalid/install.ps1', headers: new Headers({ 'content-length': String(SCRIPT.length) }), body: (async function* () { yield SCRIPT; })() };
  };
  const real = defaultClaudeInstallPorts({ fetch: fetch as any });
  const fake = computer();
  await assert.rejects(installClaudeCode({ approval: mintClaudeInstallYes(), platform: 'win32', host: 'desktop' }, { ...fake.ports, fetch: real.fetch }), code('CLAUDE_INSTALL_DOWNLOAD_FAILED'));
  assert.equal(fake.ran.length, 0, 'nothing run');
  assert.deepEqual(asked.map(item => [item.url, item.init.redirect, item.init.signal instanceof AbortSignal]), [[CLAUDE_CODE_INSTALLERS.win32.url, 'follow', true]]);
});
