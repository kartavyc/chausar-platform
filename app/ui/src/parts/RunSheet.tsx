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
// W4 4F3: the scope line, a stop's note, the calls in flight and the steer box.
import { LiveCalls, RunScope, RunStopNote, SteerBox } from './RunSheetControls';
// W4 4G4: "3 things need you (1 of 3)" with jumps.
import { RunNeeds } from './RunNeeds';
// W4 4J19: the Delivered card (A17) and an agent's question card (4J17).
import { DeliveredCard } from './DeliveredCard';
import { QuestionCardView } from './QuestionCard';
// W4 4J22a: coverage, not run, the outcome, the three-column report, a question's expiry and an interruption.
import { QuestionExpiry, RunQuality } from './RunQuality';
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
  /** W4 4F3: a note for the agent's next step (venture.runs.steer). Left out, there is no steer box. */
  onSteer?: ((text: string) => Promise<void>) | undefined;
  /** W4 4F3: resume a stopped run (venture.runs.resume). Left out, there is no Resume here. */
  onResume?: (() => void | Promise<void>) | undefined;
  /** W4 4G4: what this run waits on the owner for, when that is more than one thing ("3 things need you (1 of 3)"). */
  needs?: readonly QueueRow[] | undefined;
  /** W4 4J19: Make a copy of a draft that went out (venture.delivery.copy). Left out, the Delivered card offers none. */
  onCopy?: (() => Promise<void>) | undefined;
  /** W4 4J22a: when the run's question ends unanswered (its Today row's meta), for "Expires in 3 h". */
  questionExpiresAt?: string | undefined;
}

/**
 * "Watch it work": one run, opened from Today, Team or Work. The agent's avatar carries the run's ring; the steps sit
 * on the inner grey (D-TeamDept `.run`); a stopped run says what went wrong in its own box, in the engine's words
 * (D-Work `.why`), with Run again under it.
 */
export function RunSheetView({ run, onClose, returnFocus, onEvidence, onAnswer, onRunAgain, onSteer, onResume, needs, onCopy, questionExpiresAt }: RunSheetViewProps) {
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
          {run.stop ? <> · <span className={s.waiting}>{t(run.stop.state === 'stopping' ? 'work.stop.stopping' : run.interrupted ? 'work.stop.interrupted' : 'work.stop.chip')}</span></>
            : run.state === 'waiting' && <> · <span className={s.waiting}>{t('run.waiting')}</span></>}
          {/* 4F3 (U6): how long runs of these steps usually take, only once the engine has measured three. */}
          {run.usually && <> · <span>{run.usually}</span></>}
        </>
      )}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      <RunScope run={run} />
      {/* W4 4G4: several things wait on the owner: the count, and a jump to each on the approval page. */}
      {needs && <RunNeeds rows={needs} />}
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
          <Steps steps={run.steps} progress={run.progress} showTools waitingWord={run.stop?.state === 'stopped' ? t('work.stop.waitsResume') : undefined} />
        </div>
      )}
      {!finished && <LiveCalls run={run} />}
      <RunStopNote run={run} onResume={onResume} />
      {run.delivered && <DeliveredCard delivered={run.delivered} onCopy={onCopy} />}
      {/* W4 4J22a: coverage, the checks not run, the outcome and the report, from the engine's codes. */}
      <RunQuality run={run} />

      {run.state === 'failed' && (
        <div className={s.stopped}>
          <div className={s.failure} data-failure="">
            <p className={s.wrongHead}>
              <Icon name="triangle-alert" size={14} />
              {t('sheet.wrong')}
            </p>
            <p className={s.wrongText}>{run.error ?? t('run.stopped')}</p>
            {/* W4 4F3: the engine's fix, in the screen's words for its code (its own words where they carry a date). */}
            {run.fix && (
              <>
                <p className={s.wrongHead}>{t('work.fix.button')}</p>
                <p className={s.wrongText}>{run.fixKind && run.fixKind !== 'raise-limit' ? t(`work.fix.${run.fixKind}`) : run.fix}</p>
              </>
            )}
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

      {/* A stopped run's result is its stop line, which its note above already says. */}
      {!finished && run.state !== 'failed' && !run.stop && result}

      {run.question && !finished && (
        <section className={s.question} aria-label={t('run.question')}>
          <h3 className={s.small}>{t('run.question')}</h3>
          <p className={s.ask}>{run.question.text}</p>
          <QuestionExpiry at={questionExpiresAt} />
          {run.question.card && <QuestionCardView card={run.question.card} onPick={onAnswer ? setAnswer : undefined} disabled={sending} />}
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

      <SteerBox run={run} onSteer={onSteer} />

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
      {/* W4 4H2 (U17): which engine wrote the run's draft, in the engine's words; nothing before an answer. */}
      {run.writtenBy && <p className={s.evidence} data-written-by="">{run.writtenBy}</p>}
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
  // W4 4G4: every Today row about this run, oldest first (one approval, three places: Today, here, the approval page).
  const needs = (queue.data?.rows ?? []).filter((row) => row.viewRef?.kind === 'run' && row.viewRef.id === runId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // W4 4J19: a practice draft is never copied (the engine refuses it, PRACTICE_DRAFT), so its Delivered card offers no copy.
  const drafts = useResource('venture.delivery.list', {}, { skip: !run.data?.delivered });
  const practice = drafts.data?.find((item) => item.id === runId)?.practice === true;

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
      onSteer={async (text) => { await client.request('venture.runs.steer', { runId, text }); run.reload(); }}
      onResume={async () => { await client.request('venture.runs.resume', { runId }); run.reload(); queue.reload(); }}
      needs={needs}
      onCopy={practice ? undefined : async () => { await client.request('venture.delivery.copy', { runId }); }}
      questionExpiresAt={answerRow?.meta?.expiresAt}
    />
  );
}
