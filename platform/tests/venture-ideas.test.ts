// Ideas and who is waiting on you (Ink v2 wave 4, package 4J18, catalogue A11): code rules over the business's own
// records make ideas, each with a title, a reason, the records it rests on and the prompt it would run. An idea is a
// suggestion only: Start drafts a proposal (the chief's own kinds and gate), which reaches Today only when the owner
// raises it and does something only when the owner approves it there; nothing is spent, sent or priced on Start. An
// idea retires once its records no longer hold it, a dismissal is remembered, and an idea with no record behind it
// cannot be made. "Who is waiting on you" lists only real records: an order a step of which waits on the owner (a
// draft to read, a question, an invoice to issue) and mail Chausar leaves for the owner to answer. No model is asked.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { IdeasView, InvoiceRecord } from '../runtime/venture/contracts.ts';
import { currentVenture, findRecord, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as agentHandlers } from '../runtime/venture/agents/index.ts';
import { handlers as chiefHandlers } from '../runtime/venture/chief/index.ts';
import { handlers as networkHandlers } from '../runtime/venture/network/index.ts';
import { makeIdea } from '../runtime/venture/agents/ideas.ts';
import { business, code, owner, phone, PLAIN_IDEA, readyDraft, type Business } from './venture-judge-helpers.ts';

type Handler = (deps: unknown, ctx: unknown, payload: unknown) => Promise<any>;
const agents = (env: Business, method: string, payload: unknown = {}, ctx = owner): Promise<any> => (agentHandlers as Record<string, Handler>)[method](env.deps, ctx, payload);
const ideas = (env: Business): Promise<IdeasView> => agents(env, 'venture.ideas.list');
const start = (env: Business, id: string, ctx = owner) => agents(env, 'venture.ideas.start', { id }, ctx);
const dismiss = (env: Business, id: string, ctx = owner) => agents(env, 'venture.ideas.dismiss', { id }, ctx);
const offerName = (env: Business) => listRecords(env.store.read(), 'venture-blueprint').find(plan => plan.status === 'accepted')!.offers[0].name.value;
const START_LINE = 'Drafted. Put it on Today when you are ready: nothing changes until you approve it there.';

async function order(env: Business, request = 'Please look at my pricing for the new product line and advise.') {
  return env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request });
}
async function delivered(env: Business, on = '2026-10-20') {
  const made = await order(env);
  await env.call('venture.order.deliver', { orderId: made.id, deliveredOn: on });
  return made;
}
/** An invoice the business issued, seeded as the books leave it. */
async function issued(env: Business, orderId: string, patch: Partial<InvoiceRecord> = {}): Promise<InvoiceRecord> {
  return ventureAction(env.deps, owner, 'admin', 'seed.invoice', tx => tx.put({
    ...tx.base('venture-invoice'), number: 'INV-0001', orderId, clientId: env.client.id, currency: 'INR', issueDate: '2026-09-25', dueDate: '2026-10-10',
    status: 'issued', totalMinor: '118000', balanceMinor: '118000', paidMinor: '0', digest: 'd', ...patch,
  } as any));
}

test('ideas: an empty business has no ideas and no one waiting on you: nothing is invented', async () => {
  const env = await business(PLAIN_IDEA);
  assert.deepEqual(await ideas(env), { ideas: [], waiting: [] });
});

test('ideas: a delivered order with no invoice makes an idea; Start drafts a proposal for Today and changes nothing else', async () => {
  const env = await business(PLAIN_IDEA);
  const made = await delivered(env);
  const offer = offerName(env);
  const view = await ideas(env);
  assert.equal(view.ideas.length, 1);
  const [idea] = view.ideas;
  assert.match(idea.id, /^idea_[a-f0-9]{24}$/);
  assert.deepEqual(idea, {
    id: idea.id, title: `Invoice Asha Rao for ${offer}`, reason: 'You marked this order delivered on 20 Oct 2026, and it has no invoice yet.',
    evidence: [{ id: made.id, line: `${offer} for Asha Rao, delivered 20 Oct 2026.` }],
    prompt: "Draft the invoice for Asha Rao's order from your price. You issue it from Today.",
  });
  assert.equal((await ideas(env)).ideas[0].id, idea.id, 'the same records make the same idea');

  await assert.rejects(start(env, idea.id, phone), code('APP_APPROVAL_REQUIRED'));
  const journal = listRecords(env.store.read(), 'venture-journal-entry').length;
  const started = await start(env, idea.id);
  assert.equal(started.line, START_LINE);
  assert.equal(started.suggestion, null);
  assert.equal(started.proposal.kind, 'draft-invoice');
  assert.equal(started.proposal.status, 'drafted');
  assert.equal(started.proposal.title, "Draft the invoice for Asha Rao's order");
  assert.equal(started.proposal.line, 'This becomes a card on Today for your approval.');
  assert.equal(started.proposal.secondAsk, false);
  const [proposal] = listRecords(env.store.read(), 'venture-proposal');
  assert.equal(proposal.source, 'idea');
  assert.deepEqual(proposal.input, { orderId: made.id });
  assert.equal(listRecords(env.store.read(), 'venture-invoice').length, 0, 'Start drafts nothing in the books');
  assert.equal(listRecords(env.store.read(), 'venture-journal-entry').length, journal, 'nothing outside was journalled');
  assert.ok(!(await env.call('venture.queue.list')).rows.some((row: any) => row.kind === 'proposal'), 'not on Today until the owner raises it');
  const kept = findRecord(env.store.read(), 'venture-idea', idea.id)!;
  assert.equal(kept.status, 'started');
  assert.equal(kept.rule, 'invoice-delivered');
  assert.deepEqual(kept.evidence, [{ kind: 'venture-order', id: made.id, line: idea.evidence[0].line }]);
  assert.deepEqual((await ideas(env)).ideas, [], 'a started idea is not offered again');
  await assert.rejects(start(env, idea.id), code('ALREADY_DECIDED'));

  // The existing approval path from here: raised to Today, it waits for the owner's Approve.
  const raised = await (chiefHandlers as Record<string, Handler>)['venture.proposals.raise'](env.deps, owner, { id: proposal.id });
  const row = (await env.call('venture.queue.list')).rows.find((item: any) => item.id === raised.rowId);
  assert.equal(row.kind, 'proposal');
  assert.equal(row.title, "Draft the invoice for Asha Rao's order");
  assert.equal(listRecords(env.store.read(), 'venture-invoice').length, 0);
});

test('ideas: an idea retires once its records no longer hold it, and a retired idea can be neither started nor dismissed', async () => {
  const env = await business(PLAIN_IDEA);
  const made = await delivered(env);
  const [idea] = (await ideas(env)).ideas;
  await env.call('venture.invoice.prepare', { orderId: made.id });
  assert.deepEqual((await ideas(env)).ideas, []);
  await assert.rejects(start(env, idea.id), code('IDEA_RETIRED'));
  await assert.rejects(dismiss(env, idea.id), code('IDEA_RETIRED'));
  await assert.rejects(start(env, 'idea_nothing'), code('IDEA_RETIRED'));
  assert.equal(listRecords(env.store.read(), 'venture-proposal').length, 0);
});

test('ideas: an overdue invoice makes a reminder idea; paid in full, it retires', async () => {
  const env = await business(PLAIN_IDEA);
  const made = await order(env);
  const invoice = await issued(env, made.id);
  const reminder = (await ideas(env)).ideas.find(item => item.title.startsWith('Remind'))!;
  assert.deepEqual(reminder, {
    id: reminder.id, title: 'Remind Asha Rao about INV-0001', reason: 'INV-0001 was due on 10 Oct 2026 and is not paid in full.',
    evidence: [{ id: invoice.id, line: 'INV-0001 for Asha Rao, due 10 Oct 2026.' }], prompt: 'Draft a payment reminder for INV-0001. You send it yourself.',
  });
  const started = await start(env, reminder.id);
  assert.equal(started.proposal.kind, 'draft-reminder');
  assert.equal(started.proposal.title, 'Draft a payment reminder for invoice INV-0001');
  const other = await order(env, 'A second pricing review.');
  const second = await issued(env, other.id, { number: 'INV-0002' });
  assert.ok((await ideas(env)).ideas.some(item => item.title === 'Remind Asha Rao about INV-0002'));
  await ventureAction(env.deps, owner, 'admin', 'seed.paid', tx => { tx.replace({ ...tx.find('venture-invoice', second.id)!, status: 'paid', balanceMinor: '0', paidMinor: '118000' }); });
  assert.ok(!(await ideas(env)).ideas.some(item => item.title.startsWith('Remind')), 'paid in full, it retires');
});

test('ideas: an open order with no run after a day makes a start idea, whose proposal asks twice because it spends', async () => {
  const env = await business(PLAIN_IDEA);
  const made = await order(env);
  const asked = env.models.previewed.length + env.models.generated.length;
  assert.deepEqual((await ideas(env)).ideas, [], 'not on the day it was ordered');
  env.setNow('2026-10-23T10:00:00.000Z');
  const [idea] = (await ideas(env)).ideas;
  assert.equal(idea.title, "Start work on Asha Rao's order");
  assert.equal(idea.reason, `Asha Rao ordered ${offerName(env)} on 21 Oct 2026, and no run has started.`);
  assert.deepEqual(idea.evidence.map(item => item.id), [made.id]);
  const runs = listRecords(env.store.read(), 'venture-delivery-run').length;
  const started = await start(env, idea.id);
  assert.equal(started.proposal.kind, 'start-run');
  assert.equal(started.proposal.secondAsk, true);
  assert.equal(listRecords(env.store.read(), 'venture-delivery-run').length, runs, 'no run starts on Start');
  assert.equal(env.models.previewed.length + env.models.generated.length, asked, 'no model is asked');
});

test('ideas: a dismissal is remembered; the same records never bring the idea back, new records make a new one', async () => {
  const env = await business(PLAIN_IDEA);
  await delivered(env);
  const [idea] = (await ideas(env)).ideas;
  await assert.rejects(dismiss(env, idea.id, phone), code('APP_APPROVAL_REQUIRED'));
  assert.deepEqual(await dismiss(env, idea.id), { dismissed: true, line: "Dismissed. Chausar won't suggest this again." });
  assert.equal(findRecord(env.store.read(), 'venture-idea', idea.id)!.status, 'dismissed');
  assert.deepEqual((await ideas(env)).ideas, []);
  await assert.rejects(dismiss(env, idea.id), code('ALREADY_DECIDED'));
  await assert.rejects(start(env, idea.id), code('ALREADY_DECIDED'));
  await delivered(env, '2026-10-21');
  const fresh = (await ideas(env)).ideas;
  assert.equal(fresh.length, 1);
  assert.notEqual(fresh[0].id, idea.id);
});

test('ideas: an idea with no record behind it cannot be made', async () => {
  const env = await business(PLAIN_IDEA);
  const made = await delivered(env);
  const state = env.store.read();
  const venture = currentVenture(state)!;
  const draft = { rule: 'invoice-delivered' as const, title: 'Invoice someone', reason: 'Because.', prompt: 'Draft it.', action: { kind: 'draft-invoice' as const, input: { orderId: made.id } } };
  assert.throws(() => makeIdea(state, venture, { ...draft, evidence: [] }), code('IDEA_NO_EVIDENCE'));
  assert.throws(() => makeIdea(state, venture, { ...draft, evidence: [{ kind: 'venture-order', id: 'order_nope', line: 'An order.' }] }), code('IDEA_NO_EVIDENCE'));
  assert.throws(() => makeIdea(state, venture, { ...draft, evidence: [{ kind: 'venture-order', id: env.client.id, line: 'Not an order.' }] }), code('IDEA_NO_EVIDENCE'));
  assert.match(makeIdea(state, venture, { ...draft, evidence: [{ kind: 'venture-order', id: made.id, line: 'The order.' }] }).id, /^idea_/);
});

test('ideas: Forget of a person in the network erases their name from the ideas Chausar keeps; a dismissal still holds', async () => {
  const env = await business(PLAIN_IDEA);
  await delivered(env);
  const [idea] = (await ideas(env)).ideas;
  await dismiss(env, idea.id);
  const asha = await ventureAction(env.deps, owner, 'admin', 'seed.person', tx => tx.put({
    ...tx.base('venture-person'), name: 'Asha Rao', handles: { emails: [], phones: [], linkedinUrl: null }, role: null, roles: [], facts: [], hidden: false, clientId: env.client.id, history: [],
  } as any));
  await (networkHandlers as Record<string, Handler>)['venture.network.forget'](env.deps, owner, { id: asha.id });
  const kept = findRecord(env.store.read(), 'venture-idea', idea.id)!;
  assert.ok(!/Asha|Rao/.test(JSON.stringify(kept)), JSON.stringify(kept));
  assert.match(kept.title, /^Invoice someone you asked Chausar to forget for /);
  assert.deepEqual((await ideas(env)).ideas, [], 'the client record stays for the law, and the dismissal still holds');
});

test('ideas: a business still in its interview has no country yet; the list answers with nothing instead of failing', async () => {
  const env = await business(PLAIN_IDEA);
  await delivered(env);
  await ventureAction(env.deps, owner, 'admin', 'seed.country', tx => { tx.touch({ country: null } as any); });
  assert.deepEqual(await ideas(env), { ideas: [], waiting: [] });
});

test('who is waiting on you: only real records, an order step that waits on you and mail left for you to answer', async () => {
  const env = await business(PLAIN_IDEA);
  const run = await readyDraft(env);
  const waiting = (await ideas(env)).waiting;
  assert.deepEqual(waiting, [{ id: `waiting:order:${run.orderId}`, recordId: run.orderId, line: 'For Asha Rao: the draft waits on you.' }]);

  const priya = await ventureAction(env.deps, owner, 'admin', 'seed.person', tx => tx.put({
    ...tx.base('venture-person'), name: 'Priya Shah', handles: { emails: ['priya@example.com'], phones: [], linkedinUrl: null }, role: null, roles: [], facts: [], hidden: false, clientId: null, history: [],
  } as any));
  const mail = (from: string, triage: string, processed: boolean, personId: string | null) => ventureAction(env.deps, owner, 'admin', 'seed.mail', tx => tx.put({
    ...tx.base('venture-inbound'), messageId: `<${from}.${triage}>`, from, to: ['me@example.com'], date: '2026-10-21T09:00:00.000Z', subject: 'Your prices', references: [],
    matched: null, triage, line: '', processed, screen: null, personId,
  } as any));
  const asked = await mail('priya@example.com', 'owner-reply', false, priya.id);
  await mail('bot@example.com', 'auto-reply', false, null);
  await mail('done@example.com', 'owner-reply', true, null);
  const unknown = await mail('ravi@example.com', 'bot-question', false, null);
  const now = (await ideas(env)).waiting;
  assert.deepEqual(now.map(item => item.line), [
    'For Asha Rao: the draft waits on you.',
    'Priya Shah wrote on 21 Oct 2026 and waits for your reply.',
    'ravi@example.com wrote on 21 Oct 2026 and waits for your reply.',
  ]);
  assert.deepEqual(now.slice(1).map(item => item.recordId), [asked.id, unknown.id]);
  const state = env.store.read();
  for (const item of now) assert.ok(state.conversations.some(record => record?.id === item.recordId), `${item.recordId} is a real record`);
});
