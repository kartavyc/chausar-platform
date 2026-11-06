// D4 task 6: the look at Claude Code and Codex is kept between starts (custody/cli-looks.json). On the first status
// look after a start, a kept look of the same program (path, size and modified time as on disk now, the same Codex the
// owner chose) taken under a day ago answers at once, marked kept, with sign-in unknown (A2: "Signed in" only on the
// tool's own word); a real look runs in the background and replaces it. A connection always looks fresh. The file holds
// only the finding's fields and the program's stamp, and the hosted web server never reads or writes it. Every tool
// here is a fake: the programs are small files written by the test, and nothing is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { TrustService } from '../runtime/trust.ts';
import { CODEX_CLI_CONFIG, CODEX_CLI_FLAGS, CODEX_QUIET_ARGS } from '../runtime/providers/codex-cli.ts';
import type {
  CliFinding, CliStatusList, ModelHttpRequest, ModelTask, ModelPort, ModelPortOptions, ModelProcessRequest, ModelProcessResponse, ModelTransport, SecretName, SecretShelf,
  VentureDeps, VentureEngineServices, VentureHostKind,
} from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import * as modelsPackage from '../runtime/venture/models/index.ts';
import { PRESETS, createModelPort, handlers } from '../runtime/venture/models/index.ts';
import { cliRouteFlags } from '../runtime/venture/models/cli.ts';
import { CLI_LOOKS_FILE, KEPT_LOOK_MAX_AGE_MS, cliLookFile, cliLookPath, readKeptLooks, keepable, type CliLookPort, type KeptLooks } from '../runtime/venture/models/cli-look-file.ts';
import { VentureHost, type VenturePackageModule } from '../runtime/venture/host.ts';
import { VentureTestStore } from './venture-test-store.ts';

// The looks make their temp folders in a folder of this file's own, so another file's leftover checks never see them.
const OWN_TEMP = mkdtempSync(join(tmpdir(), 'chausar-d4-cli-look-'));
process.env.TMPDIR = OWN_TEMP;
process.env.TEMP = OWN_TEMP;
process.env.TMP = OWN_TEMP;
test.after(() => rmSync(OWN_TEMP, { recursive: true, force: true }));

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const START = Date.parse('2026-11-05T09:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const isClaude = (command: string) => /(?:^|[\\/])claude(?:\.exe)?$/i.test(command);
const isCodex = (command: string) => /(?:^|[\\/])codex(?:\.exe)?$/i.test(command);
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };

class MemoryShelf implements SecretShelf {
  #values = new Map<string, string>();
  get(name: SecretName) { return this.#values.get(name) ?? null; }
  set(name: SecretName, value: string) { this.#values.set(name, value); }
  delete(name: SecretName) { this.#values.delete(name); }
  has(name: SecretName) { return this.#values.has(name); }
  clear() { this.#values.clear(); }
}

function helpText(flags: readonly string[], commands: readonly string[] = []): string {
  return ['Usage: tool [options] [command]', '', 'Options:', ...flags.map(flag => `  ${flag} <value>    Synthetic help line.`),
    '', 'Commands:', ...commands.map(name => `  ${name}    Synthetic command.`), ''].join('\n');
}
// What a status command printed: shaped like an account line, which must never reach the file.
const PRINTED_EMAIL = 'owner@aroma.example';
const CLAUDE_HELP = helpText(cliRouteFlags('claude-cli'), ['auth', 'mcp']);
const CODEX_HELP = helpText(['--version', '--help'], ['exec', 'login']);
const CODEX_EXEC_HELP = helpText(cliRouteFlags('codex-cli'));

/** One computer's tools: real files for the programs (only stat reads them), a fake process transport that counts. */
function computer() {
  const bin = mkdtempSync(join(OWN_TEMP, 'bin-'));
  const vault = mkdtempSync(join(OWN_TEMP, 'vault-'));
  const claude = join(bin, 'claude.exe'), codex = join(bin, 'codex.exe'), otherCodex = join(bin, 'other', 'codex.exe');
  mkdirSync(join(bin, 'other'));
  for (const program of [claude, codex, otherCodex]) writeFileSync(program, 'synthetic program');
  const spawns: ModelProcessRequest[] = [];
  let gate: Promise<void> = Promise.resolve();
  let open: () => void = () => undefined;
  let model: (request: ModelProcessRequest) => ModelProcessResponse = () => ({ exitCode: 1, stdout: '' });
  const transport: ModelTransport = {
    replay: false,
    async http(_request: ModelHttpRequest) { throw new Error('No provider is called in these tests.'); },
    async process(request: ModelProcessRequest): Promise<ModelProcessResponse> {
      spawns.push(structuredClone(request));
      await gate;
      const given = request.args[0] === '--disable' ? request.args.slice(CODEX_QUIET_ARGS.length) : request.args;
      const asked = given.join(' ');
      const claudeTool = isClaude(request.command);
      if (!claudeTool && !isCodex(request.command)) throw new ChausarError('CLI_UNAVAILABLE', 'Not installed.');
      if (asked === '--version') return { exitCode: 0, stdout: claudeTool ? '2.3.1 (Claude Code)\n' : 'codex-cli 0.166.0\n' };
      if (asked === '--help') return { exitCode: 0, stdout: claudeTool ? CLAUDE_HELP : CODEX_HELP };
      if (asked === 'exec --help') return { exitCode: 0, stdout: CODEX_EXEC_HELP };
      if (asked === 'auth status') return { exitCode: 0, stdout: JSON.stringify({ loggedIn: true, email: PRINTED_EMAIL }) };
      if (asked === 'login status') return { exitCode: 0, stdout: `Logged in using ChatGPT - ${PRINTED_EMAIL}` };
      return model(request);
    },
  };
  return {
    bin, vault, claude, codex, otherCodex, spawns, transport, file: cliLookPath(vault),
    /** What a model call (anything but a check) answers. */
    answerModel(answer: typeof model) { model = answer; },
    /** From now on every spawn waits until the returned function is called. */
    hold() { gate = new Promise(resolve => { open = resolve; }); return () => open(); },
  };
}

function codexProfile(executable: string) {
  return {
    capabilities: {
      evidence: { kind: 'installed-help', executable, version: '0.166.0', helpDigest: 'a'.repeat(64) },
      flags: [...CODEX_CLI_FLAGS], configKeys: CODEX_CLI_CONFIG.map(value => value.split('=')[0]), stdinPrompt: true, sandboxModes: ['read-only'],
    },
    mode: 'local-cli',
  };
}

type Pc = ReturnType<typeof computer>;
/** The file with every write recorded, so a test can wait for the background writes. */
function tracked(path: string) {
  const real = cliLookFile(path), writes: Promise<void>[] = [];
  let reads = 0;
  const port: CliLookPort = { read: () => { reads += 1; return real.read(); }, write: looks => { const done = real.write(looks); writes.push(done); return done; } };
  // The port writes after the answer, one write after another: settled once no new write has begun for a few ticks.
  const settled = async () => {
    for (let quiet = 0, seen = -1; quiet < 5; seen = writes.length) {
      await Promise.all(writes);
      await new Promise(resolve => setTimeout(resolve, 10));
      quiet = writes.length === seen ? quiet + 1 : 0;
    }
  };
  return { port, settled, counts: () => ({ reads, writes: writes.length }) };
}

/** One start of the engine on this computer: a new port on the same file. */
async function start(pc: Pc, options: { at?: number; codexProgram?: string; host?: VentureHostKind; cliLooks?: CliLookPort | null } = {}) {
  let now = options.at ?? START;
  const clock = () => new Date(now);
  const store = new VentureTestStore();
  const host = options.host ?? 'desktop';
  const file = tracked(pc.file);
  const locateCli = (command: string): string | null => (isClaude(command) ? pc.claude : isCodex(command) ? (command.includes('other') ? pc.otherCodex : pc.codex) : null);
  const port = createModelPort({
    store, clock, transport: pc.transport, secrets: new MemoryShelf(), host, demo: false, locateCli, claudeCodeTerms: 'accepted',
    codexCli: codexProfile(options.codexProgram ?? pc.codex),
    ...(options.cliLooks === null ? {} : { cliLooks: options.cliLooks ?? file.port }),
  } as ModelPortOptions);
  const deps = {
    store, clock, models: port, services: { trust: new TrustService(store), calculator: {}, ontology: {} }, github: {}, secrets: new MemoryShelf(),
    host, demo: false, storage: 'experimental-file', claudeCodeTerms: 'accepted',
  } as unknown as VentureDeps;
  await ventureAction(deps, owner, 'admin', 'create', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Monthly bookkeeping for cafes', ideaDigest: 'synthetic', workingName: 'Ledger Cafe Books',
    country: { code: 'IN', name: 'India', currency: 'INR', minorDigits: 2 } as any, serviceType: 'bookkeeping', status: 'interview', launchStage: 'rehearsal',
    blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  }), { create: true });
  return { port, deps, store, file, advance: (ms: number) => { now += ms; } };
}

const status = (deps: VentureDeps, payload: Record<string, unknown> = {}): Promise<CliStatusList> => (handlers as any)['venture.models.cli.status'](deps, owner, payload);
type Words = { words: string };
const wordsTask = (): ModelTask<Words> => ({
  purpose: 'interview', instructions: 'Write one short question in plain words.', input: { idea: 'Monthly bookkeeping for cafes' }, schemaName: 'test-words',
  schema: { type: 'object', additionalProperties: false, required: ['words'], properties: { words: { type: 'string', description: 'Plain words only.' } } },
  validate: raw => raw as Words, containsClientData: false, maxOutputTokens: 1024,
});
const kept = (finding: CliFinding) => (finding as CliFinding & { kept?: true }).kept === true;

/** A first start that looks for real and leaves the file behind. */
async function firstStart(pc: Pc, options: { at?: number; codexProgram?: string } = {}) {
  const first = await start(pc, options);
  await status(first.deps);
  await first.file.settled();
  return first;
}

test('second start: the status answers from the kept look before any tool answers, sign-in unknown, then the background look replaces it', { timeout: 20_000 }, async () => {
  const pc = computer();
  await firstStart(pc);
  assert.equal(pc.spawns.length, 7, 'the first start looked at both tools for real');
  const onDisk = readKeptLooks(JSON.parse(readFileSync(pc.file, 'utf8')));
  assert.deepEqual(Object.keys(onDisk).sort(), ['claude-code', 'codex']);

  pc.spawns.length = 0;
  const release = pc.hold();
  const second = await start(pc, { at: START + 2 * HOUR });
  const claude = await second.port.inspectCli!('claude-code');
  // Answered while every spawn is held: it never waited for the tool.
  assert.equal(kept(claude), true);
  assert.equal(claude.signedIn, 'unknown', 'a kept look never says signed in on its own word');
  assert.equal(claude.version, '2.3.1');
  assert.equal(claude.flags, 'match');
  assert.equal(claude.at, new Date(START).toISOString(), 'at is when the tool was really looked at');
  assert.equal(pc.spawns.filter(request => request.args.at(-1) === '--version').length <= 1, true, 'at most the background look has begun');
  const codex = await second.port.inspectCli!('codex');
  assert.equal(kept(codex), true);
  assert.equal(codex.signedIn, 'unknown');

  // The background looks land: the next ask answers the fresh finding, signed in on the tool's own word.
  release();
  await second.file.settled();
  for (let tries = 0; tries < 50 && pc.spawns.length < 7; tries += 1) await new Promise(resolve => setTimeout(resolve, 10));
  await new Promise(resolve => setTimeout(resolve, 20));
  const fresh = await second.port.inspectCli!('claude-code');
  assert.equal(kept(fresh), false);
  assert.equal(fresh.signedIn, 'yes');
  assert.equal(fresh.at, new Date(START + 2 * HOUR).toISOString());
  assert.equal(pc.spawns.length, 7, 'one background look per tool, each run once');
});

test('the status list answers a kept look at once and keeps no check record for it', { timeout: 20_000 }, async () => {
  const pc = computer();
  await firstStart(pc);
  const release = pc.hold();
  const second = await start(pc, { at: START + HOUR });
  const answered = await status(second.deps);
  assert.deepEqual(answered.clis.map(view => [view.cli, view.found, view.version, view.signedIn]), [['claude-code', true, '2.3.1', 'unknown'], ['codex', true, '0.166.0', 'unknown']]);
  assert.equal(listRecords(second.store.read(), 'venture-cli-check').length, 0, 'a kept look is not a new check');
  release();
  await second.file.settled();
});

test('each change looks again at once: a changed program, a day-old file, another Codex, a connection', { timeout: 20_000 }, async () => {
  // The program changed size (an update).
  {
    const pc = computer();
    await firstStart(pc);
    writeFileSync(pc.claude, 'synthetic program, updated');
    const second = await start(pc, { at: START + HOUR });
    pc.spawns.length = 0;
    const finding = await second.port.inspectCli!('claude-code');
    assert.equal(kept(finding), false);
    assert.equal(finding.signedIn, 'yes');
    assert.ok(pc.spawns.length > 0);
    await second.file.settled();
  }
  // The program has the same size but another modified time.
  {
    const pc = computer();
    await firstStart(pc);
    utimesSync(pc.claude, new Date(START - 5 * HOUR), new Date(START - 5 * HOUR));
    const second = await start(pc, { at: START + HOUR });
    assert.equal(kept(await second.port.inspectCli!('claude-code')), false);
    await second.file.settled();
  }
  // The kept look is 25 hours old.
  {
    const pc = computer();
    await firstStart(pc);
    const second = await start(pc, { at: START + 25 * HOUR });
    assert.equal(KEPT_LOOK_MAX_AGE_MS, 24 * HOUR);
    assert.equal(kept(await second.port.inspectCli!('claude-code')), false);
    await second.file.settled();
  }
  // The owner chose another Codex program since.
  {
    const pc = computer();
    await firstStart(pc);
    const second = await start(pc, { at: START + HOUR, codexProgram: pc.otherCodex });
    const finding = await second.port.inspectCli!('codex');
    assert.equal(kept(finding), false);
    assert.equal(finding.path, pc.otherCodex);
    await second.file.settled();
  }
  // A connection (fresh) never uses a kept look, even as the first ask.
  {
    const pc = computer();
    await firstStart(pc);
    const second = await start(pc, { at: START + HOUR });
    assert.equal(kept(await second.port.inspectCli!('claude-code', { fresh: true })), false);
    await second.port.checkCli('claude-code-cli');
    await second.file.settled();
  }
});

test('the file holds only the finding fields and the program stamp; a damaged or extended file keeps nothing', { timeout: 20_000 }, async () => {
  const pc = computer();
  await firstStart(pc);
  const text = readFileSync(pc.file, 'utf8');
  assert.equal(text.includes(PRINTED_EMAIL), false, 'no account line');
  assert.equal(/Logged in|loggedIn|Usage:/.test(text), false, 'no tool output');
  const raw = JSON.parse(text);
  assert.deepEqual(Object.keys(raw).sort(), ['looks', 'version']);
  for (const entry of Object.values(raw.looks) as any[]) {
    assert.deepEqual(Object.keys(entry).sort(), ['command', 'finding', 'mtimeMs', 'size']);
    assert.deepEqual(Object.keys(entry.finding).sort(), ['answered', 'at', 'cli', 'flags', 'found', 'missingFlags', 'path', 'profile', 'ran', 'replay', 'signedIn', 'statusCommand', 'version']);
  }
  assert.deepEqual(readKeptLooks({ ...raw, extra: 1 }), {});
  assert.deepEqual(readKeptLooks({ version: 1, looks: { 'claude-code': { ...raw.looks['claude-code'], said: 'printed text' } } }), {});
  assert.deepEqual(readKeptLooks({ version: 1, looks: { 'claude-code': { ...raw.looks['claude-code'], finding: { ...raw.looks['claude-code'].finding, account: PRINTED_EMAIL } } } }), {});
  assert.deepEqual(readKeptLooks({ version: 1, looks: { other: raw.looks.codex } }), {});
  assert.deepEqual(readKeptLooks('not json at all'), {});
  // A damaged file on disk: the next start looks for real.
  writeFileSync(pc.file, '{"version":1,"looks":');
  const second = await start(pc, { at: START + HOUR });
  assert.equal(kept(await second.port.inspectCli!('claude-code')), false);
  await second.file.settled();
  assert.equal(CLI_LOOKS_FILE, 'cli-looks.json');
  assert.equal(cliLookPath(pc.vault), join(pc.vault, 'custody', 'cli-looks.json'));
});

test('a real call refused for its flags is written to the file, so the next start answers the mismatch', { timeout: 20_000 }, async () => {
  const pc = computer();
  const first = await firstStart(pc);
  const preset = PRESETS.find(item => item.id === 'claude-code-cli')!;
  await (handlers as any)['venture.models.connect'](first.deps, owner, { presetId: preset.id, consentDigest: preset.consentDigest });
  await first.file.settled();
  // The tool refuses a flag the route sends on a real call (models/port.ts refuseFlags).
  pc.answerModel(() => ({ exitCode: 1, stdout: '', stderr: "error: unknown option '--max-turns'\n" }));
  await assert.rejects(first.port.generate(owner, wordsTask()), code('CLI_FLAGS_UNSUPPORTED'));
  await first.file.settled();
  const second = await start(pc, { at: START + HOUR });
  const finding = await second.port.inspectCli!('claude-code');
  assert.equal(kept(finding), true);
  assert.equal(finding.flags, 'mismatch');
  assert.deepEqual(finding.missingFlags, ['--max-turns']);
  await second.file.settled();
});

test('the hosted web server never reads or writes the file, and the host passes it only on this computer', { timeout: 20_000 }, async () => {
  const pc = computer();
  const file = tracked(pc.file);
  const hosted = await start(pc, { host: 'hosted-web', cliLooks: file.port });
  await assert.rejects(hosted.port.inspectCli!('claude-code'), code('TIER_UNAVAILABLE'));
  assert.deepEqual(file.counts(), { reads: 0, writes: 0 });

  const services = {
    calculator: { calculate: async () => { throw new Error('not used'); }, receipt: () => { throw new Error('not used'); } },
    ontology: { current: () => null, publish: async () => { throw new Error('not used'); } },
    trust: { updatePolicy: async () => { throw new Error('not used'); } },
  } as unknown as VentureEngineServices;
  for (const kind of ['desktop', 'hosted-web'] as const) {
    const given: (CliLookPort | undefined)[] = [];
    const hostFile = tracked(join(pc.vault, kind, CLI_LOOKS_FILE));
    const models: VenturePackageModule = {
      ...(modelsPackage as unknown as VenturePackageModule),
      createModelPort: (options: ModelPortOptions): ModelPort => {
        given.push((options as ModelPortOptions & { cliLooks?: CliLookPort }).cliLooks);
        return createModelPort({ ...options, locateCli: () => null });
      },
    };
    const empty = async () => ({ handlers: {} });
    const loaders = { core: empty, models: async () => models, money: empty, build: empty, delivery: empty, views: empty, agents: empty, chief: empty, network: empty, notify: empty, playbooks: empty };
    const host = new VentureHost(new VentureTestStore(), services, {
      demo: false, storage: 'experimental-file', host: kind, modelTransport: pc.transport, clock: () => new Date(START), cliLooks: hostFile.port,
    } as any, loaders);
    await host.request(owner, 'venture.models.cli.status', {}).catch(() => undefined);
    await hostFile.settled();
    assert.equal(given.length, 1);
    assert.equal(given[0], kind === 'desktop' ? hostFile.port : undefined, kind);
    if (kind === 'hosted-web') assert.deepEqual(hostFile.counts(), { reads: 0, writes: 0 });
    else assert.equal(hostFile.counts().reads, 1, 'the desktop port read it once');
  }
});

test('a replayed transport keeps nothing and answers nothing kept', { timeout: 20_000 }, async () => {
  const pc = computer();
  const writes: KeptLooks[] = [];
  const port: CliLookPort = { read: async () => null, write: async looks => { writes.push(looks); } };
  const replay = { ...pc.transport, replay: true };
  const model = createModelPort({
    store: new VentureTestStore(), clock: () => new Date(START), transport: replay, secrets: new MemoryShelf(), host: 'desktop', demo: false,
    locateCli: () => pc.claude, claudeCodeTerms: 'accepted', cliLooks: port,
  } as ModelPortOptions);
  const finding = await model.inspectCli!('claude-code');
  assert.equal(kept(finding), false);
  assert.equal(finding.replay, true);
  assert.deepEqual(writes.flatMap(looks => Object.keys(looks)), []);
});

// D4 task 6, the status view: a kept look says so and says when it was really taken, for the row's "Last checked" line.
test('the status view carries kept and checkedAt only from a kept finding', async () => {
  const { cliStatusView } = await import('../runtime/venture/models/cli-status.ts');
  const finding = { cli: 'codex', at: '2026-11-06T08:00:00.000Z', found: true, path: 'C:/tools/codex.exe', answered: true, version: '0.166.0', flags: 'match', missingFlags: [], signedIn: 'unknown', statusCommand: null, profile: null, replay: false } as any;
  const fresh = cliStatusView(finding, { claudeTerms: undefined, lastTask: null });
  assert.equal(fresh.kept, undefined); assert.equal(fresh.checkedAt, undefined);
  const kept = cliStatusView({ ...finding, kept: true }, { claudeTerms: undefined, lastTask: null });
  assert.equal(kept.kept, true); assert.equal(kept.checkedAt, '2026-11-06T08:00:00.000Z');
  assert.equal(kept.signedIn, 'unknown');
});


test('cleanup: an npm shim is never kept because the shim stamp cannot detect a changed target', () => {
  assert.equal(keepable({ found: true, answered: true, replay: false, path: 'synthetic.cmd', via: 'npm-shim' } as CliFinding), false);
});

test('cleanup: the cache never writes a sign-in verdict', async () => {
  const host = computer(), file = cliLookFile(host.file);
  const finding = { cli: 'codex', found: true, answered: true, replay: false, path: host.codex, signedIn: 'yes' } as CliFinding;
  await file.write({ codex: { command: host.codex, size: 10, mtimeMs: 0, finding } });
  const saved = JSON.parse(readFileSync(host.file, 'utf8'));
  assert.equal(saved.looks.codex.finding.signedIn, 'unknown');
  assert.equal(finding.signedIn, 'yes', 'the live answer remains unchanged');
});
