// Ideas and who is waiting on you (Ink v2 wave 4, package 4J18, catalogue A11): code rules over the business's own
// records make ideas, each with a title, a reason, the records it rests on and the prompt it would run. An idea is a
// suggestion only: Start drafts a proposal (the chief's own kinds and gate), which reaches Today only when the owner
// raises it and does something only when the owner approves it there; nothing is spent, sent or priced on Start. An
// idea retires once its records no longer hold it, a dismissal is remembered, and an idea with no record behind it
// cannot be made. "Who is waiting on you" lists only real records: an order a step of which waits on the owner (a
// draft to read, a question, an invoice to issue) and mail Chausar leaves for the owner to answer. No model is asked.
// Ink v2 wave 5 (5A3, P13) adds the idea pipeline on the same records and list: see the tests at the end.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { IdeasView, InvoiceRecord } from '../runtime/venture/contracts.ts';
import { currentVenture, findRecord, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as agentHandlers } from '../runtime/venture/agents/index.ts';
import { handlers as chiefHandlers } from '../runtime/venture/chief/index.ts';
import { handlers as networkHandlers } from '../runtime/venture/network/index.ts';
import { handlers as playbookHandlers } from '../runtime/venture/playbooks/index.ts';
import { makeIdea } from '../runtime/venture/agents/ideas.ts';
import { KIT_TOOLS } from '../runtime/venture/delivery/harness/tools-kit.ts';
import type { ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import { INTERNAL_SUGGESTIONS, latchedBy } from '../runtime/venture/policy/taint.ts';
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
  assert.deepEqual(await ideas(env), { ideas: [], waiting: [], pipeline: [] });
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
  assert.deepEqual(await ideas(env), { ideas: [], waiting: [], pipeline: [] });
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

// ---------------------------------------------------------------------------
// The idea pipeline (Ink v2 wave 5, package 5A3, catalogue P13), on the same venture-idea records and the same
// venture.ideas.list: an idea the owner or an agent adds goes into Inbox and moves forward only (Inbox, Triage, Drafted,
// Made, Published), or to Dropped with a one-sentence reason; one untouched for 90 days in Inbox or Triage is dropped
// with "Not drafted within 90 days."; seven days after Published one Today row asks the owner to grade it.
// ---------------------------------------------------------------------------

const kit = (env: Business, method: string, payload: unknown, ctx = owner): Promise<any> => (playbookHandlers as Record<string, Handler>)[method](env.deps, ctx, payload);
const add = (env: Business, text = 'A reel on how we price custom cakes', source = 'A client asked about it on a call', ctx = owner) => kit(env, 'venture.ideas.add', { text, source }, ctx);
const move = (env: Business, id: string, stage: string, reason?: string) => kit(env, 'venture.ideas.move', { id, stage, ...(reason === undefined ? {} : { reason }) });
const grade = (env: Business, id: string, value: string) => kit(env, 'venture.ideas.grade', { id, grade: value });
const pipeline = async (env: Business) => (await ideas(env)).pipeline;
const events = (env: Business, name: string) => listRecords(env.store.read(), 'venture-event').filter(event => event.name === name);

test('idea pipeline: the owner adds an idea to Inbox, on the same records and list as 4J18\'s ideas', async () => {
  const env = await business(PLAIN_IDEA);
  await assert.rejects(add(env, 'From my phone', 'Me', phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(add(env, ''), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(kit(env, 'venture.ideas.add', { text: 'An idea', source: 'Me', stage: 'made' }), code('INVALID_VENTURE_REQUEST'));
  const added = await add(env);
  assert.equal(added.line, 'Added to Inbox.');
  const { idea } = added;
  assert.match(idea.id, /^idea_/);
  assert.deepEqual(idea, {
    id: idea.id, text: 'A reel on how we price custom cakes', source: 'A client asked about it on a call', by: 'owner', role: null,
    stage: 'inbox', addedOn: '2026-10-21', movedOn: '2026-10-21', next: ['triage', 'drafted', 'made', 'published', 'dropped'],
    dropReason: null, expired: false, dropsOn: '2027-01-20', publishedOn: null, gradeFrom: null, gradeDue: false, grade: null,
  });
  const view = await ideas(env);
  assert.deepEqual(view.pipeline, [idea]);
  assert.deepEqual(view.ideas, [], 'a pipeline idea is not a rule idea');
  const kept = findRecord(env.store.read(), 'venture-idea', idea.id)!;
  assert.equal(kept.rule, 'pipeline');
  assert.equal(kept.title, idea.text);
  assert.equal(kept.pipeline?.stage, 'inbox');
  assert.equal(events(env, 'idea.changed').length, 1);
  await assert.rejects(agents(env, 'venture.ideas.start', { id: idea.id }), code('ALREADY_DECIDED'), '4J18 Start never takes a pipeline idea');
});

test('idea pipeline: moves go forward only, or to Dropped with a one-sentence reason', async () => {
  const env = await business(PLAIN_IDEA);
  const { idea } = await add(env);
  assert.equal((await move(env, idea.id, 'triage')).idea.stage, 'triage');
  const drafted = await move(env, idea.id, 'drafted');
  assert.equal(drafted.line, 'Moved to Drafted.');
  assert.deepEqual(drafted.idea.next, ['made', 'published', 'dropped']);
  assert.equal(drafted.idea.dropsOn, null, 'only Inbox and Triage expire');
  await assert.rejects(move(env, idea.id, 'triage'), code('IDEA_STAGE_BACKWARD'));
  await assert.rejects(move(env, idea.id, 'drafted'), code('IDEA_STAGE_BACKWARD'));
  await assert.rejects(move(env, idea.id, 'made', 'Because.'), code('INVALID_VENTURE_REQUEST'), 'a reason goes with a drop only');
  await assert.rejects(move(env, idea.id, 'dropped'), code('IDEA_DROP_REASON'));
  await assert.rejects(move(env, idea.id, 'dropped', 'Too close to the last reel. And the client left.'), code('IDEA_DROP_REASON'));
  await assert.rejects(move(env, idea.id, 'shelved'), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(move(env, 'idea_nope', 'made'), code('IDEA_NOT_FOUND'));
  const dropped = await move(env, idea.id, 'dropped', 'Too close to the last reel we made.');
  assert.equal(dropped.idea.stage, 'dropped');
  assert.equal(dropped.idea.dropReason, 'Too close to the last reel we made.');
  assert.deepEqual(dropped.idea.next, []);
  await assert.rejects(move(env, idea.id, 'made'), code('IDEA_STAGE_BACKWARD'), 'a dropped idea stays dropped');
  const kept = findRecord(env.store.read(), 'venture-idea', idea.id)!;
  assert.deepEqual(kept.pipeline?.history.map(item => item.stage), ['inbox', 'triage', 'drafted', 'dropped']);
  assert.equal(kept.reason, 'Too close to the last reel we made.');

  const skip = (await add(env, 'A second idea')).idea;
  assert.equal((await move(env, skip.id, 'made')).idea.stage, 'made', 'forward may skip a stage');
  const published = (await move(env, skip.id, 'published')).idea;
  assert.deepEqual(published.next, [], 'published is the end');
  await assert.rejects(move(env, skip.id, 'dropped', 'Changed my mind.'), code('IDEA_STAGE_BACKWARD'));

  await delivered(env);
  const [rule] = (await ideas(env)).ideas;
  await assert.rejects(move(env, rule.id, 'triage'), code('IDEA_NOT_FOUND'), 'a 4J18 rule idea is not in the pipeline');
});

test('idea pipeline: an idea untouched for 90 days in Inbox or Triage is dropped, by the business\'s own day', async () => {
  const env = await business(PLAIN_IDEA);
  const inbox = (await add(env, 'Inbox idea')).idea;
  const triage = (await add(env, 'Triage idea')).idea;
  await move(env, triage.id, 'triage');
  const made = (await add(env, 'Made idea')).idea;
  await move(env, made.id, 'made');
  env.setNow('2027-01-19T10:00:00.000Z'); // day 90 in India
  assert.ok((await pipeline(env)).every(item => !item.expired));
  env.setNow('2027-01-19T19:00:00.000Z'); // 00:30 on 20 January in India: day 91 there, still day 90 in UTC
  const later = await pipeline(env);
  const byId = new Map(later.map(item => [item.id, item]));
  for (const id of [inbox.id, triage.id]) {
    assert.equal(byId.get(id)!.stage, 'dropped');
    assert.equal(byId.get(id)!.dropReason, 'Not drafted within 90 days.');
    assert.equal(byId.get(id)!.expired, true);
  }
  assert.equal(byId.get(made.id)!.stage, 'made', 'a made idea never expires');
  await assert.rejects(move(env, inbox.id, 'triage'), code('IDEA_STAGE_BACKWARD'));
  // The next write keeps the drop in the records.
  await add(env, 'A fresh idea');
  const kept = findRecord(env.store.read(), 'venture-idea', inbox.id)!;
  assert.equal(kept.pipeline?.stage, 'dropped');
  assert.equal(kept.reason, 'Not drafted within 90 days.');
  assert.equal(kept.status, 'dismissed');
});

test('idea pipeline: seven days after Published, one Today row asks the owner to grade it', async () => {
  const env = await business(PLAIN_IDEA);
  const { idea } = await add(env);
  await assert.rejects(grade(env, idea.id, 'worked'), code('IDEA_NOT_PUBLISHED'));
  const published = (await move(env, idea.id, 'published')).idea;
  assert.deepEqual([published.publishedOn, published.gradeFrom, published.gradeDue], ['2026-10-21', '2026-10-28', false]);
  const gradeRows = async () => (await env.call('venture.queue.list')).rows.filter((row: any) => row.notice?.probe === 'idea');
  env.setNow('2026-10-27T10:00:00.000Z');
  await assert.rejects(grade(env, idea.id, 'worked'), code('IDEA_GRADE_EARLY'));
  assert.deepEqual(await gradeRows(), []);
  env.setNow('2026-10-28T04:00:00.000Z');
  const rows = await gradeRows();
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.kind, 'notice');
  assert.equal(row.title, 'How did "A reel on how we price custom cakes" do?');
  assert.equal(row.line, 'You published it on 21 Oct 2026. Grade it: worked, so-so or did not.');
  assert.deepEqual(row.notice, { probe: 'idea', severity: 'low', link: '/work?state=ideas' });
  assert.deepEqual(row.actions.map((item: any) => item.id), ['later', 'open']);
  assert.equal((await pipeline(env))[0].gradeDue, true);
  assert.equal((await env.call('venture.queue.decide', { id: row.id, digest: row.digest, action: 'open' })).reason, 'NOT_A_DECISION');
  await assert.rejects(grade(env, idea.id, 'great'), code('INVALID_VENTURE_REQUEST'));
  const graded = await grade(env, idea.id, 'so-so');
  assert.equal(graded.line, 'Graded: so-so.');
  assert.deepEqual([graded.idea.grade, graded.idea.gradeDue], ['so-so', false]);
  assert.deepEqual(await gradeRows(), [], 'graded, the row goes');
  await assert.rejects(grade(env, idea.id, 'worked'), code('ALREADY_DECIDED'));
  assert.ok(events(env, 'queue.changed').length > 0);
});

test('idea pipeline: the ideas.add tool adds an agent\'s suggestion marked with its role; the latch lets this one internal write through', async () => {
  const env = await business(PLAIN_IDEA);
  const venture = currentVenture(env.store.read())!;
  const spec = KIT_TOOLS['ideas.add'];
  assert.equal(spec.effect, 'read', 'its write is declared in policy/effects.ts, never the always-ask outside write');
  const run = await ventureAction(env.deps, owner, 'admin', 'seed.run', tx => tx.put({
    ...tx.base('venture-delivery-run'), orderId: 'order_x', status: 'running', harness: { turns: [{ turn: 1, role: 'writer' }] },
  } as any));
  const toolEnv = {
    deps: env.deps, ventureId: venture.id, memberId: 'owner', epoch: 1, currency: 'INR', dateOrder: 'day-month-year', runRef: { kind: 'delivery', runId: run.id },
    files: [], tables: [], receipts: [], dictionary: [], sandbox: undefined, now: () => new Date().toISOString(), allowed: [], ctx: owner,
  } as unknown as ToolEnv;
  const answer = await spec.run(toolEnv, { text: 'A short on the three cake sizes', source: 'The client\'s question in this order' });
  assert.deepEqual(answer.result, { added: true, stage: 'inbox', note: 'Added to the owner\'s ideas Inbox as your suggestion. Nothing else changes.' });
  const [listed] = await pipeline(env);
  assert.deepEqual([listed.by, listed.role, listed.stage, listed.text], ['agent', 'writer', 'inbox', 'A short on the three cake sizes']);
  const key = 'sk_' + 'live_' + 'a'.repeat(24);
  await spec.run(toolEnv, { text: `Use the key ${key} for the shop`, source: 'This order' });
  assert.ok(!JSON.stringify(listRecords(env.store.read(), 'venture-idea')).includes(key), 'a pasted key never reaches the list');

  for (const runRef of [{ kind: 'rehearsal', scenarioId: 'bookkeeping-clean', episode: 0 }, { kind: 'improvement', runId: 'improve_1', scenarioId: 'bookkeeping-clean' }]) {
    const practice = await spec.run({ ...toolEnv, runRef } as ToolEnv, { text: 'A practice idea', source: 'Practice' });
    assert.deepEqual(practice.result, { added: false, practice: true }, runRef.kind);
  }
  assert.equal((await pipeline(env)).length, 2, 'practice keeps nothing');

  assert.ok((INTERNAL_SUGGESTIONS as readonly string[]).includes('ideas.add'));
  const taint = { turn: 1, source: 'client-request' as const, toolCallId: null, tool: null };
  assert.deepEqual(latchedBy({ phase: 'tool-call', name: 'ideas.add', effect: 'read', inputDigest: 'd1', input: { text: 'An idea', source: 'Here' } }, taint), []);
});

test('idea pipeline: Forget of a person erases their name from a pipeline idea\'s words and where it came from', async () => {
  const env = await business(PLAIN_IDEA);
  const { idea } = await add(env, 'A reel with Priya Shah on cake prices', 'Priya Shah asked on a call');
  await move(env, idea.id, 'dropped', 'Priya Shah said no to filming.');
  const priya = await ventureAction(env.deps, owner, 'admin', 'seed.person', tx => tx.put({
    ...tx.base('venture-person'), name: 'Priya Shah', handles: { emails: [], phones: [], linkedinUrl: null }, role: null, roles: [], facts: [], hidden: false, clientId: null, history: [],
  } as any));
  await (networkHandlers as Record<string, Handler>)['venture.network.forget'](env.deps, owner, { id: priya.id });
  const kept = findRecord(env.store.read(), 'venture-idea', idea.id)!;
  assert.ok(!/Priya|Shah/.test(JSON.stringify(kept)), JSON.stringify(kept));
});

test('idea pipeline: Forget of a person also erases their email and phone from a pipeline idea (5A3 review)', async () => {
  const env = await business(PLAIN_IDEA);
  const { idea } = await add(env, 'Send the cake reel to priya.shah@example.com first', 'A call from 98765 43210');
  const priya = await ventureAction(env.deps, owner, 'admin', 'seed.person', tx => tx.put({
    ...tx.base('venture-person'), name: 'Priya Shah', handles: { emails: ['priya.shah@example.com'], phones: ['9876543210'], linkedinUrl: null }, role: null, roles: [], facts: [], hidden: false, clientId: null, history: [],
  } as any));
  await (networkHandlers as Record<string, Handler>)['venture.network.forget'](env.deps, owner, { id: priya.id });
  const kept = JSON.stringify(findRecord(env.store.read(), 'venture-idea', idea.id));
  assert.ok(!/priya\.shah@example\.com|98765 43210|9876543210/i.test(kept), kept);
});
