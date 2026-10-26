import { Fragment, useState } from 'react';
import { useT } from '../text';
import { useEngine, useResource } from '../engine/context';
import { openSheet } from '../shell/navigation';
import { Avatar, type AvatarState } from './Avatar';
import { Button } from './Button';
import { Field } from './Field';
import { Icon } from './Icon';
import { ModelEstimate } from './ModelEstimate';
import { Receipt } from './Receipt';
import { Sheet } from './Sheet';
import { Steps } from './Steps';
import { evidenceLabel } from './evidence';
import type { QueueActionId, QueueRow, RunDetail, RunState, RunStep } from '../engine/types';
import s from './RunSheet.module.css';

type Evidence = NonNullable<RunStep['evidence']>[number];

/** The ring on the agent's avatar in the head, from the run's state; a finished run draws none. */
const RING: Record<RunState, AvatarState> = { active: 'working', waiting: 'waiting', failed: 'failed', done: 'idle' };

export interface RunSheetViewProps {
  run: RunDetail;
  onClose: () => void;
  returnFocus?: (() => void) | undefined;
  /** Open one piece of evidence: a transcript, a file, a check result, a receipt. */
  onEvidence?: ((evidence: Evidence) => void) | undefined;
  /** Answer the run's question. Left out, the question is shown without a way to answer here. */
  onAnswer?: ((text: string) => Promise<void>) | undefined;
  /** Run a failed run again. Left out, there is no Run again button: nothing pretends. */
  onRunAgain?: (() => void) | undefined;
}

/**
 * "Watch it work": one run, opened from Today, Team or Work. The agent's avatar carries the run's ring; the steps sit
 * on the inner grey (D-TeamDept `.run`); a stopped run says what went wrong in its own box, in the engine's words
 * (D-Work `.why`), with Run again under it.
 */
export function RunSheetView({ run, onClose, returnFocus, onEvidence, onAnswer, onRunAgain }: RunSheetViewProps) {
  const t = useT();
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);
  const evidence = run.steps.flatMap((step) => step.evidence ?? []);
  const finished = run.state === 'done';

  async function send(text: string) {
    if (!onAnswer || !text.trim()) return;
    setSending(true);
    try { await onAnswer(text.trim()); setAnswer(''); } finally { setSending(false); }
  }

  const result = run.result !== undefined && (
    <p className={s.result}>
      {run.estimate ? <ModelEstimate value={run.result} /> : (
        <>
          {run.result}
          {run.receiptId && <> <Receipt id={run.receiptId} /></>}
        </>
      )}
    </p>
  );

  return (
    <Sheet
      label={t('sheet.run')}
      eyebrow={t('run.header', { agent: run.agent, id: run.runId })}
      title={run.purpose}
      avatar={<Avatar name={run.agent} state={RING[run.state] ?? 'idle'} size={40} />}
      name={run.agent}
      line={finished ? undefined : (
        <>
          <span>{t('run.started', { elapsed: run.elapsed })}</span>
          {run.state === 'waiting' && <> · <span className={s.waiting}>{t('run.waiting')}</span></>}
        </>
      )}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      {finished ? (
        <div>
          <details className={s.fold} data-fold="worked">
            <summary>{t('run.workedFor', { elapsed: run.elapsed })}</summary>
            <Steps steps={run.steps} showTools />
          </details>
          {result}
        </div>
      ) : (
        <div className={s.run}>
          <Steps steps={run.steps} progress={run.progress} showTools />
        </div>
      )}

      {run.state === 'failed' && (
        <div className={s.stopped}>
          <div className={s.failure} data-failure="">
            <p className={s.wrongHead}>
              <Icon name="triangle-alert" size={14} />
              {t('sheet.wrong')}
            </p>
            <p className={s.wrongText}>{run.error ?? t('run.stopped')}</p>
          </div>
          {onRunAgain && (
            <div className={s.again}>
              <Button variant="primary" size="lg" onClick={onRunAgain}>
                <Icon name="rotate-ccw" size={16} />
                {t('run.again')}
              </Button>
            </div>
          )}
        </div>
      )}

      {!finished && run.state !== 'failed' && result}

      {run.question && !finished && (
        <section className={s.question} aria-label={t('run.question')}>
          <h3 className={s.small}>{t('run.question')}</h3>
          <p className={s.ask}>{run.question.text}</p>
          {onAnswer && (
            <>
              {run.question.choices && run.question.choices.length > 0 && (
                <div className={s.choices}>
                  {run.question.choices.map((choice) => (
                    <Button key={choice} disabled={sending} onClick={() => void send(choice)}>{choice}</Button>
                  ))}
                </div>
              )}
              <form className={s.answer} onSubmit={(event) => { event.preventDefault(); void send(answer); }}>
                <Field label={t('run.answerLabel')} value={answer} onChange={(event) => setAnswer(event.currentTarget.value)} />
                <div><Button variant="primary" type="submit" disabled={sending || !answer.trim()}>{t('run.send')}</Button></div>
              </form>
            </>
          )}
        </section>
      )}

      {evidence.length > 0 && (
        <p className={s.evidence}>
          {t('run.evidence')}:{' '}
          {evidence.map((item, i) => (
            <Fragment key={`${item.kind}:${item.id}`}>
              {i > 0 && ', '}
              {item.kind === 'check'
                ? <span>{evidenceLabel(item, (detail) => t('run.notChecked', { detail }))}</span>
                : <Button variant="quiet" className={s.link} onClick={() => onEvidence?.(item)}>{item.label}</Button>}
            </Fragment>
          ))}
        </p>
      )}

      {/* What the untrusted screen noted in outside content, as the engine words it; never the words it found. */}
      {run.screen && <p className={s.evidence} data-screen>{run.screen}</p>}
    </Sheet>
  );
}

/** The run sheet wired to the engine. A question is answered, and a failed run started again, through the queue row
 *  that points at this run; when there is none, the sheet does not offer either. */
export function RunSheet({ runId, onClose, returnFocus }: { runId: string; onClose: () => void; returnFocus?: (() => void) | undefined }) {
  const t = useT();
  const client = useEngine();
  const run = useResource('venture.runs.get', { runId }, { refreshOn: (event) => event.runId === runId || event.type === 'queue.changed' });
  const queue = useResource('venture.queue.list', { scope: 'all' }, { refreshOn: (event) => event.type === 'queue.changed' });
  const rowFor = (action: QueueActionId): QueueRow | undefined => queue.data?.rows.find((row) => row.viewRef?.kind === 'run' && row.viewRef.id === runId && row.actions.some((a) => a.id === action));
  const answerRow = rowFor('answer');
  const againRow = rowFor('run-again');

  if (!run.data) {
    return (
      <Sheet label={t('sheet.run')} title={run.error ? t('run.notFound') : t('sheet.loading')} onClose={onClose} returnFocus={returnFocus}>
        {run.error && <p className={s.failureText}>{run.error.message}</p>}
      </Sheet>
    );
  }
  const decide = async (row: QueueRow, action: QueueActionId, answer?: string) => {
    await client.request('venture.queue.decide', answer === undefined ? { id: row.id, digest: row.digest, action } : { id: row.id, digest: row.digest, action, answer });
    run.reload();
    queue.reload();
  };
  return (
    <RunSheetView
      run={run.data}
      onClose={onClose}
      returnFocus={returnFocus}
      onEvidence={(item) => openSheet(item.kind, item.id)}
      onAnswer={answerRow ? (text) => decide(answerRow, 'answer', text) : undefined}
      onRunAgain={againRow ? () => void decide(againRow, 'run-again') : undefined}
    />
  );
}
