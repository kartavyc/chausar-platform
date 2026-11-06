// Ink v2 wave 4, package 4G2 (catalogue O10): the needs-you probes. Each probe is code (no model), has a severity and a
// deep link, and runs inside its own try and catch: one that throws is skipped, and the journal sweep's tick writes a
// Keeper run 'probes' with its failure. Each probe row is a 'notice' with Open and Later, deduped by subject; Later is
// remembered until the facts change. What another source already shows is not shown twice: unread client replies are
// 4E3's reply rows, spend at the alert share is 4F2's notice, an unusable AI is the setup row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { postingName } from '../runtime/venture/build/posting.ts';
import { spawnSync } from 'node:child_process';
import { YOUTUBE_CONNECTOR_IDS, youtubeConnectors } from '../runtime/venture/playbooks/youtube/playbook.ts';
import type { Context } from '../runtime/contracts.ts';
import type {
  BuildFollowRecord, ConnectorCheckRecord, ConnectorPostRecord, DeliveryRunRecord, InboundRecord, InvoiceRecord, KeeperRunRecord, KeeperView, OrderRecord, PaymentRecord,
  QueueDecision, QueueList, QueueRow, RowFigureReceipt, SpendRecord, VentureDeps,
} from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { getReceipt } from '../runtime/venture/money/quote.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { planCalendar } from '../runtime/venture/playbooks/social/calendar.ts';
import { notifyRefresh } from '../runtime/venture/notify/centre.ts';
import { decideW4Row } from '../runtime/venture/views/queue-w4.ts';
import { sweepWholeJournal } from '../runtime/venture/build/journal-sweep.ts';
import { noticeRows, PROBES, probeRows as probeItems, recordProbeRuns, runProbes, type Probe } from '../runtime/venture/views/probes.ts';
import { systemLineOk } from '../runtime/venture/journal/system-lines.ts';
import { call, code, owner, seedBlueprint, seedOrder, setup, START, type Env } from './venture-views-env.ts';
import { add, days, seedDraft, withPeople } from './venture-pipeline-env.ts';
import { net } from './venture-network-env.ts';

const DAY = 86_400_000;
const list = (env: Env) => call<QueueList>(env, 'venture.queue.list', {});
const decide = (env: Env, row: QueueRow, action: string) => call<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action });
const probeRows = async (env: Env) => (await list(env)).rows.filter(row => row.id.startsWith('probe:'));
const subjectOf = (row: QueueRow) => row.id.slice(0, row.id.lastIndexOf(':'));
const ofProbe = async (env: Env, probe: string) => (await probeRows(env)).filter(row => row.notice?.probe === probe);
const mustLine = (line: string | undefined) => assert.ok(line && systemLineOk(line), `keeps the system-line grammar: ${line}`);

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

/** A post as build/posting.ts stores it, moved through the given journal steps (the last one is its state). */
async function seedPost(env: Env, steps: { state: ConnectorPostRecord['state']; by: string; line: string }[]): Promise<ConnectorPostRecord> {
  return ventureAction(env.deps, owner, 'prepare', 'seed.post', tx => tx.put<ConnectorPostRecord>({
    ...tx.base('venture-connector-post'), connectorId: 'linkedin', mode: 'owner-browser-session', account: 'Ledger Cafe', text: 'Fresh books every month.',
    agent: 'Social agent', digest: 'p'.repeat(64), state: steps.at(-1)!.state, describe: 'Post to LinkedIn.', risk: null, claimedAt: tx.now, decidedBy: 'owner',
    outcome: null, journal: steps.map(step => ({ ...step, at: tx.now })),
  }));
}

/** One connection check as 4J7 stores it. */
async function seedCheck(env: Env, rows: ConnectorCheckRecord['rows']): Promise<ConnectorCheckRecord> {
  return ventureAction(env.deps, owner, 'prepare', 'seed.check', tx => tx.put<ConnectorCheckRecord>({ ...tx.base('venture-connector-check'), rows }));
}

const failedRow = (connectorId: string, name: string, fix: string) =>
  ({ connectorId, name, outcome: 'failed' as const, line: `${name} did not answer.`, account: null, expiresOn: null, fix });

/** A cleared payment received on a day, in the business's rupees. */
async function seedPayment(env: Env, receivedOn: string, amountMinor: string): Promise<PaymentRecord> {
  return ventureAction(env.deps, owner, 'prepare', 'seed.payment', tx => tx.put<PaymentRecord>({
    ...tx.base('venture-payment'), invoiceId: 'invoice_none', amountMinor, currency: 'INR', receivedOn, method: 'upi', factId: 'fact_x', booksReceiptId: null, booksNote: null,
  }));
}

/** Weekly payments: each amount on the Monday of a week, the last on the given Monday. */
async function weeklyPayments(env: Env, lastMonday: string, amounts: string[]): Promise<void> {
  const last = Date.parse(`${lastMonday}T00:00:00.000Z`);
  for (const [index, amount] of amounts.entries()) {
    const day = new Date(last - (amounts.length - 1 - index) * 7 * DAY).toISOString().slice(0, 10);
    await seedPayment(env, day, amount);
  }
}

/** A social content calendar on an open order: LinkedIn every Monday, Wednesday and Friday of October 2026. */
const CALENDAR = { month: '2026-10', channels: ['linkedin' as const], postsPerChannel: 13, weekdays: [1, 3, 5] };

async function calendarOrder(env: Env, calendar: typeof CALENDAR = CALENDAR): Promise<OrderRecord> {
  const plan = await seedBlueprint(env);
  const { order } = await seedOrder(env, plan);
  return ventureAction(env.deps, owner, 'prepare', 'seed.intake', tx => tx.replace<OrderRecord>({
    ...order, intake: { rights: null, format: 'long', aiVoice: false, aiPresenter: false, paidPromotion: false, cutFile: null, calendar },
  }));
}

/** A draft for the order with n LinkedIn posts under Drafts. */
async function calendarDraft(env: Env, order: OrderRecord, posts: number): Promise<DeliveryRunRecord> {
  return ventureAction(env.deps, owner, 'prepare', 'seed.run', tx => tx.put<DeliveryRunRecord>({
    ...tx.base('venture-delivery-run'), orderId: order.id, playbookId: 'playbook_social', playbookHash: 'hash', status: 'waiting-for-you', servedBy: 'model',
    practice: false, callId: null, preview: null, renderedText: null, checks: [], verdict: null, editedText: null,
    deliverable: {
      title: 'October posts', questionsForClient: [],
      sections: [{ heading: 'Drafts', parts: Array.from({ length: posts }, (_, i) => ({ kind: 'text' as const, text: `LinkedIn: Post ${i + 1} about monthly books.` })) }],
    },
  }));
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

test('modules load in any order: build/posting.ts first, then views/queue.ts, in a fresh process', () => {
  const posting = new URL('../runtime/venture/build/posting.ts', import.meta.url).href;
  const queue = new URL('../runtime/venture/views/queue.ts', import.meta.url).href;
  const script = `await import(${JSON.stringify(posting)}); const q = await import(${JSON.stringify(queue)}); if (typeof q.queueListHandler !== 'function') process.exit(3);`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(result.status, 0, result.stderr);
});

test('the YouTube plan names its connectors from a static list, the same as the connectors the playbook builds', () => {
  assert.deepEqual([...YOUTUBE_CONNECTOR_IDS], youtubeConnectors({ ffmpeg: false }).map(item => item.id));
});

// ---------------------------------------------------------------------------
// The probes as code
// ---------------------------------------------------------------------------

test('each probe is code with a severity and a deep link; every probe row is a notice with Open and Later, and none calls a model', async () => {
  assert.ok(PROBES.length >= 6);
  assert.equal(new Set(PROBES.map(probe => probe.id)).size, PROBES.length);
  for (const probe of PROBES) {
    assert.ok(['high', 'medium', 'low'].includes(probe.severity), probe.id);
    assert.match(probe.link, /^#\/[a-z]/, probe.id);
    assert.ok(probe.label.length > 3, probe.id);
  }
  const env = await setup();
  let generated = 0;
  env.models.generate = async () => { generated += 1; throw new Error('a probe called a model'); };
  // One row from every probe: a waiting draft, a sharp move, a stalled card (14 days on), then a failed post, a failed
  // check and a gap in next week's calendar (2 to 8 November).
  const { asha, rahul } = await withPeople(env);
  const ashaCard = (await add(env, asha)).card;
  await seedDraft(env, ashaCard, 'intro-request', 'email');
  await weeklyPayments(env, '2026-10-12', ['100000', '120000', '90000', '110000', '100000', '95000', '105000', '100000']);
  await seedPayment(env, '2026-10-19', '900000');
  const rahulCard = (await add(env, rahul)).card;
  await net(env, 'venture.pipeline.move', { id: rahulCard.id, stage: 'talking', evidence: { kind: 'note', on: '2026-10-15' } });
  days(env, 14);
  await seedPost(env, [{ state: 'described', by: 'Social agent', line: 'Proposed.' }, { state: 'approved', by: 'owner', line: 'Approved.' }, { state: 'rejected', by: 'platform', line: 'LinkedIn refused it.' }]);
  await seedCheck(env, [failedRow('mailbox', 'Your mailbox', 'Make a new app password for your mailbox and connect it again.')]);
  await calendarOrder(env, { ...CALENDAR, month: '2026-11' });
  const rows = await probeRows(env);
  assert.deepEqual([...new Set(rows.map(row => row.notice!.probe))].sort(), ['calendar', 'connection', 'drafts', 'moved', 'post', 'stalled']);
  for (const row of rows) {
    assert.equal(row.kind, 'notice');
    assert.deepEqual(row.actions.map(item => [item.id, item.primary]), [['open', true], ['later', false]], row.id);
    const probe = PROBES.find(item => item.id === row.notice!.probe)!;
    assert.deepEqual([row.notice!.severity, row.notice!.link], [probe.severity, probe.link]);
    assert.ok(row.title.length > 0 && !/\u2014|\u2013/.test(`${row.title} ${row.line}`), row.id);
    mustLine(row.line);
  }
  assert.equal(generated, 0, 'no probe calls a model');
});

test('a probe that throws is skipped: the others still answer, and the tick writes a Keeper run probes with its failure', async () => {
  const env = await setup();
  await seedCheck(env, [failedRow('mailbox', 'Your mailbox', 'Make a new app password for your mailbox and connect it again.')]);
  const boom: Probe = { id: 'post', label: 'failed posts', severity: 'high', link: '#/money/journal', rows: () => { throw new Error('the post records could not be read'); } };
  await recordProbeRuns(env.deps, owner);
  assert.deepEqual(listRecords(env.store.read(), 'venture-keeper-run').filter((run: KeeperRunRecord) => run.job === 'probes'), [], 'nothing to report until a probe throws');
  const state = env.store.read();
  const result = runProbes(env.deps, owner, state, listRecords(state, 'venture-record').at(-1)!, [boom, ...PROBES.filter(probe => probe.id === 'connection')]);
  assert.deepEqual(result.rows.map(row => row.subject), ['probe:connection:mailbox']);
  assert.deepEqual(result.failed.map(item => item.id), ['post']);

  await recordProbeRuns(env.deps, owner, [boom, ...PROBES]);
  const runs = listRecords(env.store.read(), 'venture-keeper-run').filter((run: KeeperRunRecord) => run.job === 'probes');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].outcome, 'failed');
  assert.equal(runs[0].line, 'The check for failed posts could not run: the post records could not be read');
  assert.ok(env.published.flat().some(event => event.name === 'keeper.ran'));
  const keeper = await call<KeeperView>(env, 'venture.team.keeper', {});
  assert.equal(keeper.jobs.find(job => job.id === 'probes')?.lastRun?.outcome, 'failed');

  // Today still lists the business's rows whatever a probe does.
  assert.ok((await list(env)).rows.some(row => row.id.startsWith('probe:connection:mailbox:')));
  // A run that worked replaces the failed one; the same result again writes nothing.
  await recordProbeRuns(env.deps, owner);
  const after = listRecords(env.store.read(), 'venture-keeper-run').filter((run: KeeperRunRecord) => run.job === 'probes');
  assert.equal(after.length, 1);
  assert.deepEqual([after[0].outcome, after[0].line], ['ok', 'Needs-you checks found 1 thing that needs you.']);
  const commits = env.store.commits;
  await recordProbeRuns(env.deps, owner);
  assert.equal(env.store.commits, commits, 'nothing changed, nothing written');
  // The journal sweep's tick runs them.
  env.advance(DAY + 1000);
  await sweepWholeJournal(env.deps, owner);
  assert.notEqual(listRecords(env.store.read(), 'venture-keeper-run').find((run: KeeperRunRecord) => run.job === 'probes')!.at, after[0].at, 'renewed a day later by the tick');
});

// ---------------------------------------------------------------------------
// Each probe
// ---------------------------------------------------------------------------

test('posts that failed or whose outcome is unknown in the last 7 days; not one the owner turned down or checked', async () => {
  const env = await setup();
  const name = postingName('linkedin');
  const failed = await seedPost(env, [{ state: 'described', by: 'Social agent', line: 'Proposed.' }, { state: 'approved', by: 'owner', line: 'Approved.' }, { state: 'rejected', by: 'platform', line: 'Refused.' }]);
  const unknown = await seedPost(env, [{ state: 'described', by: 'Social agent', line: 'Proposed.' }, { state: 'approved', by: 'owner', line: 'Approved.' }, { state: 'outcome_unknown', by: 'engine', line: 'Stopped.' }]);
  await seedPost(env, [{ state: 'described', by: 'Social agent', line: 'Proposed.' }, { state: 'rejected', by: 'owner', line: 'You chose not to do this.' }]);
  await seedPost(env, [{ state: 'approved', by: 'owner', line: 'Approved.' }, { state: 'outcome_unknown', by: 'engine', line: 'Stopped.' }, { state: 'rejected', by: 'owner', line: 'You checked: it did not happen.' }]);
  const rows = await ofProbe(env, 'post');
  assert.deepEqual(rows.map(row => [subjectOf(row), row.title]), [
    [`probe:post:${failed.id}`, `A post to ${name} did not go out`],
    [`probe:post:${unknown.id}`, `A post to ${name} may have gone out`],
  ]);
  assert.equal(rows[0].line, `It stopped on 15 Oct. Open the journal to see why, then propose it again.`);
  assert.equal(rows[1].line, `Chausar stopped while posting on 15 Oct. Check ${name}, then record what you found in the journal.`);
  assert.deepEqual(rows.map(row => row.notice!.severity), ['high', 'high']);
  days(env, 8);
  assert.deepEqual(await ofProbe(env, 'post'), [], 'older than 7 days');
});

test('a broken connection: a failed check in the latest run, with its fix; an AI the setup row already names is not said twice', async () => {
  const env = await setup();
  await seedCheck(env, [failedRow('mailbox', 'Your mailbox', 'Make a new app password and connect it again.')]);
  env.advance(60_000);
  await seedCheck(env, [
    { connectorId: 'mailbox', name: 'Your mailbox', outcome: 'answered', line: 'Connected as owner@ledger.example.', account: 'owner@ledger.example', expiresOn: null, fix: null },
    failedRow('github', 'GitHub', 'Give a token that can read the repo.'),
  ]);
  let rows = await ofProbe(env, 'connection');
  assert.deepEqual(rows.map(row => [subjectOf(row), row.title, row.line]), [['probe:connection:github', 'GitHub failed its check', 'GitHub did not answer. Give a token that can read the repo.']]);
  assert.equal(rows[0].notice!.link, '#/connections');

  // The AI key and the command-line AI failed too, while the setup row says "Your AI needs attention": the setup row is the one.
  env.models.connected = true;
  env.models.usable = false;
  env.advance(60_000);
  await seedCheck(env, [failedRow('model:anthropic-sonnet-5-5', 'Claude Sonnet', 'Paste your Anthropic key again.'), failedRow('cli:codex', 'Codex', 'Sign in to Codex again.'), failedRow('github', 'GitHub', 'Give a token that can read the repo.')]);
  const all = (await list(env)).rows;
  assert.ok(all.some(row => row.id.startsWith('setup:ai:attention')));
  rows = await ofProbe(env, 'connection');
  assert.deepEqual(rows.map(subjectOf), ['probe:connection:github']);
});

test('drafts waiting more than 3 days: one row for the messages the owner has not sent; reminders and timed follow-ups have their own rows', async () => {
  const env = await setup();
  const { asha, rahul } = await withPeople(env);
  const ashaCard = (await add(env, asha)).card;
  const rahulCard = (await add(env, rahul)).card;
  await seedDraft(env, ashaCard, 'intro-request', 'email');
  await seedDraft(env, rahulCard, 'follow-up', 'email');
  days(env, 3);
  assert.deepEqual(await ofProbe(env, 'drafts'), [], 'three days is not more than three');
  env.advance(60_000);
  let [row] = await ofProbe(env, 'drafts');
  assert.equal(row.title, '1 drafted message has waited more than 3 days');
  assert.equal(row.line, 'It is for Asha Rao, drafted on 15 Oct. Send it yourself from Clients, Pipeline.');
  assert.equal(row.notice!.severity, 'low');
  await seedDraft(env, rahulCard, 'connection-note', 'linkedin');
  // LinkedIn is paused for 72 hours: the note waits from the end of the pause.
  await net(env, 'venture.outreach.restricted', { channel: 'linkedin' });
  days(env, 4);
  [row] = await ofProbe(env, 'drafts');
  assert.equal(row.title, '1 drafted message has waited more than 3 days');
  days(env, 3);
  [row] = await ofProbe(env, 'drafts');
  assert.equal(row.title, '2 drafted messages have waited more than 3 days');
  assert.equal(row.line, 'The oldest is for Asha Rao, drafted on 15 Oct. Send them yourself from Clients, Pipeline.');
  // Sent ones leave it.
  await ventureAction(env.deps, owner, 'approve', 'seed.sent', tx => {
    for (const draft of tx.list('venture-outreach')) tx.replace({ ...draft, sent: { at: tx.now, channel: 'own-mailbox' as const, recordedAt: tx.now, recordedBy: 'owner' } });
  });
  assert.deepEqual(await ofProbe(env, 'drafts'), []);
});

test('unread client replies are 4E3\'s reply rows, one per unread reply: the probes add no second row', async () => {
  const env = await setup();
  const { asha } = await withPeople(env);
  const { card } = await add(env, asha);
  await net(env, 'venture.pipeline.move', { id: card.id, stage: 'asked', evidence: { kind: 'note', on: '2026-10-15' } });
  const inbound = await ventureAction(env.deps, owner, 'prepare', 'seed.inbound', tx => tx.put<InboundRecord>({
    ...tx.base('venture-inbound'), messageId: '<m1@dewdrop.example>', from: 'asha@dewdrop.example', to: ['owner@ledger.example'], date: env.now(),
    subject: 'Re: gift boxes', references: [], matched: { opportunityId: card.id, confidenceBp: 9500 }, triage: 'talking', line: 'She wrote back.', processed: false, screen: null,
  }));
  days(env, 5);
  const rows = (await list(env)).rows;
  assert.deepEqual(rows.filter(row => row.kind === 'reply').map(subjectOf), [`reply:${inbound.id}`]);
  assert.deepEqual(rows.filter(row => row.id.startsWith('probe:')), [], 'no probe row for a reply Today already shows');
  // Later on the reply row is respected: nothing comes back about it.
  const reply = rows.find(row => row.kind === 'reply')!;
  assert.equal((await decide(env, reply, 'later')).outcome, 'done');
  assert.deepEqual((await list(env)).rows.filter(row => row.kind === 'reply' || row.id.startsWith('probe:')), []);
});

test('a gap in next week\'s social calendar: the planned slots no draft fills, by code', async () => {
  const env = await setup();
  const order = await calendarOrder(env);
  const nextWeek = planCalendar(CALENDAR).filter(slot => slot.date >= '2026-10-19' && slot.date <= '2026-10-25').map(slot => slot.date);
  assert.deepEqual(nextWeek, ['2026-10-19', '2026-10-21', '2026-10-23']);
  let [row] = await ofProbe(env, 'calendar');
  assert.equal(subjectOf(row), `probe:calendar:${order.id}`);
  assert.equal(row.title, '3 posts next week have no draft');
  assert.equal(row.line, 'The calendar for Cafe Aroma Demo plans LinkedIn on 19 Oct, 21 Oct and 23 Oct with nothing drafted. Open the order in Work to draft them.');
  assert.equal(row.notice!.link, '#/work');
  await calendarDraft(env, order, 8); // fills every slot up to 19 Oct
  [row] = await ofProbe(env, 'calendar');
  assert.equal(row.title, '2 posts next week have no draft');
  await calendarDraft(env, order, 13);
  assert.deepEqual(await ofProbe(env, 'calendar'), [], 'every slot drafted');
});

test('spend at the alert share is 4F2\'s notice; the probes add no second row', async () => {
  const env = await setup();
  const policySet = (money as Record<string, (d: VentureDeps, c: Context, p: unknown) => Promise<unknown>>)['venture.spend.policy.set'];
  await policySet(env.deps, owner, { capUsd: '10.00' });
  await ventureAction(env.deps, owner, 'prepare', 'seed.spend', tx => tx.put<SpendRecord>({
    ...tx.base('venture-spend'), key: 'seed-1', item: 'connector:fal-video', label: 'One video render', agent: null, connector: 'fal-video', payer: 'connector:fal',
    draftDigest: 'd', rate: null, reservedMicros: '9000000', settledMicros: '9000000', settledBy: 'bill', phase: 'settled', quoteId: null, ref: null, refusal: null, settledAt: tx.now,
  }));
  const rows = (await list(env)).rows;
  assert.deepEqual(rows.filter(row => row.id.startsWith('spend:alert:')).length, 1);
  assert.deepEqual(rows.filter(row => row.id.startsWith('probe:')), []);
});

test('a figure that moved sharply: weekly received with a z-score over 3 on at least 7 weeks, both figures with receipts', async () => {
  const env = await setup();
  await weeklyPayments(env, '2026-10-05', ['100000', '120000', '90000', '110000', '100000', '95000']);
  await seedPayment(env, '2026-10-13', '900000');
  let [row] = await ofProbe(env, 'moved');
  assert.equal(row, undefined, 'six weeks before this one are too few points');
  await seedPayment(env, '2026-08-24', '105000'); // the seventh week before
  [row] = await ofProbe(env, 'moved');
  assert.ok(row, 'seven points are enough');
  assert.equal(subjectOf(row), 'probe:moved:received');
  assert.equal(row.title, 'Money received moved sharply');
  assert.equal(row.line, 'Moved sharply this week: INR 9,000.00 received so far, against INR 1,029.00 a week on average over the 7 weeks before.');
  assert.equal(row.notice!.severity, 'medium');
  assert.equal(row.notice!.link, '#/money');
  // Both figures carry their receipts, worked out again by code on every read.
  assert.deepEqual(row.amounts?.map(amount => [amount.text, amount.receiptId]), [
    ['INR 9,000.00', 'fig:week:received:2026-10-12'], ['INR 1,029.00', 'fig:weeks:received:2026-08-24:2026-10-05'],
  ]);
  const week = await getReceipt(env.deps, owner, { id: 'fig:week:received:2026-10-12' }) as RowFigureReceipt;
  assert.deepEqual(week.figures.map(figure => [figure.key, figure.amount, figure.display]), [['total', '900000', 'INR 9,000.00']]);
  assert.equal(week.stale, false);
  const usual = await getReceipt(env.deps, owner, { id: 'fig:weeks:received:2026-08-24:2026-10-05' }) as RowFigureReceipt;
  assert.equal(usual.figures.at(-1)!.display, 'INR 1,029.00');
  assert.equal(usual.figures.length, 8, 'each of the 7 weeks, then the average');
  await assert.rejects(getReceipt(env.deps, owner, { id: 'fig:week:sideways:2026-10-12' }), code('RECEIPT_NOT_FOUND'));
});

test('a steady series does not move sharply, and the same amount every week has no spread to measure against', async () => {
  const env = await setup();
  await weeklyPayments(env, '2026-10-05', ['100000', '120000', '90000', '110000', '100000', '95000', '105000', '100000']);
  await seedPayment(env, '2026-10-13', '115000');
  assert.deepEqual(await ofProbe(env, 'moved'), []);
  const flat = await setup();
  await weeklyPayments(flat, '2026-10-05', Array.from({ length: 8 }, () => '100000'));
  await seedPayment(flat, '2026-10-13', '100500');
  assert.deepEqual(await ofProbe(flat, 'moved'), []);
});

test('billed moves too: invoices issued in a week, before tax', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env);
  const { client, order } = await seedOrder(env, plan);
  const invoice = (issueDate: string, subtotalMinor: string, number: string) => ventureAction(env.deps, owner, 'prepare', 'seed.invoice', tx => tx.put<InvoiceRecord>({
    ...tx.base('venture-invoice'), orderId: order.id, clientId: client.id, number, status: 'issued', issueDate, dueDate: null, currency: 'INR',
    subtotalMinor, discountMinor: '0', taxMinor: '0', totalMinor: subtotalMinor, balanceMinor: subtotalMinor,
  } as unknown as InvoiceRecord));
  const weeks = ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'];
  for (const [i, day] of weeks.entries()) await invoice(day, i % 2 ? '200000' : '180000', `INV-${i + 1}`);
  await invoice('2026-10-12', '2000000', 'INV-9');
  const [row] = await ofProbe(env, 'moved');
  assert.equal(row?.title, 'Money billed moved sharply');
  assert.match(row.line!, /^Moved sharply this week: INR 20,000\.00 billed so far, before tax, against INR 1,900\.00 a week on average over the 8 weeks before\.$/);
});

test('a stalled client: "No reply from Asha in 14 days" on a Talking card, and an open quote 14 days unanswered', async () => {
  const env = await setup();
  const { asha, rahul } = await withPeople(env);
  const talking = (await add(env, asha)).card;
  await net(env, 'venture.pipeline.move', { id: talking.id, stage: 'talking', evidence: { kind: 'note', on: '2026-10-15' } });
  const quoted = (await add(env, rahul)).card;
  await net(env, 'venture.pipeline.move', { id: quoted.id, stage: 'talking', evidence: { kind: 'note', on: '2026-10-15' } });
  days(env, 2);
  await net(env, 'venture.pipeline.move', { id: quoted.id, stage: 'proposal', evidence: { kind: 'note', on: '2026-10-17', text: 'Offered monthly books for their two shops.' } });
  days(env, 11);
  assert.deepEqual(await ofProbe(env, 'stalled'), []);
  days(env, 1);
  // Moving a card to Talking records their reply, so the line says when they last wrote.
  let rows = await ofProbe(env, 'stalled');
  assert.deepEqual(rows.map(row => [row.title, row.line]), [
    ['No reply from Asha in 14 days', 'Asha Rao last wrote on 15 Oct. Follow up yourself, or move the card in Clients, Pipeline.'],
  ]);
  days(env, 2);
  rows = await ofProbe(env, 'stalled');
  assert.deepEqual(rows.map(row => [row.title, row.line]), [
    ['No reply from Asha in 16 days', 'Asha Rao last wrote on 15 Oct. Follow up yourself, or move the card in Clients, Pipeline.'],
    ['No answer to your quote for Rahul in 14 days', 'Rahul Mehta moved to Proposal on 17 Oct and has not written since. Follow up yourself, or move the card in Clients, Pipeline.'],
  ]);
  for (const row of rows) mustLine(row.line);
  assert.ok(!(await list(env)).rows.some(row => row.kind === 'followup'), 'no follow-up row says the same');
  // The days go up, but the facts are the same: Later holds.
  assert.equal((await decide(env, rows[0], 'later')).outcome, 'done');
  days(env, 3);
  assert.deepEqual((await ofProbe(env, 'stalled')).map(row => row.title), ['No answer to your quote for Rahul in 17 days']);
});

// ---------------------------------------------------------------------------
// Later, dedupe, counting
// ---------------------------------------------------------------------------

test('Later is remembered: the same probe does not come back until its facts change', async () => {
  const env = await setup();
  await seedCheck(env, [failedRow('github', 'GitHub', 'Give a token that can read the repo.')]);
  const [row] = await ofProbe(env, 'connection');
  assert.deepEqual(await decide(env, row, 'later'), { outcome: 'done', line: 'Moved to later.' });
  assert.deepEqual(await ofProbe(env, 'connection'), []);
  days(env, 1);
  await seedCheck(env, [failedRow('github', 'GitHub', 'Give a token that can read the repo.')]); // the same failure, checked again
  assert.deepEqual(await ofProbe(env, 'connection'), [], 'the same facts stay later');
  env.advance(60_000);
  await seedCheck(env, [{ ...failedRow('github', 'GitHub', 'Give a token that can read the repo.'), line: 'GitHub answered 401.' }]);
  assert.deepEqual(await ofProbe(env, 'connection'), [], 'the same fix: other words for the same failure stay later');
  env.advance(60_000);
  await seedCheck(env, [failedRow('github', 'GitHub', 'Follow the repo again: it was renamed.')]);
  const [back] = await ofProbe(env, 'connection');
  assert.ok(back && back.id !== row.id, 'new facts, a new version');

  // Open is navigation, not a decision; anything else is refused in words.
  const opened = await decide(env, back, 'open');
  assert.equal(opened.outcome, 'refused');
  await assert.rejects(decideW4Row(env.deps, owner, { source: 'notice', row: back, subject: subjectOf(back), action: 'approve', answer: null }), code('INVALID_VENTURE_REQUEST'));
});

test('dedupe: probe subjects are unique on Today and never another source\'s; noticeRows keeps the other sources\' rows', async () => {
  const env = await setup();
  await seedPost(env, [{ state: 'approved', by: 'owner', line: 'Approved.' }, { state: 'rejected', by: 'platform', line: 'Refused.' }]);
  await seedPost(env, [{ state: 'approved', by: 'owner', line: 'Approved.' }, { state: 'outcome_unknown', by: 'engine', line: 'Stopped.' }]);
  await seedCheck(env, [failedRow('github', 'GitHub', 'Give a token that can read the repo.'), failedRow('mailbox', 'Your mailbox', 'Connect it again.')]);
  const rows = (await list(env)).rows;
  const subjects = rows.map(subjectOf);
  assert.equal(new Set(subjects).size, subjects.length, 'one row per subject');
  const state = env.store.read();
  const items = await noticeRows(env.deps, owner, state, listRecords(state, 'venture-record').at(-1)!);
  assert.equal(items.filter(item => item.subject.startsWith('probe:')).length, 4);
  assert.equal(new Set(items.map(item => item.subject)).size, items.length);
});

test('dedupe: an unreadable GitHub repo is the connector row, not a second probe row', async () => {
  const env = await setup();
  await ventureAction(env.deps, owner, 'prepare', 'seed.follow', tx => tx.put<BuildFollowRecord>({
    ...tx.base('venture-build-follow'), repo: { owner: 'ledger', name: 'site' }, tokenState: 'none', linkedAt: tx.now,
    lastStatus: { word: 'repo-not-readable', asOf: tx.now, readId: null, repo: { fullName: 'ledger/site', private: null, defaultBranch: null, htmlUrl: null }, lastCommit: null } as BuildFollowRecord['lastStatus'],
  }));
  await seedCheck(env, [failedRow('github', 'GitHub', 'Give a token that can read the repo.'), failedRow('mailbox', 'Your mailbox', 'Connect it again.')]);
  const rows = (await list(env)).rows;
  assert.ok(rows.some(row => subjectOf(row) === 'connector:github'), 'the connector row says it');
  assert.deepEqual((await ofProbe(env, 'connection')).map(subjectOf), ['probe:connection:mailbox']);
});

test('dedupe: a card whose follow-up row Today already shows has no stalled row', async () => {
  const env = await setup();
  const { asha } = await withPeople(env);
  const { card } = await add(env, asha);
  await net(env, 'venture.pipeline.move', { id: card.id, stage: 'talking', evidence: { kind: 'note', on: '2026-10-15' } });
  days(env, 14);
  const state = env.store.read();
  const venture = listRecords(state, 'venture-record').at(-1)!;
  assert.deepEqual(probeItems(env.deps, owner, state, venture, new Set()).map(row => row.subject), [`probe:stalled:${card.id}`]);
  assert.deepEqual(probeItems(env.deps, owner, state, venture, new Set([`followup:${card.id}`])), [], 'the follow-up row says it');
});

test('a sharp move\'s figures carry receipts in any currency, matched as written', async () => {
  for (const currency of ['NZD', 'JPY', 'ZAR']) {
    const env = await setup();
    await ventureAction(env.deps, owner, 'admin', 'seed.currency', tx => { tx.touch({ country: { ...env.venture.country, currency } }); });
    const pay = (receivedOn: string, amountMinor: string) => ventureAction(env.deps, owner, 'prepare', 'seed.payment', tx => tx.put<PaymentRecord>({
      ...tx.base('venture-payment'), invoiceId: 'invoice_none', amountMinor, currency, receivedOn, method: 'upi', factId: 'fact_x', booksReceiptId: null, booksNote: null,
    }));
    const weeks = ['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'];
    for (const [i, day] of weeks.entries()) await pay(day, String(100000 + (i % 3) * 10000));
    await pay('2026-10-13', '900000');
    const [row] = await ofProbe(env, 'moved');
    assert.ok(row, currency);
    assert.deepEqual(row.amounts?.map(amount => amount.receiptId), ['fig:week:received:2026-10-12', 'fig:weeks:received:2026-08-24:2026-10-05'], currency);
    for (const amount of row.amounts!) {
      assert.equal(row.line!.slice(amount.start, amount.start + amount.length), amount.text, currency);
      assert.ok(amount.text.includes(currency), `${currency}: ${amount.text}`);
    }
  }
});

test('a probe row is counted once: one notification by its subject, however often the centre refreshes', async () => {
  const env = await setup();
  await seedCheck(env, [failedRow('github', 'GitHub', 'Give a token that can read the repo.')]);
  const before = (await list(env)).needsYou;
  await notifyRefresh(env.deps, owner);
  await notifyRefresh(env.deps, owner);
  env.advance(60_000);
  await notifyRefresh(env.deps, owner);
  const notes = listRecords(env.store.read(), 'venture-notification').filter(record => record.subject === 'probe:connection:github');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].rowKind, 'notice');
  const queue = await list(env);
  assert.equal(queue.rows.filter(row => subjectOf(row) === 'probe:connection:github').length, 1);
  assert.equal(queue.needsYou, before);
  // Later ends the episode; the same facts never notify again.
  const [row] = await ofProbe(env, 'connection');
  await decide(env, row, 'later');
  await notifyRefresh(env.deps, owner);
  assert.equal(listRecords(env.store.read(), 'venture-notification').filter(record => record.subject === 'probe:connection:github').length, 1);
});

test('a business still in its interview (no country yet) has no probe rows, and Today still lists', async () => {
  const env = await setup();
  await seedCheck(env, [failedRow('github', 'GitHub', 'Give a token that can read the repo.')]);
  await ventureAction(env.deps, owner, 'admin', 'seed.country', tx => { tx.touch({ country: null } as never); });
  const result = await list(env);
  assert.deepEqual(result.rows.filter(row => row.id.startsWith('probe:')), []);
  await recordProbeRuns(env.deps, owner);
  assert.ok(Date.parse(START) > 0);
});
