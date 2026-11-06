import { useId } from 'react';
import { useT } from '../../text';
import { openSheet } from '../../shell/navigation';
import { Chip } from '../../parts/Chip';
import { Icon } from '../../parts/Icon';
import { Steps } from '../../parts/Steps';
import { Tile } from '../../parts/Tile';
import type { DeliveryLite, QueueRow, RunDetail, RunSummary } from '../../engine/types';
import { previousFailure } from './orders';
import { superseded, useRunDetails } from './PreviousRuns';
import { againRow, useRunAgain } from './RunAgain';
import s from './Work.module.css';

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
  const titleId = useId();
  const again = useRunAgain(row, onChanged, true);
  const steps = detail?.steps ?? [];
  // Where it failed is the failed step's place in the engine's own list, counted; nothing is worked out beyond that.
  const at = steps.findIndex((step) => step.state === 'failed');
  const meta = [run.agent, business, t('work.failedRun.run', { id: run.runId }), run.elapsed].filter(Boolean).join(' · ');

  return (
    <Tile as="li" labelledBy={titleId} tone="fail" card className={s.stopTile}>
      <div className={s.stopHead}>
        <span className={s.stopMark} aria-hidden="true"><Icon name="triangle-alert" size={18} /></span>
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
        <Chip tone="fail" className={s.stopChip}>
          {at >= 0 ? t('work.failedRun.at', { step: at + 1, total: steps.length }) : t('work.failedRun.chip')}
        </Chip>
      </div>
      <div className={s.why}>
        <p className={s.whyLabel}>{t('work.failedRun.why')}</p>
        <p className={s.whyText}>{previousFailure(run, detail?.error) ?? t('work.failedRun.noReason')}</p>
      </div>
      {steps.length > 0 && <Steps steps={steps} />}
      {(again.action || noRetry) && (
        <div className={s.stopActs}>
          {again.action ? <>{again.controls}{again.ask}</> : <p className={s.quiet}>{t('work.noRetry')}</p>}
        </div>
      )}
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
}

/**
 * The failed runs, on D's `.stopped` tile: each says where it failed ("Failed at step 2 of 3"), what went wrong in the
 * engine's own words, its steps, and Run again, which decides Today's "Run again" row (the engine's retry path) as the
 * action asks (its label, a second ask, a look first). A run the engine offers no way to run again says so instead.
 * "Stopped" is kept for the owner's own Stop (W4 4F). The fix-it help, "Run again keeps step 1" and the frames it had
 * picked wait for the engine's run controls and previews (W4 4F, 4J).
 */
export function StoppedRuns({ runs, names, deliveries, queue, onChanged }: StoppedRunsProps) {
  const t = useT();
  const id = useId();
  const details = useRunDetails(runs);
  return (
    <section aria-labelledby={id} className={s.block}>
      <h2 id={id} className="sr-only">{t('work.failedRun.heading')}</h2>
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
