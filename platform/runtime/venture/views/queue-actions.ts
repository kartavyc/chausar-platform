// Chausar venture launcher, views (Ink v2 wave 4, package 4J2; catalogue O5, O6, O9): what the owner does on Today
// beyond one button. Send back with words: a draft gets a revision turn that begins "Revise this to: ..." and waits for
// the owner's approval (delivery/revise.ts); on a plan or price row it is a No that keeps the words on its decision.
// Edit: No and reopen, with the owner's own text kept as their edit and the hash of the draft it replaced, so a later
// revision is merged by paragraph and never overwrites it. Undo: puts a send-back or an edit back until its revision
// starts, and never undoes something that went out. Set approval: the owner picks posts and drafts and approves them in
// one go, bound by one digest over the picked rows in order and their total quote (a sum receipt), each item still
// decided on its own (its own decision, journal entry and charge record); a changed item makes the whole set stale,
// and there is no "approve all". Every click is recorded once per row id, so it reaches venture.decisions.list.
import { authorize, ChausarError, check, type Context, type State } from '../../contracts.ts';
import { currentVenture, digest, exactPayload, findRecord, formatMicros, listRecords, plainText, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import { viewedExactly } from './view-marks.ts';
import type {
  DraftEditRecord, QueueDecision, QueueDecisionRecord, QueueRow, QueueSetPreview, QueueSetResult, QueueUndoResult, SumReceiptSubject, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { GONE_LINE, queueDecideHandler, queueRowsWithSubjects, STALE_LINE } from './queue.ts';
import { recordDecision } from '../journal/decisions.ts';
import { JUDGE_READING, PRACTICE_REASON, runView } from '../delivery/runs.ts';
import { screenReadback } from '../core/secrets.ts';
import { reopenMark, RESTORED_LINE, revisionWords, SEND_BACK_MAX, startRevision, TOO_LATE_LINE, undoRevision } from '../delivery/revise.ts';
import { caSignoffBlock } from '../playbooks/ca-firm/signoff-gate.ts';
import { sumReceipt } from '../money/sums.ts';
import { setPlan } from '../money/set-plan.ts';

/** The words each action leaves on its decision and says back. */
export const ACTION_WORDS = Object.freeze({
  sentBack: (text: string) => `Sent back with your words: ${text}`,
  sentBackLine: 'Sent back. The revision waits for your approval before anything goes to your AI.',
  planKept: (text: string) => `Not accepted. Your words: ${text}`,
  planLine: 'Kept as a draft. Your words are on the decision.',
  edited: 'You edited the draft. Your version waits for your approval.',
  editLine: 'Your version is kept. Approve it when it is ready.',
  empty: 'Say what to change first.',
  tooLong: `Keep it to ${SEND_BACK_MAX} characters.`,
  notOffered: 'Send back works on drafts and on plan changes. Use the row\'s own buttons here.',
  editNotOffered: 'Only a draft waiting for your review can be edited here.',
  caEdit: "Your version of these papers needs the CA's sign-off. Edit it in Work, where it goes to the CA.",
  blockedEdit: 'This draft failed a check. Send it back with your words, or edit it in Work, where your version is final.',
  nothing: 'Nothing to undo here.',
  outside: "This went out, so it can't be undone.",
  planUndo: 'Your plan change is still a draft in the business menu. Accept it there.',
  pick: 'Pick each item you approve. There is no approve all.',
  setKind: 'Only posts and drafts can be approved together. Money, prices, invoices and sign-offs need their own approval.',
  setPaid: 'This one starts paid work, so it needs its own approval.',
  setStale: 'One of these changed since you picked them. Nothing ran. Look at the set again.',
  setPartPost: 'Part of what this post sends is not shown, so approve it on its own.',
  viewFirst: 'Open it and read it first.',
  secondAsk: 'One of these asks twice. Confirm the set again to approve it.',
});

/** The most rows one set approval takes. */
export const SET_MAX = 25;
const MAX_EDITED_CHARS = 20000;

/** A Today row with the subject it stands for. */
export type Found = { row: QueueRow; subject: string };
const idOk = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{3,400}$/.test(value) && value.includes(':');
const subjectOf = (id: string) => id.slice(0, Math.max(0, id.lastIndexOf(':')));
const versionOf = (id: string) => id.slice(id.lastIndexOf(':') + 1);
const refused = (reason: string, line: string): QueueDecision => ({ outcome: 'refused', reason, line });

/** The row's decision in force: one the owner undid no longer counts (Today shows the row again). */
function decided(state: State, venture: VentureRecord | null, rowId: string): QueueDecisionRecord | undefined {
  return venture ? listRecords(state, 'venture-queue-decision', venture.id).find(record => record.rowId === rowId && !record.undoneAt) : undefined;
}

/** Marks a row's decision undone, in the caller's commit. */
export function undoDecision(tx: VentureTx, rowId: string): void {
  const live = tx.list('venture-queue-decision').find(record => record.rowId === rowId && !record.undoneAt);
  if (live) tx.replace<QueueDecisionRecord>({ ...live, undoneAt: tx.now });
}

/** The row the owner saw, or what Today says instead: stale with the latest version, or resolved elsewhere. */
async function rowSeen(deps: VentureDeps, ctx: Context, rowId: string, seen: string): Promise<Found | QueueDecision> {
  const state = deps.store.read();
  if (decided(state, currentVenture(state), rowId)) return refused('ALREADY_DECIDED', 'You decided this already.');
  const rows = await queueRowsWithSubjects(deps, ctx);
  const found = rows.find(item => item.row.id === rowId);
  if (found && found.row.digest === seen) return found;
  return staleOrGone(rows, subjectOf(rowId));
}

function staleOrGone(rows: readonly Found[], subject: string): QueueDecision {
  const latest = rows.find(item => item.subject === subject)?.row;
  return latest ? { outcome: 'stale', reason: 'APPROVAL_STALE', line: STALE_LINE, latest } : refused('RESOLVED_ELSEWHERE', GONE_LINE);
}

/** A review row of a draft waiting for the owner: its run id, or null for any other row. */
function reviewRun(found: Found): string | null {
  return found.row.kind === 'draft' && found.subject.startsWith('run:') && versionOf(found.row.id).startsWith('review') && found.row.viewRef?.kind === 'draft'
    ? found.row.viewRef.id : null;
}

/** Writes Today's decision on a row once, in the caller's commit, as a No with the words it keeps. */
function putDecision(tx: VentureTx, ctx: Context, found: Found, line: string): void {
  check(!tx.list('venture-queue-decision').some(item => item.rowId === found.row.id && !item.undoneAt), 'ALREADY_DECIDED', 'You decided this already.');
  tx.put<QueueDecisionRecord>({
    ...tx.base('venture-queue-decision'), rowId: found.row.id, subject: found.subject, digest: found.row.digest, action: 'deny', line, receiptId: null, decidedBy: ctx.memberId,
  });
  tx.emit('queue.changed', { rowId: found.row.id });
}

/** A refusal Today answers in words, a stale draft as the latest row; any other error is thrown. */
async function answered(deps: VentureDeps, ctx: Context, subject: string, work: () => Promise<QueueDecision>): Promise<QueueDecision> {
  try { return await work(); } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code === 'APPROVAL_STALE') return staleOrGone(await queueRowsWithSubjects(deps, ctx), subject);
    if (code === 'ALREADY_DECIDED') return refused('ALREADY_DECIDED', 'You decided this already.');
    throw error;
  }
}

function rowPayload(payload: unknown): { rowId: string; digest: string; text: unknown } {
  const body = exactPayload(payload, ['rowId', 'digest', 'text'], ['rowId', 'digest', 'text']);
  check(idOk(body.rowId), 'INVALID_VENTURE_REQUEST', 'Send the id of the row you decided on.');
  check(typeof body.digest === 'string' && /^[a-f0-9]{64}$/.test(body.digest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the row you saw.');
  return { rowId: body.rowId, digest: body.digest, text: body.text };
}

// ---------------------------------------------------------------------------
// Send back with words (O5)
// ---------------------------------------------------------------------------

/**
 * venture.queue.sendBack { rowId, digest, text } (approve, app only). On a draft waiting for review: a revision turn
 * whose input begins "Revise this to: {text}", waiting for the owner's approval, and the row leaves Today. On a plan or
 * price row: a No that keeps the words on its decision. Empty words are SEND_BACK_EMPTY; an old digest is stale.
 */
export async function queueSendBackHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<QueueDecision> {
  requireAppChannel(ctx, 'venture.queue.sendBack');
  const body = rowPayload(payload);
  check(typeof body.text === 'string', 'INVALID_VENTURE_REQUEST', 'Your words must be text.');
  check(body.text.trim().length > 0, 'SEND_BACK_EMPTY', ACTION_WORDS.empty);
  check(body.text.trim().length <= SEND_BACK_MAX, 'INVALID_VENTURE_REQUEST', ACTION_WORDS.tooLong);
  const text = plainText(body.text, 'Your words', { min: 1, max: SEND_BACK_MAX });
  // What is kept on the decision is what the AI is told: the words after the shared screen.
  const said = screenReadback(text).text;
  authorize(deps.store, ctx, 'approve');
  const seen = await rowSeen(deps, ctx, body.rowId, body.digest);
  if (!('row' in seen)) return seen;
  const found = seen;
  const runId = reviewRun(found);
  if (runId) {
    return answered(deps, ctx, found.subject, async () => {
      await startRevision(deps, ctx, { runId, words: revisionWords(text), by: 'send-back', rowId: found.row.id }, tx => putDecision(tx, ctx, found, ACTION_WORDS.sentBack(said)));
      return { outcome: 'done', line: ACTION_WORDS.sentBackLine };
    });
  }
  if (found.row.kind === 'plan' || found.row.kind === 'price') {
    return answered(deps, ctx, found.subject, async () => {
      await ventureAction(deps, ctx, 'approve', 'queue.sendBack', tx => putDecision(tx, ctx, found, ACTION_WORDS.planKept(said)));
      return { outcome: 'done', line: ACTION_WORDS.planLine };
    });
  }
  return refused('NOT_OFFERED', ACTION_WORDS.notOffered);
}

// ---------------------------------------------------------------------------
// Edit and undo (O6)
// ---------------------------------------------------------------------------

/**
 * venture.queue.edit { rowId, digest, text } (approve, app only): No and reopen. The owner's text is kept as their edit,
 * with the hash of the draft it replaced; the draft waits for their review again with their words (a new review row),
 * and a later revision of the run is merged by paragraph, never over the owner's words.
 */
export async function queueEditHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<QueueDecision> {
  requireAppChannel(ctx, 'venture.queue.edit');
  const body = rowPayload(payload);
  const text = plainText(body.text, 'Your version', { min: 1, max: MAX_EDITED_CHARS });
  authorize(deps.store, ctx, 'approve');
  const seen = await rowSeen(deps, ctx, body.rowId, body.digest);
  if (!('row' in seen)) return seen;
  const found = seen;
  const runId = reviewRun(found);
  if (!runId) return refused('NOT_OFFERED', ACTION_WORDS.editNotOffered);
  const state = deps.store.read();
  const venture = currentVenture(state)!;
  const run = findRecord(state, 'venture-delivery-run', runId);
  if (!run || run.status !== 'ready-for-review') return staleOrGone(await queueRowsWithSubjects(deps, ctx), found.subject);
  // A practice draft is never used, so an edit of it can't be either (delivery/runs.ts PRACTICE_REASON).
  const shown = runView(run, venture, deps.clock().getTime(), state);
  if (shown.practiceNow) return refused('PRACTICE_DRAFT', PRACTICE_REASON);
  // A draft that can't be accepted as it stands would come back just as stuck: it goes back with words, or is edited in
  // Work, where the owner's version is final.
  // Held while the judge reads it, it says so in the judge's words.
  if (!shown.canAccept && !caSignoffBlock(state, venture, run)) return refused('NOT_OFFERED', shown.acceptBlocked === JUDGE_READING ? JUDGE_READING : ACTION_WORDS.blockedEdit);
  // Regulated papers in the owner's words go to the CA of record first: that edit is made in Work.
  if (caSignoffBlock(state, venture, { ...run, status: 'edited', editedText: text })) return refused('CA_SIGNOFF_REQUIRED', ACTION_WORDS.caEdit);
  return answered(deps, ctx, found.subject, async () => {
    await ventureAction(deps, ctx, 'approve', 'queue.edit', tx => {
      const current = tx.find('venture-delivery-run', runId);
      check(current && current.status === 'ready-for-review' && current.renderedText === run.renderedText && current.editedText === run.editedText, 'APPROVAL_STALE', STALE_LINE);
      const shown = current.editedText ?? current.renderedText ?? '';
      tx.put<DraftEditRecord>({
        ...tx.base('venture-draft-edit'), runId, rowId: found.row.id, text, replacedHash: digest(shown), by: ctx.memberId, undoneAt: null,
        replaced: shown, prior: current.editedText ?? null,
      });
      tx.replace({ ...current, editedText: text, merge: null, reopened: reopenMark(current, tx.now) });
      putDecision(tx, ctx, found, ACTION_WORDS.edited);
      tx.emit('run.step', { runId });
    });
    return { outcome: 'done', line: ACTION_WORDS.editLine };
  });
}

/** Decisions on a row whose approval did something outside: a send to the AI, a post, an invoice, a payment, the CA. */
function wentOut(decision: QueueDecisionRecord): boolean {
  if (decision.action === 'issue' || decision.action === 'send-to-ca' || decision.action === 'sent') return true;
  if (decision.action !== 'approve') return false;
  const version = versionOf(decision.rowId);
  return /^(post|spend-quote|bank|bank-alert|signoff|ca|proposal):/.test(decision.subject)
    || (decision.subject.startsWith('run:') && /^(send|cap|brief)/.test(version));
}

/**
 * venture.queue.undo { rowId } (approve, app only): puts back a send-back or an edit made on that row, until its revision
 * starts (UNDO_TOO_LATE after). Something that went out is never undone (UNDO_OUTSIDE_EFFECT). The line promises only
 * "Restored until you edit this again."
 */
export async function queueUndoHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<QueueUndoResult> {
  requireAppChannel(ctx, 'venture.queue.undo');
  const body = exactPayload(payload, ['rowId'], ['rowId']);
  check(idOk(body.rowId), 'INVALID_VENTURE_REQUEST', 'Send the id of the row to undo.');
  const rowId = body.rowId;
  authorize(deps.store, ctx, 'approve');
  const state = deps.store.read();
  const venture = currentVenture(state);
  const decision = decided(state, venture, rowId);
  check(venture && decision, 'UNDO_NOTHING', ACTION_WORDS.nothing);
  const edit = listRecords(state, 'venture-draft-edit', venture.id).filter(item => item.rowId === rowId).at(-1);
  if (edit) {
    check(!edit.undoneAt, 'UNDO_NOTHING', ACTION_WORDS.nothing);
    await ventureAction(deps, ctx, 'approve', 'queue.undo', tx => {
      const run = tx.find('venture-delivery-run', edit.runId);
      const newest = tx.list('venture-draft-edit').filter(item => item.runId === edit.runId && !item.undoneAt).at(-1);
      // Until the draft moved on: a newer edit, a revision, a merge or a review takes the owner's edit with it.
      check(run && run.status === 'ready-for-review' && !run.revision && !run.merge && run.editedText === edit.text && newest?.id === edit.id, 'UNDO_TOO_LATE', 'Too late to undo: this draft moved on since your edit.');
      tx.replace({ ...edit, undoneAt: tx.now });
      tx.replace({ ...run, editedText: edit.prior ?? null, reopened: reopenMark(run, tx.now) });
      undoDecision(tx, rowId);
      recordDecision(tx, { subject: decision.subject, action: 'undo', who: 'owner', ruleId: null, reason: 'You took back your edit.', rowId });
      tx.emit('run.step', { runId: run.id });
      tx.emit('queue.changed', { rowId });
    });
    return { restored: true, line: RESTORED_LINE };
  }
  if (decision.subject.startsWith('run:') && decision.action === 'deny' && decision.line.startsWith(ACTION_WORDS.sentBack(''))) {
    const run = listRecords(state, 'venture-delivery-run', venture.id).find(item => `run:${item.id}` === decision.subject);
    check(run && run.revision?.rowId === rowId, 'UNDO_TOO_LATE', TOO_LATE_LINE);
    await undoRevision(deps, ctx, run.id, rowId);
    return { restored: true, line: RESTORED_LINE };
  }
  check(!wentOut(decision), 'UNDO_OUTSIDE_EFFECT', ACTION_WORDS.outside);
  // A plan or price sent back with words: nothing ran, so the decision is undone and the same row comes back.
  if (decision.subject.startsWith('plan:') && decision.action === 'deny' && decision.line.startsWith(ACTION_WORDS.planKept(''))) {
    await ventureAction(deps, ctx, 'approve', 'queue.undo', tx => {
      undoDecision(tx, rowId);
      recordDecision(tx, { subject: decision.subject, action: 'undo', who: 'owner', ruleId: null, reason: 'You took back sending the plan change back.', rowId });
      tx.emit('queue.changed', { rowId });
    });
    return { restored: true, line: RESTORED_LINE };
  }
  if (decision.subject.startsWith('plan:')) throw new ChausarError('UNDO_NOTHING', ACTION_WORDS.planUndo);
  throw new ChausarError('UNDO_NOTHING', ACTION_WORDS.nothing);
}

// ---------------------------------------------------------------------------
// Set approval (O9)
// ---------------------------------------------------------------------------

/** What approving a row in a set can cost, in micro-dollars: posts, draft reviews and spot checks start no paid call. */
function rowMicros(_found: Found): string {
  return '0';
}

/**
 * Why a row can't go in a set, or null when it can: only a post whose whole text is shown, a draft's review and a spot
 * check; never money, a price, an invoice, a sign-off, a bank row or anything that starts paid work. Exported for tests.
 */
export function setRefusal(found: Found): { reason: string; line: string } | null {
  const { row, subject } = found;
  const kind = (line: string) => ({ reason: 'SET_KIND_REFUSED', line });
  if (row.kind !== 'connector' && row.kind !== 'draft') return kind(ACTION_WORDS.setKind);
  if (!row.actions.some(action => action.id === 'approve')) return kind(ACTION_WORDS.setKind);
  if (row.kind === 'connector') {
    if (!subject.startsWith('post:')) return kind(ACTION_WORDS.setKind);
    // A post that does not show all it sends is approved on its own (W1 H21).
    return row.descriptionComplete === true ? null : kind(ACTION_WORDS.setPartPost);
  }
  if (subject.startsWith('spot:')) return null;
  return subject.startsWith('run:') && versionOf(row.id).startsWith('review') ? null : kind(ACTION_WORDS.setPaid);
}

/**
 * The digest a set approval is bound to: the picked rows in the owner's order, each by its id and digest, and the
 * set's total quote in micro-dollars. venture.queue.setPreview works it out; the screen sends it back as it is.
 */
export function setDigest(rows: readonly Pick<QueueRow, 'id' | 'digest'>[], totalMicros: string): string {
  return digest({ rows: rows.map(row => [row.id, row.digest]), totalMicros });
}

type SetItems = Extract<SumReceiptSubject, { type: 'set' }>['items'];
type Worked = { picked: Found[]; refusals: QueueSetPreview['refusals']; items: SetItems; total: string; secondAsk: boolean; digest: string };

/** The picked ids, checked the same way by the preview and the approval. */
function pickedIds(value: unknown): string[] {
  check(Array.isArray(value) && value.length > 0, 'SET_NEEDS_PICK', ACTION_WORDS.pick);
  check(value.every(idOk), 'SET_NEEDS_PICK', ACTION_WORDS.pick);
  check(value.length <= SET_MAX, 'INVALID_VENTURE_REQUEST', `Approve at most ${SET_MAX} at a time.`);
  check(new Set(value).size === value.length, 'INVALID_VENTURE_REQUEST', 'Pick each item once.');
  return value as string[];
}

/**
 * The set as it stands now: each picked row (missing ones, decided or changed since, are refused as stale), why any
 * can't go in a set, each item that must be read first and was not opened in this exact version (VIEW_FIRST), what
 * each can cost and the total, whether any item asks twice, and the digest over the rows found and the total.
 */
async function workSet(deps: VentureDeps, ctx: Context, ids: readonly string[]): Promise<Worked> {
  const rows = await queueRowsWithSubjects(deps, ctx);
  const state = deps.store.read();
  const venture = currentVenture(state);
  check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
  const refusals: Worked['refusals'] = [];
  const picked: Found[] = [];
  for (const id of ids) {
    const found = rows.find(item => item.row.id === id && item.row.kind !== 'locked');
    if (!found) { refusals.push({ rowId: id, reason: 'APPROVAL_STALE', line: ACTION_WORDS.setStale }); continue; }
    picked.push(found);
    const refusal = setRefusal(found);
    if (refusal) { refusals.push({ rowId: id, ...refusal }); continue; }
    const approve = found.row.actions.find(action => action.id === 'approve');
    if (approve?.requiresView && !viewedExactly(state, venture.id, found.row)) refusals.push({ rowId: id, reason: 'VIEW_FIRST', line: ACTION_WORDS.viewFirst });
  }
  const items: SetItems = picked.map(item => ({ rowId: item.row.id, label: item.row.title, micros: rowMicros(item) }));
  const total = items.reduce((sum, item) => sum + BigInt(item.micros), 0n).toString();
  const secondAsk = picked.some(item => item.row.actions.some(action => action.id === 'approve' && action.secondAsk));
  return { picked, refusals, items, total, secondAsk, digest: setDigest(picked.map(item => item.row), total) };
}

/**
 * venture.queue.setPreview { rowIds } (read): the set as the server works it out, for the owner to read before they
 * approve it: the digest venture.queue.set takes, each item and what it can cost, the total with its sum receipt,
 * whether the set asks twice, and why any item can't go in (the set is refused while any is listed). The screen works
 * out nothing itself.
 */
export async function queueSetPreviewHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<QueueSetPreview> {
  const body = exactPayload(payload, ['rowIds'], ['rowIds']);
  const ids = pickedIds(body.rowIds);
  authorize(deps.store, ctx);
  const worked = await workSet(deps, ctx, ids);
  const venture = currentVenture(deps.store.read())!;
  const receipt = await sumReceipt(deps, ctx, venture.id, setPlan({ type: 'set', items: worked.items }));
  return {
    digest: worked.digest,
    items: worked.picked.map((item, index) => ({ rowId: item.row.id, title: item.row.title, kind: item.row.kind, cost: formatMicros(worked.items[index].micros) })),
    total: { display: formatMicros(worked.total), receiptId: receipt.id },
    secondAsk: worked.secondAsk, refusals: worked.refusals,
  };
}

/** Every remaining picked row is still on Today in the version the owner approved. */
async function stillAsPicked(deps: VentureDeps, ctx: Context, remaining: readonly Found[]): Promise<boolean> {
  const rows = await queueRowsWithSubjects(deps, ctx);
  return remaining.every(item => rows.some(row => row.row.id === item.row.id && row.row.digest === item.row.digest));
}

/**
 * venture.queue.set { rowIds, digest, secondAsk? } (approve, app only): approves the rows the owner picked, in order,
 * bound by the digest venture.queue.setPreview gave. Only posts and drafts (SET_KIND_REFUSED for money, prices,
 * invoices and sign-offs, and for a post that does not show all it sends); an empty pick is SET_NEEDS_PICK and there is
 * no "all"; an item that must be read first and was not opened in this version is VIEW_FIRST; a set with an item that
 * asks twice needs secondAsk (SET_NEEDS_SECOND_ASK). Before each item every remaining one is checked again: a change
 * stops the set as stale (APPROVAL_STALE before anything ran). Each item is decided on its own, as on Today, with its
 * own record, journal entry and charge record; the sum receipt, written last, covers the items done.
 */
export async function queueSetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<QueueSetResult> {
  requireAppChannel(ctx, 'venture.queue.set');
  const body = exactPayload(payload, ['rowIds', 'digest', 'secondAsk'], ['rowIds', 'digest']);
  const ids = pickedIds(body.rowIds);
  check(typeof body.digest === 'string' && /^[a-f0-9]{64}$/.test(body.digest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the set you saw.');
  check(body.secondAsk === undefined || body.secondAsk === true, 'INVALID_VENTURE_REQUEST', 'secondAsk is true when the owner answered the second ask.');
  authorize(deps.store, ctx, 'approve');
  const worked = await workSet(deps, ctx, ids);
  const [first] = worked.refusals;
  if (first) throw new ChausarError(first.reason, first.line);
  check(worked.digest === body.digest, 'APPROVAL_STALE', ACTION_WORDS.setStale);
  check(!worked.secondAsk || body.secondAsk === true, 'SET_NEEDS_SECOND_ASK', ACTION_WORDS.secondAsk);
  const decisions: QueueDecision[] = [];
  const done: Found[] = [];
  for (const [index, item] of worked.picked.entries()) {
    if (!await stillAsPicked(deps, ctx, worked.picked.slice(index))) {
      if (!done.length) throw new ChausarError('APPROVAL_STALE', ACTION_WORDS.setStale);
      decisions.push({ outcome: 'stale', reason: 'APPROVAL_STALE', line: ACTION_WORDS.setStale });
      break;
    }
    // Each item that must be read first was opened in this exact version (workSet checked the marks).
    const decision = await queueDecideHandler(deps, ctx, { id: item.row.id, digest: item.row.digest, action: 'approve', viewed: true });
    decisions.push(decision);
    if (decision.outcome !== 'done') break;
    done.push(item);
  }
  const venture = currentVenture(deps.store.read())!;
  const receipt = done.length
    ? await sumReceipt(deps, ctx, venture.id, setPlan({ type: 'set', items: worked.items.filter(item => done.some(found => found.row.id === item.rowId)) }))
    : null;
  const stopped = decisions.find(item => item.outcome !== 'done');
  const line = stopped
    ? `Approved ${done.length} of ${worked.picked.length}. Stopped at the next one: ${stopped.line}`
    : `Approved ${done.length} of ${worked.picked.length}. Each one has its own record.`;
  return { decisions, line, ...(receipt ? { receiptId: receipt.id } : {}) };
}
