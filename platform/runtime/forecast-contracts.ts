import type { CalculationReceipt, CalculationRequest } from './calculator.ts';
import type { Fact } from './contracts.ts';
import type { Period } from './memory.ts';
import type { Dictionary } from './ontology.ts';

/** Monthly, monetary, univariate evaluation. All timestamps refer to recorded knowledge in UTC. */
export type ForecastRequest = {
  version: 1;
  mode: 'operational-as-known' | 'restated-diagnostic';
  operation: string;
  dictionaryHash: string;
  sourceIds: string[];
  branch: string | null;
  horizonsMonths: number[];
  cadenceMonths: number;
  minimumTrainingMonths: number;
  method: 'linear-trend-v1';
  benchmark: 'last-observed-v1';
  /** Uniform recorded-knowledge and complete-month availability lag, applied only to training. */
  availabilityLagMs: number;
  origins: {
    id: string;
    /** Inclusive event date, required to be the end of a calendar month. */
    eventCutoff: string;
    knowledgeCut: string;
    trainingReceiptIds: string[];
    /** A target is a single month at this offset, not a cumulative horizon total. */
    targets: { horizonMonths: number; receiptId: string }[];
  }[];
};

/** Trusted host evidence, never accepted from an RPC caller. Missing retained evidence fails closed. */
export type ForecastResolvedEvidence = {
  dictionary: Dictionary;
  receipts: { receipt: CalculationReceipt; request: CalculationRequest }[];
  /** Complete retained, currently permitted fact history for the requested source/branch scope. */
  facts: Fact[];
  /** Original reconciliation records backing the receipts' import coverage assertions. */
  imports: { id: string; sourceId?: string; rowIds: string[]; coverage: { reconciled: boolean }; [key: string]: unknown }[];
  /** Retained historical precedence publications, excluding current source access grants. */
  sourceRules: { kind: string; sourceIds: string[]; at: string }[];
};
export type ForecastExact = { numerator: string; denominator: string };
export type ForecastEvidencePin = {
  receiptId: string;
  receiptDigest: string;
  calculationRequestDigest: string;
  factDigests: { factId: string; digest: string }[];
  importDigests: { importId: string; digest: string }[];
};
export type ForecastPrediction = {
  minor: string;
  /** Exact least-squares prediction before truncating fractional minor units toward zero. */
  exactMinor: ForecastExact;
  signedErrorMinor: string;
  absoluteErrorMinor: string;
  squaredErrorMinor: string;
};
export type ForecastFold = {
  originId: string;
  horizonMonths: number;
  targetPeriod: Period;
  targetReceiptId: string;
  targetKnowledgeAsOf: string;
  actualMinor: string;
  candidate: ForecastPrediction;
  benchmark: ForecastPrediction;
};
export type ForecastOriginManifest = {
  id: string;
  eventCutoff: string;
  knowledgeCut: string;
  effectiveTrainingKnowledgeCut: string | null;
  interpretation: ForecastRequest['mode'];
  training: { receiptId: string; period: Period; asOf: string; totalMinor: string; evidenceDigest: string }[];
  excludedTraining: { receiptId: string; reason: 'after-event-cutoff' | 'after-knowledge-cut' | 'month-not-available' | 'older-month-revision' }[];
  trainingDigest: string;
  model: { interceptMinor: ForecastExact; slopeMinorPerMonth: ForecastExact; xOriginMonth: string; observations: number };
  targetReceiptIds: string[];
  missingHorizonsMonths: number[];
};
export type ForecastHorizonSummary = {
  horizonMonths: number;
  scoredOrigins: number;
  requestedOrigins: number;
  missingOriginIds: string[];
  candidate: { sumAbsoluteErrorMinor: string; sumSquaredErrorMinor: string; meanAbsoluteErrorMinor: ForecastExact | null; meanSquaredErrorMinor: ForecastExact | null };
  benchmark: { sumAbsoluteErrorMinor: string; sumSquaredErrorMinor: string; meanAbsoluteErrorMinor: ForecastExact | null; meanSquaredErrorMinor: ForecastExact | null };
  comparison: 'lower-absolute-error' | 'equal-absolute-error' | 'higher-absolute-error' | 'unscored';
};
export type ForecastEvaluation = {
  version: 1;
  type: 'forecast-evaluation-v1';
  mode: ForecastRequest['mode'];
  interpretation: string;
  qualification: 'source-evidence-backtest';
  operation: string;
  dictionaryHash: string;
  definitionHash: string;
  currency: string;
  sourceIds: string[];
  branch: string | null;
  request: ForecastRequest;
  requestDigest: string;
  evidenceDigest: string;
  dictionaryDigest: string;
  sourceRulesDigest: string;
  receiptIds: string[];
  rowIds: string[];
  evidencePins: ForecastEvidencePin[];
  methods: { method: 'linear-trend-v1'; methodRevision: string; benchmark: 'last-observed-v1'; benchmarkRevision: string; preprocessing: 'none'; tuning: 'none'; rounding: 'truncate-toward-zero'; target: 'individual-calendar-month'; errorSign: 'prediction-minus-actual'; scoringBasis: 'emitted-integer-minor-prediction' };
  origins: ForecastOriginManifest[];
  folds: ForecastFold[];
  horizons: ForecastHorizonSummary[];
  coverage: { origins: number; folds: number; requestedHorizons: number; scoredHorizons: number; reconciledReceiptCount: number; staleHistoricalReceiptIds: string[] };
  uncertainty: { calibratedIntervals: false; intervalType: 'none' };
  limitations: string[];
  digest: string;
};
export type SavedForecastEvaluation = ForecastEvaluation & {
  id: string;
  memberId: string;
  epoch: number;
  createdAt: string;
  at: string;
  stale: boolean;
  staleReason?: string;
};
