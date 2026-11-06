// Ink v2 wave 4 (4H1) tests: model records. Every settled model call keeps the model the provider's answer named
// (answeredBy, H36), else "not reported"; a draft says which engine wrote it (U17); venture.models.roles lists each
// agent's tiers, the preset that serves each and its price line, and says the team runs as one agent (M19). No test
// touches a provider: every answer is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { TrustService } from '../runtime/trust.ts';
import { CODEX_CLI_CONFIG, CODEX_CLI_FLAGS } from '../runtime/providers/codex-cli.ts';
import type {
  ModelCallRecord, ModelHttpRequest, ModelHttpResponse, ModelProcessRequest, ModelProcessResponse, ModelTask, ModelTransport, PlaybookRecord, RoleModelsView,
  SecretName, SecretShelf, SpendPolicyRecord, SpendRow, VentureDeps,
} from '../runtime/venture/contracts.ts';
import { listSpend } from '../runtime/venture/money/spend.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { seedSpend } from './venture-team-fixtures.ts';
import { houseStyleFindings, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { PRESETS, createModelPort, handlers } from '../runtime/venture/models/index.ts';
import { cliRouteFlags } from '../runtime/venture/models/cli.ts';
import { NOT_REPORTED, aiWaitLine, writtenByLine } from '../runtime/venture/models/roles.ts';
import { handlers as deliveryHandlers } from '../runtime/venture/delivery/index.ts';
import { flagshipDelivery } from '../runtime/venture/playbooks/steps.ts';
import { owner as viewsOwner, seedBlueprint, seedOrder, seedRun, setup as viewsSetup, type Env } from './venture-views-env.ts';
import { VentureTestStore } from './venture-test-store.ts';

// This file's command-line calls make their temp folders in a folder of its own, so the leftover checks of
// venture-models.test.ts, which node --test runs beside it in another process, never count them.
const OWN_TEMP = mkdtempSync(join(tmpdir(), 'chausar-4h1-records-'));
process.env.TMPDIR = OWN_TEMP;
process.env.TEMP = OWN_TEMP;
process.env.TMP = OWN_TEMP;
test.after(() => rmSync(OWN_TEMP, { recursive: true, force: true }));

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const KEY = 'sk-ant-' + 'test-not-a-real-key-0000';
const OPENAI_KEY = 'sk-' + 'proj-test-not-a-real-key-0000';
const START = Date.parse('2026-10-23T09:00:00.000Z');
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
function wordsTask(overrides: Partial<ModelTask<Words>> = {}): ModelTask<Words> {
  return {
    purpose: 'interview', instructions: 'Write one short question in plain words.', input: { idea: 'Monthly bookkeeping for cafes' }, schemaName: 'test-words',
    schema: { type: 'object', additionalProperties: false, required: ['words'], properties: { words: { type: 'string', description: 'Plain words only.' } } },
    validate: raw => raw as Words, template: () => ({ words: 'Template words' }), containsClientData: false, maxOutputTokens: 1024, ...overrides,
  };
}

function anthropicReply(model: unknown, stop = 'end_turn'): ModelHttpResponse {
  return {
    status: 200, body: JSON.stringify({
      id: 'msg_synthetic', type: 'message', role: 'assistant', ...(model === undefined ? {} : { model }),
      content: [{ type: 'text', text: JSON.stringify({ words: 'Model words' }) }], stop_reason: stop, usage: { input_tokens: 812, output_tokens: 164 },
    }),
  };
}
function openaiReply(model: unknown): ModelHttpResponse {
  return {
    status: 200, body: JSON.stringify({
      id: 'resp_synthetic', status: 'completed', ...(model === undefined ? {} : { model }),
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ words: 'Luna words' }) }] }], usage: { input_tokens: 812, output_tokens: 164 },
    }),
  };
}

const helpText = (flags: readonly string[], commands: readonly string[] = []) =>
  ['Options:', ...flags.map(flag => `  ${flag} <value>  Synthetic.`), 'Commands:', ...commands.map(name => `  ${name}  Synthetic.`)].join('\n');

/** A fake transport: providers answer with replyHttp; the CLIs answer their checks, then model work with replyProcess. */
function fakeTransport() {
  const fake = {
    replyHttp: (_request: ModelHttpRequest): ModelHttpResponse => anthropicReply('claude-haiku-5-5'),
    replyProcess: (_request: ModelProcessRequest): ModelProcessResponse => ({ exitCode: 1, stdout: '' }),
    transport: undefined as unknown as ModelTransport,
  };
  fake.transport = {
    replay: false,
    async http(request) { return fake.replyHttp(request); },
    async process(request) {
      const claude = /(?:^|[\\/])claude(?:\.exe)?$/i.test(request.command);
      const asked = request.args.join(' ');
      if (asked === '--version') return { exitCode: 0, stdout: claude ? '2.3.1 (Claude Code)' : 'codex-cli 0.154.0' };
      if (asked === '--help') return { exitCode: 0, stdout: claude ? helpText(cliRouteFlags('claude-cli')) : helpText([], ['exec']) };
      if (asked === 'exec --help') return { exitCode: 0, stdout: helpText(cliRouteFlags('codex-cli')) };
      return fake.replyProcess(request);
    },
  };
  return fake;
}

const unused = new Proxy({}, { get() { throw new Error('This service is not used by these tests.'); } });

async function setup(options: { codexCli?: unknown } = {}) {
  const store = new VentureTestStore();
  const clock = () => new Date(START);
  const secrets = new MemoryShelf();
  const fake = fakeTransport();
  const port = createModelPort({
    store, clock, transport: fake.transport, secrets, host: 'desktop', demo: false, codexCli: options.codexCli, claudeCodeTerms: 'accepted',
    // Each tool where a search path would have it: an absolute .exe (an absolute command is found where it says).
    locateCli: command => (isAbsolute(command) ? command : join(OWN_TEMP, 'bin', `${command}.exe`)),
  });
  const deps = {
    store, clock, models: port, services: { trust: new TrustService(store), calculator: unused, ontology: unused }, github: unused, secrets,
    host: 'desktop', demo: false, storage: 'experimental-file', claudeCodeTerms: 'accepted',
  } as unknown as VentureDeps;
  await ventureAction(deps, owner, 'admin', 'create', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Monthly bookkeeping for cafes and small shops', ideaDigest: 'synthetic', workingName: 'Ledger Cafe Books',
    country: { code: 'IN', name: 'India', currency: 'INR', minorDigits: 2 } as any, serviceType: 'bookkeeping', status: 'interview', launchStage: 'rehearsal',
    blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  }), { create: true });
  return { store, deps, fake };
}

const call = (deps: VentureDeps, method: string, payload: Record<string, unknown> = {}): Promise<any> => (handlers as any)[method](deps, owner, payload);
const preset = (id: string) => PRESETS.find(item => item.id === id)!;
async function connect(deps: VentureDeps, presetId: string) {
  const spec = preset(presetId);
  const key = spec.kind === 'openai-responses' ? OPENAI_KEY : KEY;
  return call(deps, 'venture.models.connect', { presetId, consentDigest: spec.consentDigest, ...(spec.needsKey ? { apiKey: key } : {}) });
}
const calls = (store: VentureTestStore) => listRecords(store.read(), 'venture-model-call') as ModelCallRecord[];

// ---------------------------------------------------------------------------
// 1. The model that answered (H36)
// ---------------------------------------------------------------------------

test('Anthropic and OpenAI: the call keeps the model the answer names, and the outcome carries it', async () => {
  const { deps, store, fake } = await setup();
  await connect(deps, 'anthropic-haiku-5-5');
  fake.replyHttp = () => anthropicReply('claude-haiku-5-5-20261001');
  const outcome = await deps.models.generate(owner, wordsTask());
  assert.equal(outcome.answeredBy, 'claude-haiku-5-5-20261001');
  assert.equal(calls(store).at(-1)!.answeredBy, 'claude-haiku-5-5-20261001');
  // The "What was sent" list shows it beside the cost.
  const listed = await call(deps, 'venture.models.calls', { limit: 1 });
  assert.equal(listed[0].answeredBy, 'claude-haiku-5-5-20261001');

  // An answer that names no model, or something that is not a model id, is "not reported"; never a guess.
  for (const model of [undefined, '', 'claude haiku; drop', 7, 'x'.repeat(200)]) {
    fake.replyHttp = () => anthropicReply(model);
    const next = await deps.models.generate(owner, wordsTask());
    assert.equal(next.answeredBy, NOT_REPORTED, String(model));
    assert.equal(calls(store).at(-1)!.answeredBy, 'not reported');
  }
  // A failed call that got an answer still records who answered.
  fake.replyHttp = () => anthropicReply('claude-haiku-5-5', 'max_tokens');
  await assert.rejects(deps.models.generate(owner, wordsTask()), code('MODEL_INCOMPLETE'));
  assert.deepEqual([calls(store).at(-1)!.status, calls(store).at(-1)!.answeredBy], ['failed', 'claude-haiku-5-5']);

  await connect(deps, 'openai-gpt-6-luna');
  fake.replyHttp = () => openaiReply('gpt-6-luna-2026-09-30');
  const luna = await deps.models.generate(owner, wordsTask());
  assert.equal(luna.answeredBy, 'gpt-6-luna-2026-09-30');
  // Each call's spend row says who answered it, newest first.
  const { rows } = await listSpend(deps, owner, {});
  assert.deepEqual(rows.map(row => row.by), ['GPT-6 Luna', 'Claude Haiku 5.5', ...Array(5).fill('not reported'), 'Claude Haiku 5.5']);
  // Templates answer with no call and no model.
  const { deps: none } = await setup();
  const template = await none.models.generate(owner, wordsTask());
  assert.deepEqual([template.by, template.answeredBy ?? null], ['template', null]);
});

test('command-line answers: Claude Code names the model in its output; Codex does not, so "not reported"', async () => {
  const { deps, store, fake } = await setup();
  await connect(deps, 'claude-code-cli');
  fake.replyProcess = () => ({
    exitCode: 0, stdout: JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { words: 'Command line words' }, usage: { input_tokens: 10, output_tokens: 5 },
      modelUsage: { 'claude-haiku-5-5': { inputTokens: 40, outputTokens: 3 }, 'claude-sonnet-5-5': { inputTokens: 900, outputTokens: 120 } },
    }),
  });
  const outcome = await deps.models.generate(owner, wordsTask({ purpose: 'blueprint' }));
  assert.equal(outcome.answeredBy, 'claude-sonnet-5-5', 'the model that wrote the most');
  assert.equal(calls(store).at(-1)!.answeredBy, 'claude-sonnet-5-5');

  const executable = join(tmpdir(), 'codex.exe');
  const codex = await setup({
    codexCli: {
      capabilities: {
        evidence: { kind: 'installed-help', executable, version: '0.154.0', helpDigest: 'a'.repeat(64) },
        flags: [...CODEX_CLI_FLAGS], configKeys: CODEX_CLI_CONFIG.map(value => value.split('=')[0]), stdinPrompt: true, sandboxModes: ['read-only'],
      },
      mode: 'local-cli',
    },
  });
  await connect(codex.deps, 'codex-cli');
  codex.fake.replyProcess = () => ({
    exitCode: 0, stdout: [
      { type: 'thread.started', thread_id: 'thread_synthetic' }, { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: JSON.stringify({ words: 'Codex words' }) } },
      { type: 'turn.completed', usage: { input_tokens: 20, output_tokens: 6 } },
    ].map(line => JSON.stringify(line)).join('\n'),
  });
  const answered = await codex.deps.models.generate(owner, wordsTask({ purpose: 'judge' }));
  assert.equal(answered.answeredBy, 'not reported');
  assert.equal(calls(codex.store).at(-1)!.answeredBy, 'not reported');
});

// ---------------------------------------------------------------------------
// 2. A draft names the engine that wrote it (U17)
// ---------------------------------------------------------------------------

function callRecord(fields: Partial<ModelCallRecord>): Omit<ModelCallRecord, 'id' | 'kind' | 'ventureId' | 'memberId' | 'epoch' | 'at'> {
  return {
    purpose: 'delivery', tier: 'main', presetId: 'anthropic-sonnet-5-5', connectionId: 'conn_synthetic', routeKind: 'anthropic-messages', model: 'claude-sonnet-5-5',
    consent: 'approved-preview', endpoint: 'https://api.anthropic.com/v1/messages', payloadText: '{}', payloadDigest: 'payload-digest', payloadTruncated: false,
    containsClientData: true, status: 'completed', approvedDigest: 'payload-digest', approvedAt: null, approvedBy: 'owner', estimatedMaxCostMicros: '1000',
    priceConfirmed: true, usage: { inputTokens: 10, outputTokens: 5 }, costMicros: '60', outputDigest: 'output-digest', error: null, replay: false, ...fields,
  };
}

async function seedCall(env: Env, fields: Partial<ModelCallRecord>): Promise<ModelCallRecord> {
  return ventureAction(env.deps, viewsOwner, 'prepare', 'seed.call', tx => tx.put({ ...tx.base('venture-model-call'), ...callRecord(fields) } as ModelCallRecord));
}

test('written by: the model the provider named, the CLI it ran through, "not reported", or the template', async () => {
  const env = await viewsSetup();
  const state = () => env.store.read();
  const api = await seedCall(env, { answeredBy: 'claude-sonnet-5-5-20261001' });
  const cli = await seedCall(env, { presetId: 'claude-code-cli', routeKind: 'claude-cli', endpoint: 'cli://claude', answeredBy: 'claude-sonnet-5-5' });
  const codex = await seedCall(env, { presetId: 'codex-cli', routeKind: 'codex-cli', endpoint: 'cli://codex', model: 'gpt-6-luna', answeredBy: 'not reported' });
  const other = await seedCall(env, { answeredBy: 'claude-opus-6' });
  const older = await seedCall(env, {});
  const pending = await seedCall(env, { status: 'dispatching', answeredBy: undefined });
  assert.equal(writtenByLine(state(), { servedBy: 'model', callId: api.id }), 'Written by Claude Sonnet 5.5');
  assert.equal(writtenByLine(state(), { servedBy: 'model', callId: cli.id }), 'Written by Claude Sonnet 5.5 through Claude Code');
  assert.equal(writtenByLine(state(), { servedBy: 'model', callId: codex.id }), 'Written by Codex on this computer. It did not report the model.');
  assert.equal(writtenByLine(state(), { servedBy: 'model', callId: other.id }), 'Written by claude-opus-6');
  // A call made before answers were recorded says only the AI it was sent to.
  assert.equal(writtenByLine(state(), { servedBy: 'model', callId: older.id }), 'Written by Claude Sonnet 5.5. The model was not recorded.');
  assert.equal(writtenByLine(state(), { servedBy: 'model', callId: pending.id }), null, 'nothing is claimed before the answer');
  assert.equal(writtenByLine(state(), { servedBy: 'model', callId: null }), null);
  // A call record from before the presets were listed on it never breaks a run view: it says only "your AI".
  const bare = await seedCall(env, { presetId: undefined as any, routeKind: undefined as any });
  assert.equal(writtenByLine(state(), { servedBy: 'model', callId: bare.id }), 'Written by your AI. The model was not recorded.');
  assert.equal(writtenByLine(state(), { servedBy: 'template', callId: null }), "Written by Chausar's template, not your AI");

  // venture.delivery.list carries the line on each draft.
  const plan = await seedBlueprint(env);
  const { order } = await seedOrder(env, plan);
  const drafted = await seedRun(env, order, { status: 'ready-for-review', servedBy: 'model', callId: api.id });
  const outline = await seedRun(env, order, { status: 'ready-for-review', servedBy: 'template', callId: null });
  const runs = await (deliveryHandlers as any)['venture.delivery.list'](env.deps, viewsOwner, {});
  const byId = new Map(runs.map((run: any) => [run.id, run]));
  assert.equal((byId.get(drafted.id) as any).writtenBy, 'Written by Claude Sonnet 5.5');
  assert.equal((byId.get(outline.id) as any).writtenBy, "Written by Chausar's template, not your AI");
});

test('spend rows say who answered a model call: the model in words, or "not reported"; nothing before the answer', async () => {
  const env = await viewsSetup();
  const answered = [
    await seedCall(env, { answeredBy: 'claude-sonnet-5-5-20261001' }),
    await seedCall(env, { presetId: 'claude-code-cli', routeKind: 'claude-cli', endpoint: 'cli://claude', answeredBy: 'claude-sonnet-5-5' }),
    await seedCall(env, { presetId: 'codex-cli', routeKind: 'codex-cli', endpoint: 'cli://codex', model: 'gpt-6-luna', answeredBy: 'not reported' }),
    await seedCall(env, { answeredBy: 'claude-opus-6' }),
    await seedCall(env, { status: 'dispatching', answeredBy: undefined }),
    await seedCall(env, {}),
  ];
  const spends = [];
  for (const record of answered) spends.push(await seedSpend(env, { ref: record.id, micros: '1000' }));
  // A row whose call record is not there names no one.
  spends.push(await seedSpend(env, { ref: 'call_not_kept', micros: '1000' }));
  const { rows } = await (moneyHandlers as any)['venture.spend.list'](env.deps, viewsOwner, {}) as { rows: SpendRow[] };
  assert.deepEqual(spends.map(spend => rows.find(row => row.id === spend.id)!.by), [
    'Claude Sonnet 5.5', 'Claude Sonnet 5.5', 'not reported', 'claude-opus-6', undefined, undefined, undefined,
  ]);
});

// ---------------------------------------------------------------------------
// 3. Per-role models (M19)
// ---------------------------------------------------------------------------

const roles = (env: Env): Promise<RoleModelsView> => (handlers as any)['venture.models.roles'](env.deps, viewsOwner, {});
const ONE_AGENT = 'Your team runs as one agent, so each role uses the AI that serves its kind of job: fast for the work, main for checking and writing. Choose them under Your AI. A different AI for each role is not offered.';

test('roles: the delivery agent with its steps\' tiers, the preset serving each and its price line; no AI means Connect your AI', async () => {
  const env = await viewsSetup();
  assert.deepEqual(await roles(env), { roles: [], line: ONE_AGENT });
  await seedBlueprint(env);
  // Templates serve both tiers: nothing usable, so the agent waits for the owner's AI.
  let view = await roles(env);
  assert.deepEqual(view.roles, [{
    agent: 'delivery', name: 'Bookkeeping agent', tiers: [
      { tier: 'fast', presetId: 'built-in-templates', model: null, price: 'Free. Nothing is sent to any AI.', usable: false },
      { tier: 'main', presetId: 'built-in-templates', model: null, price: 'Free. Nothing is sent to any AI.', usable: false },
    ],
  }]);
  assert.equal(view.line, `${ONE_AGENT} Connect your AI: until then, agents that need it wait.`);
  assert.equal(aiWaitLine(env.deps.models.status(viewsOwner)), 'Connect your AI', "the team view's now line for an idle agent");

  env.models.connected = true;
  view = await roles(env);
  assert.deepEqual(view.roles[0].tiers, [
    { tier: 'fast', presetId: 'anthropic-haiku-5-5', model: 'anthropic-haiku-5-5', price: 'USD 0.1000 in, USD 0.5000 out per million tokens. Anthropic list price for prompts up to 100K tokens, checked 15 Oct 2026.', usable: true },
    { tier: 'main', presetId: 'anthropic-sonnet-5-5', model: 'anthropic-sonnet-5-5', price: 'USD 2.0000 in, USD 10.0000 out per million tokens. Anthropic list price, checked 15 Oct 2026.', usable: true },
  ]);
  assert.equal(view.line, ONE_AGENT);
  assert.equal(aiWaitLine(env.deps.models.status(viewsOwner)), null);
  env.models.usable = false;
  assert.deepEqual((await roles(env)).roles[0].tiers.map(tier => tier.usable), [false, false]);
  assert.equal(aiWaitLine(env.deps.models.status(viewsOwner)), 'Connect your AI', 'an AI that cannot run now leaves agents waiting');
  env.models.usable = true;

  // With the owner's rupee rate the price line shows rupees too, labelled with that rate.
  await ventureAction(env.deps, viewsOwner, 'approve', 'seed.policy', tx => tx.put<SpendPolicyRecord>({
    ...tx.base('venture-spend-policy'), capMicros: null, askAboveMicros: null, rates: [], rupeeRate: { perUsd: '835000', setOn: '2026-10-15' },
  }));
  view = await roles(env);
  assert.equal(view.roles[0].tiers[0].price, 'USD 0.1000 in, USD 0.5000 out per million tokens. Anthropic list price for prompts up to 100K tokens, checked 15 Oct 2026. In rupees: ₹8.35 in, ₹41.75 out at ₹83.50 per $1 (your rate, set 15 Oct 2026).');
  for (const tier of view.roles[0].tiers) assert.deepEqual(houseStyleFindings(tier.price), []);
  assert.deepEqual(houseStyleFindings(view.line), []);
});

test('roles: a flagship team lists each agent role with its own steps\' tiers; code roles and Keeper have none', async () => {
  const env = await viewsSetup();
  const plan = await seedBlueprint(env);
  const delivery = flagshipDelivery('youtube')!;
  await ventureAction(env.deps, viewsOwner, 'admin', 'seed.flagship', tx => {
    const record = tx.put<PlaybookRecord>({
      ...tx.base('venture-playbook'), version: 1, hash: 'youtube-hash', blueprintDigest: plan.digest, serviceType: 'studio',
      steps: structuredClone([...delivery.steps]), validated: true, tierCeiling: 'actor', format: 2, flagship: 'youtube',
    } as PlaybookRecord);
    tx.touch({ playbookId: record.id });
  });
  const view = await roles(env);
  const expected = delivery.roles.filter(role => role.kind === 'agent').map(role => {
    const tiers = new Set(delivery.steps.filter(step => delivery.roleOf[step.id] === role.id).map(step => step.model).filter(tier => tier !== null));
    return { agent: role.id, name: role.name, tiers: (['fast', 'main'] as const).filter(tier => tiers.has(tier)) };
  }).filter(role => role.tiers.length > 0);
  assert.ok(expected.length >= 2, 'the YouTube playbook has more than one agent role');
  assert.deepEqual(view.roles.map(role => ({ agent: role.agent, name: role.name, tiers: role.tiers.map(tier => tier.tier) })), expected);
  assert.equal(view.roles.some(role => role.agent === 'keeper'), false);
});

test('roles never write and need no AI connected; a payload is refused', async () => {
  const env = await viewsSetup();
  await seedBlueprint(env);
  const commits = (env.store as any).commits;
  await roles(env);
  assert.equal((env.store as any).commits, commits);
  await assert.rejects((handlers as any)['venture.models.roles'](env.deps, viewsOwner, { agent: 'delivery' }), (error: any) => error instanceof ChausarError && error.code === 'INVALID_VENTURE_REQUEST');
});
