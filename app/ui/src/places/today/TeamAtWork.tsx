import { useId } from 'react';
import { useT } from '../../text';
import type { AgentView, RunDetail, RunSummary } from '../../engine/types';
import { openSheet } from '../../shell/navigation';
import { Avatar } from '../../parts/Avatar';
import { Inner } from '../../parts/Card';
import { ProgressRing } from '../../parts/ProgressRing';
import { StoriesRow, type Story } from '../../parts/StoriesRow';
import { Tile, TileHead } from '../../parts/Tile';
import { STATE_ORDER, agentStateOf, currentStepOf, liveRunOf } from './runs';
import s from './TeamAtWork.module.css';

/** At most this many live tiles; every run is also a row in Working now. */
const LIVE_TILES = 4;

export interface TeamAtWorkProps {
  agents: readonly AgentView[];
  runs: readonly RunSummary[];
  /** Each listed run's detail, read once for the page (useRunDetails). */
  details: ReadonlyMap<string, RunDetail>;
  /** The card that answers a waiting run, when one is listed. */
  rowForRun: (runId: string) => string | undefined;
  /** Bring that card into view and put focus on it. */
  goToRow: (rowId: string) => void;
  /** A phone: the stories are one row that scrolls sideways (D-Phone-Today `.hscroll`), and so are the live tiles. */
  phone?: boolean | undefined;
}

/**
 * The team at work (D-Today `.team`): how many agents are working, need you or are idle; every agent as a story with
 * its ring, needs you first; then a live tile for each run that is working or waiting on you, with its ring and the
 * step it is on. Agents carry no department tint or badge until the engine sends departments (placeholder until W4
 * 4A); there is no Chausar story (W4 4C) and no "Add agent" (W4 4A).
 */
export function TeamAtWork({ agents, runs, details, rowForRun, goToRow, phone = false }: TeamAtWorkProps) {
  const t = useT();
  const headingId = useId();
  if (agents.length === 0) return null;

  const states = agents.map((agent, index) => ({ agent, index, state: agentStateOf(agent.name, runs) }));
  const count = (state: string) => states.filter((entry) => entry.state === state).length;
  const failed = count('failed');
  const meta = [
    t('today.team.working', { count: count('working') }),
    t('today.team.waiting', { count: count('waiting') }),
    ...(failed > 0 ? [t('today.team.failed', { count: failed })] : []),
    t('today.team.idle', { count: count('idle') }),
  ].join(' · ');

  const stories: Story[] = [...states]
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.index - b.index)
    .map(({ agent, state }) => ({ id: agent.id, name: agent.name, state, progress: state === 'working' ? liveRunOf(agent.name, runs)?.progress : undefined }));

  const live = runs.filter((run) => run.state === 'active' || run.state === 'waiting').slice(0, LIVE_TILES);
  const roleOf = (name: string) => agents.find((agent) => agent.name === name)?.role;

  return (
    <Tile as="section" labelledBy={headingId} className={s.team}>
      <TileHead id={headingId} title={t('today.team.title')} meta={meta} more={{ href: '#/team', label: t('today.team.see') }} />
      <StoriesRow stories={stories} onOpen={(id) => openSheet('agent', id)} scroll={phone} className={s.stories} />
      {live.length > 0 && (
        // On a phone the tiles are one row that scrolls sideways, so the row itself takes focus (arrow keys scroll it)
        // and is named, as the Board does: a tile may hold no button at all (w3 3I, axe in Chrome).
        <div className={s.live} {...(phone ? { role: 'group', 'aria-labelledby': headingId, tabIndex: 0 } : {})}>
          {live.map((run) => (
            <LiveTile key={run.runId} run={run} detail={details.get(run.runId)} role={roleOf(run.agent)} rowId={run.state === 'waiting' ? rowForRun(run.runId) : undefined} goToRow={goToRow} />
          ))}
        </div>
      )}
    </Tile>
  );
}

/** One run as it works (D-Today `.lc`): the agent, its ring, what the run is for and the step it is on now. */
interface LiveTileProps { run: RunSummary; detail: RunDetail | undefined; role: string | undefined; rowId: string | undefined; goToRow: (rowId: string) => void }

function LiveTile({ run, detail, role, rowId, goToRow }: LiveTileProps) {
  const t = useT();
  const waiting = run.state === 'waiting';
  const step = detail ? currentStepOf(detail)?.purpose : undefined;
  return (
    <Inner as="article" label={t(waiting ? 'today.live.waiting' : 'today.live.working', { agent: run.agent })} className={s.tile}>
      <div className={s.top}>
        <Avatar name={run.agent} state={waiting ? 'waiting' : 'working'} />
        <div className={s.id}>
          <p className={s.name}>{run.agent}</p>
          {role && <p className={s.role}>{role}</p>}
        </div>
        <ProgressRing progress={run.progress ?? 'indeterminate'} tone={waiting ? 'waiting' : 'working'} />
      </div>
      <p className={s.now}>
        {waiting && <span className={s.wait}>{t('today.live.waitingNow')} </span>}
        {run.purpose}
      </p>
      <p className={s.step}>
        {waiting && rowId ? (
          <button type="button" className={s.answer} onClick={() => goToRow(rowId)}>
            {t('today.live.answer')}
            <span className="sr-only">{t('today.toRow')}</span>
          </button>
        ) : (
          <span className={s.stepLine}>{step}</span>
        )}
        {!waiting && <span className="mono">{run.elapsed}</span>}
      </p>
    </Inner>
  );
}
