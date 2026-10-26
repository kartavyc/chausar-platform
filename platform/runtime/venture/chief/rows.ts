// Chausar venture launcher, chief (Ink v2 wave 4, package 4C1): Today's 'proposal' rows, one per proposal the owner
// raised from Chats, and 4B1's floor requests from agent chat, which 4B1 raises when it drafts them. A card says what
// it does and "Nothing changes until you approve", with Approve (a second ask when it spends or sends) and Not now. A
// card whose proposal no longer passes the gate (gate.ts) says why and offers only Dismiss. Decisions on these rows go
// to views/queue-w4.ts, which hands them to proposals.ts (decideProposal). Reads only.
import type { Context, State } from '../../contracts.ts';
import type { ProposalRecord, QueueAction, VentureDeps, VentureRecord } from '../contracts.ts';
import { listRecords } from '../records.ts';
import { chatAgent } from '../agents/roles.ts';
import type { W4RowItem } from '../views/queue-w4.ts';
import { NOTHING_CHANGES, proposalGate, proposalSubject, rowVersion } from './gate.ts';

/** The card's line: what the proposal does, then "Nothing changes until you approve" (4B1's floor lines end with it already). */
function cardLine(record: ProposalRecord): string {
  const said = record.line.trim();
  if (said.includes(NOTHING_CHANGES)) return said;
  return said ? `${said} ${NOTHING_CHANGES}` : NOTHING_CHANGES;
}

/** The agent's name on the card, when the proposal is for one of the team's agents. */
function agentOn(state: State, venture: VentureRecord, record: ProposalRecord): { agent?: string } {
  if (!record.agent) return {};
  try { return { agent: chatAgent(state, venture, record.agent).name }; } catch { return {}; }
}

/** One raised proposal's card. */
export function proposalRow(state: State, venture: VentureRecord, record: ProposalRecord): W4RowItem {
  const gate = proposalGate(state, venture, record);
  const head = {
    kind: 'proposal' as const, subject: proposalSubject(record.id), version: rowVersion(state, venture, record),
    createdAt: record.raisedAt ?? record.at, title: record.title, ...agentOn(state, venture, record),
  };
  if (!gate.ok) return { ...head, line: `This can't go ahead now: ${gate.reason}`, actions: [{ id: 'deny', label: 'Dismiss', primary: true }] };
  const approve: QueueAction = { id: 'approve', label: 'Approve', primary: true, ...(record.spends || record.sends ? { secondAsk: true } : {}) };
  // 4E3: a next step drafted from meeting notes that wrote no day: Approve takes the day as its answer.
  const undated = record.proposalKind === 'next-step' && (record.input as { due?: unknown } | null)?.due === null;
  return {
    ...head, line: cardLine(record), actions: [{ id: 'deny', label: 'Not now', primary: false }, approve],
    ...(undated ? { needs: { answer: 'day' as const, line: 'Pick the day for this step, then approve.' } } : {}),
  };
}

/** The open business's proposal rows: every raised proposal, oldest first. */
export function proposalRows(_deps: VentureDeps, _ctx: Context, state: State, venture: VentureRecord): W4RowItem[] {
  return listRecords(state, 'venture-proposal', venture.id).filter(record => record.status === 'raised').map(record => proposalRow(state, venture, record));
}
