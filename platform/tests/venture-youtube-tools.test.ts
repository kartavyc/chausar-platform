// The YouTube playbook's built pieces as agent tools, through a real order (Ink v2 wave 2, package 2E1, rows Y1 and
// Y17). A YouTube business with an order whose transcript came as an SRT file runs turn by turn through
// venture.delivery.approve: the agent writes hooks and code keeps the best two in a table; code builds the edit list
// from segment ids under the rights recorded at intake; code drafts chapters from the pauses, and the package may
// carry their times; code reads a Studio retention export with what was said at each drop. The write step sees what
// code worked out, and the hook check judges the better kept hook. Only the YouTube playbook's agents hold the tools.
// The YouTube upload connector says uploads stay private until the owner chooses, and when to tick the altered or
// synthetic content setting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import type {
  Deliverable, DeliveryRunView, ModelOutcome, ModelPort, ModelPreview, ModelStatusView, ModelTask, PlaybookPatch, PlaybookRecord, SecretShelf, VentureDeps, VentureMethod, WorkTableRecord,
} from '../runtime/venture/contracts.ts';
import { digest, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as coreHandlers } from '../runtime/venture/core/index.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { handlers as deliveryHandlers } from '../runtime/venture/delivery/index.ts';
import { handlers as viewHandlers } from '../runtime/venture/views/index.ts';
import { handlers as buildHandlers } from '../runtime/venture/build/index.ts';
import { playbookGrant } from '../runtime/venture/delivery/harness/loop.ts';
import { applyPatch } from '../runtime/venture/delivery/harness/patches.ts';
import { callTool, hostRefusal, type ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import { runChecks } from '../runtime/venture/delivery/checks.ts';
import { buildEditList, draftChapters, rankHooks, readRetentionExport } from '../runtime/venture/playbooks/youtube/checks.ts';
import { parseTranscript } from '../runtime/venture/playbooks/youtube/transcript.ts';
import { youtubeConnectors } from '../runtime/venture/playbooks/youtube/playbook.ts';
import { platformRule } from '../runtime/venture/playbooks/youtube/platform-rules.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
const YOUTUBE_IDEA = 'Run a YouTube channel that explains personal finance in plain words';
const STUDIO_IDEA = 'A design studio that makes logos and brand kits for cafes in Pune';
const OWN_FOOTAGE = { basis: 'own-footage' as const, holder: 'Asha Rao' };
const REQUEST = 'One long episode on budgets from my raw footage. The transcript is attached.';
const START = '2026-10-21T10:00:00.000Z';

// ---------------------------------------------------------------------------
// Fixtures: a transcript in three topics, hooks, a retention export
// ---------------------------------------------------------------------------

const stamp = (ms: number) => {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};
const TOPICS = [
  ['Budgets start with knowing what comes in.', 'Write down every income source you have.', 'Then list the bills that never change.', 'Budgets fail when bills surprise you.', 'Keep the budget simple and honest.', 'Review the budget when income changes.'],
  ['An emergency fund protects the budget.', 'Keep the emergency fund in a separate account.', 'Build the emergency fund before investing.', 'Emergency savings stop new debt.', 'Refill the emergency fund after using it.', 'Name the emergency account clearly.'],
  ['Investing comes after the safety net.', 'Index funds keep investing boring and cheap.', 'Automate investing on salary day.', 'Ignore investing noise on social media.', 'Rebalance investing once a year.', 'Investing rewards patience above everything.'],
];
/** One line every five seconds, said for four and a half, with a pause of a second and a half between topics. */
function transcriptText(): string {
  const blocks: string[] = [];
  let at = 0, n = 0;
  for (const [topic, lines] of TOPICS.entries()) {
    if (topic) at += 1500;
    for (const line of lines) {
      n += 1;
      blocks.push(`${n}\n${stamp(at)} --> ${stamp(at + 4500)}\n${line}`);
      at += 5000;
    }
  }
  return `${blocks.join('\n\n')}\n`;
}
const TRANSCRIPT = transcriptText();
const CUES = parseTranscript(TRANSCRIPT);

const HOOKS = [
  'Hey guys, welcome back to the channel.',
  'Why does your budget fall apart before the month ends, and how do you stop it?',
  'Your budget is leaking money you never notice, and here is how to stop losing it.',
  'Today we talk about budgets.',
  'Stop wasting your salary on bills you forgot you pay.',
];

const RETENTION = ['Video position (%),Audience retention (%)', '0,100', '2,93', '4,85', '6,80', '10,77', '20,74', '30,70', '40,61', '50,59', '60,57', '80,55', '100,52'].join('\n');
const SHORT_RETENTION = ['Video position (%),Audience retention (%)', '0,100', '50,60', '100,40'].join('\n');

// ---------------------------------------------------------------------------
// A scripted model port: act turns from a script, the write step from a function of its task
// ---------------------------------------------------------------------------

type Turn = { note: string; calls: { tool: string; input: string }[]; finished: boolean };
const turnOf = (note: string, calls: [string, unknown][], finished = false): Turn => ({ note, calls: calls.map(([tool, input]) => ({ tool, input: JSON.stringify(input) })), finished });
const DONE = turnOf('Ready to write the package', [], true);
type Draft = { title: string; sections: { heading: string; parts: { kind: 'text'; text: string; ref: '' }[] }[]; questionsForClient: string[] };
const text = (line: string) => ({ kind: 'text' as const, text: line, ref: '' as const });

class Port implements ModelPort {
  turns: Turn[] = [];
  write: (task: ModelTask<any>) => Draft = () => packageDraft({});
  previewed: ModelTask<any>[] = [];
  clock: () => Date;
  #calls = 0;
  #previews = new Map<string, { digest: string; task: ModelTask<any> }>();
  constructor(clock: () => Date) { this.clock = clock; }
  status(): ModelStatusView {
    const tier = (presetId: 'anthropic-haiku-5-5' | 'anthropic-sonnet-5-5') => ({ presetId, model: presetId, usable: true, reason: 'Uses your Anthropic key.' });
    return {
      connections: [], tiers: { fast: tier('anthropic-haiku-5-5'), main: tier('anthropic-sonnet-5-5') },
      spentThisMonthMicros: '0', spentThisMonthDisplay: 'USD 0.0000', estimate: false, sendPolicy: 'shape', replay: { active: true, label: 'synthetic recording' },
    };
  }
  presets(): never { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async checkCli(): Promise<void> { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async generate<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelOutcome<T>> {
    // Only the plan's template steps call this; a delivery task always waits for approval of its exact text.
    if (!task.template) throw new ChausarError('NO_MODEL_CONNECTED', 'No template.');
    return { value: task.template(), by: 'template', callId: null, presetId: 'built-in-templates', model: null, costMicros: '0', priceConfirmed: true };
  }
  async preview<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelPreview | null> {
    this.previewed.push(task);
    this.#calls += 1;
    const callId = `call_${this.#calls}`;
    const payloadText = JSON.stringify({ system: task.instructions, input: task.input });
    this.#previews.set(callId, { digest: digest(payloadText), task });
    return {
      callId, payloadText, digest: digest(payloadText), presetId: 'anthropic-sonnet-5-5', model: 'stub', endpoint: 'https://api.anthropic.com/v1/messages',
      estimatedMaxCostMicros: '1000', estimatedMaxCostDisplay: 'USD 0.0010', expiresAt: new Date(this.clock().getTime() + 1800000).toISOString(),
    };
  }
  async runPreview<T>(_ctx: Context, callId: string, approved: string, validate: (raw: unknown) => T): Promise<ModelOutcome<T>> {
    const held = this.#previews.get(callId);
    if (!held || held.digest !== approved) throw new ChausarError('APPROVAL_STALE', 'Run it again.');
    this.#previews.delete(callId);
    // Only the agent's turns and the package draft are scripted here; any other call (a judge) gets no answer.
    if (held.task.purpose !== 'agent-turn' && held.task.purpose !== 'delivery') throw new ChausarError('MODEL_OUTPUT_REJECTED', 'This test scripts no other call.');
    const raw = held.task.purpose === 'agent-turn' ? this.turns.shift() ?? DONE : this.write(held.task);
    return { value: validate(structuredClone(raw)), by: 'model', callId, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: '200', priceConfirmed: true };
  }
}

const HANDLERS = { ...coreHandlers, ...moneyHandlers, ...deliveryHandlers, ...viewHandlers, ...buildHandlers } as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<any>>;

/** A business from an idea on the template route: plan priced on every offer, accepted, at approve each, one client. */
async function business(idea: string) {
  const store = new VentureTestStore();
  const ontology = new OntologyService(store), calculator = new CalculatorService(store), trust = new TrustService(store);
  const pack = structuredClone(starterPacks.find(item => item.pack === 'services')!);
  pack.currency = 'INR';
  pack.gstMode = 'unregistered';
  for (const definition of pack.definitions) definition.currency = 'INR';
  await ontology.publish(owner, pack);
  const time = { now: START };
  const clock = () => new Date(time.now);
  const models = new Port(clock);
  const secrets = { get: () => null, set: () => undefined, delete: () => undefined, has: () => false, clear: () => undefined } as unknown as SecretShelf;
  const deps: VentureDeps = {
    store, clock, models, services: { calculator, ontology, trust },
    github: { kind: 'fixture', async read() { throw new ChausarError('GITHUB_READ_FAILED', 'No GitHub here.'); } },
    secrets, host: 'test', demo: true, storage: 'experimental-file',
    connectors: { browser: { probe: async () => ({ present: false, reason: 'No Playwright in this test.' }) } as any },
  };
  const call = (method: VentureMethod, payload: unknown = {}): Promise<any> => {
    const handler = HANDLERS[method];
    assert.ok(handler, `no handler for ${method}`);
    return handler(deps, owner, payload);
  };
  await call('venture.create', { idea, countryCode: 'IN', workingName: 'Test Business' });
  let interview = await call('venture.interview.next', { useTemplate: true });
  for (const question of interview.interview.questions) {
    const answer = question.id === 'q_pricing_model' ? { choiceId: question.choices[0].id } : question.id === 'q_tax' ? { yes: false } : { skipped: true };
    interview = await call('venture.interview.answer', { questionId: question.id, answer });
  }
  const drafted = await call('venture.blueprint.draft', { useTemplate: true });
  const priced = await call('venture.blueprint.update', { patch: { offers: drafted.blueprint.offers.map((offer: any) => ({ id: offer.id, unitPrice: '1000' })) } });
  await call('venture.blueprint.accept', { digest: priced.blueprint.digest });
  await ventureAction(deps, owner, 'approve', 'seed.stage', tx => { tx.touch({ launchStage: 'approve-each' }); });
  const client = await call('venture.client.add', { name: 'Asha Rao', email: 'asha@example.com', countryCode: 'IN' });
  return { deps, call, models, store, client, time };
}
type Env = Awaited<ReturnType<typeof business>>;

/** An order on a YouTube offer with its files added, in the order given (f1, f2 ...). */
async function order(env: Env, offerId: string, files: [string, string][], rights: Record<string, unknown> = OWN_FOOTAGE, request = REQUEST) {
  const made = await env.call('venture.order.create', { clientId: env.client.id, offerId, request, intake: { rights, format: offerId === 'offer_2' ? 'short' : 'long' } });
  for (const [name, content] of files) await env.call('venture.files.add', { orderId: made.id, name, contentBase64: b64(content) });
  return made;
}

/** Runs the order turn by turn, approving each previewed text, until the draft is ready for review. */
async function drive(env: Env, orderId: string): Promise<DeliveryRunView> {
  let run: DeliveryRunView = await env.call('venture.delivery.run', { orderId });
  for (let step = 0; step < 8 && run.status === 'waiting-for-you'; step += 1) {
    run = await env.call('venture.delivery.approve', { runId: run.id, digest: run.preview!.digest });
  }
  assert.equal(run.status, 'ready-for-review', JSON.stringify(run.harness?.toolCalls.map(item => item.envelope)));
  return run;
}

/** Runs the order's act turns and stops with the write step previewed: the next approve sends the package. */
async function untilWrite(env: Env, orderId: string): Promise<DeliveryRunView> {
  let run: DeliveryRunView = await env.call('venture.delivery.run', { orderId });
  for (let step = 0; step < 8 && run.harness?.phase === 'act'; step += 1) {
    run = await env.call('venture.delivery.approve', { runId: run.id, digest: run.preview!.digest });
  }
  assert.equal(run.harness!.phase, 'write');
  return run;
}
const sendWrite = (env: Env, run: DeliveryRunView) => env.call('venture.delivery.approve', { runId: run.id, digest: run.preview!.digest });

/** A package laid out as the YouTube package guidance asks, with the hooks and description lines given. */
function packageDraft(input: { hooks?: string[]; chapters?: string[]; summary?: string[] }): Draft {
  return {
    title: 'Episode package: budgets',
    questionsForClient: [],
    sections: [
      { heading: 'Summary', parts: [...(input.hooks ?? ['Why does your budget fall apart before the month ends, and how do you stop it?']).map(hook => text(`Hook: ${hook}`)), text('A plain episode on budgets, from the client footage.'), ...(input.summary ?? []).map(text)] },
      { heading: 'Title and thumbnail', parts: [text('Title: Budgets that survive the whole month'), text('Thumbnail: STOP THE LEAK')] },
      { heading: 'Description and chapters', parts: [text('Description: A plain guide to budgets, an emergency fund and investing after it.'), ...(input.chapters ?? []).map(text)] },
      { heading: 'Next steps', parts: [text('You watch the cut, then you or the client publish it.')] },
    ],
  };
}

/** The rows of the newest table the run made with a tool, as cells. */
function tableOf(env: Env, tool: string): WorkTableRecord {
  const table = listRecords(env.store.read(), 'venture-work-table').filter(item => item.source.kind === 'computed' && item.source.tool === tool).at(-1);
  assert.ok(table, `no table from ${tool}`);
  return table;
}
const callsOf = (run: DeliveryRunView, tool: string) => run.harness!.toolCalls.filter(item => item.tool === tool);
const playbookCheck = (run: DeliveryRunView, id: string) => {
  const found = run.playbookChecks?.find(item => item.check === id);
  assert.ok(found, `no ${id} check`);
  return found;
};
const grantPatch = (stepId: string, value: string): PlaybookPatch => ({
  id: 'patch_1', level: 'harness', op: 'tools.grant', stepId, value, note: { hypothesis: 'Test.', expectedFixes: [], likelyRegressions: [] }, proposedBy: 'chausar', parentHash: 'h',
});
const worked = (task: ModelTask<any>) => ((task.input as any).worked?.tables ?? []) as { table: string; name: string; columns: string[]; rows: Record<string, string>[] }[];

// ---------------------------------------------------------------------------
// 1. Hooks
// ---------------------------------------------------------------------------

test('hooks: the agent writes five, code keeps the best two in a table, the writer sees them, and the check judges the better kept hook', async () => {
  const env = await business(YOUTUBE_IDEA);
  const made = await order(env, 'offer_1', [['episode.srt', TRANSCRIPT]]);
  const ranked = rankHooks(HOOKS);
  assert.ok(ranked[0].verdict > ranked[1].verdict, 'the two best hooks score differently');
  env.models.turns = [turnOf('Write the hooks and let the scorer keep two', [['files.read', { target: 'f1', part: 'pages' }], ['youtube.hooks', { hooks: HOOKS }]]), DONE];
  const seen: { task: ModelTask<any> | null } = { task: null };
  // The lower scoring kept hook is written first: the check must still judge the better one.
  env.models.write = task => { seen.task = task; return packageDraft({ hooks: worked(task).find(item => item.name === 'Hooks the scorer kept')!.rows.map(row => row.Hook).reverse() }); };
  const run = await drive(env, made.id);

  const [hooks] = callsOf(run, 'youtube.hooks');
  assert.equal(hooks.outcome, 'succeeded', JSON.stringify(hooks.envelope));
  const result = (hooks.envelope as any).result;
  assert.equal(result.table, 't1');
  assert.deepEqual(result.kept.map((item: any) => [item.hook, item.score]), ranked.slice(0, 2).map(item => [item.hook, item.verdict]));
  assert.equal(result.others.length, 3);
  const table = tableOf(env, 'youtube.hooks');
  assert.deepEqual(table.columns, ['Hook', 'Score', 'Band', 'Weakest', 'Fix']);
  assert.deepEqual(table.rows.map(row => [row.cells.Hook, row.cells.Score, row.cells.Band]), ranked.slice(0, 2).map(item => [item.hook, String(item.verdict), item.band]));
  assert.deepEqual(table.source, { kind: 'computed', tool: 'youtube.hooks', uploadIds: [] });
  assert.deepEqual(table.runRef, { kind: 'delivery', runId: run.id });
  assert.deepEqual(run.harness!.tableIds, [table.id]);

  assert.ok(seen.task, 'the write step ran');
  assert.deepEqual(worked(seen.task).map(item => item.table), ['t1'], 'the write step sees what code worked out');
  assert.match((seen.task.input as any).worked.note, /word for word/);

  const check = playbookCheck(run, 'hook-score');
  assert.equal(check.outcome, 'pass', check.detail);
  assert.ok(check.detail.includes(ranked[0].hook), check.detail);
  assert.ok(check.detail.includes(`${ranked[1].verdict} (${ranked[1].band})`), check.detail);
  assert.match(check.detail, /lint, not a forecast/);
});

test('hooks: a package hook the scorer did not keep fails the hook check and blocks Accept; bad hook lists are refused', async () => {
  const env = await business(YOUTUBE_IDEA);
  const made = await order(env, 'offer_1', [['episode.srt', TRANSCRIPT]]);
  const ranked = rankHooks(HOOKS);
  env.models.turns = [turnOf('Score the hooks', [
    ['youtube.hooks', { hooks: ['Only one hook here, and it asks why you never save?'] }],
    ['youtube.hooks', { hooks: ['Why your budget leaks?', 'why  your budget leaks?'] }],
    ['youtube.hooks', { hooks: ['Your budget breaks in 3 places before the month ends.', 'Why your budget leaks before the month ends?'] }],
    ['youtube.hooks', { hooks: HOOKS }],
  ]), turnOf('Score a hook with a hidden character', [['youtube.hooks', { hooks: ['Why your budget\u200b leaks?', 'Why your savings shrink?'] }]]), DONE];
  env.models.write = () => packageDraft({ hooks: [ranked[0].hook, 'Budgets are hard, but you can fix yours this weekend.'] });
  const run = await drive(env, made.id);
  const [one, same, number, good, hidden] = callsOf(run, 'youtube.hooks');
  assert.equal((number.envelope as any).error.code, 'TOOL_FAILED');
  // Only a number is put in the tool's own words; any other refusal of the words keeps its own code and words.
  assert.equal((hidden.envelope as any).error.code, 'MODEL_OUTPUT_REJECTED');
  assert.doesNotMatch((hidden.envelope as any).error.message, /number/);
  assert.match((hidden.envelope as any).error.message, /hidden characters/);
  assert.equal(one.outcome, 'failed');
  assert.match((one.envelope as any).error.message, /at least two hooks/);
  assert.match((same.envelope as any).error.message, /same/);
  assert.match((number.envelope as any).error.message, /number/);
  assert.equal(good.outcome, 'succeeded');
  assert.equal(listRecords(env.store.read(), 'venture-work-table').length, 1, 'only the call that worked made a table');

  const check = playbookCheck(run, 'hook-score');
  assert.equal(check.outcome, 'fail');
  assert.match(check.detail, /This hook is not one the scorer kept\./);
  assert.match(check.detail, /Budgets are hard/);
  assert.equal(run.canAccept, false);
  await assert.rejects(env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' }), code('INVALID_VENTURE_REQUEST'));
});

// ---------------------------------------------------------------------------
// 2. The edit list
// ---------------------------------------------------------------------------

test('edit list: code cuts frame ranges from segment ids under the rights recorded at intake; a wrong id or ended rights are refused', async () => {
  const env = await business(YOUTUBE_IDEA);
  const shorts = await order(env, 'offer_2', [['episode.srt', TRANSCRIPT]]);
  const picks = [{ from: 'seg-2', to: 'seg-4' }, { from: 'seg-8', to: 'seg-9' }];
  env.models.turns = [turnOf('Pick the moments for the shorts', [
    ['youtube.editList', { picks, fps: '30' }],
    ['youtube.editList', { picks: [{ from: 'seg-2', to: 'seg-99' }], fps: '30' }],
  ]), DONE];
  const run = await drive(env, shorts.id);
  const [cut, wrong] = callsOf(run, 'youtube.editList');
  assert.equal(cut.outcome, 'succeeded', JSON.stringify(cut.envelope));
  const expected = buildEditList(CUES, picks, { fps: 30, intake: { rights: { ...OWN_FOOTAGE, reference: null, scope: null, expiresOn: null, recordedAt: START, recordedBy: 'owner' } }, today: '2026-10-21' });
  const result = (cut.envelope as any).result;
  assert.equal(result.fps, 30);
  assert.equal(result.runtimeFrames, expected.runtimeFrames);
  const table = tableOf(env, 'youtube.editList');
  assert.deepEqual(table.columns, ['From', 'To', 'Start frame', 'End frame']);
  assert.deepEqual(table.rows.map(row => [row.cells.From, row.cells.To, row.cells['Start frame'], row.cells['End frame']]), expected.ranges.map(range => [range.from, range.to, String(range.startFrame), String(range.endFrame)]));
  assert.equal(table.source.kind === 'computed' && table.source.uploadIds.length, 1, 'the table names the transcript it was cut from');
  assert.equal(wrong.outcome, 'failed');
  assert.equal((wrong.envelope as any).error.code, 'TOOL_FAILED');
  assert.match((wrong.envelope as any).error.message, /There is no transcript segment seg-99\./);

  // Rights that ended after the order was taken: the cut is refused before anything is built.
  const ended = await order(env, 'offer_2', [['episode.srt', TRANSCRIPT]], { ...OWN_FOOTAGE, expiresOn: '2026-10-25' });
  env.time.now = '2026-11-02T10:00:00.000Z';
  env.models.turns = [turnOf('Pick the moments for the shorts', [['youtube.editList', { picks, fps: '30' }]]), DONE];
  const late = await drive(env, ended.id);
  const [refused] = callsOf(late, 'youtube.editList');
  assert.equal((refused.envelope as any).error.code, 'RIGHTS_REQUIRED');
  assert.match((refused.envelope as any).error.message, /ended on 2026-10-25/);
  assert.equal(listRecords(env.store.read(), 'venture-work-table').filter(item => item.runRef.kind === 'delivery' && item.runRef.runId === late.id).length, 0);
});

// ---------------------------------------------------------------------------
// 3. Chapters
// ---------------------------------------------------------------------------

test('chapters: code drafts them from the pauses, the package carries their times, and the chapter check passes; other times are refused', async () => {
  const env = await business(YOUTUBE_IDEA);
  const made = await order(env, 'offer_1', [['episode.srt', TRANSCRIPT]]);
  const drafted = draftChapters(CUES);
  assert.ok(drafted.valid && drafted.chapters.length >= 3, 'the fixture drafts valid chapters');
  env.models.turns = [turnOf('Draft the chapters', [['youtube.chapters', {}]]), DONE];
  env.models.write = task => {
    const chapters = worked(task).find(item => item.name === 'Chapters drafted from the pauses')!;
    // The writer keeps each time and may retitle; here it keeps the topic words.
    return packageDraft({ chapters: chapters.rows.map(row => `${row.At} ${row.Label}`) });
  };
  const run = await drive(env, made.id);
  const [chapters] = callsOf(run, 'youtube.chapters');
  assert.equal(chapters.outcome, 'succeeded', JSON.stringify(chapters.envelope));
  const result = (chapters.envelope as any).result;
  assert.equal(result.valid, true);
  assert.deepEqual(result.chapters.map((item: any) => item.line), drafted.chapters.map(item => item.line));
  assert.deepEqual(tableOf(env, 'youtube.chapters').columns, ['At', 'Label', 'Length']);
  const check = playbookCheck(run, 'chapters');
  assert.equal(check.outcome, 'pass', check.detail);
  assert.match(check.detail, new RegExp(`${drafted.chapters.length} chapters`));
  // The times are code's: the draft is no model estimate, and the receipt and claim checks pass.
  assert.ok(!run.deliverable!.estimate, 'code-made chapter times do not mark the draft as a model estimate');
  for (const id of ['receipts', 'claims-grounded', 'no-numeric-prose']) {
    const result = run.checks.find(item => item.check === id)!;
    assert.equal(result.passed, true, `${id}: ${result.detail}`);
  }
  assert.equal(run.checks.find(item => item.check === 'no-numeric-prose')!.detail, 'Every number in the draft comes from a receipt.', 'code-made chapter times are not model estimates');
  const lines = drafted.chapters.map(item => item.line);

  // A time code did not draft is still a number the AI wrote: the write step refuses it.
  const second = await order(env, 'offer_1', [['episode.srt', TRANSCRIPT]]);
  env.models.turns = [turnOf('Draft the chapters', [['youtube.chapters', {}]]), DONE];
  env.models.write = () => packageDraft({ chapters: ['0:00 Budgets', '0:07 A time nobody drafted', '1:00 Investing'] });
  await assert.rejects(sendWrite(env, await untilWrite(env, second.id)), code('MODEL_OUTPUT_REJECTED'));

  // A drafted time outside the chapters heading is refused too.
  const third = await order(env, 'offer_1', [['episode.srt', TRANSCRIPT]]);
  env.models.turns = [turnOf('Draft the chapters', [['youtube.chapters', {}]]), DONE];
  env.models.write = () => packageDraft({ chapters: lines, summary: [lines[1]] });
  await assert.rejects(sendWrite(env, await untilWrite(env, third.id)), code('MODEL_OUTPUT_REJECTED'));

  // A run with no chapters call of its own: another run's drafted times are refused, and a package with none is fine.
  const fourth = await order(env, 'offer_1', [['episode.srt', TRANSCRIPT]]);
  env.models.turns = [turnOf('Read the transcript', [['files.read', { target: 'f1', part: 'pages' }]]), DONE];
  env.models.write = () => packageDraft({ chapters: lines });
  await assert.rejects(sendWrite(env, await untilWrite(env, fourth.id)), code('MODEL_OUTPUT_REJECTED'));
  const fifth = await order(env, 'offer_1', [['episode.srt', TRANSCRIPT]]);
  env.models.turns = [turnOf('Read the transcript', [['files.read', { target: 'f1', part: 'pages' }]]), DONE];
  let plainTask: ModelTask<any> | null = null;
  env.models.write = task => { plainTask = task; return packageDraft({}); };
  const plain = await drive(env, fifth.id);
  assert.equal(((plainTask as ModelTask<any> | null)?.input as any)?.worked, undefined, 'nothing code worked out, so the writer gets no worked list');
  assert.equal(playbookCheck(plain, 'chapters').outcome, 'fail', 'a long episode with no chapters still fails its chapter check');

  // Too short a transcript: no table, and the words say why.
  const short = await order(env, 'offer_1', [['short.srt', '1\n00:00:00,000 --> 00:00:04,000\nBudgets in one breath.\n']]);
  env.models.turns = [turnOf('Draft the chapters', [['youtube.chapters', {}]]), DONE];
  env.models.write = () => packageDraft({});
  const run3 = await drive(env, short.id);
  const [few] = callsOf(run3, 'youtube.chapters');
  assert.equal((few.envelope as any).result.valid, false);
  assert.match((few.envelope as any).result.problems[0], /six/);
  assert.deepEqual(run3.harness!.tableIds, []);
});

// ---------------------------------------------------------------------------
// 4. The Studio retention export
// ---------------------------------------------------------------------------

test('retention: code reads the Studio export with what was said at each drop; too few points are refused in the engine\'s words', async () => {
  const env = await business(YOUTUBE_IDEA);
  const made = await order(env, 'offer_1', [['episode.srt', TRANSCRIPT], ['retention.csv', RETENTION], ['short.csv', SHORT_RETENTION]]);
  env.models.turns = [turnOf('Read the retention export', [['youtube.retention', { file: 'f2' }], ['youtube.retention', { file: 'f3' }], ['youtube.retention', { file: 'f1' }]]), DONE];
  const run = await drive(env, made.id);
  const [read, short, wrong] = callsOf(run, 'youtube.retention');
  assert.equal(read.outcome, 'succeeded', JSON.stringify(read.envelope));
  const expected = readRetentionExport(RETENTION, { durationMs: CUES.at(-1)!.endMs, cues: CUES });
  const result = (read.envelope as any).result;
  assert.equal(result.points, 12);
  assert.equal(result.hookLeak, expected.hookLeak);
  assert.equal(result.verdict, expected.verdict);
  assert.deepEqual(result.cliffs, expected.cliffs);
  assert.ok(result.cliffs.some((cliff: any) => typeof cliff.said === 'string' && cliff.said.length > 0), 'a drop says what was said there');
  const table = tableOf(env, 'youtube.retention');
  assert.deepEqual(table.columns, ['From', 'To', 'Lost', 'At', 'Said']);
  assert.equal(table.rows.length, expected.cliffs.length);
  assert.equal((short.envelope as any).error.code, 'TOOL_FAILED');
  assert.match((short.envelope as any).error.message, /at least eight data points/);
  assert.match((wrong.envelope as any).error.message, /not a CSV/);
});

test("no-numeric-prose: only the run's own chapter times under the chapters heading are left out; any other number keeps today's words", () => {
  const times = { heading: 'Description and chapters', codes: ['0:00', '0:35'] };
  const deliverable = (summary: string[], chapters: string[]): Deliverable => ({
    title: 'Episode package', questionsForClient: [],
    sections: [{ heading: 'Summary', parts: summary.map(line => ({ kind: 'text' as const, text: line })) }, { heading: 'Description and chapters', parts: chapters.map(line => ({ kind: 'text' as const, text: line })) }],
  });
  const detail = (draft: Deliverable, withTimes: typeof times | null = times) => runChecks({
    checks: ['no-numeric-prose'], deliverable: draft, renderedText: '', serviceType: 'studio', allowed: [], receipts: [], ventureId: 'venture_1',
    mocks: [], mockModes: {}, agentTurns: 1, turnLimit: 1, askedQuestions: false, ...(withTimes ? { times: withTimes } : {}),
  })[0].detail;
  const EVERY = 'Every number in the draft comes from a receipt.';
  const ESTIMATE = 'Numbers in the words are model estimates with no receipt. Every price comes from a receipt.';
  assert.equal(detail(deliverable(['A plain episode.'], ['0:00 Budgets', '0:35 Emergency fund'])), EVERY);
  assert.equal(detail(deliverable(['A plain episode.'], ['0:00 Budgets', '0:35 Emergency fund']), null), ESTIMATE, "without the run's times, a time is a number");
  assert.equal(detail(deliverable(['0:35 Emergency fund'], ['0:00 Budgets'])), ESTIMATE, 'a code time outside the chapters heading');
  assert.equal(detail(deliverable(['A plain episode.'], ['0:00 Budgets', '0:07 Not drafted'])), ESTIMATE, 'a time code did not draft');
  assert.equal(detail(deliverable(['A plain episode.'], ['0:00 Budgets in 3 steps'])), ESTIMATE, "a number after the time is still the model's");
});

// ---------------------------------------------------------------------------
// 4a. What reaches the writer, under the untrusted screen; rights with no intake
// ---------------------------------------------------------------------------

test('screen: the writer gets only the kept hooks and the chapters, as screened; under enforce a PAN never reaches it', async () => {
  const env = await business(YOUTUBE_IDEA);
  await env.call('venture.untrusted.mode', { mode: 'enforce' });
  const pan = ['ABCPE', '1234', 'F'].join('');
  const spoken = TRANSCRIPT.replace('Name the emergency account clearly.', `Note my PAN ${pan} before we go on.`);
  assert.notEqual(spoken, TRANSCRIPT);
  const made = await order(env, 'offer_1', [['episode.srt', spoken], ['retention.csv', RETENTION]], OWN_FOOTAGE, `${REQUEST} My PAN is ${pan}.`);
  env.models.turns = [turnOf('Score hooks, cut, draft chapters and read retention', [
    ['youtube.hooks', { hooks: [`Why does ${pan} matter to your budget before the month ends?`, 'Hey guys, welcome back to the channel.', 'Today we talk about budgets.'] }],
    ['youtube.editList', { picks: [{ from: 'seg-2', to: 'seg-4' }], fps: '30' }],
    ['youtube.chapters', {}],
    ['youtube.retention', { file: 'f2' }],
  ]), DONE];
  let seen: ModelTask<any> | null = null;
  env.models.write = task => { seen = task; return packageDraft({}); };
  const run = await drive(env, made.id);
  assert.deepEqual(run.harness!.toolCalls.map(item => [item.tool, item.outcome]), [['youtube.hooks', 'succeeded'], ['youtube.editList', 'succeeded'], ['youtube.chapters', 'succeeded'], ['youtube.retention', 'succeeded']]);
  assert.ok(tableOf(env, 'youtube.hooks').rows.some(row => row.cells.Hook.includes(pan)), 'the stored table keeps what the agent wrote');
  const task = seen as ModelTask<any> | null;
  assert.ok(task);
  assert.deepEqual(worked(task).map(item => item.name), ['Hooks the scorer kept', 'Chapters drafted from the pauses'], 'never the edit list, the retention drops or another table');
  const words = JSON.stringify((task.input as any).worked);
  assert.ok(!words.includes(pan), words);
  assert.match(words, /redacted PAN/, 'the screened hook, not the raw one');
});

test('edit list: with no intake, as in a rehearsal, the cut is refused for want of rights and nothing is made', async () => {
  const file = {
    id: 'upload_episode', name: 'episode.srt', format: 'transcript' as const, bytes: Buffer.byteLength(TRANSCRIPT), digest: digest(TRANSCRIPT),
    contentBase64: b64(TRANSCRIPT), clientData: false,
  };
  const env: ToolEnv = {
    deps: { services: {} } as unknown as VentureDeps, ventureId: 'venture_1', memberId: 'owner', epoch: 1, currency: 'INR', dateOrder: 'day-month-year',
    runRef: { kind: 'rehearsal', scenarioId: 'youtube', episode: 0 }, files: [file], tables: [], receipts: [], dictionary: [],
    sandbox: undefined, now: () => START, allowed: [], intake: null,
  };
  const outcome = await callTool(env, ['youtube.editList'], 1, 0, { tool: 'youtube.editList', input: JSON.stringify({ picks: [{ from: 'seg-2', to: 'seg-4' }], fps: '30' }) });
  assert.equal(outcome.record.envelope.ok, false);
  assert.equal((outcome.record.envelope as any).error.code, 'RIGHTS_REQUIRED');
  assert.deepEqual(env.tables, []);
});

// ---------------------------------------------------------------------------
// 5. Grants
// ---------------------------------------------------------------------------

test('grants: the YouTube steps hold the four tools; another studio business is never granted them, even by a patch', async () => {
  const env = await business(YOUTUBE_IDEA);
  const record: PlaybookRecord = await env.call('venture.delivery.playbook');
  const tools = (id: string) => record.steps.find(step => step.id === id)!.tools ?? [];
  assert.ok(tools('intake').includes('youtube.retention'));
  for (const tool of ['files.read', 'youtube.hooks', 'youtube.editList', 'youtube.chapters'] as const) assert.ok(tools('find').includes(tool), tool);
  const grant = playbookGrant(record);
  for (const tool of ['youtube.hooks', 'youtube.editList', 'youtube.chapters', 'youtube.retention'] as const) {
    assert.ok(grant.includes(tool), tool);
    assert.equal(hostRefusal('hosted-web', tool), null, 'code tools run on the hosted server too');
  }

  const studio = await business(STUDIO_IDEA);
  const plain: PlaybookRecord = await studio.call('venture.delivery.playbook');
  assert.equal(plain.serviceType, 'studio');
  assert.equal('flagship' in plain, false);
  assert.ok(!playbookGrant(plain).some(tool => tool.startsWith('youtube.')));
  const body = { steps: plain.steps, limits: plain.limits!, aliases: plain.aliases ?? {} };
  assert.throws(() => applyPatch(body, grantPatch('work', 'youtube.hooks'), { serviceType: 'studio', entryIds: [], flagship: null }), code('INVALID_VENTURE_REQUEST'));
  const own = { steps: record.steps, limits: record.limits!, aliases: record.aliases ?? {} };
  const patched = applyPatch(own, grantPatch('clarify', 'youtube.chapters'), { serviceType: 'studio', entryIds: [], flagship: 'youtube' });
  assert.ok(patched.steps.find(step => step.id === 'clarify')!.tools!.includes('youtube.chapters'), 'the YouTube playbook may hand its own tool to another of its steps');
});

// ---------------------------------------------------------------------------
// 6. Y17: the upload connector's facts
// ---------------------------------------------------------------------------

test('Y17: the YouTube upload says uploads stay private until the owner chooses, and when to tick the altered or synthetic setting', async () => {
  const env = await business(YOUTUBE_IDEA);
  const cards = await env.call('venture.connectors.list', {});
  const youtube = cards.find((card: any) => card.id === 'youtube');
  const handoff = youtube.postingOptions.find((option: any) => option.mode === 'handoff');
  const upload = youtubeConnectors({ ffmpeg: false }).find(item => item.id === 'youtube-upload')!;
  const uploadHandoff = upload.posting.find(option => option.mode === 'handoff')!;
  for (const words of [youtube.note, handoff.what, uploadHandoff.what]) {
    assert.match(words, /private until you choose/, words);
    assert.match(words, /altered or synthetic (content )?setting/, words);
    assert.match(words, /AI voice or presenter/, words);
    assert.ok(words.length <= 200, words);
  }
  // The old fact (unaudited uploads locked to private) lives only as what the rule said before.
  const old = /locked to private until|until the project passed an audit/i;
  assert.doesNotMatch(JSON.stringify(cards), old);
  assert.doesNotMatch(JSON.stringify(youtubeConnectors({ ffmpeg: true })), old);
  assert.match(platformRule('api-upload-privacy').previously!.rule, old);
});
