/**
 * Reply checks for the round-4 Work additions (docs/lanes/work-books.md, "Round 4 contracts").
 * Every field here is optional on the older shapes, so an older engine still draws.
 */
import { amount, bool, count, either, id, instant, integerString, isoDate, list, literal, nullable, object, oneOf, record, text, type Check } from './kit/validate.ts';
import { approvalRow, practice, step, type Practice } from './contract.ts';
import { MISSED_RUNS, templatesWithSchedule } from './contract-jobs.ts';

const short = text(400);
const long = text(4000);

/** WK-09: one of jobs-ext's ready-made jobs (`jobsx.types`), in this lane's words. */
export const laneTemplate = object({
  id, title: short, goal: long, doneWhen: long, every: nullable(oneOf(['day', 'week', 'month'] as const)), intervalMs: count, stepsPerDelivery: count,
  missedRun: oneOf(MISSED_RUNS), budget: object({ minor: integerString }), actions: list(short, 200),
  steps: list(object({ kind: short, title: long, needsModel: bool }), 50), needsModel: bool, experimental: bool, available: bool, code: nullable(short),
});
export type LaneTemplate = ReturnType<typeof laneTemplate>;
const laneList = object({ available: bool, templates: list(laneTemplate, 50), activeJobs: nullable(count), activeJobCap: nullable(count) });
export type LaneList = ReturnType<typeof laneList>;
/** `approvals.jobTemplates` with jobs-ext's list when the engine sends one. */
export const templatesR4 = (value: unknown, path: string) => {
  const base = templatesWithSchedule(value, path);
  const extra = object({}, { lane: laneList })(value, path);
  return Object.freeze({ ...base, lane: extra.lane ?? { available: false, templates: [], activeJobs: null, activeJobCap: null } });
};

/** WK-02: a core action's practice: checked, not run. */
const practiceExtra = object({}, { mode: literal('checked-not-run'), outcome: short, requests: count, request: (value: unknown, path: string) => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record(value, path))) out[short(k, `${path}.key`)] = long(v, `${path}.${k}`);
  return Object.freeze(out);
} });
export const practiceR4: Check<Practice & ReturnType<typeof practiceExtra>> = (value, path) => Object.freeze({ ...practice(value, path), ...practiceExtra(value, path) });
export type PracticeR4 = ReturnType<typeof practiceR4>;

/** WK-03: each grouped item's result with its own five steps. */
export const groupResultsR4 = object({ results: list(object({ id, ok: bool }, { code: short, state: short, steps: list(step, 5) }), 10) });
export type GroupResultsR4 = ReturnType<typeof groupResultsR4>;

/** WK-08: per-route meters, an untested-route stop and child task results. */
export const routeMeter = object({ routeId: short, spent: amount, minutes: nullable(count), basis: oneOf(['measured', 'estimate', 'zero'] as const), tested: bool });
export type RouteMeter = ReturnType<typeof routeMeter>;
const childTask = object({ id, title: long, state: short, result: nullable(object({ done: list(long, 200), open: list(long, 200), receiptIds: list(id, 200) })) });
export type ChildTask = ReturnType<typeof childTask>;
export const children = either(object({ available: literal(false) }), object({ available: literal(true), items: list(childTask, 200) }));
export type Children = ReturnType<typeof children>;
export const jobR4 = object({}, { routes: list(routeMeter, 50), untestedStop: nullable(object({ at: instant, reason: long })), children });
export type JobR4 = ReturnType<typeof jobR4>;

/** WK-12: the reminders view. */
const caps = object({ timeZone: nullable(short), today: nullable(isoDate), preparedToday: nullable(count), sentToday: nullable(count), perCustomer: nullable(count), perDay: nullable(count) });
export type CapsDay = ReturnType<typeof caps>;
export const reminders = either(
  object({ available: literal(false) }),
  object({ available: literal(true), connections: list(object({ id, label: short, system: oneOf(['mail', 'whatsapp'] as const), environment: short }), 50), caps: nullable(caps), items: list(approvalRow, 200) }),
);
export type Reminders = ReturnType<typeof reminders>;
export const prepared = object({ id: nullable(id), blocked: nullable(object({ code: short, reason: long })) });
export const customers = object({ records: list(object({ id, kind: short, name: nullable(short) }), 2000) });
export const customerRecord = object({ id, name: nullable(short), timeline: list(object({ at: either(instant, isoDate), kind: short, amount, ref: nullable(short) }), 5000) });

/** WK-15: deleting again what a restore brought back. */
export const restoreR4 = object({}, { deletions: object({ available: bool }) });
export const reapplied = object({ reapplied: count });
