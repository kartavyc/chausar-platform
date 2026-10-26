import { useId, useRef, useState } from 'react';
import { useT, type T } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { refusalWords } from '../../parts/custody';
import { Button } from '../../parts/Button';
import { Chip } from '../../parts/Chip';
import { Icon } from '../../parts/Icon';
import { Steps } from '../../parts/Steps';
import { Tile } from '../../parts/Tile';
import { cx } from '../../parts/cx';
import type { DeliveryLite, QueueRow, RunDetail, RunSummary } from '../../engine/types';
import { previousFailure } from './orders';
import { superseded, useRunDetails } from './PreviousRuns';
import { againRow, useRunAgain } from './RunAgain';
import s from './Work.module.css';

/** A run the engine stopped (the owner, a breaker, a crash) and that waits for Resume; never a failed one. */
export const isStopped = (run: RunSummary) => run.stop?.state === 'stopped';

/**
 * "How to fix it" in the screen's own words for the engine's fix code, so it reads in Hindi too; the engine's own
 * words where the fix carries a date or a name only the engine knows (the day the month's limit starts again).
 */
export function fixWords(t: T, detail: Pick<RunDetail, 'fix' | 'fixKind'> | undefined): string | undefined {
  if (!detail?.fix) return undefined;
  return detail.fixKind && detail.fixKind !== 'raise-limit' ? t(`work.fix.${detail.fixKind}`) : detail.fix;
}

/** 4Z2: the fix codes that name a missing tool, said as what is missing (the fix stays under How to fix it). */
const TOOL_CAUSES: ReadonlySet<string> = new Set(['install-ffmpeg', 'set-up-docker', 'get-python-image', 'set-up-cli']);

/**
 * A failed run's failure in the owner's plain words, from the engine's codes: the failure's kind (the engine's words
 * for a tool by name), or, 4Z2, the missing tool its fix code names ("The video tool isn't installed on this computer
 * yet."). Undefined when the engine sends no code the screen knows.
 */
export function plainFailure(t: T, detail: Pick<RunDetail, 'failure' | 'fixKind'> | undefined): string | undefined {
  const failure = detail?.failure;
  if (failure) return failure.kind === 'out-of-date' ? failure.line : t(`work.failure.${failure.kind}`);
  if (detail?.fixKind && TOOL_CAUSES.has(detail.fixKind)) return t(`work.cause.${detail.fixKind}`);
  return undefined;
}

/** What went wrong on a failed run: its plain words, else the engine's error. */
function failureWords(t: T, run: RunSummary, detail: RunDetail | undefined): string | undefined {
  return plainFailure(t, detail) ?? previousFailure(run, detail?.error);
}

interface StoppedRunProps {
  run: RunSummary;
  detail: RunDetail | undefined;
  business: string | undefined;
  /** Today's "Run again" row for it, when the engine still offers one. */
  row: QueueRow | undefined;
  /** Say plainly that it cannot be run again from here (Today has loaded, and no newer run replaced it). */
  noRetry: boolean;
  onChanged: () => void;
}

function StoppedRun({ run, detail, business, row, noRetry, onChanged }: StoppedRunProps) {
  const t = useT();
  const client = useEngine();
  const titleId = useId();
  const fixId = useId();
  const stopped = isStopped(run);
  const again = useRunAgain(row, onChanged, !stopped, stopped ? 'lg' : undefined);
  const [fixOpen, setFixOpen] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [said, setSaid] = useState<{ line: string; problem: boolean } | null>(null);
  const headRef = useRef<HTMLDivElement>(null);
  // While the owner has paused the business, Resume would be refused: the tile's primary unpauses first.
  const venture = useResource('venture.get', {}, { refreshOn: (event) => event.type === 'queue.changed', skip: !stopped });
  const paused = stopped && !!venture.data?.paused;
  const steps = detail?.steps ?? [];
  const trigger = run.stop?.trigger;
  const interrupted = stopped && !!detail?.interrupted;
  // Where it stopped or failed is that step's place in the engine's own list, counted; nothing is worked out beyond it.
  const at = steps.findIndex((step) => step.state === (stopped ? 'waiting' : 'failed'));
  const meta = [run.agent, business, t('work.failedRun.run', { id: run.runId }), run.elapsed].filter(Boolean).join(' · ');
  const red = !stopped || !!trigger;
  const chip = !stopped
    ? (at >= 0 ? t('work.failedRun.at', { step: at + 1, total: steps.length }) : t('work.failedRun.chip'))
    : interrupted
      ? (at >= 0 ? t('work.stop.interruptedAt', { step: at + 1, total: steps.length }) : t('work.stop.interrupted'))
      : (at >= 0 ? t('work.stop.at', { step: at + 1, total: steps.length }) : t('work.stop.chip'));
  const whyLabel = !stopped ? t('work.failedRun.why') : trigger ? t(`work.stop.trigger.${trigger}`) : t('work.stop.why');
  const why = stopped ? run.stop!.line : failureWords(t, run, detail) ?? t('work.failedRun.noReason');
  // 4Z2: with plain words for the failure, the engine's technical line is one step away, under Details.
  const plain = !stopped ? plainFailure(t, detail) : undefined;
  const technical = plain ? detail?.error ?? steps.find((step) => step.state === 'failed')?.error : undefined;
  const fix = fixWords(t, detail);
  // Run again's second ask brings its own primary: the tile's other buttons wait until it closes.
  const asking = !!again.ask;

  /** The tile after this one on the page (else the one before, else the page's title), for the focus once it leaves. */
  function nextPlace(): HTMLElement | null {
    const tile = headRef.current?.closest('li');
    const tiles = [...document.querySelectorAll<HTMLElement>('main li [data-open]')];
    const own = tiles.findIndex((button) => tile?.contains(button));
    const others = tiles.filter((button) => !tile?.contains(button));
    return (own >= 0 ? tiles.slice(own + 1).find((b) => !tile?.contains(b)) : undefined) ?? others[others.length - 1] ?? document.querySelector<HTMLElement>('main h1');
  }

  async function resume() {
    setResuming(true);
    setSaid(null);
    const next = nextPlace();
    try {
      const result = await client.request('venture.runs.resume', { runId: run.runId });
      setSaid({ line: result.line, problem: false });
      // The resumed run leaves the stopped tiles: the focus goes on to the next tile, not lost to the page.
      if (next && !next.hasAttribute('tabindex') && next.tagName === 'H1') next.setAttribute('tabindex', '-1');
      next?.focus();
      onChanged();
    } catch (error) {
      setSaid({ line: t('work.stop.resumeFailed', { message: refusalWords(error, t) }), problem: true });
    } finally {
      setResuming(false);
    }
  }

  async function unpause() {
    setResuming(true);
    setSaid(null);
    try {
      await client.request('venture.business.pause', { paused: false });
      venture.reload();
      onChanged();
    } catch (error) {
      setSaid({ line: t('work.stop.resumeFailed', { message: refusalWords(error, t) }), problem: true });
    } finally {
      setResuming(false);
    }
  }

  return (
    <Tile as="li" labelledBy={titleId} tone={red ? 'fail' : 'wait'} card className={s.stopTile}>
      <div className={s.stopHead} ref={headRef}>
        <span className={cx(s.stopMark, !red && s.stopMarkWait)} aria-hidden="true"><Icon name={red ? 'triangle-alert' : 'clock'} size={18} /></span>
        <div className={s.stopWho}>
          <h3 id={titleId} className={s.stopTitle}>
            <button
              type="button" className={s.titleButton} data-open=""
              onClick={(event) => { again.opened(); openSheet('run', run.runId, event.currentTarget); }}
            >
              {run.purpose}
            </button>
          </h3>
          <p className={s.stopMeta}>{meta}</p>
        </div>
        <Chip tone={red ? 'fail' : 'wait'} className={s.stopChip}>{chip}</Chip>
      </div>
      <div className={cx(s.why, !red && s.whyWait)}>
        <p className={cx(s.whyLabel, !red && s.whyLabelWait)}>{whyLabel}</p>
        <p className={s.whyText}>{why}</p>
        {technical && (
          <details className={s.whyMore}>
            <summary>{t('work.failedRun.details')}</summary>
            <p className={s.whyTech}>{technical}</p>
          </details>
        )}
      </div>
      {fix && fixOpen && (
        <div id={fixId} className={s.fix}>
          <p className={s.fixLabel}>{t('work.fix.button')}</p>
          <p className={s.whyText}>{fix}</p>
        </div>
      )}
      {steps.length > 0 && <Steps steps={steps} waitingWord={stopped ? t('work.stop.waitsResume') : undefined} errors={!plain} />}
      {(again.action || noRetry || fix || stopped) && (
        <div className={s.stopActs}>
          {again.action ? <>{again.controls}{again.ask}</> : noRetry && !stopped ? <p className={s.quiet}>{t('work.noRetry')}</p> : null}
          {fix && !asking && (
            <Button size="lg" aria-expanded={fixOpen} aria-controls={fixOpen ? fixId : undefined} onClick={() => setFixOpen((open) => !open)}>
              <Icon name="wrench" size={16} />
              {t('work.fix.button')}
            </Button>
          )}
          {stopped && !asking && (paused ? (
            <Button variant="primary" size="lg" disabled={resuming} onClick={() => void unpause()}>{t('work.stop.unpauseFirst')}</Button>
          ) : (
            <Button variant="primary" size="lg" disabled={resuming} onClick={() => void resume()}>
              <Icon name="play" size={16} />
              {t('work.stop.resume')}
            </Button>
          ))}
        </div>
      )}
      {said && <p className={said.problem ? s.problem : s.stopSaid} role="status">{said.line}</p>}
      {again.problem}
    </Tile>
  );
}

export interface StoppedRunsProps {
  runs: RunSummary[];
  names: ReadonlyMap<string, string>;
  deliveries: DeliveryLite[] | undefined;
  queue: QueueRow[] | undefined;
  onChanged: () => void;
  /** Which list this is: the failed runs (the default), or the stopped ones (W4 4F3). */
  kind?: 'failed' | 'stopped';
}

/**
 * The failed runs, on D's `.stopped` tile: each says where it failed ("Failed at step 2 of 3"), what went wrong in the
 * engine's words (a failure's kind in the screen's own words), its steps, How to fix it when the engine sends a fix,
 * and Run again, which decides Today's "Run again" row (the engine's retry path) as the action asks (its label, a
 * second ask, a look first). A run the engine offers no way to run again says so instead.
 *
 * W4 4F3: the stopped runs use the same tile. A stop the owner asked for, or Chausar's (the repeat-failure breaker, a
 * crash that cut a step), waits for Resume: "Stopped at step 2 of 3" or "Interrupted at step 2 of 3", why in the
 * engine's words (a breaker names its trigger in the screen's words above them), How to fix it, Run again, and Resume
 * as the one primary. A stop is never a failure: the red line is kept for the breaker and for failed runs.
 */
export function StoppedRuns({ runs, names, deliveries, queue, onChanged, kind = 'failed' }: StoppedRunsProps) {
  const t = useT();
  const id = useId();
  const details = useRunDetails(runs);
  return (
    <section aria-labelledby={id} className={s.block}>
      <h2 id={id} className="sr-only">{t(kind === 'stopped' ? 'work.stop.heading' : 'work.failedRun.heading')}</h2>
      <ul className={s.stoppedList}>
        {runs.map((run) => (
          <StoppedRun
            key={run.runId} run={run} detail={details[run.runId]} business={names.get(run.businessId)} row={againRow(queue, run.runId)}
            noRetry={!!queue && !superseded(run.runId, deliveries)} onChanged={onChanged}
          />
        ))}
      </ul>
    </section>
  );
}
