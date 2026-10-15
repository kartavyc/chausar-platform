/**
 * Reply shapes for the jobs-ext screens, read from the handlers in
 * platform/runtime/procedures/methods.ts and platform/runtime/jobs-ext/methods.ts.
 * Money is whole paise as a string and stays a string; nothing here does arithmetic on it.
 */
import { InvalidReply, bool, count, digest, finite, id, instant, list, literal, nullable, object, oneOf, paise, record, share, text, type Check, lenientList } from './check.ts';

const short = text(400);
const long = text(4000);
const name = text(200);

// ---- Procedures -------------------------------------------------------------------------

export const PROCEDURE_STATUSES = ['proposed', 'approved', 'rejected', 'retired'] as const;
export type ProcedureStatus = typeof PROCEDURE_STATUSES[number];
export const REJECT_REASONS = ['wrong-steps', 'wrong-rule', 'not-needed', 'other'] as const;
export type RejectReason = typeof REJECT_REASONS[number];
export const ROUTES = ['agent', 'procedure', 'ready-made', 'person', 'agent-unavailable'] as const;
export const OUTCOMES = ['ok', 'fallback', 'refused', 'waiting'] as const;

/** A case value a rule compares against: a short code, a number, yes or no, or empty. */
export type CaseValue = string | number | boolean | null;
const caseValue: Check<CaseValue> = (value, path) =>
  value === null || typeof value === 'boolean' ? value : typeof value === 'number' ? finite(value, path) : text(64)(value, path);
const condition: Check<{ readonly equals?: CaseValue; readonly min?: number; readonly max?: number }> = (value, path) => {
  const source = record(value, path);
  const out: { equals?: CaseValue; min?: number; max?: number } = {};
  if (Object.hasOwn(source, 'equals')) out.equals = caseValue(source.equals, `${path}.equals`);
  if (source.min !== undefined) out.min = finite(source.min, `${path}.min`);
  if (source.max !== undefined) out.max = finite(source.max, `${path}.max`);
  if (!('equals' in out) && (out.min === undefined || out.max === undefined)) throw new InvalidReply(path);
  return Object.freeze(out);
};
const bucket = object({ when: condition, option: short, confidence: share, support: count });
export type RuleBucket = ReturnType<typeof bucket>;
const rule = object({ feature: name, buckets: list(bucket, 200), threshold: share, minSupport: count });

const calculateStep = object({ kind: literal('calculate'), title: long, operation: name });
const questionStep = object({ kind: literal('question'), title: long, id: name, options: list(short, 50), rule });
const actionStep = object({ kind: literal('action'), title: long, connector: name, operation: name, when: short });
const lookupStep = object({ kind: literal('lookup'), title: long, tool: name, routeId: name, units: count });
export type ProcedureStep = ReturnType<typeof calculateStep> | ReturnType<typeof questionStep> | ReturnType<typeof actionStep> | ReturnType<typeof lookupStep>;
const STEP_CHECKS: Readonly<Record<ProcedureStep['kind'], Check<ProcedureStep>>> = { calculate: calculateStep, question: questionStep, action: actionStep, lookup: lookupStep };
export const procedureStep: Check<ProcedureStep> = (value, path) => {
  const kind = record(value, path).kind;
  const check = typeof kind === 'string' && Object.hasOwn(STEP_CHECKS, kind) ? STEP_CHECKS[kind as ProcedureStep['kind']] : null;
  if (check === null) throw new InvalidReply(`${path}.kind`);
  return check(value, path);
};

export const procedureStats = object({
  routedShare: object({ routed: count, total: count }),
  routedCostMinor: paise, fallbackCostMinor: paise,
}, { agentRuns: count, agentCostMinor: paise, routedCases: count, fallbackCases: count });
export type ProcedureStats = ReturnType<typeof procedureStats>;

export const procedure = object({
  id, template: name, version: count, createdAt: instant, status: oneOf(PROCEDURE_STATUSES),
  steps: list(procedureStep, 100), digest,
}, { decidedAt: instant, reason: name, derivedFrom: list(id, 5000) });
export type Procedure = ReturnType<typeof procedure>;

const listedProcedure = (value: unknown, path: string) => Object.freeze({ ...procedure(value, path), stats: procedureStats(record(value, path).stats, `${path}.stats`) });
export type ListedProcedure = ReturnType<typeof listedProcedure>;
/** `procedures.list`: the owner's procedures, newest first, each with its routed share and cost. */
export const procedureList = object({ procedures: list(listedProcedure, 1000) });

export const procedureRun = object({
  id, at: instant, caseId: text(200), route: oneOf(ROUTES), costMinor: paise, outcome: oneOf(OUTCOMES),
}, { decision: text(64), confidence: share, note: text(600), latencyMs: count });
export type ProcedureRun = ReturnType<typeof procedureRun>;
/** `procedures.get`: one procedure with its stats and the runs the caller may still read. */
export const procedureDetail = object({ procedure, stats: procedureStats, runs: lenientList(procedureRun, 200) });
export type ProcedureDetail = ReturnType<typeof procedureDetail>;

// ---- Ready-made jobs --------------------------------------------------------------------

const readyMade = object({ id: name, title: short, available: bool }, { code: name, experimental: bool });
export type ReadyMade = ReturnType<typeof readyMade>;
/** `jobsx.types`: the ready-made jobs and whether each can run here. */
export const readyMadeList = object({ templates: list(readyMade, 100) });

// ---- Job controls -----------------------------------------------------------------------

const laneJob = object({ id, title: short, template: nullable(name), state: name, laneRun: bool, spentMinor: paise, budgetMinor: paise }, { deleted: bool });
export type LaneJobRow = ReturnType<typeof laneJob>;
/** `jobsx.list`: rows with `laneRun: true` are the jobs this lane runs. */
export const laneJobList = object({ jobs: lenientList(laneJob, 1000) });

const modelMeter = object({ routeId: name, costMinor: paise, steps: count, minutes: count, basis: oneOf(['measured', 'estimate', 'zero'] as const) });
export type ModelMeter = ReturnType<typeof modelMeter>;
/** `jobsx.budget {id}`: money spent, reserved and left, model use per route, clock time and exposure. */
export const budget = object({
  jobId: id, budgetMinor: paise, spentMinor: paise, reservedMinor: paise, remainingMinor: paise,
  meters: object({ model: list(modelMeter, 100), clockMs: count, exposureMinor: paise }),
});
export type Budget = ReturnType<typeof budget>;

const stopRule = object({ rule: name, met: bool }, { limit: count, used: count, count: count, at: instant, text: long });
export type StopRule = ReturnType<typeof stopRule>;
/** `jobsx.stopRules {id}` and `jobsx.setStopRules {id, failures}`. */
export const stopRules = object({
  jobId: id, rules: list(stopRule, 20),
  stoppedBy: nullable(object({ at: instant, rule: name })),
  setAside: nullable(object({ at: instant })),
});
export type StopRules = ReturnType<typeof stopRules>;
/** The current failure limit, when the engine sent the rule. */
export function failureLimit(rules: StopRules): number | null {
  return rules.rules.find(r => r.rule === 'failures')?.limit ?? null;
}

/** `jobsx.templateSkill {id}`: the ready-made job as an Agent Skills file. */
export const skillFile = object({ path: text(200), content: text(20000) });
export type SkillFile = ReturnType<typeof skillFile>;

const proposal = object({ id, origin: oneOf(['detector', 'person', 'job', 'edit'] as const), card: object({ title: short }), evidence: list(long, 20) }, { createdAt: instant });
export type LaneProposal = ReturnType<typeof proposal>;
/** `jobsx.proposals` and `jobsx.detect`: proposals waiting for the owner's yes. */
export const proposalList = list(proposal, 500);

const missedNote = object({ id, jobId: id, at: instant, missed: count, ran: count, rule: name, seen: bool });
export type MissedNote = ReturnType<typeof missedNote>;
/** `jobsx.missed`: notes about runs missed while the computer slept, newest first. */
export const missedList = list(missedNote, 200);
/** `jobsx.missed.seen {ids}`. */
export const missedSeen = object({ seen: count });

export { InvalidReply };
