// Today's queue, more sources: spend quotes waiting for the owner, posts waiting to go out, and evidence questions
// (a suggested value to use, or a field only the owner can fill). Plus the order of the plan and setup rows when the
// plan is written after the business was made, as it always is with a real clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { BrowserPort, BrowserPostResult, QueueDecision, QueueList, QueueRow, SpendRate } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { paidCall, setSpendPolicy } from '../runtime/venture/money/spend.ts';
import { proposePost } from '../runtime/venture/build/posting.ts';
import { recordEvidence } from '../runtime/venture/evidence/ledger.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { call, code, owner, seedBlueprint, setup, type Env } from './venture-views-env.ts';
import { seedPostDraft } from './venture-post-drafts.ts';

const agentCtx: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'mcp' };
const list = (env: Env) => call<QueueList>(env, 'venture.queue.list', {});
const decide = (env: Env, row: QueueRow, action: string, extra: Record<string, unknown> = {}) =>
  call<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action, ...extra });
const ofKind = async (env: Env, kind: QueueRow['kind']) => (await list(env)).rows.filter(row => row.kind === kind);
const DRAFT = 'b'.repeat(64);
const FAL: SpendRate = {
  item: 'connector:fal', unit: 'per-call', inputMicrosPerMillion: null, outputMicrosPerMillion: null, microsPerCall: '150000',
  source: 'fal list price', checkedOn: '2026-10-15', confirmed: true, by: 'list',
};
const render = (key: string) => ({ key, item: 'connector:fal', label: 'Thumbnail render', payer: 'connector:fal', draftDigest: DRAFT, list: FAL });

test('queue order: the plan leads Today even when it was written after the business was made', async () => {
  const env = await setup();
  env.workspace.keep = 'not-made';
  env.advance(5 * 60_000); // the plan comes minutes after the business, as with any real clock
  await seedBlueprint(env, { status: 'draft' });
  const rows = (await list(env)).rows;
  assert.deepEqual(rows.map(row => [row.kind, row.title]), [
    ['plan', 'Your plan is ready. Read it.'],
    ['setup', 'Connect your AI'],
    ['setup', 'Set your prices'],
    ['setup', 'Keep this business'],
  ]);
});

test('queue: a spend quote is a quote row; Approve takes the second ask and approves exactly the quote shown', async () => {
  const env = await setup();
  await setSpendPolicy(env.deps, owner, { askAboveMicros: '100000' });
  let ran = 0;
  const run = async () => { ran += 1; return { value: 'done', billedMicros: '150000' }; };
  await assert.rejects(paidCall(env.deps, owner, render('render-1'), run), code('QUOTE_WAITING'));
  assert.equal(ran, 0);

  const [row] = await ofKind(env, 'quote');
  assert.ok(row, 'a quote row');
  assert.equal(row.title, 'Approve the cost of Thumbnail render');
  assert.deepEqual(row.change, { label: 'It may cost', after: 'USD 0.1500' });
  assert.deepEqual(row.actions.map(item => [item.id, item.primary, item.secondAsk ?? false]), [['later', false, false], ['approve', true, true]]);

  const done = await decide(env, row, 'approve');
  assert.equal(done.outcome, 'done', done.line);
  const [quote] = listRecords(env.store.read(), 'venture-spend-quote');
  assert.equal(quote.status, 'approved');
  assert.equal(quote.decidedBy, 'owner');
  assert.equal((await ofKind(env, 'quote')).length, 0);
  // One approval pays for one call.
  assert.equal(await paidCall(env.deps, owner, render('render-1'), run), 'done');
  assert.equal(ran, 1);
});

test('queue: a quote over an hour old leaves Today; a fresh refusal asks again', async () => {
  const env = await setup();
  await setSpendPolicy(env.deps, owner, { askAboveMicros: '100000' });
  const run = async () => ({ value: 'done', billedMicros: null });
  await assert.rejects(paidCall(env.deps, owner, render('render-1'), run), code('QUOTE_WAITING'));
  assert.equal((await ofKind(env, 'quote')).length, 1);
  env.advance(61 * 60_000);
  assert.equal((await ofKind(env, 'quote')).length, 0);
  await assert.rejects(paidCall(env.deps, owner, render('render-1'), run), code('QUOTE_WAITING'));
  const rows = await ofKind(env, 'quote');
  assert.equal(rows.length, 1);
  assert.equal(listRecords(env.store.read(), 'venture-spend-quote').length, 2);
});

function browser(results: BrowserPostResult[] = [{ outcome: 'posted', line: 'X showed the post.', url: null }]): BrowserPort {
  return {
    async probe() { return { present: true, reason: 'Playwright with Chromium found on this computer.' }; },
    async post() { return results.shift() ?? { outcome: 'posted', line: 'Posted.', url: null }; },
  };
}

test('queue: a post waiting to go out is a connector row; Approve posts it once and Do not post rejects it', async () => {
  const env = await setup();
  env.deps = { ...env.deps, connectors: { browser: browser(), appReviewed: [], postTimeoutMs: 200 } };
  const draft = await seedPostDraft(env.deps, ['X: Our cafe books service is open for October.', 'X: A second post the owner turns down.']);
  const first = await proposePost(env.deps, agentCtx, { connectorId: 'x', draftId: draft.id, part: 1, agent: 'Marketing agent' });
  const second = await proposePost(env.deps, agentCtx, { connectorId: 'x', draftId: draft.id, part: 2 });

  const rows = await ofKind(env, 'connector');
  assert.equal(rows.length, 2);
  const [one, two] = rows;
  assert.equal(one.title, 'Post to X');
  assert.equal(one.businessId, 'main');
  assert.equal(one.businessName, 'Ledgerline');
  assert.equal(one.agent, 'Marketing agent');
  assert.match(one.line ?? '', /The platform may restrict this account\./);
  assert.deepEqual(one.viewRef, { kind: 'draft', id: first.id });
  assert.deepEqual(one.actions.map(item => [item.id, item.primary, item.secondAsk ?? false, item.requiresView ?? false]),
    [['deny', false, false, false], ['approve', true, true, true]]);

  assert.deepEqual([(await decide(env, one, 'approve')).reason], ['VIEW_FIRST']);
  const posted = await decide(env, one, 'approve', { viewed: true });
  assert.equal(posted.outcome, 'done', posted.line);
  assert.match(posted.line, /^Posted to X\./);
  const denied = await decide(env, two, 'deny');
  assert.equal(denied.outcome, 'done', denied.line);
  const posts = new Map(listRecords(env.store.read(), 'venture-connector-post').map(post => [post.id, post]));
  assert.equal(posts.get(first.id)!.state, 'applied');
  assert.equal(posts.get(second.id)!.state, 'rejected');
  assert.equal((await ofKind(env, 'connector')).length, 0);
});

async function client(env: Env) {
  return (await money['venture.client.add']!(env.deps, owner, { name: 'Cafe Aroma Demo', email: 'owner@aroma.example' })) as { id: string };
}

test('queue: a suggested client field is a question row; Use it applies it, Correct it keeps the owner\'s own value', async () => {
  const env = await setup();
  const { id } = await client(env);
  await ventureAction(env.deps, owner, 'prepare', 'seed.evidence', tx => {
    recordEvidence(tx, { subject: `client:${id}`, field: 'email', value: 'accounts@aroma.example', type: 'model-inferred', by: 'agent' });
  });
  const [row] = await ofKind(env, 'question');
  assert.ok(row, 'an evidence question row');
  assert.equal(row.title, 'A new email for Cafe Aroma Demo');
  assert.deepEqual(row.change, { label: 'Email', before: 'owner@aroma.example', after: 'accounts@aroma.example', estimate: true });
  assert.deepEqual(row.actions.map(item => [item.id, item.primary]), [['answer', false], ['approve', true]]);
  assert.equal(row.agent, 'Bookkeeping agent');

  const used = await decide(env, row, 'approve');
  assert.equal(used.outcome, 'done', used.line);
  const stored = listRecords(env.store.read(), 'venture-client').find(item => item.id === id)!;
  assert.equal(stored.email, 'accounts@aroma.example');
  assert.equal((await ofKind(env, 'question')).length, 0);

  await ventureAction(env.deps, owner, 'prepare', 'seed.evidence', tx => {
    recordEvidence(tx, { subject: `client:${id}`, field: 'email', value: 'wrong@aroma.example', type: 'model-inferred', by: 'agent' });
  });
  const [again] = await ofKind(env, 'question');
  assert.deepEqual([(await decide(env, again, 'answer')).reason], ['ANSWER_REQUIRED']);
  const corrected = await decide(env, again, 'answer', { answer: 'billing@aroma.example' });
  assert.equal(corrected.outcome, 'done', corrected.line);
  assert.equal(listRecords(env.store.read(), 'venture-client').find(item => item.id === id)!.email, 'billing@aroma.example');
  const mine = listRecords(env.store.read(), 'venture-evidence').filter(item => item.value === 'billing@aroma.example');
  assert.deepEqual(mine.map(item => [item.type, item.by, item.applied]), [['owner-entered', 'owner', true]]);
  assert.equal((await ofKind(env, 'question')).length, 0);
});

test('queue: a suggestion for a field with no checked value is applied through venture.evidence.apply', async () => {
  const env = await setup();
  await ventureAction(env.deps, owner, 'prepare', 'seed.evidence', tx => {
    recordEvidence(tx, { subject: 'business', field: 'customer', value: 'Cafes and bakeries in Pune', type: 'model-inferred', by: 'agent' });
  });
  const [row] = await ofKind(env, 'question');
  assert.equal(row.title, 'A new customer for your business');
  assert.deepEqual(row.change, { label: 'Customer', after: 'Cafes and bakeries in Pune', estimate: true });
  assert.equal((await decide(env, row, 'approve')).outcome, 'done');
  const [applied] = listRecords(env.store.read(), 'venture-evidence').filter(item => item.field === 'customer');
  assert.deepEqual([applied.type, applied.applied, applied.by], ['model-inferred', true, 'agent']);
  assert.equal((await ofKind(env, 'question')).length, 0);
});

test('queue: a field only the owner can fill is a question row answered as owner-entered evidence', async () => {
  const env = await setup();
  await ventureAction(env.deps, owner, 'prepare', 'seed.evidence', tx => {
    recordEvidence(tx, { subject: 'business', field: 'postalAddress', value: '', type: 'model-inferred', claim: 'needs-your-data', by: 'agent' });
  });
  const [row] = await ofKind(env, 'question');
  assert.ok(row, 'a needs-your-data row');
  assert.equal(row.title, 'Your business needs its postal address');
  assert.deepEqual(row.actions.map(item => [item.id, item.primary]), [['answer', true]]);
  const answered = await decide(env, row, 'answer', { answer: '12 MG Road, Pune 411001' });
  assert.equal(answered.outcome, 'done', answered.line);
  const kept = listRecords(env.store.read(), 'venture-evidence').filter(item => item.field === 'postalAddress' && item.applied);
  assert.deepEqual(kept.map(item => [item.value, item.type, item.strength]), [['12 MG Road, Pune 411001', 'owner-entered', 'verified']]);
  assert.equal((await ofKind(env, 'question')).length, 0);
});
