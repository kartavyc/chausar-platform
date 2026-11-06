// Chausar venture launcher, agents (Ink v2 wave 4, package 4B1, catalogue A3): proposals in an agent's thread. A
// standing request ("from now on") becomes an instruction proposal: the agent drafts one typed patch on a step its role
// owns (through the owner's AI, or from the owner's own words with templates only), code checks it under the owner
// rules of applyPatch, and it waits as a venture-agent-proposal with the step's guidance before and after, the
// versions and the hash of the playbook it was drafted against. Accept writes a new playbook version (ownerVersion);
// reject stores the decision and changes nothing; a proposal drafted against an older version is stale. A note proposal
// (4B2) is drafted by code from the owner's own words, quoting them, and accept keeps the note (notes.ts); words the
// owner said no to are never proposed again. An agent never proposes on its own: only the owner's words start one.
import { check, newId, type Context, type State } from '../../contracts.ts';
import type {
  AgentProposalDecision, AgentProposalRecord, AgentProposalView, DiffLine, Json, ModelTask, PlaybookPatch, PlaybookRecord, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { digest, exactPayload, identifier, listRecords, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import { applyPatch, OWNER_PATCH_OPS, type PlaybookBody } from '../delivery/harness/patches.ts';
import { dictionaryEntries } from '../delivery/harness/dictionary.ts';
import { currentPlaybook, ensurePlaybook, ownerVersion } from '../delivery/playbook.ts';
import { readAs } from '../delivery/shared.ts';
import { appendAgentMessage } from './store.ts';
import { chatCall } from './answer.ts';
import type { ChatRoute } from './consent.ts';
import { chatAgent, guidedSteps, type ChatAgent } from './roles.ts';
import { standingValue } from './standing.ts';
import { ownerLines } from './versions.ts';
import { agentNotes, draftNote, isProblem, keepProposedNote, noteKey, noteReach, noteValue, roomProblem } from './notes.ts';
import { maskNote } from './recall.ts';
import { decideImport } from './export.ts';

/** The label on a change drafted from the owner's own words rather than by the owner's AI. */
export const FROM_YOUR_WORDS = 'Drafted by Chausar from your words';
/** The agent's reply when it drafts a change. */
export const STANDING_REPLY = "You said 'from now on', so here is the change to my instructions.";

/** The typed patch the agent drafts: one guidance change on one of its own steps. */
export type DraftedPatch = { stepId: string; op: 'guidance.add' | 'guidance.remove'; value: string };

const PATCH_INSTRUCTIONS = [
  'You are one agent of a small business the owner runs with Chausar. The owner told you how to work from now on, in their own words.',
  "Turn their words into exactly one change to the guidance of one of your steps: guidance.add with one short instruction in plain words that keeps the owner's meaning, or guidance.remove with one of your current guidance lines, copied exactly.",
  'Add no number, price or date the owner did not say, never ask for sums (the calculator does them), and never change tools, checks or limits.',
].join(' ');

function patchSchema(stepIds: readonly string[]): Json {
  return {
    type: 'object', additionalProperties: false, required: ['stepId', 'op', 'value'],
    properties: {
      stepId: { type: 'string', enum: [...stepIds] },
      op: { type: 'string', enum: [...OWNER_PATCH_OPS] },
      value: { type: 'string', description: 'For guidance.add, the instruction in plain words; for guidance.remove, the line to remove, copied exactly.' },
    },
  };
}

function validatePatch(stepIds: readonly string[]) {
  return (raw: unknown): DraftedPatch => {
    const record = raw as Record<string, unknown>;
    check(raw !== null && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(record).length === 3, 'MODEL_OUTPUT_REJECTED', 'The change was not one typed patch.');
    check(typeof record.stepId === 'string' && stepIds.includes(record.stepId), 'MODEL_OUTPUT_REJECTED', 'The change named a step that is not this agent\'s.');
    check(record.op === 'guidance.add' || record.op === 'guidance.remove', 'MODEL_OUTPUT_REJECTED', 'The change was not a guidance change.');
    check(typeof record.value === 'string' && record.value.length <= 240, 'MODEL_OUTPUT_REJECTED', 'The change was not short text.');
    return { stepId: record.stepId, op: record.op, value: record.value };
  };
}

/** The change drafted from the owner's own sentence, tidied, on the role's first agent or writing step. Null when it has none. */
export function templatePatch(agent: ChatAgent, words: string): DraftedPatch | null {
  const step = guidedSteps(agent)[0];
  return step ? { stepId: step.id, op: 'guidance.add', value: standingValue(words) } : null;
}

/**
 * The agent's draft of a standing change: the owner's AI writes one typed patch on a step the agent owns, or null with
 * templates only or when the answer came back in a shape Chausar refuses (the template from the owner's words follows).
 */
export async function draftPatch(deps: VentureDeps, ctx: Context, route: ChatRoute | null, agent: ChatAgent, words: string): Promise<{ patch: DraftedPatch; callId: string | null } | null> {
  const steps = guidedSteps(agent);
  if (!steps.length) return null;
  const stepIds = steps.map(step => step.id);
  const task: ModelTask<DraftedPatch> = {
    purpose: 'agent-chat', instructions: PATCH_INSTRUCTIONS,
    input: { agent: { name: agent.name, job: agent.job }, ownerWords: words, steps: steps.map(step => ({ id: step.id, kind: step.kind, title: step.title, guidance: [...(step.guidance ?? [])] })) },
    schemaName: 'venture-agent-patch', schema: patchSchema(stepIds), validate: validatePatch(stepIds), containsClientData: true, maxOutputTokens: 512,
  };
  const drafted = await chatCall(deps, ctx, route, task);
  return drafted ? { patch: drafted.value, callId: drafted.callId } : null;
}

function bodyOf(playbook: PlaybookRecord): PlaybookBody {
  return { steps: structuredClone(playbook.steps), limits: structuredClone(playbook.limits!), aliases: structuredClone(playbook.aliases ?? {}) };
}

/** applyPatch's context for an owner patch: the playbook's own context, with the agent's steps and the owner's earlier lines. */
function ownerContext(state: State, venture: VentureRecord, agent: ChatAgent, playbook: PlaybookRecord) {
  return {
    serviceType: playbook.serviceType, entryIds: dictionaryEntries(state, venture).map(entry => entry.id), flagship: playbook.flagship ?? null,
    owner: { steps: agent.stepIds, added: ownerLines(state, agent, playbook) },
  };
}

/** The step's guidance before and after, every line kept as context. */
function diffOf(before: readonly string[], patch: PlaybookPatch, after: readonly string[]): DiffLine[] {
  if (patch.op === 'guidance.remove') return before.map(text => ({ op: text === patch.value ? 'remove' as const : 'same' as const, text }));
  return [...before.map(text => ({ op: 'same' as const, text })), ...after.filter(text => !before.includes(text)).map(text => ({ op: 'add' as const, text }))];
}

export type DraftOutcome = { proposal: AgentProposalRecord } | { refused: string };

/**
 * Inside the send's transaction: builds the owner patch from each draft in turn (the AI's, then the owner's own
 * words), checks it with applyPatch under the owner rules against the playbook in use, and stores the first that
 * applies as a drafted instruction proposal. When none applies, returns the reason the owner's own words were refused.
 */
export function storeInstruction(tx: VentureTx, input: { agent: ChatAgent; playbook: PlaybookRecord; messageId: string; words: string; drafts: { patch: DraftedPatch; fromWords: boolean }[] }): DraftOutcome {
  const { agent, playbook, messageId, words } = input;
  const venture = tx.venture!;
  const context = ownerContext(tx.state, venture, agent, playbook);
  let refused = 'That did not make a change to my instructions.';
  for (const draft of input.drafts) {
    const patch: PlaybookPatch = {
      id: newId('patch'), level: 'harness', op: draft.patch.op, stepId: draft.patch.stepId, value: draft.patch.value,
      note: { hypothesis: 'You asked for this in chat.', expectedFixes: [], likelyRegressions: [] }, proposedBy: 'owner', parentHash: playbook.hash,
      source: { messageId, quote: words },
    };
    let after: PlaybookBody;
    try { after = applyPatch(bodyOf(playbook), patch, context); } catch (error) { refused = error instanceof Error ? error.message : refused; continue; }
    const before = playbook.steps.find(step => step.id === patch.stepId)!;
    const changed = after.steps.find(step => step.id === patch.stepId)!;
    // The stored value is the tidied words applyPatch kept.
    if (patch.op === 'guidance.add') patch.value = (changed.guidance ?? []).find(line => !(before.guidance ?? []).includes(line)) ?? patch.value;
    const versions = tx.list('venture-playbook').map(record => record.version);
    const fromVersion = playbook.version, toVersion = Math.max(0, ...versions) + 1;
    const record: AgentProposalRecord = {
      ...tx.base('venture-agent-proposal'), agent: agent.id, proposalKind: 'instruction', quote: words, quoteDigest: digest(words.trim().toLowerCase()),
      messageId, patch, fromVersion, toVersion, parentHash: playbook.hash, diff: diffOf(before.guidance ?? [], patch, changed.guidance ?? []),
      appliesTo: `Applies to "${before.title}" from the next run.`, note: null, label: draft.fromWords ? FROM_YOUR_WORDS : null,
      status: 'drafted', digest: '', decidedAt: null, decidedBy: null,
    };
    record.digest = digest({ id: record.id, agent: record.agent, patch: { id: patch.id, op: patch.op, stepId: patch.stepId, value: patch.value }, fromVersion, toVersion, parentHash: record.parentHash, quote: words });
    return { proposal: tx.put(record) };
  }
  return { refused };
}

/** Why a drafted change can no longer be decided: it was drafted against another version than the one in use. */
function staleLine(record: AgentProposalRecord, current: PlaybookRecord | null): string {
  return `This was drafted against version ${record.fromVersion ?? 0}; version ${current?.version ?? 0} is in use now. Ask again and I will redraft it.`;
}

function isStale(record: AgentProposalRecord, current: PlaybookRecord | null): boolean {
  // 4J17: an agent file's import is drafted against the version in use, like an instruction.
  return record.status === 'drafted' && (record.proposalKind === 'instruction' || record.proposalKind === 'import') && (!current || current.hash !== record.parentHash);
}

/** A proposal as the thread shows it: drafted, accepted, rejected, or stale with the engine's words. */
export function proposalView(state: State, venture: VentureRecord, record: AgentProposalRecord, agentName: string): AgentProposalView {
  const current = currentPlaybook(state, venture);
  const stale = isStale(record, current);
  return {
    id: record.id, at: record.at, agent: record.agent, kind: record.proposalKind, status: stale ? 'stale' : record.status, quote: record.quote,
    title: record.proposalKind === 'instruction' ? `Proposed change to ${agentName}'s instructions` : record.proposalKind === 'import' ? `Import an agent file into ${agentName}?` : 'Save this note?',
    appliesTo: record.appliesTo, diff: record.diff, fromVersion: record.fromVersion, toVersion: record.toVersion,
    note: record.note ? { text: record.note.text, scope: record.note.scope } : null, digest: record.digest,
    // A note proposal quotes the owner's words it came from, as masked, or says they were erased (4B2).
    line: stale ? staleLine(record, current) : record.proposalKind === 'note' ? (record.quote ? `You said: '${record.quote}'` : NOTE_ERASED_LINE) : null,
  };
}

/** Runs that are going now keep the version they started on; the line says which, by their number in this business. */
function inUseLine(state: State, venture: VentureRecord, version: number): string {
  const runs = listRecords(state, 'venture-delivery-run', venture.id);
  const going = runs.flatMap((run, index) => (['waiting-for-you', 'needs-answer', 'brief-waiting'].includes(run.status) ? [{ number: index + 1, playbookId: run.playbookId }] : []));
  if (!going.length) return `Version ${version} is in use now. You can undo it.`;
  const byVersion = new Map<number, number[]>();
  for (const run of going) {
    const kept = listRecords(state, 'venture-playbook', venture.id).find(item => item.id === run.playbookId)?.version ?? 0;
    byVersion.set(kept, [...(byVersion.get(kept) ?? []), run.number]);
  }
  const kept = [...byVersion.entries()].map(([old, numbers]) => numbers.length === 1
    ? `Run ${numbers[0]} keeps version ${old}.`
    : `Runs ${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)} keep version ${old}.`);
  return `Version ${version} is in use from the next run. ${kept.join(' ')}`;
}

// ---------------------------------------------------------------------------
// Note proposals (4B2)
// ---------------------------------------------------------------------------

/** The agent's reply when it proposes a note. */
export const NOTE_REPLY = 'Here is the note I would keep. Nothing is saved until you accept it.';
/** The agent's line when the owner accepts a note, posted in its thread too. */
export const NOTE_KEPT_LINE = "I'll keep this note. You can correct it, forget it or undo it in my notes.";
const NOTE_REJECTED_LINE = "You said no, so nothing was saved. I won't ask to keep these words again.";
const NOTE_SAID_NO = "You said no to keeping this note before, so I won't ask again. To keep it now, add it in my notes.";
const NOTE_WAITING = 'That note is waiting for your answer above.';
const NOTE_ALREADY = 'I already keep that note.';
/** A note proposal whose words were erased (the note forgotten, or a person it named forgotten). */
const NOTE_ERASED_LINE = 'These words were erased: you asked Chausar to forget them.';

/** What the owner's note words came to: a proposal; words refused, with why; or no proposal, with the agent's reply. */
export type NoteOutcome = { proposal: AgentProposalRecord } | { refused: string } | { skipped: string };

/**
 * Inside the send's transaction: the note the owner's own words make (noteValue), by code and never a model, checked
 * by the note rules (draftNote) and stored as a note proposal that quotes the words, masked like the note, and shows
 * the note as it will be saved. Nothing is written to the agent's notes until the owner accepts. A note the owner said
 * no to (keyed on the note's tidied words, however they were said) is never proposed again: the agent says how to add it
 * by hand instead. A note already waiting, or already kept, is not proposed twice.
 */
export function storeNoteProposal(tx: VentureTx, input: { agent: ChatAgent; messageId: string; words: string }): NoteOutcome {
  const { agent, messageId, words } = input;
  const venture = tx.venture!;
  const draft = draftNote(tx.state, venture, noteValue(words), words);
  if (isProblem(draft)) return { refused: draft.reason };
  const key = digest(noteKey(draft.text));
  const proposed = tx.list('venture-agent-proposal').filter(item => item.agent === agent.id && item.proposalKind === 'note');
  if (proposed.some(item => item.status === 'rejected' && item.quoteDigest === key)) return { skipped: NOTE_SAID_NO };
  if (proposed.some(item => item.status === 'drafted' && item.quoteDigest === key)) return { skipped: NOTE_WAITING };
  if (agentNotes(tx.state, venture, agent.id).some(note => noteKey(note.text) === noteKey(draft.text))) return { skipped: NOTE_ALREADY };
  const full = roomProblem(tx.state, venture, agent, draft, null);
  if (full !== null) return { refused: full };
  const quote = maskNote(words, draft.scope);
  const record: AgentProposalRecord = {
    ...tx.base('venture-agent-proposal'), agent: agent.id, proposalKind: 'note', quote, quoteDigest: key, messageId, patch: null,
    fromVersion: null, toVersion: null, parentHash: null, diff: [], appliesTo: noteReach(agent, draft), note: { scope: draft.scope, load: draft.load, text: draft.text },
    label: FROM_YOUR_WORDS, status: 'drafted', digest: '', decidedAt: null, decidedBy: null,
  };
  record.digest = digest({ id: record.id, agent: record.agent, note: record.note, quote, appliesTo: record.appliesTo });
  return { proposal: tx.put(record) };
}

/**
 * The note kind's decision (4B2). Accept keeps the note exactly as the owner read it, checked again by the note rules
 * and the room (NOTES_FULL), with a change row from the proposal, and the agent says so in its thread. Reject stores
 * the decision: nothing is saved, and these words are never proposed again.
 */
function decideNote(tx: VentureTx, record: AgentProposalRecord, decision: 'accept' | 'reject'): AgentProposalDecision {
  const venture = tx.venture!;
  const agent = chatAgent(tx.state, venture, record.agent);
  const decided = { decidedAt: tx.now, decidedBy: tx.ctx.memberId };
  if (decision === 'reject') {
    const stored = tx.replace<AgentProposalRecord>({ ...record, status: 'rejected', ...decided });
    return { proposal: proposalView(tx.state, venture, stored, agent.name), line: NOTE_REJECTED_LINE };
  }
  keepProposedNote(tx, agent, record);
  const stored = tx.replace<AgentProposalRecord>({ ...record, status: 'accepted', ...decided });
  const message = appendAgentMessage(tx, { agent: agent.id, from: 'agent', text: NOTE_KEPT_LINE, author: 'engine', proposalId: record.id });
  tx.emit('agent.message', { agent: agent.id, messageId: message.id });
  return { proposal: proposalView(tx.state, venture, stored, agent.name), line: NOTE_KEPT_LINE };
}

/**
 * venture.agents.proposal.decide { id, digest, decision } (approve, app only): the owner accepts or rejects a change
 * the agent drafted from the owner's words. digest: the proposal's digest as the owner saw it (APPROVAL_STALE
 * otherwise); a second decision is PROPOSAL_DECIDED; one drafted against another version than the one in use is
 * PROPOSAL_STALE (the agent redrafts when asked again). Accept writes a new playbook version from the one in use plus
 * this patch, checked again under the owner rules, and the business points at it; a run already going keeps its
 * version, and the line (also posted in the thread) says so. Reject stores the decision and changes nothing.
 */
export async function proposalDecideHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AgentProposalDecision> {
  requireAppChannel(ctx, 'venture.agents.proposal.decide');
  const body = exactPayload(payload, ['id', 'digest', 'decision'], ['id', 'digest', 'decision']);
  const id = identifier(body.id, 'Proposal');
  check(typeof body.digest === 'string' && /^[a-f0-9]{64}$/.test(body.digest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the change you read.');
  check(body.decision === 'accept' || body.decision === 'reject', 'INVALID_VENTURE_REQUEST', 'Choose accept or reject.');
  const seen = body.digest, decision = body.decision;
  const { state } = readAs(deps, ctx, 'approve');
  const found = listRecords(state, 'venture-agent-proposal').find(item => item.id === id);
  // A changed plan makes a new version first, so a change drafted against the old one reads as stale.
  if ((found?.proposalKind === 'instruction' || found?.proposalKind === 'import') && found.status === 'drafted') await ensurePlaybook(deps, ctx);
  return ventureAction(deps, ctx, 'approve', 'agents.proposal.decide', tx => {
    const venture = tx.venture!;
    const record = tx.find('venture-agent-proposal', id);
    check(record, 'INVALID_VENTURE_REQUEST', 'That change was not found.');
    check(record.status === 'drafted', 'PROPOSAL_DECIDED', 'You already decided this change.');
    check(record.digest === seen, 'APPROVAL_STALE', 'This change is not the one you read. Read it again.');
    if (record.proposalKind === 'note') return decideNote(tx, record, decision);
    const agent = chatAgent(tx.state, venture, record.agent);
    const current = currentPlaybook(tx.state, venture);
    check(current && !isStale(record, current), 'PROPOSAL_STALE', staleLine(record, current));
    // 4J17 (A18): an agent file's import (agents/export.ts).
    if (record.proposalKind === 'import') return decideImport(tx, record, decision);
    const decided = { decidedAt: tx.now, decidedBy: ctx.memberId };
    if (decision === 'reject') {
      const stored = tx.replace<AgentProposalRecord>({ ...record, status: 'rejected', ...decided });
      return { proposal: proposalView(tx.state, venture, stored, agent.name), line: 'You said no, so nothing changed.' };
    }
    const after = applyPatch(bodyOf(current), record.patch!, ownerContext(tx.state, venture, agent, current));
    const made = ownerVersion(tx, current, after, [...(current.patches ?? []), record.patch!], { proposalId: record.id });
    const stored = tx.replace<AgentProposalRecord>({ ...record, status: 'accepted', toVersion: made.version, ...decided });
    const line = inUseLine(tx.state, venture, made.version);
    const message = appendAgentMessage(tx, { agent: agent.id, from: 'agent', text: line, author: 'engine', proposalId: record.id });
    tx.emit('agent.message', { agent: agent.id, messageId: message.id });
    return { proposal: proposalView(tx.state, venture, stored, agent.name), line, playbook: { id: made.id, version: made.version } };
  });
}
