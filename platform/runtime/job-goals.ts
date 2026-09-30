import { check } from './contracts.ts';
import type { Context } from './contracts.ts';
import { json } from './job-protocol.ts';
import type { GoalStep, Json, StepResult } from './job-protocol.ts';
import type { GoalRunner } from './job-runner.ts';

type WorkItem = { id: string; input: Json; reserveMinor: string; durationMs: number };
type CalculationInput = { requests: WorkItem[] };
type EvidenceInput = { records: WorkItem[] };
type GoalPorts = { providerId: string; release: (context: Context, result: StepResult) => boolean };
function items(value: unknown, field: 'requests' | 'records'): WorkItem[] {
  const input = json(value) as Record<string, unknown>;
  check(input && Array.isArray(input[field]) && input[field].length > 0, 'INVALID_JOB_INPUT', `Supply explicit ${field}.`);
  return input[field] as WorkItem[];
}
function step(item: WorkItem, provider: string): GoalStep {
  return { id: item.id, provider, input: json(item.input), reserveMinor: item.reserveMinor, modelUnits: 0, durationMs: item.durationMs, actionExposureMinor: '0', modelRequired: false, dependencies: [] };
}
/** Generic published-calculation requests. The host installs its qualified calculator port explicitly. */
export function calculationGoal(ports: GoalPorts): GoalRunner<CalculationInput> {
  return {
    type: 'calculation-set', version: '1', validate: input => ({ requests: items(input, 'requests') }),
    plan: input => ({ runnerVersion: '1', steps: input.requests.map(item => step(item, ports.providerId)), children: [], obligations: input.requests.map(item => ({ id: item.id, description: `Return the requested calculation ${item.id}`, requiredStepIds: [item.id] })) }),
    deliver: (input, results) => {
      for (const item of input.requests) check(results[item.id]?.informationClass === 'computation' && results[item.id].evidenceIds.length > 0, 'JOB_EVIDENCE_REQUIRED', 'Each calculation needs a computation receipt.');
      return json({ calculations: input.requests.map(item => ({ id: item.id, ...results[item.id] })) });
    }, release: ports.release,
  };
}
/** Reviews explicitly supplied evidence; it selects no customer workflow or remote transport. */
export function evidenceGoal(ports: GoalPorts): GoalRunner<EvidenceInput> {
  return {
    type: 'evidence-review', version: '1', validate: input => ({ records: items(input, 'records') }),
    plan: input => ({ runnerVersion: '1', steps: input.records.map(item => ({ ...step(item, ports.providerId), childTaskId: item.id })), children: input.records.map(item => ({ id: item.id, goal: `Review evidence ${item.id}`, requiredStepIds: [item.id] })), obligations: input.records.map(item => ({ id: item.id, description: `Review the requested record ${item.id}`, requiredStepIds: [item.id] })) }),
    deliver: (input, results) => {
      for (const item of input.records) check(results[item.id]?.informationClass === 'observation' && results[item.id].evidenceIds.length > 0, 'JOB_EVIDENCE_REQUIRED', 'Every review needs observed evidence.');
      return json({ records: input.records.map(item => ({ id: item.id, ...results[item.id] })) });
    }, release: ports.release,
  };
}
