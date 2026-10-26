import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { codeOf, refusalWords } from '../../parts/custody';
import { Button } from '../../parts/Button';
import { Figure } from '../../parts/Figure';
import { Receipt } from '../../parts/Receipt';
import { stateText } from '../../parts/states';
import type { QueueRow, QueueSetPreview } from '../../engine/types';
import { seenKey, useTodaySession } from './session';
import { viewSheetId } from './ViewSheet';
import s from './TodayActions.module.css';

/** What a row stands for (its id up to the last ':') and its version (after it), as the engine writes row ids. */
const subjectOf = (id: string) => id.slice(0, Math.max(0, id.lastIndexOf(':')));
const versionOf = (id: string) => id.slice(id.lastIndexOf(':') + 1);

/**
 * The rows a set takes, as the engine's setRefusal reads them (views/queue-actions.ts): of the open business only, with
 * an Approve (the open business's rows are the ones venture.queue.list lists for it, shell/openBusiness.ts); a post (subject post:) that shows all it sends; a draft's review (run:, version review) or a spot check
 * (spot:). Never money, prices, invoices, sign-offs, a connection to set up or paid work. The engine still answers
 * each refusal in setPreview; this only keeps the list to what it can take.
 */
export function setCandidates(rows: readonly QueueRow[], openRowIds: ReadonlySet<string> | undefined): QueueRow[] {
  if (!openRowIds) return [];
  return rows.filter((row) => {
    if (!openRowIds.has(row.id) || !row.actions.some((action) => action.id === 'approve')) return false;
    const subject = subjectOf(row.id);
    if (row.kind === 'connector') return subject.startsWith('post:') && row.descriptionComplete === true;
    if (row.kind !== 'draft') return false;
    return subject.startsWith('spot:') || (subject.startsWith('run:') && versionOf(row.id).startsWith('review'));
  });
}

/** The engine's set refusals the screen words itself (English and Hindi); anything else keeps the engine's words. */
const WORDED: Readonly<Record<string, string>> = { SET_KIND_REFUSED: 'today.set.refused.kind', APPROVAL_STALE: 'today.set.refused.stale', VIEW_FIRST: 'today.set.readFirst' };

type Phase = 'pick' | 'confirm' | 'sending' | 'done';

/**
 * W4 4J19 (O9): approve several posts and drafts at once. Nothing is picked to start with and there is no "approve all":
 * the owner ticks each one. The engine works the set out (venture.queue.setPreview): its digest, each item's cost and
 * the total with its sum receipt, whether it asks twice, and why any item can't go in, such as one that must be read
 * first and was not opened in this version (Read opens it beside the list). The screen works out nothing. Approve sends
 * the set's digest (venture.queue.set) and asks once more when the engine says so; each item keeps its own record and
 * its card shrinks to its own line.
 */
export function SetPicker({ rows, onClose }: { rows: readonly QueueRow[]; onClose: () => void }) {
  const t = useT();
  const client = useEngine();
  const session = useTodaySession();
  const headingId = useId();
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [preview, setPreview] = useState<QueueSetPreview | null>(null);
  const [phase, setPhase] = useState<Phase>('pick');
  const [said, setSaid] = useState<{ line: string; receiptId?: string | undefined; problem?: boolean } | null>(null);
  const asked = useRef(0);
  const cancelRef = useRef<HTMLButtonElement>(null);

  async function work(ids: readonly string[]) {
    const mine = ++asked.current;
    if (ids.length === 0) { setPreview(null); return; }
    try {
      const next = await client.request('venture.queue.setPreview', { rowIds: [...ids] });
      if (mine === asked.current) setPreview(next);
    } catch (error) {
      if (mine === asked.current) { setPreview(null); setSaid({ line: refusalWords(error, t), problem: true }); }
    }
  }

  useEffect(() => { if (phase === 'confirm') cancelRef.current?.focus(); }, [phase]);

  // A row that left Today (decided elsewhere) or changed leaves the pick or is read again: the set is worked out anew,
  // so a stale set never goes out on an old digest.
  const live = rows.map((row) => `${row.id}@${row.digest}`).join(' ');
  useEffect(() => {
    if (phase !== 'pick' || picked.length === 0) return;
    const ids = new Set(rows.map((row) => row.id));
    const kept = picked.filter((id) => ids.has(id));
    if (kept.length !== picked.length) setPicked(kept);
    void work(kept);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  function toggle(id: string, on: boolean) {
    const next = on ? [...picked, id] : picked.filter((item) => item !== id);
    setPicked(next);
    setSaid(null);
    void work(next);
  }

  /** Open an item to read it beside the list; the engine marks this version read, so the set is worked out again. */
  async function read(row: QueueRow, origin: HTMLElement) {
    const ref = row.viewRef;
    if (!ref || ref.kind === 'run') return;
    try {
      await client.request('venture.queue.view', { kind: ref.kind, id: ref.id, opened: true });
    } catch (error) {
      setSaid({ line: refusalWords(error, t), problem: true });
      return;
    }
    const sheet = viewSheetId({ kind: ref.kind, id: ref.id });
    session.expect(sheet, seenKey(row));
    openSheet('view', sheet, origin);
    await work(picked);
  }

  async function approve(secondAsk: boolean) {
    if (!preview) return;
    setPhase('sending');
    setSaid(null);
    for (const id of picked) session.begin(id);
    try {
      const result = await client.request('venture.queue.set', secondAsk ? { rowIds: [...picked], digest: preview.digest, secondAsk: true } : { rowIds: [...picked], digest: preview.digest });
      result.decisions.forEach((decision, index) => {
        const row = rows.find((item) => item.id === picked[index]);
        if (row && decision.outcome === 'done') session.keep(row, decision.line, decision.receiptId);
      });
      setSaid({ line: result.line, receiptId: result.receiptId });
      setPhase('done');
    } catch (error) {
      const code = codeOf(error);
      setSaid({ line: code && WORDED[code] ? t(WORDED[code]!) : refusalWords(error, t), problem: true });
      setPhase('pick');
      await work(picked);
    } finally {
      for (const id of picked) session.end(id);
    }
  }

  const refusals = new Map((preview?.refusals ?? []).map((refusal) => [refusal.rowId, refusal]));
  const ready = preview !== null && preview.refusals.length === 0 && picked.length > 0 && phase === 'pick';
  const count = String(picked.length);

  return (
    <section className={s.box} aria-labelledby={headingId} data-set-picker="">
      <h3 id={headingId} className={s.boxHead}>{t('today.set.title')}</h3>
      <p className={s.hint}>{t('today.set.line')}</p>
      {phase !== 'done' && (
        <ul className={s.pickList}>
          {rows.map((row) => {
            const refusal = refusals.get(row.id);
            const on = picked.includes(row.id);
            return (
              <li key={row.id} className={s.pickItem} data-set-item={row.id}>
                <label className={s.pickLabel}>
                  <input type="checkbox" checked={on} disabled={phase !== 'pick'} onChange={(event) => toggle(row.id, event.currentTarget.checked)} />
                  <span className={s.pickWords}>
                    <span className={s.pickTitle}>{row.title}</span>
                    <span className={s.pickKind}>{stateText(t, 'queue', row.kind)}</span>
                  </span>
                </label>
                {on && refusal && (
                  <p className={s.refusal} data-set-refusal={refusal.reason}>
                    {WORDED[refusal.reason] ? t(WORDED[refusal.reason]!) : refusal.line}
                    {refusal.reason === 'VIEW_FIRST' && row.viewRef && row.viewRef.kind !== 'run' && (
                      <>{' '}<Button size="sm" onClick={(event) => void read(row, event.currentTarget)}>
                        {/* A draft to watch is opened with Watch, as on its card. */}
                        {row.actions.some((action) => action.id === 'watch') ? t('today.set.watch') : t('today.set.read')}
                      </Button></>
                    )}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {preview && phase !== 'done' && (
        <p className={s.total} data-set-total="">
          {t('today.set.total')}{' '}
          <Figure value={preview.total.display} receiptId={preview.total.receiptId} />
        </p>
      )}
      {phase === 'confirm' && (
        <div className={s.confirm}>
          <p className={s.ask}>{t('today.set.secondAsk', { count })}</p>
          <div className={s.boxButtons}>
            <Button ref={cancelRef} onClick={() => setPhase('pick')}>{t('approval.cancel')}</Button>
            <Button variant="primary" data-confirm="" onClick={() => void approve(true)}>{t('today.set.approve', { count })}</Button>
          </div>
        </div>
      )}
      {said && (
        <p className={said.problem ? s.problem : s.said} role="status">
          {said.line}
          {said.receiptId && <>{' '}<Receipt id={said.receiptId} /></>}
        </p>
      )}
      {phase !== 'confirm' && (
        <div className={s.boxButtons}>
          <Button onClick={onClose}>{phase === 'done' ? t('today.set.close') : t('approval.cancel')}</Button>
          {phase !== 'done' && (
            <Button
              variant="primary"
              disabled={phase === 'sending'}
              locked={!ready}
              lockedReason={picked.length === 0 ? t('today.set.pickFirst') : t('today.set.fixFirst')}
              onClick={() => { if (ready) (preview!.secondAsk ? setPhase('confirm') : void approve(false)); }}
            >
              {t('today.set.approve', { count })}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
