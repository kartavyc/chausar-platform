import { ModelEstimate } from '../../parts/ModelEstimate';
import { Receipt } from '../../parts/Receipt';
import type { Posture, RunSummary, VentureRunEvent } from '../../engine/types';

/** Team reads change when a run moves, and when the business or its queue changes (a switch arrives as queue.changed). */
export const refreshOn = (event: VentureRunEvent): boolean => event.type.startsWith('run.') || event.type === 'queue.changed';

/** The run an agent is on now: one waiting on the owner first, else one at work. Runs name their agent. */
export function currentRun(runs: readonly RunSummary[] | undefined, agent: string): RunSummary | undefined {
  const mine = (runs ?? []).filter((run) => run.agent === agent);
  return mine.find((run) => run.state === 'waiting') ?? mine.find((run) => run.state === 'active');
}

/** The agent's row on the Team page. A run opened from the agent sheet gives focus back to it when it closes. */
export function agentRow(agentId: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>('#main [data-row-id]')) {
    if (element.getAttribute('data-row-id') === agentId) return element;
  }
  return null;
}

export const POSTURES: readonly Posture[] = ['rehearsal', 'shadow', 'approve-each', 'auto-spot-check'];

/** A result line as the engine wrote it: with its receipt, or labelled a model estimate (never both). */
export function Result({ line, receiptId, estimate }: { line: string; receiptId?: string | undefined; estimate?: boolean | undefined }) {
  if (estimate) return <ModelEstimate value={line} />;
  return <>{line}{receiptId && <> <Receipt id={receiptId} /></>}</>;
}
