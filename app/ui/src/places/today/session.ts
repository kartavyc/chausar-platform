/**
 * What Today remembers for the rest of the session, in memory only (never browser storage): the rows decided here
 * (each shrunk to its receipt line), which drafts the owner has actually seen, the locked rows already opened, and on
 * a phone the cards swiped to the end and whether the swipe tip was hidden.
 * A session is one engine client: a new pairing or a reload starts empty, which is when decided lines leave.
 */

import { useSyncExternalStore } from 'react';
import { useEngine } from '../../engine/context';
import { readBack, type DecideExtra } from '../../parts/ApprovalRow';
import type { T } from '../../text';
import type { EngineClient, QueueActionId, QueueDecision, QueueRow } from '../../engine/types';

/**
 * undo (W4 4J19): a send back or an edit made here can be taken back until its revision starts; it answers the line to
 * show. untilRevision (B3): a send back's Undo leaves once the queue lists the revision (subjectOf). B4: a price accepted
 * on one press carries one too, and its Undo leaves once the plan has a newer version the same way.
 */
export interface DecidedLine { row: QueueRow; line: string; receiptId?: string | undefined; undo?: (() => Promise<string>) | undefined; untilRevision?: true | undefined }

/** A row id is its subject and its version (views/queue.ts base): the subject is all before the last colon. */
export const subjectOf = (id: string) => (id.includes(':') ? id.slice(0, id.lastIndexOf(':')) : id);

/**
 * B3: a decided line's Undo, while it can still work. A send back's Undo leaves once the queue lists another row for the
 * same subject, which is when its revision has started and the engine would refuse it.
 */
export function undoOf(line: DecidedLine, listed: readonly QueueRow[]): DecidedLine['undo'] {
  if (!line.undo) return undefined;
  if (!line.untilRevision) return line.undo;
  const subject = subjectOf(line.row.id);
  return listed.some((row) => row.id !== line.row.id && subjectOf(row.id) === subject) ? undefined : line.undo;
}

/** A row as the owner saw it: a new digest is a new version, which has to be seen again. */
export const seenKey = (row: Pick<QueueRow, 'id' | 'digest'>) => `${row.id}@${row.digest}`;

export class TodaySession {
  private decided = new Map<string, DecidedLine>();
  /** B4: rows whose decision was taken back: what to say on the card until it is decided again. */
  private saidLines = new Map<string, string>();
  private viewed = new Set<string>();
  /** Sheets asked for and not shown yet: ref -> the row versions waiting on it. */
  private waiting = new Map<string, Set<string>>();
  /** Sheets showing their content now. */
  private shown = new Set<string>();
  private hidden = new Set<string>();
  private busy = new Set<string>();
  /** B3: the rows whose decision is on its way, kept whole, so a refresh that drops one meanwhile leaves its card up. */
  private held = new Map<string, QueueRow>();
  /** Each row's place in the engine's order when it first appeared, so decided lines stay where they were. */
  private places = new Map<string, number>();
  /** Cards swiped left that have no Later: they go to the end of the list, in the order they were swiped. */
  private deferred = new Map<string, number>();
  private deferrals = 0;
  private tip = true;
  private version = 0;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.version;
  private changed() { this.version += 1; for (const listener of [...this.listeners]) listener(); }

  /** Keep a decided row as one line. `replace: false` never overwrites a line already kept. */
  keep(row: QueueRow, line: string, receiptId?: string, replace = true, undo?: () => Promise<string>, untilRevision = false) {
    if (!replace && this.decided.has(row.id)) return;
    this.saidLines.delete(row.id);
    this.decided.set(row.id, { row, line, receiptId, ...(undo ? { undo } : {}), ...(undo && untilRevision ? { untilRevision: true as const } : {}) });
    this.changed();
  }
  line(id: string): DecidedLine | undefined { return this.decided.get(id); }
  /** B4: the decision was taken back: the row is open again, and the card says what happened. */
  reopen(id: string, said: string) {
    this.decided.delete(id);
    this.saidLines.set(id, said);
    this.changed();
  }
  said(id: string): string | undefined { return this.saidLines.get(id); }
  /** Note the engine's order for rows not seen before; known rows keep their place. */
  placeRows(rows: readonly QueueRow[]) { for (const row of rows) if (!this.places.has(row.id)) this.places.set(row.id, this.places.size); }
  place(id: string): number { return this.places.get(id) ?? Number.MAX_SAFE_INTEGER; }
  lines(): DecidedLine[] { return [...this.decided.values()]; }

  /**
   * A decision is on its way for this row: a refresh that drops it meanwhile is not "resolved elsewhere". Given the row
   * itself (B3), the session keeps it until the answer, so the places drawing it keep its card mounted.
   */
  begin(row: QueueRow | string) {
    if (typeof row === 'string') { this.busy.add(row); return; }
    this.busy.add(row.id);
    this.held.set(row.id, row);
  }
  end(id: string) {
    this.busy.delete(id);
    if (this.held.delete(id)) this.changed();
  }
  isBusy(id: string) { return this.busy.has(id); }
  /** The rows whose decision is on its way (B3). */
  heldRows(): QueueRow[] { return [...this.held.values()]; }

  /**
   * B3: what a decision means for the session, the same wherever it was made: the engine's line is kept on done; a row
   * already decided or resolved elsewhere is kept as such (never over a line already kept); stale and VIEW_FIRST have
   * to be looked at again.
   */
  settle(row: QueueRow, decision: QueueDecision, t: T, undo?: () => Promise<string>): QueueDecision {
    if (decision.outcome === 'done') this.keep(row, decision.line, decision.receiptId, true, undo, Boolean(undo));
    else if (decision.outcome === 'stale' || decision.reason === 'VIEW_FIRST') this.unview(row.id);
    else if (decision.reason === 'ALREADY_DECIDED' || decision.reason === 'RESOLVED_ELSEWHERE') this.keep(row, t('approval.elsewhere'), undefined, false);
    return decision;
  }

  /** The owner asked to see `ref` for this row version. It counts once the sheet shows it (now, if it already does). */
  expect(ref: string, key: string) {
    if (this.shown.has(ref)) { this.viewed.add(key); this.changed(); return; }
    const set = this.waiting.get(ref) ?? new Set<string>();
    set.add(key);
    this.waiting.set(ref, set);
  }
  /** Seen without a sheet of ours (a run sheet opens on the spot). */
  markViewed(key: string) { this.viewed.add(key); this.changed(); }
  /** The sheet for `ref` shows its content: every row version waiting on it is now viewed. */
  show(ref: string) {
    this.shown.add(ref);
    const keys = this.waiting.get(ref);
    this.waiting.delete(ref);
    if (keys?.size) { for (const key of keys) this.viewed.add(key); this.changed(); }
  }
  unshow(ref: string) { this.shown.delete(ref); }
  isViewed(key: string) { return this.viewed.has(key); }
  /** Forget every version of this row the owner saw (it changed, or the engine wants it seen again). */
  unview(id: string) {
    for (const key of [...this.viewed]) if (key.startsWith(`${id}@`)) this.viewed.delete(key);
    this.changed();
  }

  /** A card swiped left with no Later to press: it moves to the end of the list for the session, with no engine call.
   *  Swiped again, it goes to the end again. */
  defer(id: string) {
    this.deferred.delete(id);
    this.deferred.set(id, (this.deferrals += 1));
    this.changed();
  }
  /** Where a swiped card stands among the ones swiped to the end (1 first), or 0 when it was not swiped. */
  deferredRank(id: string): number { return this.deferred.get(id) ?? 0; }

  /** The swipe tip on a phone: shown until the owner hides it, then hidden for the rest of the session. */
  showsTip() { return this.tip; }
  hideTip() { this.tip = false; this.changed(); }

  /** A row that left because of something done here, not decided (a locked business opened). */
  hide(id: string) { this.hidden.add(id); this.changed(); }
  isHidden(id: string) { return this.hidden.has(id); }
}

const sessions = new WeakMap<EngineClient, TodaySession>();

export function sessionFor(client: EngineClient): TodaySession {
  let session = sessions.get(client);
  if (!session) { session = new TodaySession(); sessions.set(client, session); }
  return session;
}

/**
 * B4: take back a decision the engine said it can (QueueDecision.undoable, a price on one press). On success the row is
 * open again; refused, the line says why and no Undo stays. B3's read layer refreshes the screens after this write, as it
 * does after a decision. A failure that is not the engine's refusal leaves the Undo to try again.
 */
function takeBack(client: EngineClient, row: QueueRow): () => Promise<string> {
  return async () => {
    const session = sessionFor(client);
    try {
      const { line } = await client.request('venture.queue.undo', { rowId: row.id });
      session.reopen(row.id, line);
      return line;
    } catch (error) {
      if (/^UNDO_/.test(String((error as { code?: unknown } | null)?.code))) session.keep(row, error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
}

/**
 * B3: the one way to decide a row, from Today, the approval page, Prices and the plan page, the run sheet, Run again
 * and the round gate. The session holds the row while the decision is on its way and keeps the engine's line after, so
 * every place shows the same line and none calls it resolved elsewhere.
 */
export async function decide(client: EngineClient, row: QueueRow, action: QueueActionId, extra: Partial<DecideExtra>, t: T): Promise<QueueDecision> {
  const session = sessionFor(client);
  session.begin(row);
  try {
    const decision = await client.request('venture.queue.decide', { id: row.id, digest: row.digest, action, ...extra });
    return session.settle(row, decision, t, decision.undoable ? takeBack(client, row) : undefined);
  } finally {
    session.end(row.id);
  }
}

/** A decision that timed out: read the list again and keep what the engine holds. It never decides a second time. */
export async function reread(client: EngineClient, row: QueueRow, scope: 'all' | 'current', t: T): Promise<QueueDecision> {
  const session = sessionFor(client);
  session.begin(row);
  try {
    return session.settle(row, readBack(await client.request('venture.queue.list', { scope }), row, t), t);
  } finally {
    session.end(row.id);
  }
}

/** Today's session for this engine client; the component re-renders when it changes. */
export function useTodaySession(): TodaySession {
  const session = sessionFor(useEngine());
  useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  return session;
}
