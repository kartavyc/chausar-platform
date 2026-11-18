// "Checking this computer" took 25 to 39 seconds for a later business on Windows (15 Nov 2026: venture.ai.reuse 38.7 s).
// A fresh look at Codex started its program four times, one after another (version, exec help, help, sign-in status),
// and the trusted setup read and hashed the whole program before every one of those starts; two tools were looked at
// one after the other; and a time-out's taskkill blocked the whole engine for up to ten seconds. What a look asks is
// unchanged, and so is every refusal. What is new, held here:
//   - a program's digest is worked out once while the file stays the same, for a minute at most (file-digest.ts);
//   - what a program's own version and help say cannot change while the file is the same: one engine run asks them
//     once, and a later fresh look starts only the sign-in status command, which can change;
//   - Codex's two help pages are read together, and two tools are looked at together;
//   - ending a tool's tree on Windows no longer blocks the engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DIGEST_REUSE_MS, DIGEST_SETTLE_MS, digestOfUnchanged } from '../runtime/file-digest.ts';
import { killTree } from '../runtime/process-tree.ts';
import { inspectInstalledCli, type CliLook, type CliStaticChecks } from '../runtime/venture/models/cli-status.ts';
import { cliRouteFlags } from '../runtime/venture/models/cli.ts';
import { reusableSetup, type AiSetupNote } from '../runtime/venture/models/ai-setup.ts';
import { presetSpec } from '../runtime/venture/models/presets.ts';
import type { ModelProcessRequest, ModelTransport } from '../runtime/venture/contracts.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 20; i += 1) await tick(); };
/** Waits until something is true (a look makes its folder and looks at the program file before it starts anything). */
async function until(what: () => boolean, words: () => string): Promise<void> {
  for (let i = 0; i < 400 && !what(); i += 1) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(what(), words());
  await settle();
}
const help = (flags: readonly string[], commands: readonly string[]) => `Usage: tool [OPTIONS]\n\nCommands:\n${commands.map(name => `  ${name}  Does ${name}`).join('\n')}\n\nOptions:\n${flags.map(flag => `  ${flag}`).join('\n')}\n`;

/** A stand-in for the transport: each start waits until the test lets it answer, so the test sees what runs together. */
function tool(answers: Record<string, string>) {
  const seen: string[] = [];
  const waiting = new Map<string, () => void>();
  const transport = {
    replay: false,
    process: (request: ModelProcessRequest) => new Promise(resolve => {
      const asked = request.args.join(' ');
      seen.push(asked);
      waiting.set(asked, () => { waiting.delete(asked); resolve({ exitCode: Object.hasOwn(answers, asked) ? 0 : 1, stdout: answers[asked] ?? '', stderr: '' }); });
    }),
  } as unknown as ModelTransport;
  const answer = async (asked: string) => { await until(() => waiting.has(asked), () => `"${asked}" is not waiting; waiting: ${[...waiting.keys()].join(' | ')}`); waiting.get(asked)!(); await settle(); };
  return { transport, seen, waiting, answer };
}
const CODEX = { '--version': 'codex-cli 0.154.0', 'exec --help': help(cliRouteFlags('codex-cli'), []), '--help': help(['--version'], ['exec', 'login']), 'login status': 'Logged in using ChatGPT' };
const CLAUDE = { '--version': '2.3.1 (Claude Code)', '--help': help(cliRouteFlags('claude-cli'), ['auth']), 'auth status': '{"loggedIn": true}' };

async function programs(t: { after(fn: () => unknown): void }) {
  const folder = await mkdtemp(join(tmpdir(), 'chausar-speed-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  // The stand-ins are programs this computer would start: on Windows a look starts only an .exe (cli-look.ts).
  const exe = process.platform === 'win32' ? '.exe' : '';
  const codex = join(folder, `codex${exe}`), claude = join(folder, `claude${exe}`);
  await writeFile(codex, 'stand-in codex');
  await writeFile(claude, 'stand-in claude');
  return { folder, codex, claude };
}
const lookOf = (transport: ModelTransport, paths: { codex: string; claude: string }, staticChecks?: CliStaticChecks): CliLook => ({
  transport, locate: command => (command === 'codex' ? paths.codex : paths.claude), codex: null, claudeTerms: 'accepted', now: () => '2026-11-15T10:00:00.000Z', platform: process.platform,
  ...(staticChecks ? { staticChecks } : {}),
});

test('a look at Codex reads its two help pages together, after its version answered', async t => {
  const paths = await programs(t);
  const fake = tool(CODEX);
  const looking = inspectInstalledCli('codex', lookOf(fake.transport, paths));
  await until(() => fake.seen.length > 0, () => 'the look started nothing');
  // The version first, alone: a program that does not name itself as the real tool is asked nothing more.
  assert.deepEqual(fake.seen, ['--version']);
  await fake.answer('--version');
  await until(() => fake.seen.length >= 3, () => `only ${fake.seen.join(' | ')} started`);
  assert.deepEqual(fake.seen, ['--version', 'exec --help', '--help'], 'both help pages are started before either answered');
  assert.deepEqual([...fake.waiting.keys()], ['exec --help', '--help']);
  await fake.answer('--help');
  assert.deepEqual(fake.seen.length, 3, 'the sign-in status waits for the flags too');
  await fake.answer('exec --help');
  await fake.answer('login status');
  const finding = await looking;
  assert.deepEqual([finding.answered, finding.version, finding.flags, finding.signedIn, finding.statusCommand], [true, '0.154.0', 'match', 'yes', true]);
});

test('a program that does not answer its version check as the real tool is still asked nothing more', async t => {
  const paths = await programs(t);
  const fake = tool({ ...CODEX, '--version': 'something else 1.0' });
  const looking = inspectInstalledCli('codex', lookOf(fake.transport, paths));
  await fake.answer('--version');
  const finding = await looking;
  assert.equal(finding.answered, false);
  assert.deepEqual(fake.seen, ['--version']);
});

test('one engine run asks an unchanged program for its version and help once: a later fresh look starts only the sign-in status', async t => {
  const paths = await programs(t);
  const answers = { ...CODEX };
  const fake = tool(answers);
  const look = lookOf(fake.transport, paths, new Map());
  const run = async (expected: string[]) => {
    const from = fake.seen.length;
    const looking = inspectInstalledCli('codex', look);
    for (const asked of expected) await fake.answer(asked);
    const finding = await looking;
    assert.deepEqual(fake.seen.slice(from).sort(), [...expected].sort());
    return finding;
  };
  const first = await run(['--version', '--help', 'exec --help', 'login status']);
  // The same program file: its version and its help cannot have changed. The sign-in can, so it is asked again.
  answers['login status'] = 'Not logged in';
  const second = await run(['login status']);
  assert.deepEqual([second.answered, second.version, second.flags, second.missingFlags, second.statusCommand, second.ran], [true, first.version, 'match', [], true, true]);
  assert.equal(second.signedIn, 'no', 'the sign-in is read afresh every time');
  // A look given no memory of this engine run (another engine, or the engine started again) asks everything.
  const other = tool(CODEX);
  const elsewhere = inspectInstalledCli('codex', lookOf(other.transport, paths));
  await other.answer('--version');
  await until(() => other.seen.length >= 3, () => `only ${other.seen.join(' | ')} started`);
  assert.deepEqual(other.seen, ['--version', 'exec --help', '--help']);
  await other.answer('exec --help'); await other.answer('--help'); await other.answer('login status');
  await elsewhere;
  // The program file changed (an update): everything is asked again.
  await writeFile(paths.codex, 'stand-in codex, updated');
  answers['--version'] = 'codex-cli 0.154.1';
  const third = await run(['--version', '--help', 'exec --help', 'login status']);
  assert.equal(third.version, '0.154.1');
});

test('a look that could not read the help is not kept: the next one asks again', async t => {
  const paths = await programs(t);
  const answers: Record<string, string> = { '--version': CODEX['--version'] };
  const fake = tool(answers);
  const look = lookOf(fake.transport, paths, new Map());
  const first = inspectInstalledCli('codex', look);
  await fake.answer('--version'); await fake.answer('exec --help'); await fake.answer('--help');
  assert.equal((await first).flags, 'unknown');
  Object.assign(answers, CODEX);
  const second = inspectInstalledCli('codex', look);
  await fake.answer('--version'); await fake.answer('exec --help'); await fake.answer('--help'); await fake.answer('login status');
  assert.equal((await second).flags, 'match');
});

test('a setup with two tools checks them together, and is still refused when either fails', async () => {
  const note: AiSetupNote = {
    format: 'chausar.ai-setup.v1', from: { workspaceId: 'ws_1', name: 'Pune Handmade Pottery' }, at: '2026-11-15T10:00:00.000Z',
    connections: (['codex-cli', 'claude-code-cli'] as const).map(presetId => ({ presetId, routeKind: presetId === 'codex-cli' ? 'codex-cli' as const : 'claude-cli' as const, model: null, tiers: ['main' as const], consentDigest: presetSpec(presetId).consentDigest, consentedAt: '2026-11-14T10:00:00.000Z' })),
    models: { codex: { quick: { model: 'gpt-6-luna', effort: 'low' }, main: { model: 'gpt-6-luna', effort: 'medium' } }, claude: { quick: { model: 'claude-haiku-5-5', effort: 'low' }, main: { model: 'claude-sonnet-5-5', effort: 'medium' } } },
  };
  const port = { read: async () => note, write: async () => undefined, clear: async () => undefined };
  const checking: string[] = [];
  const release = new Map<string, (error?: Error) => void>();
  const deps = (fail?: string) => ({
    host: 'desktop', claudeCodeTerms: 'accepted',
    models: {
      checkCli: (presetId: string) => new Promise<void>((resolve, reject) => { checking.push(presetId); release.set(presetId, error => (error ? reject(error) : resolve())); }),
      presets: () => [{ id: 'codex-cli', availability: 'ready' }, { id: 'claude-code-cli', availability: 'ready' }],
    },
    fail,
  }) as never;
  const asked = reusableSetup(deps(), port);
  await settle();
  assert.deepEqual(checking, ['codex-cli', 'claude-code-cli'], 'the second tool\'s check starts before the first answered');
  release.get('claude-code-cli')!(); release.get('codex-cli')!();
  assert.deepEqual((await asked)!.connections.map(item => item.presetId), ['codex-cli', 'claude-code-cli']);
  // One of them fails its check: the setup is not reused, as before.
  checking.length = 0;
  const refused = reusableSetup(deps(), port);
  await settle();
  release.get('codex-cli')!(); release.get('claude-code-cli')!(new Error('signed out'));
  assert.equal(await refused, null);
});

test('a program\'s digest is worked out once while the file stays the same, and again when it changes or a minute has passed', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'chausar-digest-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const program = join(folder, 'codex');
  await writeFile(program, 'one');
  // settled: the file's own clock is read that much later, so a file changed just now counts as settled.
  let read = 0, clock = 1_000_000, settled = 0;
  const digest = () => digestOfUnchanged(program, async () => { read += 1; return `digest-${read}`; }, () => clock, () => Date.now() + settled);
  // A file written a moment ago is read every time: a system's file times are coarse (about 15 ms on Windows), so a
  // second write of the same size in that moment would leave the file looking unchanged (seen on Windows CI, 18 Nov 2026).
  assert.equal(await digest(), 'digest-1');
  assert.equal(await digest(), 'digest-2', 'a file written just now is not kept');
  // An installed program: written long ago, and looked at once it has settled.
  const installed = new Date(Date.now() - 120_000);
  await utimes(program, installed, installed);
  settled = DIGEST_SETTLE_MS;
  assert.equal(await digest(), 'digest-3');
  assert.equal(await digest(), 'digest-3');
  assert.equal(read, 3, 'the unchanged file is not read again');
  // The same bytes count, written again: the file changed, so it is read again, and every time until it settles.
  await writeFile(program, 'two');
  settled = 0;
  assert.equal(await digest(), 'digest-4');
  assert.equal(await digest(), 'digest-5', 'still just written: read again');
  const then = new Date(Date.now() - 60_000);
  await utimes(program, then, then);
  settled = DIGEST_SETTLE_MS;
  assert.equal(await digest(), 'digest-6', 'a time set back by hand is a change too');
  assert.equal(await digest(), 'digest-6');
  // A minute on, the file is read again even when nothing about it changed.
  clock += DIGEST_REUSE_MS;
  assert.equal(await digest(), 'digest-7');
  // A file that cannot be looked at is read every time (the reader then refuses it itself).
  const missing = join(folder, 'gone');
  let asked = 0;
  for (let i = 0; i < 2; i += 1) await digestOfUnchanged(missing, async () => { asked += 1; return 'x'; }, () => clock);
  assert.equal(asked, 2);
  // A reader that fails is not remembered.
  await assert.rejects(digestOfUnchanged(join(folder, 'other'), async () => { throw new Error('unreadable'); }));
});

test('ending a tool\'s tree on Windows does not block the engine: taskkill runs in the background, with a limit', async () => {
  const started: { command: string; args: string[]; options: Record<string, unknown> }[] = [];
  const killers: (EventEmitter & { kill: () => boolean; unref: () => void; killed: boolean })[] = [];
  const start = ((command: string, args: string[], options: Record<string, unknown>) => {
    started.push({ command, args, options });
    const killer = Object.assign(new EventEmitter(), { killed: false, kill() { killer.killed = true; return true; }, unref() { /* nothing */ } });
    killers.push(killer);
    return killer;
  }) as never;
  let after = 0;
  const begun = Date.now();
  killTree(4242, 'win32', () => { after += 1; }, start);
  assert.ok(Date.now() - begun < 500, 'it returns at once');
  assert.equal(started.length, 1);
  assert.match(started[0]!.command, /taskkill\.exe$/);
  assert.deepEqual(started[0]!.args, ['/PID', '4242', '/T', '/F']);
  assert.equal(started[0]!.options.shell, false);
  assert.equal(after, 0, 'what follows waits until the tree is ended');
  killers[0]!.emit('exit', 0);
  killers[0]!.emit('exit', 0);
  assert.equal(after, 1, 'and runs once');
  // A taskkill that cannot start still lets what follows run, and nothing throws.
  killTree(4243, 'win32', () => { after += 1; }, (() => { throw new Error('no taskkill'); }) as never);
  assert.equal(after, 2);
  killTree(4244, 'win32', () => { after += 1; }, start);
  killers.at(-1)!.emit('error', new Error('spawn failed'));
  assert.equal(after, 3);
  // No process, no start.
  killTree(undefined, 'win32', () => { after += 1; }, start);
  killTree(-5, 'win32', () => { after += 1; }, start);
  assert.equal(started.length, 2);
  assert.equal(after, 5);
});
