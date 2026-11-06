// Chausar venture launcher, chief (Ink v2 wave 4, package 4C1, catalogue A1, spec 5.4): proposals, the only way the
// chief acts. A proposal in the chief's answer is checked by code (gate.ts): a brief to an agent is posted in that
// agent's chat at once, with no Today card; every other kind is stored drafted ("This becomes a card on Today for your
// approval"). venture.proposals.raise puts it on Today and announces it once (proposal.created); 4B1's floor requests
// arrive raised and announced already, and are never announced again. On Today, Approve claims the proposal once, runs
// the gate again (W1 H13) and then the real engine method for its kind; Not now dismisses it. Nothing here spends,
// sends or changes a price on its own: each method does what it always does, under its own gates.
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import { METHOD_OWNERS } from '../contracts.ts';
import type {
  ChatPart, Json, ProposalKind, ProposalRaised, ProposalRecord, ProposalView, VentureDeps, VentureMethod, VentureRecord,
} from '../contracts.ts';
import { copiedTokens, currentVenture, exactPayload, identifier, listRecords, modelNumbers, requireAppChannel, tidyWords, ventureAction } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { secretFindings } from '../core/secrets.ts';
import { hindiNumberWords, statesMoney } from '../delivery/harness/patches.ts';
import { readAs } from '../delivery/shared.ts';
import { PACKAGE_LOADERS } from '../host.ts';
import { appendAgentMessage } from '../agents/store.ts';
import { holdsIdNumber, offerFor } from '../agents/answer.ts';
import { chatAgent, type ChatAgent } from '../agents/roles.ts';
import type { W4Decision, W4Outcome } from '../views/queue-w4.ts';
import type { ProposalInput } from './store.ts';
import { stripMoney, type RawProposal } from './answer.ts';
import {
  CHIEF_KINDS, proposalGate, proposalKindCheck, proposalRowId, proposalSubject, proposalView, targetOf, UNKNOWN_KIND_LINE,
} from './gate.ts';

export { proposalKindCheck };

const DECIDED = 'You decided this proposal already.';
const GONE = 'This proposal is no longer there.';
const NOT_FOUND = 'That proposal was not found.';
const STALE = 'This changed since you opened it.';
const WORK_APPROVED = 'You approved this on Today. Check the details in New order to start it. Publishing, sending and money still ask you first, at their own step.';
/** A claimed proposal's outcome until its method answers; it stays if the outcome cannot be written, and says so. */
export const IN_FLIGHT = 'Approved. Chausar has not recorded how it went yet, so check Work and Money before asking again.';
/** A start-run whose method failed after a run for its order had started: done, never put back on Today. */
export const RUN_STARTED_LINE = 'A run started for this order, though Chausar met an error after it. Check it on Work.';
const ID = /^[A-Za-z0-9_.:-]{1,200}$/;

// ---------------------------------------------------------------------------
// From the chief's answer
// ---------------------------------------------------------------------------

/** What one proposal in the chief's answer became: a drafted proposal to store, a brief to post, or a line saying why not. */
export type Drafted =
  | { kind: 'proposal'; input: Omit<ProposalInput, 'threadId' | 'messageId'> }
  | { kind: 'brief'; agent: ChatAgent; text: string; parts: ChatPart[] }
  | { kind: 'refused'; reason: string };

const refused = (reason: string): Drafted => ({ kind: 'refused', reason });
const id = (value: string): string | null => (ID.test(value.trim()) ? value.trim() : null);

/** What each kind the chief may propose takes, as its AI is told. */
const KIND_USES: Readonly<Record<string, string>> = Object.freeze({
  'brief-agent': 'agent and text: a note to one agent, posted in its chat at once',
  'start-run': 'orderId', 'draft-invoice': 'orderId', 'draft-reminder': 'invoiceId',
  quote: 'offerId, and quantity as digits or empty', 'outreach-draft': 'opportunityId, outreachKind, and channel (email, linkedin or whatsapp)',
});
/** Why a kind whose method its package has not built yet is left out of an answer. */
export const NOT_BUILT_REASON = 'Chausar cannot draft that yet.';

/** Whether a method's own package answers it now: a handler that is not the wave 4 NOT_BUILT_YET stub (named notBuiltYet). */
async function builtNow(method: VentureMethod): Promise<boolean> {
  try {
    const handler = ((await PACKAGE_LOADERS[METHOD_OWNERS[method]]()).handlers as Record<string, Handler | undefined>)[method];
    return typeof handler === 'function' && handler.name !== 'notBuiltYet';
  } catch {
    return false;
  }
}

/**
 * The kinds the chief may propose now, each with the fields it takes. A kind whose method still answers NOT_BUILT_YET
 * (4J5's reminder draft, 4E2's outreach draft until they land) is neither told to the AI nor drafted.
 */
export async function availableKinds(): Promise<{ kind: ProposalKind; uses: string }[]> {
  const kinds: { kind: ProposalKind; uses: string }[] = [];
  for (const kind of CHIEF_KINDS) {
    const method = METHOD_OF[kind];
    if (method && !(await builtNow(method))) continue;
    kinds.push({ kind, uses: KIND_USES[kind] });
  }
  return kinds;
}

/** The method input a kind takes, from the answer's fields, or why it cannot be one. */
function inputOf(kind: ProposalKind, raw: RawProposal): { input: Json } | { reason: string } {
  switch (kind) {
    case 'start-run':
    case 'draft-invoice': {
      const orderId = id(raw.orderId);
      return orderId ? { input: { orderId } } : { reason: 'that order was not found.' };
    }
    case 'draft-reminder': {
      const invoiceId = id(raw.invoiceId);
      return invoiceId ? { input: { invoiceId } } : { reason: 'that invoice was not found.' };
    }
    case 'quote': {
      const offerId = id(raw.offerId);
      if (!offerId) return { reason: 'that offer is not in your plan.' };
      const quantity = raw.quantity.trim();
      if (quantity && !/^[1-9]\d{0,5}$/.test(quantity)) return { reason: 'the quantity was not a whole number.' };
      return { input: quantity ? { offerId, quantity } : { offerId } };
    }
    case 'outreach-draft': {
      const opportunityId = id(raw.opportunityId);
      return opportunityId ? { input: { opportunityId, kind: raw.outreachKind.trim(), channel: raw.channel.trim() } } : { reason: 'that person is not in your pipeline.' };
    }
    default:
      return { reason: UNKNOWN_KIND_LINE };
  }
}

/**
 * One proposal from the chief's answer, checked by code against the vault as it is: its kind (PROPOSAL_NOT_ALLOWED and
 * PROPOSAL_KIND_UNKNOWN become a line), what it acts on (the gate), and for a brief, the agent and the words, with
 * money cut out and keys and id numbers never passed on. question: the owner's words, whose names may be copied.
 */
export function draftFromModel(state: State, venture: VentureRecord, raw: RawProposal, question: string, available: readonly string[]): Drafted {
  let kind: ProposalKind;
  try { kind = proposalKindCheck(raw.kind.trim()); } catch (error) { return refused((error as Error).message); }
  if (!CHIEF_KINDS.includes(kind)) return refused(UNKNOWN_KIND_LINE);
  if (!available.includes(kind)) return refused(NOT_BUILT_REASON);
  if (kind === 'brief-agent') {
    let agent: ChatAgent;
    try { agent = chatAgent(state, venture, raw.agent.trim()); } catch { return refused('that agent is not on your team.'); }
    const words = tidyWords(raw.text);
    if (!words) return refused('the brief was empty.');
    if (secretFindings(words).length || holdsIdNumber(words)) return refused('a brief never carries a key or an id number.');
    const { text } = stripMoney(words);
    if (statesMoney(text, question)) return refused('the brief named an amount of money with no receipt.');
    const said = `From Chausar: ${text}`;
    const counted = modelNumbers(said, copiedTokens(question)) || hindiNumberWords(said).length > 0;
    return { kind: 'brief', agent, text: said, parts: [counted ? { kind: 'estimate', text: said } : { kind: 'text', text: said }] };
  }
  const shaped = inputOf(kind, raw);
  if ('reason' in shaped) return refused(shaped.reason);
  const gate = targetOf(state, venture, kind, shaped.input);
  if (!gate.ok) return refused(gate.reason);
  const { title, line, agent, spends, sends } = gate.target;
  return { kind: 'proposal', input: { kind, source: 'chief', title, line, input: shaped.input, agent, spends, sends } };
}

// ---------------------------------------------------------------------------
// venture.proposals.raise and venture.proposals.dismiss
// ---------------------------------------------------------------------------

function proposalId(payload: unknown): string {
  const body = exactPayload(payload, ['id'], ['id']);
  return identifier(body.id, 'Proposal');
}

/**
 * venture.proposals.raise { id } (prepare, app only): a drafted proposal becomes a card on Today, after the gate runs
 * again (APPROVAL_STALE with the reason when what it acts on changed). Announced once with proposal.created; raising a
 * raised one (4B1's floor requests arrive raised) answers with its card and announces nothing.
 */
export async function proposalsRaiseHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ProposalRaised> {
  requireAppChannel(ctx, 'venture.proposals.raise');
  const wanted = proposalId(payload);
  readAs(deps, ctx, 'prepare');
  return ventureAction(deps, ctx, 'prepare', 'proposals.raise', tx => {
    const record = tx.find('venture-proposal', wanted);
    check(record, 'INVALID_VENTURE_REQUEST', NOT_FOUND);
    proposalKindCheck(record.proposalKind);
    const venture = tx.venture!;
    if (record.status === 'raised') return { proposal: proposalView(tx.state, venture, record), rowId: proposalRowId(tx.state, venture, record), line: 'It is on Today already.' };
    check(record.status === 'drafted', 'PROPOSAL_DECIDED', DECIDED);
    const gate = proposalGate(tx.state, venture, record);
    check(gate.ok, 'APPROVAL_STALE', gate.ok ? '' : `This changed since Chausar drafted it: ${gate.reason} Ask Chausar again.`);
    const raised = tx.replace<ProposalRecord>({ ...record, status: 'raised', raisedAt: tx.now });
    tx.emit('proposal.created', { proposalId: raised.id });
    tx.emit('queue.changed', { rowId: proposalRowId(tx.state, venture, raised) });
    return { proposal: proposalView(tx.state, venture, raised), rowId: proposalRowId(tx.state, venture, raised), line: 'On Today for your approval.' };
  });
}

/** venture.proposals.dismiss { id } (prepare, app only): a drafted or raised proposal is set aside; nothing changes. */
export async function proposalsDismissHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ proposal: ProposalView }> {
  requireAppChannel(ctx, 'venture.proposals.dismiss');
  const wanted = proposalId(payload);
  readAs(deps, ctx, 'prepare');
  return ventureAction(deps, ctx, 'prepare', 'proposals.dismiss', tx => {
    const record = tx.find('venture-proposal', wanted);
    check(record, 'INVALID_VENTURE_REQUEST', NOT_FOUND);
    check(record.status === 'drafted' || record.status === 'raised', 'PROPOSAL_DECIDED', DECIDED);
    const dismissed = tx.replace<ProposalRecord>({ ...record, status: 'dismissed', decidedAt: tx.now, decidedBy: ctx.memberId, outcome: 'Not now.' });
    if (record.status === 'raised') tx.emit('queue.changed', {});
    return { proposal: proposalView(tx.state, tx.venture!, dismissed) };
  });
}

// ---------------------------------------------------------------------------
// The decision on Today (views/queue-w4.ts decideProposal)
// ---------------------------------------------------------------------------

/** The engine method each kind runs once approved. start-work answers in the agent's chat instead (approveWork). */
const METHOD_OF: Readonly<Partial<Record<ProposalKind, VentureMethod>>> = Object.freeze({
  'start-run': 'venture.delivery.run', 'draft-invoice': 'venture.invoice.prepare', 'draft-reminder': 'venture.invoice.remind',
  quote: 'venture.price.quote', 'outreach-draft': 'venture.outreach.draft', 'next-step': 'venture.pipeline.setNext',
});

type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;

/** Runs one engine method as the owner would call it, from its own package (loaded on use, as the host loads it). */
async function callMethod(deps: VentureDeps, ctx: Context, method: VentureMethod, input: Json): Promise<unknown> {
  const module = await PACKAGE_LOADERS[METHOD_OWNERS[method]]();
  const handler = (module.handlers as Record<string, Handler | undefined>)[method];
  check(typeof handler === 'function', 'NOT_BUILT_YET', 'This part of Chausar is not built yet.');
  return handler(deps, ctx, structuredClone(input));
}

/** What the approved method did, in the engine's words. */
function doneLine(kind: ProposalKind, result: unknown): W4Outcome {
  const value = result as { status?: unknown; id?: unknown } | null;
  switch (kind) {
    case 'start-run': return { line: value?.status === 'waiting-for-you' ? 'Started. Its first step waits for you on Today.' : 'Started. Follow it on Work.' };
    case 'draft-invoice': return { line: 'Drafted. The invoice waits on Today for you to issue it.' };
    case 'quote': return { line: 'Worked out. The quote has its receipt.', ...(typeof value?.id === 'string' ? { receiptId: value.id } : {}) };
    case 'next-step': return { line: 'Next step set.' };
    default: return { line: 'Drafted. Open it to send it yourself.' };
  }
}

/**
 * An agent's floor request, approved: the work starts through the order path, where the floor still asks. The agent's
 * chat gets a New order prefilled with the owner's request; nothing is created, published, sent or paid here.
 */
async function approveWork(deps: VentureDeps, ctx: Context, record: ProposalRecord): Promise<W4Outcome> {
  return ventureAction(deps, ctx, 'approve', 'proposals.work', tx => {
    const input = record.input as { agent?: unknown; request?: unknown };
    const agent = chatAgent(tx.state, tx.venture!, typeof input.agent === 'string' ? input.agent : '');
    const request = typeof input.request === 'string' ? input.request : record.title;
    const message = appendAgentMessage(tx, {
      agent: agent.id, from: 'agent', text: WORK_APPROVED, author: 'engine', proposalId: record.id,
      suggestion: { kind: 'order', offerId: offerFor(tx.state, tx.venture!, request), request },
    });
    tx.emit('agent.message', { agent: agent.id, messageId: message.id });
    return { line: `Approved. ${agent.name}'s chat has a New order ready for you to check.` };
  });
}

/** Puts a claimed proposal back on Today when its method refused: the owner may try again or say not now. */
async function unclaim(deps: VentureDeps, ctx: Context, id: string): Promise<void> {
  await ventureAction(deps, ctx, 'approve', 'proposals.unclaim', tx => {
    const record = tx.find('venture-proposal', id);
    if (record && record.status === 'approved' && record.outcome === IN_FLIGHT) tx.replace<ProposalRecord>({ ...record, status: 'raised', decidedAt: null, decidedBy: null, outcome: null });
  });
}

/** The ids of the runs an order has now, so a run that appears after the claim can be told apart. */
function runIdsOf(state: State, ventureId: string, input: Json): Set<string> {
  const orderId = (input as { orderId?: unknown } | null)?.orderId;
  return new Set(listRecords(state, 'venture-delivery-run', ventureId).filter(run => run.orderId === orderId).map(run => run.id));
}

/** Writes what the approved method did; if that write fails, the claim's honest in-flight line stays. */
async function settle(deps: VentureDeps, ctx: Context, id: string, line: string): Promise<void> {
  try {
    await ventureAction(deps, ctx, 'approve', 'proposals.done', tx => {
      const record = tx.find('venture-proposal', id);
      if (record) tx.replace<ProposalRecord>({ ...record, outcome: line });
    });
  } catch {
    // The method ran; the card keeps IN_FLIGHT, which tells the owner to check Work and Money before asking again.
  }
}

/**
 * A decision on a proposal's card. Not now (deny) dismisses it. Approve claims it once, checks that the card the owner
 * saw is still its card (APPROVAL_STALE otherwise) and that the gate still passes, then runs the real engine method for
 * its kind; a method's refusal puts it back on Today and reaches the owner in the method's own words, unless a run for
 * the order started meanwhile (start-run), which counts as done. Two approvals at once: the second finds it claimed.
 */
export async function decideProposal(deps: VentureDeps, ctx: Context, decision: W4Decision): Promise<W4Outcome> {
  const wanted = decision.subject.slice(proposalSubject('').length);
  if (decision.action === 'deny') {
    await ventureAction(deps, ctx, 'approve', 'proposals.decide', tx => {
      const record = tx.find('venture-proposal', wanted);
      check(record, 'APPROVAL_STALE', GONE);
      check(record.status === 'raised', 'PROPOSAL_DECIDED', DECIDED);
      tx.replace<ProposalRecord>({ ...record, status: 'dismissed', decidedAt: tx.now, decidedBy: ctx.memberId, outcome: 'Not now.' });
    });
    return { line: 'Not now. Nothing changed.' };
  }
  check(decision.action === 'approve', 'INVALID_VENTURE_REQUEST', 'This card offers Approve and Not now.');
  // 4E3: a card that asks for the day (row.needs) takes it as the answer; without a day nothing is claimed.
  if (decision.row.needs?.answer === 'day') {
    const day = decision.answer?.trim() ?? '';
    check(/^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day,
      'INVALID_VENTURE_REQUEST', 'Pick the day for this step first.');
    const country = currentVenture(deps.store.read())?.country;
    const today = country ? localDayAt(deps.clock(), country) : deps.clock().toISOString().slice(0, 10);
    check(day >= today, 'INVALID_VENTURE_REQUEST', 'Pick today or a later day for this step.');
  }
  const { claimed, runsBefore } = await ventureAction(deps, ctx, 'approve', 'proposals.decide', tx => {
    const record = tx.find('venture-proposal', wanted);
    check(record, 'APPROVAL_STALE', GONE);
    check(record.status === 'raised', 'PROPOSAL_DECIDED', DECIDED);
    check(proposalRowId(tx.state, tx.venture!, record) === decision.row.id, 'APPROVAL_STALE', STALE);
    const gate = proposalGate(tx.state, tx.venture!, record);
    check(gate.ok, 'APPROVAL_STALE', STALE);
    tx.replace<ProposalRecord>({ ...record, status: 'approved', decidedAt: tx.now, decidedBy: ctx.memberId, outcome: IN_FLIGHT });
    return { claimed: record, runsBefore: runIdsOf(tx.state, tx.venture!.id, record.input) };
  });
  const kind = proposalKindCheck(claimed.proposalKind);
  let outcome: W4Outcome;
  try {
    if (kind === 'start-work') outcome = await approveWork(deps, ctx, claimed);
    else {
      const method = METHOD_OF[kind];
      if (!method) throw new ChausarError('PROPOSAL_KIND_UNKNOWN', UNKNOWN_KIND_LINE);
      // 4E3: a next step drafted from meeting notes that wrote no day takes the day the owner gives as their answer.
      const input = kind === 'next-step' && (claimed.input as { due?: unknown } | null)?.due === null
        ? { ...(claimed.input as Record<string, Json>), due: decision.answer ?? '' } : claimed.input;
      outcome = doneLine(kind, await callMethod(deps, ctx, method, input));
    }
  } catch (error) {
    // A run that started for the order after the claim counts: the card is done, never put back to start a second one.
    const started = kind === 'start-run' && [...runIdsOf(deps.store.read(), claimed.ventureId, claimed.input)].some(runId => !runsBefore.has(runId));
    if (!started) {
      await unclaim(deps, ctx, claimed.id);
      throw error;
    }
    outcome = { line: RUN_STARTED_LINE };
  }
  await settle(deps, ctx, claimed.id, outcome.line);
  return outcome;
}
