// P2-spend tests: reserve-then-settle spend on every paid call, unpriced calls refused, a charge record written
// before each call so a retry never pays twice, the owner's rate card, the monthly cap, and quotes bound to a draft,
// a figure and a payer for one hour. Every expected amount is worked out by hand in a comment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { TrustService } from '../runtime/trust.ts';
import { METHOD_OWNERS, VENTURE_ERRORS, VENTURE_METHODS } from '../runtime/venture/contracts.ts';
import type { ModelHttpResponse, ModelTask, ModelTransport, SecretName, SecretShelf, SpendRate, VentureDeps } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { PRESETS, createModelPort, handlers as modelHandlers } from '../runtime/venture/models/index.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { QUOTE_TTL_MS, checkQuoteBinding } from '../runtime/venture/money/quote.ts';
import {
  approveSpendQuote, listSpend, openSpendQuotes, paidCall, resolveRate, setSpendPolicy,
} from '../runtime/venture/money/spend.ts';
import { delegateSpend, delegateSpendOutcome, reportedCostMicros } from '../runtime/venture/delivery/harness/delegate.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const phone: Context = { ...owner, channel: 'phone' };
const START = Date.parse('2026-10-15T09:00:00.000Z'); // at or before real time
const KEY = 'sk-ant-test-not-a-real-key-0000';
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const DRAFT = 'a'.repeat(64);

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
function anthropicReply(value: unknown, usage = { input_tokens: 812, output_tokens: 164 }): ModelHttpResponse {
  return {
    status: 200,
    body: JSON.stringify({
      id: 'msg_synthetic', type: 'message', role: 'assistant', model: 'synthetic',
      content: [{ type: 'text', text: JSON.stringify(value) }], stop_reason: 'end_turn', stop_details: null, usage,
    }),
  };
}

const unused = new Proxy({}, { get() { throw new Error('This service is not used by the spend tests.'); } });

async function setup() {
  let now = START;
  const clock = () => new Date(now);
  const advance = (ms: number) => { now += ms; };
  const store = new VentureTestStore();
  const secrets = new MemoryShelf();
  const http: unknown[] = [];
  let reply: () => Promise<ModelHttpResponse> | ModelHttpResponse = () => anthropicReply({ words: 'Model words' });
  const transport: ModelTransport = {
    replay: false,
    async http(request) { http.push(request); return reply(); },
    async process() { return { exitCode: 1, stdout: '' }; },
  };
  const port = createModelPort({ store, clock, transport, secrets, host: 'test', demo: false, claudeCodeTerms: 'accepted' });
  const deps = {
    store, clock, models: port, services: { trust: new TrustService(store), calculator: unused, ontology: unused }, github: unused, secrets,
    host: 'test', demo: false, storage: 'experimental-file', claudeCodeTerms: 'accepted',
  } as unknown as VentureDeps;
  await ventureAction(deps, owner, 'admin', 'create', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Monthly bookkeeping for cafes and small shops', ideaDigest: 'synthetic', workingName: 'Ledger Cafe Books',
    country: { code: 'IN', name: 'India', currency: 'INR', minorDigits: 2 } as any, serviceType: 'bookkeeping', status: 'interview', launchStage: 'rehearsal',
    blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  }), { create: true });
  return { store, deps, http, advance, setReply: (next: typeof reply) => { reply = next; } };
}

async function connectHaiku(deps: VentureDeps) {
  const spec = PRESETS.find(item => item.id === 'anthropic-haiku-5-5')!;
  return (modelHandlers as any)['venture.models.connect'](deps, owner, { presetId: spec.id, consentDigest: spec.consentDigest, apiKey: KEY });
}

const rows = async (deps: VentureDeps) => listSpend(deps, owner, {});
const spendRecords = (store: VentureTestStore) => listRecords(store.read(), 'venture-spend') as any[];

/** An owner rate for a paid connector: a fixed price per call, in micro-USD. */
function perCall(item: string, micros: string, confirmed = true): SpendRate {
  return { item, unit: 'per-call', inputMicrosPerMillion: null, outputMicrosPerMillion: null, microsPerCall: micros, source: 'Typed by the owner', checkedOn: '2026-10-15', confirmed, by: 'owner' };
}
/** A paid connector request: one video render, priced per call by the rate card. */
function render(key: string, digest = DRAFT, payer = 'connector:fal') {
  return { key, item: 'connector:fal-video', label: 'One video render', payer, draftDigest: digest, list: null, connector: 'fal-video' };
}

// ---------------------------------------------------------------------------
// Prices: the owner's rate card over list prices, and unpriced calls refused
// ---------------------------------------------------------------------------

test('resolveRate: the owner rate card overrides a list price; a list price is used without one; no price at all is refused', () => {
  const list: SpendRate = { item: 'model:anthropic-haiku-5-5', unit: 'per-million-tokens', inputMicrosPerMillion: '100000', outputMicrosPerMillion: '500000', microsPerCall: null, source: 'Anthropic list price', checkedOn: '2026-10-15', confirmed: true, by: 'list' };
  const mine: SpendRate = { ...list, inputMicrosPerMillion: '80000', source: 'My contract rate', confirmed: false, by: 'owner' };
  assert.deepEqual(resolveRate({ item: list.item, list, owner: [mine] }), mine, 'the owner rate wins and keeps its own confirmed flag');
  assert.deepEqual(resolveRate({ item: list.item, list, owner: [perCall('connector:other', '1')] }), list);
  assert.throws(() => resolveRate({ item: 'connector:fal-video', list: null, owner: [] }), code('SPEND_UNPRICED'));
  // A half-filled entry is no price: per-million needs both rates, per-call needs its price.
  assert.throws(() => resolveRate({ item: list.item, list: { ...list, outputMicrosPerMillion: null }, owner: [] }), code('SPEND_UNPRICED'));
  assert.throws(() => resolveRate({ item: 'connector:x', list: null, owner: [{ ...perCall('connector:x', '1'), microsPerCall: null }] }), code('SPEND_UNPRICED'));
});

test('a connector with no rate is refused before the call, never counted as free, and the refusal is listed', async () => {
  const { deps } = await setup();
  let ran = 0;
  await assert.rejects(paidCall(deps, owner, render('render-1'), async () => { ran += 1; return { value: 'video', billedMicros: '1' }; }), code('SPEND_UNPRICED'));
  assert.equal(ran, 0, 'nothing was paid for');
  const list = await rows(deps);
  assert.equal(list.rows.length, 1);
  assert.equal(list.rows[0].kind, 'refused');
  assert.equal(list.rows[0].label, 'One video render');
  assert.equal(list.rows[0].reserved, 'No price');
  assert.equal(list.total, 'USD 0.0000 this month');
});

// ---------------------------------------------------------------------------
// Reserve, then settle, with a charge record before the call
// ---------------------------------------------------------------------------

test('reserve then settle: the charge record is written before the call, then settled with the billed amount', async () => {
  const { deps, store } = await setup();
  await setSpendPolicy(deps, owner, { rates: [perCall('connector:fal-video', '150000')] });
  const value = await paidCall(deps, owner, render('render-1'), async () => {
    const [held] = spendRecords(store);
    assert.equal(held.phase, 'reserved', 'the record exists before the paid call runs');
    assert.equal(held.reservedMicros, '150000');
    assert.equal(held.key, 'render-1');
    return { value: 'video-1', billedMicros: '120000' };
  });
  assert.equal(value, 'video-1');
  const list = await rows(deps);
  // Reserved 150,000 micros is USD 0.1500; billed 120,000 micros is USD 0.1200.
  assert.deepEqual(list.rows.map(row => ({ kind: row.kind, reserved: row.reserved, settled: row.settled, connector: row.connector })),
    [{ kind: 'billed', reserved: 'USD 0.1500', settled: 'USD 0.1200', connector: 'fal-video' }]);
  assert.equal(list.total, 'USD 0.1200 this month');
});

test('a retry never pays twice: the same key is refused while held or once paid, and a lost answer stays held', async () => {
  const { deps } = await setup();
  await setSpendPolicy(deps, owner, { rates: [perCall('connector:fal-video', '150000')] });
  let ran = 0;
  await paidCall(deps, owner, render('render-1'), async () => { ran += 1; return { value: 'ok', billedMicros: '150000' }; });
  await assert.rejects(paidCall(deps, owner, render('render-1'), async () => { ran += 1; return { value: 'again', billedMicros: '150000' }; }), code('SPEND_ALREADY_CHARGED'));
  assert.equal(ran, 1);

  // The answer is lost: the money may have moved, so the row stays held at its estimate and the key stays taken.
  await assert.rejects(paidCall(deps, owner, render('render-2'), async () => { ran += 1; throw new Error('socket hang up'); }), /socket hang up/);
  await assert.rejects(paidCall(deps, owner, render('render-2'), async () => { ran += 1; return { value: 'again', billedMicros: '1' }; }), code('SPEND_ALREADY_CHARGED'));
  assert.equal(ran, 2);
  const lost = (await rows(deps)).rows.find(row => row.settled === undefined)!;
  assert.equal(lost.kind, 'estimate');
  assert.equal(lost.reserved, 'USD 0.1500');
  assert.match(lost.label, /not known/);
  // 150,000 paid plus 150,000 held is 300,000 micros, USD 0.3000; the held part is an estimate.
  assert.equal((await rows(deps)).total, 'USD 0.3000 this month (includes estimates)');
});

test('the monthly cap is hard: a call that would pass it is refused before it runs', async () => {
  const { deps } = await setup();
  await setSpendPolicy(deps, owner, { capMicros: '200000', rates: [perCall('connector:fal-video', '150000')] });
  await paidCall(deps, owner, render('render-1'), async () => ({ value: 'ok', billedMicros: '120000' }));
  let ran = 0;
  // 120,000 spent plus 150,000 reserved is 270,000, over the 200,000 cap.
  await assert.rejects(paidCall(deps, owner, render('render-2'), async () => { ran += 1; return { value: 'no', billedMicros: '1' }; }), (error: any) => {
    assert.equal(error.code, 'SPEND_CAP');
    assert.match(error.message, /USD 0\.2700/);
    assert.match(error.message, /USD 0\.2000/);
    return true;
  });
  assert.equal(ran, 0);
  assert.deepEqual((await rows(deps)).rows.map(row => row.kind), ['refused', 'billed']);
});

test('an unconfirmed owner rate shows every figure as an estimate', async () => {
  const { deps } = await setup();
  await setSpendPolicy(deps, owner, { rates: [perCall('connector:fal-video', '150000', false)] });
  await paidCall(deps, owner, render('render-1'), async () => ({ value: 'ok', billedMicros: '150000' }));
  const [row] = (await rows(deps)).rows;
  assert.equal(row.reserved, 'USD 0.1500 (estimate, price unconfirmed)');
  assert.equal(row.kind, 'billed', 'the connector billed it; only the rate was unconfirmed');
});

test('setting the policy is an owner action inside the app, and refuses malformed amounts and rates', async () => {
  const { deps } = await setup();
  await assert.rejects(setSpendPolicy(deps, phone, { capMicros: '1' }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(setSpendPolicy(deps, owner, { capMicros: '1.5' }), code('INVALID_AMOUNT'));
  await assert.rejects(setSpendPolicy(deps, owner, { askAboveMicros: '-1' }), code('INVALID_AMOUNT'));
  await assert.rejects(setSpendPolicy(deps, owner, { rates: [{ ...perCall('connector:x', '1'), unit: 'per-banana' as any }] }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(setSpendPolicy(deps, owner, { rates: [perCall('connector:x', '1'), perCall('connector:x', '2')] }), code('INVALID_VENTURE_REQUEST'));
  const policy = await setSpendPolicy(deps, owner, { capMicros: '5000000', rates: [perCall('connector:x', '1')] });
  assert.equal(policy.capMicros, '5000000');
  assert.equal(policy.askAboveMicros, null);
  assert.equal(policy.rates[0].by, 'owner');
});

// ---------------------------------------------------------------------------
// Quotes: above the owner's ask-first figure, a quote bound to draft, figure and payer for one hour
// ---------------------------------------------------------------------------

test('checkQuoteBinding: the same draft, figure and payer within the hour pass; any change or a stale quote is refused', () => {
  const quoted = { draftDigest: DRAFT, figure: '150000', payer: 'connector:fal', quotedAt: '2026-10-15T09:00:00.000Z' };
  const offered = { draftDigest: DRAFT, figure: '150000', payer: 'connector:fal' };
  checkQuoteBinding(quoted, offered, '2026-10-15T10:00:00.000Z'); // exactly one hour still holds
  assert.equal(QUOTE_TTL_MS, 3_600_000);
  assert.throws(() => checkQuoteBinding(quoted, { ...offered, draftDigest: 'b'.repeat(64) }, '2026-10-15T09:01:00.000Z'), code('QUOTE_CHANGED'));
  assert.throws(() => checkQuoteBinding(quoted, { ...offered, figure: '150001' }, '2026-10-15T09:01:00.000Z'), code('QUOTE_CHANGED'));
  assert.throws(() => checkQuoteBinding(quoted, { ...offered, payer: 'connector:other' }, '2026-10-15T09:01:00.000Z'), code('QUOTE_CHANGED'));
  assert.throws(() => checkQuoteBinding(quoted, offered, '2026-10-15T10:00:00.001Z'), code('QUOTE_EXPIRED'));
});

test('above the ask-first figure a quote waits for the owner; one approval buys one call', async () => {
  const { deps, store } = await setup();
  await setSpendPolicy(deps, owner, { askAboveMicros: '100000', rates: [perCall('connector:fal-video', '150000')] });
  let ran = 0;
  const run = async () => { ran += 1; return { value: 'video', billedMicros: '150000' }; };
  await assert.rejects(paidCall(deps, owner, render('render-1'), run), code('QUOTE_WAITING'));
  assert.equal(ran, 0);
  // Asking again while it waits opens no second quote.
  await assert.rejects(paidCall(deps, owner, render('render-1'), run), code('QUOTE_WAITING'));
  const quotes = openSpendQuotes(store.read());
  assert.equal(quotes.length, 1);
  const [quote] = quotes;
  assert.equal(quote.figure, 'USD 0.1500');
  assert.equal(quote.figureMicros, '150000');
  assert.equal(quote.draftDigest, DRAFT);
  assert.equal(quote.payer, 'connector:fal');
  assert.equal(quote.label, 'One video render');

  const approve = (overrides: Record<string, unknown> = {}, ctx: Context = owner) =>
    approveSpendQuote(deps, ctx, { quoteId: quote.id, draftDigest: DRAFT, figureMicros: '150000', payer: 'connector:fal', ...overrides });
  await assert.rejects(approve({}, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(approve({ draftDigest: 'b'.repeat(64) }), code('QUOTE_CHANGED'));
  await assert.rejects(approve({ figureMicros: '149999' }), code('QUOTE_CHANGED'));
  await assert.rejects(approve({ payer: 'connector:other' }), code('QUOTE_CHANGED'));
  const approved = await approve();
  assert.equal(approved.status, 'approved');
  await assert.rejects(approve(), code('APPROVAL_STALE'), 'a quote is decided once');

  assert.equal(await paidCall(deps, owner, render('render-1'), run), 'video');
  assert.equal(ran, 1);
  assert.equal(openSpendQuotes(store.read()).length, 0);
  // The approval is spent: the next call of the same size asks again.
  await assert.rejects(paidCall(deps, owner, render('render-2'), run), code('QUOTE_WAITING'));
  assert.equal(ran, 1);
});

test('a quote approved over an hour after it was made is refused, and so is a call whose figure changed since approval', async () => {
  const { deps, store, advance } = await setup();
  await setSpendPolicy(deps, owner, { askAboveMicros: '100000', rates: [perCall('connector:fal-video', '150000')] });
  const run = async () => ({ value: 'video', billedMicros: '150000' });
  await assert.rejects(paidCall(deps, owner, render('render-1'), run), code('QUOTE_WAITING'));
  const [late] = openSpendQuotes(store.read());
  advance(QUOTE_TTL_MS + 1);
  await assert.rejects(approveSpendQuote(deps, owner, { quoteId: late.id, draftDigest: DRAFT, figureMicros: '150000', payer: 'connector:fal' }), code('QUOTE_EXPIRED'));

  // A fresh quote, approved in time; then the owner's rate changes, so the call would cost more than was approved.
  await assert.rejects(paidCall(deps, owner, render('render-2', 'c'.repeat(64)), run), code('QUOTE_WAITING'));
  const fresh = openSpendQuotes(store.read()).find(item => item.draftDigest === 'c'.repeat(64))!;
  await approveSpendQuote(deps, owner, { quoteId: fresh.id, draftDigest: 'c'.repeat(64), figureMicros: '150000', payer: 'connector:fal' });
  await setSpendPolicy(deps, owner, { rates: [perCall('connector:fal-video', '180000')] });
  let ran = 0;
  await assert.rejects(paidCall(deps, owner, render('render-2', 'c'.repeat(64)), async () => { ran += 1; return run(); }), code('QUOTE_CHANGED'));
  assert.equal(ran, 0);
});

// ---------------------------------------------------------------------------
// venture.spend.list and the contract
// ---------------------------------------------------------------------------

test('venture.spend.list is a money read method with an empty payload, listed everywhere a method must be', async () => {
  assert.ok((VENTURE_METHODS as readonly string[]).includes('venture.spend.list'));
  assert.equal(METHOD_OWNERS['venture.spend.list'], 'money');
  assert.equal(typeof moneyHandlers['venture.spend.list'], 'function');
  for (const name of ['SPEND_UNPRICED', 'SPEND_CAP', 'SPEND_ALREADY_CHARGED', 'QUOTE_WAITING', 'QUOTE_CHANGED', 'QUOTE_EXPIRED']) {
    assert.ok((VENTURE_ERRORS as readonly string[]).includes(name), name);
  }
  const { deps } = await setup();
  assert.deepEqual(await moneyHandlers['venture.spend.list']!(deps, owner, {}), { rows: [], total: 'USD 0.0000 this month' });
  await assert.rejects(moneyHandlers['venture.spend.list']!(deps, owner, { limit: 5 }), code('INVALID_VENTURE_REQUEST'));
});

// ---------------------------------------------------------------------------
// The model port: every keyed model call reserves and settles
// ---------------------------------------------------------------------------

test('a keyed model call reserves its most it can cost, then settles at the provider-reported usage', async () => {
  const { deps, store } = await setup();
  await connectHaiku(deps);
  const outcome = await deps.models.generate(owner, wordsTask());
  // Haiku: 812 x 100,000 + 164 x 500,000 = 163,200,000; rounded up per million = 164 micros.
  assert.equal(outcome.costMicros, '164');
  const [callRecord] = listRecords(store.read(), 'venture-model-call') as any[];
  const [record] = spendRecords(store);
  assert.equal(record.key, `model:${callRecord.id}`);
  assert.equal(record.ref, callRecord.id);
  assert.equal(record.payer, `connection:${callRecord.connectionId}`);
  assert.equal(record.draftDigest, callRecord.payloadDigest);
  assert.equal(record.reservedMicros, callRecord.estimatedMaxCostMicros);
  assert.equal(record.phase, 'settled');
  assert.equal(record.settledMicros, '164');
  const [row] = (await rows(deps)).rows;
  assert.equal(row.kind, 'billed');
  assert.equal(row.settled, 'USD 0.0002');
  assert.equal(row.connector, 'anthropic-haiku-5-5');
  assert.equal(row.label, 'Claude Haiku 5.5, interview');
});

test('the owner rate card prices model calls too: the call record and the spend row use the owner rate', async () => {
  const { deps, store } = await setup();
  await connectHaiku(deps);
  const mine: SpendRate = { item: 'model:anthropic-haiku-5-5', unit: 'per-million-tokens', inputMicrosPerMillion: '200000', outputMicrosPerMillion: '1000000', microsPerCall: null, source: 'My contract rate', checkedOn: '2026-10-15', confirmed: false, by: 'owner' };
  await setSpendPolicy(deps, owner, { rates: [mine] });
  const outcome = await deps.models.generate(owner, wordsTask());
  // 812 x 200,000 = 162,400,000; 164 x 1,000,000 = 164,000,000; sum 326,400,000; rounded up per million = 327.
  assert.equal(outcome.costMicros, '327');
  assert.equal(outcome.priceConfirmed, false);
  assert.equal((listRecords(store.read(), 'venture-model-call') as any[])[0].costMicros, '327');
  assert.equal(spendRecords(store)[0].settledMicros, '327');
  assert.equal((await rows(deps)).rows[0].settled, 'USD 0.0003 (estimate, price unconfirmed)');
});

test('a model call past the business cap is refused before anything is sent or recorded as a call', async () => {
  const { deps, store, http } = await setup();
  await connectHaiku(deps);
  await setSpendPolicy(deps, owner, { capMicros: '100' }); // USD 0.0001, below any Haiku estimate
  await assert.rejects(deps.models.generate(owner, wordsTask()), code('SPEND_CAP'));
  assert.equal(http.length, 0);
  assert.equal(listRecords(store.read(), 'venture-model-call').length, 0);
  assert.deepEqual((await rows(deps)).rows.map(row => row.kind), ['refused']);
});

test('a model call whose answer never came stays held at its estimate, never counted as free', async () => {
  const { deps, store, setReply } = await setup();
  await connectHaiku(deps);
  setReply(() => { throw new Error('socket hang up'); });
  await assert.rejects(deps.models.generate(owner, wordsTask()), code('MODEL_FAILED'));
  const [record] = spendRecords(store);
  assert.equal(record.phase, 'unknown');
  const [row] = (await rows(deps)).rows;
  assert.equal(row.kind, 'estimate');
  assert.equal(row.settled, undefined);
});

test('an approved preview reserves at approval, not at preview, and settles after the one send', async () => {
  const { deps, store } = await setup();
  await connectHaiku(deps);
  const preview = await deps.models.preview(owner, wordsTask({ containsClientData: true }));
  assert.ok(preview);
  assert.equal(spendRecords(store).length, 0, 'a preview spends nothing');
  await deps.models.runPreview(owner, preview.callId, preview.digest, validateWords);
  const [record] = spendRecords(store);
  assert.equal(record.key, `model:${preview.callId}`);
  assert.equal(record.reservedMicros, preview.estimatedMaxCostMicros);
  assert.equal(record.settledMicros, '164');
});

// ---------------------------------------------------------------------------
// Heavy work: the cost Claude Code prints, read with BigInt
// ---------------------------------------------------------------------------

test('heavy work: Claude Code reserves its own limit; Codex has no list price until the owner prices its runs', () => {
  const limits = { minutes: 10, maxTurns: 30, budgetMicros: '2000000' };
  const claude = delegateSpend({ cli: 'claude-code', limits, digest: DRAFT, toolCallId: 'tool_1' }, 'delivery_1');
  assert.equal(claude.key, `delegate:delivery_1:tool_1:${DRAFT}`);
  assert.equal(claude.payer, 'plan:claude-code');
  const rate = resolveRate({ item: claude.item, list: claude.list, owner: [] });
  assert.equal(rate.unit, 'per-run-cap');
  assert.equal(rate.microsPerCall, '2000000');
  const codex = delegateSpend({ cli: 'codex', limits: { ...limits, budgetMicros: null }, digest: DRAFT, toolCallId: 'tool_1' }, 'delivery_1');
  assert.equal(codex.list, null);
  assert.throws(() => resolveRate({ item: codex.item, list: codex.list, owner: [], subject: codex }), code('SPEND_UNPRICED'));
  assert.equal(resolveRate({ item: codex.item, list: codex.list, owner: [perCall('delegate:codex', '500000')] }).microsPerCall, '500000');
  // How a run settles: never started is not spent; a printed cost is the tool's report; otherwise the reservation stands.
  assert.deepEqual(delegateSpendOutcome({ started: false, reportedCost: null }), { kind: 'released' });
  assert.deepEqual(delegateSpendOutcome({ started: true, reportedCost: 'USD 0.0421' }), { kind: 'billed', micros: '42100', by: 'tool-report' });
  assert.deepEqual(delegateSpendOutcome({ started: true, reportedCost: null }), { kind: 'reservation' });
});

test('reportedCostMicros reads the cost the tool printed exactly, rounding a sixth decimal place up, and nothing else', () => {
  assert.equal(reportedCostMicros('USD 0.0421'), '42100');
  assert.equal(reportedCostMicros('USD 2'), '2000000');
  assert.equal(reportedCostMicros('USD 0.12345678'), '123457'); // 123456.78 micros, rounded up
  for (const bad of [null, '', 'USD', 'USD -1', 'USD 1e3', 'EUR 1.00', 'USD 0.1.2', 'USD NaN']) assert.equal(reportedCostMicros(bad), null, String(bad));
});
