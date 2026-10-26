// Chausar venture launcher, agents (Ink v2 wave 4, package 4B1, catalogue A2, spec 5.2): one thread per agent per
// business. venture.agents.thread.list reads it as a conversation in time order: the owner's messages, the agent's
// replies, one folded item per run the agent owned a step in, and the changes it proposed, with the question its run
// waits on kept in one fixed place. venture.agents.thread.send takes the owner's words: keys are refused before
// anything else, the chat consent is checked, and code decides what the words ask for (standing.ts, answer.ts).
// Every stored message emits agent.message with ids only.
import { check, type Context, type State } from '../../contracts.ts';
import type { AgentMessageRecord, AgentMessageView, AgentRunItem, AgentSendResult, AgentThreadItem, AgentThreadView, ProposalRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { exactPayload, findRecord, identifier, listRecords, plainText, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import { secretFindings } from '../core/secrets.ts';
import { deliveryAnswerHandler } from '../delivery/runs.ts';
import { ownerControlReason } from '../delivery/harness/patches.ts';
import { ensurePlaybook } from '../delivery/playbook.ts';
import { readAs } from '../delivery/shared.ts';
import { draftProposal } from '../chief/store.ts';
import { short } from '../views/shared.ts';
import { appendAgentMessage, type AgentMessageInput } from './store.ts';
import { agentRuns, answerQuestion, holdsIdNumber, intentOf, offerFor, waitingOn, type Answer, type FloorRequest } from './answer.ts';
import { chatConsentState, requireChatConsent } from './consent.ts';
import { draftPatch, NOTE_REPLY, proposalView, STANDING_REPLY, storeInstruction, storeNoteProposal, templatePatch, type DraftedPatch } from './proposals.ts';
import { chatAgent, type ChatAgent } from './roles.ts';
import { noteText } from './recall.ts';
import { detectStanding, onlyAsks } from './standing.ts';

const PAGE = 50;
const MAX_WORDS = 2000;
export const KEY_REFUSED = 'That looks like a key. Keys go in Connections, never in chat.';
export const ID_REFUSED = 'That looks like a card, bank account, Aadhaar or one-time code number. Chats never send those, so nothing was sent or kept.';
// The check itself lives beside the facts screen (answer.ts), which uses the same rule.
export { holdsIdNumber };
const FLOOR_REPLY = 'That needs your approval on Today.';
const WORK_REPLY = 'I can start on that as a new order. Check the details in New order, then create it.';
const ANSWERED_LINE = 'I passed this on as your answer to my question. The next step waits for your approval on Today.';
/** What the Recalled chip shows for a note the owner forgot after the run carried it (4B2). */
const FORGOTTEN_NOTE = 'A note you have forgotten since.';

// ---------------------------------------------------------------------------
// The thread as the owner reads it
// ---------------------------------------------------------------------------

/**
 * One message as the thread shows it. The reply to a request on the floor names the drafted proposal it raised to
 * Today (a venture-proposal, not an instruction or note proposal in the thread), so the thread can open its card (4B3).
 */
function messageView(record: AgentMessageRecord, state?: State): AgentMessageView {
  const today = state && record.from !== 'owner' && record.proposalId && findRecord(state, 'venture-proposal', record.proposalId) ? record.proposalId : null;
  return {
    id: record.id, at: record.at, from: record.from, parts: record.parts,
    ...(record.suggestion ? { suggestion: record.suggestion } : {}), ...(record.answered ? { answered: { runId: record.answered.runId } } : {}),
    ...(today ? { proposalId: today } : {}),
  };
}

/**
 * This agent's notes a run's turns carried (turn.recalled, 4B2), by id and words, for the run's Recalled chip. A note
 * forgotten since still counts, as it was sent, but shows no words.
 */
function recalledIn(state: State, venture: VentureRecord, runId: string, agent: ChatAgent): AgentRunItem['recalled'] {
  const run = listRecords(state, 'venture-delivery-run', venture.id).find(item => item.id === runId);
  const ids = new Set((run?.harness?.turns ?? []).filter(turn => !turn.role || turn.role === agent.id).flatMap(turn => turn.recalled ?? []));
  return listRecords(state, 'venture-agent-note', venture.id).filter(note => ids.has(note.id) && note.agent === agent.id)
    .map(note => (note.forgotten ? { id: note.id, text: FORGOTTEN_NOTE, forgotten: true } : { id: note.id, text: noteText(note) }));
}

/** Every item of one agent's thread in time order, each with its id; records written in one commit keep their order. */
function threadItems(deps: VentureDeps, state: State, venture: VentureRecord, agent: ChatAgent): { id: string; item: AgentThreadItem }[] {
  const order = new Map(state.conversations.map((record, index) => [record?.id as string, index]));
  const items: { id: string; at: string; seq: number; item: AgentThreadItem }[] = [];
  for (const record of listRecords(state, 'venture-agent-message', venture.id)) {
    if (record.agent === agent.id) items.push({ id: record.id, at: record.at, seq: order.get(record.id) ?? 0, item: { type: 'message', message: messageView(record, state) } });
  }
  for (const record of listRecords(state, 'venture-agent-proposal', venture.id)) {
    if (record.agent === agent.id) items.push({ id: record.id, at: record.at, seq: order.get(record.id) ?? 0, item: { type: 'proposal', proposal: proposalView(state, venture, record, agent.name) } });
  }
  for (const { detail, steps } of agentRuns(deps, state, venture, agent)) {
    const done = steps.filter(step => step.state === 'done' && step.audited !== false).length;
    items.push({
      id: detail.runId, at: detail.startedAt, seq: order.get(detail.runId) ?? 0,
      item: { type: 'run', run: { runId: detail.runId, at: detail.startedAt, purpose: detail.purpose, state: detail.state, done, total: steps.length, steps, recalled: recalledIn(state, venture, detail.runId, agent) } },
    });
  }
  return items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.seq - b.seq)).map(({ id, item }) => ({ id, item }));
}

/**
 * venture.agents.thread.list { agent, before? } (read): the agent's thread, newest page of fifty, oldest first; before
 * names the oldest item shown, for the page of fifty before it. waiting: the question the agent's run waits on the
 * owner for. consent: what the chat consent needs. Keeper and the code roles have no thread (AGENT_IS_CODE).
 */
export async function threadListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AgentThreadView> {
  const body = exactPayload(payload, ['agent', 'before'], ['agent']);
  const agentId = identifier(body.agent, 'Agent');
  const before = body.before === undefined ? null : identifier(body.before, 'Before');
  const { state, venture } = readAs(deps, ctx, 'read');
  const agent = chatAgent(state, venture, agentId);
  const all = threadItems(deps, state, venture, agent);
  const end = before === null ? all.length : all.findIndex(entry => entry.id === before);
  check(end >= 0, 'INVALID_VENTURE_REQUEST', 'That item is not in this thread.');
  const start = Math.max(0, end - PAGE);
  return {
    agent: { id: agent.id, name: agent.name, role: agent.job }, items: all.slice(start, end).map(entry => entry.item),
    waiting: waitingOn(deps, state, venture, agent), more: start > 0, consent: chatConsentState(deps, ctx, state, venture).view,
  };
}

// ---------------------------------------------------------------------------
// The owner's words
// ---------------------------------------------------------------------------

/** Stores one message and announces it with ids only. */
function put(tx: VentureTx, input: AgentMessageInput): AgentMessageRecord {
  const record = appendAgentMessage(tx, input);
  tx.emit('agent.message', { agent: record.agent, messageId: record.id });
  return record;
}

const asItem = (record: AgentMessageRecord, state?: State): AgentThreadItem => ({ type: 'message', message: messageView(record, state) });

/**
 * venture.agents.thread.send { agent, text } (prepare, app only): the owner talks to an agent. Keys are refused before
 * anything is stored (CHAT_KEY_REFUSED); then the chat consent must hold, unless only templates answer. Code decides
 * what the words ask for:
 * - "from now on" (standing.ts): the agent drafts a change to its instructions, stored as a proposal for Accept;
 * - "remember that" (standing.ts): code drafts a note from the words, quoting them, stored as a note proposal (4B2);
 * - while the agent's run waits on the owner's question: the words are its answer, through venture.delivery.answer;
 * - a request on the floor (publish, send, money, prices): a drafted proposal for Today, and "That needs your approval on Today.";
 * - a request for work: a prefilled New order suggestion, nothing created;
 * - anything else: one answer from the agent's own facts.
 * options.routine (4J13): a routine's prompt the owner ran from Today. It is never a standing order or a note, and never
 * the answer to a question the agent's run waits on: it goes on from the floor check as any other message.
 */
export async function threadSendHandler(deps: VentureDeps, ctx: Context, payload: unknown, options: { routine?: boolean } = {}): Promise<AgentSendResult> {
  requireAppChannel(ctx, 'venture.agents.thread.send');
  const body = exactPayload(payload, ['agent', 'text'], ['agent', 'text']);
  const agentId = identifier(body.agent, 'Agent');
  const words = plainText(body.text, 'Your message', { min: 1, max: MAX_WORDS });
  check(secretFindings(words).length === 0, 'CHAT_KEY_REFUSED', KEY_REFUSED);
  check(!holdsIdNumber(words), 'CHAT_KEY_REFUSED', ID_REFUSED);
  let { state, venture } = readAs(deps, ctx, 'prepare');
  chatAgent(state, venture, agentId);
  const route = requireChatConsent(deps, ctx, state, venture);
  const kind = options.routine ? null : detectStanding(words);

  // A standing request that would change what always asks the owner, spend, prices, tools, checks or limits is never
  // drafted as guidance: the agent says why, and no model is asked.
  const control = kind === 'standing' ? ownerControlReason(words) : null;
  if (control !== null) {
    return ventureAction(deps, ctx, 'prepare', 'agents.thread.send', tx => {
      const live = chatAgent(tx.state, tx.venture!, agentId);
      const said = put(tx, { agent: live.id, from: 'owner', text: words, author: 'owner' });
      const reply = put(tx, { agent: live.id, from: 'agent', text: `I can't take that as an instruction: ${control}`, author: 'engine' });
      return { added: [asItem(said), asItem(reply)], line: null };
    });
  }

  if (kind === 'standing') {
    // The version in use, stored, so the change names the playbook it is drafted against.
    await ensurePlaybook(deps, ctx);
    ({ state, venture } = readAs(deps, ctx, 'prepare'));
    const agent = chatAgent(state, venture, agentId);
    const drafted = await draftPatch(deps, ctx, route, agent, words);
    const own = templatePatch(agent, words);
    const drafts: { patch: DraftedPatch; fromWords: boolean }[] = [...(drafted ? [{ patch: drafted.patch, fromWords: false }] : []), ...(own ? [{ patch: own, fromWords: true }] : [])];
    return ventureAction(deps, ctx, 'prepare', 'agents.thread.send', tx => {
      const live = chatAgent(tx.state, tx.venture!, agentId);
      const said = put(tx, { agent: live.id, from: 'owner', text: words, author: 'owner' });
      const outcome = storeInstruction(tx, { agent: live, playbook: live.playbook!, messageId: said.id, words, drafts });
      if ('refused' in outcome) {
        const reply = put(tx, { agent: live.id, from: 'agent', text: `I can't take that as an instruction: ${outcome.refused}`, author: 'engine' });
        return { added: [asItem(said), asItem(reply)], line: null };
      }
      const reply = put(tx, { agent: live.id, from: 'agent', text: STANDING_REPLY, author: 'engine', proposalId: outcome.proposal.id, callId: drafted?.callId ?? null });
      return { added: [asItem(said), { type: 'proposal', proposal: proposalView(tx.state, tx.venture!, outcome.proposal, live.name) }, asItem(reply)], line: null };
    });
  }

  // Words to remember become a note proposal that quotes them (4B2); code drafts it, no model is asked.
  if (kind === 'note') return noteRequest(deps, ctx, agentId, words);

  const agent = chatAgent(state, venture, agentId);
  const waiting = waitingOn(deps, state, venture, agent);
  if (waiting && kind === null && !options.routine && !onlyAsks(words)) {
    // A reply while the run waits on the owner counts as the answer (A2): the delivery answer path previews the next
    // turn, and the owner's message is written in the same commit. A question that only asks is answered instead.
    let said: AgentMessageRecord | null = null;
    await deliveryAnswerHandler(deps, ctx, { runId: waiting.runId, answer: words }, (tx, handoff) => {
      said = put(tx, { agent: agent.id, from: 'owner', text: words, author: 'owner', runId: waiting.runId, answered: { runId: waiting.runId, handoff } });
    });
    return { added: [asItem(said!)], line: ANSWERED_LINE };
  }

  const intent = intentOf(words, agent.team);
  if (intent.kind === 'floor') return floorRequest(deps, ctx, agent.id, words, intent);
  if (intent.kind === 'work') {
    const offerId = offerFor(state, venture, words);
    return ventureAction(deps, ctx, 'prepare', 'agents.thread.send', tx => {
      const said = put(tx, { agent: agent.id, from: 'owner', text: words, author: 'owner' });
      const reply = put(tx, { agent: agent.id, from: 'agent', text: WORK_REPLY, author: 'engine', suggestion: { kind: 'order', offerId, request: words } });
      return { added: [asItem(said), asItem(reply)], line: null };
    });
  }
  const answer: Answer = await answerQuestion(deps, ctx, route, { state, venture, agent, question: words, waiting });
  return ventureAction(deps, ctx, 'prepare', 'agents.thread.send', tx => {
    const said = put(tx, { agent: agent.id, from: 'owner', text: words, author: 'owner' });
    const text = answer.parts.map(part => (part.kind === 'figure' ? part.display : part.text)).join(' ');
    const reply = put(tx, { agent: agent.id, from: 'agent', text, parts: answer.parts, author: answer.author, callId: answer.callId });
    return { added: [asItem(said), asItem(reply)], line: answer.line };
  });
}

/**
 * A request on the floor: never done from chat. It is stored with draftProposal (kind start-work) and raised to Today
 * here, once (raisedAt, one proposal.created); 4C1 lists raised proposals on Today and decides them there, and never
 * announces a raised one again. The agent says it needs the owner's approval on Today.
 */
async function floorRequest(deps: VentureDeps, ctx: Context, agentId: string, words: string, intent: FloorRequest): Promise<AgentSendResult> {
  return ventureAction(deps, ctx, 'prepare', 'agents.thread.send', tx => {
    const agent = chatAgent(tx.state, tx.venture!, agentId);
    const said = put(tx, { agent: agent.id, from: 'owner', text: words, author: 'owner' });
    const step = intent.stepId ? agent.team.find(item => item.id === intent.stepId) : undefined;
    const proposal = draftProposal(tx, {
      kind: 'start-work', source: 'agent', agent: agent.id, messageId: said.id, title: short(words, 120),
      line: step ? `This is the "${step.title}" step, which always asks you first. Nothing changes until you approve.` : 'Publishing, sending, money and prices always ask you first. Nothing changes until you approve.',
      input: { agent: agent.id, request: words, stepId: intent.stepId }, spends: intent.spends, sends: intent.sends,
    });
    tx.replace<ProposalRecord>({ ...proposal, status: 'raised', raisedAt: tx.now });
    tx.emit('proposal.created', { proposalId: proposal.id });
    const reply = put(tx, { agent: agent.id, from: 'agent', text: FLOOR_REPLY, author: 'engine', proposalId: proposal.id });
    return { added: [asItem(said), asItem(reply, tx.state)], line: null };
  });
}

/**
 * Words the owner asks the agent to remember (4B2): code drafts the note from them and stores a note proposal that
 * quotes them and shows the note as it will be saved (proposals.ts storeNoteProposal). Nothing is written to the
 * agent's notes until the owner accepts. Words the note rules refuse get the agent's reason; words already said no
 * to, or a note already waiting or kept, get one line and no proposal. No model is asked.
 */
async function noteRequest(deps: VentureDeps, ctx: Context, agentId: string, words: string): Promise<AgentSendResult> {
  return ventureAction(deps, ctx, 'prepare', 'agents.thread.send', tx => {
    const agent = chatAgent(tx.state, tx.venture!, agentId);
    const said = put(tx, { agent: agent.id, from: 'owner', text: words, author: 'owner' });
    const outcome = storeNoteProposal(tx, { agent, messageId: said.id, words });
    if (!('proposal' in outcome)) {
      const text = 'refused' in outcome ? `I can't keep that as a note: ${outcome.refused}` : outcome.skipped;
      return { added: [asItem(said), asItem(put(tx, { agent: agent.id, from: 'agent', text, author: 'engine' }))], line: null };
    }
    const reply = put(tx, { agent: agent.id, from: 'agent', text: NOTE_REPLY, author: 'engine', proposalId: outcome.proposal.id });
    return { added: [asItem(said), { type: 'proposal', proposal: proposalView(tx.state, tx.venture!, outcome.proposal, agent.name) }, asItem(reply)], line: null };
  });
}
