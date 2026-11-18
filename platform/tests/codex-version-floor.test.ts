// A Codex newer than the reviewed one is accepted when its own help and feature list pass the same checks, so an
// ordinary Codex update no longer stops the owner's AI. The floor is the first reviewed version; a new major waits for
// a review. A feature a newer Codex turns on by default that the review did not cover is switched off by the text route.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import {
  CODEX_CLI_CONFIG, CODEX_CLI_FLAGS, CODEX_MINIMUM_VERSION, CODEX_QUIET_ARGS, buildCodexCliArguments, codexQuietArgsFor, codexVersionAccepted,
  createCodexCliProcessAdapter, unreviewedCodexFeatures, type CodexCliCapabilityProfile,
} from '../runtime/providers/codex-cli.ts';
import { CodexTrust, SETUP_WORDS, type CodexProbe } from '../runtime/codex-trust.ts';
import { CodexDriver, codexConfig } from '../runtime/venture/agent-runtime/codex-driver.ts';
import type { CodexChild } from '../runtime/venture/agent-runtime/codex-rpc.ts';
import { AGENT_MCP_TOOL_NAMES, type AgentDriverInput } from '../runtime/venture/agent-runtime/driver-types.ts';

const fixture = (name: string) => readFile(new URL(`./fixtures/venture/models/cli-help/${name}`, import.meta.url), 'utf8');
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const EXEC_HELP = await fixture('codex-cli-0.166.0-exec-help.txt');
const FEATURES = await fixture('codex-cli-0.166.0-features.txt');
/** The one change read live on Codex 0.167.0-alpha.3.2 (11 Nov 2026): this feature moved to stable and on. */
const NEWLY_ON = 'deferred_tool_world_state';
const NEWER_FEATURES = FEATURES.replace(new RegExp(`^(\\s*${NEWLY_ON}\\s+)under development(\\s+)false\\s*$`, 'm'), '$1stable$2true');

const syntheticProfile = (unreviewedFeatures?: string[]): CodexCliCapabilityProfile => ({
  evidence: { kind: 'synthetic-fixture', label: 'synthetic newer Codex' },
  flags: [...CODEX_CLI_FLAGS], configKeys: CODEX_CLI_CONFIG.map(value => value.split('=')[0]!), stdinPrompt: true, sandboxModes: ['read-only'],
  ...(unreviewedFeatures ? { unreviewedFeatures } : {}),
});

test('the fixture really differs: the newer listing turns the feature on', () => {
  assert.notEqual(NEWER_FEATURES, FEATURES);
  assert.match(NEWER_FEATURES, new RegExp(`${NEWLY_ON}\\s+stable\\s+true`));
});

test('the reviewed version and anything newer in the same major is accepted; older, a new major and look-alikes are not', () => {
  assert.equal(CODEX_MINIMUM_VERSION, '0.166.0');
  for (const version of ['0.166.0', '0.166.1', '0.167.0', '0.167.0-alpha.3.2', '0.200.3']) assert.equal(codexVersionAccepted(version), true, version);
  for (const version of ['0.165.9', '0.154.0', '0.121.0', '0.166.0-alpha.1', '0.166.0+build', '0.166.00', '10.166.01', '1.0.0', '9.9.9', '0.167', 'codex', '', null, undefined]) {
    assert.equal(codexVersionAccepted(version), false, String(version));
  }
});

test('the quiet flags go to every accepted Codex and to no older one', () => {
  assert.deepEqual([...codexQuietArgsFor('0.166.0')], [...CODEX_QUIET_ARGS]);
  assert.deepEqual([...codexQuietArgsFor('0.167.0-alpha.3.2')], [...CODEX_QUIET_ARGS]);
  assert.deepEqual([...codexQuietArgsFor('0.154.0')], []);
  assert.deepEqual([...codexQuietArgsFor(null)], []);
});

test('a default-on feature the review did not cover is found from the feature list; the reviewed list has none', () => {
  assert.deepEqual(unreviewedCodexFeatures(FEATURES), []);
  assert.deepEqual(unreviewedCodexFeatures(NEWER_FEATURES), [NEWLY_ON]);
  const more = `${FEATURES}\nbrand_new_tool    stable    true\ngone_tool    removed    true\nquiet_tool    experimental    false\nnested.new_tool    stable    true\n`;
  assert.deepEqual(unreviewedCodexFeatures(more), ['brand_new_tool', 'nested.new_tool']);
});

test('the text route switches an unreviewed feature off, and the process gate expects exactly that', async () => {
  const schema = join(tmpdir(), `chausar-synthetic-schema-${process.pid}`, 'schema.json');
  const plain = buildCodexCliArguments('explicit-model', schema, syntheticProfile());
  const guarded = buildCodexCliArguments('explicit-model', schema, syntheticProfile([NEWLY_ON]));
  assert.equal(plain.includes(`features.${NEWLY_ON}=false`), false, 'nothing is added for a reviewed Codex');
  assert.deepEqual(guarded.slice(0, plain.length - 1), plain.slice(0, -1), 'the reviewed arguments stay first and unchanged');
  assert.deepEqual(guarded.slice(plain.length - 1), ['--config', `features.${NEWLY_ON}=false`, '-']);
  assert.throws(() => buildCodexCliArguments('explicit-model', schema, syntheticProfile(['Bad Name; rm'])), { code: 'CLI_CAPABILITY_UNSUPPORTED' });
  // The process gate rebuilds the arguments from the same profile, so a call without the switch is refused.
  const seen: string[][] = [];
  const stdout = [{ type: 'thread.started', thread_id: 't' }, { type: 'turn.started' }, { type: 'item.completed', item: { id: 'i', type: 'agent_message', text: '{"answer":"ok"}' } }, { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }].map(row => JSON.stringify(row)).join('\n');
  const adapter = createCodexCliProcessAdapter({ capabilities: syntheticProfile([NEWLY_ON]), mode: 'synthetic-fixture', process: async request => { seen.push(request.args); return { exitCode: 0, stdout, stderr: '' }; } });
  const request = { command: 'codex', cwd: tmpdir(), env: {}, stdin: 'Synthetic.', timeoutMs: 1000, schema: { type: 'object' } };
  await adapter({ ...request, args: guarded });
  assert.equal(seen.length, 1);
  await assert.rejects(adapter({ ...request, args: plain }), { code: 'CLI_CAPABILITY_UNSUPPORTED' });
});

async function folder(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-codex-floor-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function program(root: string, bytes = 'synthetic newer codex program bytes') {
  const path = join(root, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex');
  await mkdir(join(root, 'bin'), { recursive: true });
  await writeFile(path, bytes);
  return path;
}
function probeOf(version: string, features: string): { probe: CodexProbe; seen: string[][] } {
  const seen: string[][] = [];
  const probe: CodexProbe = async (_command, args) => {
    seen.push(args);
    const key = (args[0] === '--disable' ? args.slice(CODEX_QUIET_ARGS.length) : args).join(' ');
    if (key === '--version') return { exitCode: 0, stdout: `codex-cli ${version}\n` };
    if (key === 'exec --help') return { exitCode: 0, stdout: EXEC_HELP };
    if (key === 'features list') return { exitCode: 0, stdout: features };
    return { exitCode: 2, stdout: '' };
  };
  return { probe, seen };
}

test('a newer Codex that has what Chausar needs can be chosen, is kept across starts, and has its new feature switched off', async t => {
  const root = await folder(t), path = await program(root);
  const environment = { CHAUSAR_CODEX_TRUST_DIR: join(root, 'trust') };
  const { probe, seen } = probeOf('0.167.0-alpha.3.2', NEWER_FEATURES);
  const trust = new CodexTrust({ environment, probe });
  const view = await trust.review(path);
  assert.deepEqual([view.state, view.version, view.line], ['review', '0.167.0-alpha.3.2', SETUP_WORDS.review('0.167.0-alpha.3.2')]);
  assert.equal(seen.length, 3, 'the version, the help and the features were all read');
  const kept = await trust.record(view.sha256, trust.held(view.sha256)!.path);
  assert.deepEqual([kept.state, kept.origin, kept.version], ['trusted', 'owner', '0.167.0-alpha.3.2']);
  assert.deepEqual(trust.profile()!.capabilities.unreviewedFeatures, [NEWLY_ON]);
  const again = new CodexTrust({ environment, probe });
  await again.load();
  assert.deepEqual([again.current()?.state, again.current()?.version], ['trusted', '0.167.0-alpha.3.2']);
  assert.deepEqual(again.profile()!.capabilities.unreviewedFeatures, [NEWLY_ON]);
  assert.equal(sha256('synthetic newer codex program bytes'), view.sha256);
});

test('the reviewed Codex is unchanged: nothing is marked unreviewed', async t => {
  const root = await folder(t), path = await program(root);
  const { probe } = probeOf('0.166.0', FEATURES);
  const trust = new CodexTrust({ environment: { CHAUSAR_CODEX_TRUST_DIR: join(root, 'trust') }, probe });
  const view = await trust.review(path);
  await trust.record(view.sha256, trust.held(view.sha256)!.path);
  assert.equal(Object.hasOwn(trust.profile()!.capabilities, 'unreviewedFeatures'), false);
});

test('an older Codex and a new major are refused in plain words, and nothing more is asked of them', async t => {
  const root = await folder(t), path = await program(root);
  for (const version of ['0.154.0', '0.166.0-alpha.1', '1.0.0']) {
    const { probe, seen } = probeOf(version, FEATURES);
    const view = await new CodexTrust({ environment: { CHAUSAR_CODEX_TRUST_DIR: join(root, `trust-${version}`) }, probe }).review(path);
    assert.deepEqual([view.state, view.version, view.line], ['refused', version, SETUP_WORDS.otherVersion(version, false)], version);
    assert.equal(seen.length, 1, version);
  }
  assert.equal(SETUP_WORDS.otherVersion('0.154.0', false), 'This is Codex 0.154.0. Chausar works with Codex 0.166.0 or a newer 0.x version. Update it, then check again.');
});

test('a newer Codex whose help or features lack what Chausar needs is still refused', async t => {
  const root = await folder(t), path = await program(root);
  const lacking = FEATURES.split(/\r?\n/).filter(line => !/^\s*shell_tool\s/.test(line)).join('\n');
  const view = await new CodexTrust({ environment: { CHAUSAR_CODEX_TRUST_DIR: join(root, 'trust') }, probe: probeOf('0.170.0', lacking).probe }).review(path);
  assert.deepEqual([view.state, view.line], ['refused', SETUP_WORDS.lacking('0.170.0')]);
});

function driverFixture(userAgent: string) {
  const sent: any[] = []; let child: CodexChild;
  const receive = (value: unknown) => child.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n'));
  const driver = new CodexDriver({ executable: process.execPath, platform: 'win32', qualify: async () => {}, spawn: () => {
    child = new EventEmitter() as CodexChild; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => { child.emit('exit', 0); return true; };
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      const message = JSON.parse(String(chunk)); sent.push(message); done();
      if (!('id' in message) || !message.method) return;
      let result: any = {};
      if (message.method === 'initialize') result = { userAgent };
      if (message.method === 'thread/start') result = { thread: { id: 'thread-1', ephemeral: true }, model: message.params.model, cwd: message.params.cwd, runtimeWorkspaceRoots: message.params.runtimeWorkspaceRoots, activePermissionProfile: { id: message.params.permissions }, approvalsReviewer: message.params.approvalsReviewer, approvalPolicy: message.params.approvalPolicy, instructionSources: [] };
      if (message.method === 'mcpServerStatus/list') result = { data: [{ name: 'chausar', runtimeStatus: 'connected', tools: Object.fromEntries(AGENT_MCP_TOOL_NAMES.map(name => [name, {}])) }], nextCursor: null };
      if (message.method === 'experimentalFeature/list') result = { data: Object.entries(codexConfig(driverInput(), 'fixture', 'win32').features).map(([name, enabled]) => ({ name, enabled: typeof enabled === 'boolean' ? enabled : false })), nextCursor: null };
      queueMicrotask(() => receive({ id: message.id, result }));
    } }); return child;
  } });
  return { driver, sent };
}
function driverInput(): AgentDriverInput {
  return { jobId: 'job-1', jobRoot: join(tmpdir(), `chausar-synthetic-codex-job-${process.pid}`), settings: { model: 'explicit-model', effort: 'high', autoReview: true, shell: false, network: false, webSearch: false }, mcp: { name: 'chausar', command: process.execPath, args: ['synthetic-mcp'], env: { SYNTHETIC_CAPABILITY: 'fixture' } }, guard() {}, onEvent() {} };
}

test('the agent driver opens a job on a newer Codex in the same major, with every other check still made', async () => {
  for (const userAgent of ['chausar/0.167.0 (Mac OS 26.2.0; arm64) unknown (chausar; 0.1.0)', 'chausar/0.167.0-alpha.3.2 (Mac OS 26.2.0; arm64) unknown (chausar; 0.1.0)']) {
    const f = driverFixture(userAgent);
    const session = await f.driver.open(driverInput());
    assert.equal(f.sent.some(item => item.method === 'thread/start'), true, userAgent);
    assert.equal(f.sent.some(item => item.method === 'experimentalFeature/list'), true, userAgent);
    await session.close();
  }
  for (const userAgent of ['chausar/0.165.9 (Mac OS)', 'chausar/1.0.0 (Mac OS)']) {
    const f = driverFixture(userAgent);
    await assert.rejects(f.driver.open(driverInput()), { code: 'CODEX_POLICY_UNSUPPORTED' }, userAgent);
    assert.equal(f.sent.some(item => item.method === 'thread/start'), false, userAgent);
  }
});

// A desktop app opened from the Dock or a launcher gets a short search path that leaves out the folders the tools' own
// installers use (~/.local/bin and the like), so Chausar found neither tool there although both were installed (seen on
// macOS, 11 Nov 2026). At start the engine adds those folders, when they exist, after the owner's own search path.
test('on Windows the engine never adds install folders to the search path', async () => {
  const { withToolFolders } = await import('../runtime/venture/models/cli-look.ts');
  assert.equal(withToolFolders({ HOME: 'C:\\Users\\someone', PATH: 'C:\\Windows' }, 'win32'), null);
  assert.equal(withToolFolders({ PATH: 'C:\\Windows' }, 'win32', () => true), null);
});

// The folders below are Mac and Linux paths, made on this computer, so this part runs only there: on a Windows
// computer the engine adds nothing (held just above). It returns rather than skips, as the bench counts a skip as a fail.
test('the engine adds the usual install folders to a short search path, after the owner\'s own, and never on Windows', async () => {
  if (process.platform === 'win32') return;
  const { withToolFolders, locateOnThisComputer } = await import('../runtime/venture/models/cli-look.ts');
  const { chmod } = await import('node:fs/promises');
  const home = await mkdtemp(join(tmpdir(), 'chausar-tool-folders-'));
  try {
    await mkdir(join(home, '.local', 'bin'), { recursive: true });
    await writeFile(join(home, '.local', 'bin', 'codex'), 'synthetic');
    await chmod(join(home, '.local', 'bin', 'codex'), 0o755);
    const short = { HOME: home, PATH: '/usr/bin:/bin' };
    assert.equal(locateOnThisComputer('codex', short, 'darwin'), null, 'the short search path alone does not have it');
    const path = withToolFolders(short, 'darwin');
    assert.ok(path && path.startsWith('/usr/bin:/bin:'), 'the owner\'s own folders stay first');
    assert.ok(path.split(':').includes(join(home, '.local', 'bin')));
    assert.equal(path.split(':').includes(join(home, '.npm-global', 'bin')), false, 'a folder that does not exist is not added');
    assert.equal(locateOnThisComputer('codex', { ...short, PATH: path }, 'darwin'), join(home, '.local', 'bin', 'codex'));
    // Already there: nothing to add. No home folder: only the system folders are tried. Windows: never.
    assert.equal(withToolFolders({ HOME: home, PATH: path }, 'darwin'), null);
    assert.equal(withToolFolders({ HOME: home, PATH: 'C:\\Windows' }, 'win32'), null);
    const none = withToolFolders({ PATH: '/usr/bin' }, 'linux', () => false);
    assert.equal(none, null);
  } finally { await rm(home, { recursive: true, force: true }); }
});
