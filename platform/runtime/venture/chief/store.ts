// Chausar venture launcher, chief (Ink v2 wave 4, package 4-0): the record writes Chats and proposals share, so 4B1,
// 4C1, 4E3 and 4J18 can write the same records side by side. Writes only, inside the caller's ventureAction: the caller
// checks the words and the consent, and emits chief.message or proposal.created.
import type {
  ChatPart, ChiefMessageRecord, ChiefThreadRecord, Json, LineAuthor, ProposalKind, ProposalRecord,
} from '../contracts.ts';
import { digest, type VentureTx } from '../records.ts';

export type ChiefMessageInput = {
  threadId: string;
  from: ChiefMessageRecord['from'];
  text: string;
  parts?: ChatPart[];
  author: LineAuthor;
  callIds?: string[];
  receiptIds?: string[];
  proposalIds?: string[];
  routedTo?: string | null;
};

/** Stores one message in a Chats thread and moves the thread's last time to now. The owner's own message is read. */
export function appendChiefMessage(tx: VentureTx, input: ChiefMessageInput): ChiefMessageRecord {
  const message = tx.put<ChiefMessageRecord>({
    ...tx.base('venture-chief-message'), threadId: input.threadId, from: input.from, text: input.text,
    parts: input.parts ?? [{ kind: 'text', text: input.text }], author: input.author,
    callIds: input.callIds ?? [], receiptIds: input.receiptIds ?? [], proposalIds: input.proposalIds ?? [],
    routedTo: input.routedTo ?? null, read: input.from === 'owner',
  });
  const thread = tx.find('venture-chief-thread', input.threadId);
  if (thread) tx.replace<ChiefThreadRecord>({ ...thread, lastAt: tx.now });
  return message;
}

export type ProposalInput = {
  kind: ProposalKind;
  source: ProposalRecord['source'];
  title: string;
  line: string;
  input: Json;
  agent?: string | null;
  threadId?: string | null;
  messageId?: string | null;
  spends?: boolean;
  sends?: boolean;
};

/**
 * Stores a drafted proposal: nothing changes until the owner raises it to Today and approves it there. Its digest is
 * over what the owner approves (kind, words, the method's input, the agent, and whether it spends or sends).
 */
export function draftProposal(tx: VentureTx, input: ProposalInput): ProposalRecord {
  const agent = input.agent ?? null, spends = input.spends ?? false, sends = input.sends ?? false;
  return tx.put<ProposalRecord>({
    ...tx.base('venture-proposal'), proposalKind: input.kind, source: input.source,
    threadId: input.threadId ?? null, messageId: input.messageId ?? null, agent,
    title: input.title, line: input.line, input: input.input, spends, sends, status: 'drafted',
    digest: digest({ kind: input.kind, title: input.title, line: input.line, input: input.input, agent, spends, sends }),
    raisedAt: null, decidedAt: null, decidedBy: null, outcome: null,
  });
}
