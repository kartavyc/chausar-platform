/**
 * The goal card's view model (D-Today `section.goal`). W4 4I2 maps `venture.goals.get` onto `unset` and `set` (the
 * goal, the percent, the bar, days left, the foot figures); `none` is W3's card from the books, kept for when the goals
 * view cannot be read. Every amount is the engine's own text with its proof, and every percent and count the engine's
 * own integer, worded here. Nothing here adds, divides or formats a figure.
 */

import { useState } from 'react';
import { useEngine } from '../../engine/context';
import type { BooksSummaryLite, GoalFigure, GoalSuggestion, GoalView, MoneyFigure, VentureRunEvent } from '../../engine/types';
import type { T } from '../../text';
import type { FigureProof } from '../../parts/Figure';
import type { GoalBarData } from '../../parts/charts/types';

/** An amount the card shows: the engine's text and its receipt (or "model estimate"). stale: the books changed since
 *  that receipt was written, which the card says in Money's words. */
export type GoalAmount = FigureProof & { value: string; stale?: boolean | undefined };

/** One of the small figures at the foot of a set goal: ahead of or behind today's pace, still to invoice or past the
 *  goal by, received so far. */
export interface GoalFootItem {
  id: string;
  label: string;
  amount: GoalAmount;
  /** Ahead of or behind today's pace: its label says which ("Behind pace"), with its icon. */
  trend?: 'ahead' | 'behind' | undefined;
}

/** A suggestion the owner asked for: idle until "Suggest a goal" is pressed, then asking, then the engine's answer. */
export type SuggestionState =
  | { state: 'idle' }
  | { state: 'asking' }
  | { state: 'none' }
  | { state: 'failed'; message: string }
  | { state: 'sent'; suggestion: GoalSuggestion };

interface GoalBase {
  /** The month in words ("October"). */
  month: string;
  /** Money invoiced this month, before tax. Null when there is no figure with a receipt: then the card says nothing
   *  about it, rather than guess. */
  invoiced: GoalAmount | null;
  /** The open business, named when Today spans businesses. */
  business?: string | undefined;
}

export type GoalCardData =
  /** Without the goals view (W3's fallback): what was invoiced and received this month, and nothing about a goal. */
  | (GoalBase & { state: 'none'; received: GoalAmount | null })
  /** No goal is set for this month: the card asks for one, with last month's figure; a suggestion only on a press. */
  | (GoalBase & {
      state: 'unset';
      /** Kept for W3's specimen: a suggested figure already in hand, shown as a model estimate. */
      suggested?: string | undefined;
      /** What was invoiced last month, with its receipt, and that month in words. */
      lastMonth?: { month: string; amount: GoalAmount } | undefined;
      received?: GoalAmount | null | undefined;
    })
  /** A goal is set: the invoiced figure against it, the bar, days left and the foot figures. */
  | (GoalBase & {
      state: 'set';
      goal: GoalAmount;
      /** The engine's percent of the goal invoiced ("79%", "118%" past it). */
      percent: string;
      /** The engine's words for the days left ("8 days left", "Last day"). */
      daysLeft: string;
      bar: GoalBarData;
      /** Ready to issue: drafted invoices that would count once issued. */
      ready?: GoalAmount | undefined;
      foot: GoalFootItem[];
    });

/** A books figure as a goal amount, or null when the books do not hold it with a receipt. */
function amountOf(books: BooksSummaryLite, operation: 'billed' | 'received'): GoalAmount | null {
  const figure = books.figures.find((f) => f.operation === operation);
  if (!figure || !figure.receiptId.trim()) return null;
  return { value: figure.display, receiptId: figure.receiptId, ...(figure.stale ? { stale: true } : {}) };
}

/**
 * The card from the books (`venture.books.summary {period: 'this-month'}`), for when the goals view cannot be read:
 * billed is the engine's money invoiced without tax, received the cash that came in.
 */
export function goalFromBooks(books: BooksSummaryLite, month: string): GoalCardData {
  return { state: 'none', month, invoiced: amountOf(books, 'billed'), received: amountOf(books, 'received') };
}

/**
 * The month of an ISO date ("2026-10-01") in words, in the reader's language. The date is read from its parts so a
 * time zone never moves it into the month before.
 */
export function monthOf(isoDate: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(locale, { month: 'long' }).format(date);
}

/** An engine sum as a card amount: null for an empty sum, which the engine sends as zero with no receipt. */
export function goalAmount(figure: GoalFigure | MoneyFigure | null | undefined): GoalAmount | null {
  return figure?.receiptId ? { value: figure.display, receiptId: figure.receiptId } : null;
}

export interface GoalExtras {
  /** The month and last month in the reader's words ("October", "September"). */
  month: string;
  lastMonth: string;
  business?: string | undefined;
}

/**
 * The card from `venture.goals.get` (W4 4I2). Unset: this month's invoiced figure, the ask and last month's figure.
 * Set: the figure of the goal, the engine's percent, the bar the engine scaled, days left and the foot: how far ahead
 * of or behind today's pace, still to invoice (or past the goal by), received so far, each with its receipt.
 */
export function goalFromView(view: GoalView, extras: GoalExtras, t: T): GoalCardData {
  const invoiced = goalAmount(view.invoiced);
  const received = goalAmount(view.receivedSoFar);
  const goal = view.state === 'set' ? goalAmount(view.goal) : null;
  const base = { month: extras.month, invoiced, ...(extras.business ? { business: extras.business } : {}) };
  if (!goal || view.invoicedPermille === null || view.invoicedPercent === null) {
    const last = goalAmount(view.lastMonth);
    return { ...base, state: 'unset', received, ...(last ? { lastMonth: { month: extras.lastMonth, amount: last } } : {}) };
  }
  const percent = `${view.invoicedPercent}%`;
  const after = view.next?.goalAfterPercent ?? null;
  const label = [
    t('today.goal.bar.read', { percent }),
    ...(after !== null && !view.past ? [t('today.goal.bar.next', { after: `${after}%` })] : []),
    ...(view.pace ? [t('today.goal.bar.pace', { pace: `${view.pacePercent}%` })] : []),
  ].join(' ');
  const foot: GoalFootItem[] = [];
  const pace = goalAmount(view.paceBy);
  if (pace && view.pace) foot.push({ id: 'pace', label: t(view.pace === 'ahead' ? 'today.goal.ahead' : 'today.goal.behind'), amount: pace, trend: view.pace });
  const still = goalAmount(view.stillToInvoice);
  const pastBy = goalAmount(view.pastBy);
  if (view.past && pastBy) foot.push({ id: 'past', label: t('today.goal.foot.past'), amount: pastBy });
  else if (still) foot.push({ id: 'still', label: t('today.goal.foot.still'), amount: still });
  if (received) foot.push({ id: 'received', label: t('today.goal.foot.received'), amount: received });
  const ready = view.readyPermille ? goalAmount(view.ready) : null;
  return {
    ...base, state: 'set', goal, percent,
    daysLeft: view.lastDay ? t('today.goal.lastDay') : t('today.goal.daysLeft', { count: view.daysLeft }),
    bar: { invoicedPermille: view.invoicedPermille, readyPermille: view.readyPermille ?? 0, pacePermille: view.pacePermille, label },
    ...(ready ? { ready } : {}),
    foot,
  };
}

/** The month before 'YYYY-MM', as 'YYYY-MM-01': calendar parts only. */
export function monthBefore(month: string): string {
  const year = Number(month.slice(0, 4)), index = Number(month.slice(5, 7)) - 1;
  return index === 0 ? `${year - 1}-12-01` : `${year}-${String(index).padStart(2, '0')}-01`;
}

/** The goal moves when an invoice is issued, a draft made or a goal set: the engine says each with a queue change. */
export const GOAL_EVENTS = (event: VentureRunEvent) => event.type === 'queue.changed';

/**
 * The engine's suggested goal for a month (venture.goals.suggest, a model estimate on the owner's own AI), asked only
 * when the owner presses "Suggest a goal": no model call happens without a press, and nothing is kept between presses,
 * so a later press asks again. Null from the engine (no AI, no priced offer) is said as such.
 */
export function useGoalSuggestion(month: string | null): { suggestion: SuggestionState; ask: () => void } {
  const client = useEngine();
  const [suggestion, setSuggestion] = useState<SuggestionState>({ state: 'idle' });
  const [asked, setAsked] = useState<string | null>(null);
  const current: SuggestionState = asked === month ? suggestion : { state: 'idle' };
  function ask() {
    if (!month || current.state === 'asking') return;
    setAsked(month);
    setSuggestion({ state: 'asking' });
    client.request('venture.goals.suggest', { month }).then(
      (value) => setSuggestion(value ? { state: 'sent', suggestion: value } : { state: 'none' }),
      (error: unknown) => setSuggestion({ state: 'failed', message: error instanceof Error ? error.message : String(error) }),
    );
  }
  return { suggestion: current, ask };
}
