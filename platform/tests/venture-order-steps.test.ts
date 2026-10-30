// Ink v2 wave 4, package 4J3: an order's stage steps on Work. venture.order.list rows gain the playbook's stage list
// (playbooks/order-stages.ts), each stage done, waiting on the owner, not yet, always asking or unknown, read from the
// records only (money/order-steps.ts), and one line for what waits on the owner ("2 wait on you: ...").
import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  CaFirmRecord, ConnectorPostRecord, InvoiceView, JournalRecord, OrderListRow, OrderStageView, ShareLinkStoredRecord,
} from '../runtime/venture/contracts.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { PLAYBOOK_REGISTRY } from '../runtime/venture/playbooks/registry.ts';
import { ORDER_STAGE_LISTS, STAGE_RULES, stageListFor } from '../runtime/venture/playbooks/order-stages.ts';
import { STAGE_RULE_READERS } from '../runtime/venture/money/order-steps.ts';
import { clientDraft } from '../runtime/venture/build/draft-text.ts';
import { harness, owner, seedBlueprint, seedOrder, seedRun, setStage, setup, type Env } from './venture-views-env.ts';
import { put, record, seedYoutube, transcriptUpload, youtubeDraft } from './venture-previews-env.ts';

const orders = async (env: Env) => await money['venture.order.list']!(env.deps, owner, {}) as OrderListRow[];
const brief = (stages: OrderStageView[]) => stages.map(stage => [stage.id, stage.state, stage.detail]);
const ACCEPTED = { choice: 'accepted' as const, reason: null, at: '2026-10-15T10:00:00.000Z' };

async function playbookFor(env: Env, flagship: string) {
  return put(env, tx => record(tx, 'venture-playbook', {
    version: 1, hash: `${flagship}-hash`, blueprintDigest: 'd', serviceType: 'bookkeeping', steps: [], validated: true, tierCeiling: 'code', format: 2, flagship,
  }));
}

test('order steps: every flagship has a stage list, every stage a record rule, and the fixed steps cover the rest', () => {
  for (const entry of PLAYBOOK_REGISTRY) {
    const stages = stageListFor(entry.id);
    assert.ok(stages && stages.length >= 4, `${entry.id} has a stage list`);
    assert.equal(new Set(stages.map(stage => stage.id)).size, stages.length, `${entry.id} names each stage once`);
    if (!Object.hasOwn(ORDER_STAGE_LISTS, entry.id)) assert.deepEqual(stages, stageListFor(null), `${entry.id} uses the fixed record-backed contract`);
    for (const stage of stages) {
      assert.ok((STAGE_RULES as readonly string[]).includes(stage.rule), `${entry.id}:${stage.id} names a rule`);
      assert.equal(typeof STAGE_RULE_READERS[stage.rule], 'function');
      assert.ok(stage.label.trim());
    }
  }
  for (const [list, stages] of Object.entries(ORDER_STAGE_LISTS)) {
    for (const stage of stages) {
      assert.ok((STAGE_RULES as readonly string[]).includes(stage.rule), `${list}:${stage.id} names a rule`);
      assert.equal(typeof STAGE_RULE_READERS[stage.rule], 'function', `${list}:${stage.id} has a record reader`);
      assert.ok(stage.label.trim(), `${list}:${stage.id} has a label`);
    }
  }
  assert.deepEqual(ORDER_STAGE_LISTS.youtube.map(stage => stage.label), ['Agreed', 'Price', 'Episode', 'Publish', 'Invoice', 'Paid']);
  assert.deepEqual(ORDER_STAGE_LISTS['ca-firm'].map(stage => stage.label), ['Files in', 'Books', 'GST', 'Invoice', 'Paid']);
  assert.deepEqual(ORDER_STAGE_LISTS['social-agency'].map(stage => stage.label), ['Agreed', 'Calendar', 'Drafts', 'Client OK', 'Posts', 'Report', 'Invoice', 'Paid']);
  assert.deepEqual(stageListFor(null).map(stage => stage.label), ['Agreed', 'Price', 'Draft', 'Sent', 'Invoice', 'Paid']);
  assert.deepEqual(stageListFor('a-playbook-from-wave-5').map(stage => stage.label), ['Agreed', 'Price', 'Draft', 'Sent', 'Invoice', 'Paid']);
});

test('order steps: a new order on the fixed steps is agreed and priced, sending always asks, and nothing waits on you', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env);
  const { order } = await seedOrder(env, plan);
  const [row] = await orders(env);
  assert.equal(row.id, order.id);
  assert.equal(row.request, order.request);
  assert.deepEqual(brief(row.stages), [
    ['agreed', 'done', 'done'], ['price', 'done', 'done'], ['draft', 'not-yet', 'not yet'], ['sent', 'always-asks', 'always asks you'],
    ['invoice', 'not-yet', 'not yet'], ['paid', 'not-yet', 'not yet'],
  ]);
  assert.equal(row.stages[3].line, 'Sent, always asks you');
  assert.equal(row.waitsOnYou, null);
});

test('order steps: a YouTube order with a new price and a draft to read: two wait on you, publishing always asks', async () => {
  const env = await setup();
  const { order, playbook } = await seedYoutube(env);
  await seedRun(env, order, {
    status: 'ready-for-review', playbookId: playbook.id, deliverable: youtubeDraft('The mic that beat the room'), renderedText: 'x',
    checks: [{ check: 'receipts', passed: true, detail: 'ok' }],
  });
  // A new price for this order's offer waits in the plan (views-env: offer_1 is the order's offer).
  await seedBlueprint(env, { status: 'draft', version: 2, price1: '300000' });
  const [row] = await orders(env);
  assert.deepEqual(brief(row.stages), [
    ['agreed', 'done', 'done'], ['price', 'waits', 'a new price waits on you'], ['episode', 'waits', 'ready, waits for you to read it'],
    ['publish', 'always-asks', 'always asks you'], ['invoice', 'not-yet', 'not yet'], ['paid', 'not-yet', 'not yet'],
  ]);
  assert.deepEqual(row.stages.map(stage => stage.label), ['Agreed', 'Price', 'Episode', 'Publish', 'Invoice', 'Paid']);
  assert.ok(row.stages.filter(stage => stage.state === 'waits').every(stage => stage.waitsOn === 'you'));
  // Codes the screen words for itself, in English and Hindi.
  assert.deepEqual(row.stages.map(stage => stage.reason ?? null), [null, 'new-price', 'ready', null, null, null]);
  assert.deepEqual(row.waitsOnYou, {
    count: 2, items: [{ stage: 'price', what: 'the new price' }, { stage: 'episode', what: 'the episode draft' }],
    line: '2 wait on you: the new price and the episode draft.',
  });
});

test('order steps: accepted, posted, invoiced and paid read as done from their records; a due date shows before payment', async () => {
  const env = await setup();
  const { order, playbook } = await seedYoutube(env);
  const run = await seedRun(env, order, { status: 'accepted', playbookId: playbook.id, deliverable: youtubeDraft('The mic that beat the room'), renderedText: 'x', checks: [], verdict: ACCEPTED });
  await put(env, tx => record<ConnectorPostRecord>(tx, 'venture-connector-post', {
    connectorId: 'youtube', mode: 'api', account: null, text: 'The mic that beat the room', agent: null, digest: 'p', state: 'applied', describe: 'Post.',
    risk: null, claimedAt: null, decidedBy: 'owner', outcome: { line: 'Posted.', url: null, by: 'platform' }, journal: [], draftId: run.id, draftDigest: 'd',
  }));
  const prepared = await money['venture.invoice.prepare']!(env.deps, owner, { orderId: order.id, dueInDays: 15 }) as InvoiceView;
  const drafted = await orders(env);
  assert.deepEqual(drafted[0].stages.find(stage => stage.id === 'invoice'), { id: 'invoice', label: 'Invoice', state: 'waits', detail: 'ready to issue, waits on you', line: 'Invoice, ready to issue, waits on you', waitsOn: 'you', reason: 'to-issue' });
  assert.deepEqual(drafted[0].waitsOnYou?.items, [{ stage: 'invoice', what: 'the invoice' }]);
  const issued = await money['venture.invoice.issue']!(env.deps, owner, { invoiceId: prepared.invoice.id, digest: prepared.invoice.digest }) as InvoiceView;
  const before = await orders(env);
  assert.deepEqual(brief(before[0].stages), [
    ['agreed', 'done', 'done'], ['price', 'done', 'done'], ['episode', 'done', 'done'], ['publish', 'done', 'done'],
    ['invoice', 'done', issued.invoice.number], ['paid', 'not-yet', 'due 30 Oct 2026'],
  ]);
  assert.equal(before[0].stages[5].due, '2026-10-30');
  assert.deepEqual(before[0].stages.map(stage => stage.reason ?? null), [null, null, null, null, 'issued', 'due']);
  assert.equal(before[0].waitsOnYou, null);
  await money['venture.payment.record']!(env.deps, owner, { invoiceId: issued.invoice.id, amount: '2948.82', receivedOn: '2026-10-15', method: 'upi' });
  const [paid] = await orders(env);
  assert.deepEqual(paid.stages.at(-1), { id: 'paid', label: 'Paid', state: 'done', detail: 'done', line: 'Paid, done' });
});

test('order steps: a CA firm order waits on the CA for GST and on you for the invoice; files in and books are done', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env);
  const { order } = await seedOrder(env, plan);
  await setStage(env, 'approve-each');
  const playbook = await playbookFor(env, 'ca-firm');
  await put(env, tx => transcriptUpload(tx, order.id, 4000));
  const run = await seedRun(env, order, { status: 'accepted', playbookId: playbook.id, renderedText: 'x', checks: [], verdict: ACCEPTED });
  await put(env, tx => {
    record<CaFirmRecord>(tx, 'venture-ca-firm', { entry: 'ca-of-record', name: 'Meera Joshi', membershipNumber: '123456', firmName: null, firmRegistrationNumber: null });
    const request = record<CaFirmRecord>(tx, 'venture-ca-firm', {
      entry: 'signoff-request', subjectKind: 'gst-working', title: 'GST working for September', clientName: null, workingDigest: 'w', receiptIds: [], playbookHash: null, deliveryId: run.id,
    });
    record<CaFirmRecord>(tx, 'venture-ca-firm', { entry: 'sent-to-ca', itemKey: request.id, caName: 'Meera Joshi', membershipNumber: '123456', sentBy: 'owner' });
  });
  await money['venture.invoice.prepare']!(env.deps, owner, { orderId: order.id });
  const [row] = await orders(env);
  assert.deepEqual(brief(row.stages), [
    ['files-in', 'done', 'done'], ['books', 'done', 'done'], ['gst', 'not-yet', "waits for your CA's sign-off"],
    ['invoice', 'waits', 'ready to issue, waits on you'], ['paid', 'not-yet', 'not yet'],
  ]);
  assert.equal(row.stages[2].waitsOn, 'ca');
  assert.deepEqual(row.waitsOnYou, { count: 1, items: [{ stage: 'invoice', what: 'the invoice' }], line: '1 waits on you: the invoice.' });
});

test('order steps: a social order reads the calendar, the client, the posts and the report; an unknown post says so', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env);
  const { order } = await seedOrder(env, plan);
  await setStage(env, 'approve-each');
  const playbook = await playbookFor(env, 'social-agency');
  await put(env, tx => tx.replace({ ...order, intake: { rights: null, format: 'long', aiVoice: false, aiPresenter: false, paidPromotion: false, cutFile: null, calendar: { month: '2026-11', channels: ['linkedin'], postsPerChannel: 4, weekdays: [2, 4] } } }));
  const run = await seedRun(env, order, { status: 'accepted', playbookId: playbook.id, renderedText: 'LinkedIn: A post', checks: [], verdict: ACCEPTED });
  await put(env, tx => {
    record<ShareLinkStoredRecord>(tx, 'venture-share-link', {
      deliveryId: run.id, clientId: null, tokenHash: 'h', title: 'Drafts', text: 'LinkedIn: A post', draftDigest: 'd', expiresAt: '2026-10-22T10:00:00.000Z',
      state: 'open', revokedAt: null, served: true, decisions: [],
    });
    record<ConnectorPostRecord>(tx, 'venture-connector-post', {
      connectorId: 'linkedin', mode: 'owner-browser-session', account: 'Lumen Studio', text: 'A post', agent: null, digest: 'p', state: 'outcome_unknown', describe: 'Post.',
      risk: null, claimedAt: '2026-10-15T10:00:00.000Z', decidedBy: 'owner', outcome: null, journal: [], draftId: run.id, draftDigest: 'd',
    });
  });
  const [row] = await orders(env);
  assert.deepEqual(brief(row.stages), [
    ['agreed', 'done', 'done'], ['calendar', 'done', 'planned'], ['drafts', 'done', 'done'], ['client-ok', 'not-yet', 'waits for your client'],
    ['posts', 'unknown', 'not sure: the last post timed out'], ['report', 'not-yet', 'not yet'], ['invoice', 'not-yet', 'not yet'], ['paid', 'not-yet', 'not yet'],
  ]);
  assert.equal(row.stages[3].waitsOn, 'client');
  assert.equal(row.waitsOnYou, null);
});

test('order steps: a send to the AI with an unknown outcome reads "not sure"; a stopped draft and a question wait on you', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env);
  const { order } = await seedOrder(env, plan);
  await setStage(env, 'approve-each');
  const run = await seedRun(env, order, { status: 'failed', callId: 'call_1' });
  await put(env, tx => record<JournalRecord>(tx, 'venture-journal-entry', {
    action: 'delivery.send', subject: `${run.id}:call_1`, target: 'Cafe Aroma Demo', actionDigest: 'a', describe: 'Send the next step.', agent: null, shadow: false,
    quote: null, state: 'outcome_unknown', claimedAt: '2026-10-15T10:00:00.000Z', decidedBy: 'owner', outcome: null, receiptId: null, journal: [], approval: null,
    expiresAt: '2026-10-15T11:00:00.000Z',
  }));
  const [unknown] = await orders(env);
  assert.deepEqual(unknown.stages[2], { id: 'draft', label: 'Draft', state: 'unknown', detail: 'not sure: the last send timed out', line: 'Draft, not sure: the last send timed out', reason: 'send-unknown' });
  await seedRun(env, order, {
    status: 'needs-answer', harness: harness({ phase: 'needs-answer', handoffs: [{ to: 'owner', question: 'Which account?', turn: 1, answer: null, answeredBy: null }] }),
  });
  const [asking] = await orders(env);
  assert.deepEqual(brief(asking.stages)[2], ['draft', 'waits', 'a question waits on you']);
  assert.equal(asking.stages[2].reason, 'question');
  assert.deepEqual(asking.waitsOnYou?.items, [{ stage: 'draft', what: 'a question' }]);
  await seedRun(env, order, { status: 'stopped' });
  const [stopped] = await orders(env);
  assert.deepEqual(brief(stopped.stages)[2], ['draft', 'waits', 'stopped, Resume waits on you']);
  assert.equal(stopped.stages[2].reason, 'stopped');
  assert.equal(stopped.waitsOnYou?.line, '1 waits on you: a stopped draft.');
});

test('order steps: a failed draft reads "failed" with its own reason code, never "stopped"', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env);
  const { order } = await seedOrder(env, plan);
  await seedRun(env, order, { status: 'failed', callId: 'call_1' });
  const [row] = await orders(env);
  assert.deepEqual(row.stages[2], {
    id: 'draft', label: 'Draft', state: 'waits', detail: 'failed, Run again waits on you', line: 'Draft, failed, Run again waits on you', waitsOn: 'you', reason: 'failed',
  });
  assert.equal(row.waitsOnYou?.line, '1 waits on you: a failed draft.');
});

test("order steps: the judge's sends never read as the draft's, and a finished draft's old unknown send is not reopened", async () => {
  const env = await setup();
  const plan = await seedBlueprint(env);
  const { order } = await seedOrder(env, plan);
  await setStage(env, 'approve-each');
  const unknownSend = (subject: string) => put(env, tx => record<JournalRecord>(tx, 'venture-journal-entry', {
    action: 'delivery.send', subject, target: 'Cafe Aroma Demo', actionDigest: 'a', describe: 'Send.', agent: null, shadow: false, quote: null,
    state: 'outcome_unknown', claimedAt: '2026-10-15T10:00:00.000Z', decidedBy: 'owner', outcome: null, receiptId: null, journal: [], approval: null,
    expiresAt: '2026-10-15T11:00:00.000Z',
  }));
  const ready = await seedRun(env, order, { status: 'ready-for-review', renderedText: 'x', checks: [] });
  await unknownSend(`${ready.id}:judge:call_9`);
  assert.deepEqual(brief((await orders(env))[0].stages)[2], ['draft', 'waits', 'ready, waits for you to read it']);
  const accepted = await seedRun(env, order, { status: 'accepted', renderedText: 'x', checks: [], verdict: ACCEPTED });
  await unknownSend(`${accepted.id}:call_1`);
  assert.deepEqual(brief((await orders(env))[0].stages)[2], ['draft', 'done', 'done']);
});

test("order steps: Client OK counts the answer the engine counts for the newest draft, revoked links included; it waits on the client only on a live served link", async () => {
  const env = await setup();
  const plan = await seedBlueprint(env);
  const { order } = await seedOrder(env, plan);
  const playbook = await playbookFor(env, 'social-agency');
  const link = (deliveryId: string, fields: Record<string, unknown>) => put(env, tx => record<ShareLinkStoredRecord>(tx, 'venture-share-link', {
    deliveryId, clientId: null, tokenHash: 'h', title: 'Drafts', text: 'The drafts', draftDigest: 'shown', expiresAt: '2026-10-22T10:00:00.000Z',
    state: 'open', revokedAt: null, served: false, decisions: [], ...fields,
  }));
  const decision = (digest: string, choice: 'approved' | 'changes', at: string, via: 'owner-recorded' | 'share-link' = 'owner-recorded') =>
    ({ draftId: 'x', decision: choice, comment: null, at, digest, via, recordedBy: via === 'owner-recorded' ? 'owner' : null });
  const older = await seedRun(env, order, { status: 'accepted', playbookId: playbook.id, renderedText: 'October drafts', checks: [], verdict: ACCEPTED });
  await link(older.id, { decisions: [decision(clientDraft(older).digest, 'approved', '2026-10-15T10:00:30.000Z')], state: 'closed' });
  env.advance(60_000);
  const newest = await seedRun(env, order, { status: 'accepted', playbookId: playbook.id, renderedText: 'November drafts', checks: [], verdict: ACCEPTED });
  const current = clientDraft(newest).digest;
  const stage = async () => {
    const found = (await orders(env))[0].stages.find(item => item.id === 'client-ok')!;
    return [found.state, found.detail, found.reason ?? null, found.waitsOn ?? null];
  };
  // An older draft's approval is not this draft's.
  assert.deepEqual(await stage(), ['not-yet', 'not yet', null, null]);
  // A link kept but not served: the owner sends the draft and records the answer, so it does not wait on the client.
  await link(newest.id, {});
  assert.deepEqual(await stage(), ['not-yet', 'not yet', null, null]);
  // A served link that ended with no answer waits on nobody.
  await link(newest.id, { served: true, expiresAt: '2026-10-15T09:00:00.000Z' });
  assert.deepEqual(await stage(), ['not-yet', 'the link ended with no answer', 'link-ended', null]);
  // Only a served, unexpired, unrevoked link waits on the client.
  await link(newest.id, { served: true });
  assert.deepEqual(await stage(), ['not-yet', 'waits for your client', 'with-client', 'client']);
  // An answer on another text, a share-link answer stamped after its link ended, or after it was taken back: none counts.
  await link(newest.id, { served: true, decisions: [decision('another-draft', 'approved', '2026-10-15T10:02:00.000Z')] });
  await link(newest.id, { served: true, expiresAt: '2026-10-15T09:00:00.000Z', decisions: [decision(current, 'approved', '2026-10-15T10:03:00.000Z', 'share-link')] });
  await link(newest.id, { served: true, state: 'revoked', revokedAt: '2026-10-15T10:03:30.000Z', decisions: [decision(current, 'approved', '2026-10-15T10:04:00.000Z', 'share-link')] });
  assert.deepEqual(await stage(), ['not-yet', 'waits for your client', 'with-client', 'client']);
  // An answer the owner recorded counts as it is, even on a link that has ended.
  await link(newest.id, { expiresAt: '2026-10-15T09:00:00.000Z', decisions: [decision(current, 'changes', '2026-10-15T10:05:00.000Z')] });
  assert.deepEqual(await stage(), ['waits', 'your client asked for changes', 'client-changes', 'you']);
  // An approval the client gave on a link the owner later took back still stands: the same answer ALREADY_DECIDED reads.
  await link(newest.id, { served: true, state: 'revoked', revokedAt: '2026-10-15T10:30:00.000Z', decisions: [decision(current, 'approved', '2026-10-15T10:06:00.000Z', 'share-link')] });
  assert.deepEqual(await stage(), ['done', 'your client approved it', 'client-approved', null]);
});
