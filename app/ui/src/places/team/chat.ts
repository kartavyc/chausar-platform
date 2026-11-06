import { formatDay } from '../../../../../platform/shared/owner-format.ts';
import type { AgentThreadItem, AgentView, ChatPart, DiffLine, UiRunEvent } from '../../engine/types';
import type { DiffLine as CardLine } from '../../parts/DiffCard';
import { isKeeper } from './departments';
import { refreshOn } from './shared';

/**
 * Helpers the agent panel's Chat, Instructions and Notes tabs share (W4 4B3): which agents have a chat, an item's id
 * in the thread, a message's words, the engine's diff lines as DiffCard draws them, and a day in the UI's language.
 */

/**
 * The panel's tabs, in order, in one row (D-TeamChat). Opened by name the panel shows Instructions; the quiet Chat
 * button opens Chat. W4 4J22b adds Can do (its skills with "Try this", then its capability page); how it talks (the
 * persona and the agent file) sits inside Instructions, so the row keeps to five at 390 px, in Hindi too.
 */
export const AGENT_TABS = ['chat', 'instructions', 'runs', 'notes'] as const;
export type AgentTab = (typeof AGENT_TABS)[number];
export const FIRST_TAB: AgentTab = 'instructions';

/** An agent the owner can talk to: AI, not code (Keeper and the code roles have no chat, engine 4B1 AGENT_IS_CODE). */
export function canChat(agent: AgentView): boolean {
  return !isKeeper(agent) && agent.kind !== 'code' && agent.chat !== false;
}

/** Chat, notes and the playbook change as messages arrive and runs move. */
export const chatRefresh = (event: UiRunEvent): boolean => event.type === 'agent.message' || refreshOn(event);

/** An item's id in the thread, as venture.agents.thread.list's `before` names it. */
export function itemId(item: AgentThreadItem): string {
  return item.type === 'message' ? item.message.id : item.type === 'proposal' ? item.proposal.id : item.run.runId;
}

/** A message's words, figures as the engine formatted them. */
export function partsText(parts: readonly ChatPart[]): string {
  return parts.map((part) => (part.kind === 'figure' ? part.display : part.text)).join(' ');
}

/** The engine's diff lines (same, add, remove) as DiffCard's (same, added, removed). */
export function cardLines(diff: readonly DiffLine[]): CardLine[] {
  return diff.map((line) => ({ kind: line.op === 'add' ? 'added' : line.op === 'remove' ? 'removed' : 'same', text: line.text }));
}

/** An ISO day or time as a short date ("23 Oct"), a time read in the owner's zone (B2), or the text as it came when it is not one. */
export function dayWords(at: string, zone: string): string {
  return formatDay(at, zone, 'short');
}
