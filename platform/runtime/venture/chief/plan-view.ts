// Chausar venture launcher, chief: the standing plan's words, and the plan as the screens read it, from what
// plan-core.ts decided. Every sentence the owner reads about the plan, its daily review and Chausar's own daily AI
// allowance is written here once. Like plan-core.ts it imports no engine store code and none of the engine's contracts
// (contracts.ts takes these view types from here), so the app's fake engine says exactly these words by using this
// file, not a copy of it.
import { formatClock, formatRate, placeWords } from '../../owner-format.ts';
import { MOVE_STATE_LABEL, findsCustomers, ownerCan, type MoveCheck, type MoveState, type PlanMove, type StepCore } from './plan-core.ts';

/** A figure with the receipt behind it (contracts.ts MoneyFigureView). */
export type StepFigure = { display: string; receiptId: string };
/** One move as the screens show it. label: its state in words. can: what the owner may do with it by hand. */
export type ChiefPlanMoveView = {
  id: string; text: string; state: MoveState; label: string;
  /** Its card on Today, while it is proposed. */
  rowId: string | null;
  can: ('done' | 'dropped' | 'planned')[];
};
/** The one primary action of the next best step: press a card on Today, go to a page, or say a move is done. */
export type ChiefPlanAction =
  | { id: 'row'; label: string; rowId: string }
  | { id: 'go'; label: string; link: string }
  | { id: 'done'; label: string; moveId: string };
/**
 * The next best step: always exactly one. by: 'records' when code decided it from the records alone, 'chief' when it is
 * a move the daily review worded. figure: the money a waiting card puts at stake, with its receipt.
 */
export type ChiefPlanStep = {
  kind: 'offer' | 'row' | 'overdue' | 'move' | 'clear';
  title: string;
  line: string | null;
  action: ChiefPlanAction | null;
  agent: string | null;
  figure: StepFigure | null;
  goalAfterPercent: number | null;
  by: 'records' | 'chief';
  /**
   * The housekeeping cards that also wait on Today (confirm tax, keep a recovery code, connect an AI), as one quiet
   * line with their rows and, in the same order, their titles (so the app can say the line in the owner's language,
   * round 5); null when none waits. They block nothing, so they never lead the step (plan-core.ts).
   */
  also: { line: string; rowIds: string[]; titles: string[] } | null;
};
/** How much Chausar may use the owner's AI on its own each day, and what it used today. cap: on a key only. */
export type ChiefOwnUseView = {
  runsPerDay: number; usedRuns: number; capMicros: string; cap: string; capTyped: string; keyed: boolean; line: string;
};

// ---------------------------------------------------------------------------
// The daily review, as a routine and as its offer card
// ---------------------------------------------------------------------------

/** The daily review's own name and words: fixed, so the owner approves exactly this once. */
export const DAILY_REVIEW_NAME = 'Daily review';
export const DAILY_REVIEW_PROMPT = 'Review my business for today: mark what my records show is done, choose my next best step, and propose at most a few new moves for me to approve.';
/** The time on the owner's clock the daily review runs at until the owner changes it. */
export const DAILY_REVIEW_TIME = '08:00';
/** What every run of the daily review does, as its routine says it. */
export const REVIEW_LINE = 'Chausar reads your records and updates your plan. It never sends, spends or changes a price.';

/** The subject the owner's answer to the offer is recorded under (on, or not now); once answered it is not made again. */
export const REVIEW_OFFER_SUBJECT = 'review:daily';
export const REVIEW_OFFER_TITLE = 'Let Chausar plan each morning';

const times = (count: number) => `${count} ${count === 1 ? 'time' : 'times'}`;

/** What the offer says the owner approves: when it runs, what a run does, how much of their AI it may use, and what it never does. */
export function reviewOfferLine(time: string, runsPerDay: number, withAi: boolean): string {
  const reads = `Every day at ${formatClock(time)} Chausar reads your records, updates your plan and may put ideas on Today for you to approve.`;
  const ai = withAi && runsPerDay > 0 ? ` It asks your AI at most ${times(runsPerDay)} a day.` : '';
  // With no AI connected at all the review still works: it says what it plans from until one is.
  const records = withAi ? '' : ' It plans from your records until you connect an AI.';
  return `${reads}${ai}${records} It never sends, spends or changes a price.`;
}

/**
 * When the daily review runs, in the owner's words: the time, and the place only when it is not where this computer is.
 * here: the computer's own zone, or null when that is not where the owner is (the hosted app runs on a server).
 */
export function reviewWhen(time: string, timeZone: string, here: string | null): string {
  // Every routine's schedule reads this way (agents/routines.ts whenWords, owner-format.ts placeWords).
  return `Every day at ${formatClock(time)}${placeWords(timeZone, here)}`;
}

/**
 * The review's lines that are the same every time. The app says each from its own pack (app/ui/src/places/today/
 * plan-words.ts; round 5, re-check 082: with Hindi on, "Daily review at 8:00 am." stayed English). The line with the
 * time (REVIEW_WORDS.line) the app says from review.on and review.time with the pack's own words.
 */
export const REVIEW_FIXED_WORDS = Object.freeze({
  nothingNew: 'Reviewed with your AI. Nothing new for Today.',
  fromRecords: 'Reviewed from your records.',
  consent: 'Chausar plans from your records only. Agree to what your AI is sent and it plans with your AI too.',
  failed: 'Your AI could not answer this time, so Chausar planned from your records.',
  off: 'Daily review is off.',
});

export const REVIEW_WORDS = Object.freeze({
  withAi: (raised: number) => (raised === 0 ? REVIEW_FIXED_WORDS.nothingNew : `Reviewed with your AI. ${raised} new ${raised === 1 ? 'card' : 'cards'} on Today.`),
  fromRecords: REVIEW_FIXED_WORDS.fromRecords,
  held: (why: string) => `${why} Chausar planned from your records and looks again tomorrow.`,
  /**
   * Shown only while it is true (chief/plan.ts reviewView): the review is on, an AI is connected and would be asked,
   * and the chat consent is missing. The screen puts the consent itself beside it, to agree in place.
   */
  consent: REVIEW_FIXED_WORDS.consent,
  failed: REVIEW_FIXED_WORDS.failed,
  busy: 'A review is already running.',
  /** The review as one line on the plan. */
  line: (on: boolean, time: string) => (on ? `Daily review at ${formatClock(time)}.` : REVIEW_FIXED_WORDS.off),
  /** What the owner approved, for the decision record. when: the schedule in words. */
  approved: (on: boolean, when: string) => (on ? `Daily review on: ${when}. ${REVIEW_LINE}` : 'Daily review off.'),
  time: 'Give the time as HH:MM on a 24-hour clock, like 08:00.',
  shape: 'The daily review keeps its own name and words and runs every day. Change its time, or switch it off.',
  onlyOne: 'This business already has its daily review. Change that one.',
});

// ---------------------------------------------------------------------------
// Chausar's own daily AI allowance
// ---------------------------------------------------------------------------

/** Until the owner changes them: three times a day, and on a key a quarter of a US dollar a day. */
export const OWN_USE_DEFAULT = Object.freeze({ runsPerDay: 3, capMicros: '250000' });
/** A day has this many hours; zero means Chausar never asks the AI on its own. */
export const OWN_USE_RUNS_MAX = 24;

export const OWN_USE_WORDS = Object.freeze({
  never: 'You set Chausar to never ask your AI on its own.',
  runs: (used: number) => `Chausar asked your AI ${times(used)} today, the most you allow it on its own.`,
  cap: (capMicros: string) => `Chausar's own AI use reached today's limit of ${formatRate(capMicros)}.`,
  capNext: (capMicros: string) => `One more call would pass Chausar's own limit of ${formatRate(capMicros)} for today.`,
  plan: (tool: string, until: string | null) => `Your ${tool} plan is used up${until ? ` until ${until}` : ''}.`,
  runsRange: `Choose how many times a day Chausar may ask your AI on its own, from 0 to ${OWN_USE_RUNS_MAX}.`,
});

/** The allowance as the owner reads it. cap and capTyped: the day's limit on a key, as words and as the field takes it back. */
export function ownUseViewOf(allowance: { runsPerDay: number; capMicros: string }, usedRuns: number, keyed: boolean): ChiefOwnUseView {
  const cap = formatRate(allowance.capMicros);
  const most = allowance.runsPerDay === 0 ? 'Chausar never asks your AI on its own.' : `Chausar may ask your AI on its own up to ${times(allowance.runsPerDay)} a day${keyed ? `, at most ${cap} a day` : ''}.`;
  return {
    runsPerDay: allowance.runsPerDay, usedRuns, capMicros: allowance.capMicros, cap, capTyped: cap.replace(/^\$/, '').replace(/,/g, ''), keyed,
    line: allowance.runsPerDay === 0 ? most : `${most} ${usedRuns} used today.`,
  };
}

// ---------------------------------------------------------------------------
// The next best step and the moves, as the screens read them
// ---------------------------------------------------------------------------

/**
 * The step's words that code writes the same every time: its buttons and its fixed lines. The app says each from its
 * own pack (app/ui/src/places/today/plan-words.ts; round 5, re-check 082: with Hindi on, the step's "Done" stayed
 * English). A step's title or line that the owner's AI or a card wrote is not one of these.
 */
export const STEP_FIXED_WORDS = Object.freeze({
  openPlan: 'Open your plan',
  setPrices: 'Set prices',
  addClient: 'Add a client',
  openInvoices: 'Open invoices',
  findCustomers: 'Find customers',
  openInvoice: 'Open invoice',
  done: 'Done',
  find: 'Chausar looks only after you approve the search. You can still mark this done under This week.',
  offer: 'Chausar looks for customers only once this is done.',
  overdue: 'Remind your client, or record the payment if it came in.',
  clear: 'Nothing needs you right now.',
  clearOn: 'Chausar looks again at its next daily review.',
  clearOff: 'Turn on the daily review and Chausar plans each morning.',
});

/** Where a move the records check is done, and the words on the way there. */
export const CHECK_PLACE: Readonly<Record<MoveCheck, { label: string; link: string }>> = Object.freeze({
  'plan-accepted': { label: STEP_FIXED_WORDS.openPlan, link: '#/business/plan' },
  'offers-priced': { label: STEP_FIXED_WORDS.setPrices, link: '#/business/prices' },
  'first-client': { label: STEP_FIXED_WORDS.addClient, link: '#/clients' },
  'first-invoice': { label: STEP_FIXED_WORDS.openInvoices, link: '#/money/invoices' },
  'first-payment': { label: STEP_FIXED_WORDS.openInvoices, link: '#/money/invoices' },
});

/**
 * Where a first-week move about finding customers is done: the Find customers sheet on Clients, Pipeline, whose brief
 * is seeded from the way to earn (customers/find-target.ts seededBrief). The search still runs only on an approved card.
 */
export const FIND_PLACE = Object.freeze({ label: STEP_FIXED_WORDS.findCustomers, link: '#/clients/pipeline?sheet=find:new' });

export const STEP_WORDS = Object.freeze({
  /** Under a step whose button opens Find customers: nothing runs yet, and the move is still the owner's to tick. */
  find: STEP_FIXED_WORDS.find,
  offer: STEP_FIXED_WORDS.offer,
  overdue: STEP_FIXED_WORDS.overdue,
  late: (number: string, days: number) => `Invoice ${number} is ${days} ${days === 1 ? 'day' : 'days'} late.`,
  openInvoice: STEP_FIXED_WORDS.openInvoice,
  done: STEP_FIXED_WORDS.done,
  clear: STEP_FIXED_WORDS.clear,
  clearOn: STEP_FIXED_WORDS.clearOn,
  clearOff: STEP_FIXED_WORDS.clearOff,
  /** The housekeeping cards that also wait, by their titles. */
  also: (titles: readonly string[]) => `Also waiting: ${titles.join(', ')}.`,
  moveRefused: 'That move cannot be changed that way.',
  moveTo: 'Say done, dropped or planned.',
});

/** A row of Today as the step reads it: its id, its kind and title, and its buttons. */
export type StepRow = { id: string; kind?: string; title?: string; actions: readonly { id?: string; label: string; primary: boolean }[] };
/** The kind of Today's housekeeping cards: setting up, never the owner's decision on real work (money/next-step.ts holds the same word). */
export const SETUP_KIND = 'setup';

/**
 * The housekeeping cards that wait beside the step, in Today's order: every setup card but the step's own. The step to
 * set a price goes where the prices card goes, so that card is not named beside it.
 */
function alsoWaiting(core: StepCore, rows: readonly StepRow[]): ChiefPlanStep['also'] {
  const own = core.kind === 'row' || core.kind === 'offer' ? core.rowId : null;
  const waiting = rows.filter(row => row.kind === SETUP_KIND && row.title && row.id !== own
    && !(core.kind === 'offer' && core.what === 'price' && row.actions.some(action => action.primary && action.id === 'set-prices')));
  const titles = waiting.map(row => row.title!);
  return waiting.length ? { line: STEP_WORDS.also(titles), rowIds: waiting.map(row => row.id), titles } : null;
}
/** The waiting row the queue ranks first (money/next-step.ts NextBestStep), as far as the step shows it. */
export type RankedStep = { rowId: string; title: string; agent: string | null; line: string; figure: StepFigure | null; goalAfterPercent: number | null };

const primaryLabel = (row: StepRow | undefined): string => row?.actions.find(action => action.primary)?.label ?? 'Open';

/** The step with its words and its one primary action, from what plan-core chose. */
export function stepView(core: StepCore, context: { rows: readonly StepRow[]; ranked: RankedStep | null; moves: readonly PlanMove[]; reviewOn: boolean }): ChiefPlanStep {
  const blank = { line: null, action: null, agent: null, figure: null, goalAfterPercent: null, by: 'records' as const, also: alsoWaiting(core, context.rows) };
  switch (core.kind) {
    case 'offer': {
      const row = core.rowId ? context.rows.find(item => item.id === core.rowId) : undefined;
      const action: ChiefPlanAction = row ? { id: 'row', label: primaryLabel(row), rowId: row.id }
        : { id: 'go', ...CHECK_PLACE[core.what === 'accept' ? 'plan-accepted' : 'offers-priced'] };
      return { ...blank, kind: 'offer', title: core.title, line: STEP_WORDS.offer, action };
    }
    case 'row': {
      const next = context.ranked;
      return {
        ...blank, kind: 'row', title: core.title, line: next?.line ?? null, agent: next?.agent ?? null, figure: next?.figure ?? null, goalAfterPercent: next?.goalAfterPercent ?? null,
        action: { id: 'row', label: primaryLabel(context.rows.find(item => item.id === core.rowId)), rowId: core.rowId },
      };
    }
    case 'overdue':
      return {
        ...blank, kind: 'overdue', title: STEP_WORDS.late(core.number, core.days), line: STEP_WORDS.overdue,
        action: { id: 'go', label: STEP_WORDS.openInvoice, link: `#/money/invoices?sheet=invoice:${core.invoiceId}` },
      };
    case 'move': {
      const move = context.moves.find(item => item.id === core.moveId);
      // A first-week move that finds possible customers opens the capability that does it (plan-core.ts findsCustomers).
      // The step is a move only once what is sold is ready (nextStepOf), so the search's own gate is already open.
      if (move && findsCustomers(move)) return { ...blank, kind: 'move', title: core.title, line: STEP_WORDS.find, action: { id: 'go', ...FIND_PLACE } };
      const action: ChiefPlanAction = move?.check ? { id: 'go', ...CHECK_PLACE[move.check] } : { id: 'done', label: STEP_WORDS.done, moveId: core.moveId };
      return { ...blank, kind: 'move', title: core.title, action, by: move?.source === 'chief' ? 'chief' : 'records' };
    }
    case 'clear':
      return { ...blank, kind: 'clear', title: STEP_WORDS.clear, line: context.reviewOn ? STEP_WORDS.clearOn : STEP_WORDS.clearOff };
  }
}

/** One move as the screens show it. rowId: its card on Today, while it is proposed and the card still waits. */
export function moveView(move: PlanMove, rowId: string | null): ChiefPlanMoveView {
  return { id: move.id, text: move.text, state: move.state, label: MOVE_STATE_LABEL[move.state], rowId, can: ownerCan(move) };
}
