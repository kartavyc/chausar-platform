// Chausar venture launcher: venture.journal.list, the action journal as the Money place shows it (package P2-journal),
// and venture.journal.resolve, its Resolve control on an outcome nobody knows (Ink v2 wave 1, H3).
// One JournalEntry per outside effect, newest first: the journal entries (invoices, sends to the owner's AI and every
// other write), the connector posts, which are journalled records of their own, and the staged website edits, whose
// own states map onto the journal's. Shadow entries never happened, so they are left out. A read: no token, no digest.
// Resolve records what the owner found after checking the other side; it never sends or runs anything again.
import { authorize, check, type Context, type State } from '../../contracts.ts';
import type { JournalEntry, JournalRecord, JournalState, SiteEditRecord, SiteEditState, VentureDeps } from '../contracts.ts';
import { currentVenture, exactPayload, findRecord, identifier, isAppChannel, listRecords, singleLine, ventureAction, type VentureTx } from '../records.ts';
import { postJournal, postResolvedLine } from '../build/posting.ts';
import { JOURNAL_ACTIONS, resolveIn, resolvedLine } from './journal.ts';
import { allowedByEntries } from './decisions.ts';
import { chainBreakEntries } from './chain.ts';

export const JOURNAL_LIST_DEFAULT = 100;
export const JOURNAL_LIST_MAX = 500;

const lastOf = <T>(items: readonly T[]): T | undefined => items[items.length - 1];

function entryOf(record: JournalRecord): JournalEntry {
  const last = lastOf(record.journal);
  return {
    id: record.id, action: JOURNAL_ACTIONS[record.action]?.label ?? record.action, target: record.target, state: record.state,
    at: last?.at ?? record.at, line: last?.line ?? record.describe, ...(record.receiptId ? { receiptId: record.receiptId } : {}),
    // 4J10 (H27): how far it went after applied, and how each target ended.
    ...(record.ends?.length ? { endState: record.ends[record.ends.length - 1].state } : {}),
    ...(record.targets ? { targets: record.targets.map(target => ({ ...target })) } : {}),
  };
}

/** A staged edit waits like a described action; one that could not be confirmed is an unknown outcome. */
const SITE_STATES: Readonly<Record<SiteEditState, JournalState>> = Object.freeze({
  staged: 'described', applying: 'approved', applied: 'applied', 'rolled-back': 'applied', rejected: 'rejected', 'needs-inspection': 'outcome_unknown',
});

function siteOf(edit: SiteEditRecord): JournalEntry {
  const last = lastOf(edit.log);
  return { id: edit.id, action: JOURNAL_ACTIONS['site.apply'].label, target: edit.path, state: SITE_STATES[edit.state] ?? 'outcome_unknown', at: last?.at ?? edit.at, line: last?.line ?? edit.summary };
}

/** Every journalled effect of the open business, newest first. */
export function journalEntries(state: State, limit = JOURNAL_LIST_DEFAULT): JournalEntry[] {
  const venture = currentVenture(state);
  if (!venture) return [];
  const entries = [
    // A website edit is listed once, from its own record: its journal entry (the bound token) is the same effect.
    // Phone alerts (4G3) stay in the journal but out of this list: each is a notice of a count to the owner's own device.
    ...listRecords(state, 'venture-journal-entry', venture.id).filter(record => !record.shadow && record.action !== 'site.apply' && record.action !== 'notify.push' && record.action !== 'notify.relay').map(entryOf),
    ...postJournal(state, venture.id),
    ...listRecords(state, 'venture-site-edit', venture.id).map(siteOf),
    // 4J1 (O17): each step a saved rule let run without asking, with the rule and how to stop always allowing it.
    ...allowedByEntries(state, venture),
    // 4J10 (H26): where a new record began, after a break the owner accepted.
    ...chainBreakEntries(state, venture),
  ];
  return entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}

/** venture.journal.list { limit? } (read): what each outside effect is and where it stands, newest first. */
export async function journalListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ entries: JournalEntry[] }> {
  const body = exactPayload(payload, ['limit']);
  check(body.limit === undefined || (Number.isInteger(body.limit) && (body.limit as number) >= 1 && (body.limit as number) <= JOURNAL_LIST_MAX),
    'INVALID_VENTURE_REQUEST', `limit must be a whole number from 1 to ${JOURNAL_LIST_MAX}.`);
  authorize(deps.store, ctx);
  return { entries: journalEntries(deps.store.read(), (body.limit as number | undefined) ?? JOURNAL_LIST_DEFAULT) };
}

// ---------------------------------------------------------------------------
// venture.journal.resolve
// ---------------------------------------------------------------------------

const NOTE_MAX = 300;
const withNote = (line: string, note: string | null) => (note ? `${line} Your note: ${note}` : line);
const editLine = (written: boolean) => (written ? 'You checked the file: the change was written.' : 'You checked the file: the change was not written. You can try again.');

/** Which way a website edit was writing: its journal subject ends in '.applied' (the edit) or '.rolled-back' (the undo). */
type EditWay = { from: 'staged' | 'applied'; done: 'applied' | 'rolled-back' };
const APPLY: EditWay = { from: 'staged', done: 'applied' };
const UNDO: EditWay = { from: 'applied', done: 'rolled-back' };
const wayOfSubject = (subject: string): EditWay => (subject.endsWith('.rolled-back') ? UNDO : APPLY);
const editIdOfSubject = (subject: string) => subject.slice(0, Math.max(0, subject.lastIndexOf('.')));

/** Without its journal entry, the edit's own log says which way it was writing: from applied it was an undo. */
function wayOfLog(edit: SiteEditRecord): EditWay {
  const last = [...edit.log].reverse().find(step => step.step !== 'needs-inspection');
  return last && (last.step === 'applied' || last.step === 'verified') ? UNDO : APPLY;
}

/** The site edit's journal entry that is waiting for the owner's finding, newest first. */
function unknownEditEntry(tx: VentureTx, editId: string): JournalRecord | undefined {
  return tx.list('venture-journal-entry')
    .filter(entry => entry.action === 'site.apply' && entry.state === 'outcome_unknown' && editIdOfSubject(entry.subject) === editId)
    .pop();
}

/** It was written: the edit moves on. It was not: back to where it was, so the owner can try again with the same checks. */
function settleEdit(tx: VentureTx, edit: SiteEditRecord, way: EditWay, written: boolean, line: string): SiteEditRecord {
  const state = written ? way.done : way.from;
  return tx.replace<SiteEditRecord>({ ...edit, state, log: [...edit.log, { at: tx.now, by: tx.ctx.memberId, step: state, line }] });
}

type Settled = { kind: 'entry' | 'post' | 'edit'; id: string };

/** The owner's finding inside one transaction. A website edit and its journal entry settle together. */
function settleIn(tx: VentureTx, entryId: string, sent: boolean, note: string | null): Settled {
  const entry = tx.find('venture-journal-entry', entryId);
  const post = entry ? undefined : tx.find('venture-connector-post', entryId);
  const edit = entry || post ? undefined : tx.find('venture-site-edit', entryId);
  check(entry || post || edit, 'JOURNAL_NOT_FOUND', 'This action is not in the journal.');
  if (post) {
    resolveIn(tx, post, sent, withNote(postResolvedLine(post.connectorId, sent), note));
    return { kind: 'post', id: post.id };
  }
  if (edit) {
    check(edit.state === 'needs-inspection', 'JOURNAL_NOT_UNKNOWN', 'Only an action whose outcome is unknown can be settled. This edit already has an outcome.');
    const line = withNote(editLine(sent), note);
    const own = unknownEditEntry(tx, edit.id);
    if (own) resolveIn(tx, own, sent, line);
    settleEdit(tx, edit, own ? wayOfSubject(own.subject) : wayOfLog(edit), sent, line);
    return { kind: 'edit', id: edit.id };
  }
  if (entry!.action !== 'site.apply') {
    resolveIn(tx, entry!, sent, withNote(resolvedLine(sent), note));
    return { kind: 'entry', id: entry!.id };
  }
  // A website edit's own entry: the journal lists the edit, so the edit settles with it and is what comes back.
  const line = withNote(editLine(sent), note);
  resolveIn(tx, entry!, sent, line);
  const owned = tx.find('venture-site-edit', editIdOfSubject(entry!.subject));
  if (!owned) return { kind: 'entry', id: entry!.id };
  if (owned.state === 'needs-inspection' || owned.state === 'applying') settleEdit(tx, owned, wayOfSubject(entry!.subject), sent, line);
  return { kind: 'edit', id: owned.id };
}

/** One settled record as the journal shows it. */
function settledEntry(state: State, settled: Settled): JournalEntry {
  if (settled.kind === 'post') return postJournal(state).find(item => item.id === settled.id)!;
  if (settled.kind === 'edit') return siteOf(findRecord(state, 'venture-site-edit', settled.id)!);
  return entryOf(findRecord(state, 'venture-journal-entry', settled.id)!);
}

/**
 * venture.journal.resolve { entryId, outcome, note? } (the owner, inside the app): the owner checked an action whose
 * outcome was unknown and says what they found. 'sent' records it as applied, so it is never proposed again; 'not-sent'
 * as rejected, so the same thing may be proposed again. Works on journal entries, posts and website edits that need
 * inspection; any other state is refused. Nothing is sent or run. Answers the settled row as the journal lists it.
 */
export async function journalResolveHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ entry: JournalEntry }> {
  const body = exactPayload(payload, ['entryId', 'outcome', 'note'], ['entryId', 'outcome']);
  const entryId = identifier(body.entryId, 'entryId');
  check(body.outcome === 'sent' || body.outcome === 'not-sent', 'INVALID_VENTURE_REQUEST', 'Say whether it went out: sent or not-sent.');
  const note = body.note === undefined ? null : singleLine(body.note, 'The note', { max: NOTE_MAX });
  check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', 'Record this inside the Chausar app.');
  const sent = body.outcome === 'sent';
  const settled = await ventureAction(deps, ctx, 'approve', 'journal.resolve', tx => settleIn(tx, entryId, sent, note));
  return { entry: settledEntry(deps.store.read(), settled) };
}
