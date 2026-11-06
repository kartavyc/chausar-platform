// Chausar venture launcher, the 'across' sum receipt (Ink v2 wave 4, package 4J6): one figure across the businesses on
// this computer. money/sums.ts currentPlan calls acrossPlan, so this file imports only what the other sum plans do
// (venture.money.across itself lives in across.ts, which reads the views and the network and would close a loop).
// With open, the open business's own amounts come from its records as of now; each other business's figure is what
// its summary saved, with when, and never changes. Nothing here is a model number.
import type { State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import type { AcrossFigureId, CountryProfile, IsoTime, SumReceiptSubject, VentureRecord } from '../contracts.ts';
import { formatMicros, formatVentureDate } from '../records.ts';
import { localTimeAt } from '../local-day.ts';
import { calendarMonth } from './dates.ts';
import { invoicedPlan } from './goal-plans.ts';
import { owedPlan, receivedPlan, spentPlan, type Addend, type SumPlan } from './sums.ts';

export type AcrossSubject = Extract<SumReceiptSubject, { type: 'across' }>;

/** When a summary was taken, on the open business's clock: '21 Oct 2026, 10:30' (UTC for a business with no country yet). */
export function asOfWords(asOf: IsoTime, country: CountryProfile | null): string {
  const local = localTimeAt(asOf, { code: country?.code ?? 'XX' });
  return `${formatVentureDate(local.slice(0, 10), country?.dateOrder ?? 'day-month-year')}, ${local.slice(11, 16)}`;
}

const ACROSS_LABELS: Readonly<Record<AcrossFigureId, string>> = Object.freeze({
  invoiced: 'Invoiced across your businesses', received: 'Received across your businesses', owed: 'Owed across your businesses', spend: 'AI and tools across your businesses',
});

/** The open business's own plan for one figure, as of now. */
function openPlan(state: State, venture: VentureRecord, subject: AcrossSubject): SumPlan {
  if (subject.what === 'invoiced') return invoicedPlan(state, venture, { type: 'invoiced', month: subject.month ?? '', which: 'issued' });
  if (subject.what === 'received') { const period = calendarMonth(subject.month ?? ''); return receivedPlan(state, venture, period.from, period.to); }
  if (subject.what === 'owed') return owedPlan(state, venture, null);
  return spentPlan(state, venture, subject.month ?? '');
}

/**
 * The 'across' receipt's addends as of now: with open, the open business's own amounts from its records (so a new
 * invoice makes an old total read stale), named by the business; then each other business's figure as its summary
 * saved it, with when. A saved figure never changes, so a receipt of saved figures alone never reads stale.
 */
export function acrossPlan(state: State, venture: VentureRecord, subject: AcrossSubject): SumPlan {
  const unit = subject.what === 'spend' ? 'micros' as const : 'minor' as const;
  const shown = (amount: string) => (unit === 'micros' ? formatMicros(amount, subject.currency) : formatMinor(amount, subject.currency));
  const own: Addend[] = subject.open
    ? openPlan(state, venture, subject).addends.map(item => ({ ...item, label: `${venture.workingName}: ${item.label}` }))
    : [];
  const saved: Addend[] = subject.others.map(other => ({
    recordId: `snapshot:${other.businessId}`, label: `${other.name}, as saved on ${asOfWords(other.asOf, venture.country)}`,
    amount: other.amount, display: shown(other.amount), estimate: false,
  }));
  return {
    subject: { ...subject, others: subject.others.map(other => ({ ...other })) }, currency: subject.currency, unit, addends: [...own, ...saved],
    words: { label: ACROSS_LABELS[subject.what], one: subject.open ? 'amount' : 'saved figure', many: subject.open ? 'amounts' : 'saved figures', none: 'Nothing to add up.' },
  };
}
