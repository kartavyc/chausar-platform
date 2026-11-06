// Chausar venture launcher, chief (Ink v2 wave 4, package 4C1, catalogue A1): the gate every proposal passes, by code.
// A proposal's kind is one the engine knows and never one that would touch keys, money policy, posture or storage; the
// record still holds exactly what its digest covers; and what it acts on is still there and still fits (the order is
// open, the invoice not issued yet, the offer priced). The gate runs when the chief drafts a proposal, when the owner
// raises it, on every read of Today's card and again just before the approved method runs (W1 H13). The facts a card
// depends on are part of its row id, so a card whose order, invoice or plan changed after the owner saw it is stale.
// Reads only.
import { ChausarError, check, type State } from '../../contracts.ts';
import { OUTREACH_KINDS, PROPOSAL_KINDS } from '../contracts.ts';
import type { Json, OutreachKind, ProposalKind, ProposalRecord, ProposalView, VentureRecord } from '../contracts.ts';
import { digest, listRecords } from '../records.ts';
import { latestBlueprint } from '../money/shared.ts';
import { chatAgent } from '../agents/roles.ts';
import { clientNameFor, short } from '../views/shared.ts';

/** The kinds the chief may propose itself. start-work (4B1's floor requests) and next-step (4E3) come from elsewhere. */
export const CHIEF_KINDS: readonly ProposalKind[] = Object.freeze(['brief-agent', 'start-run', 'draft-invoice', 'draft-reminder', 'quote', 'outreach-draft']);
export const NOT_ALLOWED_LINE = 'Chausar never changes your keys, money rules, posture or storage. You change those yourself.';
export const UNKNOWN_KIND_LINE = 'Chausar cannot propose that.';
/** Under a drafted proposal in the chief's answer. */
export const TODAY_LINE = 'This becomes a card on Today for your approval.';
/** On every proposal card on Today. */
export const NOTHING_CHANGES = 'Nothing changes until you approve.';
const CHANGED = 'it changed since Chausar drafted it.';
/** Words in a kind that would touch what only the owner changes: keys, money policy, posture, storage. */
const OWNER_ONLY = /key|secret|token|password|passphrase|credential|polic|spend|budget|limit|posture|stage|auto|storage|backup|vault|recovery|encrypt|connect|setting/i;

/**
 * A proposal kind as code reads it: one of the engine's kinds, else PROPOSAL_NOT_ALLOWED when it names keys, money
 * policy, posture or storage, else PROPOSAL_KIND_UNKNOWN.
 */
export function proposalKindCheck(kind: string): ProposalKind {
  if ((PROPOSAL_KINDS as readonly string[]).includes(kind)) return kind as ProposalKind;
  check(!OWNER_ONLY.test(kind), 'PROPOSAL_NOT_ALLOWED', NOT_ALLOWED_LINE);
  throw new ChausarError('PROPOSAL_KIND_UNKNOWN', UNKNOWN_KIND_LINE);
}

/** The digest draftProposal (store.ts) seals a proposal with, over what the owner approves. */
export function proposalDigest(record: Pick<ProposalRecord, 'proposalKind' | 'title' | 'line' | 'input' | 'agent' | 'spends' | 'sends'>): string {
  return digest({ kind: record.proposalKind, title: record.title, line: record.line, input: record.input, agent: record.agent, spends: record.spends, sends: record.sends });
}

/** What a proposal acts on, worked out from the vault: its words, whether it spends or sends, and the facts it depends on. */
export type Target = { title: string; line: string; spends: boolean; sends: boolean; agent: string | null; facts: Json };
export type Gate = { ok: true; target: Target } | { ok: false; reason: string };

const LINES = Object.freeze({
  'start-run': 'This starts a run on your AI for this order. Each step that needs you still asks first.',
  'draft-invoice': 'Chausar drafts the invoice from your price. You issue it from Today.',
  'draft-reminder': 'Chausar drafts a payment reminder. You send it yourself.',
  quote: 'Chausar works out the price with its receipt. Nothing is sent.',
  'outreach-draft': 'Chausar drafts the note. You send it yourself.',
  'next-step': 'Chausar sets the next step for this person in your pipeline.',
});
const OUTREACH_WORDS: Readonly<Record<OutreachKind, string>> = Object.freeze({
  'intro-request': 'an intro request', 'double-opt-in': 'a double opt-in intro', 'connection-note': 'a connection note', 'follow-up': 'a follow-up',
  reply: 'a reply', 'cold-email': 'a first email', reminder: 'a reminder',
});

const field = (input: Json, name: string): string | null => {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, Json>)[name] : undefined;
  return typeof value === 'string' && value.length ? value : null;
};
const no = (reason: string): Gate => ({ ok: false, reason });

/** An order's run facts: the newest run's id and status, so a run started meanwhile changes the card. */
function runFacts(state: State, venture: VentureRecord, orderId: string): Json {
  const run = listRecords(state, 'venture-delivery-run', venture.id).filter(item => item.orderId === orderId).at(-1);
  return run ? [run.id, run.status] : null;
}

function personName(state: State, venture: VentureRecord, opportunityId: string): { name: string; stage: string } | null {
  const opportunity = listRecords(state, 'venture-opportunity', venture.id).find(item => item.id === opportunityId);
  if (!opportunity) return null;
  const person = listRecords(state, 'venture-person', venture.id).find(item => item.id === opportunity.personId);
  return { name: person?.name ?? 'someone in your pipeline', stage: opportunity.stage };
}

/**
 * The gate for one kind and its input, from the vault as it is now: what the proposal acts on, or why it cannot go
 * ahead, in words that finish "This can't go ahead now: ...".
 */
export function targetOf(state: State, venture: VentureRecord, kind: ProposalKind, input: Json): Gate {
  const orders = () => listRecords(state, 'venture-order', venture.id);
  switch (kind) {
    case 'start-run': {
      const order = orders().find(item => item.id === field(input, 'orderId'));
      if (!order) return no('that order was not found.');
      if (order.status !== 'open') return no('this order is no longer open.');
      return { ok: true, target: { title: `Start work on ${clientNameFor(state, venture.id, order.id)}'s order`, line: LINES['start-run'], spends: true, sends: false, agent: null, facts: { order: order.status, run: runFacts(state, venture, order.id) } } };
    }
    case 'draft-invoice': {
      const order = orders().find(item => item.id === field(input, 'orderId'));
      if (!order) return no('that order was not found.');
      if (order.status === 'cancelled') return no('this order was cancelled.');
      const invoices = listRecords(state, 'venture-invoice', venture.id).filter(item => item.orderId === order.id);
      if (invoices.some(item => item.status !== 'draft')) return no('this order already has an issued invoice.');
      return { ok: true, target: { title: `Draft the invoice for ${clientNameFor(state, venture.id, order.id)}'s order`, line: LINES['draft-invoice'], spends: false, sends: false, agent: null, facts: { order: order.status, invoices: invoices.map(item => [item.id, item.digest]) } } };
    }
    case 'draft-reminder': {
      const invoice = listRecords(state, 'venture-invoice', venture.id).find(item => item.id === field(input, 'invoiceId'));
      if (!invoice || invoice.number === null) return no('that invoice was not found.');
      if ((invoice.status !== 'issued' && invoice.status !== 'part-paid') || BigInt(invoice.balanceMinor) <= 0n) return no('this invoice has nothing left to pay.');
      return { ok: true, target: { title: `Draft a payment reminder for invoice ${invoice.number}`, line: LINES['draft-reminder'], spends: false, sends: false, agent: null, facts: { status: invoice.status, balance: invoice.balanceMinor } } };
    }
    case 'quote': {
      const blueprint = latestBlueprint(listRecords(state, 'venture-blueprint', venture.id));
      const offer = blueprint?.offers.find(item => item.id === field(input, 'offerId'));
      if (!blueprint || !offer) return no('that offer is not in your plan.');
      if (offer.pricing.unitPriceMinor === null) return no('this offer has no price yet.');
      return { ok: true, target: { title: `Work out a quote for ${short(offer.name.value, 80)}`, line: LINES.quote, spends: false, sends: false, agent: null, facts: { plan: blueprint.digest } } };
    }
    case 'outreach-draft': {
      const found = personName(state, venture, field(input, 'opportunityId') ?? '');
      const what = field(input, 'kind');
      if (!found) return no('that person is not in your pipeline.');
      if (!what || !(OUTREACH_KINDS as readonly string[]).includes(what) || !['email', 'linkedin', 'whatsapp'].includes(field(input, 'channel') ?? '')) return no('that kind of note is not one Chausar drafts.');
      return { ok: true, target: { title: `Draft ${OUTREACH_WORDS[what as OutreachKind]} for ${short(found.name, 80)}`, line: LINES['outreach-draft'], spends: false, sends: false, agent: null, facts: { stage: found.stage } } };
    }
    case 'next-step': {
      const found = personName(state, venture, field(input, 'id') ?? '');
      if (!found) return no('that person is not in your pipeline.');
      return { ok: true, target: { title: `Set the next step for ${short(found.name, 80)}`, line: LINES['next-step'], spends: false, sends: false, agent: null, facts: { stage: found.stage } } };
    }
    case 'start-work': {
      try {
        const agent = chatAgent(state, venture, field(input, 'agent') ?? '');
        return { ok: true, target: { title: short(field(input, 'request') ?? 'Work for an agent', 120), line: '', spends: false, sends: false, agent: agent.id, facts: null } };
      } catch {
        return no('that agent is no longer on your team.');
      }
    }
    case 'brief-agent':
      return no(UNKNOWN_KIND_LINE.toLowerCase());
  }
}

/** The gate for a stored proposal: its kind, its digest over what it holds, then its target. */
export function proposalGate(state: State, venture: VentureRecord, record: ProposalRecord): Gate {
  let kind: ProposalKind;
  try { kind = proposalKindCheck(record.proposalKind); } catch (error) { return no((error as Error).message); }
  if (kind === 'brief-agent' || proposalDigest(record) !== record.digest) return no(CHANGED);
  return targetOf(state, venture, kind, record.input);
}

/** A card's version: the proposal's digest and the facts it depends on, so either changing makes a new card. */
export function rowVersion(state: State, venture: VentureRecord, record: ProposalRecord): string {
  const gate = proposalGate(state, venture, record);
  const facts = gate.ok ? gate.target.facts : { blocked: gate.reason };
  return `${record.digest.slice(0, 12)}-${digest(facts).slice(0, 12)}`;
}

/** The subject of a proposal's card on Today, the same across its versions. */
export const proposalSubject = (id: string): string => `proposal:${id}`;

/** The id Today gives the card of a raised proposal (views/queue.ts makes it from the same subject and version). */
export function proposalRowId(state: State, venture: VentureRecord, record: ProposalRecord): string {
  return `${proposalSubject(record.id)}:${rowVersion(state, venture, record)}`;
}

/** The proposal as Chats and its card show it: the line says where it stands, in the engine's words. */
export function proposalView(state: State, venture: VentureRecord, record: ProposalRecord): ProposalView {
  const line = record.status === 'drafted' ? TODAY_LINE
    : record.status === 'raised' ? `On Today. ${NOTHING_CHANGES}`
      : record.status === 'dismissed' ? 'You said not now.'
        : record.outcome ?? (record.status === 'approved' ? 'Approved.' : 'This could not go ahead.');
  return {
    id: record.id, at: record.at, kind: record.proposalKind, status: record.status, title: record.title, line, what: record.line, agent: record.agent,
    rowId: record.status === 'raised' ? proposalRowId(state, venture, record) : null, digest: record.digest, secondAsk: record.spends || record.sends,
  };
}
