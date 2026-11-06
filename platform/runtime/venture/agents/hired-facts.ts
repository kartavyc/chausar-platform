// C7 task 15: what a hired agent answers from: only what its hire says it reads, through the chief's own read tools
// (each screened, each figure with its receipt, a client's records only with that client's AI permission). Without the
// money read no figure and no amount reaches its AI. Notes and trackers are its own: its notes, and the trackers it keeps.
import type { Context } from '../../contracts.ts';
import type { Json, VentureDeps } from '../contracts.ts';
import { listRecords } from '../records.ts';
import { readAs } from '../delivery/shared.ts';
import { runTool, type ToolFigure } from '../chief/tools.ts';
import { chiefClientContext } from '../chief/client-context.ts';
import type { ChatAgent } from './roles.ts';
import type { HireRead } from './hire-check.ts';

/** Said when a "from now on" goes to a hired agent. */
export const HIRE_DUTIES_LINE = "A hired agent's duties change in its sheet on Team. Open it there to change what I do.";
export const HIRE_POSTURE_LINE = 'An agent you hired always asks you first. This cannot be loosened.';

const TOOL_OF: Partial<Record<HireRead, string>> = { clients: 'clients', orders: 'clients', runs: 'runs', money: 'money', plan: 'plan', journal: 'journal' };
/** Field names that hold an amount: with no money read they are left out of what the agent's AI reads. */
const MONEY_FIELD = /owe|owed|total|amount|paid|billed|received|earned|price|spend|spent|cost|figure|receipt/i;

function withoutMoney(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutMoney);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !MONEY_FIELD.test(key)).map(([key, item]) => [key, withoutMoney(item)]));
}

/** The facts of a hired agent's reads, by read, and the figures it may quote (only with the money read). */
export async function hiredFacts(deps: VentureDeps, ctx: Context, agent: ChatAgent): Promise<{ reads: Record<string, Json>; figures: ToolFigure[] }> {
  const { state, venture } = readAs(deps, ctx, 'read');
  const chosen = new Set((agent.hired?.reads ?? []).map(item => item.read));
  const scope = chiefClientContext(deps, venture.id);
  const reads: Record<string, Json> = {};
  let figures: ToolFigure[] = [];
  const asked = new Set<string>();
  for (const read of chosen) {
    const tool = TOOL_OF[read];
    if (tool && !asked.has(tool)) {
      asked.add(tool);
      const result = await runTool(deps, ctx, tool, scope);
      if ('error' in result) continue;
      reads[read] = (chosen.has('money') ? result.data : withoutMoney(result.data)) as Json;
      if (chosen.has('money')) figures = [...figures, ...result.figures];
    }
    if (read === 'notes') reads.notes = listRecords(state, 'venture-agent-note', venture.id).filter(note => note.agent === agent.id).map(note => note.text);
    if (read === 'trackers') {
      const kept = listRecords(state, 'venture-tracker', venture.id).filter(tracker => tracker.keptBy.includes(agent.id));
      reads.trackers = kept.map(tracker => ({ name: tracker.name, columns: tracker.columns.map(column => column.name) }));
    }
  }
  return { reads, figures };
}
