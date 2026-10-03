import type { CalculationReceipt, CalculationRequest, CalculatorOptions } from './calculator.ts';
import type { Context, State, StateStore } from './contracts.ts';

/** Only the existing calculator's constant-volume price assumption is admitted. */
export type ScenarioCreateRequest = {
  version: 1;
  label: string;
  baseline: { label: string; request: CalculationRequest };
  alternatives: { label: string; priceChangeBps: string }[];
};
export type ScenarioBranch = {
  id: string;
  label: string;
  role: 'baseline' | 'alternative';
  assumptionRevisionId: string;
  priceChangeBps: string;
  rootJobId: string;
};
/** Every declared job is required. No model/solver/external job port is installed. */
export type ScenarioAnalysisRequest = {
  branchId: string;
  label: string;
  request: CalculationRequest;
  dependsOn: string[];
  usesBranchAssumptions: boolean;
};
export type ScenarioJob = ScenarioAnalysisRequest & {
  id: string;
  authoredRequest: CalculationRequest;
  authoredRequestDigest: string;
  requestDigest: string;
  /** Transitive evidence, request, assumption-revision and predecessor vector. */
  inputDigest: string;
};
export type ScenarioEvidence = {
  id: string;
  knowledgeCut: string;
  dictionaryHash: string;
  dictionaryVersion: number;
  factsDigest: string;
  importsDigest: string;
  identityDigest: string;
  sourceRulesDigest: string;
  /** Host-only retained input. Never accept this snapshot from an RPC caller. */
  state: State;
  digest: string;
};
export type ScenarioRevision = {
  id: string;
  scenarioId: string;
  parentRevisionId: string | null;
  mode: 'initial' | 'assumption-change' | 'graph-change' | 'current-state-recompute';
  createdAt: string;
  evidenceId: string;
  evidenceDigest: string;
  branches: ScenarioBranch[];
  jobs: ScenarioJob[];
  digest: string;
};
export type ScenarioJobState = {
  jobId: string;
  status: 'pending' | 'stale' | 'running' | 'ready';
  runId?: string;
  activeRunId?: string;
  retainedRunId?: string;
  reusedFromRevisionId?: string;
};
export type ScenarioRun = {
  id: string;
  scenarioId: string;
  revisionId: string;
  revisionDigest: string;
  branchId: string;
  jobId: string;
  evidenceId: string;
  evidenceDigest: string;
  requestDigest: string;
  inputDigest: string;
  dependencies: { jobId: string; inputDigest: string; runId: string; resultDigest: string }[];
  createdAt: string;
  digest: string;
};
export type ScenarioRunResult = {
  runId: string;
  runDigest: string;
  receipt: CalculationReceipt;
  receiptDigest: string;
  digest: string;
};
/** An inert comparison, not authorization, an action proposal or materialization. */
export type ScenarioComparison = {
  id: string;
  scenarioId: string;
  revisionId: string;
  revisionDigest: string;
  evidenceId: string;
  evidenceDigest: string;
  createdAt: string;
  requiredJobs: {
    jobId: string;
    branchId: string;
    requestDigest: string;
    inputDigest: string;
    runId: string;
    runRevisionId: string;
    receiptId: string;
    receiptDigest: string;
    reusedFromRevisionId: string | null;
  }[];
  noAction: true;
  limitations: string[];
  digest: string;
};
/** Mutable head/evaluation ledger; all contained evidence/revisions/runs/results are append-only. */
export type ScenarioRecord = {
  version: 1;
  id: string;
  workspaceId: string;
  memberId: string;
  epoch: number;
  label: string;
  baselineBranchId: string;
  headRevisionId: string;
  evidence: ScenarioEvidence[];
  revisions: ScenarioRevision[];
  evaluations: { revisionId: string; jobs: ScenarioJobState[] }[];
  runs: ScenarioRun[];
  results: ScenarioRunResult[];
  comparisons: ScenarioComparison[];
  digest: string;
};
export type ScenarioView = {
  scenarioId: string;
  headRevisionId: string;
  mode: 'retained-revision';
  revision: ScenarioRevision;
  jobs: ScenarioJobState[];
  status: 'partial' | 'complete';
  results: ScenarioRunResult[];
  comparisons: ScenarioComparison[];
  noAction: true;
};
export type ScenarioHost = {
  now(): string;
  /** Authenticated private custody. Missing/purged artifacts must refuse; never accept caller bundles. */
  resolveScenario(ctx: Context, id: string): ScenarioRecord;
  assertArtifactAuthentic(ctx: Context, digest: string): void;
  /** Synchronous atomic compare-and-swap, registering the service-issued digest as authentic.
   * null means insert-only. A mismatch must throw; no overwrite/merge fallback is permitted.
   * The integration owner supplies encrypted custody and source-deletion purge. */
  retainScenario(ctx: Context, expectedDigest: string | null, record: ScenarioRecord): void;
  /** Required synchronous view-specific readiness guards; no verifier, transport or action port. */
  calculatorGuards(view: StateStore, phase: 'calculate' | 'reopen'): Required<Pick<CalculatorOptions, 'consumerGuard' | 'receiptGuard'>>;
};
