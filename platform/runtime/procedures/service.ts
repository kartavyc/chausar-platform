/**
 * Procedure state for the job executor: recording run traces (and feeding the learning log in
 * structure-only form), the approved procedure for a template, routed-share statistics and
 * purge. Every write runs inside the caller's `store.update`.
 */
import { check, newId, now } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import { appendLearningDecision } from '../learning.ts';
import type { DecisionInput } from '../learning.ts';
import { lane, peekLane, LANE, paise } from '../jobs-ext/state.ts';
import { peekModuleState } from '../modules/types.ts';
import { featureShape } from './derive.ts';
import { initProcedures, RUN_LIMIT } from './types.ts';
import type { CaseFields, Procedure, ProcedureRun, ProcedureStats, ProceduresState, TraceStep } from './types.ts';

export type RunInput = Omit<ProcedureRun, 'id' | 'featureShape' | 'ownerId' | 'at'> & { at?: string };
export type ProcedureStatsView = ProcedureStats & { routedShare: { routed: number; total: number } };

/** The writable procedures namespace. Call only inside `store.update`. */
export function procedureState(state: State): ProceduresState {
  const ns = lane(state);
  if (!ns.procedures) ns.procedures = initProcedures();
  return ns.procedures as ProceduresState;
}
/** A read-only copy; absence is empty. */
export function peekProcedures(state: State): ProceduresState { return (peekLane(state).procedures as ProceduresState | undefined) ?? initProcedures(); }

const CODE = /^[a-z0-9_-]*$/i, NAME = /^[a-z][a-z0-9_]{0,63}$/i, ID = /^[A-Za-z0-9_.:-]{1,120}$/, TOOL = /^[a-z0-9_.-]{1,120}$/i;
const STEP_KINDS = ['calculate', 'question', 'action', 'lookup', 'person'];
const ROUTES = ['agent', 'procedure', 'ready-made', 'person', 'agent-unavailable'], OUTCOMES = ['ok', 'fallback', 'refused', 'waiting'];
const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

/** Typed case fields: at most 50 safe names; values are short codes, finite numbers, booleans or null. */
export function validFields(value: unknown, code = 'INVALID_CASE'): CaseFields {
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype, code, 'Case details must be named typed values.');
  const entries = Object.entries(value as Record<string, unknown>);
  check(entries.length <= 50, code, 'A case has at most 50 details.');
  for (const [name, item] of entries) check(NAME.test(name) && (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)
    || typeof item === 'string' && item.length <= 64 && CODE.test(item)), code, 'Each case detail needs a safe name and a code, number, yes or no, or empty value.');
  return Object.fromEntries(entries) as CaseFields;
}
export const validId = (value: unknown, code = 'INVALID_REQUEST'): string => { check(typeof value === 'string' && ID.test(value), code, 'Use a valid identifier.'); return value; };

/** One to three sentences: anything after the third sentence end is dropped. */
export function clipNote(note: string): string {
  const ends = [...note.matchAll(/[.!?](?=\s|$)/g)];
  return (ends.length > 3 ? note.slice(0, ends[2].index! + 1) : note).trim();
}

function validSteps(value: unknown): TraceStep[] {
  check(Array.isArray(value) && value.length <= 200, 'INVALID_RUN', 'A run trace has at most 200 steps.');
  return value.map(step => {
    check(step && typeof step === 'object' && STEP_KINDS.includes(step.kind) && typeof step.tool === 'string' && TOOL.test(step.tool) && ['ok', 'refused', 'unknown'].includes(step.outcome)
      && count(step.durationMs) && count(step.units), 'INVALID_RUN', 'Each trace step needs a kind, a tool name, an outcome and whole-number meters.');
    return { kind: step.kind, tool: step.tool, outcome: step.outcome, durationMs: step.durationMs, units: step.units };
  });
}

/** Record one case run and log its structure. Call inside an existing `store.update`. */
export function recordRun(state: State, ctx: Context, input: RunInput): ProcedureRun {
  check(input && typeof input === 'object', 'INVALID_RUN', 'Record a run with its details.');
  const at = input.at ?? now();
  check(typeof at === 'string' && Number.isFinite(Date.parse(at)), 'INVALID_RUN', 'A run needs a valid time.');
  validId(input.jobId, 'INVALID_RUN'); validId(input.caseId, 'INVALID_RUN');
  check(typeof input.template === 'string' && /^[a-z0-9-]{1,64}$/.test(input.template), 'INVALID_RUN', 'A run needs its job template.');
  check(ROUTES.includes(input.route) && OUTCOMES.includes(input.outcome), 'INVALID_RUN', 'A run needs a known route and outcome.');
  for (const key of ['procedureId', 'routeId'] as const) if (input[key] !== undefined) validId(input[key], 'INVALID_RUN');
  check(input.decision === undefined || typeof input.decision === 'string' && input.decision.length > 0 && input.decision.length <= 64 && CODE.test(input.decision), 'INVALID_RUN', 'A decision is a short code.');
  check(input.confidence === undefined || typeof input.confidence === 'number' && input.confidence >= 0 && input.confidence <= 1, 'INVALID_RUN', 'A confidence is between 0 and 1.');
  paise(input.costMinor, 'INVALID_RUN');
  check(count(input.latencyMs), 'INVALID_RUN', 'Latency is a whole number of milliseconds.');
  check(Array.isArray(input.sourceIds) && input.sourceIds.length <= 100 && input.sourceIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 200), 'INVALID_RUN', 'A run names its sources.');
  check(input.note === undefined || typeof input.note === 'string', 'INVALID_RUN', 'A run note is plain text.');
  const note = input.note === undefined ? undefined : clipNote(input.note);
  check(note === undefined || note.length <= 600, 'INVALID_RUN', 'A run note has at most 600 characters.');
  const features = validFields(input.features, 'INVALID_RUN'), steps = validSteps(input.steps);
  const run: ProcedureRun = { id: newId('procrun'), at, jobId: input.jobId, template: input.template, caseId: input.caseId, route: input.route,
    ...(input.procedureId !== undefined ? { procedureId: input.procedureId } : {}), ...(input.routeId !== undefined ? { routeId: input.routeId } : {}),
    ...(input.decision !== undefined ? { decision: input.decision } : {}), ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    featureShape: featureShape(features), features, steps, costMinor: input.costMinor, latencyMs: input.latencyMs, outcome: input.outcome,
    ...(note ? { note } : {}), sourceIds: [...new Set(input.sourceIds)].sort(), ownerId: ctx.memberId };
  // Structure only: kind, choice and a fixed reason code. No values, notes, names or amounts.
  const choice: DecisionInput['choice'] = run.outcome === 'refused' ? 'rejected' : (run.route === 'procedure' || run.route === 'ready-made') && run.outcome === 'ok' ? 'accepted' : 'proposed';
  const reasonCode: DecisionInput['reasonCode'] = run.route === 'person' ? 'manual_confirmation' : choice === 'accepted' ? 'verified_readback' : run.outcome !== 'ok' ? 'ambiguous_field' : undefined;
  appendLearningDecision(state, ctx, { kind: steps.some(step => step.kind === 'action') ? 'action' : 'calculation', choice, ...(reasonCode ? { reasonCode } : {}), sourceIds: run.sourceIds });
  const ns = procedureState(state);
  ns.runs.push(run);
  if (ns.runs.length > RUN_LIMIT) ns.runs.splice(0, ns.runs.length - RUN_LIMIT);
  return structuredClone(run);
}

export function approvedProcedure(state: State, template: string, ownerId: string): Procedure | undefined {
  return peekProcedures(state).procedures.find(item => item.status === 'approved' && item.template === template && item.ownerId === ownerId);
}

/** Routed: the procedure handled the case. Fallback: the case went back to the agent or a person. */
export const isRouted = (run: ProcedureRun) => run.route === 'procedure' && run.outcome === 'ok';
export const isFallback = (run: ProcedureRun) => run.outcome === 'fallback' || run.route !== 'procedure' && run.procedureId !== undefined;
export function summarize(runs: readonly ProcedureRun[]): ProcedureStatsView {
  const sum = (list: ProcedureRun[]) => String(list.reduce((total, run) => total + BigInt(run.costMinor), 0n));
  const routed = runs.filter(isRouted), fallback = runs.filter(run => !isRouted(run) && isFallback(run)), agent = runs.filter(run => run.route === 'agent' && !isFallback(run));
  return { agentRuns: agent.length, agentCostMinor: sum(agent), agentLatencyMs: agent.length ? Math.floor(agent.reduce((total, run) => total + run.latencyMs, 0) / agent.length) : 0,
    routedCases: routed.length, fallbackCases: fallback.length, routedCostMinor: sum(routed), fallbackCostMinor: sum(fallback),
    routedShare: { routed: routed.length, total: runs.length } };
}

/** Stats for one procedure (its source runs and the cases it saw) or for a whole template. */
export function procedureStats(state: State, key: string, ownerId?: string): ProcedureStatsView {
  const { procedures, runs } = peekProcedures(state), procedure = procedures.find(item => item.id === key);
  const scoped = procedure ? runs.filter(run => run.procedureId === procedure.id || procedure.derivedFrom.includes(run.id))
    : runs.filter(run => run.template === key && (ownerId === undefined || run.ownerId === ownerId));
  return summarize(scoped);
}

/** Remove runs and procedures derived from the named sources. Returns the number removed. */
export function purgeProcedures(state: State, sourceIds: readonly string[], gone: { jobIds?: ReadonlySet<string>; caseIds?: ReadonlySet<string> } = {}): number {
  const existing = peekModuleState<{ procedures?: unknown }>(state, LANE);
  if (!existing?.procedures) return 0;
  const ns = procedureState(state), sources = new Set(sourceIds), hit = (item: { sourceIds: string[] }) => item.sourceIds.some(id => sources.has(id));
  const before = ns.runs.length + ns.procedures.length;
  // A run also goes with its job, or with a case whose records were removed.
  const removedRuns = new Set(ns.runs.filter(run => hit(run) || gone.jobIds?.has(run.jobId) || gone.caseIds?.has(`${run.jobId}/${run.caseId}`)).map(run => run.id));
  ns.runs = ns.runs.filter(run => !removedRuns.has(run.id)); ns.procedures = ns.procedures.filter(item => !hit(item) && !item.derivedFrom.some(id => removedRuns.has(id)));
  return before - ns.runs.length - ns.procedures.length;
}
