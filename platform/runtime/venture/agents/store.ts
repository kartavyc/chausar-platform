// Chausar venture launcher, agents (Ink v2 wave 4, package 4-0): the record write agent threads share, so 4B1, 4C1
// (brief-agent) and 4J12 (agent-to-agent reports) can write the same records side by side. Writes only, inside the
// caller's ventureAction: the caller checks the words (keys refused, model numbers labelled) and emits agent.message.
import type { AgentMessageFrom, AgentMessageRecord, AgentSuggestion, ChatPart, LineAuthor } from '../contracts.ts';
import type { VentureTx } from '../records.ts';

export type AgentMessageInput = {
  agent: string;
  from: AgentMessageFrom;
  text: string;
  parts?: ChatPart[];
  author: LineAuthor;
  callId?: string | null;
  runId?: string | null;
  proposalId?: string | null;
  suggestion?: AgentSuggestion | null;
  answered?: { runId: string; handoff: number } | null;
};

/** Stores one message in an agent's thread and returns it. Without parts, the text is its one part. */
export function appendAgentMessage(tx: VentureTx, input: AgentMessageInput): AgentMessageRecord {
  return tx.put<AgentMessageRecord>({
    ...tx.base('venture-agent-message'), agent: input.agent, from: input.from, text: input.text,
    parts: input.parts ?? [{ kind: 'text', text: input.text }], author: input.author,
    callId: input.callId ?? null, runId: input.runId ?? null, proposalId: input.proposalId ?? null,
    suggestion: input.suggestion ?? null, answered: input.answered ?? null,
  });
}
