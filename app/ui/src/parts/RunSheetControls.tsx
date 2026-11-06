import { useId, useState, type ReactNode } from 'react';
import { useT } from '../text';
import { refusalWords } from './custody';
import { Button } from './Button';
import { Field } from './Field';
import { Figure } from './Figure';
import { Icon } from './Icon';
import type { RunDetail } from '../engine/types';
import s from './RunSheetControls.module.css';

/** The engine's longest note for the next step, in characters (delivery/run-controls.ts). */
const MAX_NOTE = 500;

/**
 * The run sheet's run controls (W4 4F3; spec 5.6, catalogue O1, O3, O21, U7), each drawn only from what the engine
 * sends: the scope frozen when the run started (its line under the title, what it may do one step away), a stop on its
 * way or done in the engine's words with Resume, the calls of the turn in flight counted, and the steer box with the
 * owner's notes. The notes are the owner's own words, so they are quoted content; the line beside each is the engine's.
 */

/** The scope line with its spend cap as a figure with its receipt, cut once where the engine wrote the cap in it. */
function withCap(scope: NonNullable<RunDetail['scope']>): ReactNode {
  const at = scope.line.indexOf(scope.cap);
  if (at < 0 || !scope.capReceiptId) return scope.line;
  // The cap in rupees at the owner's own rate, when the engine sends it, beside the cap and proved by the same receipt.
  const rupees = scope.capRupees && scope.capRate
    ? <> (<Figure value={`${scope.capRupees} at ${scope.capRate}`} receiptId={scope.capReceiptId} />)</> : null;
  return <>{scope.line.slice(0, at)}<Figure value={scope.cap} receiptId={scope.capReceiptId} />{rupees}{scope.line.slice(at + scope.cap.length)}</>;
}

/** The scope line under the run's title, and its tools and outside actions in a fold (O21). Nothing without a scope. */
export function RunScope({ run }: { run: RunDetail }) {
  const t = useT();
  if (!run.scope) return null;
  const { scope } = run;
  return (
    <div className={s.scope}>
      <p className={s.scopeLine}>{withCap(scope)}</p>
      <details className={s.fold} data-fold="scope">
        <summary>{t('runsheet.scope.more')}</summary>
        {scope.tools.length > 0 && (
          <>
            <p className={s.small}>{t('runsheet.scope.tools')}</p>
            <ul className={s.list}>{scope.tools.map((tool, i) => <li key={i}>{tool}</li>)}</ul>
          </>
        )}
        {scope.actions.length > 0 && (
          <>
            <p className={s.small}>{t('runsheet.scope.actions')}</p>
            <ul className={s.list}>{scope.actions.map((action, i) => <li key={i}>{action}</li>)}</ul>
          </>
        )}
      </details>
    </div>
  );
}

/** A stop on its way or done, in the engine's words; a stopped run offers Resume when the sheet can resume it (O1). */
export function RunStopNote({ run, onResume }: { run: RunDetail; onResume?: (() => void | Promise<void>) | undefined }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!run.stop) return null;
  async function resume() {
    if (!onResume) return;
    setBusy(true);
    setProblem(null);
    try { await onResume(); } catch (error) {
      setProblem(t('runsheet.resumeFailed', { message: refusalWords(error, t) }));
    } finally { setBusy(false); }
  }
  const stopped = run.stop.state === 'stopped';
  return (
    <div className={s.stop} data-stop={run.stop.state}>
      <p className={s.stopHead}>
        <Icon name="clock" size={14} />
        {stopped ? t(run.interrupted ? 'work.stop.interrupted' : 'work.stop.chip') : t('work.stop.stopping')}
      </p>
      <p className={s.stopLine}>{run.stop.line}</p>
      {stopped && onResume && (
        <div className={s.acts}>
          <Button variant="primary" size="lg" disabled={busy} onClick={() => void resume()}>
            <Icon name="play" size={16} />
            {t('runsheet.resume')}
          </Button>
        </div>
      )}
      {problem && <p className={s.problem} role="status">{problem}</p>}
    </div>
  );
}

/** The calls of the turn in flight, counted from the engine's states (U7). Nothing when none is out. */
export function LiveCalls({ run }: { run: RunDetail }) {
  const t = useT();
  if (!run.live || run.live.length === 0) return null;
  const count = (state: 'start' | 'done' | 'error') => run.live!.filter((call) => call.state === state).length;
  return <p className={s.live}>{t('runsheet.calls', { done: count('done'), running: count('start'), failed: count('error') })}</p>;
}

/**
 * "Tell Editor something for its next step" (O3): at most 500 characters, sent to the engine, which screens it and
 * keeps it for the next turn, once. Shown on a run still going or stopped, never on one done or failed.
 */
export function SteerBox({ run, onSteer }: { run: RunDetail; onSteer?: ((text: string) => Promise<void>) | undefined }) {
  const t = useT();
  const notesId = useId();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const open = run.state === 'active' || run.state === 'waiting';
  if (!open || (!onSteer && !run.steer?.length)) return null;

  async function send() {
    const words = text.trim();
    if (!onSteer || !words) return;
    setSending(true);
    setProblem(null);
    try {
      await onSteer(words);
      setText('');
    } catch (error) {
      setProblem(t('runsheet.steer.failed', { message: refusalWords(error, t) }));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className={s.steer} aria-labelledby={run.steer?.length ? notesId : undefined}>
      {run.steer && run.steer.length > 0 && (
        <>
          <h3 id={notesId} className={s.small}>{t('runsheet.steer.notes')}</h3>
          <ul className={s.notes}>
            {run.steer.map((note, i) => (
              <li key={`${note.at}:${i}`} className={s.note}>
                <q className={s.quote} data-content="">{note.text}</q>
                <span className={s.noteLine}>{note.line}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {onSteer && (
        <form className={s.form} onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <Field
            multiline rows={2} label={t('runsheet.steer.label', { agent: run.agent })} value={text} maxLength={MAX_NOTE} disabled={sending}
            onChange={(event) => setText(event.currentTarget.value)}
          />
          <div className={s.acts}>
            <Button type="submit" disabled={sending || !text.trim()}>
              <Icon name="send" size={16} />
              {t('runsheet.steer.send', { agent: run.agent })}
            </Button>
          </div>
          {problem && <p className={s.problem} role="status">{problem}</p>}
        </form>
      )}
    </section>
  );
}
