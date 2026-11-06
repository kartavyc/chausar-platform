import { useId, type ReactNode, type Ref } from 'react';
import { useT } from '../../text';
import { openSheet } from '../../shell/navigation';
import { Avatar } from '../../parts/Avatar';
import { Button } from '../../parts/Button';
import { Icon } from '../../parts/Icon';
import { ProgressRing } from '../../parts/ProgressRing';
import { SectionHead, Tile } from '../../parts/Tile';
import { cx } from '../../parts/cx';
import { useWaitingWords, workedWords } from '../../parts/run-time';
import type { QueueRow, RunDetail, RunSummary } from '../../engine/types';
import { useRunDetails } from './PreviousRuns';
import { RoundGate, gateRow } from './RoundGate';
import { useStopRun } from './StopDialog';
import s from './Work.module.css';
import { Fold } from '../../parts/Fold';

/** The current step's mark: a quarter arc on a ring, drawn once and never turning (nothing loops). */
function StillArc() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" focusable="false" aria-hidden="true">
      <circle className={s.arcTrack} cx="10" cy="10" r="7.5" fill="none" />
      <path className={s.arcPart} d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5" fill="none" />
    </svg>
  );
}

interface RunTileProps { as?: 'li' | 'article'; run: RunSummary; detail: RunDetail | undefined; business: string | undefined; queue: readonly QueueRow[] | undefined; onChanged: (() => void) | undefined; primary: boolean }

export function RunTile({ as = 'li', run, detail, business, queue, onChanged, primary }: RunTileProps) {
  const t = useT();
  const titleId = useId();
  const waiting = run.state === 'waiting';
  const waitingWords = useWaitingWords();
  const waited = waiting ? waitingWords(run) : undefined;
  // W4 4F3: Stop and its dialog; a run the engine says is stopping reads Stopping until it says stopped.
  const stop = useStopRun(run, detail, onChanged);
  const stopping = run.stop?.state === 'stopping';
  const gate = detail?.gate?.waiting ? gateRow(queue, run.runId) : undefined;
  // C4 task 13: a run that waits with a draft to read opens that draft here, not on Today.
  const draftWaits = queue?.some((row) => row.kind === 'draft' && row.viewRef?.kind === 'draft' && row.viewRef.id === run.runId);
  const open = (origin: HTMLElement) => openSheet('run', run.runId, origin);
  // The step the engine says is in hand: the current one, or the one that waits on the owner, counted in its list.
  const steps = detail?.steps ?? [];
  const at = steps.findIndex((step) => step.state === (waiting ? 'waiting' : 'current'));
  return (
    <Tile as={as} labelledBy={titleId} pad="compact" card className={s.runTile}>
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
            {waited ?? t('run.waiting')}
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
        {/* C4 task 12: a run waiting on the owner says how long it has waited; the time it worked leaves that out. */}
        {!waiting && run.elapsed ? <span>{workedWords(run, t, 'work.run.foot')}</span> : <span />}
        {stopping ? <div className={s.runActs}><span className={s.stopping}>{t('work.stop.stopping')}</span><Fold summary={t('work.run.more')}>{stop.button}</Fold></div> : (
          <div className={s.runActs}>
            {/* While the round gate waits, its own Stop decides the run: the tile's Stop steps aside. */}
            {!detail?.gate?.waiting && <Fold summary={t('work.run.more')}>{stop.button}</Fold>}
            {/* Answer only when the engine sent a question to answer; otherwise the run is opened to see what it waits on.
                While the Stop dialog is open its own primary is the tile's one; a gate decides in its own box. */}
            {waiting && !stop.open && !detail?.gate?.waiting && (detail?.question
              ? <Button variant={primary ? 'primary' : 'secondary'} size="sm" onClick={(event) => open(event.currentTarget)}>{t('work.run.answer')}</Button>
              : draftWaits
                ? <Button variant={primary ? 'primary' : 'secondary'} size="sm" onClick={(event) => openSheet('draft', run.runId, event.currentTarget)}>{t('work.readDraft')}</Button>
                : <Button variant={primary ? 'primary' : 'secondary'} size="sm" onClick={(event) => open(event.currentTarget)}>{t('work.run.open')}</Button>)}
          </div>
        )}
      </div>
      {stop.panel}
      {!stop.open && <RoundGate detail={detail} row={gate} onChanged={onChanged} primary={primary} />}
    </Tile>
  );
}

/**
 * Running now (D's `.runs`): one tile per run that is going or waits on the owner, with the agent's initials ringed by
 * its state, the business, a ring of measured steps ("Working, no step count yet" when the engine cannot count them),
 * the purpose (which opens the run sheet), the step in hand from the engine, and "Run 31 · 4m". A run that waits says
 * which step waits, shows its question, and Answer opens the run sheet, where it is answered; with no question from
 * the engine, a plain Open does. The All view's head counts what runs and what failed ("3 running · 1 failed").
 * W4 4F3: each tile has Stop ("Stop run 31"), which opens its small dialog (StopDialog.tsx); a run the round gate holds
 * shows the gate's line and its Continue box (RoundGate.tsx), decided through Today's row for it.
 */
export function RunTiles({ runs, names, meta, queue, onChanged, primaryId, listRef, renderRows }: {
  runs: RunSummary[]; names: ReadonlyMap<string, string>; meta?: string | undefined; queue?: readonly QueueRow[] | undefined; onChanged?: (() => void) | undefined;
  primaryId?: string | undefined;
  listRef?: Ref<HTMLUListElement>;
  renderRows?: () => ReactNode;
}) {
  const t = useT();
  const id = useId();
  const details = useRunDetails(renderRows ? [] : runs);
  return (
    <section aria-labelledby={id} className={s.block}>
      <SectionHead id={id} title={t(runs.every(run => run.state === 'waiting') ? 'work.filter.waiting' : 'work.running')} meta={meta} />
      <ul ref={listRef} className={s.runs}>
        {renderRows ? renderRows() : runs.map((run) => <RunTile key={run.runId} run={run} detail={details[run.runId]} business={names.get(run.businessId)} queue={queue} onChanged={onChanged} primary={run.runId === primaryId} />)}
      </ul>
    </section>
  );
}
