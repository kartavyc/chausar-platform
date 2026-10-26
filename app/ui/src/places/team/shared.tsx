import { ModelEstimate } from '../../parts/ModelEstimate';
import { Receipt } from '../../parts/Receipt';
import type { AvatarState } from '../../parts/Avatar';
import type { ProgressTone } from '../../parts/ProgressRing';
import { stateText } from '../../parts/states';
import type { T } from '../../text';
import type { AgentView, Posture, RunSummary, VentureRunEvent } from '../../engine/types';
import { stateOf, type AgentState, type Member } from './departments';

/** Team reads change when a run moves, and when the business or its queue changes (a switch arrives as queue.changed). */
export const refreshOn = (event: VentureRunEvent): boolean => event.type.startsWith('run.') || event.type === 'queue.changed';

/** The run an agent is on now: one waiting on the owner first, else one at work. Runs name their agent. */
export function currentRun(runs: readonly RunSummary[] | undefined, agent: string): RunSummary | undefined {
  const mine = (runs ?? []).filter((run) => run.agent === agent);
  return mine.find((run) => run.state === 'waiting') ?? mine.find((run) => run.state === 'active');
}

/** Each agent with its run now and its state, in the engine's order. */
export function membersOf(agents: readonly AgentView[], runs: readonly RunSummary[] | undefined): Member[] {
  return agents.map((agent) => ({ agent, run: currentRun(runs, agent.name), state: stateOf(agent, runs) }));
}

/** Team's order: agents doing something (working, waiting, stopped) first, then idle ones, each in the engine's order. */
export function busyFirst(members: readonly Member[]): Member[] {
  return [...members.filter((m) => m.state !== 'idle'), ...members.filter((m) => m.state === 'idle')];
}

/** The agent's card on the Team page. A run opened from the agent panel gives focus back to it when it closes. */
export function agentRow(agentId: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>('#main [data-row-id]')) {
    if (element.getAttribute('data-row-id') === agentId) return element;
  }
  return null;
}

export const POSTURES: readonly Posture[] = ['rehearsal', 'shadow', 'approve-each', 'auto-spot-check'];

/** The avatar's ring for a state (idle draws none). */
export const RING: Readonly<Record<AgentState, AvatarState>> = { working: 'working', waiting: 'waiting', failed: 'failed', idle: 'idle' };

/** A progress bar's or ring's tone for a run. */
export function toneOf(run: RunSummary): ProgressTone {
  return run.state === 'waiting' ? 'waiting' : run.state === 'failed' ? 'failed' : 'working';
}

/**
 * A run's time so far; nothing while it waits on the owner (4Z2): its clock is not running then, and "Waiting on you"
 * already says so, where "paused" beside it read as a second state.
 */
export function elapsedOf(run: RunSummary): string | undefined {
  return run.state === 'waiting' ? undefined : run.elapsed;
}

/** An agent's state in words: the run words from states.ts (Working, Waiting on you, Stopped), or Idle. */
export function stateWords(t: T, state: AgentState): string {
  if (state === 'idle') return t('team.idle');
  return stateText(t, 'run', state === 'working' ? 'active' : state);
}

/** A result line as the engine wrote it: with its receipt, or labelled a model estimate (never both). */
export function Result({ line, receiptId, estimate }: { line: string; receiptId?: string | undefined; estimate?: boolean | undefined }) {
  if (estimate) return <ModelEstimate value={line} />;
  return <>{line}{receiptId && <> <Receipt id={receiptId} /></>}</>;
}
