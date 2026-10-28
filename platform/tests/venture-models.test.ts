// P2 tests for the venture model package: presets, connections, the model port, the routes, cost, the client
// data guard, previews and approvals, replay. No test touches a provider: every model call goes through a
// recording fake transport, the replay transport, or a loopback server on 127.0.0.1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { TrustService } from '../runtime/trust.ts';
import { CODEX_CLI_CONFIG, CODEX_CLI_FLAGS } from '../runtime/providers/codex-cli.ts';
import { DRAFT_METHODS, METHOD_OWNERS, MODEL_PRESET_IDS, MODEL_PURPOSES, PURPOSE_TIER, VENTURE_ERRORS, VENTURE_METHODS } from '../runtime/venture/contracts.ts';
import type {
  ModelHttpRequest, ModelHttpResponse, ModelPort, ModelProcessRequest, ModelProcessResponse, ModelPurpose, ModelReplayFixture, ModelTask, ModelTransport,
  SecretName, SecretShelf, VentureDeps,
} from '../runtime/venture/contracts.ts';
import { digest, formatMicros, houseStyleFindings, listRecords, ventureAction } from '../runtime/venture/records.ts';
import {
  PRESETS, assertSchemaSafe, callCostMicros, clientDataFindings, createModelPort, createReplayTransport, defaultModelTransport, handlers,
} from '../runtime/venture/models/index.ts';
import { TEMP_PREFIX, cliRouteFlags } from '../runtime/venture/models/cli.ts';
import { AVAILABILITY_REASONS, availabilityOf } from '../runtime/venture/models/presets.ts';
import { VentureTestStore } from './venture-test-store.ts';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const phone: Context = { ...owner, channel: 'phone' };
const KEY = 'sk-ant-test-not-a-real-key-0000';
const OPENAI_KEY = 'sk-' + 'proj-test-not-a-real-key-0000';
const START = Date.parse('2026-10-15T09:00:00.000Z'); // at or before real time (rule 23)
const REQUEST = 'Please close my September books. The bank statement and bills are in the shared folder.';
const TEMP_AT_START = new Set(readdirSync(tmpdir()).filter(name => name.startsWith(TEMP_PREFIX)));
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };

class MemoryShelf implements SecretShelf {
  #values = new Map<string, string>();
  get(name: SecretName) { return this.#values.get(name) ?? null; }
  set(name: SecretName, value: string) { this.#values.set(name, value); }
  delete(name: SecretName) { this.#values.delete(name); }
  has(name: SecretName) { return this.#values.has(name); }
  clear() { this.#values.clear(); }
}

type Words = { words: string };
const SCHEMA = { type: 'object', additionalProperties: false, required: ['words'], properties: { words: { type: 'string', description: 'Plain words only.' } } };
const validateWords = (raw: unknown): Words => {
  if (!raw || typeof raw !== 'object' || typeof (raw as Words).words !== 'string') throw new ChausarError('MODEL_OUTPUT_REJECTED', 'The words were missing.');
  return raw as Words;
};
function wordsTask(overrides: Partial<ModelTask<Words>> = {}): ModelTask<Words> {
  return {
    purpose: 'interview', instructions: 'Write one short question in plain words.', input: { idea: 'Monthly bookkeeping for cafes' },
    schemaName: 'test-words', schema: SCHEMA, validate: validateWords, template: () => ({ words: 'Template words' }),
    containsClientData: false, maxOutputTokens: 1024, ...overrides,
  };
}

function anthropicReply(value: unknown, options: { status?: number; stop?: string; usage?: { input_tokens: number; output_tokens: number }; lead?: unknown[]; text?: string } = {}): ModelHttpResponse {
  return {
    status: options.status ?? 200,
    body: JSON.stringify({
      id: 'msg_synthetic', type: 'message', role: 'assistant', model: 'synthetic',
      content: [...(options.lead ?? []), { type: 'text', text: options.text ?? JSON.stringify(value) }],
      stop_reason: options.stop ?? 'end_turn', stop_details: null, usage: options.usage ?? { input_tokens: 812, output_tokens: 164 },
    }),
  };
}
function openaiReply(value: unknown, options: { refusal?: boolean; usage?: { input_tokens: number; output_tokens: number } } = {}): ModelHttpResponse {
  const chunk = options.refusal ? { type: 'refusal', refusal: 'No.' } : { type: 'output_text', text: JSON.stringify(value) };
  return { status: 200, body: JSON.stringify({ id: 'resp_synthetic', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [chunk] }], usage: options.usage ?? { input_tokens: 812, output_tokens: 164 } }) };
}

type Recorder = {
  transport: ModelTransport;
  http: ModelHttpRequest[];
  process: ModelProcessRequest[];
  replyHttp: (request: ModelHttpRequest) => Promise<ModelHttpResponse> | ModelHttpResponse;
  replyProcess: (request: ModelProcessRequest) => Promise<ModelProcessResponse> | ModelProcessResponse;
};
/**
 * How an installed tool answers the checks a connection runs (4H1): its version, and a help page that lists every
 * flag the route sends (exec's, for Codex). No sign-in command is listed, so sign-in stays unknown.
 */
function checkAnswer(request: ModelProcessRequest): ModelProcessResponse {
  const asked = request.args.join(' ');
  if (asked === '--help') return { exitCode: 0, stdout: cliRouteFlags('claude-cli').map(flag => `  ${flag} <value>`).join('\n') };
  if (asked === 'exec --help') return { exitCode: 0, stdout: cliRouteFlags('codex-cli').map(flag => `  ${flag} <value>`).join('\n') };
  // The version line in the form each real tool prints it (models/cli-look.ts).
  return { exitCode: 0, stdout: /codex(?:\.exe)?$/i.test(request.command) ? 'codex-cli 0.154.0' : '2.0.0 (Claude Code)' };
}
/** Where a search path would have each tool on this test's computer: an absolute .exe. An absolute command is found where it says. */
const TOOL_BIN = join(tmpdir(), 'chausar-models-test-bin');
const locateCli = (command: string) => (isAbsolute(command) ? command : join(TOOL_BIN, `${command}.exe`));
function recorder(): Recorder {
  const rec: Recorder = {
    http: [], process: [],
    replyHttp: () => anthropicReply({ words: 'Model words' }),
    replyProcess: request => (request.purpose === 'version-check' ? checkAnswer(request) : { exitCode: 1, stdout: '' }),
    transport: {
      replay: false,
      async http(request) { rec.http.push(structuredClone(request)); return rec.replyHttp(request); },
      async process(request) { rec.process.push(structuredClone(request)); return rec.replyProcess(request); },
    },
  };
  return rec;
}

function gate() {
  let release!: () => void;
  const opened = new Promise<void>(resolve => { release = resolve; });
  return { opened, release };
}

const unused = new Proxy({}, { get() { throw new Error('This service is not used by the models package.'); } });

// The Claude Code route opens only once Chausar accepts Anthropic's terms (onboarding spec 2.8). These tests exercise
// that route, so they say 'accepted' explicitly; the gate's own test below runs with it pending.
async function setup(options: { codexCli?: unknown; venture?: boolean; transport?: ModelTransport; claudeCodeTerms?: 'accepted' | 'pending' } = {}) {
  const claudeCodeTerms = options.claudeCodeTerms ?? 'accepted';
  let now = START;
  const clock = () => new Date(now);
  const advance = (ms: number) => { now += ms; };
  const store = new VentureTestStore();
  const secrets = new MemoryShelf();
  const rec = recorder();
  const transport = options.transport ?? rec.transport;
  const makePort = (shelf: SecretShelf = secrets) => createModelPort({ store, clock, transport, secrets: shelf, host: 'test', demo: false, codexCli: options.codexCli, claudeCodeTerms, locateCli });
  const port = makePort();
  const trust = new TrustService(store);
  const deps = {
    store, clock, models: port, services: { trust, calculator: unused, ontology: unused }, github: unused, secrets,
    host: 'test', demo: false, storage: 'experimental-file', claudeCodeTerms,
  } as unknown as VentureDeps;
  if (options.venture !== false) {
    await ventureAction(deps, owner, 'admin', 'create', tx => tx.put({
      ...tx.base('venture-record'), idea: 'Monthly bookkeeping for cafes and small shops', ideaDigest: 'synthetic', workingName: 'Ledger Cafe Books',
      country: { code: 'IN', name: 'India', currency: 'INR', minorDigits: 2 } as any, serviceType: 'bookkeeping', status: 'interview', launchStage: 'rehearsal',
      blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
    }), { create: true });
  }
  return { store, secrets, port, deps, trust, rec, clock, advance, makePort };
}

const call = (deps: VentureDeps, method: string, payload: Record<string, unknown> = {}, ctx: Context = owner): Promise<any> => (handlers as any)[method](deps, ctx, payload);
const preset = (id: string) => PRESETS.find(item => item.id === id)!;
async function connect(deps: VentureDeps, presetId: string, extra: Record<string, unknown> = {}) {
  const spec = preset(presetId);
  const key = spec.kind === 'openai-responses' ? OPENAI_KEY : KEY;
  return call(deps, 'venture.models.connect', { presetId, consentDigest: spec.consentDigest, ...(spec.needsKey ? { apiKey: key } : {}), ...extra });
}
const calls = (store: VentureTestStore) => listRecords(store.read(), 'venture-model-call') as any[];
const connections = (store: VentureTestStore) => listRecords(store.read(), 'venture-model-connection') as any[];
const events = (store: VentureTestStore) => (listRecords(store.read(), 'venture-event') as any[]).map(event => event.name);

async function seedClientAndOrder(deps: VentureDeps) {
  await ventureAction(deps, owner, 'prepare', 'seed', tx => {
    const client = tx.put({ ...tx.base('venture-client'), name: 'Cafe Aroma Demo', email: 'owner@aroma.example', countryCode: 'IN', taxId: null, stateCode: '27', note: null });
    tx.put({ ...tx.base('venture-order'), clientId: client.id, offerId: 'offer_1', quantity: '1', request: REQUEST, status: 'open', priceReceiptId: 'price_synthetic', deliveredOn: null, saleFactId: null });
  });
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

// ---------------------------------------------------------------------------
// 1. Presets
// ---------------------------------------------------------------------------

test('presets: six presets, consent digests, Luna unverified, CLI checks change availability', async () => {
  const { port, rec } = await setup();
  const presets = port.presets();
  assert.deepEqual(presets.map(item => item.id), [...MODEL_PRESET_IDS]);
  for (const item of presets) {
    assert.equal(item.consentDigest, digest(item.consentText), item.id);
    assert.equal(item.verification, item.id === 'built-in-templates' ? 'built-in' : 'not-live-verified');
    assert.equal(item.modelEditable, item.id === 'openai-gpt-6-luna');
  }
  const byId = Object.fromEntries(presets.map(item => [item.id, item]));
  assert.equal(byId['openai-gpt-6-luna'].availability, 'unverified');
  assert.equal(byId['openai-gpt-6-luna'].priceTable?.confirmed, false);
  assert.equal(byId['anthropic-haiku-5-5'].availability, 'ready');
  assert.equal(byId['anthropic-haiku-5-5'].priceTable?.inputMicrosPerMillion, '100000');
  assert.equal(byId['anthropic-sonnet-5-5'].priceTable?.outputMicrosPerMillion, '10000000');
  assert.equal(byId['built-in-templates'].availability, 'ready');
  // Haiku and Sonnet read 'ready' (a key is all they need) but say beside it that no live key has checked them yet.
  for (const id of ['anthropic-haiku-5-5', 'anthropic-sonnet-5-5'] as const) {
    assert.equal(byId[id].verification, 'not-live-verified');
    assert.equal(byId[id].verificationNote, 'Not yet checked with a live key.');
    assert.equal(byId[id].availabilityReason, 'Uses your Anthropic key. Not yet checked with a live key.');
  }
  assert.equal(byId['openai-gpt-6-luna'].verificationNote, 'Not yet checked with a live key.');
  assert.equal(byId['claude-code-cli'].verificationNote, 'Not yet checked on a real task.');
  assert.equal(byId['codex-cli'].verificationNote, 'Not yet checked on a real task.');
  assert.equal(byId['built-in-templates'].verificationNote, null);
  assert.equal(byId['built-in-templates'].consentText, 'Chausar will use its built-in templates. Nothing is sent to any AI service.');
  assert.match(byId['anthropic-haiku-5-5'].consentText, /to Anthropic with your key/);
  assert.match(byId['codex-cli'].consentText, /^Chausar will run Codex on this computer/);
  assert.equal(byId['claude-code-cli'].availability, 'needs-setup');
  assert.equal(byId['codex-cli'].availability, 'needs-setup');

  await port.checkCli('claude-code-cli');
  // The version check, then the help page for the route's flags (4H1); its help lists no sign-in command, so nothing else.
  // Each runs the program the search path has, in an empty folder made for the look (4H1 review).
  assert.deepEqual(rec.process.map(request => request.args.join(' ')), ['--version', '--help']);
  const claudeExe = join(TOOL_BIN, 'claude.exe');
  assert.deepEqual({ ...rec.process[0], env: undefined, cwd: undefined }, { command: claudeExe, args: ['--version'], env: undefined, stdin: '', timeoutMs: 10000, purpose: 'version-check', cwd: undefined });
  assert.deepEqual({ ...rec.process[1], env: undefined, cwd: undefined }, { command: claudeExe, args: ['--help'], env: undefined, stdin: '', timeoutMs: 5000, purpose: 'version-check', cwd: undefined });
  assert.ok(rec.process[0].cwd && rec.process[0].cwd !== tmpdir() && rec.process[1].cwd === rec.process[0].cwd);
  assert.equal(existsSync(rec.process[0].cwd), false, 'the folder is removed after the look');
  assert.equal(port.presets().find(item => item.id === 'claude-code-cli')?.availability, 'unverified');

  const failing = await setup();
  failing.rec.replyProcess = () => ({ exitCode: 127, stdout: '' });
  await assert.rejects(failing.port.checkCli('claude-code-cli'), code('CLI_UNAVAILABLE'));
  failing.rec.replyProcess = () => { throw new ChausarError('CLI_UNAVAILABLE', 'not installed'); };
  await assert.rejects(failing.port.checkCli('claude-code-cli'), code('CLI_UNAVAILABLE'));
  assert.equal(failing.port.presets().find(item => item.id === 'claude-code-cli')?.availability, 'needs-setup');
  await assert.rejects(failing.port.checkCli('codex-cli'), code('PRESET_UNAVAILABLE'));

  const withCodex = await setup({ codexCli: codexProfile(join(tmpdir(), 'codex')) });
  assert.equal(withCodex.port.presets().find(item => item.id === 'codex-cli')?.availability, 'unverified');
});

test('the Claude Code terms gate: pending means needs setup with the terms words, and connect refuses before any check', async () => {
  const { port, deps, rec, store } = await setup({ claudeCodeTerms: 'pending' });
  const claude = port.presets().find(item => item.id === 'claude-code-cli')!;
  assert.equal(claude.availability, 'needs-setup');
  assert.equal(claude.availabilityReason, AVAILABILITY_REASONS.claudeTerms);
  assert.equal(AVAILABILITY_REASONS.claudeTerms, "Chausar hasn't yet accepted Anthropic's terms for running Claude Code. Use an Anthropic key for now.");
  // Even a found CLI stays behind the gate: the port's own check refuses in the terms words and runs nothing.
  await assert.rejects(port.checkCli('claude-code-cli'), (error: any) => error?.code === 'PRESET_UNAVAILABLE' && error.message === AVAILABILITY_REASONS.claudeTerms);
  assert.deepEqual(rec.process, []);
  assert.equal(port.presets().find(item => item.id === 'claude-code-cli')?.availability, 'needs-setup');
  const checksBefore = rec.process.length;
  await assert.rejects(connect(deps, 'claude-code-cli'), (error: any) => error?.code === 'PRESET_UNAVAILABLE' && error.message === AVAILABILITY_REASONS.claudeTerms);
  assert.equal(rec.process.length, checksBefore, 'the refusal comes before the version check');
  assert.equal(connections(store).length, 0);
  // The gate changes nothing else: keys connect as before.
  await connect(deps, 'anthropic-haiku-5-5');
  assert.equal(availabilityOf('claude-code-cli', { claudeFound: true, codexProfile: false }).availability, 'needs-setup', 'absent terms mean pending');
  assert.equal(availabilityOf('claude-code-cli', { claudeFound: true, codexProfile: false, claudeTerms: 'accepted' }).availability, 'unverified');
  assert.equal(availabilityOf('claude-code-cli', { claudeFound: false, codexProfile: false, claudeTerms: 'accepted' }).availability, 'needs-setup');
  assert.equal(availabilityOf('claude-code-cli', { claudeFound: false, codexProfile: false, claudeTerms: 'accepted' }).availabilityReason, AVAILABILITY_REASONS.claudeMissing);
});

// ---------------------------------------------------------------------------
// 2. Connect
// ---------------------------------------------------------------------------

test('connect: consent, key and model rules; CLI check before the write; keys never stored; restart forgets keys', async () => {
  const { deps, store, rec, secrets, makePort } = await setup();
  const haiku = preset('anthropic-haiku-5-5');
  await assert.rejects(call(deps, 'venture.models.connect', { presetId: haiku.id, consentDigest: 'wrong', apiKey: KEY }), code('MODEL_CONSENT_REQUIRED'));
  await assert.rejects(call(deps, 'venture.models.connect', { presetId: haiku.id, consentDigest: haiku.consentDigest }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(deps, 'venture.models.connect', { presetId: haiku.id, consentDigest: haiku.consentDigest, apiKey: 'short' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(deps, 'venture.models.connect', { presetId: haiku.id, consentDigest: haiku.consentDigest, apiKey: `${KEY} x` }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(connect(deps, 'claude-code-cli', { apiKey: KEY }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(connect(deps, 'anthropic-haiku-5-5', { model: 'claude-haiku-5-5' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(connect(deps, 'openai-gpt-6-luna', { model: 'GPT 6' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(connect(deps, 'anthropic-haiku-5-5', { tiers: ['main'] }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(connect(deps, 'anthropic-haiku-5-5', { monthlyCapUsd: '0' }), code('INVALID_AMOUNT'));
  await assert.rejects(connect(deps, 'anthropic-haiku-5-5', { monthlyCapUsd: '1000.01' }), code('INVALID_AMOUNT'));
  await assert.rejects(connect(deps, 'codex-cli'), code('PRESET_UNAVAILABLE'));
  await assert.rejects(call(deps, 'venture.models.connect', { presetId: haiku.id, consentDigest: haiku.consentDigest, apiKey: KEY }, phone), code('APP_APPROVAL_REQUIRED'));
  assert.equal(connections(store).length, 0);
  assert.equal(secrets.has('model:anthropic-haiku-5-5'), false);

  // Luna: the typed model id is stored on the connection and sent in the body. '12.50' dollars is 12,500,000 micros.
  await connect(deps, 'openai-gpt-6-luna', { model: 'gpt-6-luna-mini', monthlyCapUsd: '12.50' });
  const luna = connections(store).find(item => item.presetId === 'openai-gpt-6-luna');
  assert.equal(luna.model, 'gpt-6-luna-mini');
  assert.equal(luna.monthlyCapMicros, '12500000');
  assert.equal(luna.routeKind, 'openai-responses');
  assert.equal(luna.kind, 'venture-model-connection');
  rec.replyHttp = () => openaiReply({ words: 'Luna words' });
  const outcome = await deps.models.generate(owner, wordsTask());
  assert.equal(outcome.value.words, 'Luna words');
  assert.equal(JSON.parse(rec.http[0].body).model, 'gpt-6-luna-mini');

  // Claude Code: the version check runs before anything is written; a failed check stores nothing.
  const commitsBefore = store.commits;
  rec.replyProcess = () => ({ exitCode: 1, stdout: '' });
  await assert.rejects(connect(deps, 'claude-code-cli'), code('CLI_UNAVAILABLE'));
  assert.equal(store.commits, commitsBefore);
  let connectionsAtCheck = -1;
  rec.replyProcess = request => {
    if (request.purpose === 'version-check') connectionsAtCheck = connections(store).filter(item => item.presetId === 'claude-code-cli').length;
    return checkAnswer(request);
  };
  await connect(deps, 'claude-code-cli', { tiers: ['main'] });
  assert.equal(connectionsAtCheck, 0);
  assert.equal(connections(store).filter(item => item.presetId === 'claude-code-cli' && item.status === 'connected').length, 1);

  // Keys stay in memory: never in state or a call record.
  await connect(deps, 'anthropic-haiku-5-5');
  rec.replyHttp = () => anthropicReply({ words: 'Haiku words' });
  await deps.models.generate(owner, wordsTask());
  const stateText = JSON.stringify(store.read());
  assert.equal(stateText.includes(KEY), false);
  assert.equal(stateText.includes(OPENAI_KEY), false);
  for (const record of calls(store)) assert.equal(JSON.stringify(record).includes(KEY), false);
  assert.equal(secrets.get('model:anthropic-haiku-5-5'), KEY);

  // A restart is a new port with an empty shelf.
  const restarted = makePort(new MemoryShelf());
  const status = restarted.status(owner);
  const haikuView = (status.connections as any[]).find(item => item.presetId === 'anthropic-haiku-5-5' && item.status === 'connected');
  assert.equal(haikuView.keyLoaded, false);
  assert.equal(haikuView.usable, false);
  assert.equal(status.tiers.fast.usable, false);
  await assert.rejects(restarted.generate(owner, wordsTask()), code('MODEL_KEY_MISSING'));
});

test('connect replaces the older connection of a preset; disconnect drops the key when no connection uses it', async () => {
  const { deps, store, secrets, advance } = await setup();
  await connect(deps, 'anthropic-haiku-5-5');
  advance(1000);
  await connect(deps, 'anthropic-haiku-5-5');
  const list = connections(store);
  assert.deepEqual(list.map(item => item.status), ['disconnected', 'connected']);
  const status = await call(deps, 'venture.models.disconnect', { connectionId: list[1].id });
  assert.equal(secrets.has('model:anthropic-haiku-5-5'), false);
  assert.equal(status.tiers.fast.presetId, 'built-in-templates');
  assert.ok(events(store).includes('model-disconnected'));
  await assert.rejects(call(deps, 'venture.models.disconnect', { connectionId: 'modelconn_missing' }), code('INVALID_VENTURE_REQUEST'));
});

// ---------------------------------------------------------------------------
// 3. The send setting
// ---------------------------------------------------------------------------

test('send setting: connecting an AI moves nothing to shape once; templates leave it; nothing stops every call', async () => {
  const templates = await setup();
  assert.equal(templates.store.read().policy.send, 'nothing');
  await connect(templates.deps, 'built-in-templates');
  assert.equal(templates.store.read().policy.send, 'nothing');
  assert.equal(events(templates.store).includes('send-policy-changed'), false);

  const { deps, store, trust, rec } = await setup();
  await connect(deps, 'anthropic-haiku-5-5', { tiers: ['fast'] });
  await connect(deps, 'anthropic-sonnet-5-5', { tiers: ['main'] });
  assert.equal(store.read().policy.send, 'shape');
  assert.equal(events(store).filter(name => name === 'send-policy-changed').length, 1);
  assert.deepEqual(events(store).filter(name => name === 'model-connected').length, 2);
  const changed = (listRecords(store.read(), 'venture-event') as any[]).find(event => event.name === 'send-policy-changed');
  assert.deepEqual(changed.data, { from: 'nothing', to: 'shape' });

  await trust.updatePolicy(owner, { send: 'nothing' });
  await assert.rejects(deps.models.generate(owner, wordsTask()), code('SEND_DISABLED'));
  await assert.rejects(deps.models.preview(owner, wordsTask({ purpose: 'delivery', containsClientData: true })), code('SEND_DISABLED'));
  assert.equal(rec.http.length, 0);
  assert.equal(calls(store).length, 0);
  const status = deps.models.status(owner);
  assert.equal(status.sendPolicy, 'nothing');
  assert.equal(status.tiers.fast.usable, false);
});

// ---------------------------------------------------------------------------
// 4. Tiers
// ---------------------------------------------------------------------------

test('tiers: Haiku serves fast purposes and Sonnet main ones; templates serve when nothing is connected', async () => {
  const bare = await setup();
  const outcome = await bare.deps.models.generate(owner, wordsTask());
  assert.deepEqual(outcome, { value: { words: 'Template words' }, by: 'template', callId: null, presetId: 'built-in-templates', model: null, costMicros: '0', priceConfirmed: true });
  await assert.rejects(bare.deps.models.generate(owner, wordsTask({ template: undefined })), code('NO_MODEL_CONNECTED'));
  assert.equal(await bare.deps.models.preview(owner, wordsTask({ containsClientData: true })), null);
  assert.equal(bare.rec.http.length, 0);
  assert.equal(calls(bare.store).length, 0);
  const bareStatus = bare.deps.models.status(owner);
  assert.deepEqual(bareStatus.tiers.fast, {
    presetId: 'built-in-templates', model: null, usable: true, reason: 'No AI connected; using built-in templates', verification: 'built-in', verificationNote: null,
  });

  const { deps, rec } = await setup();
  await connect(deps, 'anthropic-haiku-5-5', { tiers: ['fast'] });
  await connect(deps, 'anthropic-sonnet-5-5', { tiers: ['main'] });
  const status = deps.models.status(owner);
  assert.equal(status.tiers.fast.presetId, 'anthropic-haiku-5-5');
  assert.equal(status.tiers.main.presetId, 'anthropic-sonnet-5-5');
  assert.equal(status.tiers.main.usable, true);
  // The status the screens read says beside 'ready' that no live key has checked these presets; it claims no check.
  for (const tier of ['fast', 'main'] as const) {
    assert.equal(status.tiers[tier].verification, 'not-live-verified');
    assert.equal(status.tiers[tier].verificationNote, 'Not yet checked with a live key.');
    assert.equal(status.tiers[tier].reason, 'Uses your Anthropic key. Not yet checked with a live key.');
  }
  assert.equal(status.connections.length, 2);
  for (const connection of status.connections) {
    assert.equal(connection.verification, 'not-live-verified');
    assert.equal(connection.verificationNote, 'Not yet checked with a live key.');
    assert.equal(connection.usable, true);
  }
  for (const purpose of MODEL_PURPOSES) {
    const result = await deps.models.generate(owner, wordsTask({ purpose }));
    const expected = PURPOSE_TIER[purpose] === 'fast' ? 'claude-haiku-5-5' : 'claude-sonnet-5-5';
    assert.equal(JSON.parse(rec.http.at(-1)!.body).model, expected, purpose);
    assert.equal(result.model, expected);
    assert.equal(result.by, 'model');
  }
});

// ---------------------------------------------------------------------------
// 5. Anthropic request and parsing
// ---------------------------------------------------------------------------

test('Anthropic: exact request shape, no purpose sent, and every stop reason parsed', async () => {
  const { deps, store, rec } = await setup();
  await connect(deps, 'anthropic-haiku-5-5');
  rec.replyHttp = () => anthropicReply({ words: 'Who are your clients?' });
  const outcome = await deps.models.generate(owner, wordsTask());
  assert.equal(outcome.value.words, 'Who are your clients?');
  const request = rec.http[0];
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(request.method, 'POST');
  assert.deepEqual(request.headers, { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' });
  assert.equal(request.timeoutMs, 90000);
  const body = JSON.parse(request.body);
  assert.deepEqual(Object.keys(body), ['model', 'max_tokens', 'system', 'messages', 'output_config']);
  assert.equal(body.model, 'claude-haiku-5-5');
  assert.equal(body.max_tokens, 1024);
  assert.equal(body.system, 'Write one short question in plain words.');
  assert.deepEqual(body.messages, [{ role: 'user', content: JSON.stringify({ idea: 'Monthly bookkeeping for cafes' }) }]);
  assert.equal(body.output_config.effort, 'low');
  assert.deepEqual(body.output_config.format, { type: 'json_schema', schema: SCHEMA });
  for (const absent of ['thinking', 'temperature', 'tool_choice', 'tools', 'fallbacks']) assert.equal(absent in body, false, absent);
  assert.equal(JSON.stringify(request.headers).includes('purpose') || request.body.includes('purpose'), false);
  const record = calls(store)[0];
  assert.equal(record.status, 'completed');
  assert.equal(record.payloadText, request.body);
  assert.equal(record.payloadDigest, digest(request.body));
  assert.equal(record.consent, 'standing');
  assert.equal(record.routeKind, 'anthropic-messages');
  assert.equal(record.endpoint, 'https://api.anthropic.com/v1/messages');
  assert.deepEqual(record.usage, { inputTokens: 812, outputTokens: 164 });
  assert.equal(record.costMicros, '164'); // worked by hand in the cost test below
  assert.equal(record.outputDigest, digest({ words: 'Who are your clients?' }));
  assert.equal(record.replay, false);

  // A leading thinking block is skipped.
  rec.replyHttp = () => anthropicReply({ words: 'After thinking' }, { lead: [{ type: 'thinking', thinking: '', signature: 'synthetic' }, { type: 'redacted_thinking', data: 'synthetic' }] });
  assert.equal((await deps.models.generate(owner, wordsTask())).value.words, 'After thinking');

  const failures: [string, ModelHttpResponse][] = [
    ['MODEL_INCOMPLETE', anthropicReply({ words: 'cut' }, { stop: 'max_tokens' })],
    ['MODEL_REFUSAL', anthropicReply({ words: 'no' }, { stop: 'refusal' })],
    ['MODEL_INCOMPLETE', anthropicReply({ words: 'paused' }, { stop: 'pause_turn' })],
    ['MODEL_OUTPUT_REJECTED', anthropicReply(null, { text: 'not json at all' })],
    ['MODEL_OUTPUT_REJECTED', anthropicReply({ other: 'shape' })],
    ['MODEL_FAILED', { status: 401, body: '{"type":"error"}' }],
    ['MODEL_FAILED', { status: 429, body: '{"type":"error"}' }],
  ];
  for (const [expected, reply] of failures) {
    rec.replyHttp = () => reply;
    const before = calls(store).length;
    await assert.rejects(deps.models.generate(owner, wordsTask()), code(expected));
    const failed = calls(store).at(-1);
    assert.equal(calls(store).length, before + 1);
    assert.equal(failed.status, 'failed', expected);
    assert.equal(failed.error.code, expected);
  }
  // A cut-off answer still used tokens, so its cost is recorded.
  const cut = calls(store).find(item => item.error?.code === 'MODEL_INCOMPLETE');
  assert.equal(cut.costMicros, '164');
  const refused = calls(store).find(item => item.error?.code === 'MODEL_FAILED');
  assert.match(refused.error.message, /refused your key/);
  assert.equal(refused.costMicros, null);
});

// ---------------------------------------------------------------------------
// 6. OpenAI, Claude Code and Codex
// ---------------------------------------------------------------------------

test('OpenAI Responses: request shape and refusal parsing', async () => {
  const { deps, store, rec } = await setup();
  await connect(deps, 'openai-gpt-6-luna');
  rec.replyHttp = () => openaiReply({ words: 'Luna words' });
  await deps.models.generate(owner, wordsTask({ purpose: 'brief' }));
  const request = rec.http[0];
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.deepEqual(request.headers, { 'content-type': 'application/json', authorization: `Bearer ${OPENAI_KEY}` });
  const body = JSON.parse(request.body);
  assert.deepEqual(Object.keys(body), ['model', 'instructions', 'input', 'max_output_tokens', 'store', 'tools', 'tool_choice', 'text']);
  assert.equal(body.model, 'gpt-6-luna');
  assert.equal(body.input, JSON.stringify({ idea: 'Monthly bookkeeping for cafes' }));
  assert.equal(body.store, false);
  assert.deepEqual(body.tools, []);
  assert.equal(body.tool_choice, 'none');
  assert.deepEqual(body.text, { format: { type: 'json_schema', name: 'test-words', schema: SCHEMA, strict: true } });
  assert.equal(request.body.includes('purpose'), false);
  assert.equal(request.body.includes(OPENAI_KEY), false);

  rec.replyHttp = () => openaiReply(null, { refusal: true });
  await assert.rejects(deps.models.generate(owner, wordsTask()), code('MODEL_REFUSAL'));
  rec.replyHttp = () => ({ status: 200, body: JSON.stringify({ status: 'incomplete', output: [] }) });
  await assert.rejects(deps.models.generate(owner, wordsTask()), code('MODEL_INCOMPLETE'));
  rec.replyHttp = () => ({ status: 200, body: JSON.stringify({ status: 'completed', output: [{ type: 'function_call', name: 'x' }] }) });
  await assert.rejects(deps.models.generate(owner, wordsTask()), code('MODEL_OUTPUT_REJECTED'));
  assert.deepEqual(calls(store).map(item => item.status), ['completed', 'failed', 'failed', 'failed']);
});

test('Claude Code CLI: flags, a clean environment, a 150 second limit and the temp folder removed', async () => {
  const { deps, store, rec } = await setup();
  await connect(deps, 'claude-code-cli');
  const before = new Set((await readdir(tmpdir())).filter(name => name.startsWith(TEMP_PREFIX)));
  let during: string[] = [];
  rec.replyProcess = async request => {
    if (request.purpose === 'version-check') return { exitCode: 0, stdout: '2.0.0 (Claude Code)' };
    during = (await readdir(tmpdir())).filter(name => name.startsWith(TEMP_PREFIX) && !before.has(name));
    return { exitCode: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { words: 'Command line words' }, usage: { input_tokens: 10, output_tokens: 5 } }) };
  };
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-env-not-a-real-key-0000';
  let outcome;
  try { outcome = await deps.models.generate(owner, wordsTask({ purpose: 'blueprint', maxOutputTokens: 2048 })); } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved;
  }
  assert.equal(outcome.value.words, 'Command line words');
  assert.equal(outcome.costMicros, '0');
  const request = rec.process.at(-1)!;
  assert.equal(request.command, 'claude');
  assert.equal(request.timeoutMs, 150000);
  assert.equal(request.purpose, 'blueprint');
  assert.equal(request.stdin, JSON.stringify({ idea: 'Monthly bookkeeping for cafes' }));
  assert.equal(request.args[request.args.indexOf('--model') + 1], 'claude-sonnet-5-5');
  assert.deepEqual(JSON.parse(request.args[request.args.indexOf('--json-schema') + 1]), SCHEMA);
  assert.equal(request.args[request.args.indexOf('--system-prompt') + 1], 'Write one short question in plain words.');
  assert.equal('ANTHROPIC_API_KEY' in request.env, false);
  assert.equal(request.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, '2048');
  assert.equal(request.env.CLAUDE_CODE_MAX_RETRIES, '0');
  for (const name of Object.keys(request.env)) assert.match(name, /^(PATH|Path|SystemRoot|WINDIR|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|CLAUDE_CODE_[A-Z_]+|MAX_STRUCTURED_OUTPUT_RETRIES|FALLBACK_FOR_ALL_PRIMARY_MODELS)$/);
  assert.equal(during.length, 1, 'one temp folder exists while the command runs');
  assert.equal(existsSync(join(tmpdir(), during[0])), false, 'the temp folder is removed afterwards');
  const record = calls(store).at(-1);
  assert.equal(record.endpoint, 'cli://claude');
  assert.equal(record.payloadText, JSON.stringify({ command: 'claude', args: request.args, stdin: request.stdin }));
  assert.equal(record.costMicros, '0');

  rec.replyProcess = () => ({ exitCode: 1, stdout: '' });
  await assert.rejects(deps.models.generate(owner, wordsTask()), code('MODEL_FAILED'));
  rec.replyProcess = () => { throw new ChausarError('CLI_UNAVAILABLE', 'The selected official command is not installed or could not start.'); };
  await assert.rejects(deps.models.generate(owner, wordsTask()), code('CLI_UNAVAILABLE'));
  assert.equal(readdirSync(tmpdir()).filter(name => name.startsWith(TEMP_PREFIX) && !before.has(name)).length, 0);
});

test('Codex CLI: the profile executable, the host process port and the schema file', async () => {
  const executable = join(tmpdir(), 'codex.exe');
  const host: any[] = [];
  let schemaSeen: unknown = null;
  let folderDuring: string[] | null = null;
  const hostProcess = async (request: any) => {
    host.push(structuredClone(request));
    if (request.args[0] === '--version') return { exitCode: 0, stdout: 'codex-cli 0.154.0' };
    // The connection looks at the tool first (4H1): exec's help must list every flag the route sends.
    if (request.args.join(' ') === 'exec --help' || request.args.join(' ') === '--help') return checkAnswer({ ...request, purpose: 'version-check' });
    folderDuring = readdirSync(request.cwd);
    const schemaPath = request.args[request.args.indexOf('--output-schema') + 1];
    schemaSeen = JSON.parse(await readFile(schemaPath, 'utf8'));
    const lines = [
      { type: 'thread.started', thread_id: 'thread_synthetic' }, { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: JSON.stringify({ words: 'Codex words' }) } },
      { type: 'turn.completed', usage: { input_tokens: 20, output_tokens: 6 } },
    ];
    return { exitCode: 0, stdout: lines.map(line => JSON.stringify(line)).join('\n') };
  };
  const transport = defaultModelTransport({ hostProcess });
  assert.equal(transport.replay, false);
  const { deps, store } = await setup({ codexCli: codexProfile(executable), transport });
  await connect(deps, 'codex-cli');
  const saved = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-env-not-a-real-key-0000';
  let outcome;
  try { outcome = await deps.models.generate(owner, wordsTask({ purpose: 'judge' })); } finally {
    if (saved === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved;
  }
  assert.equal(outcome.value.words, 'Codex words');
  const request = host.at(-1);
  assert.equal(request.command, executable);
  // The checks ran in an empty folder made for the look, never the shared temp folder; the call itself in another made
  // for it; each removed after (4H1, H39).
  assert.deepEqual(host.slice(0, 2).map(item => item.args.join(' ')), ['--version', 'exec --help']);
  assert.ok(host[0].cwd !== tmpdir() && host[1].cwd === host[0].cwd && !existsSync(host[0].cwd));
  assert.notEqual(request.cwd, tmpdir());
  assert.deepEqual(folderDuring, []);
  assert.equal(existsSync(request.cwd), false);
  assert.equal(request.schema, null);
  assert.equal(request.timeoutMs, 150000);
  assert.equal('purpose' in request, false);
  assert.equal('OPENAI_API_KEY' in request.env, false);
  assert.equal(request.args[0], 'exec');
  assert.equal(request.args[request.args.indexOf('--model') + 1], 'gpt-6-luna');
  assert.deepEqual(schemaSeen, SCHEMA);
  assert.equal(request.stdin, `Write one short question in plain words.\n${JSON.stringify({ idea: 'Monthly bookkeeping for cafes' })}`);
  const record = calls(store).at(-1);
  assert.equal(record.endpoint, 'cli://codex');
  assert.ok(record.payloadText.includes('<schema-file>'));
  assert.equal(record.payloadText.includes(request.args[request.args.indexOf('--output-schema') + 1]), false);
  assert.deepEqual(record.usage, { inputTokens: 20, outputTokens: 6 });
});

test('default transport: posts to a loopback server without the purpose, refuses redirects and oversized answers', async t => {
  const seen: { headers: Record<string, unknown>; body: string }[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      seen.push({ headers: request.headers, body });
      if (request.url === '/redirect') { response.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' }); response.end(); return; }
      if (request.url === '/large') { response.writeHead(200); response.end('x'.repeat(1_048_577)); return; }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const port = (server.address() as any).port;
  const transport = defaultModelTransport();
  const base = { method: 'POST' as const, headers: { 'content-type': 'application/json' }, body: '{"model":"x"}', timeoutMs: 5000, purpose: 'interview' as ModelPurpose };
  assert.deepEqual(await transport.http({ ...base, url: `http://127.0.0.1:${port}/ok` }), { status: 200, body: '{"ok":true}' });
  assert.equal(JSON.stringify(seen[0]).includes('purpose'), false);
  // The request reached the provider, so a redirect (never followed) or an answer too big to read may have run: unknown (W1 H15).
  await assert.rejects(transport.http({ ...base, url: `http://127.0.0.1:${port}/redirect` }), code('MODEL_OUTCOME_UNKNOWN'));
  await assert.rejects(transport.http({ ...base, url: `http://127.0.0.1:${port}/large` }), code('MODEL_OUTCOME_UNKNOWN'));
  assert.equal(seen.filter(item => item.body === '{"model":"x"}').length, 3, 'each asked once: nothing followed or retried');
});

// ---------------------------------------------------------------------------
// 7. Cost and budget
// ---------------------------------------------------------------------------

test('cost: the hand-worked examples, the monthly limit, and reservations by calls in flight', async () => {
  const haiku = preset('anthropic-haiku-5-5').priceTable;
  const sonnet = preset('anthropic-sonnet-5-5').priceTable;
  const luna = preset('openai-gpt-6-luna').priceTable;
  // Haiku: 812 x 100000 = 81,200,000; 164 x 500000 = 82,000,000; sum 163,200,000; plus 999,999 is 164,199,999; / 1,000,000 = 164.
  assert.equal(callCostMicros({ inputTokens: 812, outputTokens: 164 }, haiku), '164');
  assert.equal(formatMicros('164'), 'USD 0.0002');
  // Sonnet: 1430 x 2,000,000 = 2,860,000,000; 402 x 10,000,000 = 4,020,000,000; sum 6,880,000,000 exactly = 6880.
  assert.equal(callCostMicros({ inputTokens: 1430, outputTokens: 402 }, sonnet), '6880');
  assert.equal(formatMicros('6880'), 'USD 0.0069');
  assert.equal(callCostMicros({ inputTokens: 812, outputTokens: 164 }, luna), '164');
  assert.equal(callCostMicros({ inputTokens: 812, outputTokens: 164 }, null), '0');

  // Luna's spend shows as an estimate.
  const lunaSetup = await setup();
  await connect(lunaSetup.deps, 'openai-gpt-6-luna');
  lunaSetup.rec.replyHttp = () => openaiReply({ words: 'Luna words' });
  const lunaOutcome = await lunaSetup.deps.models.generate(owner, wordsTask());
  assert.equal(lunaOutcome.priceConfirmed, false);
  assert.equal(lunaOutcome.costMicros, '164');
  const lunaStatus = lunaSetup.deps.models.status(owner);
  assert.equal(lunaStatus.spentThisMonthMicros, '164');
  assert.equal(lunaStatus.estimate, true);
  assert.equal(lunaStatus.spentThisMonthDisplay, 'USD 0.0002 (estimate, price unconfirmed)');
  const lunaPreview = await lunaSetup.deps.models.preview(owner, wordsTask({ containsClientData: true }));
  assert.ok(lunaPreview!.estimatedMaxCostDisplay.endsWith(' (estimate, price unconfirmed)'));

  // A tiny limit refuses before anything is sent. Sonnet, 8192 output tokens: 8192 x 10,000,000 / 1,000,000 = 81,920 micros
  // for the output alone, above a limit of 0.01 dollars (10,000 micros).
  const tiny = await setup();
  await connect(tiny.deps, 'anthropic-sonnet-5-5', { monthlyCapUsd: '0.01' });
  await assert.rejects(tiny.deps.models.generate(owner, wordsTask({ purpose: 'blueprint', maxOutputTokens: 8192 })), code('BUDGET_REACHED'));
  assert.equal(tiny.rec.http.length, 0);
  assert.equal(calls(tiny.store).length, 0);

  // A call in flight reserves its estimate. Sonnet with 4096 output tokens: 4096 x 10 = 40,960 micros plus the input part.
  // A limit of 0.05 dollars (50,000 micros) fits one such call but not two at once.
  const held = await setup();
  await connect(held.deps, 'anthropic-sonnet-5-5', { monthlyCapUsd: '0.05' });
  const hold = gate();
  held.rec.replyHttp = async () => { await hold.opened; return anthropicReply({ words: 'Plan words' }, { usage: { input_tokens: 1430, output_tokens: 402 } }); };
  const first = held.deps.models.generate(owner, wordsTask({ purpose: 'blueprint', maxOutputTokens: 4096 }));
  while (held.rec.http.length === 0) await new Promise(resolve => setImmediate(resolve));
  const inFlight = calls(held.store)[0];
  assert.equal(inFlight.status, 'dispatching');
  // The estimate, worked here without the code under test: ceil(chars / 2) input tokens at 2,000,000 per million,
  // plus 4096 output tokens at 10,000,000 per million, rounded up to a whole micro.
  const chars = BigInt(inFlight.payloadText.length);
  const expected = (((chars + 1n) / 2n) * 2_000_000n + 4096n * 10_000_000n + 999_999n) / 1_000_000n;
  assert.equal(inFlight.estimatedMaxCostMicros, String(expected));
  assert.ok(expected > 25_000n && expected <= 50_000n);
  await assert.rejects(held.deps.models.generate(owner, wordsTask({ purpose: 'blueprint', maxOutputTokens: 4096 })), code('BUDGET_REACHED'));
  hold.release();
  assert.equal((await first).costMicros, '6880');
  // Spent 6,880 plus one new estimate stays under 50,000, so the next call goes through.
  held.rec.replyHttp = () => anthropicReply({ words: 'More plan words' }, { usage: { input_tokens: 1430, output_tokens: 402 } });
  await held.deps.models.generate(owner, wordsTask({ purpose: 'blueprint', maxOutputTokens: 4096 }));
  assert.equal(held.deps.models.status(owner).spentThisMonthMicros, '13760');
  assert.equal(held.deps.models.status(owner).spentThisMonthDisplay, 'USD 0.0138');
});

// ---------------------------------------------------------------------------
// 8. Client data guard
// ---------------------------------------------------------------------------

test('client data guard: emails, names and order text are refused under standing consent; a common word is not', async () => {
  const { deps, store, rec } = await setup();
  await connect(deps, 'anthropic-haiku-5-5');
  await seedClientAndOrder(deps);
  const spaced = REQUEST.slice(6, 62).toUpperCase().replace(/ /g, '  \n\t ');
  const payloads = [
    { idea: 'Write to OWNER@Aroma.Example about the plan' },
    { idea: 'A plan for Cafe Aroma Demo and friends' },
    { idea: `Notes: ${spaced}` },
  ];
  for (const input of payloads) {
    await assert.rejects(deps.models.generate(owner, wordsTask({ input })), code('CLIENT_DATA_NEEDS_APPROVAL'));
  }
  assert.equal(rec.http.length, 0);
  assert.equal(calls(store).length, 0);

  const findings = clientDataFindings(JSON.stringify({ text: `owner@aroma.example, Cafe Aroma Demo, ${spaced}` }), store.read());
  assert.deepEqual(findings.map(item => item.kind).sort(), ['client-email', 'client-name', 'order-request']);
  assert.equal(JSON.stringify(findings).includes('aroma'), false);
  assert.deepEqual(clientDataFindings('{"idea":"Cafe Aromatic Demos"}', store.read()), []);

  const outcome = await deps.models.generate(owner, wordsTask({ input: { idea: 'Bookkeeping for every cafe in town' } }));
  assert.equal(outcome.by, 'model');
  assert.equal(rec.http.length, 1);
});

// ---------------------------------------------------------------------------
// 9. Preview and approval
// ---------------------------------------------------------------------------

test('preview dispatch guard refuses stale source after durable claim for HTTP and CLI without sending or spawning',async()=>{for(const presetId of ['anthropic-sonnet-5-5','claude-code-cli']){const {deps,store,rec}=await setup();await connect(deps,presetId);const preview=await deps.models.preview(owner,wordsTask({purpose:'delivery',containsClientData:true}));assert.ok(preview);const processes=rec.process.length,requests=rec.http.length;let checked=0;await assert.rejects(deps.models.runPreview(owner,preview.callId,preview.digest,validateWords,{beforeDispatch:()=>{checked++;assert.equal(calls(store).find(call=>call.id===preview.callId).status,'dispatching');throw new ChausarError('DERIVED_STALE','The source permission changed.');}}),code('DERIVED_STALE'));assert.equal(checked,1);assert.equal(rec.http.length,requests);assert.equal(rec.process.length,processes);assert.equal(calls(store).find(call=>call.id===preview.callId).status,'failed');const spend=listRecords(store.read(),'venture-spend').find(row=>row.key.includes(preview.callId));if(spend)assert.equal(spend.phase,'released');assert.equal(JSON.stringify(calls(store)).includes('beforeDispatch'),false);}});

test('preview dispatch guard cannot be asynchronous and is never treated as a resolved permission',async()=>{const {deps,rec}=await setup();await connect(deps,'anthropic-sonnet-5-5');const preview=await deps.models.preview(owner,wordsTask({purpose:'delivery',containsClientData:true}));assert.ok(preview);await assert.rejects(deps.models.runPreview(owner,preview.callId,preview.digest,validateWords,{beforeDispatch:async()=>{}}),code('INVALID_VENTURE_REQUEST'));assert.equal(rec.http.length,0);});

test('preview dispatch guard consumes an unsupported rejecting promise without an unhandled rejection',async()=>{const {deps,rec}=await setup();await connect(deps,'anthropic-sonnet-5-5');const preview=await deps.models.preview(owner,wordsTask({purpose:'delivery',containsClientData:true}));assert.ok(preview);await assert.rejects(deps.models.runPreview(owner,preview.callId,preview.digest,validateWords,{beforeDispatch:async()=>{throw new ChausarError('DERIVED_STALE','A deliberately unsupported async guard.');}}),code('INVALID_VENTURE_REQUEST'));await new Promise(resolve=>setImmediate(resolve));assert.equal(rec.http.length,0);});

test('preview dispatch guard observes revocation during the claim and credential read, including CLI preparation awaits',async()=>{for(const presetId of ['anthropic-sonnet-5-5','claude-code-cli']){const {deps,store,secrets,rec}=await setup();await connect(deps,presetId);const preview=await deps.models.preview(owner,wordsTask({purpose:'delivery',containsClientData:true}));assert.ok(preview);let current=true,checked=0;const update=store.update.bind(store);store.update=async change=>{const result=await update(change);if(calls(store).some(call=>call.id===preview.callId&&call.status==='dispatching'))current=false;return result;};const get=secrets.get.bind(secrets);secrets.get=name=>{if(calls(store).some(call=>call.id===preview.callId&&call.status==='dispatching'))current=false;return get(name);};const processes=rec.process.length;await assert.rejects(deps.models.runPreview(owner,preview.callId,preview.digest,validateWords,{beforeDispatch:()=>{checked++;if(!current)throw new ChausarError('RIGHTS_REQUIRED','Current rights were withdrawn.');}}),code('RIGHTS_REQUIRED'));assert.equal(checked,1);assert.equal(rec.http.length,0);assert.equal(rec.process.length,processes);}});

test('preview and approval: flagged tasks never go standing, a preview sends nothing, approval sends once', async () => {
  const { deps, store, rec, advance } = await setup();
  await connect(deps, 'anthropic-sonnet-5-5');
  await seedClientAndOrder(deps);
  const clientTask = (overrides: Partial<ModelTask<Words>> = {}) => wordsTask({ purpose: 'delivery', containsClientData: true, input: { clientRequest: REQUEST }, ...overrides });

  await assert.rejects(deps.models.generate(owner, clientTask()), code('CLIENT_DATA_NEEDS_APPROVAL'));
  const preview = (await deps.models.preview(owner, clientTask()))!;
  assert.equal(rec.http.length, 0);
  const stored = calls(store).find(item => item.id === preview.callId);
  assert.equal(stored.status, 'preview');
  assert.equal(stored.containsClientData, true);
  assert.equal(stored.consent, 'approved-preview');
  assert.equal(stored.payloadDigest, preview.digest);
  assert.equal(preview.digest, digest(preview.payloadText));
  assert.ok(preview.payloadText.includes('Please close my September books'));
  assert.equal(JSON.stringify(stored).includes(KEY), false);
  assert.equal(JSON.stringify(stored).includes('x-api-key'), false);
  assert.equal(preview.expiresAt, '2026-10-15T09:30:00.000Z');
  assert.equal(preview.endpoint, 'https://api.anthropic.com/v1/messages');
  assert.equal(preview.estimatedMaxCostDisplay, formatMicros(preview.estimatedMaxCostMicros));

  await assert.rejects(deps.models.runPreview(owner, preview.callId, 'wrong-digest', validateWords), code('APPROVAL_STALE'));
  await assert.rejects(deps.models.runPreview(phone, preview.callId, preview.digest, validateWords), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(deps.models.runPreview({ ...owner, sourceTainted: true }, preview.callId, preview.digest, validateWords), code('APP_APPROVAL_REQUIRED'));
  assert.equal(rec.http.length, 0);

  // Two approvals started together send exactly once.
  rec.replyHttp = () => anthropicReply({ words: 'Draft words' });
  const results = await Promise.allSettled([
    deps.models.runPreview(owner, preview.callId, preview.digest, validateWords),
    deps.models.runPreview(owner, preview.callId, preview.digest, validateWords),
  ]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  const rejected = results.find(item => item.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.code, 'APPROVAL_STALE');
  assert.equal(rec.http.length, 1);
  assert.equal(rec.http[0].body, preview.payloadText);
  const sent = calls(store).find(item => item.id === preview.callId);
  assert.equal(sent.status, 'completed');
  assert.equal(sent.approvedBy, 'owner');
  assert.equal(sent.approvedDigest, preview.digest);
  assert.equal(sent.approvedAt, '2026-10-15T09:00:00.000Z');
  await assert.rejects(deps.models.runPreview(owner, preview.callId, preview.digest, validateWords), code('APPROVAL_STALE'));

  // Expired after 30 minutes.
  const late = (await deps.models.preview(owner, clientTask()))!;
  advance(31 * 60_000);
  await assert.rejects(deps.models.runPreview(owner, late.callId, late.digest, validateWords), code('APPROVAL_STALE'));
  // The refused claim wrote nothing; the list shows the preview as expired without writing either.
  assert.equal(calls(store).find(item => item.id === late.callId).status, 'preview');
  assert.equal((await call(deps, 'venture.models.calls', {})).find((item: any) => item.id === late.callId).status, 'expired');

  // A changed consent digest, then a disconnected connection, make approval stale; nothing is sent.
  const consentChanged = (await deps.models.preview(owner, clientTask()))!;
  await ventureAction(deps, owner, 'admin', 'test.consent', tx => {
    const connection = tx.list('venture-model-connection').find((item: any) => item.status === 'connected') as any;
    tx.replace({ ...connection, consentDigest: digest('an older consent text') });
  });
  await assert.rejects(deps.models.runPreview(owner, consentChanged.callId, consentChanged.digest, validateWords), code('APPROVAL_STALE'));
  await connect(deps, 'anthropic-sonnet-5-5');
  const beforeDisconnect = (await deps.models.preview(owner, clientTask()))!;
  const live = connections(store).find(item => item.status === 'connected');
  await call(deps, 'venture.models.disconnect', { connectionId: live.id });
  await connect(deps, 'anthropic-sonnet-5-5');
  await assert.rejects(deps.models.runPreview(owner, beforeDisconnect.callId, beforeDisconnect.digest, validateWords), code('APPROVAL_STALE'));
  assert.equal(rec.http.length, 1);
});

test('approval budget: a second approval refuses while the first is in flight and their estimates pass the limit', async () => {
  const { deps, store, rec } = await setup();
  // Sonnet, 4096 output tokens: about 41,000 micros each. A 0.05 dollar limit (50,000 micros) fits one.
  await connect(deps, 'anthropic-sonnet-5-5', { monthlyCapUsd: '0.05' });
  await seedClientAndOrder(deps);
  const task = wordsTask({ purpose: 'delivery', containsClientData: true, maxOutputTokens: 4096, input: { clientRequest: REQUEST } });
  const one = (await deps.models.preview(owner, task))!;
  const two = (await deps.models.preview(owner, task))!;
  const hold = gate();
  rec.replyHttp = async () => { await hold.opened; return anthropicReply({ words: 'Draft words' }); };
  const first = deps.models.runPreview(owner, one.callId, one.digest, validateWords);
  while (rec.http.length === 0) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(deps.models.runPreview(owner, two.callId, two.digest, validateWords), code('BUDGET_REACHED'));
  hold.release();
  const outcome = await first;
  assert.equal(outcome.value.words, 'Draft words');
  // Sonnet, 812 in and 164 out: 812 x 2,000,000 = 1,624,000,000; 164 x 10,000,000 = 1,640,000,000; sum / 1,000,000 = 3,264.
  assert.equal(outcome.costMicros, '3264');
  assert.equal(calls(store).find(item => item.id === one.callId).approvedBy, 'owner');
  // With the first call finished at 3,264 micros, the second fits and can still be approved.
  rec.replyHttp = () => anthropicReply({ words: 'Second draft' });
  assert.equal((await deps.models.runPreview(owner, two.callId, two.digest, validateWords)).value.words, 'Second draft');
  assert.equal(rec.http.length, 2);
});

// ---------------------------------------------------------------------------
// 10. status never writes
// ---------------------------------------------------------------------------

test('status never writes: a stale dispatching call reads as failed; the next generate records it', async () => {
  const { deps, store } = await setup();
  await connect(deps, 'anthropic-haiku-5-5');
  const connection = connections(store)[0];
  // Eleven minutes before the clock.
  await ventureAction(deps, owner, 'prepare', 'test.seed-call', tx => tx.put({
    ...tx.base('venture-model-call'), at: '2026-10-15T08:49:00.000Z', purpose: 'interview', tier: 'fast', presetId: 'anthropic-haiku-5-5',
    connectionId: connection.id, routeKind: 'anthropic-messages', model: 'claude-haiku-5-5', consent: 'standing', endpoint: connection.endpoint,
    payloadText: '{}', payloadDigest: digest('{}'), payloadTruncated: false, containsClientData: false, status: 'dispatching',
    approvedDigest: null, approvedAt: null, approvedBy: null, estimatedMaxCostMicros: '4999999', priceConfirmed: true,
    usage: null, costMicros: null, outputDigest: null, error: null, replay: false,
  } as any));
  const commits = store.commits;
  const status = deps.models.status(owner);
  assert.equal(status.spentThisMonthMicros, '0');
  const listed = await call(deps, 'venture.models.calls', {});
  assert.equal(listed[0].status, 'failed');
  assert.equal(listed[0].error.code, 'MODEL_TIMEOUT');
  assert.equal(store.commits, commits);
  assert.equal(calls(store)[0].status, 'dispatching');
  await ventureAction(deps, owner, 'read', 'test.status-inside', () => { deps.models.status(owner); });
  // The stale call's 4,999,999 micro reservation no longer counts. If it did, any new estimate would pass the
  // default limit of 5 dollars (5,000,000 micros) and this call would refuse BUDGET_REACHED.
  await deps.models.generate(owner, wordsTask());
  const stale = calls(store)[0];
  assert.equal(stale.status, 'failed');
  assert.deepEqual(stale.error, { code: 'MODEL_TIMEOUT', message: 'The result was never recorded. Chausar does not retry on its own.' });
});

// ---------------------------------------------------------------------------
// 11. Schema rule
// ---------------------------------------------------------------------------

test('assertSchemaSafe: refuses numbers, extra keywords and open objects; accepts the interview schema', () => {
  const object = (properties: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...extra });
  const refused = [
    object({ amount: { type: 'number' } }),
    object({ count: { type: 'integer' } }),
    object({ amount: { type: ['string', 'number'] } }),
    object({ name: { type: 'string', minLength: 2 } }),
    { type: 'object', required: ['a'], properties: { a: { type: 'string' } } },
    { type: 'object', additionalProperties: true, required: ['a'], properties: { a: { type: 'string' } } },
    { type: 'object', additionalProperties: false, required: [], properties: { a: { type: 'string' } } },
    object({ list: { type: 'array' } }),
    object({ any: {} }),
    object({ choice: { enum: ['a', 1] } }),
    { type: 'array', items: { type: 'string' } },
  ];
  for (const schema of refused) assert.throws(() => assertSchemaSafe(schema), code('INVALID_VENTURE_REQUEST'), JSON.stringify(schema));
  const interview = {
    type: 'object', additionalProperties: false, required: ['serviceType', 'questions'],
    properties: {
      serviceType: { type: 'string', enum: ['agency', 'studio', 'consulting', 'bookkeeping', 'research', 'content', 'support', 'other'] },
      questions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['field', 'kind', 'text', 'choices'], properties: {
        field: { type: 'string', enum: ['customer', 'first-offer', 'channel'] },
        kind: { type: 'string', enum: ['choice', 'text'] },
        text: { type: 'string', description: 'One short question. No digits, prices or amounts.' },
        choices: { type: 'array', items: { type: 'string', description: 'A short answer label. No digits.' } } } } },
    },
  };
  assert.doesNotThrow(() => assertSchemaSafe(interview));
  assert.doesNotThrow(() => assertSchemaSafe(SCHEMA));
});

test('generate refuses a malformed or unsafe task before anything is recorded', async () => {
  const { deps, store, rec } = await setup();
  await connect(deps, 'anthropic-haiku-5-5');
  await assert.rejects(deps.models.generate(owner, wordsTask({ schema: { type: 'object', additionalProperties: false, required: ['n'], properties: { n: { type: 'number' } } } })), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(deps.models.generate(owner, wordsTask({ maxOutputTokens: 100 })), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(deps.models.generate(owner, wordsTask({ schemaName: 'Bad Name' })), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(deps.models.generate(owner, wordsTask({ purpose: 'other' as any })), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(deps.models.generate({ ...owner, role: 'viewer' }, wordsTask()), (error: any) => ['ACCESS_REVOKED', 'FORBIDDEN'].includes(error.code));
  assert.equal(rec.http.length, 0);
  assert.equal(calls(store).length, 0);
});

// ---------------------------------------------------------------------------
// 12. Replay
// ---------------------------------------------------------------------------

test('replay: selection by purpose, kind and model; mustInclude; first unused then the last; missing; version check; label', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/venture/models/replay.json', import.meta.url), 'utf8')) as ModelReplayFixture;
  assert.equal(fixture.label, 'synthetic recording');
  const replay = createReplayTransport(fixture);
  assert.equal(replay.replay, true);
  const http = (purpose: ModelPurpose, model: string, text: string, url = 'https://api.anthropic.com/v1/messages') =>
    replay.http({ url, method: 'POST', headers: {}, body: JSON.stringify({ model, note: text }), timeoutMs: 90000, purpose });
  const words = (response: ModelHttpResponse) => JSON.parse(JSON.parse(response.body).content[0].text).words;

  assert.equal(words(await http('interview', 'claude-haiku-5-5', 'monthly books for cafes')), 'Who will your first clients be?');
  await assert.rejects(http('interview', 'claude-haiku-5-5', 'monthly books for shops'), (error: any) => error.code === 'FIXTURE_MISSING' && error.message === 'Record this fixture: interview for claude-haiku-5-5.');
  await assert.rejects(http('interview', 'claude-sonnet-5-5', 'cafes'), code('FIXTURE_MISSING'));
  await assert.rejects(http('interview', 'claude-haiku-5-5', 'cafes', 'https://api.openai.com/v1/responses'), code('FIXTURE_MISSING'));
  assert.equal(words(await http('blueprint', 'claude-sonnet-5-5', '')), 'First plan words');
  assert.equal(words(await http('blueprint', 'claude-sonnet-5-5', '')), 'Second plan words');
  assert.equal(words(await http('blueprint', 'claude-sonnet-5-5', '')), 'Second plan words');
  assert.equal((await http('client-sim', 'claude-haiku-5-5', '')).status, 500);

  assert.deepEqual(await replay.process({ command: 'claude', args: ['--version'], env: {}, stdin: '', timeoutMs: 10000, purpose: 'version-check' }), { exitCode: 0, stdout: 'synthetic recording' });
  const brief = await replay.process({ command: 'claude', args: ['--print', '--model', 'claude-sonnet-5-5'], env: {}, stdin: '{}', timeoutMs: 150000, purpose: 'brief' });
  assert.equal(brief.exitCode, 0);
  assert.equal(JSON.parse(JSON.parse(brief.stdout).result).words, 'Brief words from Claude Code');
  const judge = await replay.process({ command: join(tmpdir(), 'codex'), args: ['exec', '--model', 'gpt-6-luna'], env: {}, stdin: 'x', timeoutMs: 150000, purpose: 'judge' });
  assert.equal(judge.stdout.split('\n').length, 4);

  assert.throws(() => createReplayTransport({ ...fixture, label: 'live capture' as any }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => createReplayTransport({ label: 'synthetic recording', note: '', responses: [{ purpose: 'interview' }] } as any), code('INVALID_VENTURE_REQUEST'));
});

test('replay through the port: calls are marked replay and status says synthetic recording', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/venture/models/replay.json', import.meta.url), 'utf8')) as ModelReplayFixture;
  const { deps, store } = await setup({ transport: createReplayTransport(fixture) });
  await connect(deps, 'anthropic-haiku-5-5');
  const status = deps.models.status(owner);
  assert.deepEqual(status.replay, { active: true, label: 'synthetic recording' });
  const outcome = await deps.models.generate(owner, wordsTask());
  assert.equal(outcome.value.words, 'Who will your first clients be?');
  assert.equal(outcome.costMicros, '164');
  const listed = await call(deps, 'venture.models.calls', { limit: 5, purpose: 'interview' });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].replay, true);
  assert.equal(listed[0].payloadText, calls(store)[0].payloadText);
  await assert.rejects(deps.models.generate(owner, wordsTask({ purpose: 'client-sim' })), code('MODEL_FAILED'));
  await assert.rejects(deps.models.generate(owner, wordsTask({ purpose: 'judge' })), code('FIXTURE_MISSING'));
  const newest = await call(deps, 'venture.models.calls', {});
  assert.deepEqual(newest.map((item: any) => item.purpose), ['judge', 'client-sim', 'interview']);
  await assert.rejects(call(deps, 'venture.models.calls', { limit: 0 }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(deps, 'venture.models.calls', { purpose: 'books' }), code('INVALID_VENTURE_REQUEST'));
});

// ---------------------------------------------------------------------------
// 13. Handlers and house rules
// ---------------------------------------------------------------------------

test('handlers: exactly the seven model methods; presets and status need no venture', async () => {
  // The venture.ai.* draft methods are owned by models too, but the engine's draft desk answers them, outside the table.
  // Five, and the two Ink v2 wave 4 added (the CLI status and per-role models, 4H1).
  const owned = VENTURE_METHODS.filter(method => METHOD_OWNERS[method] === 'models' && !DRAFT_METHODS.includes(method));
  assert.deepEqual(Object.keys(handlers).sort(), [...owned].sort());
  assert.equal(owned.length, 7);
  const { deps } = await setup({ venture: false });
  assert.equal((await call(deps, 'venture.models.presets')).length, 6);
  const status = await call(deps, 'venture.models.status');
  assert.deepEqual(status.connections, []);
  assert.equal(status.tiers.main.presetId, 'built-in-templates');
  assert.deepEqual(await call(deps, 'venture.models.calls'), []);
  await assert.rejects(call(deps, 'venture.models.presets', { extra: true }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(connect(deps, 'anthropic-haiku-5-5'), code('VENTURE_NOT_FOUND'));
});

test('house rules: every error code the package throws is listed, and its words avoid em dashes and the banned words', async () => {
  const folder = new URL('../runtime/venture/models/', import.meta.url);
  const files = (await readdir(folder)).filter(name => name.endsWith('.ts'));
  assert.ok(files.length >= 10);
  // Quoted capitals that are not error codes: the HTTP method, the currency, environment names, and two engine codes
  // that port.ts maps to venture codes before they reach anyone.
  const passThrough = new Set(['POST', 'USD', 'PATH', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'CODEX_HOME', 'RESPONSE_TOO_LARGE', 'CLI_HOST_EVIDENCE_INVALID']);
  for (const file of files) {
    const text = await readFile(new URL(file, folder), 'utf8');
    for (const match of text.matchAll(/'([A-Z][A-Z_]{2,})'/g)) {
      assert.ok((VENTURE_ERRORS as readonly string[]).includes(match[1]) || passThrough.has(match[1]), `${file}: ${match[1]}`);
    }
    assert.deepEqual(houseStyleFindings(text), [], file);
  }
  for (const extra of ['./fixtures/venture/models/replay.json', '../../docs/venture/models.md']) {
    const url = new URL(extra, import.meta.url);
    if (existsSync(url)) assert.deepEqual(houseStyleFindings(await readFile(url, 'utf8')), [], extra);
  }
});

test('no command-line temp folder made by these tests is left behind', async () => {
  // Only this package makes folders with this prefix; a new one here means a dispatch skipped its cleanup.
  const leftovers = (await readdir(tmpdir())).filter(name => name.startsWith(TEMP_PREFIX) && !TEMP_AT_START.has(name));
  assert.deepEqual(leftovers, []);
});
