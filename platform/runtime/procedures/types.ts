/**
 * Procedures (after AgentRun). A job first works its cases with a strong agent route and
 * records a structure-only trace of each run. From those runs software proposes a procedure
 * of typed steps: calculator calls, typed questions (a decision with a confidence and allowed
 * options), steps from the action catalogue, and agent steps for lookups only. The owner
 * approves it. Cases are then routed through it; an unmatched or low-confidence case falls
 * back to the full agent.
 */
import type { StepKind } from '../jobs-ext/state.ts';

/** Typed case features. Text values are fixed codes chosen by software, never outside text. */
export type CaseValue = string | number | boolean | null;
export type CaseFields = Record<string, CaseValue>;

export type WorkCase = {
  id: string; jobId: string; template: string; fields: CaseFields;
  recordIds: string[]; sourceIds: string[];
  /** The case carries text read from outside (a file, page or message). */
  tainted: boolean;
};

/** One step of a run trace. Structure only: the tool name, its outcome and its cost meters. */
export type TraceStep = { kind: StepKind; tool: string; outcome: 'ok' | 'refused' | 'unknown'; durationMs: number; units: number };

export type AgentDecision = {
  decision: string; confidence: number;
  steps: TraceStep[]; units: number; durationMs: number;
  /** One to three plain sentences. Shown as quoted agent text, never obeyed. */
  note: string;
};

/** The full agent. Installed by a trusted host (tests, Practice) or by the models lane; never by RPC. */
export interface AgentPort {
  readonly routeId: string;
  decide(item: WorkCase, options: readonly string[], signal: AbortSignal): Promise<AgentDecision>;
}

export type Condition = { equals?: CaseValue; min?: number; max?: number };
export type RuleBucket = { when: Condition; option: string; confidence: number; support: number };
export type DecisionRule = { feature: string; buckets: RuleBucket[]; threshold: number; minSupport: number };

export type ProcedureStep =
  | { kind: 'calculate'; title: string; operation: string }
  | { kind: 'question'; title: string; id: string; options: string[]; rule: DecisionRule }
  | { kind: 'action'; title: string; connector: string; operation: string; when: string }
  | { kind: 'lookup'; title: string; tool: string; routeId: string; units: number };

export type ProcedureStats = {
  agentRuns: number; agentCostMinor: string; agentLatencyMs: number;
  routedCases: number; fallbackCases: number; routedCostMinor: string; fallbackCostMinor: string;
};

export type Procedure = {
  id: string; template: string; version: number; createdAt: string; ownerId: string;
  status: 'proposed' | 'approved' | 'rejected' | 'retired';
  steps: ProcedureStep[];
  /** The feature names and types a case must carry to be routed. */
  match: Record<string, 'string' | 'number' | 'boolean'>;
  derivedFrom: string[]; digest: string; sourceIds: string[];
  approval?: { memberId: string; epoch: number; at: string; digest: string };
  decidedAt?: string; reason?: string;
};

export type ProcedureRun = {
  id: string; at: string; jobId: string; template: string; caseId: string;
  route: 'agent' | 'procedure' | 'ready-made' | 'person' | 'agent-unavailable';
  procedureId?: string; routeId?: string;
  decision?: string; confidence?: number;
  /** Structure-only features: names and types, never values from the case. */
  featureShape: Record<string, 'string' | 'number' | 'boolean' | 'null'>;
  /** Typed values used for deriving rules. Kept on the machine; never shared. */
  features: CaseFields;
  steps: TraceStep[]; costMinor: string; latencyMs: number; outcome: 'ok' | 'fallback' | 'refused' | 'waiting';
  note?: string; sourceIds: string[];
  /** The member whose job ran the case; set by `recordRun` from the caller. */
  ownerId?: string;
};

export type ProceduresState = { procedures: Procedure[]; runs: ProcedureRun[] };
export const initProcedures = (): ProceduresState => ({ procedures: [], runs: [] });
export const RUN_LIMIT = 5000;
