// Chausar venture launcher, chief: the standing plan, the part code decides alone. Chausar as chief of staff keeps one
// plan per business: the goal, this week's moves in order, and exactly one next best step at all times. This file holds
// what needs no store and no model: a move's states and the one table that says how a state may change, the week's
// moves seeded from the way to earn the owner kept (core/way.ts), what the records move by themselves, and the rule
// that picks the next best step. Code picks that step whenever the records alone decide it: what is sold is not ready
// (the plan not accepted, an offer with no price), a decision on real work waits on Today, an invoice is overdue. Then
// a move of the week is the step; a housekeeping card (confirm tax, keep a recovery code, connect an AI) never outranks
// the week (nextStepOf). The owner's AI is asked only to choose and word moves beyond that (review.ts).
// It imports no engine store code, so the app's fake engine plans with the same functions.
import { kindsNamed } from '../customers/find-brief.ts';

/**
 * The kinds of record whose writes can move the plan: the plan the owner accepts, the way, a proposal's card, a client,
 * an invoice, a payment. The venture's one write path (records.ts) keeps the stored plan in the same commit as a write
 * of one of them (plan.ts keepPlan).
 */
export const PLAN_KINDS: readonly string[] = Object.freeze(['venture-blueprint', 'venture-owner-profile', 'venture-proposal', 'venture-client', 'venture-invoice', 'venture-payment']);

/** A week holds at most this many open moves. */
export const MOVES_MAX = 5;
/** Moves set aside in earlier weeks, remembered by id so one never comes back; the oldest are forgotten past this. */
const PAST_MAX = 200;

// ---------------------------------------------------------------------------
// A move's states: defined here, and nowhere else
// ---------------------------------------------------------------------------

/**
 * planned: on this week's list, not started. waiting: it is the owner's turn on it. proposed: Chausar put a card for
 * it on Today, and it waits for the owner's approval there. working: the owner approved that card and its work has
 * not finished. failed: that work stopped without finishing, and its card is not on Today to try again. done and
 * dropped end a move of the owner's own; only the owner brings one of those back.
 *
 * A move that stands for a card follows that card's records for as long as it stands (recordEvent): approved is not
 * done. Found live, 16 Nov 2026: a search for customers was approved, the map did not answer, the card went back on
 * Today, and the week still said Done, because the move was finished at the approval and never looked again.
 */
export const MOVE_STATES = ['planned', 'waiting', 'proposed', 'working', 'failed', 'done', 'dropped'] as const;
export type MoveState = typeof MOVE_STATES[number];
export const MOVE_EVENTS = ['start', 'propose', 'begin', 'approve', 'fail', 'return', 'dismiss', 'withdraw', 'finish', 'drop', 'reopen'] as const;
export type MoveEvent = typeof MOVE_EVENTS[number];
/** Who moves a move: the owner by hand, the records by code, or the chief in its daily review. */
export type MoveActor = 'owner' | 'records' | 'chief';

/** Every way a state may change. An event a state does not list changes nothing. */
export const MOVE_TABLE: Readonly<Record<MoveState, Readonly<Partial<Record<MoveEvent, MoveState>>>>> = Object.freeze({
  planned: Object.freeze({ start: 'waiting', propose: 'proposed', finish: 'done', drop: 'dropped' }),
  waiting: Object.freeze({ propose: 'proposed', finish: 'done', drop: 'dropped' }),
  proposed: Object.freeze({ begin: 'working', approve: 'done', fail: 'failed', dismiss: 'dropped', withdraw: 'planned', drop: 'dropped' }),
  working: Object.freeze({ approve: 'done', fail: 'failed', return: 'proposed', dismiss: 'dropped', withdraw: 'planned', drop: 'dropped' }),
  failed: Object.freeze({ begin: 'working', approve: 'done', return: 'proposed', dismiss: 'dropped', drop: 'dropped' }),
  done: Object.freeze({ reopen: 'planned', return: 'proposed', fail: 'failed' }),
  dropped: Object.freeze({ reopen: 'planned' }),
} as const);

/**
 * Who may send each event. start: the records give the owner their turn. propose: the chief put a card on Today.
 * begin, approve, fail, return, dismiss, withdraw: how that card stands, read from the records: approved and its work
 * running, its work finished, its work stopped, the card back on Today, set aside, or gone. finish: the owner says
 * done, the records show it, or the chief read it from the records. drop and reopen are the owner's alone.
 */
export const EVENT_BY: Readonly<Record<MoveEvent, readonly MoveActor[]>> = Object.freeze({
  start: ['records'], propose: ['chief'], begin: ['records'], approve: ['records'], fail: ['records'], return: ['records'], dismiss: ['records'], withdraw: ['records'],
  finish: ['owner', 'records', 'chief'], drop: ['owner'], reopen: ['owner'],
});

/** The states still to do. */
export const OPEN_STATES: readonly MoveState[] = Object.freeze(['planned', 'waiting', 'proposed', 'working']);
/** Each state as the owner reads it. */
export const MOVE_STATE_LABEL: Readonly<Record<MoveState, string>> = Object.freeze({
  planned: 'Planned', waiting: 'Waiting on you', proposed: 'On Today for your approval', working: 'Approved, working on it', failed: 'Did not finish',
  done: 'Done', dropped: 'Dropped',
});

/**
 * The words code itself writes into the plan, the same every time (the setup and starter moves, the fixed lines for
 * today, the first step while the plan waits). The app says each in the owner's language from its own pack, keyed by
 * these names (app/ui/src/places/today/plan-words.ts); a test holds the English pack to exactly these words.
 */
export const PLAN_FIXED_WORDS = Object.freeze({
  acceptPlan: 'Accept your plan',
  setPrices: 'Set your prices',
  firstClient: 'Add your first client',
  firstInvoice: 'Send your first invoice',
  firstPayment: 'Record your first payment',
  getReady: 'First, get what you sell ready.',
  noMoves: 'No moves planned for this week yet.',
  planFirst: 'Read your plan and accept it.',
  finishOffer: 'Finish what you sell.',
});

/** The state after an event, or null when that state does not take it. */
export function moveAfter(state: MoveState, event: MoveEvent): MoveState | null {
  return (MOVE_TABLE[state] as Partial<Record<MoveEvent, MoveState>>)[event] ?? null;
}

// ---------------------------------------------------------------------------
// The plan and the facts code reads
// ---------------------------------------------------------------------------

/** What the records can check by themselves, so the move is finished by code and never ticked by hand. */
export type MoveCheck = 'plan-accepted' | 'offers-priced' | 'first-client' | 'first-invoice' | 'first-payment';
/** setup: getting what is sold ready, and the first client, invoice and payment. way: a step of the way's first week. chief: the daily review's. */
export type MoveSource = 'setup' | 'way' | 'chief';
export type PlanMove = {
  id: string;
  text: string;
  source: MoveSource;
  state: MoveState;
  /** Since when it is in this state, and who put it there. */
  at: string;
  by: MoveActor;
  check?: MoveCheck;
  /** The proposal whose card on Today stands for this move. */
  proposalId?: string;
};
export type StandingPlan = { weekOf: string; moves: PlanMove[]; past: string[] };

/**
 * How a linked proposal stands now; one missing from the records is left out. For an approved card this says how its
 * work went (chief/plan.ts planFacts): working while it has not finished, approved only once it finished, failed when
 * it stopped without finishing and the card was not put back on Today.
 */
export type ProposalState = 'drafted' | 'raised' | 'working' | 'approved' | 'failed' | 'dismissed' | 'refused';
export type PlanFacts = {
  /** Today on the owner's calendar, 'YYYY-MM-DD'. */
  today: string;
  /** The plan is accepted. */
  accepted: boolean;
  /** What is sold is ready: the plan accepted and every offer priced by the owner (core/way-ready.ts). */
  ready: boolean;
  /** What is still missing, in order, in plain words. */
  missing: readonly string[];
  clients: number;
  /** Invoices issued, paid or not. */
  invoicesIssued: number;
  payments: number;
  /** The first week of the way to earn the owner kept, in order; empty when none is kept. */
  firstWeek: readonly string[];
  proposals: Readonly<Record<string, ProposalState>>;
};

/** The Monday of a day's week, both 'YYYY-MM-DD'. */
export function weekOf(day: string): string {
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  const weekday = new Date(ms).getUTCDay(); // 0 Sunday to 6 Saturday
  return new Date(ms - ((weekday + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}

/** A move's id from its words (FNV-1a, 32 bits), so the same words always make the same id, stored or not. */
export function moveId(text: string): string {
  let hash = 0x811c9dc5;
  for (const char of text.trim().toLowerCase().replace(/\s+/g, ' ')) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `mv_${hash.toString(16).padStart(8, '0')}`;
}

type Candidate = { id: string; text: string; source: MoveSource; check?: MoveCheck };
const SETUP: readonly (Candidate & { check: MoveCheck })[] = Object.freeze([
  { id: 'mv_accept_plan', text: PLAN_FIXED_WORDS.acceptPlan, source: 'setup', check: 'plan-accepted' },
  { id: 'mv_set_prices', text: PLAN_FIXED_WORDS.setPrices, source: 'setup', check: 'offers-priced' },
]);
/** The moves that make what is sold ready: they lead the week. */
const READY_IDS: ReadonlySet<string> = new Set(SETUP.map(item => item.id));
/** With no way kept, the plan is the first client, invoice and payment. */
const STARTER: readonly (Candidate & { check: MoveCheck })[] = Object.freeze([
  { id: 'mv_first_client', text: PLAN_FIXED_WORDS.firstClient, source: 'setup', check: 'first-client' },
  { id: 'mv_first_invoice', text: PLAN_FIXED_WORDS.firstInvoice, source: 'setup', check: 'first-invoice' },
  { id: 'mv_first_payment', text: PLAN_FIXED_WORDS.firstPayment, source: 'setup', check: 'first-payment' },
]);

/** Whether the records show a checked move done. */
export function checkMet(check: MoveCheck, facts: PlanFacts): boolean {
  switch (check) {
    case 'plan-accepted': return facts.accepted;
    case 'offers-priced': return facts.ready;
    case 'first-client': return facts.clients > 0;
    case 'first-invoice': return facts.invoicesIssued > 0;
    case 'first-payment': return facts.payments > 0;
  }
}

/** How far what is sold is from ready: of the setup moves (accept the plan, set the prices), how many the records show done. */
export function setupProgress(facts: Pick<PlanFacts, 'accepted' | 'ready'>): { done: number; total: number } {
  const done = (facts.accepted ? 1 : 0) + (facts.ready ? 1 : 0);
  return { done, total: SETUP.length };
}

const isOpen = (move: PlanMove) => OPEN_STATES.includes(move.state);
const openCount = (moves: readonly PlanMove[]) => moves.filter(isOpen).length;

/** One event on one move, through the table: the move in its new state, or the same move when the state does not take it. */
function send(move: PlanMove, event: MoveEvent, by: MoveActor, now: string): PlanMove {
  const next = EVENT_BY[event].includes(by) ? moveAfter(move.state, event) : null;
  return next ? { ...move, state: next, at: now, by } : move;
}

/** The moves code can name without a model: what is still to set up, then the way's first week, or the first client, invoice and payment. */
function candidates(facts: PlanFacts): Candidate[] {
  const own: Candidate[] = facts.firstWeek.length
    ? facts.firstWeek.map(text => ({ id: moveId(text), text, source: 'way' as const }))
    : STARTER.filter(item => !checkMet(item.check, facts));
  return [...SETUP.filter(item => !checkMet(item.check, facts)), ...own];
}

/**
 * Adds code's own moves, in order, while fewer than five are open; one already listed or set aside earlier is never
 * added again. What makes what is sold ready comes before every other open move, whenever it is added. Once a way is
 * kept its first week is the plan, so the first client, invoice and payment that stood in for it leave the list while
 * they are still open.
 */
function fill(plan: StandingPlan, facts: PlanFacts, now: string): StandingPlan {
  const standIns = facts.firstWeek.length ? new Set(STARTER.map(item => item.id)) : new Set<string>();
  const kept = plan.moves.filter(move => !(standIns.has(move.id) && isOpen(move)));
  const known = new Set([...kept.map(move => move.id), ...plan.past]);
  const moves = [...kept];
  for (const item of candidates(facts)) {
    if (openCount(moves) >= MOVES_MAX) break;
    if (known.has(item.id)) continue;
    known.add(item.id);
    const move: PlanMove = { id: item.id, text: item.text, source: item.source, state: 'planned', at: now, by: 'records', ...(item.check ? { check: item.check } : {}) };
    const before = READY_IDS.has(item.id) ? moves.findIndex(other => isOpen(other) && !READY_IDS.has(other.id)) : -1;
    if (before >= 0) moves.splice(before, 0, move); else moves.push(move);
  }
  return moves.length === plan.moves.length && kept.length === plan.moves.length ? plan : { ...plan, moves };
}

/** A new week: what is still open stays, in order; what was done or dropped is set aside and remembered by id. */
function roll(plan: StandingPlan, week: string): StandingPlan {
  if (plan.weekOf === week) return plan;
  const closed = plan.moves.filter(move => !isOpen(move)).map(move => move.id);
  return { weekOf: week, moves: plan.moves.filter(isOpen), past: [...plan.past, ...closed].slice(-PAST_MAX) };
}

/** What the records say about one move, as an event; null when they say nothing new. */
function recordEvent(move: PlanMove, facts: PlanFacts): MoveEvent | null {
  if (move.proposalId && (move.state === 'proposed' || move.state === 'working' || move.state === 'failed' || move.state === 'done')) {
    // The card's records say where its move stands, at every read: an event the state does not take changes nothing.
    switch (facts.proposals[move.proposalId]) {
      case 'raised': return move.state === 'proposed' ? null : 'return';
      case 'working': return move.state === 'working' ? null : 'begin';
      case 'approved': return move.state === 'done' ? null : 'approve';
      case 'failed': return move.state === 'failed' ? null : 'fail';
      case 'dismissed': case 'refused': return 'dismiss';
      // Drafted again or gone from the records: a move still waiting on it is planned again; an ended one stays.
      default: return move.state === 'done' || move.state === 'failed' ? null : 'withdraw';
    }
  }
  return move.check && (move.state === 'planned' || move.state === 'waiting') && checkMet(move.check, facts) ? 'finish' : null;
}

/**
 * The plan as the records leave it now: a new week rolled, code's own moves filled in, every move the records moved
 * sent through the table, and the owner given their turn: the first move still theirs to do, in order, is waiting on
 * them. Answers the same plan, by identity, when nothing changed.
 */
export function syncPlan(plan: StandingPlan, facts: PlanFacts, now: string): StandingPlan {
  let next = fill(roll(plan, weekOf(facts.today)), facts, now);
  let moves = next.moves.map(move => { const event = recordEvent(move, facts); return event ? send(move, event, 'records', now) : move; });
  const turn = moves.findIndex(move => move.state === 'planned' || move.state === 'waiting');
  if (turn >= 0 && moves[turn]!.state === 'planned') moves = moves.map((move, index) => (index === turn ? send(move, 'start', 'records', now) : move));
  if (moves.some((move, index) => move !== next.moves[index])) next = { ...next, moves };
  return next;
}

/** A plan nobody stored yet: this week's, from the records alone. */
export function seedPlan(facts: PlanFacts, now: string): StandingPlan {
  return syncPlan({ weekOf: weekOf(facts.today), moves: [], past: [] }, facts, now);
}

/**
 * The owner moves a move by hand: done, dropped, or planned again. Null when it is not theirs to move: an id the plan
 * does not hold, a state that does not take it, or a move the records check themselves.
 */
export function ownerMove(plan: StandingPlan, id: string, to: 'done' | 'dropped' | 'planned', facts: PlanFacts, now: string): StandingPlan | null {
  const move = plan.moves.find(item => item.id === id);
  if (!move || move.check) return null;
  const moved = send(move, to === 'done' ? 'finish' : to === 'dropped' ? 'drop' : 'reopen', 'owner', now);
  if (moved === move) return null;
  return syncPlan({ ...plan, moves: plan.moves.map(item => (item === move ? moved : item)) }, facts, now);
}

/** What the owner may do with a move by hand. */
export function ownerCan(move: PlanMove): ('done' | 'dropped' | 'planned')[] {
  if (move.check) return [];
  const can: ('done' | 'dropped' | 'planned')[] = [];
  if (moveAfter(move.state, 'finish')) can.push('done');
  if (moveAfter(move.state, 'drop')) can.push('dropped');
  if (moveAfter(move.state, 'reopen')) can.push('planned');
  return can;
}

/** The chief's own moves, in its words, added while fewer than five are open; words already on the list or set aside are skipped. */
export function addChiefMoves(plan: StandingPlan, texts: readonly string[], now: string): StandingPlan {
  const known = new Set([...plan.moves.map(move => move.id), ...plan.past]);
  const moves = [...plan.moves];
  for (const text of texts) {
    const id = moveId(text);
    if (openCount(moves) >= MOVES_MAX) break;
    if (known.has(id)) continue;
    known.add(id);
    moves.push({ id, text, source: 'chief', state: 'planned', at: now, by: 'chief' });
  }
  return moves.length === plan.moves.length ? plan : { ...plan, moves };
}

/** A card the chief put on Today becomes a move in state proposed, once per proposal. */
export function proposeMove(plan: StandingPlan, card: { title: string; proposalId: string }, now: string): StandingPlan {
  if (plan.moves.some(move => move.proposalId === card.proposalId)) return plan;
  const planned: PlanMove = { id: `mv_${card.proposalId}`, text: card.title, source: 'chief', state: 'planned', at: now, by: 'chief', proposalId: card.proposalId };
  return { ...plan, moves: [...plan.moves, send(planned, 'propose', 'chief', now)] };
}

/** The chief read from the records that these moves are done: only ones still open that the records do not check themselves. */
export function chiefFinish(plan: StandingPlan, ids: readonly string[], now: string): StandingPlan {
  const moves = plan.moves.map(move => (ids.includes(move.id) && !move.check && !move.proposalId ? send(move, 'finish', 'chief', now) : move));
  return moves.some((move, index) => move !== plan.moves[index]) ? { ...plan, moves } : plan;
}

// ---------------------------------------------------------------------------
// The one next best step
// ---------------------------------------------------------------------------

export type StepInput = {
  facts: PlanFacts;
  /**
   * The waiting Today row the queue ranks first (money/next-step.ts), or none. setup: it is a housekeeping card
   * (confirm tax, keep a recovery code, connect an AI). Such a card blocks no earning, and the queue names one only
   * when no other row waits. notice: it only tells the owner something (a payment came in, a check found something):
   * no customer waits on it.
   */
  row: { rowId: string; title: string; setup?: boolean; notice?: boolean } | null;
  /** The plan's own card on Today while the plan waits to be accepted. */
  planRowId: string | null;
  /** The most overdue open invoice, or none. */
  overdue: { invoiceId: string; number: string; days: number } | null;
  moves: readonly PlanMove[];
};
export type StepCore =
  | { kind: 'offer'; what: 'accept' | 'price'; title: string; rowId: string | null }
  | { kind: 'row'; rowId: string; title: string }
  | { kind: 'overdue'; invoiceId: string; number: string; days: number }
  | { kind: 'move'; moveId: string; title: string }
  | { kind: 'clear' };

/**
 * Exactly one step, always, in this order (found live, 15 Nov 2026: "Confirm your tax" led three owners' weeks):
 * 1. What blocks all earning: the plan not accepted. An offer with no price too, while the business has no client yet:
 *    customers are not looked for or written to before it, and nothing real can be waiting.
 * 2. A card on Today that is the owner's decision on real work (an approval, a proposal, a draft, a client's
 *    question), then an overdue invoice. A business that already has clients is not held behind a new offer's price;
 *    a notice (a payment came in) is no customer waiting, so it leads only once every offer is priced.
 * 3. An offer with no price, for a business that has clients.
 * 4. The week's move that is the owner's turn.
 * 5. A housekeeping card (confirm tax, keep a recovery code, connect an AI). It blocks nothing, so it is the step only
 *    when nothing above is; until then the plan's view names it as also waiting (plan-view.ts).
 * With nothing left it says so.
 */
export function nextStepOf(input: StepInput): StepCore {
  const { facts } = input;
  const offer = (what: 'accept' | 'price'): StepCore => ({ kind: 'offer', what, title: facts.missing[0] ?? PLAN_FIXED_WORDS.finishOffer, rowId: what === 'accept' ? input.planRowId : null });
  if (!facts.accepted) return offer('accept');
  if (!facts.ready && facts.clients === 0) return offer('price');
  if (input.row && !input.row.setup && (facts.ready || !input.row.notice)) return { kind: 'row', rowId: input.row.rowId, title: input.row.title };
  if (input.overdue) return { kind: 'overdue', ...input.overdue };
  if (!facts.ready) return offer('price');
  const move = input.moves.find(item => item.state === 'waiting') ?? input.moves.find(item => item.state === 'planned');
  if (move) return { kind: 'move', moveId: move.id, title: move.text };
  return input.row ? { kind: 'row', rowId: input.row.rowId, title: input.row.title } : { kind: 'clear' };
}

// A first-week move that finds or lists possible customers has a capability that does it: Find customers. Code knows
// such a move from its source and its plain words, and only when sure, so the step's button can open that capability
// (plan-view.ts stepView). Unsure, the move keeps "Done" and nothing is claimed for it.
/** It starts by finding or listing. */
const FIND_VERB = /^(?:build|make|prepare|find|list|compile|collect|gather|draw up|put together|look for|search for|shortlist|identify)\b/i;
/** It says who: possible customers, by a word that means that. */
const FIND_WHOM = /\b(?:possible|potential|prospective|likely|customers?|clients?|leads?|prospects?|buyers?)\b/i;
/** A list of a kind of place the public map knows: "a list of offices and event planners". */
const A_LIST = /\blist of\b/i;
/** It is not about writing to them, or about a list of something else the business makes or buys. */
const NOT_FINDING = /\b(?:send|sends|write|message|messages|email|emails|call|calls|post|reply|pay|price|prices|pricing|designs?|materials?|suppliers?|samples?|products?|invoices?)\b/i;

/**
 * Whether a move is about finding or listing possible customers, so Find customers does it: only a step of the way's
 * own first week (source 'way') that no record checks and no card stands for, whose words start with finding or
 * listing, name possible customers, and name nothing else.
 */
export function findsCustomers(move: Pick<PlanMove, 'source' | 'text' | 'check' | 'proposalId'>): boolean {
  if (move.source !== 'way' || move.check || move.proposalId) return false;
  const text = move.text.trim();
  // Fix round 6 (17 Nov 2026): "Prepare a list of offices and event planners to review." is finding customers too: a
  // list of a kind of place the map knows says who as plainly as "possible customers" does.
  return FIND_VERB.test(text) && (FIND_WHOM.test(text) || (A_LIST.test(text) && kindsNamed(text).length > 0)) && !NOT_FINDING.test(text);
}

/**
 * A card stands for a move of the week that is still the owner's to do (planned or waiting): the move keeps its own
 * words and follows the card from now on, so no second move is added for the same work. Once per proposal.
 */
export function proposeOnMove(plan: StandingPlan, moveId: string, proposalId: string, now: string): StandingPlan {
  if (plan.moves.some(move => move.proposalId === proposalId)) return plan;
  const moves = plan.moves.map(move => (move.id === moveId && !move.proposalId && (move.state === 'planned' || move.state === 'waiting') ? send({ ...move, proposalId }, 'propose', 'chief', now) : move));
  return moves.some((move, index) => move !== plan.moves[index]) ? { ...plan, moves } : plan;
}

/** The week's open move about finding possible customers that no card stands for yet, if there is one. */
export function findMove(plan: StandingPlan): PlanMove | undefined {
  return plan.moves.find(move => (move.state === 'planned' || move.state === 'waiting') && findsCustomers(move));
}

/** The line code writes for today when the owner's AI wrote none: where the week stands, counted from the plan. */
export function codeLine(facts: PlanFacts, moves: readonly PlanMove[]): string {
  if (!facts.ready) return PLAN_FIXED_WORDS.getReady;
  const counted = moves.filter(move => move.state !== 'dropped');
  const done = counted.filter(move => move.state === 'done').length;
  if (!counted.length) return PLAN_FIXED_WORDS.noMoves;
  if (done === 0) return `None of ${counted.length} moves done yet this week.`;
  return done === counted.length ? `All ${done} moves done this week.` : `${done} of ${counted.length} moves done this week.`;
}
