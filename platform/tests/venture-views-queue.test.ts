// P1-A: Today's queue (venture.queue.list and venture.queue.decide) built from the records the engine keeps.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeliveryRunRecord, InvoiceView, QueueDecision, QueueList, QueueRow } from '../runtime/venture/contracts.ts';
import { digest, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import {
  CLIENT_NAME, call, code, harness, owner, phone, seedBlueprint, seedOrder, seedRun, setStage, setup, type Env,
} from './venture-views-env.ts';

const list = (env: Env, scope?: 'current' | 'all') => call<QueueList>(env, 'venture.queue.list', scope ? { scope } : {});
const decide = (env: Env, row: QueueRow, action: string, extra: Record<string, unknown> = {}) =>
  call<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action, ...extra });
const byKind = (rows: QueueRow[], kind: QueueRow['kind']) => rows.filter(row => row.kind === kind);
/** The digest is over the row as its source made it; Ink v2 wave 4's hooks add meta and previews after it (4J1, 4J3). */
function rowDigest(row: QueueRow): string {
  const { digest: _digest, meta: _meta, sendsTo: _sendsTo, attempt: _attempt, counts: _counts, price: _price, changeCount: _changeCount, preview: _preview, amounts: _amounts, ...rest } = row;
  return digest(rest);
}

test('queue.list: a new plan is the first row, then the setup rows, each with a digest of its own canonical JSON', async () => {
  const env = await setup();
  env.workspace.keep = 'not-made';
  const plan = await seedBlueprint(env, { status: 'draft' });
  const queue = await list(env);
  assert.deepEqual(queue.rows.map(row => [row.kind, row.title]), [
    ['plan', 'Your plan is ready. Read it.'],
    ['setup', 'Connect your AI'],
    ['setup', 'Set your prices'],
    ['setup', 'Keep this business'],
  ]);
  for (const row of queue.rows) {
    assert.equal(row.digest, rowDigest(row), row.id);
    assert.match(row.digest, /^[a-f0-9]{64}$/);
    assert.equal(row.businessId, 'main');
    assert.equal(row.businessName, 'Ledgerline');
    assert.ok(row.actions.length >= 1 && row.actions.length <= 2, row.id);
    assert.equal(row.actions.filter(action => action.primary).length, 1, row.id);
  }
  const [first] = queue.rows;
  assert.deepEqual(first.viewRef, { kind: 'plan', id: plan.id });
  assert.deepEqual(first.actions.map(action => [action.id, action.primary, action.requiresView ?? false]), [['read', false, false], ['approve', true, true]]);
  assert.equal(first.line, 'Monthly books for cafes, drafted with AI help and checked by you.');
  assert.equal(byKind(queue.rows, 'setup')[1].line, 'Catch up clean up has no price yet.');
  assert.equal(queue.needsYou, 4);
  assert.equal(queue.businesses, 1);
  assert.equal(queue.summary, '4 need you');
  // The same records give the same rows and digests.
  assert.deepEqual((await list(env)).rows, queue.rows);
});

test('queue.decide: accepting the plan runs venture.blueprint.accept once, only after the plan was viewed', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { status: 'draft', price2: '1500000' });
  const [row] = (await list(env)).rows;
  assert.equal(row.kind, 'plan');

  const unviewed = await decide(env, row, 'approve');
  assert.deepEqual([unviewed.outcome, unviewed.reason], ['refused', 'VIEW_FIRST']);
  assert.equal(listRecords(env.store.read(), 'venture-record')[0].acceptedBlueprintId, null);

  const done = await decide(env, row, 'approve', { viewed: true });
  assert.equal(done.outcome, 'done');
  assert.equal(done.line, 'Plan accepted.');
  assert.equal(listRecords(env.store.read(), 'venture-record')[0].acceptedBlueprintId, plan.id);
  const [decision] = listRecords(env.store.read(), 'venture-queue-decision');
  assert.equal(decision.rowId, row.id);
  assert.equal(decision.decidedBy, 'owner');
  assert.equal(decision.digest, row.digest);
  assert.equal(decision.action, 'approve');

  const again = await decide(env, row, 'approve', { viewed: true });
  assert.deepEqual([again.outcome, again.reason], ['refused', 'ALREADY_DECIDED']);
  assert.equal(byKind((await list(env)).rows, 'plan').length, 0);
  // Approvals happen inside the app only.
  await assert.rejects(call(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve', viewed: true }, phone), code('APP_APPROVAL_REQUIRED'));
});

test('queue.decide: a changed row is stale and comes back as the latest version; a gone row is resolved elsewhere', async () => {
  const env = await setup();
  await seedBlueprint(env, { status: 'accepted', price2: '1500000' });
  await seedBlueprint(env, { status: 'draft', version: 2, price1: '299900', price2: '1500000' });
  const [price] = (await list(env)).rows;
  assert.equal(price.kind, 'price');
  assert.equal(price.title, 'New price for Monthly books');
  assert.deepEqual(price.change, { label: 'Monthly books', before: 'INR 2,499.00 per month', after: 'INR 2,999.00 per month' });
  assert.deepEqual(price.actions.map(action => [action.id, action.primary, action.secondAsk ?? false]), [['read', false, false], ['approve', true, true]]);

  // The owner changed the price again while the row was open: the old version is stale, the new one comes back.
  const v3 = await seedBlueprint(env, { status: 'draft', version: 3, price1: '349900', price2: '1500000' });
  const stale = await decide(env, price, 'approve', { viewed: true });
  assert.equal(stale.outcome, 'stale');
  assert.equal(stale.line, 'This click did not run anything. Here is the new version.');
  assert.ok(stale.latest);
  assert.equal(stale.latest.change?.after, 'INR 3,499.00 per month');
  assert.equal(stale.latest.viewRef?.id, v3.id);
  // A wrong digest on the current id is stale too.
  const wrong = await call<QueueDecision>(env, 'venture.queue.decide', { id: stale.latest.id, digest: 'a'.repeat(64), action: 'approve', viewed: true });
  assert.equal(wrong.outcome, 'stale');
  assert.deepEqual(wrong.latest, stale.latest);
  assert.equal(listRecords(env.store.read(), 'venture-queue-decision').length, 0);

  const gone = await call<QueueDecision>(env, 'venture.queue.decide', { id: 'invoice:invoice_missing:abc', digest: 'b'.repeat(64), action: 'issue' });
  assert.deepEqual([gone.outcome, gone.reason, gone.line], ['refused', 'RESOLVED_ELSEWHERE', 'This was resolved elsewhere.']);

  const done = await decide(env, stale.latest, 'approve');
  assert.equal(done.outcome, 'done', 'a price row shows its change inline, so it needs the second ask, not a view');
});

test('queue: a draft reply waits for a read, then Approve runs venture.delivery.review', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  const outline = await delivery['venture.delivery.run']!(env.deps, owner, { orderId: order.id, useTemplate: true }) as DeliveryRunRecord;
  const rows = (await list(env)).rows;
  const [draft] = byKind(rows, 'draft');
  assert.equal(draft.title, `Draft reply for ${CLIENT_NAME}`);
  assert.equal(draft.agent, 'Bookkeeping agent');
  assert.deepEqual(draft.viewRef, { kind: 'draft', id: outline.id });
  assert.deepEqual(draft.actions.map(action => [action.id, action.primary, action.requiresView ?? false]), [['read', false, false], ['approve', true, true]]);
  assert.deepEqual((await decide(env, draft, 'approve')).reason, 'VIEW_FIRST');
  const done = await decide(env, draft, 'approve', { viewed: true });
  assert.equal(done.outcome, 'done');
  assert.equal(done.line, 'Draft accepted. You send it to the client.');
  assert.equal(listRecords(env.store.read(), 'venture-delivery-run').find(run => run.id === outline.id)!.status, 'accepted');
  assert.equal(byKind((await list(env)).rows, 'draft').length, 0);
});

test('queue: a turn waiting to go to the AI is a quote row; a hand-off is a question that needs an answer', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  await setStage(env, 'approve-each');
  env.models.connected = true;
  const playbook = await delivery['venture.delivery.playbook']!(env.deps, owner, {}) as { id: string; hash: string };
  const runFields = { playbookId: playbook.id, playbookHash: playbook.hash };
  const preview = {
    callId: 'call_1', payloadText: '{"system":"..."}', digest: 'c'.repeat(64), presetId: 'anthropic-sonnet-5-5' as const, model: 'claude-sonnet-5-5',
    endpoint: 'https://api.anthropic.com/v1/messages', estimatedMaxCostMicros: '1000', estimatedMaxCostDisplay: 'USD 0.0010', expiresAt: '2026-10-15T10:30:00.000Z',
  };
  const asking = await seedRun(env, order, {
    ...runFields, status: 'needs-answer', harness: harness({ phase: 'needs-answer', handoffs: [{ to: 'owner', question: 'Which bank account is the main one?', turn: 1, answer: null, answeredBy: null }] }),
  });
  const waiting = await seedRun(env, order, { ...runFields, status: 'waiting-for-you', callId: 'call_1', preview, harness: harness() });
  const rows = (await list(env)).rows;
  const [quote] = byKind(rows, 'quote');
  assert.equal(quote.title, `Send the next step for ${CLIENT_NAME} to your AI`);
  assert.deepEqual(quote.change, { label: 'Most it can cost', after: 'USD 0.0010' }, 'worked out by code, so neither a receipt nor a model estimate');
  assert.deepEqual(quote.viewRef, { kind: 'run', id: waiting.id });
  assert.equal(quote.actions.find(action => action.id === 'approve')?.requiresView, true);
  const [question] = byKind(rows, 'question');
  assert.equal(question.line, 'Which bank account is the main one?');
  assert.deepEqual(question.actions.map(action => action.id), ['answer']);
  assert.deepEqual(question.viewRef, { kind: 'run', id: asking.id });
  const empty = await decide(env, question, 'answer');
  assert.deepEqual([empty.outcome, empty.reason], ['refused', 'ANSWER_REQUIRED']);
  // The engine method refuses (the stub port previews nothing): the decision is refused with its code, and nothing is recorded.
  const refused = await decide(env, question, 'answer', { answer: 'The HDFC current account.' });
  assert.deepEqual([refused.outcome, refused.reason], ['refused', 'NO_MODEL_CONNECTED']);
  assert.equal(listRecords(env.store.read(), 'venture-queue-decision').length, 0);
  // Approving the quote reaches venture.delivery.approve; the stub refuses the text as no longer available, the engine
  // marks the spent turn failed, and the decision comes back stale with the new version of the row.
  const stale = await decide(env, quote, 'approve', { viewed: true });
  assert.equal(stale.outcome, 'stale');
  assert.equal(stale.latest?.title, `The draft for ${CLIENT_NAME} failed`);
});

test('queue: an invoice draft is a row with its receipted total; Issue takes the second ask and runs venture.invoice.issue', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  const prepared = await money['venture.invoice.prepare']!(env.deps, owner, { orderId: order.id, dueInDays: 15 }) as InvoiceView;
  const [invoice] = byKind((await list(env)).rows, 'invoice');
  assert.equal(invoice.title, `Invoice for ${CLIENT_NAME}`);
  assert.equal(invoice.line, 'TAX INVOICE, due 30 Oct 2026');
  // Total from the price receipt: INR 2,948.82 (see venture-views-env.ts for the working).
  assert.deepEqual(invoice.change, { label: 'Total', after: 'INR 2,948.82', receiptId: prepared.invoice.priceReceiptId });
  assert.deepEqual(invoice.actions.map(action => [action.id, action.primary, action.secondAsk ?? false]), [['read', false, false], ['issue', true, true]]);
  const issued = await decide(env, invoice, 'issue');
  assert.equal(issued.outcome, 'done');
  assert.equal(issued.line, 'Issued INV-0001.');
  assert.equal(byKind((await list(env)).rows, 'invoice').length, 0);
});

test('queue: Later hides a row until it changes; navigation actions are not decisions; bad requests are refused', async () => {
  const env = await setup();
  await seedBlueprint(env, { status: 'draft' });
  const rows = (await list(env)).rows;
  const ai = rows.find(row => row.title === 'Connect your AI')!;
  const nav = await decide(env, ai, 'connect');
  assert.deepEqual([nav.outcome, nav.reason, nav.line], ['refused', 'NOT_A_DECISION', 'Connect your AI under Connections.']);
  const notOffered = await decide(env, ai, 'issue');
  assert.deepEqual([notOffered.outcome, notOffered.reason], ['refused', 'NOT_OFFERED']);
  const later = await decide(env, ai, 'later');
  assert.deepEqual([later.outcome, later.line], ['done', 'Moved to later.']);
  assert.equal((await list(env)).rows.some(row => row.id === ai.id), false);
  env.models.connected = true;
  env.models.usable = false;
  const changed = (await list(env)).rows.find(row => row.kind === 'setup' && row.title === 'Your AI needs attention');
  assert.ok(changed, 'a new version of the row comes back');
  assert.equal(changed.line, 'Type your Anthropic key again.');

  for (const payload of [{}, { id: ai.id, digest: 'x', action: 'approve' }, { id: ai.id, digest: ai.digest, action: 'launch' }, { id: ai.id, digest: ai.digest, action: 'approve', extra: 1 }, { id: ai.id, digest: ai.digest, action: 'answer', answer: 7 }]) {
    await assert.rejects(call(env, 'venture.queue.decide', payload), code('INVALID_VENTURE_REQUEST'), JSON.stringify(payload));
  }
  await assert.rejects(call(env, 'venture.queue.list', { scope: 'everything' }), code('INVALID_VENTURE_REQUEST'));
});

test('queue scope all: other businesses on this computer are locked rows, last; the summary counts businesses', async () => {
  const env = await setup();
  await seedBlueprint(env, { status: 'draft', price2: '1500000' });
  env.workspace.others = [
    { id: 'lumen-studio', name: 'Lumen Studio', opens: 'with-this-computer', openedAt: '2026-10-14T09:00:00.000Z' },
    { id: 'old-books', name: null, opens: 'needs-passphrase', openedAt: null },
  ];
  const current = await list(env, 'current');
  assert.equal(byKind(current.rows, 'locked').length, 0);
  const all = await list(env, 'all');
  const locked = byKind(all.rows, 'locked');
  assert.deepEqual(all.rows.slice(-2), locked);
  assert.deepEqual(locked.map(row => [row.businessId, row.businessName, row.title, row.line]), [
    ['lumen-studio', 'Lumen Studio', 'Lumen Studio is locked.', 'Open it to see what needs you.'],
    ['old-books', 'old-books', 'old-books is locked.', 'Open it with its passphrase to see what needs you.'],
  ]);
  assert.deepEqual(locked[0].actions, [{ id: 'open', label: 'Open', primary: true }]);
  const open = await decide(env, locked[0], 'open');
  assert.deepEqual([open.outcome, open.reason, open.line], ['refused', 'NOT_A_DECISION', 'Open Lumen Studio from the business menu.']);
  assert.equal(all.needsYou, 2);
  assert.equal(all.summary, '2 need you. 2 more businesses are locked');

  env.workspace.others = [];
  const nothing = await setup();
  nothing.models.connected = true;
  assert.equal((await list(nothing, 'all')).summary, 'Nothing needs you.');
  nothing.workspace.others = [{ id: 'lumen-studio', name: 'Lumen Studio', opens: 'key-missing', openedAt: null }];
  const onlyLocked = await list(nothing, 'all');
  assert.equal(onlyLocked.summary, 'Nothing needs you here. Lumen Studio is locked.');
  assert.equal(onlyLocked.rows[0].line, 'This computer lost its key. Open it with your recovery code.');
});

test('queue: a builder opened with no repo followed is a connector row; without a host port the queue is this business only', async () => {
  const env = await setup({ workspace: false });
  await seedBlueprint(env, { price2: '1500000' });
  await ventureAction(env.deps, owner, 'prepare', 'seed.handoff', tx => {
    tx.put({ ...tx.base('venture-handoff'), builder: 'lovable', mode: 'link', briefId: 'chb_abcdefgh', briefDigest: 'd', urlChars: 10, urlDigest: 'u', openedAt: tx.now });
  });
  const queue = await list(env, 'all');
  const [connector] = byKind(queue.rows, 'connector');
  assert.equal(connector.title, 'Link the repo Lovable made');
  assert.deepEqual(connector.actions.map(action => action.id), ['connect']);
  assert.equal(connector.businessName, 'Venture test');
  assert.equal(byKind(queue.rows, 'locked').length, 0);
});

test('queue: a failed draft for an open order offers Run again', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  await ventureAction(env.deps, owner, 'prepare', 'seed.call', tx => {
    tx.state.conversations.push({ id: 'call_9', kind: 'venture-model-call', ventureId: tx.venture!.id, status: 'failed', error: { code: 'MODEL_FAILED', message: 'The provider did not answer.' } });
  });
  await seedRun(env, order, { status: 'failed', callId: 'call_9' });
  const [failed] = byKind((await list(env)).rows, 'draft');
  assert.equal(failed.title, `The draft for ${CLIENT_NAME} failed`);
  assert.equal(failed.line, 'The provider did not answer.');
  assert.deepEqual(failed.actions.map(action => [action.id, action.primary]), [['later', false], ['run-again', true]]);
  const again = await decide(env, failed, 'run-again');
  assert.deepEqual([again.outcome, again.line], ['done', 'Started again.']);
  assert.equal(listRecords(env.store.read(), 'venture-delivery-run').length, 2);
});


test('queue.list: the prices row asks to confirm tax while the tax answer is an assumption, not the owner\'s', async () => {
  const setupRow = async (options: { price2?: string; taxAssumed?: boolean }) => {
    const env = await setup();
    await seedBlueprint(env, { status: 'accepted', ...options });
    return (await list(env)).rows.find(row => row.id.startsWith('setup:prices:'));
  };
  const shape = (row: QueueRow | undefined) => row && [row.title, row.line, row.actions.map(item => [item.id, item.label, item.primary])];

  // Prices missing, tax the owner's own: prices only, as before.
  assert.deepEqual(shape(await setupRow({})), ['Set your prices', 'Catch up clean up has no price yet.', [['set-prices', 'Set prices', true]]]);
  // Prices missing and tax assumed: both.
  assert.deepEqual(shape(await setupRow({ taxAssumed: true })),
    ['Confirm your prices and tax', 'Catch up clean up has no price yet, and Chausar assumed you do not charge GST.', [['set-prices', 'Confirm', true]]]);
  // Every price set, tax assumed: tax only.
  assert.deepEqual(shape(await setupRow({ price2: '1500000', taxAssumed: true })),
    ['Confirm your tax', 'Chausar assumed you do not charge GST. Say whether you do.', [['set-prices', 'Confirm tax', true]]]);
  // Every price set and tax the owner's own: no row.
  assert.equal(await setupRow({ price2: '1500000' }), undefined);
});
