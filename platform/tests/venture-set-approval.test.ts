// Ink v2 wave 4 (4J2, O9): set approval. The owner picks posts and drafts on Today; venture.queue.setPreview works out
// the set on the server (one digest over the picked rows in order plus their total quote, the total's sum receipt,
// whether it asks twice, and why any item can't go in), and venture.queue.set approves it with that digest. Each item
// is still decided on its own (its own Today decision, review record, journal entry and charge record). Money, prices,
// invoices and sign-offs are refused (SET_KIND_REFUSED), and so is a post that does not show all it sends; an empty pick
// is SET_NEEDS_PICK and there is no "all"; an item that must be read first needs the owner to have opened that exact
// version (VIEW_FIRST); a set that asks twice needs its second answer; a change before any item makes the whole set
// stale, and a change on the way stops it there.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type {
  BrowserPort, DecisionsView, QueueDecision, QueueList, QueueRow, QueueSetPreview, QueueSetResult, SpotCheckRecord, SumReceiptRecord,
} from '../runtime/venture/contracts.ts';
import { findRecord, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { proposePost } from '../runtime/venture/build/posting.ts';
import { SET_MAX, setRefusal } from '../runtime/venture/views/queue-actions.ts';
import { call, code, owner, phone, seedBlueprint, seedOrder, seedRun, setStage, setup, type Env } from './venture-views-env.ts';
import { seedPostDraft } from './venture-post-drafts.ts';

const agentCtx: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'mcp' };
const queue = (env: Env) => call<QueueList>(env, 'venture.queue.list', {});
/** The owner opens a row (4J19: the screen says opened only on an explicit open, never when a card draws its preview). */
const viewRow = (env: Env, row: QueueRow, ctx: Context = owner) => call(env, 'venture.queue.view', { id: row.id, opened: true }, ctx);
const preview = (env: Env, rows: Pick<QueueRow, 'id'>[]) => call<QueueSetPreview>(env, 'venture.queue.setPreview', { rowIds: rows.map(row => row.id) });
const set = (env: Env, rows: Pick<QueueRow, 'id'>[], digest: string, extra: Record<string, unknown> = {}, ctx: Context = owner) =>
  call<QueueSetResult>(env, 'venture.queue.set', { rowIds: rows.map(row => row.id), digest, ...extra }, ctx);
/** Opens each row, previews the set and approves it with the preview's digest. */
async function approveSet(env: Env, rows: QueueRow[], extra: Record<string, unknown> = {}) {
  for (const row of rows) await viewRow(env, row);
  const shown = await preview(env, rows);
  return { shown, result: await set(env, rows, shown.digest, extra) };
}

/** Three drafts waiting for the owner's review, on three orders. */
async function threeDrafts() {
  const env = await setup();
  const plan = await seedBlueprint(env);
  await setStage(env, 'approve-each');
  const runs = [];
  for (let index = 0; index < 3; index += 1) {
    const { order } = await seedOrder(env, plan);
    env.advance(60_000);
    runs.push(await seedRun(env, order, { status: 'ready-for-review', renderedText: `# Draft ${index + 1}\n\nThe plan for this month.` }));
  }
  const rows = (await queue(env)).rows.filter(row => row.kind === 'draft');
  assert.equal(rows.length, 3);
  return { env, plan, runs, rows };
}

function browser(): BrowserPort {
  return {
    async probe() { return { present: true, reason: 'Playwright with Chromium found on this computer.' }; },
    async post() { return { outcome: 'posted', line: 'X showed the post.', url: null }; },
  };
}

/** Posts waiting to go out, one per line; complete: whether each shows all it sends. */
async function posts(env: Env, lines: string[], complete = true) {
  env.deps = { ...env.deps, connectors: { browser: browser(), appReviewed: [], postTimeoutMs: 200 } };
  const draft = await seedPostDraft(env.deps, lines.map(line => `X: ${line}`));
  const made = [];
  for (let part = 1; part <= lines.length; part += 1) {
    made.push(await proposePost(env.deps, agentCtx, { connectorId: 'x', draftId: draft.id, part, ...(complete ? {} : { descriptionComplete: false }) }));
  }
  const rows = (await queue(env)).rows.filter(row => row.kind === 'connector');
  return { made, rows };
}

const runStatus = (env: Env, id: string) => findRecord(env.store.read(), 'venture-delivery-run', id)!.status;

test('set approval: the server works out the set, then the picked drafts are approved in the owner\'s order, each on its own', async () => {
  const { env, runs, rows } = await threeDrafts();
  const picked = [rows[2], rows[0]];
  const { shown, result } = await approveSet(env, picked);
  assert.deepEqual(shown.items.map(item => [item.rowId, item.cost]), picked.map(row => [row.id, 'USD 0.0000']));
  assert.equal(shown.total.display, 'USD 0.0000');
  assert.deepEqual([shown.secondAsk, shown.refusals], [false, []]);
  assert.match(shown.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.decisions.map(item => item.outcome), ['done', 'done']);
  assert.equal(result.line, 'Approved 2 of 2. Each one has its own record.');
  const receipt = findRecord(env.store.read(), 'venture-sum-receipt', result.receiptId!) as SumReceiptRecord;
  assert.deepEqual(receipt.subject, { type: 'set', items: picked.map(row => ({ rowId: row.id, label: row.title, micros: '0' })) });
  assert.deepEqual([receipt.totalMinor, receipt.figures[0].label], ['0', 'What this set can cost']);
  // Each item has its own Today decision and its own review record; the one not picked still waits.
  const clicks = listRecords(env.store.read(), 'venture-queue-decision');
  assert.deepEqual(clicks.map(item => [item.rowId, item.action]), [[rows[2].id, 'approve'], [rows[0].id, 'approve']]);
  assert.deepEqual(runs.map(run => runStatus(env, run.id)), ['accepted', 'ready-for-review', 'accepted']);
  assert.equal(listRecords(env.store.read(), 'venture-decision').filter(item => item.action === 'accepted').length, 2, 'one review record per item');
  const { decisions } = await call<DecisionsView>(env, 'venture.decisions.list', {});
  assert.equal(decisions.filter(item => item.action === 'approve' && item.who === 'owner').length, 2, 'each reaches the decisions list');
  assert.deepEqual((await queue(env)).rows.filter(row => row.kind === 'draft').map(row => row.id), [rows[1].id]);
});

test('an item that must be read first needs the owner to have opened that exact version inside the app (VIEW_FIRST)', async () => {
  const { env, runs, rows } = await threeDrafts();
  const before = await preview(env, rows);
  assert.deepEqual(before.refusals.map(item => item.reason), ['VIEW_FIRST', 'VIEW_FIRST', 'VIEW_FIRST']);
  await assert.rejects(set(env, rows, before.digest), code('VIEW_FIRST'));
  await viewRow(env, rows[0]);
  await viewRow(env, rows[1], phone);
  const some = await preview(env, rows);
  assert.deepEqual(some.refusals.map(item => item.rowId), [rows[1].id, rows[2].id], 'a read on the phone leaves no mark');
  await assert.rejects(set(env, rows, some.digest), code('VIEW_FIRST'));
  assert.equal(listRecords(env.store.read(), 'venture-queue-decision').length, 0, 'nothing ran');
  // A mark is for one version: a reopened draft is a new version to read.
  await ventureAction(env.deps, owner, 'prepare', 'seed.reopen', tx => { tx.replace({ ...tx.find('venture-delivery-run', runs[0].id)!, reopened: { count: 1, at: tx.now, files: [] } }); });
  const reopened = (await queue(env)).rows.find(row => row.viewRef?.id === runs[0].id)!;
  assert.deepEqual((await preview(env, [reopened])).refusals.map(item => item.reason), ['VIEW_FIRST']);
  const marks = listRecords(env.store.read(), 'venture-queue-view');
  assert.deepEqual(marks.map(mark => [mark.rowId, mark.rowDigest]), [[rows[0].id, rows[0].digest]]);
});

test('a card drawing its preview is not the owner opening it: no mark and still VIEW_FIRST; an explicit open satisfies it (4J19)', async () => {
  const { env, rows } = await threeDrafts();
  const [row] = rows;
  // What Today's card reads to draw a draft's text, by the row and by what it points at: no opened, so no mark.
  await call(env, 'venture.queue.view', { id: row.id });
  await call(env, 'venture.queue.view', { id: row.viewRef!.id, kind: 'draft' });
  assert.equal(listRecords(env.store.read(), 'venture-queue-view').length, 0, 'a preview fetch leaves no mark');
  assert.deepEqual((await preview(env, [row])).refusals.map(item => item.reason), ['VIEW_FIRST']);
  await assert.rejects(call(env, 'venture.queue.view', { id: row.id, opened: false }), code('INVALID_VENTURE_REQUEST'));
  // The owner opens it from the card (by what it points at, as the view sheet does): now the set takes it.
  await call(env, 'venture.queue.view', { id: row.viewRef!.id, kind: 'draft', opened: true });
  const shown = await preview(env, [row]);
  assert.deepEqual(shown.refusals, []);
  const result = await set(env, [row], shown.digest);
  assert.equal(result.decisions[0].outcome, 'done');
});

test('set approval refuses an empty pick and any "all"; there is no approve all', async () => {
  const { env, rows } = await threeDrafts();
  for (const rowIds of [[], 'all', ['all']]) {
    await assert.rejects(call(env, 'venture.queue.set', { rowIds, digest: 'a'.repeat(64) }), code('SET_NEEDS_PICK'));
    await assert.rejects(call(env, 'venture.queue.setPreview', { rowIds }), code('SET_NEEDS_PICK'));
  }
  await assert.rejects(preview(env, [rows[0], rows[0]]), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(set(env, rows, 'a'.repeat(64), {}, phone), code('APP_APPROVAL_REQUIRED'));
  assert.ok(SET_MAX >= 3);
  assert.equal(listRecords(env.store.read(), 'venture-queue-decision').length, 0);
});

test('a digest the server did not make, an item decided elsewhere, or a row changed on the server makes the set stale; nothing runs', async () => {
  const { env, runs, rows } = await threeDrafts();
  for (const row of rows) await viewRow(env, row);
  const shown = await preview(env, rows);
  await assert.rejects(set(env, rows, 'c'.repeat(64)), code('APPROVAL_STALE'));
  await assert.rejects(set(env, [rows[1], rows[0], rows[2]], shown.digest), code('APPROVAL_STALE'), 'the order is part of the set');
  // A row changed on the server after the preview: its new version is not the one picked.
  await ventureAction(env.deps, owner, 'prepare', 'seed.change', tx => { tx.replace({ ...tx.find('venture-delivery-run', runs[2].id)!, reopened: { count: 1, at: tx.now, files: [] } }); });
  await assert.rejects(set(env, rows, shown.digest), code('APPROVAL_STALE'));
  assert.equal(listRecords(env.store.read(), 'venture-queue-decision').length, 0);
  // An item decided elsewhere: the whole set is stale.
  const fresh = (await queue(env)).rows.filter(row => row.kind === 'draft');
  for (const row of fresh) await viewRow(env, row);
  const again = await preview(env, fresh);
  assert.equal((await call<QueueDecision>(env, 'venture.queue.decide', { id: fresh[1].id, digest: fresh[1].digest, action: 'later' })).outcome, 'done');
  await assert.rejects(set(env, fresh, again.digest), code('APPROVAL_STALE'));
  assert.deepEqual(listRecords(env.store.read(), 'venture-queue-decision').map(item => item.rowId), [fresh[1].id]);
  assert.deepEqual(runs.map(run => runStatus(env, run.id)), ['ready-for-review', 'ready-for-review', 'ready-for-review']);
});

test('a change on the way stops the set there: the items done stay done and the receipt covers only them', async () => {
  const { env, runs, rows } = await threeDrafts();
  for (const row of rows) await viewRow(env, row);
  const shown = await preview(env, rows);
  // Once the first item is decided, the third draft changes on the server before the next item runs.
  let fired = false;
  const published = env.deps.publish;
  env.deps.publish = events => {
    published?.(events);
    if (fired || !events.some(event => event.name === 'queue.changed' && (event.data as { rowId?: string }).rowId === rows[0].id)) return;
    fired = true;
    void ventureAction(env.deps, owner, 'prepare', 'seed.change', tx => { tx.replace({ ...tx.find('venture-delivery-run', runs[2].id)!, reopened: { count: 1, at: tx.now, files: [] } }); });
  };
  const result = await set(env, rows, shown.digest);
  assert.ok(fired);
  assert.deepEqual(result.decisions.map(item => [item.outcome, item.reason ?? null]), [['done', null], ['stale', 'APPROVAL_STALE']]);
  assert.match(result.line, /^Approved 1 of 3\. Stopped at the next one: One of these changed since you picked them\./);
  assert.deepEqual(runs.map(run => runStatus(env, run.id)), ['accepted', 'ready-for-review', 'ready-for-review']);
  const receipt = findRecord(env.store.read(), 'venture-sum-receipt', result.receiptId!) as SumReceiptRecord;
  assert.deepEqual((receipt.subject as { items: { rowId: string }[] }).items.map(item => item.rowId), [rows[0].id], 'only the item done');
});

test('posts in a set: it asks twice, and each post is decided on its own, with its own journal entry, gate and charge record', async () => {
  const env = await setup();
  const { made, rows } = await posts(env, ['Our cafe books service is open for October.', 'Ask us about the September close.']);
  for (const row of rows) await viewRow(env, row);
  const shown = await preview(env, rows);
  assert.equal(shown.secondAsk, true);
  await assert.rejects(set(env, rows, shown.digest), code('SET_NEEDS_SECOND_ASK'));
  assert.equal(listRecords(env.store.read(), 'venture-connector-post').filter(post => post.state === 'applied').length, 0, 'nothing posted');
  const result = await set(env, rows, shown.digest, { secondAsk: true });
  // The first post goes out under its own approval; the second meets its own posting gate (one post a day on a new
  // channel) and is refused there, so the set stops: a set never gets round a post's own rules.
  assert.deepEqual(result.decisions.map(item => item.outcome), ['done', 'refused']);
  assert.match(result.line, /^Approved 1 of 2. Stopped at the next one: X is new to Chausar/);
  const [first, second] = made.map(post => findRecord(env.store.read(), 'venture-connector-post', post.id)!);
  assert.notEqual(first.id, second.id, 'each post is its own journal record');
  assert.equal(first.state, 'applied');
  assert.ok(first.journal.some(step => step.state === 'approved' && step.by === 'owner'), 'its own approval step in its own journal');
  assert.notEqual(second.state, 'applied');
  // Posting costs nothing here: no charge record is made, and the receipt covers only the post that went out, at 0.
  assert.equal(listRecords(env.store.read(), 'venture-spend').length, 0);
  const receipt = findRecord(env.store.read(), 'venture-sum-receipt', result.receiptId!) as SumReceiptRecord;
  assert.deepEqual(receipt.addends.map(addend => [addend.recordId, addend.amount]), [[rows[0].id, '0']]);
});

test('a post that does not show all it sends is refused in a set', async () => {
  const env = await setup();
  const { rows } = await posts(env, ['A post with an image the row cannot show.'], false);
  assert.equal(rows[0].descriptionComplete, false);
  await viewRow(env, rows[0]);
  const shown = await preview(env, rows);
  assert.deepEqual(shown.refusals.map(item => [item.reason, item.line]), [['SET_KIND_REFUSED', 'Part of what this post sends is not shown, so approve it on its own.']]);
  await assert.rejects(set(env, rows, shown.digest, { secondAsk: true }), code('SET_KIND_REFUSED'));
});

test('a post and a spot check in one set', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env);
  const { order } = await seedOrder(env, plan);
  const run = await seedRun(env, order, { status: 'accepted' });
  await ventureAction(env.deps, owner, 'prepare', 'seed.spot', tx => tx.put<SpotCheckRecord>({
    ...tx.base('venture-spot-check'), runId: run.id, agentId: 'delivery', ordinal: 1, spendMicros: '0', rule: { everyNth: 1, overMicros: '0' },
    sampled: true, reason: 'every-nth', line: 'Picked: every run is checked at first.', review: null,
  }));
  const { made, rows: postRows } = await posts(env, ['Our cafe books service is open for October.']);
  const spot = (await queue(env)).rows.find(row => row.id.startsWith('spot:'))!;
  assert.ok(spot, 'the spot check row');
  const { result } = await approveSet(env, [spot, postRows[0]], { secondAsk: true });
  assert.deepEqual(result.decisions.map(item => item.outcome), ['done', 'done']);
  assert.equal(listRecords(env.store.read(), 'venture-spot-check')[0].review?.verdict, 'looks-right');
  assert.equal(findRecord(env.store.read(), 'venture-connector-post', made[0].id)!.state, 'applied');
});

test('money, prices, invoices, sign-offs, bank rows and paid work are refused: SET_KIND_REFUSED, and nothing runs', async () => {
  const { env, rows } = await threeDrafts();
  await seedBlueprint(env, { status: 'draft', version: 2, price1: '299900' });
  const price = (await queue(env)).rows.find(row => row.kind === 'price')!;
  await viewRow(env, rows[0]);
  const shown = await preview(env, [rows[0], price]);
  assert.deepEqual(shown.refusals.map(item => [item.rowId, item.reason]), [[price.id, 'SET_KIND_REFUSED']]);
  await assert.rejects(set(env, [rows[0], price], shown.digest), code('SET_KIND_REFUSED'));
  assert.equal(listRecords(env.store.read(), 'venture-queue-decision').length, 0);
  const row = (kind: QueueRow['kind'], id: string, extra: Partial<QueueRow> = {}): QueueRow => ({
    id, businessId: 'main', businessName: 'Ledgerline', kind, title: 't', digest: 'd', createdAt: '2026-10-15T10:00:00.000Z',
    actions: [{ id: 'approve', label: 'Approve', primary: true }], ...extra,
  });
  const refusedKinds: [QueueRow, string][] = [
    [row('invoice', 'invoice:inv_1:abc'), 'invoice:inv_1'], [row('invoice', 'credit:cn_1:abc'), 'credit:cn_1'],
    [row('signoff', 'signoff:req_1:v1'), 'signoff:req_1'], [row('bank', 'bank:line_1:v1'), 'bank:line_1'],
    [row('quote', 'spend-quote:q_1:open'), 'spend-quote:q_1'], [row('draft', 'run:delivery_1:brief-t1'), 'run:delivery_1'],
  ];
  for (const [item, subject] of refusedKinds) assert.equal(setRefusal({ row: item, subject })?.reason, 'SET_KIND_REFUSED', item.id);
  assert.match(setRefusal({ row: row('draft', 'run:delivery_1:brief-t1'), subject: 'run:delivery_1' })!.line, /starts paid work/);
  assert.equal(setRefusal({ row: row('connector', 'post:p_1:abc', { descriptionComplete: true }), subject: 'post:p_1' }), null);
});
