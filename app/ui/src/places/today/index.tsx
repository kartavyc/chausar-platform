/**
 * Today: the approval queue. Everything that needs the owner across every business on this computer, oldest first,
 * each row with its business tag and two actions; decided rows shrink to one receipt line for the rest of the
 * session; under them, what the team is working on now. Keys (J, K, Enter, A, D) come from the shell.
 */

import { useEffect, useRef, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { goTo, openSheet } from '../../shell/navigation';
import { ApprovalRow, type DecideExtra } from '../../parts/ApprovalRow';
import { EmptyState } from '../../parts/EmptyState';
import { PageTitle } from '../../parts/PageTitle';
import { Receipt } from '../../parts/Receipt';
import { cx } from '../../parts/cx';
import { EngineError, type QueueAction, type QueueDecision, type QueueRow, type VentureRunEvent } from '../../engine/types';
import type { SheetComponent } from '../../shell/sheets';
import { seenKey, useTodaySession, type DecidedLine } from './session';
import { ViewSheet, viewSheetId } from './ViewSheet';
import { WorkingNow, focusRow } from './WorkingNow';
import s from './Today.module.css';

/** A run waiting on the owner adds a row; a failed run adds "Run again". */
const QUEUE_EVENTS = (event: VentureRunEvent) => event.type === 'queue.changed' || event.type === 'run.waiting' || event.type === 'run.failed';

/** Oldest first; locked businesses last, as the engine lists them. */
const order = (a: QueueRow, b: QueueRow) => (a.kind === 'locked' ? 1 : 0) - (b.kind === 'locked' ? 1 : 0) || a.createdAt.localeCompare(b.createdAt);

/** Actions that take the owner where the thing is done. The engine refuses them as decisions (NOT_A_DECISION). */
const PLACES_FOR: Partial<Record<QueueAction['id'], () => void>> = {
  connect: () => goTo('connections'),
  'set-prices': () => goTo('business', 'prices'),
  keep: () => goTo('business', 'keep'),
};

const focusedRowId = () => (document.activeElement as HTMLElement | null)?.closest?.('[data-row-id]')?.getAttribute('data-row-id') ?? null;

export function Place() {
  const t = useT();
  const client = useEngine();
  const session = useTodaySession();
  const queue = useResource('venture.queue.list', { scope: 'all' }, { refreshOn: QUEUE_EVENTS });
  // A stale decision hands back the new version; it shows until the list itself catches up.
  const [newer, setNewer] = useState<ReadonlyMap<string, { from: string; latest: QueueRow }>>(new Map());
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
  const [focusAfter, setFocusAfter] = useState<string | null>(null);
  const listed = useRef<Map<string, QueueRow> | null>(null);

  const live = (queue.data?.rows ?? []).filter((row) => !session.isHidden(row.id)).map((row) => {
    const swap = newer.get(row.id);
    return swap && swap.from === row.digest ? swap.latest : row;
  });

  // A row that leaves the list without being decided here was resolved somewhere else (the run sheet, another
  // window). Rows of a business that just became locked (the owner switched business) leave quietly.
  useEffect(() => {
    const rows = queue.data?.rows;
    if (!rows) return;
    const now = new Set(rows.map((row) => row.id));
    const locked = new Set(rows.filter((row) => row.kind === 'locked').map((row) => row.businessId));
    for (const [id, row] of listed.current ?? []) {
      if (now.has(id) || row.kind === 'locked' || locked.has(row.businessId) || session.isBusy(id) || session.isHidden(id)) continue;
      session.keep(row, t('approval.elsewhere'), undefined, false);
    }
    listed.current = new Map(rows.map((row) => [row.id, row]));
  }, [queue.data, session, t]);

  useEffect(() => {
    if (!focusAfter) return;
    setFocusAfter(null);
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected || focusedRowId() === focusAfter) focusRow(focusAfter);
  }, [focusAfter]);

  function look(row: QueueRow, origin?: HTMLElement) {
    const ref = row.viewRef;
    if (!ref) return;
    if (ref.kind === 'run') {
      session.markViewed(seenKey(row));
      openSheet('run', ref.id, origin);
      return;
    }
    const id = viewSheetId({ kind: ref.kind, id: ref.id });
    session.expect(id, seenKey(row));
    openSheet('view', id, origin);
  }

  function settle(row: QueueRow, line: string, receiptId: string | undefined, hadFocus: boolean) {
    session.keep(row, line, receiptId);
    setSettled((ids) => new Set(ids).add(row.id));
    if (hadFocus) setFocusAfter(row.id);
  }

  async function openBusiness(row: QueueRow): Promise<QueueDecision> {
    try {
      await client.request('workspace.open', { folder: row.businessId });
      session.hide(row.id);
      return { outcome: 'done', line: t('today.opened') };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { outcome: 'refused', line: message, reason: error instanceof EngineError ? error.code : 'OPEN_FAILED' };
    }
  }

  async function decide(row: QueueRow, action: QueueAction, extra: DecideExtra): Promise<QueueDecision> {
    const hadFocus = focusedRowId() === row.id;
    if (action.id === 'open') return openBusiness(row);
    session.begin(row.id);
    try {
      const decision = await client.request('venture.queue.decide', { id: row.id, digest: row.digest, action: action.id, ...extra });
      if (decision.outcome === 'done') settle(row, decision.line, decision.receiptId, hadFocus);
      else if (decision.outcome === 'stale') {
        session.unview(row.id);
        const latest = decision.latest;
        if (latest) setNewer((map) => new Map(map).set(row.id, { from: row.digest, latest }));
      } else if (decision.reason === 'ALREADY_DECIDED' || decision.reason === 'RESOLVED_ELSEWHERE') settle(row, t('approval.elsewhere'), undefined, hadFocus);
      else if (decision.reason === 'VIEW_FIRST') session.unview(row.id);
      return decision;
    } finally {
      session.end(row.id);
    }
  }

  function navigate(_row: QueueRow, action: QueueAction): boolean {
    const go = PLACES_FOR[action.id];
    if (!go) return false;
    go();
    return true;
  }

  const liveIds = new Set(live.map((row) => row.id));
  const items: { row: QueueRow; done?: DecidedLine | undefined }[] = [
    ...live.map((row) => ({ row, done: session.line(row.id) })),
    ...session.lines().filter((line) => !liveIds.has(line.row.id)).map((line) => ({ row: line.row, done: line })),
  ].sort((a, b) => order(a.row, b.row));
  const waiting = items.filter((item) => !item.done).length;

  return (
    <>
      <PageTitle title={t('place.today')} line={waiting > 0 ? queue.data?.summary : undefined} />
      <section aria-label={t('queue.title')}>
        {queue.error && !queue.data && <p className={s.failed}>{t('today.failed', { message: queue.error.message })}</p>}
        {items.length > 0 && (
          <ul className={s.list}>
            {items.map(({ row, done }) => (done ? (
              <Decided key={row.id} line={done} settle={settled.has(row.id)} />
            ) : (
              <ApprovalRow
                key={row.id}
                row={row}
                viewed={session.isViewed(seenKey(row))}
                onDecide={decide}
                onAction={navigate}
                onView={(r) => look(r)}
                onOpen={opener(row)}
              />
            )))}
          </ul>
        )}
        {queue.data && waiting === 0 && <EmptyState title={t('queue.empty')} />}
      </section>
      <WorkingNow rowForRun={(runId) => live.find((row) => row.viewRef?.kind === 'run' && row.viewRef.id === runId && !session.line(row.id))?.id} />
    </>
  );

  /** Enter or the title opens what the row is about; a row about a figure opens its receipt. */
  function opener(row: QueueRow): ((row: QueueRow, origin: HTMLElement) => void) | undefined {
    if (row.viewRef) return (r, origin) => look(r, origin);
    const receiptId = row.change?.receiptId;
    if (receiptId && !row.change?.estimate) return (_r, origin) => openSheet('receipt', receiptId, origin);
    return undefined;
  }
}

/** A decided row, shrunk to one line: title, what was done, and its receipt. It stays until the session ends. */
function Decided({ line: { row, line, receiptId }, settle }: { line: DecidedLine; settle: boolean }) {
  const said = receiptId ? (line.endsWith(receiptId) ? line.slice(0, -receiptId.length) : `${line} · `) : line;
  return (
    <li className={cx(s.decided, settle && s.settle)} data-row="" data-row-id={row.id} data-decided="" tabIndex={-1}>
      <span role="status">
        <span className={s.decidedTitle}>{row.title}</span>
        {' · '}
        {said}
        {receiptId && <Receipt id={receiptId} />}
      </span>
    </li>
  );
}

export const sheets: Readonly<Record<string, SheetComponent>> = { view: ViewSheet };
