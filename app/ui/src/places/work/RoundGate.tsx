import { useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { refusalWords } from '../../parts/custody';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import type { QueueAction, QueueRow, RunDetail } from '../../engine/types';
import s from './Work.module.css';

/** The engine's longest note for the next step, in characters (delivery/run-controls.ts). */
const MAX_NOTE = 500;

/** Today's row for a run the round gate holds: the engine's own way to Continue or Stop it. */
export function gateRow(queue: readonly QueueRow[] | undefined, runId: string): QueueRow | undefined {
  return queue?.find((row) => row.viewRef?.kind === 'run' && row.viewRef.id === runId && row.actions.some((a) => a.id === 'continue'));
}

/**
 * The round gate on a waiting run's tile (spec 5.6, catalogue O2): the engine's line for the round it waits after
 * ("Round 2 is done: 3 tool calls, 1 failed."), a box for anything the agent should know in its next step (optional),
 * and the row's own Stop and Continue (or "Allow 2 more turns", as the engine labels it), decided through Today's row
 * with its digest so a changed row is never decided unseen. Nothing shows when the engine holds no gate here.
 */
export function RoundGate({ detail, row, onChanged }: { detail: RunDetail | undefined; row: QueueRow | undefined; onChanged?: () => void }) {
  const t = useT();
  const client = useEngine();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const waiting = detail?.gate?.waiting;
  if (!waiting) return null;
  const go = row?.actions.find((a) => a.id === 'continue');
  const stop = row?.actions.find((a) => a.id === 'stop');

  async function decide(current: QueueRow, action: QueueAction) {
    setBusy(true);
    setProblem(null);
    const words = note.trim();
    try {
      const params = action.id === 'continue' && words
        ? { id: current.id, digest: current.digest, action: action.id, viewed: false, answer: words }
        : { id: current.id, digest: current.digest, action: action.id, viewed: false };
      const decision = await client.request('venture.queue.decide', params);
      if (decision.outcome !== 'done') setProblem(t('work.gate.failed', { message: decision.line }));
      else setNote('');
      onChanged?.();
    } catch (error) {
      setProblem(t('work.gate.failed', { message: refusalWords(error, t) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="group" aria-label={waiting.line} className={s.gate}>
      <p className={s.gateLine}>{waiting.line}</p>
      {row && go && (
        <>
          <Field label={t('work.gate.note')} value={note} maxLength={MAX_NOTE} disabled={busy} onChange={(event) => setNote(event.currentTarget.value)} />
          <div className={s.gateActs}>
            {stop && <Button size="sm" disabled={busy} onClick={() => void decide(row, stop)}>{stop.label}</Button>}
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void decide(row, go)}>{go.label}</Button>
          </div>
        </>
      )}
      {problem && <p className={s.problem} role="status">{problem}</p>}
    </div>
  );
}
