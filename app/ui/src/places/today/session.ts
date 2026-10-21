/**
 * What Today remembers for the rest of the session, in memory only (never browser storage): the rows decided here
 * (each shrunk to its receipt line), which drafts the owner has actually seen, and the locked rows already opened.
 * A session is one engine client: a new pairing or a reload starts empty, which is when decided lines leave.
 */

import { useSyncExternalStore } from 'react';
import { useEngine } from '../../engine/context';
import type { EngineClient, QueueRow } from '../../engine/types';

export interface DecidedLine { row: QueueRow; line: string; receiptId?: string | undefined }

/** A row as the owner saw it: a new digest is a new version, which has to be seen again. */
export const seenKey = (row: Pick<QueueRow, 'id' | 'digest'>) => `${row.id}@${row.digest}`;

export class TodaySession {
  private decided = new Map<string, DecidedLine>();
  private viewed = new Set<string>();
  /** Sheets asked for and not shown yet: ref -> the row versions waiting on it. */
  private waiting = new Map<string, Set<string>>();
  /** Sheets showing their content now. */
  private shown = new Set<string>();
  private hidden = new Set<string>();
  private busy = new Set<string>();
  private version = 0;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.version;
  private changed() { this.version += 1; for (const listener of [...this.listeners]) listener(); }

  /** Keep a decided row as one line. `replace: false` never overwrites a line already kept. */
  keep(row: QueueRow, line: string, receiptId?: string, replace = true) {
    if (!replace && this.decided.has(row.id)) return;
    this.decided.set(row.id, { row, line, receiptId });
    this.changed();
  }
  line(id: string): DecidedLine | undefined { return this.decided.get(id); }
  lines(): DecidedLine[] { return [...this.decided.values()]; }

  /** A decision is on its way for this row: a refresh that drops it meanwhile is not "resolved elsewhere". */
  begin(id: string) { this.busy.add(id); }
  end(id: string) { this.busy.delete(id); }
  isBusy(id: string) { return this.busy.has(id); }

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

/** Today's session for this engine client; the component re-renders when it changes. */
export function useTodaySession(): TodaySession {
  const session = sessionFor(useEngine());
  useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  return session;
}
