import { useEffect, useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { ModelEstimate } from '../../parts/ModelEstimate';
import { Receipt } from '../../parts/Receipt';
import type { DeliveryLite, QueueRow, RunSummary } from '../../engine/types';
import { newestRun, previousFailure } from './orders';
import s from './Work.module.css';

const SEP = ' · ';
export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The engine's own error for each failed run. A run that stopped stays stopped, so each is read once. */
function useRunErrors(runIds: readonly string[]): Record<string, string> {
  const client = useEngine();
  const key = runIds.join('\n');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    for (const runId of key ? key.split('\n') : []) {
      client.request('venture.runs.get', { runId }).then(
        (run) => { if (live && run.error) setErrors((e) => (e[runId] === run.error ? e : { ...e, [runId]: run.error! })); },
        () => { /* the summary line stays */ },
      );
    }
    return () => { live = false; };
  }, [client, key]);
  return errors;
}

export interface PreviousRunsProps {
  runs: RunSummary[];
  /** Delivery runs, to tell a stopped run that was already run again from one that cannot be. */
  deliveries: DeliveryLite[] | undefined;
  /** Today's rows: a failed run is run again through its "Run again" row, the engine's retry path. */
  queue: QueueRow[] | undefined;
  onChanged: () => void;
}

/**
 * Runs, one line each (Previous, and an order's runs when it is focused). Done: "Worked for 4m · result · receipt"
 * (a model number says so and has no receipt). Failed: the engine's error in plain words, then Run again when the
 * engine offers it, or a line saying it can't be run again from here. Still going: started, or waiting on you.
 */
export function PreviousRuns({ runs, deliveries, queue, onChanged }: PreviousRunsProps) {
  const t = useT();
  const client = useEngine();
  const errors = useRunErrors(runs.filter((r) => r.state === 'failed').map((r) => r.runId));
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});

  const againRow = (runId: string) => queue?.find((row) => row.viewRef?.kind === 'run' && row.viewRef.id === runId && row.actions.some((a) => a.id === 'run-again'));
  const superseded = (runId: string) => {
    const delivery = deliveries?.find((d) => d.id === runId);
    return !!delivery && newestRun(delivery.orderId, deliveries ?? [])?.id !== runId;
  };

  async function runAgain(run: RunSummary, row: QueueRow) {
    setBusy(run.runId);
    setProblems(({ [run.runId]: _gone, ...rest }) => rest);
    try {
      const decision = await client.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'run-again' });
      if (decision.outcome !== 'done') setProblems((p) => ({ ...p, [run.runId]: t('work.failed.again', { message: decision.line }) }));
      onChanged();
    } catch (error) {
      setProblems((p) => ({ ...p, [run.runId]: t('work.failed.again', { message: messageOf(error) }) }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className={s.list}>
      {runs.map((run) => {
        const row = run.state === 'failed' ? againRow(run.runId) : undefined;
        return (
          <li key={run.runId} className={s.item} data-row="" data-row-id={`run-${run.runId}`} tabIndex={-1}>
            <span className={s.who}>{run.agent}</span>
            <button type="button" className={`${s.what} ${s.open}`} data-open="" onClick={(event) => openSheet('run', run.runId, event.currentTarget)}>
              {run.purpose}
            </button>
            <div className={s.tail}>
              {run.state === 'failed' ? (
                <>
                  <span className={s.failure}>{previousFailure(run, errors[run.runId]) ?? t('run.stopped')}</span>
                  {row ? (
                    <span className={s.act}>
                      <Button data-key="primary" disabled={busy === run.runId} onClick={() => void runAgain(run, row)}>{t('run.again')}</Button>
                    </span>
                  ) : queue && !superseded(run.runId) ? (
                    <span className={s.quiet}>{t('work.noRetry')}</span>
                  ) : null}
                </>
              ) : run.state === 'waiting' ? (
                <span className={`${s.outcome} ${s.wait}`}>{t('run.waiting')}</span>
              ) : run.state === 'active' ? (
                <span className={s.outcome}>{t('run.started', { elapsed: run.elapsed })}</span>
              ) : (
                <span className={s.outcome}>
                  {t('run.workedFor', { elapsed: run.elapsed })}
                  {run.result !== undefined && <>{SEP}{run.estimate ? <ModelEstimate value={run.result} /> : run.result}</>}
                  {run.receiptId && !run.estimate && <>{SEP}<Receipt id={run.receiptId} /></>}
                </span>
              )}
            </div>
            {problems[run.runId] && <p className={s.problem} role="status">{problems[run.runId]}</p>}
          </li>
        );
      })}
    </ul>
  );
}
