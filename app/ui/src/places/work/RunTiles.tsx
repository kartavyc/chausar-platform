import { useId } from 'react';
import { useT } from '../../text';
import { openSheet } from '../../shell/navigation';
import { Avatar } from '../../parts/Avatar';
import { Button } from '../../parts/Button';
import { Icon } from '../../parts/Icon';
import { ProgressRing } from '../../parts/ProgressRing';
import { SectionHead, Tile } from '../../parts/Tile';
import { cx } from '../../parts/cx';
import type { RunDetail, RunSummary } from '../../engine/types';
import { useRunDetails } from './PreviousRuns';
import s from './Work.module.css';

/** The current step's mark: a quarter arc on a ring, drawn once and never turning (nothing loops). */
function StillArc() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" focusable="false" aria-hidden="true">
      <circle className={s.arcTrack} cx="10" cy="10" r="7.5" fill="none" />
      <path className={s.arcPart} d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5" fill="none" />
    </svg>
  );
}

function RunTile({ run, detail, business }: { run: RunSummary; detail: RunDetail | undefined; business: string | undefined }) {
  const t = useT();
  const titleId = useId();
  const waiting = run.state === 'waiting';
  const open = (origin: HTMLElement) => openSheet('run', run.runId, origin);
  // The step the engine says is in hand: the current one, or the one that waits on the owner, counted in its list.
  const steps = detail?.steps ?? [];
  const at = steps.findIndex((step) => step.state === (waiting ? 'waiting' : 'current'));
  return (
    <Tile as="li" labelledBy={titleId} pad="compact" card className={s.runTile}>
      <div className={s.runTop}>
        <Avatar name={run.agent} state={waiting ? 'waiting' : 'working'} size={40} />
        <div className={s.runWho}>
          <p className={s.runAgent}>{run.agent}</p>
          {business && <p className={s.runBusiness}>{business}</p>}
        </div>
        {run.progress && <ProgressRing progress={run.progress} tone={waiting ? 'waiting' : 'working'} />}
      </div>
      <h3 id={titleId} className={s.runTitle}>
        <button type="button" className={s.titleButton} data-open="" onClick={(event) => open(event.currentTarget)}>{run.purpose}</button>
      </h3>
      {waiting ? (
        <>
          <p className={cx(s.runStep, s.wait)}>
            <Icon name="clock" size={14} />
            {at >= 0 ? t('work.run.waitsAt', { step: at + 1, total: steps.length }) : t('run.waiting')}
          </p>
          {detail?.question && (
            <p className={s.question}>
              <Icon name="circle-help" size={14} />
              <span>{detail.question.text}</span>
            </p>
          )}
        </>
      ) : at >= 0 ? (
        <p className={s.runStep}><StillArc />{steps[at]!.purpose}</p>
      ) : null}
      <div className={s.runFoot}>
        <span className="mono">{t('work.run.foot', { id: run.runId, elapsed: run.elapsed })}</span>
        {/* Answer only when the engine sent a question to answer; otherwise the run is opened to see what it waits on. */}
        {waiting && (detail?.question
          ? <Button variant="primary" size="sm" onClick={(event) => open(event.currentTarget)}>{t('work.run.answer')}</Button>
          : <Button size="sm" onClick={(event) => open(event.currentTarget)}>{t('work.run.open')}</Button>)}
      </div>
    </Tile>
  );
}

/**
 * Running now (D's `.runs`): one tile per run that is going or waits on the owner, with the agent's initials ringed by
 * its state, the business, a ring of measured steps ("Working, no step count yet" when the engine cannot count them),
 * the purpose (which opens the run sheet), the step in hand from the engine, and "Run 31 · 4m". A run that waits says
 * which step waits, shows its question, and Answer opens the run sheet, where it is answered; with no question from
 * the engine, a plain Open does. The All view's head counts what runs and what failed ("3 running · 1 failed"). There
 * is no Stop yet: run controls come with the engine's (W4 4F), and so do frames and previews on the tiles (W4 4J).
 */
export function RunTiles({ runs, names, meta }: { runs: RunSummary[]; names: ReadonlyMap<string, string>; meta?: string | undefined }) {
  const t = useT();
  const id = useId();
  const details = useRunDetails(runs);
  return (
    <section aria-labelledby={id} className={s.block}>
      <SectionHead id={id} title={t('work.running')} meta={meta} />
      <ul className={s.runs}>
        {runs.map((run) => <RunTile key={run.runId} run={run} detail={details[run.runId]} business={names.get(run.businessId)} />)}
      </ul>
    </section>
  );
}
