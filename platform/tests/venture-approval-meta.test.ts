// Ink v2 wave 4 (4J1): what a Today row says beside its title, worked out after the row's digest from records only:
// the client, the business and the time; an expiry only from a real one; waiting long and stale drafts; where an
// approval sends; the attempt on Run again; counts against the platform's limits; the price beside Approve; the change
// count on plan rows; every amount a row states with its proof (a receipt venture.receipt.get serves); the stale click.
import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  BlueprintRecord, ConnectorPostRecord, DeliveryRunRecord, HandoffRequest, InvoiceView, QueueAmount, QueueDecision, QueueList, QueueRow, RowFigureReceipt, SpendRate,
} from '../runtime/venture/contracts.ts';
import { digest, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { paidCall, setSpendPolicy } from '../runtime/venture/money/spend.ts';
import { recordEvidence } from '../runtime/venture/evidence/ledger.ts';
import {
  blueprintBody, CLIENT_NAME, call, code, harness, owner, seedBlueprint, seedOrder, seedRun, setStage, setup, type Env,
} from './venture-views-env.ts';

const DAY = 24 * 60 * 60_000;
const list = async (env: Env) => (await call<QueueList>(env, 'venture.queue.list', {})).rows;
const decide = (env: Env, row: QueueRow, action: string, extra: Record<string, unknown> = {}) =>
  call<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action, ...extra });
const receipt = (env: Env, id: string) => money['venture.receipt.get']!(env.deps, owner, { id }) as Promise<RowFigureReceipt>;
const kindOf = (rows: QueueRow[], kind: QueueRow['kind']) => rows.filter(row => row.kind === kind);
/** Money text as the screens' rule finds it: a currency sign or code and its digits. */
const MONEY = /(?:[₹$€]\s?|\b(?:INR|USD|EUR|GBP|AED|SGD|AUD|CAD)\s?)\d[\d,]*(?:\.\d+)?/g;
const moneyIn = (text: string | undefined) => [...(text ?? '').matchAll(MONEY)].map(match => match[0]);
/** The fields the hooks add after the digest; the rest is what the digest covers. */
const AFTER_DIGEST = ['digest', 'meta', 'sendsTo', 'attempt', 'counts', 'price', 'changeCount', 'preview', 'amounts'] as const;
function sealedDigest(row: QueueRow): string {
  const rest: Record<string, unknown> = { ...row };
  for (const key of AFTER_DIGEST) delete rest[key];
  return digest(rest);
}

const PREVIEW = {
  callId: 'call_1', payloadText: '{"system":"..."}', digest: 'c'.repeat(64), presetId: 'anthropic-sonnet-5-5' as const, model: 'claude-sonnet-5-5',
  endpoint: 'https://api.anthropic.com/v1/messages', estimatedMaxCostMicros: '1000', estimatedMaxCostDisplay: 'USD 0.0010', expiresAt: '2026-10-15T10:30:00.000Z',
};
const FAL: SpendRate = {
  item: 'connector:fal', unit: 'per-call', inputMicrosPerMillion: null, outputMicrosPerMillion: null, microsPerCall: '150000',
  source: 'fal list price', checkedOn: '2026-10-15', confirmed: true, by: 'list',
};

/** A business at approve each with an AI connected, a plan, an order and the playbook in use. */
async function agentBusiness() {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  await setStage(env, 'approve-each');
  env.models.connected = true;
  const playbook = await delivery['venture.delivery.playbook']!(env.deps, owner, {}) as { id: string; hash: string };
  return { env, plan, order, fields: { playbookId: playbook.id, playbookHash: playbook.hash } };
}

async function seedPost(env: Env, connectorId: string, text: string, extra: Partial<ConnectorPostRecord> = {}): Promise<ConnectorPostRecord> {
  return ventureAction(env.deps, owner, 'prepare', 'seed.post', tx => tx.put<ConnectorPostRecord>({
    ...tx.base('venture-connector-post'), connectorId, mode: 'owner-browser-session', account: 'ledgerline', text, agent: null,
    digest: digest({ connectorId, text }), state: 'described', describe: `Post to ${connectorId}.`, risk: null, claimedAt: null, decidedBy: null,
    outcome: null, journal: [], descriptionComplete: true, ...extra,
  }));
}

/** The text an amount points into: its field, and for change count details the line at its index. */
function fieldOf(row: QueueRow, amount: Pick<QueueAmount, 'where' | 'index'>): string | undefined {
  if (amount.where === 'line') return row.line;
  if (amount.where === 'change.before') return row.change?.before;
  if (amount.where === 'change.after') return row.change?.after;
  if (amount.where === 'price') return row.price?.display;
  return row.changeCount?.details[amount.index ?? -1];
}

/**
 * Every money text in a row's line, change, price and change count details is one of its amounts, at its exact place,
 * with a receipt that states it (or the estimate label); every amount points at exactly its own text.
 */
async function assertAmountsProved(env: Env, row: QueueRow) {
  const fields: Pick<QueueAmount, 'where' | 'index'>[] = [
    { where: 'line' }, { where: 'change.before' }, { where: 'change.after' }, { where: 'price' },
    ...(row.changeCount?.details ?? []).map((_, index) => ({ where: 'details' as const, index })),
  ];
  for (const field of fields) {
    const text = fieldOf(row, field) ?? '';
    for (const match of text.matchAll(MONEY)) {
      const amount = row.amounts?.find(item => item.where === field.where && (item.index ?? null) === (field.index ?? null) && item.start === match.index);
      assert.ok(amount, `${row.id}: ${field.where} states ${match[0]} at ${match.index} without an amount`);
      assert.equal(amount.length, match[0].length, `${row.id}: ${match[0]}`);
      if (amount.estimate) continue;
      assert.ok(amount.receiptId, `${row.id}: ${match[0]} has no proof`);
      if (amount.receiptId.startsWith('fig:')) {
        const served = await receipt(env, amount.receiptId);
        assert.ok(served.allowedNumbers.includes(match[0]), `${amount.receiptId} does not state ${match[0]}`);
        assert.equal(served.stale, false, amount.receiptId);
      }
    }
  }
  for (const amount of row.amounts ?? []) {
    assert.equal(fieldOf(row, amount)?.slice(amount.start, amount.start + amount.length), amount.text, `${row.id}: ${amount.text} is not at its place in ${amount.where}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Meta: client, business, time; waiting long; stale drafts
// ---------------------------------------------------------------------------

test('meta: every row names its client, business and time, after its digest; no expiry is made up', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  const outline = await delivery['venture.delivery.run']!(env.deps, owner, { orderId: order.id, useTemplate: true }) as DeliveryRunRecord;
  await money['venture.invoice.prepare']!(env.deps, owner, { orderId: order.id, dueInDays: 15 });
  const rows = await list(env);
  for (const row of rows) {
    assert.ok(row.meta, row.id);
    assert.equal(row.meta.business, 'Ledgerline', row.id);
    assert.equal(row.meta.at, row.createdAt, row.id);
    assert.equal(row.meta.expiresAt, undefined, `${row.id}: nothing here has an expiry of its own`);
    assert.equal(row.meta.waitingLong, undefined, row.id);
    assert.equal(row.digest, sealedDigest(row), `${row.id}: the digest is over the row before its meta`);
  }
  const ai = rows.find(row => row.title === 'Connect your AI')!;
  assert.equal(ai.meta!.client, null);
  const [draft] = kindOf(rows, 'draft');
  assert.deepEqual(draft.viewRef, { kind: 'draft', id: outline.id });
  assert.equal(draft.meta!.client, CLIENT_NAME);
  const [invoice] = kindOf(rows, 'invoice');
  assert.equal(invoice.meta!.client, CLIENT_NAME);
});

test('meta: a row waiting over a day says since when; a draft older than 14 days asks to check it still fits', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  await delivery['venture.delivery.run']!(env.deps, owner, { orderId: order.id, useTemplate: true });
  await money['venture.invoice.prepare']!(env.deps, owner, { orderId: order.id, dueInDays: 15 });
  const before = await list(env);
  env.advance(23 * 60 * 60_000);
  assert.equal(kindOf(await list(env), 'draft')[0].meta!.waitingLong, undefined, 'not yet a day');
  env.advance(2 * 60 * 60_000);
  const day = await list(env);
  assert.equal(kindOf(day, 'draft')[0].meta!.waitingLong, 'Waiting since yesterday');
  assert.equal(kindOf(day, 'draft')[0].meta!.staleDraft, undefined);
  env.advance(14 * DAY);
  const late = await list(env);
  const [draft] = kindOf(late, 'draft');
  assert.equal(draft.meta!.waitingLong, 'Waiting since 15 Oct 2026');
  assert.equal(draft.meta!.staleDraft, 'This draft is 15 days old. Check it still fits.');
  assert.equal(kindOf(late, 'invoice')[0].meta!.staleDraft, undefined, 'an invoice is not a draft reply');
  assert.equal(kindOf(late, 'invoice')[0].meta!.waitingLong, 'Waiting since 15 Oct 2026');
  // Time passing changes no row's id or digest, so a click made on the earlier list is not stale.
  assert.deepEqual(late.map(row => [row.id, row.digest]), before.map(row => [row.id, row.digest]));
});

test('meta: an expiry comes only from a real one: the preview, the spend quote, the post proposal, a timed question', async () => {
  const { env, order, fields } = await agentBusiness();
  await seedRun(env, order, { ...fields, status: 'waiting-for-you', callId: 'call_1', preview: PREVIEW, harness: harness() });
  const asked: HandoffRequest = { to: 'owner', question: 'Which bank account is the main one?', turn: 1, answer: null, answeredBy: null };
  // 4J13's timed question carries its own expiry on the hand-off; the row shows it, never one of its own making.
  await seedRun(env, order, { ...fields, status: 'needs-answer', harness: harness({ phase: 'needs-answer', handoffs: [{ ...asked, expiresAt: '2026-10-16T10:00:00.000Z' } as HandoffRequest] }) });
  await setSpendPolicy(env.deps, owner, { askAboveMicros: '100000' });
  await assert.rejects(paidCall(env.deps, owner, { key: 'render-1', item: 'connector:fal', label: 'Thumbnail render', payer: 'connector:fal', draftDigest: 'b'.repeat(64), list: FAL }, async () => ({ value: 'x', billedMicros: null })), code('QUOTE_WAITING'));
  await seedPost(env, 'x', 'Books closed for September. #books', { expiresAt: '2026-10-15T10:15:00.000Z' });
  const rows = await list(env);
  const send = rows.find(row => row.kind === 'quote' && row.title.startsWith('Send the next step'))!;
  assert.equal(send.meta!.expiresAt, PREVIEW.expiresAt);
  const [question] = kindOf(rows, 'question');
  assert.equal(question.meta!.expiresAt, '2026-10-16T10:00:00.000Z');
  const quote = rows.find(row => row.kind === 'quote' && row.title === 'Approve the cost of Thumbnail render')!;
  const [stored] = listRecords(env.store.read(), 'venture-spend-quote');
  assert.equal(quote.meta!.expiresAt, new Date(Date.parse(stored.at) + 60 * 60_000).toISOString());
  const [post] = kindOf(rows, 'connector');
  assert.equal(post.meta!.expiresAt, '2026-10-15T10:15:00.000Z');
});

// ---------------------------------------------------------------------------
// 2. Where it sends, attempts, counts against limits
// ---------------------------------------------------------------------------

test('sendsTo: a post goes to the public; a turn sent to your own AI or a draft you send yourself names no one', async () => {
  const { env, order, fields } = await agentBusiness();
  await seedRun(env, order, { ...fields, status: 'waiting-for-you', callId: 'call_1', preview: PREVIEW, harness: harness() });
  await seedPost(env, 'linkedin', 'Our cafe books service is open.');
  const rows = await list(env);
  assert.equal(kindOf(rows, 'connector')[0].sendsTo, 'public');
  assert.equal(kindOf(rows, 'quote')[0].sendsTo, undefined);
  for (const row of rows.filter(item => item.kind !== 'connector')) assert.equal(row.sendsTo, undefined, row.id);
});

test('attempt: Run again says which attempt this was and its last error; an expired draft has no error', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  await ventureAction(env.deps, owner, 'prepare', 'seed.call', tx => {
    tx.state.conversations.push({ id: 'call_9', kind: 'venture-model-call', ventureId: tx.venture!.id, status: 'failed', error: { code: 'MODEL_FAILED', message: 'The provider did not answer.' } });
  });
  await seedRun(env, order, { status: 'failed', callId: null });
  env.advance(1000);
  await seedRun(env, order, { status: 'failed', callId: 'call_9' });
  const [failed] = kindOf(await list(env), 'draft');
  assert.equal(failed.title, `The draft for ${CLIENT_NAME} failed`);
  assert.deepEqual(failed.attempt, { n: 2, lastError: 'The provider did not answer.' });

  const second = await agentBusiness();
  await seedRun(second.env, second.order, { ...second.fields, status: 'waiting-for-you', callId: 'call_1', preview: { ...PREVIEW, expiresAt: '2026-10-15T09:00:00.000Z' }, harness: harness() });
  const [expired] = kindOf(await list(second.env), 'draft');
  assert.equal(expired.title, `The draft for ${CLIENT_NAME} needs to start again`);
  assert.deepEqual(expired.attempt, { n: 1, lastError: null });
  for (const row of await list(second.env)) if (!row.actions.some(action => action.id === 'run-again')) assert.equal(row.attempt, undefined, row.id);
});

test('counts: a post row counts its characters, and hashtags where the platform caps them, against the limits register', async () => {
  const env = await setup();
  await seedBlueprint(env, { price2: '1500000' });
  await seedPost(env, 'x', 'Books closed for September. #books');
  await seedPost(env, 'instagram', 'Fresh books, fresh month. #cafe #books #pune');
  const posts = kindOf(await list(env), 'connector');
  const x = posts.find(row => row.title.startsWith('Post to X'))!;
  assert.deepEqual(x.counts, [{ label: 'Characters', count: 34, limit: 280 }]);
  const instagram = posts.find(row => row.title.startsWith('Post to Instagram'))!;
  assert.deepEqual(instagram.counts, [{ label: 'Characters', count: 44, limit: 2200 }, { label: 'Hashtags', count: 3, limit: 5 }]);
  for (const row of (await list(env)).filter(item => item.kind !== 'connector')) assert.equal(row.counts, undefined, row.id);
});

// ---------------------------------------------------------------------------
// 3. The price beside Approve, and every amount with its receipt
// ---------------------------------------------------------------------------

test('price: a turn waiting to go to your AI shows the most it can cost, with a receipt, nothing spent yet and the free way', async () => {
  const { env, order, fields } = await agentBusiness();
  const run = await seedRun(env, order, { ...fields, status: 'waiting-for-you', callId: 'call_1', preview: PREVIEW, harness: harness({ phase: 'write' }) });
  const [send] = kindOf(await list(env), 'quote');
  const id = `fig:cost:${run.id}:call_1`;
  assert.deepEqual(send.price, { display: 'USD 0.0010', receiptId: id, line: 'Nothing spent yet', free: 'Or use the built-in template, free' });
  assert.deepEqual(send.change, { label: 'Most it can cost', after: 'USD 0.0010' }, 'the change itself is what the digest covers');
  assert.deepEqual(send.amounts?.find(amount => amount.where === 'change.after'), { text: 'USD 0.0010', where: 'change.after', start: 0, length: 10, receiptId: id });
  // The judge's notice in the line states its own cost bound: it gets the judge's receipt, at its place in the line.
  const judged = moneyIn(send.line);
  assert.equal(judged.length, 1, send.line);
  assert.deepEqual(send.amounts?.find(amount => amount.where === 'line'),
    { text: judged[0], where: 'line', start: send.line!.indexOf(judged[0]), length: judged[0].length, receiptId: `fig:judge:${run.id}:call_1` });
  await assertAmountsProved(env, send);
  const served = await receipt(env, id);
  assert.deepEqual([served.kind, served.operation, served.subject], ['row-figure', 'venture.row-figure', { type: 'call-cost', recordId: run.id }]);
  assert.deepEqual(served.figures.map(figure => [figure.label, figure.display]), [['Most it can cost', 'USD 0.0010']]);
  assert.match(served.explanation, /worked out by code/);
  // Once the run moved on to another call, the receipt says it is stale.
  await ventureAction(env.deps, owner, 'prepare', 'seed.next', tx => { tx.replace({ ...tx.find('venture-delivery-run', run.id)!, callId: 'call_2', preview: { ...PREVIEW, callId: 'call_2' } }); });
  assert.equal((await receipt(env, id)).stale, true);
  await assert.rejects(receipt(env, `fig:cost:delivery_missing:call_1`), code('RECEIPT_NOT_FOUND'));
});

test('price: a spend quote shows its figure with a receipt; the receipt goes stale once the quote is decided', async () => {
  const env = await setup();
  await seedBlueprint(env, { price2: '1500000' });
  await setSpendPolicy(env.deps, owner, { askAboveMicros: '100000' });
  await assert.rejects(paidCall(env.deps, owner, { key: 'render-1', item: 'connector:fal', label: 'Thumbnail render', payer: 'connector:fal', draftDigest: 'b'.repeat(64), list: FAL }, async () => ({ value: 'x', billedMicros: null })), code('QUOTE_WAITING'));
  const [quote] = kindOf(await list(env), 'quote');
  const [stored] = listRecords(env.store.read(), 'venture-spend-quote');
  assert.deepEqual(quote.price, { display: 'USD 0.1500', receiptId: `fig:quote:${stored.id}`, line: 'Nothing spent yet' });
  await assertAmountsProved(env, quote);
  const served = await receipt(env, `fig:quote:${stored.id}`);
  assert.deepEqual(served.figures.map(figure => [figure.label, figure.display]), [['It may cost', 'USD 0.1500']]);
  assert.equal((await decide(env, quote, 'approve')).outcome, 'done');
  assert.equal((await receipt(env, `fig:quote:${stored.id}`)).stale, true);
});

test('price: a run at its spend cap shows the room it asks for, in rupees at your rate too, every amount with one receipt', async () => {
  const { env, order, fields } = await agentBusiness();
  await setSpendPolicy(env.deps, owner, { inrPerUsd: '83.50' });
  const capped = harness({ used: { turns: 1, toolCalls: 2, costMicros: '199500' } });
  const run = await seedRun(env, order, { ...fields, status: 'waiting-for-you', callId: 'call_1', preview: PREVIEW, harness: capped });
  const [room] = kindOf(await list(env), 'quote');
  assert.equal(room.title, 'Bookkeeping agent reached its spend cap for this run');
  const id = `fig:room:${run.id}:call_1`;
  assert.deepEqual(room.price, { display: 'USD 0.2000', receiptId: id, line: 'Nothing spent yet' });
  assert.ok(moneyIn(room.line).length >= 3, room.line);
  for (const amount of room.amounts ?? []) assert.equal(amount.receiptId, id, amount.text);
  await assertAmountsProved(env, room);
  const served = await receipt(env, id);
  assert.equal(served.subject.type, 'cap-room');
  assert.ok(served.figures.some(figure => figure.display === 'USD 0.2000'));
});

test('amounts: an invoice total keeps its price receipt; a price change gets the plan\'s receipt for both prices', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  const prepared = await money['venture.invoice.prepare']!(env.deps, owner, { orderId: order.id, dueInDays: 15 }) as InvoiceView;
  const [invoice] = kindOf(await list(env), 'invoice');
  assert.deepEqual(invoice.amounts, [{ text: 'INR 2,948.82', where: 'change.after', start: 0, length: 12, receiptId: prepared.invoice.priceReceiptId }]);
  await assertAmountsProved(env, invoice);

  const draft = await seedBlueprint(env, { status: 'draft', version: 2, price1: '299900', price2: '1500000' });
  const [price] = kindOf(await list(env), 'price');
  const id = `fig:plan:${draft.id}`;
  assert.deepEqual(price.amounts?.filter(amount => amount.where.startsWith('change')), [
    { text: 'INR 2,499.00', where: 'change.before', start: 0, length: 12, receiptId: id }, { text: 'INR 2,999.00', where: 'change.after', start: 0, length: 12, receiptId: id },
  ]);
  // The folded detail states both prices again: each is its own span, on its own detail line.
  assert.deepEqual(price.amounts?.filter(amount => amount.where === 'details').map(amount => [amount.index, amount.start, amount.text]), [
    [0, 15, 'INR 2,499.00'], [0, 41, 'INR 2,999.00'],
  ]);
  await assertAmountsProved(env, price);
  const served = await receipt(env, id);
  assert.equal(served.subject.type, 'plan-price');
  assert.match(served.explanation, /You set these prices/);
});

test('amounts: the spend notice states this month\'s spend and the limit, in rupees too, each with the month\'s spend receipt', async () => {
  const env = await setup();
  await seedBlueprint(env, { price2: '1500000' });
  await setSpendPolicy(env.deps, owner, { capMicros: '160000', inrPerUsd: '83.50' });
  assert.equal(await paidCall(env.deps, owner, { key: 'render-1', item: 'connector:fal', label: 'Thumbnail render', payer: 'connector:fal', draftDigest: 'b'.repeat(64), list: FAL }, async () => ({ value: 'done', billedMicros: '150000' })), 'done');
  const alert = (await list(env)).find(row => row.id.startsWith('spend:alert:'))!;
  assert.ok(alert, 'the spend notice is on Today');
  const id = 'fig:spend:2026-10';
  assert.deepEqual(alert.amounts?.map(amount => [amount.text, amount.receiptId]), [['USD 0.1500', id], ['USD 0.1600', id], ['₹12.53', id], ['₹13.36', id], ['₹83.50', id], ['$1', id]]);
  await assertAmountsProved(env, alert);
  const served = await receipt(env, id);
  assert.deepEqual([served.subject, served.stale], [{ type: 'month-spend', recordId: '2026-10' }, false]);
  assert.match(served.explanation, /^1 paid call this month, added in code from the spend ledger: USD 0\.1500, of your monthly limit of USD 0\.1600\./);
});

test('amounts: on a model-inferred suggestion only the new value carries the estimate label; the stored one is not the model\'s', async () => {
  const env = await setup();
  await seedBlueprint(env, { price2: '1500000' });
  await ventureAction(env.deps, owner, 'prepare', 'seed.evidence', tx => {
    recordEvidence(tx, { subject: 'business', field: 'note', value: 'Minimum order INR 399.00', type: 'owner-entered', by: 'owner', source: 'you typed it' });
  });
  env.advance(1000);
  await ventureAction(env.deps, owner, 'prepare', 'seed.evidence', tx => {
    recordEvidence(tx, { subject: 'business', field: 'note', value: 'Minimum order INR 499.00', type: 'model-inferred', by: 'agent', source: 'the agent read the menu' });
  });
  const [row] = kindOf(await list(env), 'question');
  assert.deepEqual([row.change?.before, row.change?.after, row.change?.estimate], ['Minimum order INR 399.00', 'Minimum order INR 499.00', true]);
  assert.deepEqual(row.amounts, [{ text: 'INR 499.00', where: 'change.after', start: 14, length: 10, estimate: true }]);
});

test('amounts: a row that states no amount carries none', async () => {
  const env = await setup();
  await seedBlueprint(env, { status: 'draft' });
  for (const row of await list(env)) {
    assert.equal(row.amounts, undefined, row.id);
    assert.equal(row.price, undefined, row.id);
  }
});

// ---------------------------------------------------------------------------
// 4. The change count on plan rows
// ---------------------------------------------------------------------------

async function seedPlanVersion(env: Env, version: number, change: (body: ReturnType<typeof blueprintBody>) => void): Promise<BlueprintRecord> {
  return ventureAction(env.deps, owner, 'admin', 'seed.blueprint', tx => {
    const body = blueprintBody({ version, price2: '1500000' });
    change(body);
    const record: BlueprintRecord = { ...tx.base('venture-blueprint'), ...body, status: 'draft', digest: '' } as BlueprintRecord;
    const { id: _id, at: _at, digest: _digest, status: _status, ...rest } = record;
    record.digest = digest(rest);
    const stored = tx.put(record);
    tx.touch({ blueprintId: stored.id });
    return stored;
  });
}

test('changeCount: a changed plan says what changed, counted in code, with the details folded and what it does not cover', async () => {
  const env = await setup();
  await seedBlueprint(env, { price2: '1500000' });
  await seedPlanVersion(env, 2, body => {
    body.offers[0].pricing.unitPriceMinor = '299900';
    body.offers.push({ ...body.offers[1], id: 'offer_3', name: { value: 'Year end pack', label: 'assumption', by: 'template' } });
    body.deliverySteps.push({ ...body.deliverySteps[1], id: 'review', title: { value: 'Review with the owner', label: 'assumption', by: 'template' } });
  });
  const [price] = kindOf(await list(env), 'price');
  assert.deepEqual(price.changeCount, {
    line: '1 price changed · 1 offer added · 1 step added',
    details: ['Monthly books: INR 2,499.00 per month to INR 2,999.00 per month', 'Offer added: Year end pack', 'Step added: Review with the owner'],
    coverage: "This comparison doesn't cover wording changes.",
  });
  await assertAmountsProved(env, price);

  const words = await setup();
  await seedBlueprint(words, { price2: '1500000' });
  await seedPlanVersion(words, 2, body => { body.oneLiner = { value: 'Monthly books for cafes, done with care.', label: 'assumption', by: 'template' }; });
  const [plan] = kindOf(await list(words), 'plan');
  assert.deepEqual(plan.changeCount, { line: 'No prices, offers or steps changed', details: [], coverage: "This comparison doesn't cover wording changes." });

  const first = await setup();
  await seedBlueprint(first, { status: 'draft' });
  assert.equal(kindOf(await list(first), 'plan')[0].changeCount, undefined, 'a first plan has nothing to compare with');
});

// ---------------------------------------------------------------------------
// 5. The stale click
// ---------------------------------------------------------------------------

test('a decide on an old digest ran nothing, says so, and returns the new version', async () => {
  const env = await setup();
  await seedBlueprint(env, { price2: '1500000' });
  await seedBlueprint(env, { status: 'draft', version: 2, price1: '299900', price2: '1500000' });
  const [price] = kindOf(await list(env), 'price');
  await seedBlueprint(env, { status: 'draft', version: 3, price1: '349900', price2: '1500000' });
  const stale = await decide(env, price, 'approve');
  assert.equal(stale.outcome, 'stale');
  assert.equal(stale.line, 'This click did not run anything. Here is the new version.');
  assert.equal(stale.latest?.change?.after, 'INR 3,499.00 per month');
  assert.ok(stale.latest?.meta, 'the new version comes with its meta');
  assert.equal(listRecords(env.store.read(), 'venture-queue-decision').length, 0);
});
