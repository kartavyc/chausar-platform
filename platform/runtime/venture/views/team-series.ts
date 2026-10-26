// Chausar venture launcher, views (Ink v2 wave 4, package 4A1; spec 5.1): the five departments as Team shows them,
// and the team's totals. For each department: how many of its agents are working, waiting, stopped (their latest run
// failed) or idle; the jobs it did this week; its AI and tool spend this month, with rupees beside the dollars at the
// owner's rate and how much of it calls still running hold; and the six-week series of jobs and spend. The totals are
// built from the same partition: jobs done this week by the whole team, and this month's spend, which is Money's own
// figure (sums.ts spentPlan, the same receipt), so the departments and the shared part always add up to it. Every
// figure carries a sum receipt (money/department-spend.ts plans, money/sums.ts receipts). Jobs use the owner's local
// weeks, Monday to Sunday; spend uses UTC days and the UTC month, as the spend limit and Money count them. Series
// points are scaled in code to the largest week by integer division; a week with no data has no value and no scale
// (null, never 0), and no receipt. One ledger serves the whole request.
import type { Context, State } from '../../contracts.ts';
import type { AgentView, DepartmentId, DepartmentSpend, DepartmentView, IsoDate, MoneyFigureView, SeriesPoint, SpendLead, VentureDeps, VentureRecord } from '../contracts.ts';
import { formatMicros, formatVentureDate } from '../records.ts';
import { ownerToday } from '../local-day.ts';
import { DEPARTMENTS } from '../playbooks/departments.ts';
import { departmentSpendPlan, heldPlan, heldWords, jobsCountPlan, monthDays, type SpendWhere, type TeamLedger } from '../money/department-spend.ts';
import { planDisplay, planEstimate, planTotal, spentPlan, sumReceipt, type SumPlan } from '../money/sums.ts';
import { rupeeRateWords, rupeesBeside, rupeesOf, spendLead, SPEND_WORDS, type Rupees } from '../money/spend.ts';

/** How many weeks the series covers, this week last. */
export const SERIES_WEEKS = 6;

const DAY_MS = 24 * 60 * 60_000;
const dayMs = (day: IsoDate) => Date.parse(`${day}T00:00:00.000Z`);
const isoOf = (ms: number): IsoDate => new Date(ms).toISOString().slice(0, 10);

/** A day plus some days, as calendar dates. */
export function addDays(day: IsoDate, days: number): IsoDate {
  return isoOf(dayMs(day) + days * DAY_MS);
}

/** The Monday of a day's week. */
export function weekStart(day: IsoDate): IsoDate {
  const weekday = new Date(dayMs(day)).getUTCDay(); // 0 Sunday .. 6 Saturday
  return addDays(day, -((weekday + 6) % 7));
}

/** Each week's plan for one series: its days and the sum of what it counts. */
type Week = { from: IsoDate; to: IsoDate; plan: SumPlan; total: bigint };

/**
 * A series from its weeks: scaled to the largest week in code, null where a week has nothing, a receipt per week with
 * data; a money series shows rupees beside each value at the owner's rate.
 */
async function seriesOf(deps: VentureDeps, ctx: Context, venture: VentureRecord, weeks: readonly Week[], value: (week: Week) => string, rupees: Rupees | null = null, lead?: (week: Week) => SpendLead): Promise<SeriesPoint[]> {
  const largest = weeks.reduce((max, week) => (week.total > max ? week.total : max), 0n);
  const points: SeriesPoint[] = [];
  for (const week of weeks) {
    const label = `Week of ${formatVentureDate(week.from, venture.country.dateOrder)}`;
    if (week.total === 0n) { points.push({ key: week.from, label, value: null, valuePermille: null, receiptId: null }); continue; }
    const receipt = await sumReceipt(deps, ctx, venture.id, week.plan);
    const beside = rupees ? rupeesBeside(String(week.total), rupees) : null;
    points.push({ key: week.from, label, value: value(week), valuePermille: Number((week.total * 1000n) / largest), receiptId: receipt.id, ...(beside ? { rupees: beside } : {}), ...(lead ? { lead: lead(week) } : {}) });
  }
  return points;
}

/** A spend figure as Team shows it: the sum with its receipt, rupees beside it, and what calls running hold, with its receipt. */
async function spendFigure(deps: VentureDeps, ctx: Context, venture: VentureRecord, plan: SumPlan, held: SumPlan, rupees: Rupees | null): Promise<DepartmentSpend> {
  const receipt = await sumReceipt(deps, ctx, venture.id, plan);
  const total = planTotal(plan);
  const heldTotal = planTotal(held);
  const heldReceipt = heldTotal > 0n ? await sumReceipt(deps, ctx, venture.id, held) : null;
  const beside = rupeesBeside(String(total), rupees);
  return {
    display: `${planDisplay(plan, total)}${planEstimate(plan) ? SPEND_WORDS.includesEstimates : ''}`, receiptId: receipt.id,
    // The rate on its own too (4A2), so a page says it once and shows only the rupee amount on its other spend lines.
    ...(beside && rupees ? { rupees: beside, rate: rupeeRateWords(rupees) } : {}), ...(heldReceipt ? { held: heldWords(heldTotal, rupees), heldReceiptId: heldReceipt.id } : {}),
    // 4Z3: the spend as the owner's currency leads it, two decimals of dollars at most; the exact figure is the receipt's.
    lead: spendLead(String(total), rupees, planEstimate(plan) ? SPEND_WORDS.includesEstimates : ''),
  };
}

/** A part's share of the month's whole spend in per mille, floored in BigInt (Money's split bar, 4A2); 0 when nothing was spent. */
export function sharePermille(part: bigint, whole: bigint): number {
  return whole > 0n ? Number((part * 1000n) / whole) : 0;
}

/**
 * One department's (or the shared part's) spend this UTC month, with its share of the month's whole spend (`whole`,
 * Money's own sum, spentPlan); null for an empty shared part when asked.
 */
async function spendThisMonth(deps: VentureDeps, ctx: Context, ledger: TeamLedger, where: SpendWhere, month: string, rupees: Rupees | null, whole: bigint, nullWhenEmpty = false): Promise<DepartmentSpend | null> {
  const { state, venture } = ledger;
  const days = monthDays(month);
  const plan = departmentSpendPlan(state, venture, { type: 'spent-department', department: where, from: days.from, to: days.to }, ledger);
  if (nullWhenEmpty && plan.addends.length === 0) return null;
  const figure = await spendFigure(deps, ctx, venture, plan, heldPlan(state, venture, { type: 'held', scope: where, month }, ledger), rupees);
  return { ...figure, sharePermille: sharePermille(planTotal(plan), whole) };
}

export type DepartmentViews = {
  departments: DepartmentView[];
  shared: DepartmentSpend | null;
  totals: { doneThisWeek: { count: number; receiptId: string }; spendThisMonth: DepartmentSpend; held: MoneyFigureView | null };
};

/**
 * The five departments for venture.team.list, the spend no single role can claim (null when there is none) and the
 * team's totals. agents: the team as listed (Keeper included), each with its department and state.
 */
export async function departmentViews(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, agents: readonly AgentView[], ledger: TeamLedger): Promise<DepartmentViews> {
  const today = ownerToday(deps.clock, venture.country);
  const thisWeek = weekStart(today);
  // The spend limit's month and Money's (sums.ts spentPlan): the UTC month of now.
  const month = deps.clock().toISOString().slice(0, 7);
  const rupees = rupeesOf(state, venture);
  const weekStarts = Array.from({ length: SERIES_WEEKS }, (_, index) => addDays(thisWeek, (index - SERIES_WEEKS + 1) * 7));
  // Money's own sum this month (sums.ts spentPlan): the whole each part's share is of.
  const spentAll = spentPlan(state, venture, month);
  const whole = planTotal(spentAll);
  const departments: DepartmentView[] = [];
  for (const { id, name } of DEPARTMENTS) {
    const members = agents.filter(agent => agent.department === id);
    const counts = {
      working: members.filter(agent => agent.state === 'working').length,
      waiting: members.filter(agent => agent.state === 'waiting').length,
      stopped: members.filter(agent => agent.state === 'failed').length,
      idle: members.filter(agent => !agent.state || agent.state === 'idle').length,
    };
    const jobsWeek = jobsCountPlan(state, venture, { type: 'count', what: 'jobs', scope: id, from: thisWeek, to: addDays(thisWeek, 6) }, ledger);
    const done = await sumReceipt(deps, ctx, venture.id, jobsWeek);
    const spend = await spendThisMonth(deps, ctx, ledger, id, month, rupees, whole);
    const jobWeeks: Week[] = weekStarts.map(from => {
      const plan = jobsCountPlan(state, venture, { type: 'count', what: 'jobs', scope: id, from, to: addDays(from, 6) }, ledger);
      return { from, to: addDays(from, 6), plan, total: planTotal(plan) };
    });
    const spendWeeks: Week[] = weekStarts.map(from => {
      const plan = departmentSpendPlan(state, venture, { type: 'spent-department', department: id as DepartmentId, from, to: addDays(from, 6) }, ledger);
      return { from, to: addDays(from, 6), plan, total: planTotal(plan) };
    });
    departments.push({
      id, name, counts,
      doneThisWeek: { count: Number(planTotal(jobsWeek)), receiptId: done.id },
      spendThisMonth: spend!,
      series: {
        jobs: await seriesOf(deps, ctx, venture, jobWeeks, week => String(week.total)),
        spend: await seriesOf(deps, ctx, venture, spendWeeks, week => `${formatMicros(String(week.total))}${planEstimate(week.plan) ? SPEND_WORDS.includesEstimates : ''}`, rupees,
          // 4Z3: each week as the owner's currency leads it, the dollars to two decimals.
          week => spendLead(String(week.total), rupees, planEstimate(week.plan) ? SPEND_WORDS.includesEstimates : '')),
      },
    });
  }
  // Each department's jobs this week against the busiest department's (Team's bars by department, 4A2), in code.
  const busiest = departments.reduce((max, department) => Math.max(max, department.doneThisWeek.count), 0);
  for (const department of departments) department.doneThisWeek.permille = sharePermille(BigInt(department.doneThisWeek.count), BigInt(busiest));
  const shared = await spendThisMonth(deps, ctx, ledger, 'shared', month, rupees, whole, true);
  // The totals: the same partition, and this month's spend is Money's own sum and receipt.
  const jobsAll = jobsCountPlan(state, venture, { type: 'count', what: 'jobs', scope: 'all', from: thisWeek, to: addDays(thisWeek, 6) }, ledger);
  const allDone = await sumReceipt(deps, ctx, venture.id, jobsAll);
  const heldAll = heldPlan(state, venture, { type: 'held', scope: 'all', month }, ledger);
  const spendAll = await spendFigure(deps, ctx, venture, spentAll, heldAll, rupees);
  const heldReceipt = planTotal(heldAll) > 0n ? await sumReceipt(deps, ctx, venture.id, heldAll) : null;
  return {
    departments, shared,
    totals: {
      doneThisWeek: { count: Number(planTotal(jobsAll)), receiptId: allDone.id },
      spendThisMonth: spendAll,
      held: heldReceipt ? { display: planDisplay(heldAll), receiptId: heldReceipt.id } : null,
    },
  };
}
