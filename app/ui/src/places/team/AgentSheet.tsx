import { useEffect, useId, useState, type ReactNode } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type { RunSummary } from '../../engine/types';
import { openSheet, setQuery, useRoute } from '../../shell/navigation';
import type { SheetComponentProps } from '../../shell/sheets';
import { Avatar } from '../../parts/Avatar';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Chip, DeptChip, StateChip } from '../../parts/Chip';
import { cx } from '../../parts/cx';
import { ProgressRing, measuredSteps } from '../../parts/ProgressRing';
import { Sheet } from '../../parts/Sheet';
import { Tabs } from '../../parts/Tabs';
import { AgentChat } from './AgentChat';
import { AgentNotes } from './AgentNotes';
// W4 4J22b: its skills and what it can and cannot do (how it talks sits in Instructions).
import { AgentCanDo } from './AgentCanDo';
import { AGENT_TABS, FIRST_TAB, canChat, chatRefresh, type AgentTab } from './chat';
// W6 6G2: the check before an agent retires, and a retired agent's read-only panel with Bring back.
import { AgentRetire, RetiredPanel } from './AgentRetire';
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
 * AI review settings, step instructions, its AI and its spend (Instructions). Runs: its runs with their
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
  // The tab pressed here shows at once; the address follows, and an address that names another tab wins.
  const [picked, setPicked] = useState<AgentTab | null>(null);
  useEffect(() => { setPicked(null); }, [route.query.tab, id]);
  // A skill's "Try this" question (W4 4J22b): put in the chat box once, then let go, so the box never fills again
  // by itself. Each new one gets its own key, so the box opens afresh with it.
  const [starter, setStarter] = useState<{ text: string; key: number } | null>(null);
  // W6 6G2: the check before it retires, shown in place of the tab; and what retiring said, for the retired panel.
  const [retiring, setRetiring] = useState(false);
  const [retiredSaid, setRetiredSaid] = useState<string | null>(null);
  useEffect(() => { setStarter(null); setRetiring(false); setRetiredSaid(null); }, [id]);

  const agent = team.data?.agents.find((a) => a.id === id);
  // W6 6G2: an agent on the Retired shelf opens read only, with Bring back.
  const shelved = agent ? undefined : team.data?.retired?.find((item) => item.id === id);
  // The version in use, the agent's steps with their guidance and checks, its standing orders and what Undo would do:
  // read-level, so opening the panel never writes (a role whose steps are code has none of these).
  const standing = useResource('venture.agents.orders.list', { agent: id }, { refreshOn: chatRefresh, skip: !agent || !canChat(agent) });
  const version = standing.data?.playbook?.version;
  if (shelved) {
    const shelfDept = shelved.department ? DEPT_OF[shelved.department] : undefined;
    return (
      <Sheet
        label={t('team.sheet')} eyebrow={<Chip tone="line">{t('team.shelf.chip')}</Chip>} title={shelved.name} line={shelved.role}
        avatar={<Avatar name={shelved.name} dept={shelfDept} state="idle" size={40} />} width="panel" name={shelved.name} onClose={onClose} returnFocus={returnFocus}
      >
        <RetiredPanel key={shelved.id} item={shelved} said={retiredSaid} onChanged={team.reload} />
      </Sheet>
    );
  }
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

  /** Each tab's words, and after them the instructions version or the count of jobs (read once, so not in the tab's name). */
  const label = (which: AgentTab): { label: string; after?: ReactNode } => {
    if (which === 'instructions') {
      return { label: t('team.instructions.tab'), after: version !== undefined ? <span data-code="" className={cx(c.tabBadge, 'mono')}>{t('team.instructions.badge', { version })}</span> : undefined };
    }
    if (which === 'runs') {
      return { label: t('team.runs'), after: runs.data ? <span className={c.tabBadge} data-num="" aria-hidden="true">{String(mine.length)}</span> : undefined };
    }
    return { label: t(which === 'chat' ? 'team.chat.tab' : which === 'notes' ? 'team.notes.tab' : `team.${which}.tab`) };
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
            {steps && <>{', '}<span>{t('bar.count', { done: steps.done, total: steps.total })}</span></>}
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
      {/* C7: an agent the owner hired: the day, its duties and what it reads. It always asks you first. */}
      {agent.hired && (
        <div className={s.hireForm} data-hired-agent="">
          <p className={s.hireLine}>{agent.hired.line}</p>
          <ul className={s.hireList}>{agent.hired.duties.map((duty) => <li key={duty} data-content="">{duty}</li>)}</ul>
          <HiredDuties agent={agent.id} duties={agent.hired.duties} onChanged={team.reload} />
          {agent.hired.reads.length > 0 && <p className={s.hireLine}>{t('team.hire.readsLine', { reads: agent.hired.reads.map((item) => t(`team.hire.read.${item.read}`)).join(', ') })}</p>}
          <p className={s.hireLine}>{t('team.hire.alwaysAsks')}</p>
        </div>
      )}
      {/* C1 task 2: the one Tabs part, in its tabs mode; the panel below stays this sheet's own. */}
      <Tabs mode="tabs" label={agent.name} value={tab} idOf={(which) => tabId(which as AgentTab)} items={tabs.map((which) => ({ id: which, ...label(which) }))} onChange={(which) => choose(which as AgentTab)} />

      <div role="tabpanel" id={`${tabId(tab)}-panel`} aria-labelledby={tabId(tab)} className={s.tabPanel} data-tab={tab}>
        {tab === 'chat' && (
          <AgentChat key={agent.id} agent={agent} dept={dept} peers={peers} playbook={standing.data?.playbook ?? undefined} onPlaybookChanged={standing.reload} initial={starter?.text} initialKey={starter?.key} onInitialUsed={() => setStarter((was) => (was ? { ...was, text: '' } : was))} />
        )}
        {tab === 'instructions' && !retiring && (
          <Instructions
            agent={agent}
            standing={standing}
            onPlaybookChanged={standing.reload}
          />
        )}
        {/* W6 6G2: Retire sits last in Instructions, quiet; it opens the check in place of the tab. */}
        {tab === 'instructions' && canChat(agent) && (retiring
          ? <AgentRetire agent={agent} onCancel={() => setRetiring(false)} onRetired={(said) => { setRetiredSaid(said); setRetiring(false); team.reload(); }} />
          : <p><Button size="sm" variant="quiet" onClick={() => setRetiring(true)} data-retire="">{t('team.retire.open')}</Button></p>)}
        {tab === 'runs' && (
          <section className={s.section}>
            <h3 id={runsId} className={s.small}>{t('team.runs')}</h3>
            {runs.error && <p className={s.failed}>{t('team.failed', { message: runs.error.message })}</p>}
            {/* C4 task 10 (58.x1): an empty Runs tab says when it starts, with the way to Work. */}
            {runs.data && mine.length === 0 && <p className={s.quiet}>{t('team.runsStart')} <a href="#/work">{t('team.runsStartLink')}</a></p>}
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
          {elapsedOf(run) && <span className={s.elapsed}>{elapsedOf(run)}</span>}
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

/** C7: a hired agent's duties, one fold away. The engine checks them again; the refusal shows beside the field. */
function HiredDuties({ agent, duties, onChanged }: { agent: string; duties: string[]; onChanged: () => void }) {
  const t = useT();
  const client = useEngine();
  const [text, setText] = useState(duties.join('\n'));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function save() {
    setBusy(true); setProblem(null);
    try { await client.request('venture.agents.hire.duties', { agent, duties: text.split('\n').map((line) => line.trim()).filter(Boolean) }); onChanged(); }
    catch (error) { setProblem(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return (
    <details className={s.hireFold}>
      <summary>{t('team.hire.change')}</summary>
      <Field multiline rows={4} label={t('team.hire.duties')} hint={t('team.hire.dutiesHint')} value={text} onChange={(event) => setText(event.currentTarget.value)} />
      {problem && <p className={s.hireProblem} role="alert">{problem}</p>}
      <Button size="sm" disabled={busy} onClick={() => void save()}>{t('team.hire.saveDuties')}</Button>
    </details>
  );
}
