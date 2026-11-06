/**
 * The approval page (Ink v2 wave 4, 4G4; catalogue O11: one approval in three places, Today, the run sheet and here).
 * A phone alert's tap lands on `#/approve/next` (public/sw.js): the oldest approval waiting, as one card, the same
 * ApprovalRow card Today draws, with its second ask and view-before-approve; once it is decided, "Next" brings the next
 * oldest. `#/approve/<rowId>` (the bell's centre, the run sheet's banner) shows that row, or says it was already
 * decided. Decisions go through `venture.queue.decide` with the row's digest exactly as on Today, and land in Today's
 * session, so Today shows the same receipt line. `next` skips setup steps and locked businesses (not approvals); a
 * setup step asked for by id (the bell's centre lists it) shows with its own place action, such as Connect.
 */

import { useEffect, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { goTo, openSheet, useRoute } from '../../shell/navigation';
import { useNarrow } from '../../shell/useNarrow';
import { ApprovalRow, readBack, type DecideExtra } from '../../parts/ApprovalRow';
import { Button } from '../../parts/Button';
import { EmptyState } from '../../parts/EmptyState';
import { PageTitle } from '../../parts/PageTitle';
import type { QueueAction, QueueDecision, QueueRow, VentureRunEvent } from '../../engine/types';
import { seenKey, useTodaySession } from '../today/session';
import { viewSheetId } from '../today/ViewSheet';
import { useCardPreview } from '../today/CardPreview';
import s from './Approve.module.css';

const QUEUE_EVENTS = (event: VentureRunEvent) => event.type === 'queue.changed' || event.type === 'run.waiting' || event.type === 'run.failed';

/** What this page decides: everything Today lists but locked businesses and setup steps, oldest first. */
export function approvalsOf(rows: readonly QueueRow[]): QueueRow[] {
  return rows.filter((row) => row.kind !== 'locked' && row.kind !== 'setup').sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Primaries that take the owner where the thing is done; the engine refuses them as decisions (NOT_A_DECISION). */
const PLACES_FOR: Partial<Record<QueueAction['id'], () => void>> = {
  connect: () => goTo('connections'),
  'set-prices': () => goTo('business', 'prices'),
  keep: () => goTo('business', 'keep'),
};

export function Place() {
  const t = useT();
  const client = useEngine();
  const route = useRoute();
  const session = useTodaySession();
  const asked = route.sub ?? 'next';
  const queue = useResource('venture.queue.list', { scope: 'all' }, { refreshOn: QUEUE_EVENTS });
  // The row on screen, fixed once chosen, and the version of it decided here (kept after it leaves the list).
  const [chosen, setChosen] = useState<string | null>(null);
  const [kept, setKept] = useState<QueueRow | null>(null);
  const [done, setDone] = useState(false);
  // A stale decision hands back the newer version; it shows until the list itself catches up (as on Today).
  const [newer, setNewer] = useState<{ from: string; latest: QueueRow } | null>(null);

  // A new address starts afresh.
  useEffect(() => { setChosen(null); setKept(null); setDone(false); setNewer(null); }, [asked]);

  // Every row but a locked business's: one asked for by id may be a setup step, shown with its own place action.
  const open = (queue.data?.rows ?? []).filter((row) => row.kind !== 'locked');
  // Rows decided in this session (here or on Today) wait no more, though the list may hold them a moment longer.
  const waiting = approvalsOf(open).filter((row) => !session.line(row.id));
  const listed = chosen ? open.find((row) => row.id === chosen) : undefined;
  const current = listed && newer && newer.latest.id === listed.id && listed.digest === newer.from ? newer.latest : listed;
  const row = (done ? kept : current) ?? null;

  // Choose the row once the list is in: the oldest for `next`, else the one asked for, if it still waits.
  useEffect(() => {
    if (!queue.data || chosen) return;
    const pick = asked === 'next' ? waiting[0] : open.find((r) => r.id === asked && !session.line(r.id));
    if (pick) setChosen(pick.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.data, chosen, asked]);

  // The row on screen was decided somewhere else before it was decided here: on `next`, move on to the next oldest.
  useEffect(() => {
    if (asked === 'next' && chosen && queue.data && !listed && !done) setChosen(null);
  }, [asked, chosen, queue.data, listed, done]);

  async function decide(r: QueueRow, action: QueueAction, extra: DecideExtra): Promise<QueueDecision> {
    setKept(r);
    session.begin(r.id);
    try {
      return after(r, await client.request('venture.queue.decide', { id: r.id, digest: r.digest, action: action.id, ...extra }));
    } finally {
      session.end(r.id);
    }
  }
  async function reread(r: QueueRow): Promise<QueueDecision> {
    setKept(r);
    return after(r, readBack(await client.request('venture.queue.list', { scope: 'all' }), r, t));
  }
  function after(r: QueueRow, decision: QueueDecision): QueueDecision {
    if (decision.outcome === 'done') {
      setDone(true);
      session.keep(r, decision.line, decision.receiptId);
    } else if (decision.reason === 'ALREADY_DECIDED' || decision.reason === 'RESOLVED_ELSEWHERE') {
      setDone(true);
      session.keep(r, t('approval.elsewhere'), undefined, false);
    } else if (decision.outcome === 'stale') {
      session.unview(r.id);
      const latest = decision.latest;
      if (latest) setNewer({ from: r.digest, latest });
    } else if (decision.reason === 'VIEW_FIRST') session.unview(r.id);
    return decision;
  }

  function next() {
    setChosen(null);
    setKept(null);
    setDone(false);
    setNewer(null);
    if (asked !== 'next') goTo('approve', 'next');
  }

  const others = waiting.filter((r) => r.id !== row?.id);
  const position = row ? waiting.findIndex((r) => r.id === row.id) + 1 : 0;
  const line = !queue.data ? undefined
    : position > 0 ? t('approve.position', { index: position, count: waiting.length })
      : waiting.length > 0 ? t('approve.waiting', { count: waiting.length }) : undefined;

  let body;
  if (queue.error && !queue.data) body = <p className={s.problem} role="alert">{t('sheet.failed', { message: queue.error.message })}</p>;
  else if (!queue.data) body = <p className={s.quiet}>{t('sheet.loading')}</p>;
  else if (row) {
    body = (
      <>
        {line && <h2 className={s.position}>{line}</h2>}
        <ApproveCard row={row} onDecide={decide} onReread={reread} />
        {done && (others.length > 0
          ? <div className={s.next}><Button variant="primary" size="lg" onClick={next}>{t('approve.next')}</Button></div>
          : <EmptyState title={t('approve.last')} actions={[{ label: t('approve.today'), href: '#/today' }]} />)}
      </>
    );
  } else if (asked !== 'next') {
    body = <EmptyState title={t('approve.decided')} actions={[{ label: t('approve.seeNext'), href: '#/approve/next' }]} />;
  } else if (!waiting.length) {
    body = <EmptyState title={t('approve.none')} actions={[{ label: t('approve.today'), href: '#/today' }]} />;
  }

  return (
    <>
      <PageTitle title={t('approve.title')} />
      <div className={s.page}>{body}</div>
    </>
  );
}

/** The card, as Today draws it: the preview, the lock until the thing is opened, the second ask inside the card. */
function ApproveCard({ row, onDecide, onReread }: {
  row: QueueRow;
  onDecide: (row: QueueRow, action: QueueAction, extra: DecideExtra) => Promise<QueueDecision>;
  onReread: (row: QueueRow) => Promise<QueueDecision>;
}) {
  const session = useTodaySession();
  const narrow = useNarrow();
  const viewed = session.isViewed(seenKey(row));
  // A file's card shows tax figures only for a business registered for tax, as on Today.
  const plan = useResource('venture.blueprint.get', {}, { skip: row.viewRef?.kind !== 'file' });
  const taxRegistered = plan.data?.blueprint.backOffice.taxRegistered.value === true;
  const preview = useCardPreview(row, { unseen: !viewed, enabled: true, taxRegistered });

  function look(r: QueueRow, origin?: HTMLElement) {
    const ref = r.viewRef;
    if (!ref) return;
    if (ref.kind === 'run') {
      session.markViewed(seenKey(r));
      openSheet('run', ref.id, origin);
      return;
    }
    const id = viewSheetId({ kind: ref.kind, id: ref.id });
    session.expect(id, seenKey(r));
    openSheet('view', id, origin);
  }
  const receiptId = row.change?.receiptId;
  const open = row.viewRef
    ? (r: QueueRow, origin: HTMLElement) => look(r, origin)
    : receiptId && !row.change?.estimate ? (_r: QueueRow, origin: HTMLElement) => openSheet('receipt', receiptId, origin) : undefined;

  return (
    <div className={s.card}>
      <ApprovalRow
        key={row.id}
        row={row}
        layout="card"
        preview={preview}
        viewed={viewed}
        onDecide={onDecide}
        onReread={onReread}
        onAction={(_r, action) => { const go = PLACES_FOR[action.id]; if (!go) return false; go(); return true; }}
        onView={(r) => look(r)}
        onOpen={open}
        buttonSize={narrow ? 'xl' : undefined}
      />
    </div>
  );
}
