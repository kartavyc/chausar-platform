/**
 * The goal card's view model (D-Today `section.goal`). W3 fills only `none` from the books: the money invoiced this
 * month, before tax, with its receipt, and what was received. `unset` and `set` are the shapes W4 4I maps the goals
 * view onto (the goal, the percent, the bar, days left, the foot figures); every value is the engine's own text and
 * every amount carries its proof. Nothing here adds, divides or formats a figure.
 */

import type { BooksSummaryLite } from '../../engine/types';
import type { FigureProof } from '../../parts/Figure';
import type { GoalBarData } from '../../parts/charts/types';

/** An amount the card shows: the engine's text and its receipt (or "model estimate"). stale: the books changed since
 *  that receipt was written, which the card says in Money's words. */
export type GoalAmount = FigureProof & { value: string; stale?: boolean | undefined };

/** One of the small figures at the foot of a set goal (against today's pace, still to invoice, received so far). */
export interface GoalFootItem {
  id: string;
  label: string;
  amount: GoalAmount;
  /** Ahead of or behind today's pace, in words after the figure. */
  trend?: 'ahead' | 'behind' | undefined;
}

interface GoalBase {
  /** The month in words ("October"). */
  month: string;
  /** Money invoiced this month, before tax. Null when the books hold no figure for it with a receipt: then the card
   *  says nothing about it, rather than guess that nothing was invoiced. */
  invoiced: GoalAmount | null;
}

export type GoalCardData =
  /** No goals yet (W3): what was invoiced and received this month, and nothing about a goal. */
  | (GoalBase & { state: 'none'; received: GoalAmount | null })
  /** Goals exist but none is set for this month: the card asks for one, with a suggested figure the model wrote. */
  | (GoalBase & { state: 'unset'; suggested: string })
  /** A goal is set: the invoiced figure against it, the bar, days left and the foot figures. */
  | (GoalBase & {
      state: 'set';
      goal: GoalAmount;
      /** The engine's percent of the goal invoiced ("79%"). */
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
 * The card before goals exist, from `venture.books.summary {period: 'this-month'}`: billed is the engine's money
 * invoiced without tax, received the cash that came in.
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
