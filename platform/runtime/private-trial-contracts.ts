import type { CalculationReceipt, CalculationRequest, CalculatorOptions } from './calculator.ts';
import type { Context, State, StateStore } from './contracts.ts';
import type { ImportInput, MappingRecipe } from './ingest.ts';
import type { Definition } from './ontology.ts';

/** One data-only change. Publication and all live writes belong to the host. */
export type PrivateTrialChange =
  | { type: 'definition'; name: string; replacement: Definition }
  | { type: 'recipe'; sourceId: string; recipeId: string; replacement: MappingRecipe }
  | { type: 'source-precedence'; kind: string; sourceIds: string[] };

export type PrivateTrialRequest = {
  version: 1;
  savedAnswerIds: string[];
  change: PrivateTrialChange;
};

/** Authenticated, retained source inputs supplied by custody, never an RPC payload. */
export type PrivateTrialRecipeEvidence = {
  sourceId: string;
  recipe: MappingRecipe;
  captures: {
    importId: string;
    generation: number;
    complete: true;
    input: ImportInput;
    /** In preview row order; a deduplicated claim can occur in multiple captures. */
    factIds: string[];
  }[];
};

export type PrivateTrialVersionPin = {
  dictionaryVersion: number;
  dictionaryHash: string;
  dictionaryDigest: string;
  factsDigest: string;
  importsDigest: string;
  sourceRulesDigest: string;
  identityDigest: string;
  recipes: { sourceId: string; recipeId: string; schemaVersion: 1; digest: string; generationsDigest: string }[];
  stateDigest: string;
};

export type PrivateTrialSavedRequest = {
  answerId: string;
  receiptId: string;
  retainedReceiptDigest: string;
  request: CalculationRequest;
  requestDigest: string;
};

/** Host-only fork artifact: persist under the workspace key hierarchy; do not expose via RPC. */
export type PrivateTrialFork = {
  version: 1;
  type: 'private-trial-fork-v1';
  id: string;
  workspaceId: string;
  memberId: string;
  epoch: number;
  createdAt: string;
  interpretation: 'restated-private-diagnostic';
  change: PrivateTrialChange;
  changeDigest: string;
  liveAuthorityDigest: string;
  baselinePin: PrivateTrialVersionPin;
  candidatePin: PrivateTrialVersionPin;
  savedRequests: PrivateTrialSavedRequest[];
  requestsDigest: string;
  baseline: State;
  candidate: State;
  recipeEvidence: PrivateTrialRecipeEvidence[];
  candidateMappingRefusal: { code: string; errors: { row: number; code: string; message: string }[] } | null;
  cost: { preparationElapsedMs: number; serializedForkBytes: number; diskBytes: null };
  restrictions: { actions: false; outbound: false; liveAuthorityWrites: false; nativeQualification: false };
  digest: string;
};

export type PrivateTrialOutcome =
  | { status: 'calculated'; receipt: CalculationReceipt; receiptDigest: string; semanticDigest: string }
  | { status: 'refused'; code: string; message: string };

/** JSON Pointer locations; absence is distinguished from an explicit null. */
export type PrivateTrialDifference = {
  path: string;
  baselinePresent: boolean;
  candidatePresent: boolean;
  baseline: unknown;
  candidate: unknown;
  category: 'receipt-identity' | 'meaning-or-evidence';
};

export type PrivateTrialComparison = {
  answerId: string;
  request: CalculationRequest;
  requestDigest: string;
  baseline: PrivateTrialOutcome;
  candidate: PrivateTrialOutcome;
  differences: PrivateTrialDifference[];
  meaningChanged: boolean;
  totalDeltaMinor: string | null;
  figures: { key: string; baselineMinor: string | null; candidateMinor: string | null; deltaMinor: string | null }[];
};

export type PrivateTrialEvaluation = {
  version: 1;
  type: 'private-trial-evaluation-v1';
  trialId: string;
  forkDigest: string;
  qualification: 'isolated-source-replay';
  interpretation: 'restated-private-diagnostic';
  comparisons: PrivateTrialComparison[];
  cost: { evaluationElapsedMs: number; serializedReceiptBytes: number; diskBytes: null };
  limitations: string[];
  digest: string;
};

export type PrivateTrialStrategy = 'prospective' | 'retrospective';
/** Complete inventory of publication dependencies, supplied by the integration owner. */
export type PrivateTrialDependencyImpact = {
  complete: true;
  affectedArtifactIds: string[];
  rebuildArtifactIds: string[];
  activeWorkIds: string[];
};

export type PrivateTrialImpact = PrivateTrialDependencyImpact & {
  trialId: string;
  forkDigest: string;
  evaluationDigest: string;
  strategy: PrivateTrialStrategy;
  affectedSavedAnswerIds: string[];
  historicalReceiptIdsToPreserve: string[];
  restatement: string;
  digest: string;
};

export type PrivateTrialPromotionRequest = {
  trialId: string;
  evaluationDigest: string;
  strategy: PrivateTrialStrategy;
  acknowledgedImpactDigest: string;
};

/** A proposal is inert and is never an ActionService authorization. */
export type PrivateTrialPromotionProposal = {
  version: 1;
  type: 'private-trial-promotion-proposal-v1';
  trialId: string;
  workspaceId: string;
  memberId: string;
  epoch: number;
  liveAuthorityDigest: string;
  baselinePin: PrivateTrialVersionPin;
  candidatePin: PrivateTrialVersionPin;
  change: PrivateTrialChange;
  evaluationDigest: string;
  impact: PrivateTrialImpact;
  requiresAtomicHostPublication: true;
  digest: string;
};

export type PrivateTrialGuardContext = {
  phase: 'create' | 'evaluate' | 'read' | 'promote';
  side: 'baseline' | 'candidate';
  change: PrivateTrialChange;
};

export type PrivateTrialHost = {
  /** Trusted host wall clock; calculation requests keep their original knowledge cuts. */
  now(): string;
  resolveRecipeEvidence(ctx: Context, sourceId: string): PrivateTrialRecipeEvidence;
  /** Load an authenticated private fork and its retained evaluation from managed custody. */
  resolveTrial(ctx: Context, id: string): { fork: PrivateTrialFork; evaluation?: PrivateTrialEvaluation };
  /** Verify immutable service-issued identity in custody, beyond recomputing a caller's hash. */
  assertArtifactAuthentic(ctx: Context, kind: 'fork' | 'evaluation', digest: string): void;
  /** Required view-specific readiness guards. No model, transport, action or verifier port. */
  calculatorGuards(view: StateStore, guard: PrivateTrialGuardContext): Required<Pick<CalculatorOptions, 'consumerGuard' | 'receiptGuard'>>;
  resolvePromotionImpact(ctx: Context, fork: PrivateTrialFork, evaluation: PrivateTrialEvaluation, strategy: PrivateTrialStrategy): PrivateTrialDependencyImpact;
};
