// venture.money.overview {} (level read): Money at a glance. Three lines, each a sum code makes in BigInt from the
// venture's own records with its receipt (sums.ts): what clients owe on open invoices, what came in this month on the
// owner's calendar, and what AI and tools cost this month (UTC months, as the model limits count them). Spend still
// held counts at its estimate, and the line says so; that is a cost estimate, never a number a model wrote.
import type { Context } from '../../contracts.ts';
import { exactPayload, readVenture } from '../records.ts';
import type { MoneyOverview, MoneyOverviewLine, VentureDeps } from '../contracts.ts';
import { booksPeriods, todayLocal } from './dates.ts';
import { rupeesBeside, rupeesOf } from './spend.ts';
import { owedPlan, planEstimate, planTotal, receivedPlan, spentPlan, sumReceipt } from './sums.ts';

export const OVERVIEW_LABELS = Object.freeze({
  owed: 'Clients owe you',
  received: 'Came in this month',
  spent: 'AI and tools this month',
  includesEstimates: ', includes estimates',
});

export async function moneyOverview(deps: VentureDeps, ctx: Context, payload: unknown): Promise<MoneyOverview> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  const today = todayLocal(deps.clock, venture.country);
  const month = booksPeriods(today, today, []).find(period => period.key === 'this-month')!;
  const owed = await sumReceipt(deps, ctx, venture.id, owedPlan(state, venture, null));
  const received = await sumReceipt(deps, ctx, venture.id, receivedPlan(state, venture, month.from, month.to));
  const spentNow = spentPlan(state, venture, deps.clock().toISOString().slice(0, 7));
  const spent = await sumReceipt(deps, ctx, venture.id, spentNow);
  const estimate = planEstimate(spentNow);
  // With the owner's own rupee rate, the AI spend line shows rupees beside the dollars, with that rate.
  const rupees = rupeesBeside(String(planTotal(spentNow)), rupeesOf(state, venture));
  const lines: MoneyOverviewLine[] = [
    { id: 'owed', label: OVERVIEW_LABELS.owed, value: owed.figures[0].display, receiptId: owed.id },
    { id: 'received', label: OVERVIEW_LABELS.received, value: received.figures[0].display, receiptId: received.id },
    {
      id: 'spent', label: OVERVIEW_LABELS.spent, value: `${spent.figures[0].display}${estimate ? OVERVIEW_LABELS.includesEstimates : ''}`,
      receiptId: spent.id, ...(estimate ? { estimate: true } : {}), ...(rupees ? { rupees } : {}),
    },
  ];
  return { lines };
}
