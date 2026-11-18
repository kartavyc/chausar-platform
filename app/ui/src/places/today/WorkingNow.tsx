import { useId } from 'react';
import { useT } from '../../text';
import type { OpenSearchView, RunDetail, RunSummary } from '../../engine/types';
import { openSheet } from '../../shell/navigation';
import { Avatar, ChausarAvatar } from '../../parts/Avatar';
import { fixedWords, usePlanWords } from './plan-words';
import { EmptyState } from '../../parts/EmptyState';
import { ProgressBar } from '../../parts/ProgressBar';
import { Row } from '../../parts/Row';
import { Tile, TileHead } from '../../parts/Tile';
import { stateText } from '../../parts/states';
import { currentStepOf, runStateOf, stopLineOf } from './runs';
// W4 4F3: Stop on each running row, the same Stop and dialog as Work's tiles.
import { useStopRun } from '../work/StopDialog';
import { plainFailure } from '../work/StoppedRun';
import s from './Today.module.css';

/** Put focus on a row or card of the page by its id, and bring it into view. */
export function focusRow(id: string, block: ScrollLogicalPosition = 'nearest'): boolean {
  const row = [...document.querySelectorAll<HTMLElement>('[data-row-id]')].find((el) => el.getAttribute('data-row-id') === id);
  if (!row) return false;
  row.focus();
  row.scrollIntoView({ block });
  return true;
}

export interface WorkingNowProps {
  /** The runs to list, in the engine's order: working, waiting on the owner, and stopped ones that can run again. */
  runs: readonly RunSummary[];
  /** Round 5: the searches for customers open now (venture.runs.list searches), Chausar's own work beside the runs. */
  searches: readonly OpenSearchView[];
  /** Each listed run's detail, read once for the page (useRunDetails). */
  details: ReadonlyMap<string, RunDetail>;
  /** The card that answers a waiting run, when one is listed. */
  rowForRun: (runId: string) => string | undefined;
  goToRow: (rowId: string) => void;
  /** W6 6H3: the name the owner (or their AI) gave this block; left out, its own. */
  title?: string | undefined;
}

/**
 * Working now (D-Today `.lt` with `.lrow`): a row per run that is working or waiting on the owner, and per stopped run
 * that still offers Run again, each with the agent's ring, what it is for, the agent and the step it is on, a bar of
 * its measured steps (or the step it is on, when the engine cannot count them) and the time it has run. A run waiting
 * on the owner says so in place of its timer, which stops, and those words take you to the card that answers it. A
 * stopped run says so in the engine's words. The purpose opens the run sheet.
 * W4 4F3: each running row has Stop (named by what the run is doing, "Stop: Cutting shorts from episode 13") and its
 * small dialog; a run the engine says is stopping reads Stopping, and one it stopped (the owner, or Chausar) reads
 * Stopped or Interrupted with its line, never "Failed".
 */
export function WorkingNow({ runs, searches, details, rowForRun, goToRow, title }: WorkingNowProps) {
  const t = useT();
  const headingId = useId();
  const running = runs.filter((run) => run.state !== 'failed').length + searches.length;
  const stopped = runs.length - running;
  const meta = [
    t('today.working.running', { count: running }),
    ...(stopped > 0 ? [t('today.working.stopped', { count: stopped })] : []),
  ].join(' · ');
  return (
    <Tile as="section" labelledBy={headingId} className={s.listTile}>
      <TileHead id={headingId} title={title ?? t('jobs.active')} meta={runs.length + searches.length > 0 ? meta : undefined} more={{ href: '#/work', label: t('today.working.open') }} />
      {runs.length + searches.length === 0 ? (
        <EmptyState title={t('jobs.none')} />
      ) : (
        <ul className={s.list}>
          {searches.map((search) => <SearchRow key={search.searchId} search={search} />)}
          {runs.map((run) => <WorkRow key={run.runId} run={run} detail={details.get(run.runId)} rowId={run.state === 'waiting' ? rowForRun(run.runId) : undefined} goToRow={goToRow} />)}
        </ul>
      )}
    </Tile>
  );
}

/**
 * Round 5 (re-check 028): a search for customers Chausar runs on an approved card, while it runs: who does it (Chausar,
 * or the agent its card named), the engine's line and its time so far. The engine counts nothing until the search
 * ends, so the bar is the one with no step count and no number is shown. It opens Clients, Pipeline, where the
 * searches and what they found are listed; it has no Stop, as the search itself has none.
 */
function SearchRow({ search }: { search: OpenSearchView }) {
  const t = useT();
  const words = usePlanWords();
  const who = search.agent ?? t('today.chausar.name');
  return (
    <Row
      id={`search-${search.searchId}`}
      mark={search.agent ? <Avatar name={search.agent} state="working" size={32} /> : <ChausarAvatar state="working" size={32} />}
      title={search.title}
      line={`${who} · ${words(search.line)}`}
      onOpen={() => { window.location.hash = '#/clients/pipeline'; }}
      aside={<span className={s.progress}><ProgressBar progress="indeterminate" tone="working" showCount={false} className={s.bar} /></span>}
      end={search.elapsed || undefined}
    />
  );
}

function WorkRow({ run, detail, rowId, goToRow }: { run: RunSummary; detail: RunDetail | undefined; rowId: string | undefined; goToRow: (rowId: string) => void }) {
  const t = useT();
  const state = runStateOf(run);
  const tone = state === 'waiting' ? 'waiting' : state === 'failed' ? 'failed' : 'working';
  const progress = run.progress ?? 'indeterminate';
  const current = detail ? currentStepOf(detail) : null;
  const stop = useStopRun(run, detail);
  const halted = run.stop?.state;
  // 4Z2: a known failure in plain words (Work's), the engine's technical line left to the run's own sheet.
  // Round 6 (re-check 036): the run's purpose and its step when code wrote them ("Practice draft for ...", "You review the
  // draft") in the owner's language; a step the plan or the AI named stays as written.
  const planWords = fixedWords(t);
  const said = state === 'failed' ? (detail ? plainFailure(t, detail) ?? stopLineOf(detail) : run.result) : halted === 'stopped' ? run.stop!.line : current?.purpose && planWords(current.purpose);
  const haltWord = halted === 'stopped' ? t(detail?.interrupted ? 'work.stop.interrupted' : 'work.stop.chip') : null;
  const measured = progress !== 'indeterminate' && progress.total > 0;

  const words = halted === 'stopping' ? (
    <span className={s.wait}>{t('work.stop.stopping')}</span>
  ) : haltWord ? (
    rowId ? (
      <button type="button" className={s.wait} onClick={() => goToRow(rowId)}>
        {haltWord}
        <span className="sr-only">{t('today.toRow')}</span>
      </button>
    ) : <span className={s.wait}>{haltWord}</span>
  ) : state === 'waiting' ? (
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
      title={planWords(run.purpose)}
      line={said ? `${run.agent} · ${said}` : run.agent}
      onOpen={(origin) => openSheet('run', run.runId, origin)}
      aside={(
        <span className={s.progress}>
          <ProgressBar progress={progress} tone={tone} showCount={state === 'working'} className={s.bar} />
          {words}
        </span>
      )}
      end={state === 'waiting' ? undefined : run.elapsed}
      actions={stop.button}
    >
      {stop.shown ? stop.panel : undefined}
    </Row>
  );
}
