// Chausar venture launcher, agents (Ink v2 wave 4, package 4J18, catalogue A11): ideas, and who is waiting on you.
// Ideas come from code rules over the business's own records, never from a model: an order delivered with no invoice,
// an issued invoice past its due date and not paid in full, and an open order with no run a day after it came in. Each
// idea has a title, a reason, the records it rests on (an idea with no record behind it cannot be made) and the prompt
// it would run. An idea is a suggestion only: Start drafts a proposal of the chief's own kinds through the chief's own
// gate (chief/gate.ts), which reaches Today only when the owner raises it and does anything only when the owner approves
// it there, with the second ask when it spends or sends. Nothing is spent, sent or priced on Start. An idea retires as
// soon as its records no longer hold it (they are read again on every list and every Start), a started or dismissed
// idea is kept by its id so the same records never bring it back, and a kind whose method is not built is never
// offered. "Who is waiting on you" lists only real records: an order a step of which waits on the owner (from the
// order's own stage steps, money/order-steps.ts) and mail Chausar leaves for the owner to answer.
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import type {
  IdeaRecord, IdeaStarted, IdeasView, IdeaView, InvoiceRecord, Json, OrderRecord, ProposalKind, VentureDeps, VentureRecord, VentureRecordKind, WaitingOnYouView,
} from '../contracts.ts';
import { digest, exactPayload, findRecord, formatVentureDate, identifier, listRecords, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { acceptedBlueprintOrNull, readAs } from '../delivery/shared.ts';
import { orderIndex, orderSteps } from '../money/order-steps.ts';
import { proposalView, targetOf } from '../chief/gate.ts';
import { draftProposal } from '../chief/store.ts';
import { availableKinds } from '../chief/proposals.ts';
import { listPeople } from '../network/store.ts';
import { short } from '../views/shared.ts';

/** The rules that make ideas, in the order the list shows them. */
export const IDEA_RULES = ['invoice-delivered', 'remind-overdue', 'start-order'] as const;
export type IdeaRuleId = typeof IDEA_RULES[number];
/** The most ideas and the most waiting lines the list shows. */
const MAX_IDEAS = 10;
const MAX_WAITING = 20;
/** How long an open order may wait for its first run before it becomes an idea: from the day after it came in. */
const START_AFTER_DAYS = 1;
export const STARTED_LINE = 'Drafted. Put it on Today when you are ready: nothing changes until you approve it there.';
export const DISMISSED_LINE = "Dismissed. Chausar won't suggest this again.";
const RETIRED = 'This idea no longer holds: what it was based on changed. Nothing was started.';
const RETIRED_DISMISS = 'This idea no longer holds: what it was based on changed.';
const NO_EVIDENCE = 'An idea needs a record of this business behind it, so this one was not made.';
/** Mail Chausar leaves for the owner to answer (network/inbound-rows.ts says the same on Today). */
const ANSWER_YOURSELF: ReadonlySet<string> = new Set(['owner-reply', 'bot-question']);

/** An idea as a rule drafts it: its words, the records it rests on, and the proposal Start would draft. */
export type IdeaDraft = {
  rule: IdeaRuleId;
  title: string;
  reason: string;
  evidence: { kind: VentureRecordKind; id: string; line: string }[];
  prompt: string;
  action: { kind: ProposalKind; input: Json };
};
export type Idea = IdeaDraft & { id: string };

/** An idea's id: the same rule over the same records is the same idea, so a dismissal holds for it. */
export const ideaId = (rule: IdeaRuleId, ids: readonly string[]): string => `idea_${digest({ rule, ids: [...ids] }).slice(0, 24)}`;

/**
 * Makes one idea, refusing (IDEA_NO_EVIDENCE) one with no record behind it: every piece of evidence must be a record of
 * that kind in this business.
 */
export function makeIdea(state: State, venture: VentureRecord, draft: IdeaDraft): Idea {
  const real = draft.evidence.length > 0 && draft.evidence.every(item => {
    const record = findRecord(state, item.kind, item.id);
    return !!record && record.ventureId === venture.id;
  });
  check(real, 'IDEA_NO_EVIDENCE', NO_EVIDENCE);
  return { ...draft, id: ideaId(draft.rule, draft.evidence.map(item => item.id)) };
}

/** "a", "a and b", "a, b and c". */
const listWords = (items: readonly string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** What the rules read: the records and the words for them. */
type Facts = {
  state: State;
  venture: VentureRecord;
  today: string;
  day: (iso: string) => string;
  client: (id: string) => string | null;
  offer: (order: OrderRecord) => string;
};

function factsOf(state: State, venture: VentureRecord, nowMs: number): Facts {
  const clients = new Map(listRecords(state, 'venture-client', venture.id).map(client => [client.id, client.name] as const));
  const offers = new Map((acceptedBlueprintOrNull(state, venture)?.offers ?? []).map(offer => [offer.id, offer.name.value] as const));
  return {
    state, venture, today: localDayAt(new Date(nowMs), venture.country),
    day: iso => formatVentureDate(iso, venture.country.dateOrder),
    client: id => clients.get(id) ?? null,
    offer: order => short(offers.get(order.offerId) ?? 'the service', 80),
  };
}

/** The invoices that count for an order: every one but a void one. */
const invoicesOf = (facts: Facts, orderId: string): InvoiceRecord[] =>
  listRecords(facts.state, 'venture-invoice', facts.venture.id).filter(invoice => invoice.orderId === orderId && invoice.status !== 'void');

/** The drafts each rule makes from the records as they are now. */
const RULES: Readonly<Record<IdeaRuleId, (facts: Facts) => IdeaDraft[]>> = Object.freeze({
  'invoice-delivered': facts => listRecords(facts.state, 'venture-order', facts.venture.id).flatMap(order => {
    const client = facts.client(order.clientId);
    if (order.status !== 'delivered' || !order.deliveredOn || !client || invoicesOf(facts, order.id).length) return [];
    const offer = facts.offer(order), on = facts.day(order.deliveredOn);
    return [{
      rule: 'invoice-delivered' as const, title: `Invoice ${client} for ${offer}`, reason: `You marked this order delivered on ${on}, and it has no invoice yet.`,
      evidence: [{ kind: 'venture-order' as const, id: order.id, line: `${offer} for ${client}, delivered ${on}.` }],
      prompt: `Draft the invoice for ${client}'s order from your price. You issue it from Today.`,
      action: { kind: 'draft-invoice' as const, input: { orderId: order.id } },
    }];
  }),
  'remind-overdue': facts => listRecords(facts.state, 'venture-invoice', facts.venture.id).flatMap(invoice => {
    const client = facts.client(invoice.clientId);
    if (!client || !invoice.number || !invoice.dueDate || (invoice.status !== 'issued' && invoice.status !== 'part-paid')) return [];
    if (BigInt(invoice.balanceMinor) <= 0n || invoice.dueDate >= facts.today) return [];
    const due = facts.day(invoice.dueDate);
    return [{
      rule: 'remind-overdue' as const, title: `Remind ${client} about ${invoice.number}`, reason: `${invoice.number} was due on ${due} and is not paid in full.`,
      evidence: [{ kind: 'venture-invoice' as const, id: invoice.id, line: `${invoice.number} for ${client}, due ${due}.` }],
      prompt: `Draft a payment reminder for ${invoice.number}. You send it yourself.`,
      action: { kind: 'draft-reminder' as const, input: { invoiceId: invoice.id } },
    }];
  }),
  'start-order': facts => {
    const runs = new Set(listRecords(facts.state, 'venture-delivery-run', facts.venture.id).map(run => run.orderId));
    return listRecords(facts.state, 'venture-order', facts.venture.id).flatMap(order => {
      const client = facts.client(order.clientId);
      if (order.status !== 'open' || !client || runs.has(order.id)) return [];
      const came = localDayAt(order.at, facts.venture.country);
      if (Date.parse(`${facts.today}T00:00:00Z`) - Date.parse(`${came}T00:00:00Z`) < START_AFTER_DAYS * 86_400_000) return [];
      const offer = facts.offer(order), on = facts.day(came);
      return [{
        rule: 'start-order' as const, title: `Start work on ${client}'s order`, reason: `${client} ordered ${offer} on ${on}, and no run has started.`,
        evidence: [{ kind: 'venture-order' as const, id: order.id, line: `${offer} for ${client}, ordered ${on}.` }],
        prompt: `Start a run on your AI for ${client}'s order. Each step that needs you still asks first.`,
        action: { kind: 'start-run' as const, input: { orderId: order.id } },
      }];
    });
  },
});

/**
 * The ideas that hold now, in rule order, newest records first within a rule: each made from real records, of a kind
 * whose method is built (kinds), passing the chief's gate, not started or dismissed before, and with no proposal of the
 * same kind and input already drafted or on Today. None while the business has no country yet (still in its
 * interview): its days and dates are the owner's own.
 */
export function currentIdeas(state: State, venture: VentureRecord, nowMs: number, kinds: ReadonlySet<ProposalKind>): Idea[] {
  if (!venture.country) return [];
  const facts = factsOf(state, venture, nowMs);
  const decided = new Set(listRecords(state, 'venture-idea', venture.id).map(record => record.id));
  const moving = new Set(listRecords(state, 'venture-proposal', venture.id).filter(item => item.status === 'drafted' || item.status === 'raised')
    .map(item => `${item.proposalKind}:${digest(item.input)}`));
  const ideas: Idea[] = [];
  for (const rule of IDEA_RULES) {
    for (const draft of RULES[rule](facts).reverse()) {
      if (!kinds.has(draft.action.kind) || moving.has(`${draft.action.kind}:${digest(draft.action.input)}`)) continue;
      if (!targetOf(state, venture, draft.action.kind, draft.action.input).ok) continue;
      const idea = makeIdea(state, venture, draft);
      if (!decided.has(idea.id)) ideas.push(idea);
    }
  }
  return ideas.slice(0, MAX_IDEAS);
}

const ideaView = (idea: Idea): IdeaView => ({
  id: idea.id, title: idea.title, reason: idea.reason, evidence: idea.evidence.map(item => ({ id: item.id, line: item.line })), prompt: idea.prompt,
});

/**
 * Who is waiting on the owner, newest first, from real records only: each order (not cancelled) with a stage that
 * waits on the owner, by the order's own stage steps, and each message from someone Chausar leaves for the owner to
 * answer that is not handled yet. None while the business has no country yet.
 */
export function waitingOnYou(state: State, venture: VentureRecord, nowMs: number): WaitingOnYouView[] {
  if (!venture.country) return [];
  const clients = new Map(listRecords(state, 'venture-client', venture.id).map(client => [client.id, client.name] as const));
  const runs = listRecords(state, 'venture-delivery-run', venture.id);
  const items: { at: string; view: WaitingOnYouView }[] = [];
  // The records the stages read, indexed once for every order (as venture.order.list does).
  const index = orderIndex(state, venture, nowMs);
  for (const order of listRecords(state, 'venture-order', venture.id)) {
    const client = clients.get(order.clientId);
    if (order.status === 'cancelled' || !client) continue;
    const waits = orderSteps(index, order).waitsOnYou;
    if (!waits || !waits.items.length) continue;
    const whats = waits.items.map(item => item.what);
    const at = runs.filter(run => run.orderId === order.id).reduce((newest, run) => (run.at > newest ? run.at : newest), order.at);
    items.push({ at, view: { id: `waiting:order:${order.id}`, recordId: order.id, line: `For ${client}: ${listWords(whats)} ${whats.length === 1 ? 'waits' : 'wait'} on you.` } });
  }
  const people = new Map(listPeople(state, venture.id).map(person => [person.id, person.name] as const));
  for (const mail of listRecords(state, 'venture-inbound', venture.id)) {
    if (mail.processed || !ANSWER_YOURSELF.has(mail.triage)) continue;
    const who = (mail.personId ? people.get(mail.personId) : undefined) ?? mail.from;
    const on = formatVentureDate(localDayAt(mail.date, venture.country), venture.country.dateOrder);
    items.push({ at: mail.date, view: { id: `waiting:mail:${mail.id}`, recordId: mail.id, line: `${who} wrote on ${on} and waits for your reply.` } });
  }
  return items.map((item, index) => ({ ...item, index })).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.index - b.index)).slice(0, MAX_WAITING).map(item => item.view);
}

/** The kinds the chief's proposals can take now (a kind whose method is not built is left out). */
async function builtKinds(): Promise<Set<ProposalKind>> {
  return new Set((await availableKinds()).map(item => item.kind));
}

/** The idea with this id as it holds now, refused when the owner decided it already or its records no longer hold it. */
function ideaToDecide(state: State, venture: VentureRecord, id: string, nowMs: number, kinds: ReadonlySet<ProposalKind>, retired: string): Idea {
  const kept = listRecords(state, 'venture-idea', venture.id).find(record => record.id === id);
  if (kept) throw new ChausarError('ALREADY_DECIDED', kept.status === 'dismissed' ? 'You dismissed this idea already.' : 'You started this idea already.');
  const idea = currentIdeas(state, venture, nowMs, kinds).find(item => item.id === id);
  check(idea, 'IDEA_RETIRED', retired);
  return idea;
}

/** Keeps a decided idea by its id, so the same records never bring it back. */
function keepIdea(tx: VentureTx, idea: Idea, status: IdeaRecord['status']): IdeaRecord {
  return tx.put<IdeaRecord>({
    ...tx.base('venture-idea'), id: idea.id, title: idea.title, reason: idea.reason, evidence: idea.evidence.map(item => ({ ...item })), prompt: idea.prompt,
    rule: idea.rule, status, decidedAt: tx.now,
  });
}

// ---------------------------------------------------------------------------
// The methods
// ---------------------------------------------------------------------------

/** venture.ideas.list {} (read): the ideas that hold now, and who is waiting on you. Changes nothing. */
export async function ideasListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<IdeasView> {
  exactPayload(payload ?? {}, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  const nowMs = deps.clock().getTime();
  return { ideas: currentIdeas(state, venture, nowMs, await builtKinds()).map(ideaView), waiting: waitingOnYou(state, venture, nowMs) };
}

/**
 * venture.ideas.start { id } (prepare, app only): drafts the idea's proposal through the chief's gate, as the chief
 * would, with source 'idea'. It reaches Today only when the owner raises it (venture.proposals.raise) and runs only when
 * the owner approves it there. Refused when the idea was decided already or no longer holds.
 */
export async function ideasStartHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<IdeaStarted> {
  requireAppChannel(ctx, 'venture.ideas.start');
  const body = exactPayload(payload, ['id'], ['id']);
  const id = identifier(body.id, 'Idea');
  readAs(deps, ctx, 'prepare');
  const kinds = await builtKinds();
  return ventureAction(deps, ctx, 'prepare', 'ideas.start', tx => {
    const venture = tx.venture!;
    const idea = ideaToDecide(tx.state, venture, id, deps.clock().getTime(), kinds, RETIRED);
    const gate = targetOf(tx.state, venture, idea.action.kind, idea.action.input);
    check(gate.ok, 'IDEA_RETIRED', RETIRED);
    const { title, line, agent, spends, sends } = gate.target;
    const proposal = draftProposal(tx, { kind: idea.action.kind, source: 'idea', title, line, input: idea.action.input, agent, spends, sends });
    keepIdea(tx, idea, 'started');
    return { proposal: proposalView(tx.state, venture, proposal), suggestion: null, line: STARTED_LINE };
  });
}

/** venture.ideas.dismiss { id } (prepare, app only): the idea is set aside for good; the same records never bring it back. */
export async function ideasDismissHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ dismissed: true; line: string }> {
  requireAppChannel(ctx, 'venture.ideas.dismiss');
  const body = exactPayload(payload, ['id'], ['id']);
  const id = identifier(body.id, 'Idea');
  readAs(deps, ctx, 'prepare');
  const kinds = await builtKinds();
  return ventureAction(deps, ctx, 'prepare', 'ideas.dismiss', tx => {
    keepIdea(tx, ideaToDecide(tx.state, tx.venture!, id, deps.clock().getTime(), kinds, RETIRED_DISMISS), 'dismissed');
    return { dismissed: true as const, line: DISMISSED_LINE };
  });
}
