// Ink v2 wave 4 (4H1) tests: the owner's own Claude Code and Codex, checked against what is installed on this computer
// (venture.models.cli.status). The status comes from evidence only: the path on the search path, the first version
// number --version prints, the flags --help lists against the flags the route sends, and the sign-in only from a status
// command the tool's own help lists. A flag the tool does not know refuses the connection; the hosted app lists no CLI;
// a CLI is "ready" only once a real task worked. Text-only calls (H39) run with tools off, no MCP servers, no session
// kept, an empty folder, the prompt on stdin and a time limit. Every process here is a fake: nothing is installed or run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { TrustService } from '../runtime/trust.ts';
import { CODEX_CLI_CONFIG, CODEX_CLI_FLAGS } from '../runtime/providers/codex-cli.ts';
import type {
  CliStatusList, DelegateProcessRequest, ModelHttpRequest, ModelPort, ModelPortOptions, ModelProcessRequest, ModelProcessResponse, ModelTask, ModelTransport,
  SecretName, SecretShelf, VentureDeps, VentureEngineServices, VentureHostKind,
} from '../runtime/venture/contracts.ts';
import { houseStyleFindings, listRecords, ventureAction } from '../runtime/venture/records.ts';
import * as modelsPackage from '../runtime/venture/models/index.ts';
import { PRESETS, createModelPort, handlers } from '../runtime/venture/models/index.ts';
import { CLI_UNLISTED_FLAGS, TEMP_PREFIX, claudePlan, cliRouteFlags } from '../runtime/venture/models/cli.ts';
import { AVAILABILITY_REASONS } from '../runtime/venture/models/presets.ts';
import { CODEX_NPM_ENTRY, resolveNpmShim } from '../runtime/venture/models/npm-shim.ts';
import { CLI_LOOK_PREFIX, cliListLine, cliStatusView, homePath, inspectInstalledCli } from '../runtime/venture/models/cli-status.ts';
import { cliGateOpen, cliVersionOf, locateOnThisComputer } from '../runtime/venture/models/cli-look.ts';
import { delegateAvailability } from '../runtime/venture/delivery/harness/delegate.ts';
import { createDelegatePorts } from '../runtime/venture/delivery/harness/delegate-process.ts';
import { VentureHost, type VenturePackageModule } from '../runtime/venture/host.ts';
import { VentureTestStore } from './venture-test-store.ts';

// This file's command-line calls make their temp folders in a folder of its own, so the leftover checks of
// venture-models.test.ts, which node --test runs beside it in another process, never count them.
const OWN_TEMP = mkdtempSync(join(tmpdir(), 'chausar-4h1-cli-status-'));
process.env.TMPDIR = OWN_TEMP;
process.env.TEMP = OWN_TEMP;
process.env.TMP = OWN_TEMP;
test.after(() => rmSync(OWN_TEMP, { recursive: true, force: true }));

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const START = Date.parse('2026-10-23T09:00:00.000Z');
const BIN = join(tmpdir(), 'chausar-cli-status-bin');
// Where the search path has each tool: an absolute .exe, the only kind of program a look starts on Windows.
const CLAUDE_EXE = join(BIN, 'claude.exe');
const CODEX_EXE = join(BIN, 'codex.exe');
const isClaude = (command: string) => /(?:^|[\\/])claude(?:\.exe)?$/i.test(command);
const isCodex = (command: string) => /(?:^|[\\/])codex(?:\.exe)?$/i.test(command);
const code = (expected: string, message?: string) => (error: any) => {
  assert.equal(error?.code, expected, error?.message);
  if (message !== undefined) assert.equal(error.message, message);
  return true;
};
// Shaped like secrets a status command may print, built at run time so no file holds one.
const PRINTED_TOKEN = 'sk-ant-' + 'oat01-' + 'Q'.repeat(24);
const PRINTED_KEY = 'sk-' + 'proj-' + '***' + 'W'.repeat(5);
const PRINTED_EMAIL = 'owner@aroma.example';

class MemoryShelf implements SecretShelf {
  #values = new Map<string, string>();
  get(name: SecretName) { return this.#values.get(name) ?? null; }
  set(name: SecretName, value: string) { this.#values.set(name, value); }
  delete(name: SecretName) { this.#values.delete(name); }
  has(name: SecretName) { return this.#values.has(name); }
  clear() { this.#values.clear(); }
}

/** A help page that lists these flags and commands, the way a command-line tool prints one. */
function helpText(flags: readonly string[], commands: readonly string[] = []): string {
  return [
    'Usage: tool [options] [command]', '', 'Options:', ...flags.map(flag => `  ${flag} <value>    Synthetic help line.`),
    '', 'Commands:', ...commands.map(name => `  ${name}    Synthetic command.`), '',
  ].join('\n');
}

/** What one installed tool answers. null: it does not start (version) or answers nothing (help). */
type Tool = { version: string | null; help?: string | null; execHelp?: string | null; status?: ModelProcessResponse | 'throws' };

const CLAUDE_FLAGS = cliRouteFlags('claude-cli');
const CODEX_FLAGS = cliRouteFlags('codex-cli');
const CLAUDE_OK: Tool = {
  version: '2.3.1 (Claude Code)', help: helpText(CLAUDE_FLAGS, ['auth', 'mcp', 'update']),
  status: { exitCode: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: PRINTED_EMAIL, token: PRINTED_TOKEN }) },
};
const CODEX_OK: Tool = {
  version: 'codex-cli 0.154.0', help: helpText(['--version', '--help'], ['exec', 'login', 'logout']), execHelp: helpText(CODEX_FLAGS),
  status: { exitCode: 0, stdout: `Logged in using an API key - ${PRINTED_KEY}` },
};

type FakeTools = {
  transport: ModelTransport; seen: ModelProcessRequest[]; model: (request: ModelProcessRequest) => ModelProcessResponse | Promise<ModelProcessResponse>;
  /** Each check's working folder and what was in it while the check ran. */
  folders: { cwd: string | undefined; entries: string[] | null }[];
};

/** A fake process transport: each tool answers its check commands; any other run is model work (fake.model). */
function fakeTools(tools: { claude?: Tool; codex?: Tool }): FakeTools {
  const fake: FakeTools = {
    seen: [], folders: [],
    model: () => ({ exitCode: 1, stdout: '' }),
    transport: {
      replay: false,
      async http(_request: ModelHttpRequest) { throw new Error('No provider is called in these tests.'); },
      async process(request: ModelProcessRequest): Promise<ModelProcessResponse> {
        fake.seen.push(structuredClone(request));
        if (request.purpose === 'version-check') fake.folders.push({ cwd: request.cwd, entries: request.cwd && existsSync(request.cwd) ? readdirSync(request.cwd) : null });
        // An npm-installed Codex runs as node with its entry script first (models/npm-shim.ts); the rest is what Codex is asked.
        const viaNode = /(?:^|[\\/])node(?:\.exe)?$/i.test(request.command) && /[\\/]codex\.js$/.test(request.args[0] ?? '');
        const tool = isClaude(request.command) ? tools.claude : isCodex(request.command) || viaNode ? tools.codex : undefined;
        const notStarted = () => new ChausarError('CLI_UNAVAILABLE', 'The selected official command is not installed or could not start.');
        if (!tool) throw notStarted();
        const asked = (viaNode ? request.args.slice(1) : request.args).join(' ');
        if (asked === '--version') {
          if (tool.version === null) throw notStarted();
          return { exitCode: 0, stdout: `${tool.version}\n` };
        }
        if (asked === '--help') return tool.help ? { exitCode: 0, stdout: tool.help } : { exitCode: 1, stdout: '' };
        if (asked === 'exec --help') return tool.execHelp ? { exitCode: 0, stdout: tool.execHelp } : { exitCode: 1, stdout: '' };
        if (asked === 'auth status' || asked === 'login status') {
          if (!tool.status || tool.status === 'throws') throw new ChausarError('MODEL_TIMEOUT', 'The installed model command timed out.');
          return tool.status;
        }
        return fake.model(request);
      },
    },
  };
  return fake;
}

function codexProfile(executable: string) {
  return {
    capabilities: {
      evidence: { kind: 'installed-help', executable, version: '0.154.0', helpDigest: 'a'.repeat(64) },
      flags: [...CODEX_CLI_FLAGS], configKeys: CODEX_CLI_CONFIG.map(value => value.split('=')[0]), stdinPrompt: true, sandboxModes: ['read-only'],
    },
    mode: 'local-cli',
  };
}

const unused = new Proxy({}, { get() { throw new Error('This service is not used by these tests.'); } });

type Options = {
  tools?: { claude?: Tool; codex?: Tool }; host?: VentureHostKind; codexCli?: unknown; claudeCodeTerms?: 'accepted' | 'pending'; venture?: boolean;
  /** Where the search path has each tool, by name ('claude', 'codex', 'node'), instead of BIN. */
  paths?: { claude?: string; codex?: string; node?: string };
};

async function setup(options: Options = {}) {
  const tools = options.tools ?? {};
  const claudeCodeTerms = options.claudeCodeTerms ?? 'accepted';
  const host = options.host ?? 'desktop';
  let now = START;
  const clock = () => new Date(now);
  const store = new VentureTestStore();
  const secrets = new MemoryShelf();
  const fake = fakeTools(tools);
  // The search path holds a tool only when the test installed it; an absolute command is found where it says.
  const locateCli = (command: string): string | null => {
    if (isClaude(command)) return tools.claude ? (isAbsolute(command) ? command : options.paths?.claude ?? CLAUDE_EXE) : null;
    if (isCodex(command)) return tools.codex ? (isAbsolute(command) ? command : options.paths?.codex ?? CODEX_EXE) : null;
    if (command === 'node') return options.paths?.node ?? null;
    return null;
  };
  const port = createModelPort({ store, clock, transport: fake.transport, secrets, host, demo: false, codexCli: options.codexCli, claudeCodeTerms, locateCli });
  const deps = {
    store, clock, models: port, services: { trust: new TrustService(store), calculator: unused, ontology: unused }, github: unused, secrets,
    host, demo: false, storage: 'experimental-file', claudeCodeTerms,
  } as unknown as VentureDeps;
  if (options.venture !== false) {
    await ventureAction(deps, owner, 'admin', 'create', tx => tx.put({
      ...tx.base('venture-record'), idea: 'Monthly bookkeeping for cafes and small shops', ideaDigest: 'synthetic', workingName: 'Ledger Cafe Books',
      country: { code: 'IN', name: 'India', currency: 'INR', minorDigits: 2 } as any, serviceType: 'bookkeeping', status: 'interview', launchStage: 'rehearsal',
      blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
    }), { create: true });
  }
  return { store, deps, port, fake, advance: (ms: number) => { now += ms; } };
}

const call = (deps: VentureDeps, method: string, payload: Record<string, unknown> = {}): Promise<any> => (handlers as any)[method](deps, owner, payload);
const status = (deps: VentureDeps, payload: Record<string, unknown> = {}): Promise<CliStatusList> => call(deps, 'venture.models.cli.status', payload);
const preset = (id: string) => PRESETS.find(item => item.id === id)!;
const connect = (deps: VentureDeps, presetId: string) => call(deps, 'venture.models.connect', { presetId, consentDigest: preset(presetId).consentDigest });
const connections = (store: VentureTestStore) => listRecords(store.read(), 'venture-model-connection') as any[];

type Words = { words: string };
function wordsTask(overrides: Partial<ModelTask<Words>> = {}): ModelTask<Words> {
  return {
    purpose: 'interview', instructions: 'Write one short question in plain words.', input: { idea: 'Monthly bookkeeping for cafes' }, schemaName: 'test-words',
    schema: { type: 'object', additionalProperties: false, required: ['words'], properties: { words: { type: 'string', description: 'Plain words only.' } } },
    validate: raw => raw as Words, containsClientData: false, maxOutputTokens: 1024, ...overrides,
  };
}
const claudeAnswer = (words: string): ModelProcessResponse => ({
  exitCode: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { words }, usage: { input_tokens: 10, output_tokens: 5 } }),
});

const ENV_NAMES = /^(PATH|Path|SystemRoot|WINDIR|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|CODEX_HOME|CLAUDE_CODE_[A-Z_]+|MAX_STRUCTURED_OUTPUT_RETRIES|FALLBACK_FOR_ALL_PRIMARY_MODELS|DISABLE_[A-Z_]+|DO_NOT_TRACK|[A-Z_]*TELEMETRY[A-Z_]*|OTEL_[A-Z_]+)$/;

// ---------------------------------------------------------------------------
// 1. What is installed, from evidence
// ---------------------------------------------------------------------------

test('desktop: Claude Code and Codex each with path, version, flags, sign-in, terms, last task, one line and one fix', async () => {
  const { deps, fake, store } = await setup({ tools: { claude: CLAUDE_OK, codex: CODEX_OK } });
  const result = await status(deps);
  assert.deepEqual(result.clis.map(item => item.cli), ['claude-code', 'codex']);
  const [claude, codex] = result.clis;
  assert.deepEqual(claude, {
    cli: 'claude-code', label: 'Claude Code', found: true, path: homePath(CLAUDE_EXE), version: '2.3.1', flags: 'match', missingFlags: [], signedIn: 'yes',
    terms: 'accepted', lastTask: null, state: 'unverified', line: 'Claude Code 2.3.1 is on this computer and signed in. Not yet tried on a real task.', fix: null,
  });
  // Codex without the reviewed host profile: found and checked, but Chausar's Codex route does not run it.
  assert.deepEqual(codex, {
    cli: 'codex', label: 'Codex', found: true, path: homePath(CODEX_EXE), version: '0.154.0', flags: 'match', missingFlags: [], signedIn: 'yes',
    terms: 'not-needed', lastTask: null, state: 'needs-setup', line: 'Codex 0.154.0 is on this computer. Chausar runs it only through the reviewed Codex setup.',
    fix: AVAILABILITY_REASONS.codexMissing,
  });
  assert.equal(result.line, 'Chausar ran only the version, help and sign-in commands of Claude Code and Codex on this computer. It never reads their sign-in files or keys.');

  // Only check commands ran, each on the program the search path has (never a bare name): argument arrays, a time
  // limit each, nothing on standard input, no key in the environment.
  assert.deepEqual(fake.seen.map(request => [request.command, request.args.join(' '), request.timeoutMs]), [
    [CLAUDE_EXE, '--version', 10000], [CLAUDE_EXE, '--help', 5000], [CLAUDE_EXE, 'auth status', 5000],
    [CODEX_EXE, '--version', 10000], [CODEX_EXE, 'exec --help', 5000], [CODEX_EXE, '--help', 5000], [CODEX_EXE, 'login status', 5000],
  ]);
  for (const request of fake.seen) {
    assert.equal(request.purpose, 'version-check');
    assert.equal(request.stdin, '');
    for (const name of Object.keys(request.env)) assert.match(name, ENV_NAMES);
  }
  // Each look runs its checks in an empty folder made for it (never the shared temp folder), removed afterwards.
  const cwds = fake.folders.map(item => item.cwd!);
  assert.equal(new Set(cwds.slice(0, 3)).size, 1, "one folder for Claude Code's checks");
  assert.equal(new Set(cwds.slice(3)).size, 1, "one for Codex's");
  assert.notEqual(cwds[0], cwds[3]);
  for (const { cwd, entries } of fake.folders) {
    assert.ok(cwd && isAbsolute(cwd) && cwd !== tmpdir() && basename(cwd).startsWith(CLI_LOOK_PREFIX), String(cwd));
    assert.deepEqual(entries, [], 'empty while the check runs');
    assert.equal(existsSync(cwd), false, 'and removed afterwards');
  }
  // What a status command printed is read for its fixed phrase and dropped: no address, token or key is kept or returned.
  for (const text of [JSON.stringify(result), JSON.stringify(store.read())]) {
    for (const secret of [PRINTED_EMAIL, PRINTED_TOKEN, PRINTED_KEY]) assert.equal(text.includes(secret), false, secret);
  }
  // Each finding is kept as a check record, written again only when it changes.
  const checks = listRecords(store.read(), 'venture-cli-check') as any[];
  assert.deepEqual(checks.map(item => [item.cli, item.found, item.version, item.flags, item.signedIn]), [['claude-code', true, '2.3.1', 'match', 'yes'], ['codex', true, '0.154.0', 'match', 'yes']]);
  await status(deps);
  assert.equal(listRecords(store.read(), 'venture-cli-check').length, 2);
  for (const view of result.clis) assert.deepEqual([...houseStyleFindings(view.line), ...houseStyleFindings(view.fix ?? '')], []);
});

test('Codex with the reviewed host profile: its own executable is checked, and it waits for a real task', async () => {
  const executable = CODEX_EXE;
  const { deps, fake } = await setup({ tools: { codex: CODEX_OK }, codexCli: codexProfile(executable) });
  const [claude, codex] = (await status(deps)).clis;
  assert.equal(claude.found, false);
  assert.equal(codex.state, 'unverified');
  assert.equal(codex.line, 'Codex 0.154.0 is on this computer and signed in. Not yet tried on a real task.');
  assert.equal(codex.path, homePath(executable));
  assert.ok(fake.seen.filter(request => /codex$/.test(request.command)).every(request => request.command === executable));
});

// ---------------------------------------------------------------------------
// 2. Flags against the route
// ---------------------------------------------------------------------------

test('flags: --help must list every flag the route sends; a missing one is a mismatch and refuses the connection', async () => {
  // The flags are the route's own: whatever cliArguments and buildCodexCliArguments send.
  for (const flag of ['--print', '--tools', '--disallowedTools', '--strict-mcp-config', '--mcp-config', '--no-session-persistence', '--output-format', '--model', '--max-turns', '--json-schema', '--system-prompt']) {
    assert.ok(CLAUDE_FLAGS.includes(flag), flag);
  }
  const sent = claudePlan('claude-sonnet-5-5', wordsTask()).args.filter(arg => /^--[A-Za-z]/.test(arg));
  assert.deepEqual([...new Set(sent)].sort(), [...CLAUDE_FLAGS].sort());
  assert.deepEqual([...CODEX_FLAGS].sort(), [...CODEX_CLI_FLAGS].sort());

  const oldClaude: Tool = { ...CLAUDE_OK, help: helpText(CLAUDE_FLAGS.filter(flag => flag !== '--safe-mode'), ['auth']) };
  const { deps, store } = await setup({ tools: { claude: oldClaude } });
  const [claude] = (await status(deps)).clis;
  assert.equal(claude.flags, 'mismatch');
  assert.deepEqual(claude.missingFlags, ['--safe-mode']);
  assert.equal(claude.state, 'needs-setup');
  assert.equal(claude.line, "Your Claude Code 2.3.1 doesn't know --safe-mode.");
  assert.equal(claude.fix, 'Update it, or use an Anthropic key.');
  await assert.rejects(connect(deps, 'claude-code-cli'), code('CLI_FLAGS_UNSUPPORTED', "Your Claude Code 2.3.1 doesn't know --safe-mode. Update it, or use an Anthropic key."));
  assert.equal(connections(store).length, 0);
  const listed = deps.models.presets().find(item => item.id === 'claude-code-cli')!;
  assert.equal(listed.availability, 'needs-setup');
  assert.equal(listed.availabilityReason, "Your Claude Code 2.3.1 doesn't know --safe-mode. Update it, or use an Anthropic key.");

  const older = await setup({ tools: { claude: { ...CLAUDE_OK, help: helpText(CLAUDE_FLAGS.filter(flag => flag !== '--safe-mode' && flag !== '--restricted' && flag !== '--no-chrome')) } } });
  const [three] = (await status(older.deps)).clis;
  assert.equal(three.line, "Your Claude Code 2.3.1 doesn't know --restricted, --safe-mode and --no-chrome.");

  // Codex through its reviewed profile, with an older exec that lacks a flag.
  const executable = CODEX_EXE;
  const codexOld: Tool = { ...CODEX_OK, execHelp: helpText(CODEX_FLAGS.filter(flag => flag !== '--ephemeral')) };
  const withCodex = await setup({ tools: { codex: codexOld }, codexCli: codexProfile(executable) });
  const [, codex] = (await status(withCodex.deps)).clis;
  assert.deepEqual([codex.flags, codex.missingFlags, codex.line, codex.fix], ['mismatch', ['--ephemeral'], "Your Codex 0.154.0 doesn't know --ephemeral.", 'Update it, or use an OpenAI key.']);
  await assert.rejects(connect(withCodex.deps, 'codex-cli'), code('CLI_FLAGS_UNSUPPORTED', "Your Codex 0.154.0 doesn't know --ephemeral. Update it, or use an OpenAI key."));
  assert.equal(connections(withCodex.store).length, 0);
});

test('flags: a flag the tool accepts without listing it (--max-turns for Claude Code) is not required in the help; every other one is', async () => {
  assert.deepEqual(CLI_UNLISTED_FLAGS['claude-cli'], ['--max-turns']);
  assert.deepEqual(CLI_UNLISTED_FLAGS['codex-cli'], []);
  assert.ok(CLAUDE_FLAGS.includes('--max-turns'), 'the route still sends it');
  const quiet = await setup({ tools: { claude: { ...CLAUDE_OK, help: helpText(CLAUDE_FLAGS.filter(flag => flag !== '--max-turns'), ['auth']) } } });
  const [claude] = (await status(quiet.deps)).clis;
  assert.deepEqual([claude.flags, claude.missingFlags], ['match', []]);
  const short = await setup({ tools: { claude: { ...CLAUDE_OK, help: helpText(CLAUDE_FLAGS.filter(flag => flag !== '--max-turns' && flag !== '--json-schema'), ['auth']) } } });
  const [missing] = (await status(short.deps)).clis;
  assert.deepEqual([missing.flags, missing.missingFlags], ['mismatch', ['--json-schema']]);
});

// The real help pages, captured read-only on 23 Oct 2026 from the founder's computer (Claude Code 2.1.286, Codex CLI
// 0.154.0) with `claude --help`, `codex --help` and `codex exec --help`. Nothing personal was in them; the two em dashes
// in Claude Code's option descriptions were made hyphens (house style). No flag or command line was changed.
const realHelp = (name: string) => readFileSync(new URL(`./fixtures/venture/models/cli-help/${name}`, import.meta.url), 'utf8');

test('the real Claude Code 2.1.286 help: every flag the route sends matches, and its auth command is listed', async () => {
  const help = realHelp('claude-code-2.1.286-help.txt');
  for (const flag of ['--restricted', '--safe-mode', '--no-chrome', '--disable-slash-commands', '--no-session-persistence', '--json-schema', '--tools', '--strict-mcp-config', '--system-prompt']) {
    assert.ok(help.includes(flag), flag);
  }
  assert.equal(help.includes('--max-turns'), false, 'the real help does not list --max-turns');
  const { deps, fake } = await setup({ tools: { claude: { ...CLAUDE_OK, version: '2.1.286 (Claude Code)', help } } });
  const [claude] = (await status(deps)).clis;
  assert.deepEqual([claude.version, claude.flags, claude.missingFlags, claude.signedIn], ['2.1.286', 'match', [], 'yes']);
  assert.ok(fake.seen.some(request => request.args.join(' ') === 'auth status'), 'its help lists auth, so its own sign-in status command is asked');
  await connect(deps, 'claude-code-cli');
});

test('the real Codex 0.154.0 help: exec lists every flag the route sends, and the top help lists login', async () => {
  const codexReal: Tool = { ...CODEX_OK, help: realHelp('codex-cli-0.154.0-help.txt'), execHelp: realHelp('codex-cli-0.154.0-exec-help.txt') };
  const { deps, fake } = await setup({ tools: { codex: codexReal }, codexCli: codexProfile(CODEX_EXE) });
  const [, codex] = (await status(deps)).clis;
  assert.deepEqual([codex.version, codex.flags, codex.missingFlags, codex.signedIn, codex.state], ['0.154.0', 'match', [], 'yes', 'unverified']);
  assert.ok(fake.seen.some(request => request.args.join(' ') === 'login status'));
  await connect(deps, 'codex-cli');
});

test('flags: a help page that does not answer leaves the flags unknown, says so, and does not refuse', async () => {
  const { deps, store } = await setup({ tools: { claude: { ...CLAUDE_OK, help: null } } });
  const [claude] = (await status(deps)).clis;
  assert.deepEqual([claude.flags, claude.missingFlags, claude.signedIn], ['unknown', [], 'unknown']);
  assert.equal(claude.line, "Claude Code 2.3.1 is on this computer. Chausar couldn't read its help, so its flags are not checked. Chausar can't check your sign-in without running a task. It will say so if the first task fails.");
  await connect(deps, 'claude-code-cli');
  assert.equal(connections(store).filter(item => item.status === 'connected').length, 1);
});

// ---------------------------------------------------------------------------
// 3. Signed in only with evidence
// ---------------------------------------------------------------------------

test('sign-in: no status command in the help means unknown, with the words that say why; nothing else is run', async () => {
  const { deps, fake } = await setup({ tools: { claude: { ...CLAUDE_OK, help: helpText(CLAUDE_FLAGS, ['mcp', 'update']) } } });
  const [claude] = (await status(deps)).clis;
  assert.equal(claude.signedIn, 'unknown');
  assert.equal(claude.state, 'unverified');
  assert.equal(claude.line, "Claude Code 2.3.1 is on this computer. Chausar can't check your sign-in without running a task. It will say so if the first task fails.");
  assert.equal(fake.seen.some(request => request.args[0] === 'auth'), false);
});

test('sign-in: never "yes" without the success phrase and a clean exit; "not logged in" is no and refuses the connection', async () => {
  const cases: [ModelProcessResponse | 'throws', 'yes' | 'no' | 'unknown'][] = [
    [{ exitCode: 0, stdout: JSON.stringify({ loggedIn: true }) }, 'yes'],
    [{ exitCode: 0, stdout: 'Logged in as the owner.' }, 'yes'],
    [{ exitCode: 1, stdout: 'Not logged in. Run claude to sign in.' }, 'no'],
    [{ exitCode: 0, stdout: JSON.stringify({ loggedIn: false }) }, 'no'],
    [{ exitCode: 0, stdout: 'Welcome to Claude Code!' }, 'unknown'],
    [{ exitCode: 1, stdout: JSON.stringify({ loggedIn: true }) }, 'unknown'],
    [{ exitCode: 0, stdout: '' }, 'unknown'],
    ['throws', 'unknown'],
  ];
  for (const [answer, expected] of cases) {
    const { deps } = await setup({ tools: { claude: { ...CLAUDE_OK, status: answer } } });
    const [claude] = (await status(deps)).clis;
    assert.equal(claude.signedIn, expected, JSON.stringify(answer));
  }
  const { deps, store } = await setup({ tools: { claude: { ...CLAUDE_OK, status: { exitCode: 1, stdout: 'Not logged in.' } } } });
  const [claude] = (await status(deps)).clis;
  assert.deepEqual([claude.state, claude.line, claude.fix], ['needs-setup', 'Claude Code 2.3.1 is on this computer but not signed in.', 'Open a terminal, run claude and sign in, then check again.']);
  await assert.rejects(connect(deps, 'claude-code-cli'), code('CLI_UNAVAILABLE', 'Claude Code 2.3.1 is on this computer but not signed in. Open a terminal, run claude and sign in, then check again.'));
  assert.equal(connections(store).length, 0);

  const codexOut = await setup({ tools: { codex: { ...CODEX_OK, status: { exitCode: 1, stdout: 'Not logged in' } } }, codexCli: codexProfile(CODEX_EXE) });
  const [, codex] = (await status(codexOut.deps)).clis;
  assert.deepEqual([codex.signedIn, codex.fix], ['no', 'Open a terminal, run codex login, then check again.']);
});

// ---------------------------------------------------------------------------
// 4. Not installed, the hosted app, the terms gate, unverified until a real task works
// ---------------------------------------------------------------------------

test('not installed: found false with the plain line and fix; nothing is run, not even by its bare name', async () => {
  const { deps, fake } = await setup({ tools: {} });
  const [claude, codex] = (await status(deps)).clis;
  assert.deepEqual(claude, {
    cli: 'claude-code', label: 'Claude Code', found: false, path: null, version: null, flags: 'unknown', missingFlags: [], signedIn: 'unknown',
    terms: 'accepted', lastTask: null, state: 'needs-setup', line: "Claude Code isn't installed on this computer.", fix: 'Install Claude Code and sign in to it, then check again.',
  });
  assert.deepEqual([codex.found, codex.line, codex.fix], [false, "Codex isn't installed on this computer.", 'Install Codex and sign in to it, then check again.']);
  assert.deepEqual(fake.seen, []);
  assert.equal((await status(deps)).line, "Chausar didn't run either tool on this computer.");
  await assert.rejects(connect(deps, 'claude-code-cli'), code('CLI_UNAVAILABLE'));
});

// 4H2 review: the line of what ran, per tool; the home folder as ~; the Codex fix in plain steps.
test('the line of what ran names each tool that ran and only the commands it ran; a located tool is left out', () => {
  const finding = (cli: 'claude-code' | 'codex', fields: Record<string, unknown>) => ({
    cli, at: new Date(START).toISOString(), found: true, path: cli === 'codex' ? CODEX_EXE : CLAUDE_EXE, answered: true, version: '1.0.0', flags: 'match' as const,
    missingFlags: [], signedIn: 'unknown' as const, statusCommand: false, profile: true, replay: false, ran: true, ...fields,
  });
  assert.equal(cliListLine([finding('claude-code', {}), finding('codex', { statusCommand: true })]),
    'Chausar ran only the version, help and sign-in commands of Claude Code and Codex on this computer. It never reads their sign-in files or keys.');
  assert.equal(cliListLine([finding('claude-code', {}), finding('codex', {})]),
    'Chausar ran only the version and help commands of Claude Code and Codex on this computer. It never reads their sign-in files or keys.');
  // Started but silent still ran; located only (the terms gate, a command script), or a synthetic recording, did not.
  assert.equal(cliListLine([finding('claude-code', { ran: false, answered: false }), finding('codex', { answered: false, version: null })]),
    'Chausar ran only the version and help commands of Codex on this computer. It never reads its sign-in files or keys.');
  assert.equal(cliListLine([finding('claude-code', { ran: false }), finding('codex', { ran: false, replay: true })]), "Chausar didn't run either tool on this computer.");
});

test('a path in the home folder is shown from ~, nothing else about it changes', () => {
  const home = homedir();
  const inHome = join(home, '.local', 'bin', 'claude.exe');
  const view = (path: string | null) => cliStatusView({
    cli: 'claude-code', at: new Date(START).toISOString(), found: path !== null, path, answered: true, version: '2.3.1', flags: 'match', missingFlags: [],
    signedIn: 'yes', statusCommand: true, profile: true, replay: false,
  }, { claudeTerms: 'accepted', lastTask: null });
  assert.equal(view(inHome).path, join('~', '.local', 'bin', 'claude.exe'));
  assert.equal(view(CLAUDE_EXE).path, CLAUDE_EXE.startsWith(home) ? CLAUDE_EXE.replace(home, '~') : CLAUDE_EXE);
  assert.equal(view(`${home}-other${join('/', 'claude.exe')}`).path, `${home}-other${join('/', 'claude.exe')}`, 'only the home folder itself');
  assert.equal(view(null).path, null);
});

test('the Codex fix without the reviewed setup is a plain step, not a document', () => {
  assert.equal(AVAILABILITY_REASONS.codexMissing, "Chausar's reviewed setup for Codex isn't on this computer yet. Use an OpenAI key for now.");
  assert.doesNotMatch(AVAILABILITY_REASONS.codexMissing, /docs\/|\.md/);
});

test('on the search path but not answering its version check: found, with the words that say so', async () => {
  const { deps } = await setup({ tools: { claude: { version: null } } });
  const [claude] = (await status(deps)).clis;
  assert.deepEqual([claude.found, claude.path, claude.version, claude.state], [true, homePath(CLAUDE_EXE), null, 'needs-setup']);
  assert.equal(claude.line, 'Claude Code is on this computer but did not answer its version check.');
  assert.equal(claude.fix, 'Update or reinstall Claude Code, then check again.');
  // A version line that is not the real tool's form is not an answer from it.
  const odd = await setup({ tools: { claude: { ...CLAUDE_OK, version: 'claude 2.3.1' } } });
  const [notClaude] = (await status(odd.deps)).clis;
  assert.deepEqual([notClaude.version, notClaude.line], [null, 'Claude Code is on this computer but did not answer its version check.']);
  assert.deepEqual(odd.fake.seen.map(request => request.args.join(' ')), ['--version'], 'nothing past the version check');
});

test('a command script (an npm .cmd shim on Windows) that does not start: the words say why, not "reinstall"', async () => {
  // As found on the founder's computer: Codex installed by npm is codex.cmd, which a program started without a shell cannot run.
  const { deps } = await setup({ tools: { claude: { version: null }, codex: { version: null } }, paths: { claude: join(BIN, 'claude.bat'), codex: join(BIN, 'codex.cmd') } });
  const [claude, codex] = (await status(deps)).clis;
  assert.deepEqual([codex.found, codex.version, codex.state], [true, null, 'needs-setup']);
  assert.equal(codex.line, "Codex is on this computer as a command script (codex.cmd), which Chausar doesn't start.");
  assert.equal(codex.fix, "Set Codex up through Chausar's reviewed Codex setup, which names the Codex program itself, or use an OpenAI key.");
  assert.equal(claude.line, "Claude Code is on this computer as a command script (claude.bat), which Chausar doesn't start.");
  assert.equal(claude.fix, 'Install Claude Code with its own installer, then check again, or use an Anthropic key.');
});

test('the hosted app: TIER_UNAVAILABLE in plain words, no CLI listed, nothing started', async () => {
  const { deps, fake } = await setup({ host: 'hosted-web', tools: { claude: CLAUDE_OK, codex: CODEX_OK } });
  await assert.rejects(status(deps), code('TIER_UNAVAILABLE', 'The hosted app uses keys only.'));
  assert.deepEqual(fake.seen, []);
  for (const id of ['claude-code-cli', 'codex-cli']) assert.equal(deps.models.presets().find(item => item.id === id)!.availability, 'unavailable');
});

test('the Claude Code terms gate: pending shows its words; Claude Code is only looked for, never run, as heavy work does', async () => {
  const { deps, fake, port } = await setup({ tools: { claude: CLAUDE_OK, codex: CODEX_OK }, claudeCodeTerms: 'pending' });
  const [claude, codex] = (await status(deps)).clis;
  assert.deepEqual([claude.found, claude.path, claude.version, claude.flags, claude.signedIn, claude.terms, claude.state], [true, homePath(CLAUDE_EXE), null, 'unknown', 'unknown', 'pending', 'needs-setup']);
  assert.equal(claude.line, "Chausar hasn't yet accepted Anthropic's terms for running Claude Code.");
  assert.equal(claude.fix, 'Use an Anthropic key for now.');
  assert.equal(fake.seen.some(request => isClaude(request.command)), false, 'nothing of Claude Code ran, not even --version');
  assert.equal(codex.version, '0.154.0', 'Codex is not behind the gate');
  // 4H2: the line of what ran names only Codex: Claude Code was located, never run.
  assert.equal((await status(deps)).line, 'Chausar ran only the version, help and sign-in commands of Codex on this computer. It never reads its sign-in files or keys.');
  // Not installed is still the terms words: installing it would not help yet.
  const absent = await setup({ tools: {}, claudeCodeTerms: 'pending' });
  assert.equal((await status(absent.deps)).clis[0].line, "Chausar hasn't yet accepted Anthropic's terms for running Claude Code.");
  // The port's own check refuses with the terms words and runs nothing either.
  await assert.rejects(port.checkCli('claude-code-cli'), code('PRESET_UNAVAILABLE', AVAILABILITY_REASONS.claudeTerms));
  assert.equal(fake.seen.some(request => isClaude(request.command)), false);
});

test('unverified until one real task works, then ready; the last task is shown, and a failure says so', async () => {
  const { deps, fake, advance } = await setup({ tools: { claude: CLAUDE_OK } });
  await connect(deps, 'claude-code-cli');
  assert.equal((await status(deps)).clis[0].state, 'unverified');
  assert.equal(deps.models.presets().find(item => item.id === 'claude-code-cli')!.availability, 'unverified');
  fake.model = () => claudeAnswer('Command line words');
  await deps.models.generate(owner, wordsTask());
  let [claude] = (await status(deps)).clis;
  assert.deepEqual([claude.state, claude.lastTask], ['ready', { at: new Date(START).toISOString(), outcome: 'succeeded' }]);
  assert.equal(claude.line, 'Claude Code 2.3.1 is on this computer and signed in. Its last task worked.');
  assert.equal(deps.models.presets().find(item => item.id === 'claude-code-cli')!.availability, 'ready');
  advance(60_000);
  fake.model = () => ({ exitCode: 1, stdout: '' });
  await assert.rejects(deps.models.generate(owner, wordsTask()), code('MODEL_FAILED'));
  [claude] = (await status(deps)).clis;
  assert.deepEqual([claude.state, claude.lastTask?.outcome], ['unverified', 'failed']);
  assert.equal(claude.line, 'Claude Code 2.3.1 is on this computer and signed in. Its last task failed.');
  assert.equal(claude.fix, "Check that you're signed in to Claude Code, then try again.");
});

// ---------------------------------------------------------------------------
// 5. Text-only calls on the owner's CLI (H39)
// ---------------------------------------------------------------------------

test('text-only calls: tools off, no MCP servers, no session kept, an empty folder, the prompt on stdin, a time limit', async () => {
  const { deps, fake } = await setup({ tools: { claude: CLAUDE_OK } });
  await connect(deps, 'claude-code-cli');
  let folderDuring: string[] | null = null;
  fake.model = request => {
    folderDuring = request.cwd && existsSync(request.cwd) ? readdirSync(request.cwd) : null;
    return claudeAnswer('Command line words');
  };
  const task = wordsTask();
  await deps.models.generate(owner, task);
  const request = fake.seen.at(-1)!;
  assert.equal(request.purpose, 'interview');
  assert.equal(request.args[request.args.indexOf('--tools') + 1], '');
  assert.ok(request.args.includes('--strict-mcp-config'));
  assert.equal(request.args[request.args.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
  assert.ok(request.args.includes('--no-session-persistence'));
  assert.equal(request.args[request.args.indexOf('--max-turns') + 1], '1');
  assert.equal(request.stdin, JSON.stringify(task.input));
  assert.equal(request.args.some(arg => arg.includes('Monthly bookkeeping')), false, 'the prompt goes on stdin, not in the arguments');
  assert.equal(request.timeoutMs, 150000);
  assert.ok(request.cwd && isAbsolute(request.cwd));
  assert.ok(basename(dirname(request.cwd!)).startsWith(TEMP_PREFIX), 'the working folder is made for this call');
  assert.deepEqual(folderDuring, [], 'the working folder is empty while the tool runs');
  assert.equal(existsSync(request.cwd!), false, 'and removed afterwards');
});

// ---------------------------------------------------------------------------
// 6. An npm-installed Codex on Windows: its shim resolved to what it runs, without a shell
// ---------------------------------------------------------------------------

// The real shims npm wrote for Codex 0.154.0 on the founder's computer (copied byte for byte; they name no personal path).
const REAL_CMD = readFileSync(new URL('./fixtures/venture/models/npm-shims/codex.cmd', import.meta.url), 'utf8');
const REAL_PS1 = readFileSync(new URL('./fixtures/venture/models/npm-shims/codex.ps1', import.meta.url), 'utf8');
const ENTRY = ['node_modules', '@openai', 'codex', 'bin', 'codex.js'];

/** An npm global folder with one shim in it, the package's entry script and, when asked, npm's own node.exe beside it. */
function npmFolder(shimName: string, shimText: string, options: { entry?: boolean; localNode?: boolean } = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'chausar-4h1-npm-'));
  if (options.entry !== false) {
    mkdirSync(join(folder, ...ENTRY.slice(0, -1)), { recursive: true });
    writeFileSync(join(folder, ...ENTRY), '// synthetic entry script\n');
  }
  if (options.localNode) writeFileSync(join(folder, 'node.exe'), '');
  const shim = join(folder, shimName);
  writeFileSync(shim, shimText);
  return { folder, shim, entry: join(folder, ...ENTRY) };
}

const resolveCodex = (shim: string, locate: (command: string) => string | null) => resolveNpmShim(shim, locate, CODEX_NPM_ENTRY, 'win32');

test('npm shim: the standard .cmd and .ps1 forms resolve to node and the entry script under their own node_modules', () => {
  const nodeOnPath = join(BIN, 'node.exe');
  const locate = (command: string) => (command === 'node' ? nodeOnPath : null);
  const cmd = npmFolder('codex.cmd', REAL_CMD);
  assert.deepEqual(resolveCodex(cmd.shim, locate), { program: nodeOnPath, script: cmd.entry });
  // npm's own node.exe beside the shim wins, as the shim itself would choose.
  const local = npmFolder('codex.cmd', REAL_CMD, { localNode: true });
  assert.deepEqual(resolveCodex(local.shim, locate), { program: join(local.folder, 'node.exe'), script: local.entry });
  const ps1 = npmFolder('codex.ps1', REAL_PS1);
  assert.deepEqual(resolveCodex(ps1.shim, locate), { program: nodeOnPath, script: ps1.entry });
  // Line endings do not matter; the words do.
  const lf = npmFolder('codex.cmd', REAL_CMD.replace(/\r\n/g, '\n'));
  assert.deepEqual(resolveCodex(lf.shim, locate), { program: nodeOnPath, script: lf.entry });
  // No node anywhere, or no entry script on disk: refused.
  assert.equal(resolveCodex(cmd.shim, () => null), null);
  assert.equal(resolveCodex(npmFolder('codex.cmd', REAL_CMD, { entry: false }).shim, locate), null);
});

test("npm shim: only Codex's own entry script is run; any other package, even in npm's standard form, is refused", () => {
  assert.deepEqual(CODEX_NPM_ENTRY, ['node_modules', '@openai', 'codex', 'bin', 'codex.js']);
  const locate = (command: string) => (command === 'node' ? join(BIN, 'node.exe') : null);
  const others = [['node_modules', 'evil', 'bin', 'evil.js'], ['node_modules', '@openai', 'codex', 'bin', 'other.js'], ['node_modules', '@openai', 'codex-tools', 'bin', 'codex.js']];
  for (const segments of others) {
    // A shim npm would write for that package, with the script on disk under the shim's own node_modules.
    const cmdText = REAL_CMD.replace('node_modules\\@openai\\codex\\bin\\codex.js', segments.join('\\'));
    const ps1Text = REAL_PS1.replaceAll('node_modules/@openai/codex/bin/codex.js', segments.join('/'));
    for (const [name, text] of [['codex.cmd', cmdText], ['codex.ps1', ps1Text]]) {
      const folder = npmFolder(name, text);
      mkdirSync(join(folder.folder, ...segments.slice(0, -1)), { recursive: true });
      writeFileSync(join(folder.folder, ...segments), '');
      assert.equal(resolveCodex(folder.shim, locate), null, `${name}: ${segments.join('/')}`);
    }
  }
});

test('npm shim: a link that leads the entry script out of the shim\'s own node_modules is refused', () => {
  const locate = (command: string) => (command === 'node' ? join(BIN, 'node.exe') : null);
  // Somewhere else on this computer, a folder shaped like the package.
  const outside = mkdtempSync(join(tmpdir(), 'chausar-4h1-outside-'));
  mkdirSync(join(outside, '@openai', 'codex', 'bin'), { recursive: true });
  writeFileSync(join(outside, '@openai', 'codex', 'bin', 'codex.js'), '// not the package npm installed\n');
  // The package folder is a junction to it.
  const packageLink = npmFolder('codex.cmd', REAL_CMD, { entry: false });
  mkdirSync(join(packageLink.folder, 'node_modules', '@openai'), { recursive: true });
  symlinkSync(join(outside, '@openai', 'codex'), join(packageLink.folder, 'node_modules', '@openai', 'codex'), 'junction');
  assert.ok(existsSync(packageLink.entry), 'the entry script is reachable through the link');
  assert.equal(resolveCodex(packageLink.shim, locate), null, 'a package folder that is a link out');
  // node_modules itself is a junction to it.
  const modulesLink = npmFolder('codex.cmd', REAL_CMD, { entry: false });
  symlinkSync(outside, join(modulesLink.folder, 'node_modules'), 'junction');
  assert.ok(existsSync(modulesLink.entry));
  assert.equal(resolveCodex(modulesLink.shim, locate), null, 'a node_modules that is a link out');
  // The same layout without links resolves, so it is the link that is refused.
  const plain = npmFolder('codex.cmd', REAL_CMD);
  assert.deepEqual(resolveCodex(plain.shim, locate), { program: join(BIN, 'node.exe'), script: plain.entry });
});

test('npm shim on Windows: node only as an absolute .exe, never a node script or a bare name', () => {
  const cmd = npmFolder('codex.cmd', REAL_CMD);
  for (const found of [join(BIN, 'node.cmd'), join(BIN, 'node.bat'), join(BIN, 'node'), 'node.exe']) {
    assert.equal(resolveCodex(cmd.shim, command => (command === 'node' ? found : null)), null, found);
  }
  // A file named node beside the shim (no .exe) is not run on Windows; the search path's node.exe is.
  writeFileSync(join(cmd.folder, 'node'), '');
  assert.deepEqual(resolveCodex(cmd.shim, command => (command === 'node' ? join(BIN, 'node.exe') : null)), { program: join(BIN, 'node.exe'), script: cmd.entry });
});

test('npm shim: anything but the standard form is refused (extra commands, & or % in the path, a script outside node_modules)', () => {
  const locate = (command: string) => (command === 'node' ? join(BIN, 'node.exe') : null);
  const entryPath = 'node_modules\\@openai\\codex\\bin\\codex.js';
  const swap = (path: string) => REAL_CMD.replace(entryPath, path);
  const hostile: [string, string][] = [
    ['an extra command after the shim', `${REAL_CMD}calc.exe\r\n`],
    ['an extra command before it', `@ECHO off\r\ncalc.exe\r\n${REAL_CMD.replace('@ECHO off\r\n', '')}`],
    ['a chained command in the run line', REAL_CMD.replace('%*', '%* & calc.exe')],
    ['& in the script path', swap('node_modules\\@openai\\codex\\bin\\codex.js" & calc & "x.js')],
    ['% in the script path', swap('node_modules\\%EVIL%\\codex.js')],
    ['a script outside node_modules', swap('..\\..\\evil.js')],
    ['climbing out of node_modules', swap('node_modules\\..\\..\\evil.js')],
    ['an absolute script path', swap('C:\\tools\\evil.js')],
    ['not a script', swap('node_modules\\@openai\\codex\\bin\\codex.exe')],
    ['a truncated shim', REAL_CMD.split('\r\n').slice(0, 8).join('\r\n')],
    ['an empty file', ''],
    ['a ps1 whose four script paths disagree', REAL_PS1.replace('"$basedir/node_modules/@openai/codex/bin/codex.js" $args', '"$basedir/node_modules/evil/bin/evil.js" $args')],
  ];
  for (const [why, text] of hostile) {
    const folder = npmFolder(why.includes('ps1') ? 'codex.ps1' : 'codex.cmd', text);
    mkdirSync(join(folder.folder, 'node_modules', 'evil', 'bin'), { recursive: true });
    writeFileSync(join(folder.folder, 'node_modules', 'evil', 'bin', 'evil.js'), '');
    assert.equal(resolveCodex(folder.shim, locate), null, why);
  }
  // Not a shim at all, and a shim far larger than npm writes.
  assert.equal(resolveCodex(join(BIN, 'codex.exe'), locate), null);
  assert.equal(resolveCodex(npmFolder('codex.cmd', REAL_CMD + ' '.repeat(20_000)).shim, locate), null);
});

test('npm-installed Codex: the status runs node with the entry script and an argument array, and says what Codex said', async () => {
  const npm = npmFolder('codex.cmd', REAL_CMD, { localNode: true });
  const codexReal: Tool = { ...CODEX_OK, help: realHelp('codex-cli-0.154.0-help.txt'), execHelp: realHelp('codex-cli-0.154.0-exec-help.txt') };
  const { deps, fake } = await setup({ tools: { codex: codexReal }, paths: { codex: npm.shim } });
  const [, codex] = (await status(deps)).clis;
  assert.deepEqual([codex.found, codex.path, codex.version, codex.flags, codex.signedIn], [true, homePath(npm.shim), '0.154.0', 'match', 'yes']);
  // Without the reviewed host profile the Codex route still does not run it, and the line says so.
  assert.equal(codex.state, 'needs-setup');
  assert.equal(codex.line, 'Codex 0.154.0 is on this computer. Chausar runs it only through the reviewed Codex setup.');
  assert.deepEqual(fake.seen.filter(request => request.command !== 'claude').map(request => [request.command, ...request.args]), [
    [join(npm.folder, 'node.exe'), npm.entry, '--version'], [join(npm.folder, 'node.exe'), npm.entry, 'exec', '--help'],
    [join(npm.folder, 'node.exe'), npm.entry, '--help'], [join(npm.folder, 'node.exe'), npm.entry, 'login', 'status'],
  ]);
  // A shim that is not the standard form is never run: the command-script words stay.
  const odd = npmFolder('codex.cmd', `${REAL_CMD}calc.exe\r\n`, { localNode: true });
  const refused = await setup({ tools: { codex: { version: null } }, paths: { codex: odd.shim } });
  const [, refusedCodex] = (await status(refused.deps)).clis;
  assert.equal(refusedCodex.line, "Codex is on this computer as a command script (codex.cmd), which Chausar doesn't start.");
  assert.equal(refused.fake.seen.some(request => /node(?:\.exe)?$/i.test(request.command)), false);
});

// ---------------------------------------------------------------------------
// 7. The review of 4H1: what a look starts, how often, what it writes, and one look shared with heavy work
// ---------------------------------------------------------------------------

test('a look starts only the program the search path has, never a bare name; on Windows only an absolute .exe', async () => {
  const fake = fakeTools({ claude: CLAUDE_OK });
  const look = { transport: fake.transport, codex: null, claudeTerms: 'accepted' as const, now: () => new Date(START).toISOString(), platform: 'win32' as const };
  // Not on the search path: nothing runs, so a claude.exe planted in a shared folder is never reached by its name.
  const missing = await inspectInstalledCli('claude-code', { ...look, locate: () => null });
  assert.deepEqual([missing.found, missing.answered, missing.path], [false, false, null]);
  // Found, but not a program Chausar starts without a shell: a script, a file with no extension, a relative path.
  for (const path of [join(BIN, 'claude.cmd'), join(BIN, 'claude.ps1'), join(BIN, 'claude'), join(BIN, 'claude.com'), 'claude.exe']) {
    const finding = await inspectInstalledCli('claude-code', { ...look, locate: () => path });
    assert.deepEqual([finding.found, finding.answered, finding.path], [true, false, path], path);
  }
  const started = () => fake.seen.map(request => request.command);
  assert.deepEqual(started(), [], 'nothing was started');
  const found = await inspectInstalledCli('claude-code', { ...look, locate: () => CLAUDE_EXE });
  assert.deepEqual([found.answered, found.version], [true, '2.3.1']);
  assert.deepEqual(started(), [CLAUDE_EXE, CLAUDE_EXE, CLAUDE_EXE]);
  // Each check ran in the one empty folder made for this look, which is gone now.
  assert.equal(new Set(fake.folders.map(item => item.cwd)).size, 1);
  assert.deepEqual(fake.folders.map(item => item.entries), [[], [], []]);
  assert.equal(existsSync(fake.folders[0].cwd!), false);
  assert.equal(basename(dirname(fake.folders[0].cwd!)), basename(tmpdir()));
});

test('the status look: one at a time per tool, reused for a minute; a connection always looks again', async () => {
  const { deps, fake, advance } = await setup({ tools: { claude: CLAUDE_OK } });
  const versions = () => fake.seen.filter(request => request.args.join(' ') === '--version').length;
  // Three screens asking at once share one look.
  const three = await Promise.all([status(deps), status(deps), status(deps)]);
  assert.equal(versions(), 1);
  assert.deepEqual(three[1].clis, three[0].clis);
  await status(deps);
  advance(59_000);
  await status(deps);
  assert.equal(versions(), 1, 'reused within the minute');
  advance(2_000);
  await status(deps);
  assert.equal(versions(), 2, 'looked again after it');
  await connect(deps, 'claude-code-cli');
  assert.equal(versions(), 3, 'connecting never trusts a cached look');
});

test('"Check again" ({ fresh: true }) always looks afresh, two presses share one look, and plain reads keep the minute of reuse', async () => {
  const { deps, fake } = await setup({ tools: { claude: CLAUDE_OK } });
  const versions = () => fake.seen.filter(request => request.args.join(' ') === '--version').length;
  await status(deps);
  assert.equal(versions(), 1);
  // The tool changed since: a fresh look sees it within the minute.
  const before = CLAUDE_OK.version;
  CLAUDE_OK.version = '2.4.0 (Claude Code)';
  try {
    assert.equal((await status(deps)).clis[0].version, '2.3.1', 'a plain read reuses the look');
    assert.equal((await status(deps, { fresh: true })).clis[0].version, '2.4.0');
  } finally { CLAUDE_OK.version = before; }
  assert.equal(versions(), 2);
  // Two presses at once share one look.
  await Promise.all([status(deps, { fresh: true }), status(deps, { fresh: true })]);
  assert.equal(versions(), 3);
  // A plain read right after reuses the fresh look; { fresh: false } is a plain read.
  await status(deps);
  await status(deps, { fresh: false });
  assert.equal(versions(), 3);
  await assert.rejects(status(deps, { fresh: 'yes' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(status(deps, { again: true }), code('INVALID_VENTURE_REQUEST'));
  assert.equal(versions(), 3, 'a refused request starts nothing');
});

test('check records: compared and written in one action, so two looks at once write each change once', async () => {
  const { deps, store } = await setup({ tools: { claude: CLAUDE_OK, codex: CODEX_OK } });
  await Promise.all([status(deps), status(deps), status(deps)]);
  const checks = listRecords(store.read(), 'venture-cli-check') as any[];
  assert.deepEqual(checks.map(item => item.cli), ['claude-code', 'codex']);
});

test('a real call that fails on a route flag the tool does not know marks its flags a mismatch, so it no longer reads usable', async () => {
  // Claude Code's help does not list --max-turns, so the help check does not ask for it (CLI_UNLISTED_FLAGS).
  const quiet: Tool = { ...CLAUDE_OK, help: helpText(CLAUDE_FLAGS.filter(flag => flag !== '--max-turns'), ['auth']) };
  const { deps, fake, store, advance } = await setup({ tools: { claude: quiet } });
  await connect(deps, 'claude-code-cli');
  assert.deepEqual([(await status(deps)).clis[0].flags, deps.models.presets().find(item => item.id === 'claude-code-cli')!.availability], ['match', 'unverified']);
  // An unknown option the route never sends changes nothing.
  fake.model = () => ({ exitCode: 1, stdout: '', stderr: "error: unknown option '--verbose-extra'" });
  await assert.rejects(deps.models.generate(owner, wordsTask()), code('MODEL_FAILED'));
  assert.equal((await status(deps)).clis[0].flags, 'match');
  // The tool refuses one the route sends: that call fails in those words, and the tool's flags are a mismatch now.
  fake.model = () => ({ exitCode: 1, stdout: '', stderr: "error: unknown option '--max-turns'\n" });
  const words = "Your Claude Code 2.3.1 doesn't know --max-turns. Update it, or use an Anthropic key.";
  await assert.rejects(deps.models.generate(owner, wordsTask()), code('CLI_FLAGS_UNSUPPORTED', words));
  assert.deepEqual((listRecords(store.read(), 'venture-model-call') as any[]).at(-1).error, { code: 'CLI_FLAGS_UNSUPPORTED', message: words });
  const [claude] = (await status(deps)).clis;
  assert.deepEqual([claude.flags, claude.missingFlags, claude.state, claude.line], ['mismatch', ['--max-turns'], 'needs-setup', "Your Claude Code 2.3.1 doesn't know --max-turns."]);
  const listed = deps.models.presets().find(item => item.id === 'claude-code-cli')!;
  assert.deepEqual([listed.availability, listed.availabilityReason], ['needs-setup', words]);
  assert.equal(deps.models.status(owner).tiers.main.usable, false);
  // The next call is refused before anything is sent, and a fresh look later still says so.
  const before = fake.seen.length;
  await assert.rejects(deps.models.generate(owner, wordsTask()), code('CLI_FLAGS_UNSUPPORTED', words));
  assert.equal(fake.seen.length, before, 'nothing was started');
  advance(61_000);
  assert.deepEqual((await status(deps)).clis[0].missingFlags, ['--max-turns']);
  await assert.rejects(connect(deps, 'claude-code-cli'), code('CLI_FLAGS_UNSUPPORTED', words));

  // Codex says it its own way (clap): the same rule.
  const withCodex = await setup({ tools: { codex: CODEX_OK }, codexCli: codexProfile(CODEX_EXE) });
  await connect(withCodex.deps, 'codex-cli');
  withCodex.fake.model = () => ({ exitCode: 2, stdout: '', stderr: "error: unexpected argument '--ephemeral' found\n\nUsage: codex exec [OPTIONS]" });
  await assert.rejects(withCodex.deps.models.generate(owner, wordsTask({ purpose: 'judge' })), code('CLI_FLAGS_UNSUPPORTED', "Your Codex 0.154.0 doesn't know --ephemeral. Update it, or use an OpenAI key."));
  assert.deepEqual((await status(withCodex.deps)).clis[1].missingFlags, ['--ephemeral']);
});

test('connect: the consent, key, model, tiers and limit are checked before the tool is looked at', async () => {
  const { deps, fake, store } = await setup({ tools: { claude: CLAUDE_OK } });
  const spec = preset('claude-code-cli');
  const refusals: [Record<string, unknown>, string][] = [
    [{ presetId: spec.id, consentDigest: 'not-the-digest' }, 'MODEL_CONSENT_REQUIRED'],
    [{ presetId: spec.id, consentDigest: spec.consentDigest, apiKey: 'sk-ant-' + 'test-not-a-real-key-0000' }, 'INVALID_VENTURE_REQUEST'],
    [{ presetId: spec.id, consentDigest: spec.consentDigest, model: 'claude-opus-6' }, 'INVALID_VENTURE_REQUEST'],
    [{ presetId: spec.id, consentDigest: spec.consentDigest, tiers: ['nightly'] }, 'INVALID_VENTURE_REQUEST'],
    [{ presetId: spec.id, consentDigest: spec.consentDigest, monthlyCapUsd: '0' }, 'INVALID_AMOUNT'],
  ];
  for (const [payload, expected] of refusals) await assert.rejects(call(deps, 'venture.models.connect', payload), code(expected));
  assert.deepEqual(fake.seen, [], 'no refused request started the tool');
  assert.equal(connections(store).length, 0);
  await connect(deps, 'claude-code-cli');
  assert.ok(fake.seen.length > 0);
});

test('one look shared with heavy work: the same program from the same search path, the same version rule, the same terms rule', async () => {
  // A search path folder with Claude Code's .exe and an npm .cmd beside it: both find the .exe.
  const dir = mkdtempSync(join(tmpdir(), 'chausar-4h1-look-'));
  writeFileSync(join(dir, 'claude.cmd'), '');
  writeFileSync(join(dir, 'claude.exe'), '');
  assert.equal(locateOnThisComputer('claude', { PATH: dir, PATHEXT: '.COM;.CMD;.EXE' }, 'win32'), join(dir, 'claude.exe'), 'PATHEXT does not change what is looked for');
  assert.equal(await createDelegatePorts({ pathEnv: dir, platform: 'win32' }).locate('claude-code'), join(dir, 'claude.exe'));
  // The version: only the real tool's own first line counts, for both.
  const versions: [Parameters<typeof cliVersionOf>[0], string, string | null][] = [
    ['claude-code', '2.1.286 (Claude Code)\n', '2.1.286'], ['claude-code', 'claude 2.1.286', null], ['claude-code', 'Welcome\n2.1.286 (Claude Code)', null],
    ['codex', 'codex-cli 0.154.0\n', '0.154.0'], ['codex', 'codex 0.154.0', null], ['codex', '2.1.286 (Claude Code)', null],
  ];
  for (const [cli, printed, expected] of versions) assert.equal(cliVersionOf(cli, printed), expected, printed);
  const answering = (stdout: string) => ({
    locate: async () => CLAUDE_EXE,
    process: async (_request: DelegateProcessRequest) => ({ exitCode: 0, stdout, stderr: '', timedOut: false, truncated: false }),
  });
  const look = (version: string) => inspectInstalledCli('claude-code', {
    transport: fakeTools({ claude: { ...CLAUDE_OK, version } }).transport, locate: () => CLAUDE_EXE, codex: null, claudeTerms: 'accepted', now: () => new Date(START).toISOString(),
  });
  for (const printed of ['2.3.1 (Claude Code)', 'claude 2.3.1']) {
    const delegated = await delegateAvailability(answering(`${printed}\n`), 'claude-code', 'accepted');
    const looked = await look(printed);
    assert.equal(delegated.version, looked.version, printed);
    assert.equal(delegated.state === 'needs-setup', !looked.answered, printed);
  }
  // The terms gate: pending runs nothing of Claude Code in either; Codex is not behind it.
  assert.deepEqual([cliGateOpen('claude-code', 'pending'), cliGateOpen('claude-code', undefined), cliGateOpen('claude-code', 'accepted'), cliGateOpen('codex', 'pending')], [false, false, true, true]);
  const started: string[] = [];
  const spy = { locate: async () => CLAUDE_EXE, process: async (request: DelegateProcessRequest) => { started.push(request.command); return { exitCode: 0, stdout: '', stderr: '', timedOut: false, truncated: false }; } };
  await delegateAvailability(spy, 'claude-code', 'pending');
  const fake = fakeTools({ claude: CLAUDE_OK });
  await inspectInstalledCli('claude-code', { transport: fake.transport, locate: () => CLAUDE_EXE, codex: null, claudeTerms: 'pending', now: () => new Date(START).toISOString() });
  assert.deepEqual([started, fake.seen], [[], []]);
  rmSync(dir, { recursive: true, force: true });
});

// The venture host as the desktop app and the hosted server build it, with the real models package.
const hostServices = {
  calculator: { calculate: async () => { throw new Error('not used'); }, receipt: () => { throw new Error('not used'); } },
  ontology: { current: () => null, publish: async () => { throw new Error('not used'); } },
  trust: { updatePolicy: async () => { throw new Error('not used'); } },
} as unknown as VentureEngineServices;

test('VentureHost: on the desktop the CLI status reaches the port through the host and its inspectCli; the hosted app answers TIER_UNAVAILABLE', async () => {
  for (const kind of ['desktop', 'hosted-web'] as const) {
    const fake = fakeTools({ claude: CLAUDE_OK, codex: CODEX_OK });
    const forwarded: string[] = [];
    const models: VenturePackageModule = {
      ...(modelsPackage as unknown as VenturePackageModule),
      createModelPort: (options: ModelPortOptions): ModelPort => {
        const port = createModelPort({ ...options, locateCli: command => (isClaude(command) ? CLAUDE_EXE : isCodex(command) ? CODEX_EXE : null) });
        return { ...port, inspectCli: async (cli, look) => { forwarded.push(look?.fresh ? `${cli} fresh` : cli); return port.inspectCli!(cli, look); } };
      },
    };
    const empty = async () => ({ handlers: {} });
    const loaders = { core: empty, models: async () => models, money: empty, build: empty, delivery: empty, views: empty, agents: empty, chief: empty, network: empty, notify: empty };
    const host = new VentureHost(new VentureTestStore(), hostServices, {
      demo: false, storage: 'experimental-file', host: kind, modelTransport: fake.transport, claudeCodeTerms: 'accepted', clock: () => new Date(START),
    }, loaders);
    if (kind === 'desktop') {
      const result = await host.request(owner, 'venture.models.cli.status', {}) as CliStatusList;
      assert.deepEqual(result.clis.map(item => [item.cli, item.found, item.version]), [['claude-code', true, '2.3.1'], ['codex', true, '0.154.0']]);
      assert.deepEqual(forwarded, ['claude-code', 'codex']);
      assert.ok(fake.seen.length > 0);
      // "Check again" reaches the port as a fresh look.
      await host.request(owner, 'venture.models.cli.status', { fresh: true });
      assert.deepEqual(forwarded.slice(2), ['claude-code fresh', 'codex fresh']);
    } else {
      await assert.rejects(host.request(owner, 'venture.models.cli.status', {}), code('TIER_UNAVAILABLE', 'The hosted app uses keys only.'));
      assert.deepEqual([forwarded, fake.seen], [[], []], 'nothing looked at, nothing started');
    }
    host.close();
  }
});
