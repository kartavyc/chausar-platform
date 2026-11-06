// Ink v2 wave 4 (4J1, O15): one grammar for the lines the engine writes about what happened,
// `<subject> <verb>[ <object>][ · <consequence>]`. A contract test runs each generator through systemLineOk: the lines
// 4J1 writes (decisions, the journal's allowed-by lines, row meta, health, allow for this session), and every journal
// line, Earlier line (what a decision on Today did) and run result a working business makes over fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { DeliveryRunRecord, InvoiceView, JournalEntry, QueueDecision, QueueList, QueueRow, RunSummary, SpendRate } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { paidCall, setSpendPolicy } from '../runtime/venture/money/spend.ts';
import { systemLine, systemLineOk, systemLineProblem } from '../runtime/venture/journal/system-lines.ts';
import { DECISION_WORDS } from '../runtime/venture/journal/decisions.ts';
import { META_WORDS } from '../runtime/venture/views/row-meta.ts';
import { ALLOW_SESSION_WORDS } from '../runtime/venture/policy/allow-session.ts';
import { REFUSED_WORDS } from '../runtime/venture/views/refusals.ts';
import { call, code, harness, owner, seedBlueprint, seedOrder, seedRun, setStage, setup, type Env } from './venture-views-env.ts';

const rows = async (env: Env) => (await call<QueueList>(env, 'venture.queue.list', {})).rows;
const decide = (env: Env, row: QueueRow, action: string, extra: Record<string, unknown> = {}) =>
  call<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action, ...extra });

test('systemLineOk: a subject and its verb first, at most one consequence, one line, no dash, no shouting', () => {
  for (const line of [
    'Plan accepted.', 'Plan accepted · you send it to the client', 'Draft accepted. You send it to the client.', 'The judge is reading this draft.',
    "Allowed by your Auto setting on 'Cut the episode', without asking", 'Waiting since yesterday', 'Issued INV-0001.', '3 need you',
  ]) assert.equal(systemLineProblem(line), null, line);
  for (const [line, problem] of [
    ['', 'empty'], ['Answered.', 'no verb after the subject'], ['accepted the plan', 'no subject first'], [`Plan accepted ${String.fromCodePoint(0x2014)} sent`, 'a dash'], ['Plan accepted -- sent', 'a dash'],
    ['Plan accepted!', 'shouting'], ['Plan accepted. It was sent. The client read it.', 'more than one consequence'], ['Plan accepted:', 'trails off'],
    ['Plan accepted\nSent', 'more than one line'], ['Plan  accepted', 'stray spaces'], [`Plan ${'very '.repeat(60)}accepted`, 'too long'],
  ] as const) assert.equal(systemLineProblem(line), problem, line);
  assert.equal(systemLine('Plan', 'accepted', null, 'you send it to the client'), 'Plan accepted · you send it to the client');
  assert.equal(systemLine('The judge', 'read', 'the draft'), 'The judge read the draft');
  assert.throws(() => systemLine('plan', 'accepted'), code('INVALID_VENTURE_REQUEST'));
});

test('the lines 4J1 writes keep the grammar: decisions, allowed-by lines, row meta, health and allow for this session', () => {
  const lines = [
    DECISION_WORDS.today('Approve', 'Plan accepted.'), DECISION_WORDS.owner('You let it run.'), DECISION_WORDS.timeout('the held call was declined.'),
    DECISION_WORDS.autoRule('Cut the episode'), DECISION_WORDS.sessionRule('Cut the episode'), DECISION_WORDS.autoLine('Cut the episode'),
    DECISION_WORDS.sessionLine('Cut the episode'), DECISION_WORDS.ran('calc.sum'), DECISION_WORDS.ranMany(3, 'calc.sum, files.read'), DECISION_WORDS.journalAction,
    DECISION_WORDS.approved('Issue the invoice for Cafe Aroma Demo.'), DECISION_WORDS.refused('Post to LinkedIn.'), DECISION_WORDS.gate('Cut the episode', 'auto'),
    DECISION_WORDS.gate('Cut the episode', 'hold'), `${DECISION_WORDS.autoLine('Cut the episode')} · ${DECISION_WORDS.calls(3)}`, ALLOW_SESSION_WORDS.locked,
    META_WORDS.yesterday, META_WORDS.since('15 Oct 2026'), META_WORDS.staleDraft(15), META_WORDS.nothingSpent, META_WORDS.free, META_WORDS.coverage, META_WORDS.nothingCounted,
    ALLOW_SESSION_WORDS.done('Read the files'), ALLOW_SESSION_WORDS.reason('Read the files'), REFUSED_WORDS(3),
  ];
  // The change count line ("1 price changed · 2 steps added") is a list of counts, not a line about what happened.
  for (const line of lines) assert.equal(systemLineProblem(line), null, line);
});

const FAL: SpendRate = {
  item: 'connector:fal', unit: 'per-call', inputMicrosPerMillion: null, outputMicrosPerMillion: null, microsPerCall: '150000',
  source: 'fal list price', checkedOn: '2026-10-15', confirmed: true, by: 'list',
};

/** A business that has done a little of everything Today offers: the lines it wrote, by where they show. */
async function workingBusiness(): Promise<{ journal: string[]; earlier: string[]; results: string[] }> {
  const env = await setup();
  const earlier: string[] = [];
  const done = (decision: QueueDecision) => { assert.equal(decision.outcome, 'done', decision.line); earlier.push(decision.line); };
  await seedBlueprint(env, { status: 'draft', price2: '1500000' });
  const [plan] = (await rows(env)).filter(row => row.kind === 'plan');
  done(await decide(env, plan, 'approve', { viewed: true }));
  const ai = (await rows(env)).find(row => row.title === 'Connect your AI');
  if (ai) done(await decide(env, ai, 'later'));
  const { order } = await seedOrder(env, listRecords(env.store.read(), 'venture-blueprint')[0]);
  await delivery['venture.delivery.run']!(env.deps, owner, { orderId: order.id, useTemplate: true });
  const [draft] = (await rows(env)).filter(row => row.kind === 'draft');
  done(await decide(env, draft, 'approve', { viewed: true }));
  await money['venture.invoice.prepare']!(env.deps, owner, { orderId: order.id, dueInDays: 15 }) as InvoiceView;
  const [invoice] = (await rows(env)).filter(row => row.kind === 'invoice');
  done(await decide(env, invoice, 'issue'));
  await setStage(env, 'approve-each');
  // A second order, still open: a draft sent back, then a run that failed and starts again.
  const { order: other } = await seedOrder(env, listRecords(env.store.read(), 'venture-blueprint')[0]);
  const second = await delivery['venture.delivery.run']!(env.deps, owner, { orderId: other.id, useTemplate: true }) as DeliveryRunRecord;
  const reject = (await rows(env)).find(row => row.kind === 'draft' && row.viewRef?.id === second.id)!;
  done(await decide(env, reject, 'deny', { answer: 'tone' }));
  await ventureAction(env.deps, owner, 'prepare', 'seed.call', tx => {
    tx.state.conversations.push({ id: 'call_9', kind: 'venture-model-call', ventureId: tx.venture!.id, status: 'failed', error: { code: 'MODEL_FAILED', message: 'The provider did not answer.' } });
  });
  env.advance(1000);
  await seedRun(env, other, { status: 'failed', callId: 'call_9' });
  const [failed] = (await rows(env)).filter(row => row.kind === 'draft' && row.title.endsWith('failed'));
  done(await decide(env, failed, 'run-again'));
  await setSpendPolicy(env.deps, owner, { askAboveMicros: '100000' });
  await assert.rejects(paidCall(env.deps, owner, { key: 'render-1', item: 'connector:fal', label: 'Thumbnail render', payer: 'connector:fal', draftDigest: 'b'.repeat(64), list: FAL }, async () => ({ value: 'x', billedMicros: null })), code('QUOTE_WAITING'));
  const [quote] = (await rows(env)).filter(row => row.kind === 'quote');
  done(await decide(env, quote, 'approve'));
  const journal = (await call<{ entries: JournalEntry[] }>(env, 'venture.journal.list', {})).entries.map(entry => entry.line);
  const results = (await call<{ runs: RunSummary[] }>(env, 'venture.runs.list', {})).runs.map(run => run.result).filter((line): line is string => typeof line === 'string');
  return { journal, earlier, results };
}

test('every journal line, Earlier line and run result a working business writes keeps the grammar', async () => {
  const { journal, earlier, results } = await workingBusiness();
  assert.ok(journal.length >= 1 && earlier.length >= 6 && results.length >= 2, JSON.stringify({ journal, earlier, results }));
  const offenders = [...journal, ...earlier, ...results].filter(line => !systemLineOk(line)).map(line => `${systemLineProblem(line)}: ${line}`);
  assert.deepEqual(offenders, []);
  assert.ok(earlier.includes('Cost approved. It can run once in the next hour.'), 'the spend quote line names what was approved');
});

test('every fixed line the Today, journal and run generators write keeps the grammar', async () => {
  const files = [
    'views/queue.ts', 'views/queue-w4.ts', 'views/runs.ts', 'views/row-meta.ts', 'views/refusals.ts', 'journal/journal.ts', 'journal/list.ts', 'journal/decisions.ts',
    'build/posting.ts', 'build/bank-methods.ts', 'delivery/run-controls.ts', 'delivery/run-control-rows.ts', 'playbooks/ca-firm/signoff.ts', 'policy/spot-check.ts',
    'policy/allow-session.ts', 'money/invoices.ts',
  ];
  const found: string[] = [];
  for (const file of files) {
    const source = await readFile(new URL(`../runtime/venture/${file}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/\bline: '((?:[^'\\]|\\.)*)'/g)) {
      const line = match[1].replace(/\\'/g, "'");
      if (!systemLineOk(line)) found.push(`${file}: ${line}`);
    }
  }
  assert.deepEqual(found, []);
});
