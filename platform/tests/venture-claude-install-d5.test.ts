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
  CLAUDE_CODE_INSTALLERS, CLAUDE_INSTALL_WORDS, installClaudeCode, type ClaudeInstallPorts, type ClaudeInstallProgress,
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
  await assert.rejects(installClaudeCode({ approval: YES, platform: 'linux', host: 'hosted-web' }, fake.ports), code('TIER_UNAVAILABLE'));
  assert.deepEqual([fake.fetched, fake.ran], [[], []]);
});

test('Claude Code already on this computer: nothing is downloaded', async () => {
  const fake = computer({ foundBefore: true });
  const result = await installClaudeCode({ approval: YES, platform: 'win32', host: 'desktop' }, fake.ports);
  assert.equal(result.outcome, 'already-installed');
  assert.deepEqual([fake.fetched, fake.ran], [[], []]);
});

test('with a yes: the official installer is downloaded with progress, run unmodified with no sign-in, then Claude Code is looked for again', async () => {
  for (const platform of ['win32', 'linux', 'darwin'] as const) {
    const fake = computer();
    const steps: ClaudeInstallProgress[] = [];
    const result = await installClaudeCode({ approval: YES, platform, host: 'desktop' }, fake.ports, progress => steps.push(progress));
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
  const missing = await installClaudeCode({ approval: YES, platform: 'win32', host: 'desktop' }, notFound.ports);
  assert.equal(missing.outcome, 'not-found-after');
  assert.equal(missing.words, CLAUDE_INSTALL_WORDS.notFoundAfter);
  const failed = computer({ exitCode: 3, installs: false });
  const steps: ClaudeInstallProgress[] = [];
  await assert.rejects(installClaudeCode({ approval: YES, platform: 'win32', host: 'desktop' }, failed.ports, step => steps.push(step)), code('CLAUDE_INSTALL_FAILED'));
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
    await assert.rejects(installClaudeCode({ approval: YES, platform: 'win32', host: 'desktop' }, fake.ports), code(expected), JSON.stringify(options).slice(0, 80));
    assert.equal(fake.ran.length, 0);
    for (const folder of fake.folders) assert.equal(existsSync(folder), false);
  }
});

test('a system with no official installer is refused before anything', async () => {
  const fake = computer();
  await assert.rejects(installClaudeCode({ approval: YES, platform: 'aix' as any, host: 'desktop' }, fake.ports), code('CLAUDE_INSTALL_UNSUPPORTED'));
  assert.deepEqual([fake.fetched, fake.ran], [[], []]);
});
