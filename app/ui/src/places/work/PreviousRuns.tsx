import { useEffect, useId, useState, type ReactNode } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { Avatar, type AvatarState } from '../../parts/Avatar';
import { ModelEstimate } from '../../parts/ModelEstimate';
import { Receipt } from '../../parts/Receipt';
import { Row } from '../../parts/Row';
import { Tile, TileHead } from '../../parts/Tile';
import { tookWords, useWaitingWords, workedWords } from '../../parts/run-time';
import { useDayKey, useLocalToday, useMoment } from '../../parts/when';
import type { DeliveryLite, QueueRow, RunDetail, RunState, RunSummary } from '../../engine/types';
import { newestRun, previousFailure } from './orders';
import { againRow, useRunAgain } from './RunAgain';
import s from './Work.module.css';

const SEP = ' · ';


/** The ring each run's state draws around its agent: working, waiting on you, stopped; a finished run has none. */
export const RINGS: Readonly<Record<RunState, AvatarState>> = { active: 'working', waiting: 'waiting', failed: 'failed', done: 'idle' };

/**
 * Each run's own detail from the engine (venture.runs.get): its steps, its question, its error. Read again whenever
 * the run's summary moves (state, progress or time), so the current step stays the engine's; a run that stopped stays
 * stopped, so it is read once. A run the engine cannot show keeps only its summary.
 */
export function useRunDetails(runs: readonly RunSummary[]): Readonly<Record<string, RunDetail>> {
  const client = useEngine();
  const key = JSON.stringify(runs.map((run) => [run.runId, run.state, run.progress ?? null, run.elapsed]));
  const [details, setDetails] = useState<Record<string, RunDetail>>({});
  useEffect(() => {
    let live = true;
    for (const [runId] of JSON.parse(key) as [string][]) {
      client.request('venture.runs.get', { runId }).then(
        (run) => { if (live) setDetails((known) => ({ ...known, [runId]: run })); },
        () => { /* the summary still says what it can */ },
      );
    }
    return () => { live = false; };
  }, [client, key]);
  return details;
}

/** A delivery run that a newer run of the same order replaced: it was already run again. */
export function superseded(runId: string, deliveries: readonly DeliveryLite[] | undefined): boolean {
  const delivery = deliveries?.find((d) => d.id === runId);
  return !!delivery && newestRun(delivery.orderId, deliveries ?? [])?.id !== runId;
}

export interface PreviousRunsProps {
  runs: RunSummary[];
  label?: string | undefined;
  /** Delivery runs, to tell a stopped run that was already run again from one that cannot be. */
  deliveries: DeliveryLite[] | undefined;
  /** Today's rows: a failed run is run again through its "Run again" row, the engine's retry path. */
  queue: QueueRow[] | undefined;
  onChanged: () => void;
}

interface RunRowProps {
  as?: 'li' | 'div';
  run: RunSummary;
  detail: RunDetail | undefined;
  row: QueueRow | undefined;
  /** Say plainly that a failed run cannot be run again from here. */
  noRetry: boolean;
  showAvatar: boolean;
  onChanged: () => void;
}

export function RunRow({ as, run, detail, row, noRetry, onChanged, showAvatar }: RunRowProps) {
  const t = useT();
  const again = useRunAgain(row, onChanged);
  const moment = useMoment('short');
  const waitingWords = useWaitingWords();
  let end: ReactNode;
  let line: ReactNode;
  let aside: ReactNode;
  if (run.state === 'failed') {
    line = <>{run.agent}{SEP}<span className={s.failure}>{previousFailure(run, detail?.error) ?? t('work.failedRun.noReason')}</span></>;
    if (!again.action && noRetry) aside = <span className={s.quiet}>{t('work.noRetry')}</span>;
  } else if (run.state === 'waiting') {
    line = <>{run.agent}{SEP}<span className={s.wait}>{waitingWords(run) ?? t('run.waiting')}</span></>;
  } else if (run.state === 'active') {
    // B2: under a second there is no elapsed, so the line is the agent alone, never "Started 0s ago".
    line = run.elapsed ? <>{run.agent}{SEP}{workedWords(run, t, 'run.started')}</> : <>{run.agent}</>;
  } else {
    // How long it worked sits in the line, in words, so a narrow Finished tile keeps its titles wide.
    const took = run.elapsed ? <>{SEP}<span>{tookWords(run, t, 'work.finished.took')}</span></> : null;
    // C4 task 12: who it was for (it opens their sheet) and the owner's date for it.
    const who = run.client ? <>{SEP}<button type="button" className={s.rowClient} onClick={(event) => openSheet('client', run.client!.id, event.currentTarget)}>{run.client.name}</button></> : null;
    end = moment(run.finishedAt ?? run.startedAt) || undefined;
    if (run.result === undefined) {
      line = <>{run.agent}{who}{took}</>;
    } else if (run.estimate) {
      // A model-written result is the estimate itself, labelled where it stands, and never carries a receipt.
      line = <>{run.agent}{who}{took}{SEP}<ModelEstimate value={run.result} /></>;
    } else {
      // C4 task 17: better instructions wait: the line leads to Use this version on Practice.
      line = <>{run.agent}{who}{took}{SEP}{run.adoptReady ? <a className={s.rowClient} href="#/business/practice?focus=adopt">{run.result}</a> : run.result}</>;
      if (run.receiptId) aside = <Receipt id={run.receiptId} />;
    }
  }
  return (
    <Row
      as={as}
      className={run.state === 'done' ? s.finishedRow : undefined}
      id={`run-${run.runId}`} dense mark={showAvatar ? <Avatar name={run.agent} state={RINGS[run.state]} size={32} /> : undefined}
      title={run.purpose} line={line} aside={aside} end={end} actions={again.controls} secondAsk={Boolean(again.action?.secondAsk)}
      onOpen={(origin) => { again.opened(); openSheet('run', run.runId, origin); }}
    >
      {again.ask}
      {again.problem}
    </Row>
  );
}

/**
 * Runs as D's list rows (an order's runs when it is focused, and Finished): the agent's initials ringed by the run's
 * state, the purpose (which opens the run sheet), then what came of it. Done: how long it worked, then the result with
 * its receipt, or the result as a "model estimate" with no receipt. Failed: the engine's error in fail words, then
 * Run again as the engine's action asks, or a line saying it can't be run again from here. Still going: started, or
 * waiting on you.
 */
export function PreviousRuns({ runs, deliveries, queue, onChanged, label }: PreviousRunsProps) {
  const details = useRunDetails(runs.filter((r) => r.state === 'failed'));
  const showAvatar = new Set(runs.map(run => run.agent)).size > 1;
  return (
    <ul className={s.rows} aria-label={label}>
      {runs.map((run) => (
        <RunRow
          key={run.runId} run={run} detail={details[run.runId]} row={run.state === 'failed' ? againRow(queue, run.runId) : undefined}
          noRetry={!!queue && !superseded(run.runId, deliveries)} onChanged={onChanged} showAvatar={showAvatar}
        />
      ))}
    </ul>
  );
}

/** How many finished runs the All view lists before "All finished runs" leads to the Done filter. */
export const FINISHED_AT_REST = 5;

/** D's Finished tile: done runs as rows. In the All view the newest few, with a link to the rest. */
export function Finished({ runs, moreHref, onChanged, renderRows }: { runs: RunSummary[]; moreHref?: string | undefined; onChanged: () => void; renderRows?: (runs: RunSummary[], label?: string) => ReactNode }) {
  const t = useT();
  const id = useId();
  const day = useDayKey();
  const today = useLocalToday()();
  const newest = [...runs].sort((a, b) => (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt));
  const shown = moreHref ? newest.slice(0, FINISHED_AT_REST) : newest;
  const doneToday = runs.filter(run => run.finishedAt && day(run.finishedAt) === today).length;
  const clientWork = shown.filter(run => !run.practice);
  const practice = shown.filter(run => run.practice);
  const more = moreHref && runs.length > shown.length ? { href: moreHref, label: t('work.finished.more') } : undefined;
  return (
    <Tile as="section" labelledBy={id} className={s.finished}>
      <TileHead id={id} title={t('work.finished')} more={more} />
      {doneToday > 0 && <p className={s.quiet}>{t('work.finished.today', { count: doneToday })}</p>}
      {clientWork.length > 0 && (renderRows ? renderRows(clientWork) : <PreviousRuns runs={clientWork} deliveries={undefined} queue={undefined} onChanged={onChanged} />)}
      {practice.length > 0 && <><p className={s.quiet}>{t('work.finished.practice')}</p>{renderRows ? renderRows(practice, t('work.finished.practice')) : <PreviousRuns runs={practice} deliveries={undefined} queue={undefined} onChanged={onChanged} label={t('work.finished.practice')} />}</>}
    </Tile>
  );
}
