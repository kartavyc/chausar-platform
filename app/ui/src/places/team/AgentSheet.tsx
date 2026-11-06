import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import type { AgentView, RunSummary } from '../../engine/types';
import { openSheet } from '../../shell/navigation';
import type { SheetComponentProps } from '../../shell/sheets';
import { Avatar } from '../../parts/Avatar';
import { DeptChip, StateChip } from '../../parts/Chip';
import { cx } from '../../parts/cx';
import { ProgressRing, measuredSteps } from '../../parts/ProgressRing';
import { Sheet } from '../../parts/Sheet';
import { DEPT_OF, stateOf } from './departments';
import { GateList } from './GateList';
import { PostureChoice } from './PostureChoice';
import { RING, Result, agentRow, currentRun, elapsedOf, refreshOn, stateWords, toneOf } from './shared';
import s from './Team.module.css';

const TABS = ['steps', 'runs'] as const;
type Tab = (typeof TABS)[number];

/**
 * One agent, in the panel beside Team (D-TeamChat's `.cpanel`, 440 px): its avatar with its ring, name, role and
 * state in the head, then two tabs. Steps: its posture as radio cards, its playbook steps each with an auto or hold
 * gate, and where its spend is. Runs: its runs with their rings and state words, each opening the run sheet. The Chat
 * tab, the instructions and their version arrive with W4 4B.
 */
export function AgentSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const base = useId();
  const stepsId = useId();
  const spendId = useId();
  const runsId = useId();
  const team = useResource('venture.team.list', {}, { refreshOn });
  const runs = useResource('venture.runs.list', { state: 'all' }, { refreshOn });
  // The engine's answer to a gate or posture change, shown until the list itself is read again.
  const [saved, setSaved] = useState<AgentView | null>(null);
  const [tab, setTab] = useState<Tab>('steps');
  useEffect(() => { setSaved(null); }, [team.data]);

  const agent = saved ?? team.data?.agents.find((a) => a.id === id);
  if (!agent) {
    const title = team.data ? t('team.notFound') : team.error ? t('team.failed', { message: team.error.message }) : t('team.loading');
    return <Sheet label={t('team.sheet')} title={title} onClose={onClose} returnFocus={returnFocus} width="panel" />;
  }

  const state = stateOf(agent, runs.data?.runs);
  const run = currentRun(runs.data?.runs, agent.name);
  const steps = run?.progress ? measuredSteps(run.progress) : null;
  const dept = agent.department ? DEPT_OF[agent.department] : undefined;
  const mine = (runs.data?.runs ?? []).filter((one) => one.agent === agent.name);
  const tabId = (which: Tab) => `${base}-${which}`;

  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    const at = TABS.indexOf(tab);
    const next = event.key === 'ArrowRight' ? TABS[(at + 1) % TABS.length]
      : event.key === 'ArrowLeft' ? TABS[(at + TABS.length - 1) % TABS.length]
        : event.key === 'Home' ? TABS[0]
          : event.key === 'End' ? TABS[TABS.length - 1] : undefined;
    if (!next) return;
    event.preventDefault();
    setTab(next);
    document.getElementById(tabId(next))?.focus();
  }

  return (
    <Sheet
      label={t('team.sheet')}
      eyebrow={dept ? <DeptChip dept={dept} /> : undefined}
      title={agent.name}
      line={(
        <>
          {agent.role}
          {' · '}
          <span className={s.panelState} data-tone={state}>
            {stateWords(t, state)}
            {steps && <>{', '}<span className="mono">{t('bar.count', { done: steps.done, total: steps.total })}</span></>}
          </span>
        </>
      )}
      avatar={<Avatar name={agent.name} dept={dept} state={RING[state]} size={40} />}
      width="panel"
      name={agent.name}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      <div role="tablist" aria-label={agent.name} className={s.tabs} onKeyDown={onTabKey}>
        {TABS.map((which) => (
          <button
            key={which}
            type="button"
            role="tab"
            id={tabId(which)}
            className={s.tab}
            aria-selected={tab === which}
            aria-controls={`${tabId(which)}-panel`}
            tabIndex={tab === which ? 0 : -1}
            onClick={() => setTab(which)}
          >
            {t(`team.${which}`)}
          </button>
        ))}
      </div>

      {tab === 'steps' ? (
        <div role="tabpanel" id={`${tabId('steps')}-panel`} aria-labelledby={tabId('steps')} className={s.tabPanel}>
          <PostureChoice agent={agent} onSaved={setSaved} />
          <section className={s.section}>
            <h3 id={stepsId} className={s.small}>{t('team.steps')}</h3>
            <GateList agents={[agent]} look="list" labelledBy={stepsId} onSaved={setSaved} onFloor={team.reload} />
          </section>
          {/* Per-agent spend with receipt: placeholder until W4 4A. The engine sends an agent's spend as words with no
              receipt, and a money figure always carries one (or "model estimate"), so it is not printed here; every
              paid call, by agent and with its receipt, is one step away in Money. */}
          <section className={s.section} aria-labelledby={spendId}>
            <h3 id={spendId} className={s.small}>{t('team.spend')}</h3>
            <p className={s.quiet}>{t('team.spendWhere')}</p>
            <a className={s.link} href="#/money/spend">{t('team.spendLink')}</a>
          </section>
        </div>
      ) : (
        <div role="tabpanel" id={`${tabId('runs')}-panel`} aria-labelledby={tabId('runs')} className={s.tabPanel}>
          <section className={s.section}>
            <h3 id={runsId} className={s.small}>{t('team.runs')}</h3>
            {runs.error && <p className={s.failed}>{t('team.failed', { message: runs.error.message })}</p>}
            {runs.data && mine.length === 0 && <p className={s.quiet}>{t('team.runsNone')}</p>}
            {mine.length > 0 && (
              <ul className={s.runs} aria-labelledby={runsId}>
                {mine.map((one) => <RunLine key={one.runId} run={one} agentId={agent.id} />)}
              </ul>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
}

/** One run: its ring, its purpose (it opens the shell's run sheet), its state in words and time, then how it ended. */
function RunLine({ run, agentId }: { run: RunSummary; agentId: string }) {
  const t = useT();
  return (
    <li className={s.run} data-row="" tabIndex={-1}>
      <span className={s.runRing}>{run.progress && <ProgressRing progress={run.progress} tone={toneOf(run)} />}</span>
      <div className={s.runBody}>
        <button type="button" className={s.runOpen} data-open="" onClick={(event) => openSheet('run', run.runId, agentRow(agentId) ?? event.currentTarget)}>
          {run.purpose}
        </button>
        <p className={s.runMeta}>
          <StateChip kind="run" value={run.state} />
          <span className={cx(s.elapsed, 'mono')}>{elapsedOf(t, run)}</span>
        </p>
        {run.state === 'failed' && <p className={s.failure}>{run.result ?? t('run.stopped')}</p>}
        {run.state === 'done' && run.result !== undefined && (
          <p className={s.result}><Result line={run.result} receiptId={run.receiptId} estimate={run.estimate} /></p>
        )}
      </div>
    </li>
  );
}
