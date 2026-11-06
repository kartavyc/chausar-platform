// CFO calculator ideas from cfo (MIT); original BigInt code. Existing aging, flow and cash plans remain authoritative.
import { ChausarError, type State } from '../../contracts.ts';
import type { VentureRecord } from '../contracts.ts';
import { agingPlan } from './aging.ts';
import { flowPlan } from './flow.ts';
import { cashPlan } from './cash.ts';
import { planTotal } from './sums.ts';
import { addDaysUtc } from './dates.ts';

export type CfoCell = { kind: 'calculated'; value: string; unit: 'minor' | 'days' | 'months'; receipt: { formula: string; inputs: string[]; result: string } };
export type CfoRatioInput = { receivablesMinor: string; payablesMinor: string; revenueMinor: string; costsMinor: string; inventoryMinor: string; cashMinor: string; netCashMinor: string; days: number };
export type CfoAssumption = { id: string; revenueBps: number; costBps: number; assumption: string };
const amount = (value: string) => {
  if (!/^-?\d{1,30}$/.test(value)) throw new ChausarError('CFO_INPUT_INVALID', 'Use recorded minor-unit amounts, with no empty figures.');
  return BigInt(value);
};
const cell = (value: bigint, unit: CfoCell['unit'], formula: string, inputs: string[]): CfoCell => ({ kind: 'calculated', value: String(value), unit, receipt: { formula, inputs, result: String(value) } });

/** DSO, DPO and inventory days use the named period; runway uses monthly net cash burn. Undefined denominators refuse. */
export function cfoRatios(input: CfoRatioInput) {
  const ar = amount(input.receivablesMinor), ap = amount(input.payablesMinor), sales = amount(input.revenueMinor), costs = amount(input.costsMinor), inventory = amount(input.inventoryMinor), cash = amount(input.cashMinor), net = amount(input.netCashMinor);
  if (!Number.isSafeInteger(input.days) || input.days < 1 || input.days > 366 || [ar, ap, sales, costs, inventory, cash].some(value => value < 0n) || sales === 0n || costs === 0n) throw new ChausarError('CFO_INPUT_INVALID', 'Ratios need a valid period, non-negative balances and positive sales and costs.');
  const days = BigInt(input.days);
  const dso = ar * days / sales, dpo = ap * days / costs, dio = inventory * days / costs;
  return {
    dso: cell(dso, 'days', 'receivables × days / revenue, rounded down', [String(ar), String(days), String(sales)]),
    dpo: cell(dpo, 'days', 'payables × days / costs, rounded down', [String(ap), String(days), String(costs)]),
    cashCycle: cell(dso + dio - dpo, 'days', 'DSO + inventory days - DPO, rounded down by component', [String(dso), String(dio), String(dpo)]),
    runway: net >= 0n ? null : cell(cash / -net, 'months', 'cash / monthly net cash burn, rounded down', [String(cash), String(-net)]),
  };
}

/** Three owner-defined scenarios; every cell states its arithmetic and each column carries the owner's assumption. */
export function cfoScenarios(base: { revenueMinor: string; costsMinor: string; cashMinor: string; assumption: string }, scenarios: readonly CfoAssumption[]) {
  const revenue = amount(base.revenueMinor), costs = amount(base.costsMinor), cash = amount(base.cashMinor);
  if (!base.assumption.trim() || [revenue, costs, cash].some(value => value < 0n) || scenarios.length !== 3 || new Set(scenarios.map(row => row.id)).size !== 3) throw new ChausarError('CFO_INPUT_INVALID', 'Name the base, downside and upside assumptions.');
  return scenarios.map(scenario => {
    if (!['base', 'downside', 'upside'].includes(scenario.id) || !scenario.assumption.trim() || [scenario.revenueBps, scenario.costBps].some(bps => !Number.isSafeInteger(bps) || bps < 0 || bps > 100000)) throw new ChausarError('CFO_INPUT_INVALID', 'Each scenario needs its own assumption and bounded whole basis points.');
    const sales = revenue * BigInt(scenario.revenueBps) / 10000n, spend = costs * BigInt(scenario.costBps) / 10000n, profit = sales - spend;
    return { id: scenario.id, assumption: scenario.assumption, baseAssumption: base.assumption,
      revenue: cell(sales, 'minor', 'base revenue × scenario basis points / basis', [String(revenue), String(scenario.revenueBps), '10000']),
      profit: cell(profit, 'minor', 'scenario revenue - scenario costs', [String(sales), String(spend)]),
      cash: cell(cash + profit, 'minor', 'opening cash + scenario net cash, assuming revenue is collected and costs paid', [String(cash), String(profit)]),
      runway: profit >= 0n ? null : cell(cash / -profit, 'months', 'opening cash / monthly scenario burn, rounded down', [String(cash), String(-profit)]),
    };
  });
}

/** Reuse the client's recorded ledger plans; never replace the existing ageing, flow or cash calculations. */
export function cfoLedgerPack(state: State, venture: VentureRecord, asOf: string) {
  const month = asOf.slice(0, 7);
  const ageing = agingPlan(state, venture, { type: 'aging', asOf });
  const incoming = flowPlan(state, venture, { type: 'flow', month, part: 'in' });
  const outgoing = flowPlan(state, venture, { type: 'flow', month, part: 'out' });
  const cash = cashPlan(state, venture, { type: 'cash', asOf, week: asOf, scenario: 'bank' });
  const projection = Array.from({ length: 13 }, (_, index) => {
    const week = addDaysUtc(asOf, (index + 1) * 7);
    const projected = (scenario: 'on-time' | 'late-unpaid') => {
      const plan = cashPlan(state, venture, { type: 'cash', asOf, week, scenario });
      return { value: String(planTotal(plan)), plan };
    };
    return { week, onTime: projected('on-time'), lateUnpaid: projected('late-unpaid') };
  });
  return { projection, plans: { ageing, incoming, outgoing, cash }, totals: { receivablesMinor: String(planTotal(ageing)), revenueMinor: String(planTotal(incoming)), costsMinor: String(planTotal(outgoing)), cashMinor: cash.addends.length ? String(planTotal(cash)) : null } };
}
