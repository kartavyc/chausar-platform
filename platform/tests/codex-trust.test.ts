// A2: trust both kinds of Codex. The gate is the one loadCodexCliHostGateway always applied (pinned manifest, pinned
// answers, the program's digest at load and before each call); these tests check who may record a setup: the build for
// the bundled Codex, and the owner for their own, only after seeing it and only for that exact program.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexTrust, SETUP_WORDS, type CodexProbe } from '../runtime/codex-trust.ts';

const fixture = (name: string) => readFile(new URL(`./fixtures/venture/models/cli-help/${name}`, import.meta.url), 'utf8');
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const EXEC_HELP = await fixture('codex-cli-0.166.0-exec-help.txt');
const FEATURES = await fixture('codex-cli-0.166.0-features.txt');

/** A disposable stand-in for the program (never run: the probe below answers for it). */
async function folder(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-codex-trust-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function program(root: string, bytes = 'synthetic codex program bytes') {
  const path = join(root, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex');
  await mkdir(join(root, 'bin'), { recursive: true });
  await writeFile(path, bytes);
  return path;
}
function probeOf(answers: Partial<Record<string, { exitCode: number; stdout: string }>> = {}): { probe: CodexProbe; seen: string[][] } {
  const seen: string[][] = [];
  const probe: CodexProbe = async (_command, args) => {
    seen.push(args);
    const key = args.join(' ');
    if (answers[key]) return answers[key]!;
    if (key === '--version') return { exitCode: 0, stdout: 'codex-cli 0.166.0\n' };
    if (key === 'exec --help') return { exitCode: 0, stdout: EXEC_HELP };
    if (key === 'features list') return { exitCode: 0, stdout: FEATURES };
    return { exitCode: 2, stdout: '' };
  };
  return { probe, seen };
}

test('no operator values, no bundle and no choice: no Codex is trusted, and a found one is only shown', async t => {
  const root = await folder(t), path = await program(root);
  const { probe, seen } = probeOf();
  const trust = new CodexTrust({ environment: { CHAUSAR_CODEX_TRUST_DIR: join(root, 'trust') }, probe });
  await trust.load();
  assert.equal(trust.profile(), null);
  const view = await trust.review(path);
  assert.deepEqual([view.state, view.version, view.sha256, view.origin], ['review', '0.166.0', sha256('synthetic codex program bytes'), null]);
  assert.equal(view.line, SETUP_WORDS.review('0.166.0'));
  assert.deepEqual(seen, [['--version'], ['exec', '--help'], ['features', 'list']], 'only the three check commands, no prompt');
  assert.equal(trust.profile(), null, 'looking keeps nothing');
  await assert.rejects(readFile(join(root, 'trust', 'trusted.json')), { code: 'ENOENT' });
  // Looked at again with nothing changed: the review is reused, nothing runs again.
  await trust.review(path);
  assert.equal(seen.length, 3);
});

test('the owner says yes to that exact program: it is recorded, loaded through the same gate, and kept across starts', async t => {
  const root = await folder(t), path = await program(root);
  const environment = { CHAUSAR_CODEX_TRUST_DIR: join(root, 'trust') };
  const trust = new CodexTrust({ environment, probe: probeOf().probe });
  await trust.load();
  const view = await trust.review(path);
  await assert.rejects(trust.record('0'.repeat(64)), { code: 'CODEX_SETUP_CHANGED' }, 'another digest is not what was shown');
  await assert.rejects(trust.record('not a digest'), { code: 'INVALID_VENTURE_REQUEST' });
  const kept = await trust.record(view.sha256);
  assert.deepEqual([kept.state, kept.origin, kept.version], ['trusted', 'owner', '0.166.0']);
  const profile = trust.profile()!;
  assert.equal(profile.mode, 'local-cli');
  assert.equal(profile.capabilities.evidence.kind, 'installed-help');
  assert.equal((profile.capabilities.evidence as { executable: string }).executable, path);
  // A new engine start finds the owner's choice.
  const again = new CodexTrust({ environment, probe: probeOf().probe });
  await again.load();
  assert.equal(again.origin(), 'owner');
  // The program changes after the choice: the next start refuses it (the loader checks the digest).
  await writeFile(path, 'a different program');
  const changed = new CodexTrust({ environment, probe: probeOf().probe });
  await changed.load();
  assert.equal(changed.profile(), null);
  // And a call through the earlier trust's process port is refused before it starts.
  await assert.rejects(trust.process({ command: path, args: ['exec'], env: {}, stdin: '', cwd: root, timeoutMs: 1000 } as never), { code: 'CLI_HOST_EVIDENCE_INVALID' });
});

test('a Codex whose help or features lack what Chausar needs cannot be chosen', async t => {
  const root = await folder(t), path = await program(root);
  const noSandbox = EXEC_HELP.replace(/read-only/g, 'readonly');
  for (const answers of [
    { 'exec --help': { exitCode: 0, stdout: noSandbox } },
    { 'features list': { exitCode: 0, stdout: FEATURES.replace(/^shell_tool .*$/m, '') } },
  ]) {
    const trust = new CodexTrust({ environment: { CHAUSAR_CODEX_TRUST_DIR: join(root, 'trust') }, probe: probeOf(answers).probe });
    const view = await trust.review(path);
    assert.deepEqual([view.state, view.line], ['refused', SETUP_WORDS.lacking('0.166.0')]);
    await assert.rejects(trust.record(view.sha256), { code: 'CODEX_SETUP_CHANGED' });
  }
  const silent = new CodexTrust({ probe: probeOf({ '--version': { exitCode: 1, stdout: '' } }).probe });
  assert.deepEqual([(await silent.review(path)).state, (await silent.review(path)).line], ['refused', SETUP_WORDS.noAnswer]);
  // A script or another program is never started.
  const script = new CodexTrust({ probe: probeOf().probe });
  assert.equal((await script.review(join(root, 'codex.bat'))).line, SETUP_WORDS.notProgram);
});

test('no trust folder: a found Codex can be looked at but not kept', async t => {
  const root = await folder(t), path = await program(root);
  const trust = new CodexTrust({ environment: {}, probe: probeOf().probe });
  const view = await trust.review(path);
  await assert.rejects(trust.record(view.sha256), { code: 'CODEX_SETUP_UNAVAILABLE' });
});

test('the bundled Codex: its build-time setup is checked against BUNDLE.json and loaded through the same gate', async t => {
  const root = await folder(t), bundle = join(root, 'codex');
  const path = await program(bundle, 'bundled codex bytes');
  await mkdir(join(bundle, 'evidence'), { recursive: true });
  const outputs = { 'evidence/version.stdout.txt': 'codex-cli 0.166.0\n', 'evidence/exec-help.stdout.txt': EXEC_HELP, 'evidence/features.stdout.txt': FEATURES };
  for (const [name, text] of Object.entries(outputs)) await writeFile(join(bundle, name), text);
  const entry = process.platform === 'win32' ? 'bin/codex.exe' : 'bin/codex';
  const manifest = (programSha = sha256('bundled codex bytes')) => ({
    schemaVersion: 1, version: '0.166.0', entrypoint: entry,
    files: { [entry]: { sha256: programSha }, ...Object.fromEntries(Object.entries(outputs).map(([name, text]) => [name, { sha256: sha256(text) }])) },
    evidence: { recordedAt: '2026-11-03T10:00:00.000Z', files: { versionOutput: 'evidence/version.stdout.txt', execHelp: 'evidence/exec-help.stdout.txt', features: 'evidence/features.stdout.txt' } },
  });
  await writeFile(join(bundle, 'BUNDLE.json'), JSON.stringify(manifest()));
  const environment = { CHAUSAR_CODEX_BUNDLE_DIR: bundle, CHAUSAR_CODEX_TRUST_DIR: join(root, 'trust') };
  const { probe, seen } = probeOf();
  const trust = new CodexTrust({ environment, probe });
  await trust.load();
  assert.equal(trust.origin(), 'bundled');
  assert.equal((trust.profile()!.capabilities.evidence as { executable: string }).executable, path);
  assert.equal(trust.current()!.line, SETUP_WORDS.bundled('0.166.0'));
  assert.equal(seen.length, 0, 'the bundled setup was recorded at build time; nothing runs at start');
  // A bundle whose program or setup files changed after the build is not trusted.
  await writeFile(join(bundle, 'BUNDLE.json'), JSON.stringify(manifest('0'.repeat(64))));
  const changed = new CodexTrust({ environment, probe });
  await changed.load();
  assert.equal(changed.profile(), null);
  await writeFile(join(bundle, 'BUNDLE.json'), JSON.stringify(manifest()));
  await writeFile(join(bundle, 'evidence/exec-help.stdout.txt'), EXEC_HELP + '\nextra');
  const edited = new CodexTrust({ environment, probe });
  await edited.load();
  assert.equal(edited.profile(), null);
});

test('the operator values win over the bundle and the owner\'s choice', async t => {
  const root = await folder(t);
  const operator = { codexCli: { mode: 'local-cli' as const, capabilities: { evidence: { kind: 'installed-help' as const, executable: join(root, 'codex.exe'), version: '0.166.0', helpDigest: 'a'.repeat(64) }, flags: [], configKeys: [], stdinPrompt: true, sandboxModes: ['read-only'] } } };
  const trust = new CodexTrust({ environment: { CHAUSAR_CODEX_BUNDLE_DIR: join(root, 'none') }, operator: operator as never });
  await trust.load();
  assert.equal(trust.origin(), 'operator');
});
