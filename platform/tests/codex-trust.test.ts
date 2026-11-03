// A2: trust both kinds of Codex. The gate is the one loadCodexCliHostGateway always applied (pinned manifest, pinned
// answers, the program's digest at load and before each call); these tests check who may record a setup: the build for
// the bundled Codex, and the owner for their own, only after seeing it and only for that exact program.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { processCredentialPort } from '../runtime/venture/models/credential-port.ts';
import { CodexTrust, REVIEWED_CODEX_VERSIONS, SEAL_SCOPE, SETUP_WORDS, type CodexProbe, type CodexSeal } from '../runtime/codex-trust.ts';
import { CODEX_QUIET_ARGS } from '../runtime/providers/codex-cli.ts';

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
    // A2 review: the checks lead with the quiet flags; the check itself is the rest.
    const key = (args[0] === '--disable' ? args.slice(CODEX_QUIET_ARGS.length) : args).join(' ');
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
  assert.deepEqual(seen, [[...CODEX_QUIET_ARGS, '--version'], [...CODEX_QUIET_ARGS, 'exec', '--help'], [...CODEX_QUIET_ARGS, 'features', 'list']], 'only the three check commands, no prompt, background features off');
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
  // A2 review: the earlier trust's next call drops the setup, says so, and the owner can review again.
  await assert.rejects(trust.process({ command: path, args: ['exec'], env: {}, stdin: '', cwd: root, timeoutMs: 1000 } as never), { code: 'CODEX_SETUP_CHANGED', message: SETUP_WORDS.changed });
  assert.equal(trust.profile(), null);
  assert.equal((await trust.review(path)).state, 'review', 'a new review is offered');
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
  assert.equal((await script.review(join(root, 'codex.bat'))).line, SETUP_WORDS.notProgram(false), 'no bundled Codex is named in a build without one');
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

// A2 review findings 4, 5, 9, 10, 11 and 14.
function sealStore(): CodexSeal & { saved: Map<string, string> } {
  const saved = new Map<string, string>();
  return { saved, async get(workspaceId, name) { return saved.get(`${workspaceId}/${name}`) ?? null; }, async set(workspaceId, name, value) { saved.set(`${workspaceId}/${name}`, value); } };
}

test('only reviewed Codex versions can be chosen; another version is told plainly, and the bundled Codex is offered when there is one', async t => {
  assert.deepEqual([...REVIEWED_CODEX_VERSIONS], ['0.166.0']);
  const root = await folder(t), path = await program(root);
  const older = probeOf({ '--version': { exitCode: 0, stdout: 'codex-cli 0.154.0\n' } });
  const plain = new CodexTrust({ environment: { CHAUSAR_CODEX_TRUST_DIR: join(root, 'trust') }, probe: older.probe });
  const view = await plain.review(path);
  assert.deepEqual([view.state, view.version, view.line], ['refused', '0.154.0', SETUP_WORDS.otherVersion('0.154.0', false)]);
  assert.match(view.line, /Chausar works with Codex 0\.166\.0/);
  assert.doesNotMatch(view.line, /comes with Chausar/, 'no bundled Codex here, so none is offered');
  assert.equal(older.seen.length, 1, 'nothing more is asked of an unreviewed version');
  // With a bundled Codex in this install, it is offered in place of the unreviewed one.
  const bundle = join(root, 'codex');
  const bundled = await program(bundle, 'bundled codex bytes');
  const probe: CodexProbe = async (command, args) => (command === bundled ? probeOf().probe(command, args, '') : older.probe(command, args, ''));
  const offered = await new CodexTrust({ environment: { CHAUSAR_CODEX_TRUST_DIR: join(root, 'trust'), CHAUSAR_CODEX_BUNDLE_DIR: bundle }, probe }).review(path);
  assert.deepEqual([offered.state, offered.sha256], ['review', sha256('bundled codex bytes')]);
  assert.equal(SETUP_WORDS.otherVersion('0.154.0', true), 'This is Codex 0.154.0. Chausar works with Codex 0.166.0. Update it, or use the Codex that comes with Chausar.');
});

test('a program swapped between the review and the yes is refused as changed, and is reviewed again', async t => {
  const root = await folder(t), path = await program(root);
  const trust = new CodexTrust({ environment: { CHAUSAR_CODEX_TRUST_DIR: join(root, 'trust') }, probe: probeOf().probe });
  const view = await trust.review(path);
  await writeFile(path, 'swapped program bytes');
  await assert.rejects(trust.record(view.sha256), { code: 'CODEX_SETUP_CHANGED', message: SETUP_WORDS.changed });
  assert.equal(trust.profile(), null);
  assert.equal((await trust.review(path)).sha256, sha256('swapped program bytes'), 'the new program is reviewed afresh');
});

test('agent jobs get the program only after its digest is checked; none in use refuses, a changed one drops the setup', async t => {
  const root = await folder(t), path = await program(root);
  const trust = new CodexTrust({ environment: { CHAUSAR_CODEX_TRUST_DIR: join(root, 'trust') }, probe: probeOf().probe });
  await assert.rejects(trust.verifiedProgram(), { code: 'CODEX_SETUP_UNAVAILABLE', message: SETUP_WORDS.noSetup });
  await trust.record((await trust.review(path)).sha256);
  assert.equal(await trust.verifiedProgram(), path);
  await writeFile(path, 'changed while running');
  await assert.rejects(trust.verifiedProgram(), { code: 'CODEX_SETUP_CHANGED' });
  assert.equal(trust.profile(), null);
});

test('on the desktop the choice is sealed: an unsealed or edited file is not taken, and each choice is in the decision journal', async t => {
  const root = await folder(t), path = await program(root);
  const seal = sealStore();
  const environment = { CHAUSAR_CODEX_TRUST_DIR: join(root, 'trust') };
  const trust = new CodexTrust({ environment, seal, probe: probeOf().probe });
  await trust.record((await trust.review(path)).sha256);
  assert.match(seal.saved.get(`${SEAL_SCOPE.workspaceId}/${SEAL_SCOPE.name}`) ?? '', /^[a-f0-9]{64}$/, 'a key kept by the sealed store');
  const kept = JSON.parse(await readFile(join(root, 'trust', 'trusted.json'), 'utf8'));
  assert.match(kept.mac, /^[a-f0-9]{64}$/);
  const again = new CodexTrust({ environment, seal, probe: probeOf().probe });
  await again.load();
  assert.equal(again.origin(), 'owner', 'a sealed choice is taken');
  // Written by anything else: an edited or unsealed file is refused.
  await writeFile(join(root, 'trust', 'trusted.json'), JSON.stringify({ ...kept, at: '2026-11-04T00:00:00.000Z' }));
  const edited = new CodexTrust({ environment, seal, probe: probeOf().probe });
  await edited.load();
  assert.equal(edited.profile(), null);
  const { mac: _mac, ...unsealed } = kept;
  await writeFile(join(root, 'trust', 'trusted.json'), JSON.stringify(unsealed));
  const bare = new CodexTrust({ environment, seal, probe: probeOf().probe });
  await bare.load();
  assert.equal(bare.profile(), null);
  assert.equal((await bare.review(path)).state, 'review', 'the owner is asked again');
  // Where this computer has no sealed store at all the earlier, unsealed behaviour holds.
  const unavailable: CodexSeal = { async get() { throw Object.assign(new Error('x'), { code: 'CREDENTIAL_NO_STORE' }); }, async set() { throw new Error('never'); } };
  const noSeal = new CodexTrust({ environment, seal: unavailable, probe: probeOf().probe });
  await noSeal.load();
  assert.equal(noSeal.origin(), 'owner');
  const journal = (await readFile(join(root, 'trust', 'decisions.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(journal.map(entry => [entry.decision, entry.by, entry.sha256, entry.version]), [['chose', 'owner', sha256('synthetic codex program bytes'), '0.166.0']]);
  assert.match(journal[0].mac, /^[a-f0-9]{64}$/);
});

test('reviews already running are joined, and the shown path is the program that is hashed and run', async t => {
  const root = await folder(t), path = await program(root);
  const { probe, seen } = probeOf();
  const trust = new CodexTrust({ probe });
  const [one, two] = await Promise.all([trust.review(path), trust.review(path)]);
  assert.deepEqual(one, two);
  assert.equal(seen.length, 3, 'one review, not two');
  assert.ok(one.path!.endsWith(join('bin', process.platform === 'win32' ? 'codex.exe' : 'codex')));
});

// A2 second review (M1): only a computer with no sealed store at all keeps the unsealed file. Any other failure of the
// store (a broken credentials folder, a relay that times out, a host with no listener) refuses it, so a file written
// into the trust folder cannot be made to load by breaking the store.
const requireCjs = createRequire(import.meta.url);
const { createCredentialStore } = requireCjs('../../app/desktop/credential-store.cjs');
const { createCredentialRelay } = requireCjs('../../app/desktop/credential-relay.cjs');
type Answer = (result: unknown) => void;
/** The worker's seal port, through the real relay, to a host listener (or none). */
function sealChain(listen: ((request: any, answer: Answer) => void) | null, timeoutMs = 100): CodexSeal {
  const channel = new EventEmitter() as any, child = new EventEmitter() as any, harness = new EventEmitter();
  channel.connected = child.connected = true;
  const relay = createCredentialRelay(harness, child, { timeoutMs });
  channel.send = (message: unknown, callback: (error: Error | null) => void) => { relay.receive(message); callback(null); return true; };
  child.send = (message: unknown, callback: () => void) => { channel.emit('message', message); callback(); };
  if (listen) harness.on('credential', listen);
  return processCredentialPort(channel, { timeoutMs: timeoutMs * 4, noStore: true });
}
/** As app/desktop/main.cjs answers the worker from the real store. */
const storeAnswers = (store: any) => (request: any, answer: Answer) => {
  store[request.op](request.workspaceId, request.name, request.value).then((value: unknown) => answer({ ok: true, value: value ?? null }), (error: any) => answer({ ok: false, code: error?.code }));
};
const encryption = (available: boolean) => ({ isEncryptionAvailable: () => available, getSelectedStorageBackend: () => 'gnome_libsecret', encryptString: (text: string) => Buffer.from(text), decryptString: (bytes: Buffer) => bytes.toString() });

test('the unsealed choice is kept only where there is no sealed store; a broken store, a timeout or no listener refuses it', async t => {
  const root = await folder(t), path = await program(root);
  const environment = { CHAUSAR_CODEX_TRUST_DIR: join(root, 'trust') };
  // An unsealed choice, as a computer without a sealed store writes it (or as anything else could write it).
  const plain = new CodexTrust({ environment, probe: probeOf().probe });
  await plain.record((await plain.review(path)).sha256);
  const loads = async (seal: CodexSeal) => { const trust = new CodexTrust({ environment, seal, probe: probeOf().probe }); await trust.load(); return trust.origin(); };
  // No safeStorage here at all: the store says so with its own code, and the unsealed file is taken.
  const none = createCredentialStore({ directory: join(root, 'no-store'), safeStorage: encryption(false), platform: 'win32' });
  assert.equal(await loads(sealChain(storeAnswers(none))), 'owner');
  // A file where the credentials folder should be: the store fails, and the file is refused.
  await writeFile(join(root, 'credentials'), 'not a folder');
  const blocked = createCredentialStore({ directory: join(root, 'credentials'), safeStorage: encryption(true), platform: 'win32' });
  await assert.rejects(blocked.get(SEAL_SCOPE.workspaceId, SEAL_SCOPE.name), { code: 'CREDENTIAL_UNAVAILABLE' });
  assert.equal(await loads(sealChain(storeAnswers(blocked))), null, 'a broken store is not a missing one');
  // A host that never answers, and a host with no listener.
  assert.equal(await loads(sealChain(() => {})), null, 'a relay timeout');
  assert.equal(await loads(sealChain(null)), null, 'no listener');
  // A worker with no host channel at all.
  const closed = new EventEmitter() as any; closed.connected = false;
  assert.equal(await loads(processCredentialPort(closed, { noStore: true })), null, 'a closed channel');
});

// A2 second review (L2): each line of the decision journal is sealed over the line before it, so an edited, removed or
// reordered line shows when the journal is read. A seal key that cannot be read offers a fresh look, never a dead end.
test('the decision journal is a chain: every line checks against the one before, and a changed or missing line shows', async t => {
  const root = await folder(t), path = await program(root);
  const seal = sealStore();
  const environment = { CHAUSAR_CODEX_TRUST_DIR: join(root, 'trust') };
  const trust = new CodexTrust({ environment, seal, probe: probeOf().probe });
  await trust.record((await trust.review(path)).sha256);
  await writeFile(path, 'a changed program');
  await assert.rejects(trust.verifiedProgram(), { code: 'CODEX_SETUP_CHANGED' });
  await trust.record((await trust.review(path)).sha256);
  const read = await trust.decisions();
  assert.equal(read.intact, true);
  assert.deepEqual(read.entries.map(entry => [entry.decision, entry.sha256]), [['chose', sha256('synthetic codex program bytes')], ['dropped', sha256('synthetic codex program bytes')], ['chose', sha256('a changed program')]]);
  const file = join(root, 'trust', 'decisions.jsonl');
  const lines = (await readFile(file, 'utf8')).trim().split('\n');
  // The same three lines with the middle one left out: each line's own seal still checks, the chain does not.
  await writeFile(file, [lines[0], lines[2]].join('\n') + '\n');
  assert.equal((await trust.decisions()).intact, false, 'a removed line shows');
  const edited = JSON.parse(lines[1]!); edited.version = '0.200.0';
  await writeFile(file, [lines[0], JSON.stringify(edited), lines[2]].join('\n') + '\n');
  assert.equal((await trust.decisions()).intact, false, 'an edited line shows');
  await writeFile(file, [lines[1], lines[0], lines[2]].join('\n') + '\n');
  assert.equal((await trust.decisions()).intact, false, 'a reordered line shows');
});

test('an unreadable seal key offers a fresh look at the Codex, and the next yes is kept', async t => {
  const root = await folder(t), path = await program(root);
  const environment = { CHAUSAR_CODEX_TRUST_DIR: join(root, 'trust') };
  let corrupt = true, replaced = 0;
  const saved = new Map<string, string>();
  const seal: CodexSeal = {
    async get(workspaceId, name) { if (corrupt) throw Object.assign(new Error('x'), { code: 'CREDENTIAL_INVALID' }); return saved.get(`${workspaceId}/${name}`) ?? null; },
    async set(workspaceId, name, value) { corrupt = false; replaced += 1; saved.set(`${workspaceId}/${name}`, value); },
  };
  const trust = new CodexTrust({ environment, seal, probe: probeOf().probe });
  const view = await trust.review(path);
  await assert.rejects(trust.record(view.sha256), { code: 'CODEX_SETUP_CHANGED', message: SETUP_WORDS.resealed });
  assert.equal(replaced, 1, 'a new key was made');
  assert.equal(trust.profile(), null);
  await assert.rejects(readFile(join(root, 'trust', 'trusted.json')), { code: 'ENOENT' });
  const again = await trust.review(path);
  assert.equal(again.state, 'review', 'the owner is shown the Codex again');
  assert.equal((await trust.record(again.sha256)).origin, 'owner');
  const later = new CodexTrust({ environment, seal, probe: probeOf().probe });
  await later.load();
  assert.equal(later.origin(), 'owner', 'sealed with the new key');
});
