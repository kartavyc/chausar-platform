// Proposals (Ink v2 wave 4, package 4C1, catalogue A1, spec 5.4): the chief acts only through approvals. A brief to an
// agent is posted in that agent's chat at once; every other kind is stored as a drafted proposal, which the owner
// raises to Today as a card ("Nothing changes until you approve"). Approve there runs the real engine method for its
// kind after the gate runs again (W1 H13); a changed proposal is stale; Not now dismisses it. An agent's floor request
// (4B1) is raised and announced once by 4B1 and decided here, never announced again. Kinds are checked by code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError } from '../runtime/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { proposalKindCheck, RUN_STARTED_LINE } from '../runtime/venture/chief/proposals.ts';
import type { ProposalRecord } from '../runtime/venture/contracts.ts';
import { code, owner, phone } from './venture-judge-helpers.ts';
import { episodeOrder } from './venture-agent-helpers.ts';
import {
  answer, chatConsent, chiefBusiness, createdCount, priceOffer, proposal, scriptChief, text, tools, type ChiefEnv,
} from './venture-chief-helpers.ts';

const TODAY_LINE = 'This becomes a card on Today for your approval.';

/** One chief answer carrying these proposals, after a look at the clients and the plan. */
async function suggest(env: ChiefEnv, proposals: unknown[]): Promise<any> {
  scriptChief(env, [tools('clients', 'plan'), answer([text('Here is what I would do next.')], proposals)]);
  return env.chief('venture.chief.thread.send', { text: 'What should I do next?' });
}

const proposalRows = async (env: ChiefEnv) => (await env.call('venture.queue.list')).rows.filter((row: any) => row.kind === 'proposal');

test('proposals: an answer drafts proposals; a brief goes to the agent at once; unknown and forbidden kinds are left out', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  const order = await episodeOrder(env);
  const sent = await suggest(env, [
    proposal('start-run', { orderId: order.id }),
    proposal('brief-agent', { agent: 'story-editor', text: 'Please draft five hooks for the budgets episode.' }),
    proposal('set-posture'),
    proposal('launch-rocket'),
    proposal('start-run', { orderId: 'order_nowhere' }),
  ]);
  const reply = sent.added[1];
  const stored = listRecords(env.store.read(), 'venture-proposal');
  assert.equal(stored.length, 1);
  const drafted = stored[0];
  assert.equal(drafted.proposalKind, 'start-run');
  assert.equal(drafted.source, 'chief');
  assert.equal(drafted.status, 'drafted');
  assert.equal(drafted.raisedAt, null);
  assert.equal(drafted.threadId, sent.thread.id);
  assert.equal(drafted.messageId, reply.id);
  assert.deepEqual(drafted.input, { orderId: order.id });
  assert.equal(drafted.spends, true);
  assert.equal(drafted.title, "Start work on Asha Rao's order");
  assert.deepEqual(reply.proposals.map((item: any) => [item.id, item.kind, item.status, item.line, item.rowId, item.secondAsk]), [
    [drafted.id, 'start-run', 'drafted', TODAY_LINE, null, true],
  ]);
  // 4C2 review: the step's own line rides beside where it stands.
  assert.equal(reply.proposals[0].what, 'This starts a run on your AI for this order. Each step that needs you still asks first.');
  assert.equal(reply.proposals[0].what, drafted.line);
  assert.deepEqual(listRecords(env.store.read(), 'venture-chief-message').at(-1)!.proposalIds, [drafted.id]);
  assert.deepEqual(reply.dropped, [
    'One proposal was left out: Chausar never changes your keys, money rules, posture or storage. You change those yourself.',
    'One proposal was left out: Chausar cannot propose that.',
    'One proposal was left out: that order was not found.',
  ]);
  assert.equal(createdCount(env), 0, 'drafted, not raised');
  assert.equal((await proposalRows(env)).length, 0);
  // The brief: posted in the agent's chat at once, from Chausar, with no Today card.
  const editor = await env.agents('venture.agents.thread.list', { agent: 'story-editor' });
  const brief = editor.items.find((item: any) => item.type === 'message').message;
  assert.equal(brief.from, 'chausar');
  assert.deepEqual(brief.parts, [{ kind: 'estimate', text: 'From Chausar: Please draft five hooks for the budgets episode.' }]);
  assert.deepEqual(reply.parts.map((part: any) => part.text), ['Here is what I would do next.', 'I passed a brief to Story editor.']);
});

test('proposals: raise makes a Today card, announced once; Approve runs the real method after the gate runs again (W1 H13)', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  const order = await episodeOrder(env);
  const sent = await suggest(env, [proposal('start-run', { orderId: order.id })]);
  const id = sent.added[1].proposals[0].id;
  const raised = await env.chief('venture.proposals.raise', { id });
  assert.equal(raised.proposal.status, 'raised');
  assert.equal(raised.line, 'On Today for your approval.');
  assert.equal(raised.proposal.line, 'On Today. Nothing changes until you approve.');
  assert.equal(createdCount(env), 1);
  const again = await env.chief('venture.proposals.raise', { id });
  assert.equal(again.rowId, raised.rowId);
  assert.equal(again.line, 'It is on Today already.');
  assert.equal(createdCount(env), 1, 'never announced twice');
  const created = listRecords(env.store.read(), 'venture-event').filter(event => event.name === 'proposal.created');
  assert.deepEqual(created[0].data, { proposalId: id });

  const [row] = await proposalRows(env);
  assert.equal(row.id, raised.rowId);
  assert.equal(row.title, "Start work on Asha Rao's order");
  assert.equal(row.line, 'This starts a run on your AI for this order. Each step that needs you still asks first. Nothing changes until you approve.');
  assert.deepEqual(row.actions, [{ id: 'deny', label: 'Not now', primary: false }, { id: 'approve', label: 'Approve', primary: true, secondAsk: true }]);
  const runsBefore = listRecords(env.store.read(), 'venture-delivery-run').length;
  const decided = await env.call('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
  assert.equal(decided.outcome, 'done', JSON.stringify(decided));
  assert.equal(decided.line, 'Started. Its first step waits for you on Today.');
  const runs = listRecords(env.store.read(), 'venture-delivery-run');
  assert.equal(runs.length, runsBefore + 1);
  assert.equal(runs.at(-1)!.orderId, order.id);
  const after = listRecords(env.store.read(), 'venture-proposal')[0];
  assert.equal(after.status, 'approved');
  assert.equal(after.decidedBy, 'owner');
  assert.equal(after.outcome, decided.line);
  assert.equal((await proposalRows(env)).length, 0);
  await assert.rejects(env.chief('venture.proposals.dismiss', { id }), code('PROPOSAL_DECIDED'));
  const thread = await env.chief('venture.chief.thread.list', { threadId: sent.thread.id });
  assert.equal(thread.messages[1].proposals[0].status, 'approved');
  assert.equal(thread.messages[1].proposals[0].line, decided.line);
});

test('proposals: a quote whose plan changed is stale; the card read again runs the real quote with its receipt', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  const sent = await suggest(env, [proposal('quote', { offerId: 'offer_1', quantity: '2' })]);
  const id = sent.added[1].proposals[0].id;
  assert.equal(listRecords(env.store.read(), 'venture-proposal')[0].spends, false);
  await env.chief('venture.proposals.raise', { id });
  const [seen] = await proposalRows(env);
  assert.equal(seen.actions[1].secondAsk, undefined, 'a quote neither spends nor sends');
  await priceOffer(env, '2000');
  const stale = await env.call('venture.queue.decide', { id: seen.id, digest: seen.digest, action: 'approve' });
  assert.equal(stale.outcome, 'stale');
  const [fresh] = await proposalRows(env);
  assert.notEqual(fresh.id, seen.id);
  const done = await env.call('venture.queue.decide', { id: fresh.id, digest: fresh.digest, action: 'approve' });
  assert.equal(done.outcome, 'done', JSON.stringify(done));
  const receipt = listRecords(env.store.read(), 'venture-price-receipt').find(item => item.id === done.receiptId)!;
  assert.deepEqual(receipt.subject, { type: 'offer', offerId: 'offer_1' });
  assert.equal(receipt.inputs.quantity, '2');
});

test('proposals: a proposal changed after it was drafted never runs; Not now dismisses one', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  const first = await episodeOrder(env);
  const second = await episodeOrder(env, 'A short episode on savings.');
  const sent = await suggest(env, [proposal('draft-invoice', { orderId: first.id }), proposal('draft-invoice', { orderId: second.id })]);
  const [one, two] = sent.added[1].proposals.map((item: any) => item.id);
  await env.chief('venture.proposals.raise', { id: one });
  await env.chief('venture.proposals.raise', { id: two });
  const rows = await proposalRows(env);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].actions.map((item: any) => item.secondAsk), [undefined, undefined]);
  // Changed in the vault behind the card: its input no longer matches the digest the owner approves.
  await ventureAction(env.deps, owner, 'prepare', 'seed.tamper', tx => {
    const record = tx.find('venture-proposal', one)!;
    tx.replace<ProposalRecord>({ ...record, input: { orderId: second.id } });
  });
  const stale = await env.call('venture.queue.decide', { id: rows[0].id, digest: rows[0].digest, action: 'approve' });
  assert.equal(stale.outcome, 'stale');
  const changed = (await proposalRows(env)).find((row: any) => row.id.startsWith(`proposal:${one}:`));
  assert.match(changed.line, /^This can't go ahead now: it changed since Chausar drafted it\./);
  assert.deepEqual(changed.actions, [{ id: 'deny', label: 'Dismiss', primary: true }]);
  assert.equal(listRecords(env.store.read(), 'venture-invoice').length, 0, 'nothing was drafted');

  const other = (await proposalRows(env)).find((row: any) => row.id.startsWith(`proposal:${two}:`));
  const dismissed = await env.call('venture.queue.decide', { id: other.id, digest: other.digest, action: 'deny' });
  assert.equal(dismissed.outcome, 'done');
  assert.equal(dismissed.line, 'Not now. Nothing changed.');
  assert.equal(listRecords(env.store.read(), 'venture-proposal').find(item => item.id === two)!.status, 'dismissed');
  await assert.rejects(env.chief('venture.proposals.raise', { id: two }), code('PROPOSAL_DECIDED'));
  assert.equal(listRecords(env.store.read(), 'venture-invoice').length, 0);
});

test('proposals: a card whose order was invoiced meanwhile can only be dismissed; an approved draft invoice is real', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  const first = await episodeOrder(env);
  const second = await episodeOrder(env, 'A short episode on savings.');
  const sent = await suggest(env, [proposal('draft-invoice', { orderId: first.id }), proposal('draft-invoice', { orderId: second.id })]);
  const [one, two] = sent.added[1].proposals.map((item: any) => item.id);
  await env.chief('venture.proposals.raise', { id: one });
  await env.chief('venture.proposals.raise', { id: two });
  const draft = await env.call('venture.invoice.prepare', { orderId: first.id });
  await env.call('venture.invoice.issue', { invoiceId: draft.invoice.id, digest: draft.invoice.digest });
  const rows = await proposalRows(env);
  const blocked = rows.find((row: any) => row.id.startsWith(`proposal:${one}:`));
  assert.equal(blocked.line, "This can't go ahead now: this order already has an issued invoice.");
  assert.deepEqual(blocked.actions, [{ id: 'deny', label: 'Dismiss', primary: true }]);
  const ready = rows.find((row: any) => row.id.startsWith(`proposal:${two}:`));
  const done = await env.call('venture.queue.decide', { id: ready.id, digest: ready.digest, action: 'approve' });
  assert.equal(done.outcome, 'done', JSON.stringify(done));
  assert.equal(done.line, 'Drafted. The invoice waits on Today for you to issue it.');
  const invoices = listRecords(env.store.read(), 'venture-invoice').filter(item => item.orderId === second.id);
  assert.deepEqual(invoices.map(item => item.status), ['draft']);
});

test('proposals: an agent\'s floor request is a Today card, announced once by 4B1 and never again here', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  await env.agents('venture.agents.thread.send', { agent: 'story-editor', text: 'Publish the trailer on YouTube today.' });
  assert.equal(createdCount(env), 1);
  const [row] = await proposalRows(env);
  assert.equal(row.title, 'Publish the trailer on YouTube today.');
  assert.equal(row.agent, 'Story editor');
  assert.equal(row.line.match(/Nothing changes until you approve\./g)!.length, 1);
  assert.match(row.line, /always asks you first/);
  assert.equal(row.actions[1].secondAsk, true, 'it sends');
  const id = listRecords(env.store.read(), 'venture-proposal')[0].id;
  const raised = await env.chief('venture.proposals.raise', { id });
  assert.equal(raised.rowId, row.id);
  assert.equal(createdCount(env), 1);
  const orders = listRecords(env.store.read(), 'venture-order').length;
  const decided = await env.call('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
  assert.equal(decided.outcome, 'done', JSON.stringify(decided));
  assert.equal(decided.line, "Approved. Story editor's chat has a New order ready for you to check.");
  const thread = await env.agents('venture.agents.thread.list', { agent: 'story-editor' });
  const last = thread.items.at(-1).message;
  assert.equal(last.from, 'agent');
  assert.deepEqual(last.suggestion, { kind: 'order', offerId: null, request: 'Publish the trailer on YouTube today.' });
  assert.equal(last.parts[0].text, 'You approved this on Today. Check the details in New order to start it. Publishing, sending and money still ask you first, at their own step.');
  assert.equal(listRecords(env.store.read(), 'venture-order').length, orders, 'nothing is created or published by the approval');
  assert.equal(listRecords(env.store.read(), 'venture-proposal')[0].status, 'approved');
  assert.equal(createdCount(env), 1);
});

test('proposals: raise and dismiss are the app\'s; unknown ids and a dismissed one are refused', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  const sent = await suggest(env, [proposal('quote', { offerId: 'offer_1' })]);
  const id = sent.added[1].proposals[0].id;
  await assert.rejects(env.chief('venture.proposals.raise', { id }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.chief('venture.proposals.dismiss', { id }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.chief('venture.proposals.raise', { id: 'proposal_nowhere' }), code('INVALID_VENTURE_REQUEST'));
  const dismissed = await env.chief('venture.proposals.dismiss', { id });
  assert.equal(dismissed.proposal.status, 'dismissed');
  assert.equal(dismissed.proposal.line, 'You said not now.');
  await assert.rejects(env.chief('venture.proposals.raise', { id }), code('PROPOSAL_DECIDED'));
  await assert.rejects(env.chief('venture.proposals.dismiss', { id }), code('PROPOSAL_DECIDED'));
  assert.equal(createdCount(env), 0);
});

test('proposals: kinds by code; keys, money policy, posture or storage are never proposed', async () => {
  assert.equal(proposalKindCheck('quote'), 'quote');
  assert.equal(proposalKindCheck('brief-agent'), 'brief-agent');
  for (const kind of ['set-posture', 'change-spend-policy', 'connect-key', 'move-storage', 'raise-budget', 'set-api-key']) {
    assert.throws(() => proposalKindCheck(kind), code('PROPOSAL_NOT_ALLOWED'), kind);
  }
  for (const kind of ['launch-rocket', 'issue-invoice', '']) assert.throws(() => proposalKindCheck(kind), code('PROPOSAL_KIND_UNKNOWN'), kind);
  const env = await chiefBusiness();
  const id = await ventureAction(env.deps, owner, 'prepare', 'seed.proposal', tx => tx.put({
    ...tx.base('venture-proposal'), proposalKind: 'launch-rocket', source: 'chief', threadId: null, messageId: null, agent: null,
    title: 'Launch', line: 'Launch it.', input: {}, spends: false, sends: false, status: 'drafted', digest: 'x', raisedAt: null,
    decidedAt: null, decidedBy: null, outcome: null,
  } as unknown as ProposalRecord).id);
  await assert.rejects(env.chief('venture.proposals.raise', { id }), code('PROPOSAL_KIND_UNKNOWN'));
});

// ---------------------------------------------------------------------------
// Review fixes (S1-4, S2-3)
// ---------------------------------------------------------------------------

/** A start-run card on Today for one new order: the order, the card and how many runs there were before it. */
async function startRunCard(env: ChiefEnv) {
  await chatConsent(env);
  const order = await episodeOrder(env);
  const sent = await suggest(env, [proposal('start-run', { orderId: order.id })]);
  const id = sent.added[1].proposals[0].id;
  await env.chief('venture.proposals.raise', { id });
  const [row] = await proposalRows(env);
  return { order, id, row, runs: listRecords(env.store.read(), 'venture-delivery-run').length };
}

test('proposals: a method that refuses puts the card back on Today, in the method\'s own words (S1-4)', async () => {
  const env = await chiefBusiness();
  const { id, row, runs } = await startRunCard(env);
  env.models.refusePreview = () => new ChausarError('SEND_DISABLED', 'Sending is off for this workspace.');
  const refused = await env.call('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
  assert.deepEqual(refused, { outcome: 'refused', reason: 'SEND_DISABLED', line: 'Sending is off for this workspace.' });
  const record = listRecords(env.store.read(), 'venture-proposal').find(item => item.id === id)!;
  assert.equal(record.status, 'raised');
  assert.equal(record.decidedAt, null);
  assert.equal(record.decidedBy, null);
  assert.equal(record.outcome, null);
  const [again] = await proposalRows(env);
  assert.equal(again.id, row.id, 'the same card is back on Today');
  assert.equal(listRecords(env.store.read(), 'venture-delivery-run').length, runs);
  env.models.refusePreview = null;
  const done = await env.call('venture.queue.decide', { id: again.id, digest: again.digest, action: 'approve' });
  assert.equal(done.outcome, 'done', JSON.stringify(done));
  assert.equal(listRecords(env.store.read(), 'venture-delivery-run').length, runs + 1);
});

test('proposals: two approvals of one card at once run its method once (S1-4)', async () => {
  const env = await chiefBusiness();
  const { id, row, runs } = await startRunCard(env);
  const decided = await Promise.all([1, 2].map(() => env.call('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' })));
  assert.equal(decided.filter(item => item.outcome === 'done').length, 1, JSON.stringify(decided));
  assert.equal(decided.filter(item => item.outcome !== 'done').length, 1);
  assert.equal(listRecords(env.store.read(), 'venture-delivery-run').length, runs + 1);
  assert.equal(listRecords(env.store.read(), 'venture-proposal').find(item => item.id === id)!.status, 'approved');
});

test('proposals: a run that started before its method failed counts; the card is done, never put back (S2-3)', async () => {
  const env = await chiefBusiness();
  const { order, id, row, runs } = await startRunCard(env);
  let nested = false;
  env.models.onPreview = async () => {
    if (nested) return;
    nested = true;
    await env.call('venture.delivery.run', { orderId: order.id });
    throw new ChausarError('MODEL_TIMEOUT', 'Your AI did not answer in time.');
  };
  const decided = await env.call('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
  assert.equal(decided.outcome, 'done', JSON.stringify(decided));
  assert.equal(decided.line, RUN_STARTED_LINE);
  const record = listRecords(env.store.read(), 'venture-proposal').find(item => item.id === id)!;
  assert.equal(record.status, 'approved');
  assert.equal(record.outcome, RUN_STARTED_LINE);
  assert.equal(listRecords(env.store.read(), 'venture-delivery-run').length, runs + 1);
  assert.equal((await proposalRows(env)).length, 0);
});
