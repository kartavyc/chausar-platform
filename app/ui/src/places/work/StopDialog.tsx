import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { refusalWords } from '../../parts/custody';
import { Button } from '../../parts/Button';
import type { RunDetail, RunSummary } from '../../engine/types';
import s from './Work.module.css';

export interface StopRun {
  /** "Stop", named "Stop run 31"; nothing on a run that is stopping, stopped, done or failed. */
  button: ReactNode;
  /** The small dialog it opens, then the engine's answer in its own words. */
  panel: ReactNode;
  /** The dialog is open: the card hides its own primary, so the dialog's is the one. */
  open: boolean;
  /** The panel holds something (the dialog, or the engine's answer), for a row that grows only then. */
  shown: boolean;
}

/** A run Stop applies to: going or waiting on the owner, and not already stopping or stopped (the engine's rule). */
export const stoppable = (run: RunSummary) => (run.state === 'active' || run.state === 'waiting') && !run.stop;

/**
 * Stop on a running run (spec 5.6, catalogue O1; D-Work `.rt-foot` Stop). The button opens a small dialog beside it:
 * Stop lets the step in progress finish and keeps every finished step; Force stop names the step it throws away and
 * asks once more. Not now, first in focus, closes it and puts focus back on Stop; so does Escape. The engine answers
 * with its own words ("Stop received...", or what a force stop lost), shown here as they come; the tile then reads
 * Stopping, then stopped, as the engine says. Nothing is stopped by the screen itself.
 */
export function useStopRun(run: RunSummary, detail: RunDetail | undefined, onChanged?: () => void): StopRun {
  const t = useT();
  const client = useEngine();
  const dialogId = useId();
  const titleId = useId();
  const [phase, setPhase] = useState<'closed' | 'ask' | 'force' | 'busy'>('closed');
  const [said, setSaid] = useState<{ line: string; problem: boolean } | null>(null);
  const stopRef = useRef<HTMLButtonElement>(null);
  const notNowRef = useRef<HTMLButtonElement>(null);
  const saidRef = useRef<HTMLParagraphElement>(null);
  const backToStop = useRef(false);
  // The engine's answer takes the focus once it is shown, so a screen reader hears what was done.
  useEffect(() => { if (said) saidRef.current?.focus(); }, [said]);

  useEffect(() => {
    if (phase === 'ask' || phase === 'force') notNowRef.current?.focus();
    else if (phase === 'closed' && backToStop.current) {
      backToStop.current = false;
      stopRef.current?.focus();
    }
  }, [phase]);

  const close = () => { backToStop.current = true; setPhase('closed'); };
  // The step in progress, as the engine lists it, for the words of what a force stop throws away.
  const step = detail?.steps.find((item) => item.state === 'current' || item.state === 'waiting')?.purpose;

  async function stop(force: boolean) {
    setPhase('busy');
    setSaid(null);
    try {
      const result = await client.request('venture.runs.stop', force ? { runId: run.runId, force: true } : { runId: run.runId });
      setSaid({ line: result.lost ? `${result.line} ${result.lost}` : result.line, problem: false });
      onChanged?.();
    } catch (error) {
      setSaid({ line: t('work.stop.failed', { message: refusalWords(error, t) }), problem: true });
    } finally {
      setPhase('closed');
    }
  }

  const open = phase === 'ask' || phase === 'force';
  // Force stop is for a run whose step is out right now (the engine's active run); a run that waits on the owner stops
  // at once anyway. While a stop is on its way (Stopping), Force stop stays offered.
  const out = run.state === 'active';
  const stopping = run.stop?.state === 'stopping' && out;
  const button = phase === 'busy' ? null : stoppable(run) ? (
    <Button
      ref={stopRef} size="sm" aria-label={t('work.stop.label', { id: run.runId })} aria-expanded={open} aria-controls={open ? dialogId : undefined}
      onClick={() => setPhase(open ? 'closed' : 'ask')}
    >
      {t('work.stop.button')}
    </Button>
  ) : stopping ? (
    <Button
      ref={stopRef} size="sm" aria-label={t('work.stop.forceLabel', { id: run.runId })} aria-expanded={open} aria-controls={open ? dialogId : undefined}
      onClick={() => setPhase(open ? 'closed' : 'force')}
    >
      {t('work.stop.force')}
    </Button>
  ) : null;

  const dialog = open ? (
    <div
      id={dialogId} role="dialog" aria-labelledby={titleId} className={s.stopDialog}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}
    >
      <p id={titleId} className={s.stopDialogTitle}>{t('work.stop.title', { id: run.runId })}</p>
      <p className={s.stopDialogLine}>
        {phase === 'force' ? t('work.stop.forceAsk', { step: step ?? run.purpose }) : t('work.stop.line')}
      </p>
      <div className={s.stopDialogActs}>
        <Button ref={notNowRef} size="sm" variant="quiet" onClick={close}>{t('approval.cancel')}</Button>
        {phase === 'ask' ? (
          <>
            {out && <Button size="sm" onClick={() => setPhase('force')}>{t('work.stop.force')}</Button>}
            <Button size="sm" variant="primary" data-confirm="" onClick={() => void stop(false)}>{t('work.stop.button')}</Button>
          </>
        ) : (
          <Button size="sm" variant="primary" data-confirm="" onClick={() => void stop(true)}>{t('work.stop.force')}</Button>
        )}
      </div>
    </div>
  ) : null;

  const panel = (
    <>
      {dialog}
      {said && <p ref={saidRef} tabIndex={-1} className={said.problem ? s.problem : s.stopSaid} role="status">{said.line}</p>}
    </>
  );
  return { button, panel, open, shown: open || said !== null };
}
