import type { CalculationRequest, Figure, ReceiptRow } from './calculator.ts';
import type { Period } from './memory.ts';

export type InvestigationBudget = { maxSteps: number; maxReceiptRows: number; maxContextBytes: number };
export type InvestigationHypothesisInput = {
  id: string; text: string; uncertainty: 'unverified' | 'unresolved' | 'supported' | 'contradicted';
  forReceiptIds: string[]; againstReceiptIds: string[];
};
export type InvestigationHypothesis = InvestigationHypothesisInput & { kind: 'owner-authored-hypothesis'; authoredBy: string; causalStatus: 'not-established-cause' };
export type InvestigationStepInput = { id: string; label: string; request: Omit<CalculationRequest, 'asOf' | 'branch' | 'kinds'> };
export type InvestigationCreate = {
  objective: string; branch?: string; asOf: string; sourceIds: string[];
  steps: InvestigationStepInput[]; hypotheses: InvestigationHypothesisInput[]; budget: InvestigationBudget;
};
export type InvestigationWrite = { expectedRevision: number };
export type InvestigationReceiptPin = {
  receiptId: string; operation: string; dictionaryHash: string; definitionHash: string; receiptDigest: string;
  asOf: string; period: Period | null; comparePeriod: Period | null; sourceIds: string[]; rowIds: string[];
};
export type InvestigationStep = { id: string; label: string; request: CalculationRequest; definitionHash: string;
  state: 'pending' | 'completed'; receipt?: InvestigationReceiptPin };
export type InvestigationRevision = { fromRevision: number; at: string; reason: string;
  objective: string; hypotheses: InvestigationHypothesis[]; budget: InvestigationBudget };
export type Investigation = {
  kind: 'private-investigation-v1'; id: string; ownerId: string; memberId: string; epoch: number; branch?: string;
  revision: number; status: 'open' | 'paused' | 'complete' | 'cancelled'; pauseReason?: string;
  objective: string; asOf: string; dictionaryHash: string; ontologyVersion: number; planHash: string; scopeDigest: string; scopeImportIds: string[];
  steps: InvestigationStep[]; hypotheses: InvestigationHypothesis[]; budget: InvestigationBudget;
  receiptPins: InvestigationReceiptPin[]; receiptIds: string[]; sourceIds: string[]; rowIds: string[];
  createdAt: string; updatedAt: string; revisions: InvestigationRevision[];
};
export type InvestigationRevisionInput = InvestigationWrite & { reason: string; objective?: string;
  hypotheses?: InvestigationHypothesisInput[]; budget?: InvestigationBudget };
export type InvestigationCapsule = {
  kind: 'private-investigation-capsule-v1'; investigationId: string; revision: number; ownerId: string; epoch: number;
  branch: string | null; objective: string; asOf: string; dictionaryHash: string; planHash: string; scopeDigest: string;
  status: Investigation['status']; pauseReason: string | null; budget: InvestigationBudget;
  completedStepIds: string[]; pendingStepIds: string[];
  plan: { id: string; label: string; request: CalculationRequest; definitionHash: string; receiptId: string | null }[];
  measurements: { receiptId: string; operation: string; dictionaryHash: string; definitionHash: string;
    asOf: string; period: Period | null; comparePeriod: Period | null; figures: Figure[];
    coverage: { completeness: string; selectedRows: number; countedRows: number; excludedRows: number; gaps: string[] } }[];
  hypotheses: InvestigationHypothesis[]; sourceIds: string[]; rowIds: string[]; receiptIds: string[];
  completeness: 'complete-persisted-plan'; interpretation: 'measured-results-and-owner-hypotheses'; digest: string;
};
export type InvestigationDrilldown = { receiptId: string; offset: number; limit: number; totalRows: number;
  rows: ReceiptRow[]; completeness: 'bounded-receipt-page'; excludedRows: number };
/** Root combines these with revision-checked journal documents before using its trusted PostgreSQL adapter. */
export type InvestigationSearchDocument = { kind: 'investigation' | 'journal'; id: string; revision: number;
  ownerId: string; epoch: number; branch: string | null; title: string; text: string;
  receiptIds: string[]; sourceIds: string[]; rowIds: string[]; contentHash: string };
