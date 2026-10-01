import { canonical } from './actions.ts';
import { check } from './contracts.ts';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type InformationClass = 'observation' | 'computation' | 'hypothesis' | 'action-preview';
export type Dependency = { stepId: string; informationClass: InformationClass; evidenceRequired: boolean };
export type GoalStep = {
  id: string; provider: string; input: Json; reserveMinor: string;
  modelUnits: number; durationMs: number; actionExposureMinor: string;
  modelRequired: boolean; routeId?: string; childTaskId?: string; dependencies: Dependency[];
};
export type GoalPlan = {
  runnerVersion: string; steps: GoalStep[];
  children: { id: string; goal: string; requiredStepIds: string[] }[];
  obligations: { id: string; description: string; requiredStepIds: string[] }[];
};
export type GoalLimits = { modelUnits: number; durationMs: number; actionExposureMinor: string };
export type StepResult = { value: Json; informationClass: InformationClass; evidenceIds: string[]; sourceTainted: boolean };
export type ProviderSettlement = { result: StepResult; spentMinor: string; modelUnits: number; durationMs: number; actionExposureMinor: string };
export type StepAttempt = {
  stepId: string; key: string; attempt: number; fence: number;
  status: 'dispatched' | 'unknown' | 'verified' | 'absent' | 'blocked';
  reservedMinor: string; startedAt: string; settledAt?: string;
  settlement?: ProviderSettlement; reconciliationId?: string; reason?: string;
};
export type GoalExecution = {
  calendar?: { occurrenceId: string; scheduleRevision: number; requestedLocal: string; resolvedLocal: string; fold: number; rulesRevision: string; representedIds?: string[] };
  plan: GoalPlan; type: string; sourceIds: string[];
  run: number; objectiveRevision: number; scheduledFor: string; planDigest: string;
  startedAt: string; attempts: StepAttempt[]; meters: GoalLimits;
  sourceTainted: boolean; afterReconcile?: 'scheduled' | 'paused' | 'cancelled' | 'revoked' | 'stopped';
};
export const money = (value: unknown): bigint => {
  check(typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value), 'INVALID_BUDGET', 'Use non-negative integer minor currency units.');
  return BigInt(value);
};
export function json<T>(value: T): T {
  const text = canonical(value);
  check(text.length <= 2 * 1024 * 1024, 'INVALID_JOB_PAYLOAD', 'Job inputs and results must be bounded JSON.');
  return JSON.parse(text);
}
export function validateLimits(limits: GoalLimits) {
  check(limits && Number.isSafeInteger(limits.modelUnits) && limits.modelUnits >= 0 && Number.isSafeInteger(limits.durationMs) && limits.durationMs > 0, 'INVALID_JOB_LIMITS', 'Set explicit model and time ceilings.');
  money(limits.actionExposureMinor);
}
const name = (value: string) => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
export function validatePlan(plan: GoalPlan, reserveMinor: string, limits: GoalLimits) {
  json(plan); validateLimits(limits);
  check(plan && typeof plan.runnerVersion === 'string' && plan.runnerVersion.length > 0 && Array.isArray(plan.steps) && plan.steps.length > 0 && plan.steps.length <= 1000, 'INVALID_JOB_PLAN', 'A versioned plan needs bounded named steps.');
  check(Array.isArray(plan.children) && Array.isArray(plan.obligations) && plan.obligations.length > 0, 'INVALID_JOB_PLAN', 'Declare child tasks and original objective obligations.');
  const prior = new Set<string>(); const children = new Set<string>();
  for (const child of plan.children) { check(name(child.id) && !children.has(child.id) && typeof child.goal === 'string' && child.goal.length >= 5 && Array.isArray(child.requiredStepIds) && child.requiredStepIds.length > 0 && !Object.hasOwn(child, 'children'), 'INVALID_CHILD_TASK', 'Declare unique one-level children with required results.'); children.add(child.id); }
  let cash = 0n; let units = 0; let duration = 0; let exposure = 0n;
  for (const step of plan.steps) {
    check(name(step.id) && !prior.has(step.id) && name(step.provider), 'INVALID_JOB_PLAN', 'Step IDs must be unique and providers explicit.');
    check(typeof step.modelRequired === 'boolean' && Array.isArray(step.dependencies), 'INVALID_JOB_PLAN', 'Every step declares model needs and typed dependencies.');
    check(!step.modelRequired || (typeof step.routeId === 'string' && step.routeId.length > 0), 'UNQUALIFIED_JOB_ROUTE', 'Model steps need an explicit tested route.');
    check(step.childTaskId === undefined || children.has(step.childTaskId), 'INVALID_CHILD_TASK', 'Child tasks are one level deep.');
    check(Number.isSafeInteger(step.modelUnits) && step.modelUnits >= 0 && Number.isSafeInteger(step.durationMs) && step.durationMs > 0, 'INVALID_JOB_LIMITS', 'Every step needs bounded estimated model and time use.');
    for (const dependency of step.dependencies) check(prior.has(dependency.stepId) && ['observation', 'computation', 'hypothesis', 'action-preview'].includes(dependency.informationClass) && typeof dependency.evidenceRequired === 'boolean', 'INVALID_JOB_DEPENDENCY', 'Dependencies must name earlier typed results.');
    cash += money(step.reserveMinor); units += step.modelUnits; duration += step.durationMs; exposure += money(step.actionExposureMinor); prior.add(step.id);
  }
  check(cash <= money(reserveMinor) && units <= limits.modelUnits && duration <= limits.durationMs && exposure <= money(limits.actionExposureMinor), 'JOB_PLAN_EXCEEDS_LIMITS', 'The full plan must fit its shared admission ceilings.');
  const obligations = new Set<string>();
  for (const obligation of plan.obligations) {
    check(name(obligation.id) && !obligations.has(obligation.id) && typeof obligation.description === 'string' && obligation.description.length > 0 && Array.isArray(obligation.requiredStepIds) && obligation.requiredStepIds.length > 0 && obligation.requiredStepIds.every(id => prior.has(id)), 'UNASSIGNED_JOB_OBLIGATION', 'Every requested obligation needs planned proof.'); obligations.add(obligation.id);
  }
  for (const child of plan.children) check(child.requiredStepIds.every(id => plan.steps.some(step => step.id === id && step.childTaskId === child.id)), 'INVALID_CHILD_TASK', 'Required child results must belong to that child.');
}
export function validateSettlement(value: ProviderSettlement, step: GoalStep) {
  json(value);
  check(value && value.result && ['observation', 'computation', 'hypothesis', 'action-preview'].includes(value.result.informationClass) && Array.isArray(value.result.evidenceIds) && value.result.evidenceIds.every(id => typeof id === 'string' && id.length > 0) && typeof value.result.sourceTainted === 'boolean', 'INVALID_JOB_RESULT', 'A step result needs a typed value and explicit evidence.');
  money(value.spentMinor); money(value.actionExposureMinor);
  check(money(value.spentMinor) <= money(step.reserveMinor) && Number.isSafeInteger(value.modelUnits) && value.modelUnits >= 0 && value.modelUnits <= step.modelUnits && Number.isSafeInteger(value.durationMs) && value.durationMs >= 0 && value.durationMs <= step.durationMs && money(value.actionExposureMinor) <= money(step.actionExposureMinor), 'JOB_STEP_EXCEEDS_LIMITS', 'Settlement must fit the admitted step exposure.');
}
