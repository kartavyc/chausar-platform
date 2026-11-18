// Round 6 (re-check 026): Today's Earlier said "Nothing has happened yet." after the plan was accepted, the prices were
// set and a search had found 10 possible customers, because it read only the action journal (outside effects).
// venture.earlier.list lists what really happened, from the engine's own records, newest first: outside effects as the
// journal has them, decisions as the decision record has them (an effect's approval step listed once, as its journal
// line), and each search for possible customers that ended, with its own line. Nothing is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeliveryRunRecord, EarlierEntry, InvoiceView, LeadSearchRecord, ProposalRecord, QueueDecisionRecord } from '../runtime/venture/contracts.ts';
import { recordDecision } from '../runtime/venture/journal/decisions.ts';
import { REVIEW_OFFER_SUBJECT } from '../runtime/venture/chief/plan-view.ts';
import { proposalSubject } from '../runtime/venture/chief/gate.ts';
import { PROPOSAL_SUBJECT, SETTING_SUBJECTS } from '../runtime/venture/journal/earlier-list.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { handlers as core } from '../runtime/venture/core/index.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { call, code, owner, seedBlueprint, seedOrder, setup, CLIENT_NAME, type Env } from './venture-views-env.ts';

const earlier = (env: Env, payload: unknown = {}) => call<{ entries: EarlierEntry[] }>(env, 'venture.earlier.list', payload).then(view => view.entries);

/** A search for possible customers that ended, with the card it came from, as find-run.ts leaves them. */
async function seedSearch(env: Env, state: LeadSearchRecord['state'], line: string) {
  return ventureAction(env.deps, owner, 'admin', 'seed.search', tx => {
    const card = tx.put<ProposalRecord>({
      ...tx.base('venture-proposal'), proposalKind: 'find-customers', source: 'owner', threadId: null, messageId: null, agent: null,
      title: 'Find possible customers: company offices in Indore', line: 'Looks on OpenStreetMap.', input: {}, spends: false, sends: false, status: 'approved',
    } as unknown as ProposalRecord);
    return tx.put<LeadSearchRecord>({
      ...tx.base('venture-lead-search'), proposalId: card.id,
      brief: { who: 'company offices', place: 'Indore', category: 'office=company', count: 10, source: { kind: 'public-map' } }, pin: null,
      state, line, startedAt: tx.now, endedAt: tx.now, found: 10, withEmail: 1, skipped: { known: 0, blocked: 0 }, leadIds: [], journalId: null, spendKey: null,
    });
  });
}

test('earlier.list: a business where nothing happened lists nothing; no business lists nothing', async () => {
  const env = await setup();
  assert.deepEqual(await earlier(env), []);
});

test('earlier.list: the plan accepted, a draft reviewed and a search that found customers, newest first, in their own words', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  const draft = await seedBlueprint(env, { status: 'draft', version: 2, price1: '299900', price2: '1500000' });
  await core['venture.blueprint.accept']!(env.deps, owner, { digest: draft.digest });
  env.advance(1000);
  const outline = await delivery['venture.delivery.run']!(env.deps, owner, { orderId: order.id, useTemplate: true }) as DeliveryRunRecord;
  await delivery['venture.delivery.review']!(env.deps, owner, { runId: outline.id, verdict: 'accepted' });
  env.advance(1000);
  const found = 'Found 10 possible customers in Indore. One has a contact email. They are in Clients, Pipeline, each with its source. Nothing was sent.';
  const search = await seedSearch(env, 'done', found);
  const list = await earlier(env);
  assert.deepEqual(list.map(item => [item.from, item.title, item.line, item.state]), [
    ['search', 'Find possible customers: company offices in Indore', found, 'applied'],
    ['decision', 'You decided: Draft accepted.', null, 'applied'],
    ['decision', 'You decided: Plan version 2 accepted.', null, 'applied'],
  ]);
  assert.equal(list[0].id, search.id);
});

test('earlier.list: an outside effect is listed once, as the journal line, never again as its approval step', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  const outline = await delivery['venture.delivery.run']!(env.deps, owner, { orderId: order.id, useTemplate: true }) as DeliveryRunRecord;
  await delivery['venture.delivery.review']!(env.deps, owner, { runId: outline.id, verdict: 'accepted' });
  env.advance(1000);
  const prepared = await money['venture.invoice.prepare']!(env.deps, owner, { orderId: order.id, dueInDays: 15 }) as InvoiceView;
  await money['venture.invoice.issue']!(env.deps, owner, { invoiceId: prepared.invoice.id, digest: prepared.invoice.digest });
  const list = await earlier(env);
  assert.equal(list.filter(item => item.from === 'journal').length, 1, JSON.stringify(list));
  assert.equal(list[0].from, 'journal');
  assert.equal(list[0].state, 'applied');
  assert.ok(!list.some(item => item.title === `You approved it: Issue the invoice for ${CLIENT_NAME}.`), 'the approval step is the journal line, not a second row');
});

test('earlier.list: a search that failed or is in doubt says so; limit holds; a bad limit is refused', async () => {
  const env = await setup();
  await seedBlueprint(env);
  await seedSearch(env, 'failed', 'The public map did not answer. Nothing was sent.');
  env.advance(1000);
  await seedSearch(env, 'unknown', 'Check the tool before searching again.');
  env.advance(1000);
  await seedSearch(env, 'running', 'Looking now.');
  const list = await earlier(env);
  assert.deepEqual(list.map(item => item.state), ['outcome_unknown', 'rejected'], 'a search still running is not something that happened yet');
  assert.equal((await earlier(env, { limit: 1 })).length, 1);
  for (const payload of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { other: 1 }]) {
    await assert.rejects(earlier(env, payload), code('INVALID_VENTURE_REQUEST'), JSON.stringify(payload));
  }
});

// Round 7 (re-check 6, item 4): each daily review switch was its own line, and an approved search showed twice ("You
// chose Approve on Today: Found 12 ..." and the search's own "Found 12 ..."), so the plan and prices fell off the six.
test('earlier.list: settings switches are left out, and an approved search that ended is one entry, its own', async () => {
  const env = await setup();
  await seedBlueprint(env);
  const found = 'Found 12 possible customers in Indore. One has a contact email. They are in Clients, Pipeline, each with its source. Nothing was sent.';
  const search = await seedSearch(env, 'done', found);
  const running = await seedSearch(env, 'running', 'Looking now.');
  await ventureAction(env.deps, owner, 'approve', 'seed.decisions', tx => {
    for (const reason of ['Daily review on: Every day at 8:00 am.', 'Daily review off.']) recordDecision(tx, { subject: REVIEW_OFFER_SUBJECT, action: 'approve', ruleId: null, rowId: null, reason });
    recordDecision(tx, { subject: 'ca-pack:schedule', action: 'approve', ruleId: null, rowId: null, reason: 'CA pack on.' });
    for (const [card, line] of [[search.proposalId, found], [running.proposalId, 'Approved. Looking now.']]) {
      tx.put<QueueDecisionRecord>({ ...tx.base('venture-queue-decision'), rowId: `${proposalSubject(card!)}:v1`, subject: proposalSubject(card!), digest: 'd', action: 'approve', line: line!, receiptId: null, decidedBy: owner.memberId });
    }
  });
  const list = await earlier(env, { limit: 50 });
  assert.equal(list.filter(item => /Daily review|CA pack/.test(item.title)).length, 0, JSON.stringify(list));
  assert.deepEqual(list.filter(item => item.line === found || item.title.includes(found)).map(item => [item.from, item.id]), [['search', search.id]]);
  // A search still running has not ended, so its approval is what happened so far.
  assert.equal(list.filter(item => item.title.includes('Approved. Looking now.')).length, 1);
  assert.deepEqual([...SETTING_SUBJECTS], [REVIEW_OFFER_SUBJECT, 'ca-pack:schedule']);
  assert.equal(PROPOSAL_SUBJECT, proposalSubject(''));
});
