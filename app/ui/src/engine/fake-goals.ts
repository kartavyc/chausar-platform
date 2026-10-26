/**
 * The fake engine's goals and next best step (W4 4I2): venture.goals.get, .set and .suggest, answered with the engine's
 * codes, shapes, words and order (platform/runtime/venture/money/goals.ts, goal-plans.ts and next-step.ts). The goal
 * counts money invoiced in the month before tax, by the invoices' issue date: the fake reads its own invoices
 * (venture.invoice.list and .get), so a draft issued on Today moves the card. Received so far is the books' own figure
 * for this month. Each sum is a receipt this desk serves (one id per distinct sum, as the engine keeps one per digest);
 * an empty sum shows zero with no receipt. Today's pace and the next best step are for the current month only. The
 * suggestion is a model estimate from the plan's priced offers, and null with no AI on the fast tier. Months read on the
 * owner's calendar in Kolkata, as the sample businesses are in India. Unlike the engine the fake keeps no credit notes
 * against a goal and no discount on an invoice; its samples have neither.
 *
 * The sample: Lumen Studio aims to invoice ₹1,50,000.00 in October 2026; the other businesses have no goal yet.
 */

import { EngineError, type BlueprintViewLite, type BooksSummaryLite, type GoalFigure, type GoalSuggestion, type GoalView, type InvoiceLite, type InvoiceViewLite, type ModelStatusLite, type NextBestStep, type QueueRow, type ReceiptLite } from './types';
import { BOOKS, RECEIPTS } from './fixtures';
import { inr } from './fake-money';
import type { W4DeskHost } from './fake-w4';

export const FAKE_4I2_METHODS: readonly string[] = ['venture.goals.get', 'venture.goals.set', 'venture.goals.suggest'];

interface HeldGoal { id: string; businessId: string; month: string; amountMinor: string; at: string }
const SEED: readonly Omit<HeldGoal, 'at'>[] = [{ id: 'goal-lumen-2026-10', businessId: 'lumen', month: '2026-10', amountMinor: '15000000' }];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const GOAL_AMOUNT = /^[1-9]\d{0,14}$/;
const MONTHS_BACK = 24;
const MONTHS_AHEAD = 12;
const BRIEFING_MAX = 6;
const NOT_A_STEP = new Set(['later', 'read', 'watch']);
/** The engine's words, word for word. */
const SUGGEST_LINE = 'A model estimate from your offers and prices. Change it to what you aim for.';

const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
const monthWords = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
const monthsBetween = (from: string, to: string) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
const daysInMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const previousMonth = (month: string) => {
  const year = Number(month.slice(0, 4)), index = Number(month.slice(5, 7)) - 1;
  return index === 0 ? `${year - 1}-12` : `${year}-${String(index).padStart(2, '0')}`;
};
/** Paise from the fake's own formatted text ("₹1,12,400.00"). The fake only: the screens never read an amount back. */
const paise = (display: string) => Number(display.replace(/[^\d-]/g, ''));

function monthText(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value) || Number(value.slice(0, 4)) < 2000 || Number(value.slice(0, 4)) > 2100) throw invalid('Use a month like 2026-10.');
  return value;
}

/** The owner's typed goal in paise, as goals.ts typedGoal reads it (the samples are all in rupees): GOAL_INVALID otherwise. */
function typedGoal(value: unknown): string {
  const words = 'Type the goal like 150000 or 150000.50, in INR.';
  const cleaned = typeof value === 'string' && value.length <= 40 ? value.replace(/[\s,]/g, '') : '';
  const match = /^(\d+)(?:\.(\d+))?$/.exec(cleaned);
  const fraction = (match?.[2] ?? '').replace(/0+$/, '');
  if (!match || fraction.length > 2) throw new EngineError('GOAL_INVALID', words);
  return (BigInt(match[1]!) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
}

function exact(p: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = []): void {
  if (Object.keys(p).some((key) => !allowed.includes(key)) || required.some((key) => !(key in p))) throw invalid('Send the required fields and nothing else.');
}

export class FakeGoals {
  private readonly host: W4DeskHost;
  private readonly goals: HeldGoal[];
  private readonly receipts: ReceiptLite[] = [];
  private readonly made = new Map<string, string>();
  private seq = 4200;

  constructor(host: W4DeskHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    this.goals = options.fresh ? [] : SEED.map((goal) => ({ ...goal, at: '2026-10-01T04:00:00.000Z' }));
  }

  /** A receipt this desk made, for venture.receipt.get. */
  receipt(id: string): ReceiptLite | undefined {
    const found = this.receipts.find((receipt) => receipt.id === id);
    return found ? structuredClone(found) : undefined;
  }

  request(method: string, p: Record<string, unknown>): unknown {
    // As the engine's readVenture: no business open, nothing to read or set.
    if (!this.host.current()) throw new EngineError('VENTURE_NOT_FOUND', 'Start a business first.');
    if (method === 'venture.goals.get') {
      exact(p, ['month']);
      return this.view(p.month === undefined ? null : monthText(p.month));
    }
    if (method === 'venture.goals.set') return this.set(p);
    if (method === 'venture.goals.suggest') return this.suggest(p);
    throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
  }

  /** Today on the owner's calendar in Kolkata (UTC+05:30). */
  private today(): string {
    return new Date(Date.parse(this.host.now()) + 330 * 60_000).toISOString().slice(0, 10);
  }

  private inUse(month: string): HeldGoal | null {
    return this.goals.filter((goal) => goal.businessId === this.host.current() && goal.month === month).at(-1) ?? null;
  }

  /** One receipt per distinct sum: the same lines give the same id, as the engine keeps one per digest. */
  private sum(label: string, lines: { label: string; minor: number }[], none: string): GoalFigure {
    const total = lines.reduce((sum, line) => sum + line.minor, 0);
    if (!lines.length) return { display: inr(0), receiptId: null };
    const explanation = `${lines.length} ${lines.length === 1 ? 'item' : 'items'}: ${lines.map((line) => `${line.label} ${inr(line.minor)}`).join('; ')}. Added together: ${inr(total)}.`;
    const key = `${label}|${explanation}`;
    let id = this.made.get(key);
    if (!id) {
      id = `R-${this.seq++}`;
      this.made.set(key, id);
      this.receipts.push({ id, at: this.host.now(), explanation: explanation || none, stale: false, figures: [{ key: 'total', label, display: inr(total) }] });
    }
    return { display: inr(total), receiptId: id };
  }

  /** The month's invoices before tax (the subtotal), issued ones or drafts ready to issue, oldest first. */
  private invoices(month: string, which: 'issued' | 'ready'): { invoice: InvoiceLite; minor: number; client: string }[] {
    const listed = this.host.ask('venture.invoice.list', {}) as InvoiceLite[];
    return listed
      .filter((invoice) => invoice.issueDate?.slice(0, 7) === month && (which === 'issued' ? ['issued', 'part-paid', 'paid'].includes(invoice.status) && invoice.number !== null : invoice.status === 'draft'))
      .sort((a, b) => (a.issueDate ?? '').localeCompare(b.issueDate ?? '') || (a.number ?? '').localeCompare(b.number ?? ''))
      .map((invoice) => {
        const view = this.host.ask('venture.invoice.get', { invoiceId: invoice.id }) as InvoiceViewLite;
        const subtotal = view.figures.find((figure) => figure.key === 'subtotal')?.display ?? '0';
        return { invoice, minor: paise(subtotal), client: view.client.name };
      });
  }

  private view(month: string | null): GoalView {
    const today = this.today();
    const current = today.slice(0, 7);
    const chosen = month ?? current;
    const away = monthsBetween(current, chosen);
    if (away < -MONTHS_BACK || away > MONTHS_AHEAD) throw invalid('Choose a month from two years back to one year ahead.');
    const goal = this.inUse(chosen);
    const isCurrent = chosen === current;
    const days = daysInMonth(chosen);
    const elapsed = today.slice(0, 7) < chosen ? 0 : today.slice(0, 7) > chosen ? days : Number(today.slice(8, 10));
    const pacePermille = Math.floor((elapsed * 1000) / days);
    const words = monthWords(chosen);

    const issued = this.invoices(chosen, 'issued');
    const ready = this.invoices(chosen, 'ready');
    const invoicedMinor = issued.reduce((sum, item) => sum + item.minor, 0);
    const readyMinor = ready.reduce((sum, item) => sum + item.minor, 0);
    const invoiced = this.sum(`Invoiced in ${words}`, issued.map(({ invoice, minor, client }) => ({ label: `${invoice.number} for ${client}`, minor })), `Nothing was invoiced in ${words}.`);
    const readyFigure = this.sum(`Ready to issue in ${words}`, ready.map(({ invoice, minor, client }) => ({ label: `Draft for ${client}, dated ${invoice.issueDate}`, minor })), `No drafts are ready to issue in ${words}.`);
    // The books' own received figure for this month (the sample books are this month's).
    const books: BooksSummaryLite | null = isCurrent ? BOOKS[this.host.current()] ?? null : null;
    const received = books?.figures.find((figure) => figure.operation === 'received');
    const receivedSoFar: GoalFigure = received ? { display: received.display, receiptId: received.receiptId } : { display: inr(0), receiptId: null };

    let goalFigure: GoalView['goal'] = null, stillToInvoice: GoalView['stillToInvoice'] = null, lastMonth: GoalView['lastMonth'] = null;
    let invoicedPermille: number | null = null, readyPermille: number | null = null, pace: GoalView['pace'] = null, paceReceiptId: string | null = null;
    let invoicedPercent: number | null = null, pastBy: GoalView['pastBy'] = null, paceBy: GoalView['paceBy'] = null;
    if (goal) {
      const goalMinor = Number(goal.amountMinor);
      const target = { label: `Your goal for ${words}`, minor: goalMinor };
      const lines = issued.map(({ invoice, minor, client }) => ({ label: `${invoice.number} for ${client}`, minor }));
      const steps = invoicedMinor > goalMinor
        ? this.sum('Past the goal by', [...lines, { ...target, minor: -goalMinor }], '')
        : this.sum('Still to invoice toward the goal', [target, ...lines.map((line) => ({ label: `Less ${line.label}`, minor: -line.minor }))], '');
      goalFigure = { display: inr(goalMinor), receiptId: steps.receiptId! };
      stillToInvoice = invoicedMinor < goalMinor ? { display: steps.display, receiptId: steps.receiptId! } : null;
      pastBy = invoicedMinor > goalMinor ? { display: steps.display, receiptId: steps.receiptId! } : null;
      invoicedPercent = invoicedMinor > 0 ? Math.floor((invoicedMinor * 100) / goalMinor) : 0;
      const share = (part: number) => (part <= 0 ? 0 : Math.min(1000, Math.floor((part * 1000) / goalMinor)));
      invoicedPermille = share(invoicedMinor);
      readyPermille = Math.min(1000 - invoicedPermille, share(readyMinor));
      if (isCurrent) {
        const paceMinor = Math.ceil((goalMinor * elapsed) / days);
        const when = `day ${elapsed} of ${days}`;
        const paceLine = { label: `Today's pace: ${when} of the ${inr(goalMinor)} goal`, minor: paceMinor };
        pace = invoicedMinor >= paceMinor ? 'ahead' : 'behind';
        const by = pace === 'ahead'
          ? this.sum(`Ahead of today's pace (${when}) by`, [...lines, { ...paceLine, minor: -paceMinor }], '')
          : this.sum(`Behind today's pace (${when}) by`, [paceLine, ...lines.map((line) => ({ label: `Less ${line.label}`, minor: -line.minor }))], '');
        paceReceiptId = by.receiptId;
        paceBy = { display: by.display, receiptId: by.receiptId! };
      }
    } else {
      const before = this.invoices(previousMonth(chosen), 'issued');
      const words2 = monthWords(previousMonth(chosen));
      lastMonth = this.sum(`Invoiced in ${words2}`, before.map(({ invoice, minor, client }) => ({ label: `${invoice.number} for ${client}`, minor })), `Nothing was invoiced in ${words2}.`);
    }

    const ahead = isCurrent ? this.next(goal ? { month: chosen, goalMinor: Number(goal.amountMinor), invoicedMinor } : null) : { next: null, briefing: null };
    return {
      month: chosen, state: goal ? 'set' : 'unset', goal: goalFigure, invoiced, ready: readyFigure, stillToInvoice, receivedSoFar,
      invoicedPermille, readyPermille, pacePermille, pace, paceReceiptId,
      invoicedPercent, pacePercent: Math.floor(pacePermille / 10), past: pastBy !== null, pastBy, paceBy,
      elapsedDays: elapsed, monthDays: days, daysLeft: days - elapsed, lastDay: isCurrent && elapsed === days, lastMonth,
      line: this.line(chosen, goal, invoicedMinor, pace, pacePermille), ...ahead,
    };
  }

  /** The view's one plain line, as goals.ts goalLine words it (the samples' plans are not registered for tax but one). */
  private line(month: string, goal: HeldGoal | null, invoicedMinor: number, pace: GoalView['pace'], pacePermille: number): string {
    const words = monthWords(month);
    if (!goal) return `No goal for ${words} yet. Set one to see how the month is going.`;
    const goalMinor = Number(goal.amountMinor);
    const percent = invoicedMinor > 0 ? Math.floor((invoicedMinor * 100) / goalMinor) : 0;
    const head = `${percent}% of your ${words} goal invoiced.`;
    if (invoicedMinor > goalMinor) return `Past the goal: ${head}`;
    if (invoicedMinor === goalMinor) return `Goal reached: ${head}`;
    if (pace === null) return head;
    return `${head} Today's pace is ${Math.floor(pacePermille / 10)}%, so you are ${pace}.`;
  }

  /** What a row puts at stake: its change's receipt (not an estimate), else its price's, else its invoice paper's total. */
  private stake(row: QueueRow): { minor: number; display: string; receiptId: string } | null {
    const ids: string[] = [];
    if (row.change?.receiptId && row.change.estimate !== true) ids.push(row.change.receiptId);
    if (row.price?.receiptId) ids.push(row.price.receiptId);
    if (row.preview?.kind === 'paper' && row.preview.paper === 'invoice') ids.push(row.preview.total.receiptId);
    for (const id of ids) {
      const receipt = RECEIPTS.find((item) => item.id === id) ?? this.receipt(id);
      if (!receipt || receipt.stale) continue;
      const total = receipt.figures.find((figure) => figure.key === 'total') ?? receipt.figures.at(-1);
      const minor = total ? paise(total.display) : 0;
      if (minor > 0) return { minor, display: inr(minor), receiptId: id };
    }
    return null;
  }

  /** The next best step and the briefing from the open business's waiting rows, as next-step.ts ranks them. */
  private next(progress: { month: string; goalMinor: number; invoicedMinor: number } | null): Pick<GoalView, 'next' | 'briefing'> {
    const rows = this.host.rows().filter((row) => row.businessId === this.host.current() && row.kind !== 'locked');
    if (!rows.length) return { next: null, briefing: null };
    const ranked = rows.map((row, index) => ({ row, stake: this.stake(row), deadline: row.meta?.expiresAt ? Date.parse(row.meta.expiresAt) : null, index }));
    ranked.sort((a, b) => {
      if ((a.stake === null) !== (b.stake === null)) return a.stake === null ? 1 : -1;
      if (a.stake && b.stake && a.stake.minor !== b.stake.minor) return b.stake.minor - a.stake.minor;
      if ((a.deadline === null) !== (b.deadline === null)) return a.deadline === null ? 1 : -1;
      if (a.deadline !== null && b.deadline !== null && a.deadline !== b.deadline) return a.deadline - b.deadline;
      return a.index - b.index;
    });
    const stepOf = (row: QueueRow) => {
      const primary = row.actions.find((action) => action.primary);
      return primary && !NOT_A_STEP.has(primary.id) ? primary : null;
    };
    const chosen = ranked.find((item) => stepOf(item.row) !== null);
    let next: NextBestStep | null = null;
    if (chosen) {
      const primary = stepOf(chosen.row)!;
      next = {
        rowId: chosen.row.id, title: chosen.row.title, agent: chosen.row.agent ?? null,
        line: primary.requiresView || chosen.row.viewRef ? `Open it, then choose ${primary.label}.` : `Choose ${primary.label}.`,
        figure: chosen.stake ? { display: chosen.stake.display, receiptId: chosen.stake.receiptId } : null,
        ...this.goalAfter(chosen.row, progress),
      };
    }
    const named = ranked.slice(0, BRIEFING_MAX).map((item) => item.row.id);
    return { next, briefing: { rowIds: named, more: ranked.length - named.length } };
  }

  /** "Goal after: 92%" for a draft invoice dated in the goal's month. */
  private goalAfter(row: QueueRow, progress: { month: string; goalMinor: number; invoicedMinor: number } | null): Pick<NextBestStep, 'goalAfter' | 'goalAfterPercent'> {
    const none = { goalAfter: null, goalAfterPercent: null };
    if (!progress || row.kind !== 'invoice' || row.viewRef?.kind !== 'file') return none;
    const draft = this.invoices(progress.month, 'ready').find(({ invoice }) => invoice.id === row.viewRef!.id);
    if (!draft) return none;
    const after = progress.invoicedMinor + draft.minor;
    const percent = after > 0 ? Math.floor((after * 100) / progress.goalMinor) : 0;
    return { goalAfter: `Goal after: ${percent}%`, goalAfterPercent: percent };
  }

  /** venture.goals.set { month, amountMinor }: this month or up to a year ahead; the newest goal for a month is in use. */
  private set(p: Record<string, unknown>): GoalView {
    exact(p, ['month', 'amountMinor', 'amount'], ['month']);
    if ((p.amount === undefined) === (p.amountMinor === undefined)) throw invalid('Send the goal as amount (typed) or amountMinor, not both.');
    const month = monthText(p.month);
    const amountMinor = p.amountMinor === undefined ? typedGoal(p.amount) : p.amountMinor;
    if (typeof amountMinor !== 'string' || !GOAL_AMOUNT.test(amountMinor)) {
      throw new EngineError('GOAL_INVALID', 'A goal must be a whole amount above zero, at most 15 digits in the smallest unit of your currency.');
    }
    const today = this.today();
    if (month < today.slice(0, 7)) throw new EngineError('GOAL_MONTH_PAST', `${monthWords(month)} is over. Choose this month or a later one.`);
    if (monthsBetween(today.slice(0, 7), month) > MONTHS_AHEAD) throw invalid('Choose this month or one up to a year ahead.');
    this.goals.push({ id: `goal-${this.host.current()}-${this.goals.length + 1}`, businessId: this.host.current(), month, amountMinor, at: this.host.now() });
    this.host.emit({ type: 'queue.changed', businessId: this.host.current(), at: this.host.now() });
    return this.view(month);
  }

  /** venture.goals.suggest { month }: a model estimate from the plan's priced offers; null with none or no AI. */
  private suggest(p: Record<string, unknown>): GoalSuggestion | null {
    exact(p, ['month'], ['month']);
    const month = monthText(p.month);
    const today = this.today();
    if (month < today.slice(0, 7)) throw new EngineError('GOAL_MONTH_PAST', `${monthWords(month)} is over. Choose this month or a later one.`);
    if (monthsBetween(today.slice(0, 7), month) > MONTHS_AHEAD) throw invalid('Choose this month or one up to a year ahead.');
    const plan = this.host.ask('venture.blueprint.get', {}) as BlueprintViewLite | null;
    const priced = plan?.blueprint.offers.filter((offer) => offer.pricing.unitPriceMinor !== null) ?? [];
    if (!priced.length) return null;
    const fast = (this.host.ask('venture.models.status', {}) as ModelStatusLite).tiers.fast;
    if (!fast || fast.presetId === 'built-in-templates' || fast.usable === false) return null;
    // The fake's model answers a round figure: five of the first priced offer, in whole rupees.
    const amountMinor = String(Number(priced[0]!.pricing.unitPriceMinor) * 5);
    const display = inr(Number(amountMinor));
    return { amountMinor, display, estimate: true, line: SUGGEST_LINE, typed: display.replace(/[₹,]/g, '') };
  }
}
