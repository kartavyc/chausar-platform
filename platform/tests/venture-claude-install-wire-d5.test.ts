// D5, the wiring of "Install Claude Code". The owner's yes is made inside the engine, from the click in main's own dialog,
// and the request route can never carry one: as a request the method is always refused, whatever the payload says. A yes is
// fresh and works once. Every port here is a fake: nothing is downloaded or started, and the real ports are never built.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { CLAUDE_INSTALL_WORDS, installClaudeCode, mintClaudeInstallYes, type ClaudeInstallPorts } from '../runtime/venture/models/claude-code-install.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const SCRIPT = Buffer.from('# synthetic installer\n');

function computer(options: { foundBefore?: boolean } = {}) {
  let installed = options.foundBefore === true;
  const seen = { fetched: 0, ran: 0, folders: [] as string[] };
  const ports: ClaudeInstallPorts = {
    async fetch(url) {
      seen.fetched += 1;
      return { ok: true, status: 200, url, headers: { get: () => String(SCRIPT.length) }, body: (async function* () { yield SCRIPT; })() };
    },
    async run() { seen.ran += 1; installed = true; return { exitCode: 0 }; },
    locate: () => (installed ? '/synthetic-home/.local/bin/claude.exe' : null),
    async tempFolder() { const folder = mkdtempSync(join(tmpdir(), 'chausar-claude-wire-')); seen.folders.push(folder); return folder; },
  };
  return { ports, seen };
}

async function engineWith(t: any, claudeInstall: unknown) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-claude-wire-engine-'));
  const engine = new Engine({ version: '0.0.0-test', directory, demo: true, storage: 'experimental-file', pythonExecutable: 'python', ...(claudeInstall ? { claudeInstall } : {}) } as any);
  t.after(async () => { await engine.shutdown().catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  return engine;
}

test('the module takes only a yes the engine made: a plain object is refused before anything is downloaded', async () => {
  for (const approval of [{ yes: true, at: new Date().toISOString() }, JSON.parse(JSON.stringify(mintClaudeInstallYes()))]) {
    const { ports, seen } = computer();
    await assert.rejects(installClaudeCode({ approval, platform: 'win32', host: 'desktop' }, ports), code('CLAUDE_INSTALL_NEEDS_YES'));
    assert.deepEqual([seen.fetched, seen.ran], [0, 0]);
  }
});

test('a yes works once: the second use is refused before anything is downloaded', async () => {
  const yes = mintClaudeInstallYes(), first = computer(), second = computer();
  await installClaudeCode({ approval: yes, platform: 'win32', host: 'desktop' }, first.ports);
  assert.equal(first.seen.fetched, 1);
  await assert.rejects(installClaudeCode({ approval: yes, platform: 'win32', host: 'desktop' }, second.ports), code('CLAUDE_INSTALL_NEEDS_YES'));
  assert.deepEqual([second.seen.fetched, second.seen.ran], [0, 0]);
  for (const folder of first.seen.folders) rmSync(folder, { recursive: true, force: true });
});

test('a stale yes is refused before anything is downloaded', async () => {
  const at = Date.parse('2026-11-06T09:00:00.000Z');
  const yes = mintClaudeInstallYes(() => at);
  const { ports, seen } = computer();
  await assert.rejects(installClaudeCode({ approval: yes, platform: 'win32', host: 'desktop', now: () => at + 5 * 60_000 + 1 }, ports), code('CLAUDE_INSTALL_NEEDS_YES'));
  assert.deepEqual([seen.fetched, seen.ran], [0, 0]);
  const fresh = mintClaudeInstallYes(() => at), later = computer();
  await installClaudeCode({ approval: fresh, platform: 'win32', host: 'desktop', now: () => at + 5 * 60_000 }, later.ports);
  assert.equal(later.seen.fetched, 1, 'five minutes is still fresh');
});

test('as a request the method is always refused, whatever the payload says, and nothing is downloaded', async t => {
  const { ports, seen } = computer();
  const engine = await engineWith(t, { host: 'desktop', ports });
  for (const payload of [{}, { yes: true, at: new Date().toISOString() }, { approval: { yes: true, at: new Date().toISOString() } }]) {
    await assert.rejects(engine.request('venture.ai.claude.install', payload), code('APP_APPROVAL_REQUIRED'));
  }
  assert.deepEqual([seen.fetched, seen.ran], [0, 0]);
});

test('main\'s route installs once, with the progress readable, and a phone or a cofounder never can', async t => {
  const { ports, seen } = computer();
  const engine = await engineWith(t, { host: 'desktop', ports, platform: 'win32', environment: {} });
  assert.deepEqual(await engine.request('venture.ai.claude.progress', {}), { step: 'idle', receivedBytes: 0, totalBytes: null, line: null });
  for (const context of [{ memberId: 'phone', role: 'owner', epoch: 1, channel: 'phone' }, { memberId: 'other', role: 'cofounder', epoch: 1, channel: 'desktop' }]) {
    const previous = engine.context;
    engine.context = context as any;
    await assert.rejects(engine.installClaudeCodeFor(), (error: any) => ['APP_APPROVAL_REQUIRED', 'FORBIDDEN'].includes(error?.code));
    engine.context = previous;
  }
  assert.equal(seen.fetched, 0);
  const result = await engine.installClaudeCodeFor();
  assert.deepEqual([result.outcome, seen.fetched, seen.ran], ['installed', 1, 1]);
  assert.equal(result.words, CLAUDE_INSTALL_WORDS.installed);
  const after = await engine.request('venture.ai.claude.progress', {}) as any;
  assert.equal(after.step, 'done'); assert.equal(after.line, CLAUDE_INSTALL_WORDS.installed);
  const again = await engine.installClaudeCodeFor();
  assert.equal(again.outcome, 'already-installed');
  assert.equal(seen.fetched, 1, 'found now, so nothing more is downloaded');
});

test('a second press joins the install under way', async t => {
  const { ports, seen } = computer();
  const engine = await engineWith(t, { host: 'desktop', ports, platform: 'win32', environment: {} });
  const [one, two] = await Promise.all([engine.installClaudeCodeFor(), engine.installClaudeCodeFor()]);
  assert.equal(one, two);
  assert.deepEqual([seen.fetched, seen.ran], [1, 1]);
});

test('an engine with no install ports says so and starts nothing', async t => {
  const engine = await engineWith(t, null);
  await assert.rejects(engine.installClaudeCodeFor(), code('TIER_UNAVAILABLE'));
  const hosted = await engineWith(t, { host: 'hosted-web', ports: computer().ports });
  await assert.rejects(hosted.installClaudeCodeFor(), code('TIER_UNAVAILABLE'));
});

test('the install says everything in owner words, and each refusal reaches the window with them', async () => {
  const { bannedIn } = await import('../runtime/owner-flag.ts');
  const { ownerError } = await import('../runtime/owner-error.ts');
  const { createRequire } = await import('node:module');
  const { CLAUDE_INSTALL_ASK } = createRequire(import.meta.url)('../../app/desktop/claude-install.cjs');
  for (const words of [...Object.values(CLAUDE_INSTALL_WORDS), CLAUDE_INSTALL_ASK.title, CLAUDE_INSTALL_ASK.detail, CLAUDE_INSTALL_ASK.cancelled, CLAUDE_INSTALL_ASK.busy, ...CLAUDE_INSTALL_ASK.buttons]) assert.deepEqual(bannedIn(words), [], words);
  const { ports } = computer();
  const refused = await installClaudeCode({ approval: {}, platform: 'win32', host: 'desktop' }, ports).catch((error: unknown) => error);
  assert.deepEqual(ownerError(refused), { code: 'CLAUDE_INSTALL_NEEDS_YES', message: CLAUDE_INSTALL_WORDS.needsYes, owner: true });
});

test('source rules: only the engine mints a yes, only the desktop worker passes the real ports, and no test builds them on the route', async () => {
  const root = new URL('../runtime/', import.meta.url);
  const minted: string[] = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const path = join(entry.parentPath ?? (entry as any).path, entry.name);
    if ((await readFile(path, 'utf8')).includes('mintClaudeInstallYes(')) minted.push(path.split('\\').join('/').replace(/.*platform\/runtime\//, ''));
  }
  assert.deepEqual(minted.sort(), ['engine.ts', 'venture/models/claude-code-install.ts']);
  const worker = await readFile(new URL('worker.ts', root), 'utf8');
  assert.match(worker, /typeof process\.send === 'function' \? \{ claudeInstall: \{ host: 'desktop', ports: defaultClaudeInstallPorts\(\)/);
  for (const name of ['server.ts', 'hosted/server.ts']) assert.doesNotMatch(await readFile(new URL(name, root), 'utf8'), /claudeInstall|defaultClaudeInstallPorts/, name);
  const harness = await readFile(new URL('../../app/desktop/engine-harness.cjs', import.meta.url), 'utf8');
  assert.match(harness, /installClaude\(\) \{ return this\.#send\(\{ kind: 'host-claude-install' \}/, 'the host message carries no payload');
});
