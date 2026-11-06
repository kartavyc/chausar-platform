// Ink v2 wave 4 (4J2, O6): edit and undo. Edit on Today is No and reopen: the owner's text is kept as their edit with
// the hash of the draft it replaced, and the draft waits for their approval again. A later agent revision never
// overwrites it: the three snapshots merge by paragraph (only the owner changed it: the owner's; only the agent: the
// agent's; both: the owner's, with the agent's as a suggestion), the run says "You edited this. The agent's new version
// is beside yours.", and a stale replacement offers Review replacement, Confirm replacement ("This does not merge the
// entries") or Keep current, reject change. Undo puts an edit or a send-back back until its revision starts, never for
// something that went out, and promises only "Restored until you edit this again."
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeliveryRunView, DraftChangesView, QueueDecision, QueueList, QueueRow, QueueUndoResult } from '../runtime/venture/contracts.ts';
import { digest, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as views } from '../runtime/venture/views/index.ts';
import { changeViews, joinParagraphs, mergeParagraphs, mergedText, paragraphs } from '../runtime/venture/delivery/merge.ts';
import { clientDraft } from '../runtime/venture/build/draft-text.ts';
import { approve, call, code, owner, phone, record, seedOrder, setup, type Env } from './venture-run-controls-env.ts';

const part = (text: string) => ({ kind: 'text', text, ref: '' });
const SUMMARY = 'Here is the plan for your September books.';
const DO = 'We will match each payment to a bill.';
const NEED = 'Please send the bank statement.';
const report = (summary = SUMMARY, todo = DO, need = NEED, first = 'Summary') => ({
  title: 'Your September books', questionsForClient: [], sections: [
    { heading: first === 'Summary' ? 'Summary' : first, parts: [part(summary)] },
    { heading: 'What we will do', parts: [part(todo)] },
    { heading: 'What we need from you', parts: [part(need)] },
    { heading: 'Next steps', parts: [part('The fee for the month is below.'), { kind: 'figure', text: '', ref: 'order.total' }] },
  ],
});

const view = <T>(env: Env, method: string, payload: unknown, ctx = owner) =>
  (views as Record<string, (deps: Env['deps'], ctx: typeof owner, payload: unknown) => Promise<T>>)[method](env.deps, ctx, payload);
const queue = (env: Env) => call<QueueList>(env, 'venture.queue.list', {});
const draftRow = async (env: Env) => (await queue(env)).rows.find(item => item.kind === 'draft')!;
const edit = (env: Env, row: QueueRow, text: string, ctx = owner) => view<QueueDecision>(env, 'venture.queue.edit', { rowId: row.id, digest: row.digest, text }, ctx);
const sendBack = (env: Env, row: QueueRow, text: string) => view<QueueDecision>(env, 'venture.queue.sendBack', { rowId: row.id, digest: row.digest, text });
const undo = (env: Env, rowId: string, ctx = owner) => view<QueueUndoResult>(env, 'venture.queue.undo', { rowId }, ctx);
const changes = (env: Env, runId: string) => call<DraftChangesView>(env, 'venture.delivery.changes', { runId });
const decideChange = (env: Env, runId: string, changeId: string, accept: boolean, ctx = owner) => call<DraftChangesView>(env, 'venture.delivery.decideChange', { runId, changeId, accept }, ctx);
const runOf = async (env: Env, runId: string) => (await call<DeliveryRunView[]>(env, 'venture.delivery.list', {})).find(item => item.id === runId)!;

/** The owner's own version: the draft with "What we will do" in their words. */
const ownerVersion = (text: string) => text.replace(DO, 'We will match every payment to its bill and list anything left over.');

async function readyDraft(drafts: unknown[] = [report()]) {
  const env = await setup();
  let next = 0;
  env.models.respond.delivery = () => drafts[Math.min(next++, drafts.length - 1)];
  const order = await seedOrder(env);
  const run = await approve(env, await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id }));
  assert.equal(run.status, 'ready-for-review');
  return { env, run, row: await draftRow(env) };
}

// ---------------------------------------------------------------------------
// The merge, by paragraph
// ---------------------------------------------------------------------------

test('mergeParagraphs: only the owner changed it, the owner\'s; only the agent, the agent\'s; both, the owner\'s with the agent\'s as a suggestion', () => {
  const base = joinParagraphs(['A', 'B', 'C', 'D']);
  const owner = joinParagraphs(['A', 'B by owner', 'C', 'D']);
  const agent = joinParagraphs(['A by agent', 'B by agent', 'C', 'D', 'E added by agent']);
  const parts = mergeParagraphs(base, owner, agent);
  assert.equal(mergedText(parts), joinParagraphs(['A by agent', 'B by owner', 'C', 'D', 'E added by agent']));
  // Paragraphs edited in place are decided one by one: A the agent's (taken), B the owner's (the agent's open), E added.
  assert.deepEqual(changeViews(parts).map(change => [change.before, change.after, change.status]), [['A', 'A by agent', 'taken'], ['B by owner', 'B by agent', 'open'], ['', 'E added by agent', 'taken']]);
  // A stretch whose paragraphs do not line up (the agent split one in two) is decided as a whole: the owner's stays.
  const split = mergeParagraphs(joinParagraphs(['A', 'B', 'C']), joinParagraphs(['A', 'B by owner', 'C']), joinParagraphs(['A', 'B1', 'B2', 'C']));
  assert.equal(mergedText(split), joinParagraphs(['A', 'B by owner', 'C']));
  assert.deepEqual(changeViews(split).map(change => change.status), ['open']);
  // A and B changed side by side: one stretch that both changed, so the owner's stays and the agent's is open.
  const merged = mergeParagraphs(joinParagraphs(['A', 'X', 'B']), joinParagraphs(['A', 'X', 'B by owner']), joinParagraphs(['A by agent', 'X', 'B']));
  assert.equal(mergedText(merged), joinParagraphs(['A by agent', 'X', 'B by owner']), 'stretches apart are decided apart');
  assert.deepEqual(changeViews(merged).map(change => [change.before, change.after, change.status]), [['A', 'A by agent', 'taken']]);
  // Both changed the same way: no change listed. Neither changed: the same text.
  assert.deepEqual(changeViews(mergeParagraphs(base, agent, agent)), []);
  assert.equal(mergedText(mergeParagraphs(base, base, base)), base);
  const conflict = mergeParagraphs(joinParagraphs(['A', 'B']), joinParagraphs(['A', 'B by owner']), joinParagraphs(['A', 'B by agent']));
  assert.equal(mergedText(conflict), joinParagraphs(['A', 'B by owner']));
  const [open] = changeViews(conflict);
  assert.deepEqual([open.before, open.after, open.status, open.by, open.paragraph], ['B by owner', 'B by agent', 'open', 'agent', 1]);
  // The owner deleted a paragraph the agent left alone: it stays deleted.
  assert.equal(mergedText(mergeParagraphs(joinParagraphs(['A', 'B', 'C']), joinParagraphs(['A', 'C']), joinParagraphs(['A', 'B', 'C', 'D']))), joinParagraphs(['A', 'C', 'D']));
  assert.deepEqual(paragraphs('one\r\n\r\n\r\ntwo\n  \nthree\n'), ['one', 'two', 'three']);
});

// ---------------------------------------------------------------------------
// Edit: No and reopen
// ---------------------------------------------------------------------------

test('edit is No and reopen: the owner\'s text is kept with the hash of the draft it replaced, and waits for their approval again', async () => {
  const { env, run, row } = await readyDraft();
  const mine = ownerVersion(run.renderedText!);
  const decision = await edit(env, row, mine);
  assert.equal(decision.outcome, 'done');
  assert.equal(decision.line, 'Your version is kept. Approve it when it is ready.');
  const [kept] = listRecords(env.store.read(), 'venture-draft-edit');
  assert.deepEqual([kept.runId, kept.rowId, kept.text, kept.undoneAt, kept.by], [run.id, row.id, mine, null, 'owner']);
  assert.equal(kept.replacedHash, digest(run.renderedText));
  const stored = record(env, run.id);
  assert.equal(stored.status, 'ready-for-review');
  assert.equal(stored.editedText, mine);
  assert.equal(stored.renderedText, run.renderedText, 'the agent\'s draft is kept beside it');
  const click = listRecords(env.store.read(), 'venture-queue-decision').find(item => item.rowId === row.id)!;
  assert.deepEqual([click.action, click.line], ['deny', 'You edited the draft. Your version waits for your approval.']);
  const reopened = await draftRow(env);
  assert.ok(reopened && reopened.id !== row.id, 'a new review row for the owner\'s version');
  // Approving it accepts the owner's words (4J1): the client sees the owner's version.
  assert.equal((await call<QueueDecision>(env, 'venture.queue.decide', { id: reopened.id, digest: reopened.digest, action: 'approve', viewed: true })).outcome, 'done');
  const accepted = record(env, run.id);
  assert.equal(accepted.status, 'accepted');
  assert.equal(clientDraft(accepted).text, mine);
});

test('edit refuses an old digest, empty text, the phone, a practice draft, and a draft that failed a check', async () => {
  const { env, row } = await readyDraft();
  assert.equal((await edit(env, { ...row, digest: 'b'.repeat(64) }, 'Mine')).outcome, 'stale');
  await assert.rejects(edit(env, row, '  '), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(edit(env, row, 'Mine', phone), code('APP_APPROVAL_REQUIRED'));
  const blocked = await readyDraft([report('We reconciled your bank statement and filed your GST return.')]);
  const refusal = await edit(blocked.env, blocked.row, 'My own words.');
  assert.deepEqual([refusal.outcome, refusal.reason], ['refused', 'NOT_OFFERED']);
  assert.equal(listRecords(blocked.env.store.read(), 'venture-draft-edit').length, 0);
});

// ---------------------------------------------------------------------------
// A later revision never overwrites the owner's edit
// ---------------------------------------------------------------------------

/** Edit, then send back: the agent's revision changes the summary (agent only), "What we will do" (both) and the ask (agent only). */
async function editedThenRevised() {
  const { env, run, row } = await readyDraft();
  const mine = ownerVersion(run.renderedText!);
  await edit(env, row, mine);
  env.models.respond.delivery = () => report('A short plan for your September books.', 'We will match payments to bills each week.', 'Please send the bank statement and the bills.');
  assert.equal((await sendBack(env, await draftRow(env), 'Make it shorter.')).outcome, 'done');
  const landed = await approve(env, await runOf(env, run.id));
  assert.equal(landed.status, 'ready-for-review');
  return { env, run: landed, mine };
}

test('a revision after an edit merges by paragraph: the owner\'s words stay, the agent\'s new version is beside them', async () => {
  const { env, run, mine } = await editedThenRevised();
  const stored = record(env, run.id);
  assert.match(stored.renderedText!, /A short plan/, 'the agent\'s new version');
  const merged = stored.editedText!;
  assert.match(merged, /A short plan for your September books\./, 'only the agent changed the summary: the agent\'s');
  assert.match(merged, /We will match every payment to its bill and list anything left over\./, 'both changed it: the owner\'s stays');
  assert.doesNotMatch(merged, /each week/);
  assert.match(merged, /the bank statement and the bills/, 'only the agent changed the ask: the agent\'s');
  assert.equal(stored.merge?.owner, mine);
  const shown = await changes(env, run.id);
  assert.equal(shown.line, "You edited this. The agent's new version is beside yours.");
  assert.deepEqual(shown.changes.map(change => change.status), ['taken', 'open', 'taken']);
  const open = shown.changes.find(change => change.status === 'open')!;
  assert.match(open.before, /list anything left over/);
  assert.match(open.after, /each week/);
  assert.deepEqual(shown.replacement, {
    id: 'replacement', status: 'open', review: 'Review replacement', confirm: 'Confirm replacement', confirmLine: 'This does not merge the entries.', keep: 'Keep current, reject change',
  });
  // Take the agent's suggestion: every change is the agent's now, so the draft is the agent's own version.
  const taken = await decideChange(env, run.id, open.id, true);
  assert.deepEqual(taken.changes.map(change => change.status), ['taken', 'taken', 'taken']);
  assert.equal(record(env, run.id).editedText, null);
  // Drop the summary change: the owner's summary is back.
  const dropped = await decideChange(env, run.id, taken.changes[0].id, false);
  assert.equal(dropped.changes[0].status, 'dropped');
  assert.match(record(env, run.id).editedText!, new RegExp(SUMMARY.replace('.', '\\.')));
  const decisions = listRecords(env.store.read(), 'venture-decision').filter(item => item.subject === `run:${run.id}`).map(item => item.action);
  assert.ok(decisions.includes('change-taken') && decisions.includes('change-dropped'));
});

test('a stale replacement: Confirm replacement takes the agent\'s version whole; Keep current, reject change keeps the owner\'s', async () => {
  const { env, run, mine } = await editedThenRevised();
  const confirmed = await decideChange(env, run.id, 'replacement', true);
  assert.equal(confirmed.replacement?.status, 'confirmed');
  assert.equal(record(env, run.id).editedText, null, 'the agent\'s version, not merged');
  const kept = await decideChange(env, run.id, 'replacement', false);
  assert.equal(kept.replacement?.status, 'kept');
  assert.ok(kept.changes.every(change => change.status === 'dropped'));
  assert.equal(record(env, run.id).editedText, mine, 'the owner\'s version as it was');
  await assert.rejects(decideChange(env, run.id, 'chg_nothere', true), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(decideChange(env, run.id, 'replacement', true, phone), code('APP_APPROVAL_REQUIRED'));
});

test('a revision with no edit of the owner\'s: the agent\'s changes are tracked, each one the owner can drop', async () => {
  const { env, run, row } = await readyDraft();
  assert.deepEqual(await changes(env, run.id), { changes: [] });
  env.models.respond.delivery = () => report('A short plan for your September books.');
  await sendBack(env, row, 'Shorter.');
  const landed = await approve(env, await runOf(env, run.id));
  const shown = await changes(env, landed.id);
  assert.equal(shown.line, 'The agent revised this. Each change it made is marked; drop any you do not want.');
  assert.equal(shown.replacement, undefined);
  assert.deepEqual(shown.changes.map(change => [change.status, change.by]), [['taken', 'agent']]);
  assert.equal(record(env, run.id).editedText, null);
  await decideChange(env, run.id, shown.changes[0].id, false);
  assert.match(record(env, run.id).editedText!, new RegExp(SUMMARY.replace('.', '\\.')));
  await assert.rejects(decideChange(env, run.id, 'replacement', true), code('INVALID_VENTURE_REQUEST'));
});

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

test('undo an edit: restored until you edit this again, on a new review row; a second undo has nothing to undo', async () => {
  const { env, run, row } = await readyDraft();
  await edit(env, row, ownerVersion(run.renderedText!));
  const reopened = await draftRow(env);
  const restored = await undo(env, row.id);
  assert.deepEqual(restored, { restored: true, line: 'Restored until you edit this again.' });
  const stored = record(env, run.id);
  assert.equal(stored.editedText, null);
  assert.ok(listRecords(env.store.read(), 'venture-draft-edit')[0].undoneAt);
  const back = await draftRow(env);
  assert.ok(back && back.id !== reopened.id && back.id !== row.id, 'the draft is back for review');
  await assert.rejects(undo(env, row.id), code('UNDO_NOTHING'));
  await assert.rejects(undo(env, row.id, phone), code('APP_APPROVAL_REQUIRED'));
});

test('undo an edit after the draft moved on is too late', async () => {
  const { env, run, row } = await readyDraft();
  await edit(env, row, ownerVersion(run.renderedText!));
  const reopened = await draftRow(env);
  await call<QueueDecision>(env, 'venture.queue.decide', { id: reopened.id, digest: reopened.digest, action: 'approve', viewed: true });
  await assert.rejects(undo(env, row.id), code('UNDO_TOO_LATE'));
});

test('undo a send-back before its revision starts: the draft is back as it was; after the revision started it is too late', async () => {
  const { env, run, row } = await readyDraft();
  await sendBack(env, row, 'Shorter.');
  const waiting = await runOf(env, run.id);
  const restored = await undo(env, row.id);
  assert.equal(restored.line, 'Restored until you edit this again.');
  const stored = record(env, run.id);
  assert.deepEqual([stored.status, stored.revision ?? null, stored.preview], ['ready-for-review', null, null]);
  assert.equal(stored.renderedText, run.renderedText);
  assert.ok(await draftRow(env), 'the review row is back');
  assert.ok(listRecords(env.store.read(), 'venture-decision').some(item => item.action === 'undo' && item.subject === `run:${run.id}`));
  // The revision's text can no longer be sent.
  await assert.rejects(approve(env, waiting), code('DELIVERY_NOT_WAITING'));
  // Send it back again and approve the revision: then Undo is too late.
  const again = await draftRow(env);
  await sendBack(env, again, 'Shorter.');
  await approve(env, await runOf(env, run.id));
  await assert.rejects(undo(env, again.id), code('UNDO_TOO_LATE'));
});

test('undo never undoes something that went out, and a row never decided has nothing to undo', async () => {
  const env = await setup();
  env.models.respond.delivery = () => report();
  const order = await seedOrder(env);
  await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id });
  const send = (await queue(env)).rows.find(item => item.kind === 'quote')!;
  await assert.rejects(undo(env, send.id), code('UNDO_NOTHING'));
  assert.equal((await call<QueueDecision>(env, 'venture.queue.decide', { id: send.id, digest: send.digest, action: 'approve', viewed: true })).outcome, 'done');
  await assert.rejects(undo(env, send.id), code('UNDO_OUTSIDE_EFFECT'));
});

// ---------------------------------------------------------------------------
// 4J2 review fixes
// ---------------------------------------------------------------------------

test('a revision after an edit revises the owner\'s version; the agent\'s own draft stays the merge base', async () => {
  const { env, run, row } = await readyDraft();
  const mine = ownerVersion(run.renderedText!);
  await edit(env, row, mine);
  await sendBack(env, await draftRow(env), 'Make it shorter.');
  const input = env.models.previewed.at(-1)!.input as Record<string, unknown>;
  assert.equal(input.previousDraft, mine, 'the agent revises what the owner sees');
  assert.equal(record(env, run.id).revision?.base, run.renderedText, 'the merge base is the agent\'s own draft');
});

test('taking or dropping a change gives Today\'s review row a new version', async () => {
  const { env, run } = await editedThenRevised();
  const before = await draftRow(env);
  const count = record(env, run.id).reopened?.count ?? 0;
  const { changes: list } = await changes(env, run.id);
  await decideChange(env, run.id, list[1].id, true);
  const after = await draftRow(env);
  assert.ok(after && after.id !== before.id, 'the owner approves the text as it is now');
  assert.equal(record(env, run.id).reopened?.count, count + 1);
});

test('an owner edit that only moves blank lines or spaces is not an edit of theirs when the revision lands', async () => {
  const { env, run, row } = await readyDraft();
  const spaced = run.renderedText!.split('\n\n').join('\n\n\n');
  await edit(env, row, spaced);
  env.models.respond.delivery = () => report('A short plan for your September books.');
  await sendBack(env, await draftRow(env), 'Shorter.');
  await approve(env, await runOf(env, run.id));
  const shown = await changes(env, run.id);
  assert.equal(shown.line, 'The agent revised this. Each change it made is marked; drop any you do not want.');
  assert.equal(shown.replacement, undefined);
  assert.equal(record(env, run.id).merge?.edited, false);
  assert.equal(record(env, run.id).editedText, null);
});

test('an edit keeps the files a reopen named; a draft the judge is reading says so in the judge\'s words', async () => {
  const { env, run } = await readyDraft();
  await ventureAction(env.deps, owner, 'prepare', 'seed.reopen', tx => {
    tx.replace({ ...tx.find('venture-delivery-run', run.id)!, reopened: { count: 1, at: tx.now, files: ['upload_f1'] } });
  });
  await edit(env, await draftRow(env), ownerVersion(run.renderedText!));
  assert.deepEqual(record(env, run.id).reopened?.files, ['upload_f1']);
  assert.equal(record(env, run.id).reopened?.count, 2);
  const judged = await readyDraft();
  await ventureAction(judged.env.deps, owner, 'prepare', 'seed.judge', tx => {
    tx.replace({ ...tx.find('venture-delivery-run', judged.run.id)!, judge: undefined, judgePending: { boundMicros: null, bound: 'USD 0.0010', until: '2026-10-16T11:00:00.000Z' } });
  });
  const refusal = await edit(judged.env, await draftRow(judged.env), 'My own words.');
  assert.equal(refusal.reason, 'NOT_OFFERED');
  assert.equal(refusal.line, 'The judge is reading this draft. Accept it once its answer is in.');
});

// ---------------------------------------------------------------------------
// Make a copy (venture.delivery.copy)
// ---------------------------------------------------------------------------

const copy = (env: Env, runId: string, ctx = owner) => call<DeliveryRunView>(env, 'venture.delivery.copy', { runId }, ctx);

test('copy of a draft that went out: a new owner draft on the same order, waiting for review with its text', async () => {
  const { env, run, row } = await readyDraft();
  assert.equal((await call<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve', viewed: true })).outcome, 'done');
  const made = await copy(env, run.id);
  assert.notEqual(made.id, run.id);
  assert.deepEqual([made.orderId, made.servedBy, made.status, made.editedText, made.copiedFrom, made.practice], [run.orderId, 'owner', 'ready-for-review', run.renderedText, run.id, false]);
  assert.deepEqual([made.callId, made.verdict], [null, null]);
  assert.ok((await queue(env)).rows.find(item => item.kind === 'draft' && item.viewRef?.id === made.id), 'the copy waits for the owner on Today');
  assert.equal(record(env, run.id).status, 'accepted', 'the draft that went out is unchanged');
  // A copy of an edited draft carries the owner's edit.
  const edited = await readyDraft();
  await call(edited.env, 'venture.delivery.review', { runId: edited.run.id, verdict: 'edited', editedText: 'My words for the client.' });
  assert.equal((await copy(edited.env, edited.run.id)).editedText, 'My words for the client.');
});

test('copy refuses a draft that has not gone out, a practice draft and an unknown one', async () => {
  const { env, run } = await readyDraft();
  await assert.rejects(copy(env, run.id), code('COPY_NOT_SENT'));
  await ventureAction(env.deps, owner, 'prepare', 'seed.practice', tx => {
    tx.replace({ ...tx.find('venture-delivery-run', run.id)!, status: 'edited', editedText: 'Practice words.', practice: true });
  });
  await assert.rejects(copy(env, run.id), code('PRACTICE_DRAFT'));
  await assert.rejects(copy(env, 'delivery_missing'), code('DELIVERY_NOT_FOUND'));
  assert.equal(listRecords(env.store.read(), 'venture-delivery-run').length, 1, 'nothing was made');
});
