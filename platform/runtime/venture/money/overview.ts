// venture.money.overview {} (level read): Money at a glance. Three lines, each a sum code makes in BigInt from the
// venture's own records with its receipt (sums.ts): what clients owe on open invoices, what came in this month on the
// owner's calendar, and what AI and tools cost this month (UTC months, as the model limits count them). Spend still
// held counts at its estimate, and the line says so; that is a cost estimate, never a number a model wrote.
import type { Context } from '../../contracts.ts';
import { exactPayload, readVenture } from '../records.ts';
import type { MoneyOverview, MoneyOverviewLine, VentureDeps } from '../contracts.ts';
import { booksPeriods, todayLocal } from './dates.ts';
import { rupeeRateWords, rupeesBeside, rupeesOf, spendLead } from './spend.ts';
import { owedPlan, planEstimate, planTotal, receivedPlan, spentPlan, sumReceipt } from './sums.ts';
import { basisOf, hasCountry, notCountedOf, openElsewhere, otherCurrency, paymentsElsewhere } from './figure-kinds.ts';
import type { Display, FigureKind, FigureSource, TotalBasis } from '../contracts.ts';

/** 4J4 (M13, M14): each line is calculated by code, with its receipt as its source, and says what it counted. */
function made(receiptId: string, basis: TotalBasis, uses: Display[] = []): { kind: FigureKind; source: FigureSource; basis: TotalBasis; uses?: Display[] } {
  return { kind: 'calculated', source: { from: 'receipt', receiptId }, basis, ...(uses.length ? { uses } : {}) };
}

export const OVERVIEW_LABELS = Object.freeze({
  owed: 'Clients owe you',
  received: 'Came in this month',
  spent: 'AI and tools this month',
  includesEstimates: ', includes estimates',
});

export async function moneyOverview(deps: VentureDeps, ctx: Context, payload: unknown): Promise<MoneyOverview> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  // A business still in its interview has no country, so no currency or calendar yet: nothing to show (NOTES 32).
  if (!hasCountry(venture)) return { lines: [] };
  const today = todayLocal(deps.clock, venture.country);
  const month = booksPeriods(today, today, []).find(period => period.key === 'this-month')!;
  const owed = await sumReceipt(deps, ctx, venture.id, owedPlan(state, venture, null));
  const received = await sumReceipt(deps, ctx, venture.id, receivedPlan(state, venture, month.from, month.to));
  const spentNow = spentPlan(state, venture, deps.clock().toISOString().slice(0, 7));
  const spent = await sumReceipt(deps, ctx, venture.id, spentNow);
  const estimate = planEstimate(spentNow);
  // With the owner's own rupee rate, the AI spend line shows rupees beside the dollars, with that rate.
  const rate = rupeesOf(state, venture);
  const rupees = rupeesBeside(String(planTotal(spentNow)), rate);
  const currency = venture.country.currency;
  const other = openElsewhere(state, venture);
  const otherPaid = paymentsElsewhere(state, venture, month.from, month.to);
  const lines: MoneyOverviewLine[] = [
    {
      id: 'owed', label: OVERVIEW_LABELS.owed, value: owed.figures[0].display, receiptId: owed.id,
      ...made(owed.id, basisOf([`Open invoices in ${currency}, tax included`], notCountedOf([otherCurrency(other, 'open invoice', 'open invoices', currency)]))),
    },
    {
      id: 'received', label: OVERVIEW_LABELS.received, value: received.figures[0].display, receiptId: received.id,
      ...made(received.id, basisOf([`Cleared payments in ${currency}, tax included, this month on your calendar`], notCountedOf([otherCurrency(otherPaid, 'payment', 'payments', currency)]))),
    },
    {
      id: 'spent', label: OVERVIEW_LABELS.spent, value: `${spent.figures[0].display}${estimate ? OVERVIEW_LABELS.includesEstimates : ''}`,
      receiptId: spent.id, ...(estimate ? { estimate: true } : {}), ...(rupees ? { rupees } : {}),
      // 4Z3: the line as the owner's currency leads it, two decimals of dollars at most; the exact figure is the value.
      lead: spendLead(String(planTotal(spentNow)), rate, estimate ? OVERVIEW_LABELS.includesEstimates : ''),
      // The rupees beside it rest on the owner's own rate, shown beside it.
      ...made(spent.id, basisOf(['Paid AI and tool calls this UTC month, in US dollars as providers bill']), rate ? [rupeeRateWords(rate)] : []),
    },
  ];
  return { lines };
}
