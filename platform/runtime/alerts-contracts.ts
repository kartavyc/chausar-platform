import type { CalculationRequest, CalculatorOptions } from './calculator.ts';
import type { StateStore } from './contracts.ts';
import type { Period } from './memory.ts';

export type AlertUnit = { kind: 'money'; currency: string } | { kind: 'basis-points' };
export type AlertPersistence = { observations: number; durationMs: number };
export type AlertSeverity = 'warning' | 'critical';
export type AlertCreate = {
  conditionId: string;
  label: string;
  baselineReceiptId: string;
  figureKey: string;
  unit: AlertUnit;
  sourceIds: string[];
  periodMode: 'fixed' | 'moving';
  direction: 'above' | 'below';
  activateMinor: string;
  clearMinor: string;
  activation: AlertPersistence;
  clearance: AlertPersistence;
  /** on-clear retains the episode's peak severity until resolution; closed history retains that peak. */
  severity: { initial: AlertSeverity; criticalMinor?: string; downgrade: 'on-clear' | 'on-observation' };
  reopening: 'same-episode' | 'new-episode' | 'never';
  maxEvidenceAgeMs: number;
  maxObservationGapMs: number;
};
export type AlertWrite = { expectedRevision: number };
export type AlertEvaluate = AlertWrite & {
  observationId: string;
  /** Measurement knowledge cut for ordinary samples; original sample time for corrections. */
  observedAt: string;
  receiptId?: string;
  missingReason?: string;
  correction?: { observationId: string; reason: string };
};
export type AlertReceiptPin = {
  receiptId: string;
  digest: string;
  request: CalculationRequest;
  asOf: string;
  period: Period | null;
  comparePeriod: Period | null;
  rowIds: string[];
  sourceIds: string[];
};
export type AlertObservation = {
  id: string;
  anchorId: string;
  observedAt: string;
  recordedAt: string;
  payloadHash: string;
  evidenceHash?: string;
  receipt?: AlertReceiptPin;
  valueMinor?: string;
  state: 'breach' | 'clear' | 'band' | 'unknown';
  severity?: AlertSeverity;
  issues: string[];
  amends?: string;
  amendmentReason?: string;
};
export type AlertEpisode = {
  id: string;
  status: 'open' | 'cleared' | 'retracted';
  severity: AlertSeverity;
  openedAt: string;
  clearedAt?: string;
  reopenedAt?: string;
  reopenCount: number;
  uncertain: boolean;
  observationIds: string[];
};
export type AlertNotice = {
  id: string;
  kind: 'local-alert-notice-v1';
  transition: 'opened' | 'cleared' | 'escalated' | 'deescalated' | 'reopened' | 'uncertain' | 'evidence-restored' | 'amended';
  alertId: string;
  episodeId: string;
  at: string;
  observationId: string;
  before: AlertEpisode | null;
  after: AlertEpisode;
  delivery: 'local-only';
};
export type AlertDefinition = AlertCreate & {
  operation: string;
  branch: string | null;
  dictionaryHash: string;
  definitionHash: string;
  ontologyVersion: number;
  baseline: AlertReceiptPin;
};
export type BusinessAlert = {
  kind: 'business-alert-v1';
  id: string;
  memberId: string;
  ownerId: string;
  epoch: number;
  branch: string | null;
  conditionKey: string;
  revision: number;
  status: 'draft' | 'published';
  definition: AlertDefinition;
  definitionDigest: string;
  createdAt: string;
  publishedAt?: string;
  updatedAt: string;
  observations: AlertObservation[];
  episodes: AlertEpisode[];
  notices: AlertNotice[];
  receiptIds: string[];
  sourceIds: string[];
  rowIds: string[];
};
export type AlertEvaluation = { alert: BusinessAlert; duplicate: boolean; notices: AlertNotice[] };
export type AlertsOptions = CalculatorOptions & {
  clock?: () => string;
  /** Build receipt/consumer guards against the transaction's current authority snapshot. */
  calculatorOptions?: (view: StateStore) => CalculatorOptions;
};
