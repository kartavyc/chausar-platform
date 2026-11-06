import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import type { AgentView, RunSummary } from '../../engine/types';
import { openSheet, setQuery, useRoute } from '../../shell/navigation';
import type { SheetComponentProps } from '../../shell/sheets';
import { Avatar } from '../../parts/Avatar';
import { Chip, DeptChip, StateChip } from '../../parts/Chip';
import { cx } from '../../parts/cx';
import { ProgressRing, measuredSteps } from '../../parts/ProgressRing';
import { Sheet } from '../../parts/Sheet';
import { AgentChat } from './AgentChat';
import { AgentNotes } from './AgentNotes';
// W4 4J22b: its skills and what it can and cannot do (how it talks sits in Instructions).
import { AgentCanDo } from './AgentCanDo';
import { AGENT_TABS, FIRST_TAB, canChat, chatRefresh, type AgentTab } from './chat';
import { DEPT_OF, isKeeper, stateOf } from './departments';
import { HealthLine } from './HealthLine';
import { Instructions } from './Instructions';
import { KeeperJobs } from './KeeperCard';
import { RING, Result, agentRow, currentRun, elapsedOf, refreshOn, stateWords, toneOf } from './shared';
import s from './Team.module.css';
import c from './AgentChat.module.css';

/** A role whose steps are code has no chat and keeps no notes (engine 4B1 AGENT_IS_CODE): its instructions and runs. */
const CODE_TABS: readonly AgentTab[] = ['instructions', 'runs'];

/**
 * One agent, in the panel beside Team (D-TeamChat's `.cpanel`, 440 px): its avatar with its ring, name, role and
 * state in the head, then four tabs (W4 4B3), held in the address as `&tab=`. Chat: every run of the agent as a
 * conversation, and talking to it (AgentChat); opened from the quiet Chat button on its card, never on its own.
 * Instructions, with the version in use: how it works in words, its standing orders and going back from a change, its
 * posture and who set it, when each step asks the owner, its AI and its spend (Instructions). Runs: its runs with their
 * rings and state words, each opening the run sheet. Notes: what it keeps from the owner's words (AgentNotes). Opened by
 * its name, the panel shows Instructions. Keeper is code, not AI: its jobs instead. W4 4J22b adds Can do: its skills
 * (whose "Try this" opens Chat with the question in the box, unsent, once) and its capability page; how it talks
 * (tried and set as a version, and the agent file) is a section of Instructions.
 */
export function AgentSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const route = useRoute();
  const base = useId();
  const runsId = useId();
  const team = useResource('venture.team.list', {}, { refreshOn });
  const runs = useResource('venture.runs.list', { state: 'all' }, { refreshOn });
  // The engine's answer to a gate or posture change, shown until the list itself is read again.
  const [saved, setSaved] = useState<AgentView | null>(null);
  useEffect(() => { setSaved(null); }, [team.data]);
  // The tab pressed here shows at once; the address follows, and an address that names another tab wins.
  const [picked, setPicked] = useState<AgentTab | null>(null);
  useEffect(() => { setPicked(null); }, [route.query.tab, id]);
  // A skill's "Try this" question (W4 4J22b): put in the chat box once, then let go, so the box never fills again
  // by itself. Each new one gets its own key, so the box opens afresh with it.
  const [starter, setStarter] = useState<{ text: string; key: number } | null>(null);
  useEffect(() => { setStarter(null); }, [id]);

  const agent = saved ?? team.data?.agents.find((a) => a.id === id);
  // The version in use, the agent's steps with their guidance and checks, its standing orders and what Undo would do:
  // read-level, so opening the panel never writes (a role whose steps are code has none of these).
  const standing = useResource('venture.agents.orders.list', { agent: id }, { refreshOn: chatRefresh, skip: !agent || !canChat(agent) });
  const version = standing.data?.playbook?.version;
  if (!agent) {
    const title = team.data ? t('team.notFound') : team.error ? t('team.failed', { message: team.error.message }) : t('team.loading');
    return <Sheet label={t('team.sheet')} title={title} onClose={onClose} returnFocus={returnFocus} width="panel" />;
  }

  const state = stateOf(agent, runs.data?.runs);
  const run = currentRun(runs.data?.runs, agent.name);
  const steps = run?.progress ? measuredSteps(run.progress) : null;
  const dept = agent.department ? DEPT_OF[agent.department] : undefined;
  const mine = (runs.data?.runs ?? []).filter((one) => one.agent === agent.name);
  const tabs: readonly AgentTab[] = canChat(agent) ? AGENT_TABS : CODE_TABS;
  const asked = (picked ?? route.query.tab) as AgentTab | undefined;
  const tab: AgentTab = asked && tabs.includes(asked) ? asked : FIRST_TAB;
  const peers = (team.data?.agents ?? []).filter(canChat);
  const tabId = (which: AgentTab) => `${base}-${which}`;

  function choose(next: AgentTab) {
    setPicked(next);
    setQuery({ ...route.query, tab: next });
  }

  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    const at = tabs.indexOf(tab);
    const next = event.key === 'ArrowRight' ? tabs[(at + 1) % tabs.length]
      : event.key === 'ArrowLeft' ? tabs[(at + tabs.length - 1) % tabs.length]
        : event.key === 'Home' ? tabs[0]
          : event.key === 'End' ? tabs[tabs.length - 1] : undefined;
    if (!next) return;
    event.preventDefault();
    choose(next);
    document.getElementById(tabId(next))?.focus();
  }

  // Keeper is code, not AI (W4 4A1): no posture to choose, no steps to gate and no runs of its own; its jobs instead.
  if (isKeeper(agent)) {
    return (
      <Sheet
        label={t('team.sheet')}
        eyebrow={dept ? <DeptChip dept={dept} /> : undefined}
        title={agent.name}
        line={agent.role}
        avatar={<Avatar name={agent.name} dept={dept} state={RING[state]} size={40} />}
        width="panel"
        name={agent.name}
        onClose={onClose}
        returnFocus={returnFocus}
      >
        <div className={s.tabPanel}>
          <p><Chip tone="line">{t('team.keeper.code')}</Chip></p>
          <KeeperJobs name={agent.name} />
        </div>
      </Sheet>
    );
  }

  const label = (which: AgentTab) => {
    if (which === 'instructions') {
      return (
        <>
          {t('team.instructions.tab')}
          {version !== undefined && <>{' '}<span className={cx(c.tabBadge, 'mono')}>{t('team.instructions.badge', { version })}</span></>}
        </>
      );
    }
    if (which === 'runs') {
      return <>{t('team.runs')}{runs.data && <span className={cx(c.tabBadge, 'mono')} aria-hidden="true">{` ${mine.length}`}</span>}</>;
    }
    return t(which === 'chat' ? 'team.chat.tab' : which === 'notes' ? 'team.notes.tab' : `team.${which}.tab`);
  };

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
      <HealthLine health={agent.health} agentId={agent.id} onCleared={team.reload} />
      <div role="tablist" aria-label={agent.name} className={s.tabs} onKeyDown={onTabKey}>
        {tabs.map((which) => (
          <button
            key={which}
            type="button"
            role="tab"
            id={tabId(which)}
            className={s.tab}
            aria-selected={tab === which}
            aria-controls={tab === which ? `${tabId(which)}-panel` : undefined}
            tabIndex={tab === which ? 0 : -1}
            onClick={() => choose(which)}
          >
            {label(which)}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${tabId(tab)}-panel`} aria-labelledby={tabId(tab)} className={s.tabPanel} data-tab={tab}>
        {tab === 'chat' && (
          <AgentChat key={agent.id} agent={agent} dept={dept} peers={peers} playbook={standing.data?.playbook ?? undefined} onPlaybookChanged={standing.reload} initial={starter?.text} initialKey={starter?.key} onInitialUsed={() => setStarter((was) => (was ? { ...was, text: '' } : was))} />
        )}
        {tab === 'instructions' && (
          <Instructions
            agent={agent}
            standing={standing}
            onSaved={setSaved}
            onFloor={team.reload}
            onPlaybookChanged={standing.reload}
          />
        )}
        {tab === 'runs' && (
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
        )}
        {tab === 'notes' && <AgentNotes key={agent.id} agent={agent} />}
        {tab === 'cando' && <AgentCanDo key={agent.id} agent={agent} onTry={(words) => { setStarter((was) => ({ text: words, key: (was?.key ?? 0) + 1 })); choose('chat'); }} />}
      </div>
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
          {elapsedOf(run) && <span className={cx(s.elapsed, 'mono')}>{elapsedOf(run)}</span>}
        </p>
        {run.state === 'failed' && <p className={s.failure}>{run.result ?? t('run.stopped')}</p>}
        {run.state === 'done' && run.result !== undefined && (
          <p className={s.result}><Result line={run.result} receiptId={run.receiptId} estimate={run.estimate} /></p>
        )}
        {run.writtenBy && <p className={s.quiet} data-written-by="">{run.writtenBy}</p>}
      </div>
    </li>
  );
}
