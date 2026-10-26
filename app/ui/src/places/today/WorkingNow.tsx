import { useId } from 'react';
import { useT } from '../../text';
import type { RunDetail, RunSummary } from '../../engine/types';
import { openSheet } from '../../shell/navigation';
import { Avatar } from '../../parts/Avatar';
import { EmptyState } from '../../parts/EmptyState';
import { ProgressBar } from '../../parts/ProgressBar';
import { Row } from '../../parts/Row';
import { Tile, TileHead } from '../../parts/Tile';
import { stateText } from '../../parts/states';
import { currentStepOf, runStateOf, stopLineOf } from './runs';
import s from './Today.module.css';

/** Put focus on a row or card of the page by its id, and bring it into view. */
export function focusRow(id: string): boolean {
  const row = [...document.querySelectorAll<HTMLElement>('[data-row-id]')].find((el) => el.getAttribute('data-row-id') === id);
  if (!row) return false;
  row.focus();
  row.scrollIntoView({ block: 'nearest' });
  return true;
}

export interface WorkingNowProps {
  /** The runs to list, in the engine's order: working, waiting on the owner, and stopped ones that can run again. */
  runs: readonly RunSummary[];
  /** Each listed run's detail, read once for the page (useRunDetails). */
  details: ReadonlyMap<string, RunDetail>;
  /** The card that answers a waiting run, when one is listed. */
  rowForRun: (runId: string) => string | undefined;
  goToRow: (rowId: string) => void;
}

/**
 * Working now (D-Today `.lt` with `.lrow`): a row per run that is working or waiting on the owner, and per stopped run
 * that still offers Run again, each with the agent's ring, what it is for, the agent and the step it is on, a bar of
 * its measured steps (or the step it is on, when the engine cannot count them) and the time it has run. A run waiting
 * on the owner says so in place of its timer, which stops, and those words take you to the card that answers it. A
 * stopped run says so in the engine's words. The purpose opens the run sheet. Stop waits for W4 4F.
 */
export function WorkingNow({ runs, details, rowForRun, goToRow }: WorkingNowProps) {
  const t = useT();
  const headingId = useId();
  const running = runs.filter((run) => run.state !== 'failed').length;
  const stopped = runs.length - running;
  const meta = [
    t('today.working.running', { count: running }),
    ...(stopped > 0 ? [t('today.working.stopped', { count: stopped })] : []),
  ].join(' · ');
  return (
    <Tile as="section" labelledBy={headingId} className={s.listTile}>
      <TileHead id={headingId} title={t('jobs.active')} meta={runs.length > 0 ? meta : undefined} more={{ href: '#/work', label: t('today.working.open') }} />
      {runs.length === 0 ? (
        <EmptyState title={t('jobs.none')} />
      ) : (
        <ul className={s.list}>
          {runs.map((run) => <WorkRow key={run.runId} run={run} detail={details.get(run.runId)} rowId={run.state === 'waiting' ? rowForRun(run.runId) : undefined} goToRow={goToRow} />)}
        </ul>
      )}
    </Tile>
  );
}

function WorkRow({ run, detail, rowId, goToRow }: { run: RunSummary; detail: RunDetail | undefined; rowId: string | undefined; goToRow: (rowId: string) => void }) {
  const t = useT();
  const state = runStateOf(run);
  const tone = state === 'waiting' ? 'waiting' : state === 'failed' ? 'failed' : 'working';
  const progress = run.progress ?? 'indeterminate';
  const current = detail ? currentStepOf(detail) : null;
  const said = state === 'failed' ? (detail ? stopLineOf(detail) : run.result) : current?.purpose;
  const measured = progress !== 'indeterminate' && progress.total > 0;

  const words = state === 'waiting' ? (
    rowId ? (
      <button type="button" className={s.wait} onClick={() => goToRow(rowId)}>
        {t('run.waiting')}
        <span className="sr-only">{t('today.toRow')}</span>
      </button>
    ) : <span className={s.wait}>{t('run.waiting')}</span>
  ) : state === 'failed' ? (
    <span className={s.stopped}>{stateText(t, 'run', 'failed')}</span>
  ) : !measured && current ? (
    <span>{t('today.working.step', { n: current.position })}</span>
  ) : null;

  return (
    <Row
      id={`run-${run.runId}`}
      mark={<Avatar name={run.agent} state={state} size={32} />}
      title={run.purpose}
      line={said ? `${run.agent} · ${said}` : run.agent}
      onOpen={(origin) => openSheet('run', run.runId, origin)}
      aside={(
        <span className={s.progress}>
          <ProgressBar progress={progress} tone={tone} showCount={state === 'working'} className={s.bar} />
          {words}
        </span>
      )}
      end={state === 'waiting' ? undefined : run.elapsed}
    />
  );
}
