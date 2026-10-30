import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Icon } from '../../parts/Icon';
import type { QueueAction, QueueRow } from '../../engine/types';
import s from './Work.module.css';
import {actionWords} from '../today/OutreachRows';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Today's row that runs a failed run again, the engine's own retry path, when it still offers one. */
export function againRow(queue: readonly QueueRow[] | undefined, runId: string): QueueRow | undefined {
  return queue?.find((row) => row.viewRef?.kind === 'run' && row.viewRef.id === runId && row.actions.some((a) => a.id === 'run-again'));
}

export interface RunAgain {
  /** The row's "Run again" action as the engine sends it, when there is a row. */
  action: QueueAction | undefined;
  /** Opening the run (its sheet) counts as having looked at it, for an action the engine unlocks only then. */
  opened: () => void;
  /** The button with why it is locked; nothing while the second ask is open, or when there is no row. */
  controls: ReactNode;
  /** The second ask, while it is open: "This can't be undone. Run again?", Not now and the action again. */
  ask: ReactNode;
  /** What went wrong when it was asked to run again, if anything did. */
  problem: ReactNode;
}

/**
 * Run again for a failed run, through Today's row for it (venture.queue.decide with the row's digest). It honours the
 * action as the engine sends it: its own label, a second ask when `secondAsk` is set ("This can't be undone. Run
 * again?", Not now first in focus), and a lock until the run was opened here when `requiresView` is set; the decision
 * says whether it was. A new version of the row (a new digest) has to be opened again and closes an open second ask.
 * `prominent` is the failed run's tile (the large primary with its icon, and the lock's reason in words beside it); a
 * list row has the small plain button, its lock's reason read with it. `buttonSize`: a stopped run's tile (W4 4F3)
 * keeps the plain button at the tile's large size, beside Resume, its primary.
 */
export function useRunAgain(row: QueueRow | undefined, onChanged: () => void, prominent = false, buttonSize?: 'sm' | 'lg'): RunAgain {
  const t = useT();
  const client = useEngine();
  const noteId = useId();
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'busy'>('idle');
  const [viewed, setViewed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const againRef = useRef<HTMLButtonElement>(null);
  const backToAgain = useRef(false);
  const action = row?.actions.find((a) => a.id === 'run-again');

  useEffect(() => {
    setViewed(false);
    setPhase((now) => (now === 'confirm' ? 'idle' : now));
  }, [row?.digest]);

  useEffect(() => {
    if (phase === 'confirm') cancelRef.current?.focus();
    else if (phase === 'idle' && backToAgain.current) {
      backToAgain.current = false;
      againRef.current?.focus();
    }
  }, [phase]);

  async function send(current: QueueRow, chosen: QueueAction) {
    setPhase('busy');
    setProblem(null);
    try {
      const decision = await client.request('venture.queue.decide', { id: current.id, digest: current.digest, action: chosen.id, viewed });
      if (decision.outcome !== 'done') setProblem(t('work.failed.again', { message: decision.line }));
      onChanged();
    } catch (error) {
      setProblem(t('work.failed.again', { message: messageOf(error) }));
    } finally {
      setPhase('idle');
    }
  }

  const opened = () => setViewed(true);
  const shownProblem = problem ? <p className={s.problem} role="status">{problem}</p> : null;
  if (!row || !action) return { action, opened, controls: null, ask: null, problem: shownProblem };
  const label = actionWords(action.label, t);

  const locked = Boolean(action.requiresView && !viewed);
  const size = buttonSize ?? (prominent ? 'lg' : 'sm');
  if (phase === 'confirm') {
    const ask = (
      <div className={s.confirm}>
        <p className={s.ask}>{t('approval.secondAsk', { action: label })}</p>
        <Button ref={cancelRef} size={size} onClick={() => { backToAgain.current = true; setPhase('idle'); }}>{t('approval.cancel')}</Button>
        <Button variant="primary" size={size} data-confirm="" onClick={() => void send(row, action)}>{label}</Button>
      </div>
    );
    return { action, opened, controls: null, ask, problem: shownProblem };
  }
  const controls = (
    <>
      <Button
        ref={againRef} variant={prominent ? 'primary' : 'secondary'} size={size} data-key="primary" disabled={phase === 'busy'}
        locked={locked} lockedReason={t('approval.unlock', { action: label })} lockedNoteId={noteId}
        onClick={() => { if (!locked) { if (action.secondAsk) setPhase('confirm'); else void send(row, action); } }}
      >
        {prominent && <Icon name="rotate-ccw" size={16} />}
        {label}
      </Button>
      {locked && <span id={noteId} className={prominent ? s.quiet : 'sr-only'}>{t('approval.unlockOpen', { action: label })}</span>}
    </>
  );
  return { action, opened, controls, ask: null, problem: shownProblem };
}
