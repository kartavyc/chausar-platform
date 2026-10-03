import type { DatasetManifest, Digest, SourceBatch } from '../contracts.ts';

/** Version 1 is a small local evidence contract, not a corpus or connector admission. */
export const PREPARATION_LIMITS = Object.freeze({
  originalBytes: 16 * 1024 * 1024, expandedBytes: 32 * 1024 * 1024,
  parts: 256, sheets: 64, columnsPerSheet: 200, rowsPerSheet: 2000, cells: 4000,
});
export type ImplementationIdentity = { id: string; version: string; buildHash: Digest; profileHash: Digest };
export type OriginalCustody = {
  captureId: string; storageVersion: string; attemptId: string; path: string;
  sha256: Digest; byteLength: number; capturedAt: string; retainedUntil: string;
};
export type CellType = 'text' | 'number' | 'date' | 'boolean' | 'blank' | 'error' | 'formula';
/** One-based column indexes; original rows retain their one-based workbook/source coordinates. */
export type ObservedColumn = { id: string; label: string; index: number; types: CellType[] };
export type ObservedSheet = {
  id: string; name: string; partPath: string; visibility: 'visible' | 'hidden' | 'very-hidden';
  columns: ObservedColumn[]; dataRows: number[];
};
/** Raw stored/displayed lexemes are syntax evidence. A date serial is not a business date. */
export type ObservedCell = {
  sheetId: string; row: number; columnId: string; type: CellType;
  lexeme: string; displayLexeme: string | null; numberFormat: string | null;
  formula: string | null; cachedLexeme: string | null;
};
export type ArtifactObservation = {
  contractVersion: 1; originalSha256: Digest; parserHash: Digest;
  mediaType: 'workbook' | 'delimited-text' | 'synthetic-fixture';
  parts: Array<{ path: string; sha256: Digest; byteLength: number; inspected: true }>;
  sheets: ObservedSheet[]; cells: ObservedCell[];
  inspection: { allPartsInspected: true; encrypted: false; activeContent: false; externalLinks: string[] };
  limitations: string[];
};
export type ProjectionPlan = {
  contractVersion: 1; id: string; version: string; minimizer: ImplementationIdentity;
  sheets: Array<{ sheetId: string; retainColumns: string[]; removeColumns: string[] }>;
};
export type CellProjectionReceipt = {
  partPath: string; sheetId: string; row: number; columnId: string; sourceColumnIndex: number;
  sourceCellHash: Digest; disposition: 'retained' | 'removed'; outputColumnIndex: number | null;
};
export type ProjectedArtifact = {
  contractVersion: 1; observationHash: Digest; projectionHash: Digest;
  sheets: ObservedSheet[]; cells: ObservedCell[]; cellReceipts: CellProjectionReceipt[];
  limitations: string[];
};
export type ReviewReference = { id: string; reviewer: string; at: string; evidenceHash: Digest; subjectHash: Digest };
/** Unknown family identities stay null. Paths and origin enums establish no independent business. */
export type PreparationSourceIdentity = {
  sourceId: string; manifestId: string; origin: DatasetManifest['origin']; sourceHash: Digest;
  families: { [K in keyof SourceBatch['origins']]: string | null }; evidenceHash: Digest;
};
export type PrivacyReview = ReviewReference & {
  personalData: 'none' | 'redacted'; allPartsReviewed: true; residualLimitations: string[];
};
export type LocalArtifactPreparationRequest = {
  contractVersion: 1; attemptId: string; at: string; expiresAt: string;
  manifest: DatasetManifest; custody: OriginalCustody; parser: ImplementationIdentity;
  observation: ArtifactObservation; projection: ProjectionPlan; projected: ProjectedArtifact;
  rightsReview: ReviewReference; privacyReview: PrivacyReview; sourceIdentity: PreparationSourceIdentity;
};
export type PreparationDependencies = {
  manifestHash: Digest; custodyHash: Digest; parserHash: Digest; observationHash: Digest;
  schemaHash: Digest; projectionHash: Digest; projectedHash: Digest;
  rightsReviewHash: Digest; privacyReviewHash: Digest; sourceIdentityHash: Digest;
};
export type PreparationEvidenceBinding = {
  contractVersion: 1; attemptId: string; at: string; expiresAt: string;
  purpose: 'local-artifact-preparation'; dependencies: PreparationDependencies;
};
export type LocalArtifactPreparationReceipt = PreparationEvidenceBinding & {
  kind: 'local-artifact-preparation'; id: Digest; datasetId: string;
  qualification: 'UNQUALIFIED'; connectorAdmission: false; vendorAdmission: false;
  publicationAuthority: false; modelDisclosureAuthority: false;
  redistributionAuthority: false; trainingAuthority: false; limitations: string[];
};
export type PreparedLocalArtifact = { receipt: LocalArtifactPreparationReceipt; projected: ProjectedArtifact };

/** Interfaces only. Implementations must inspect the same bytes under a separately qualified containment profile. */
export interface LocalArtifactInspector {
  identity: ImplementationIdentity;
  inspect(original: Uint8Array, limits: typeof PREPARATION_LIMITS): ArtifactObservation;
}
/** Interfaces only. No workbook rewriting, sanitization engine, formula evaluator or parser is installed here. */
export interface LocalArtifactMinimizer {
  identity: ImplementationIdentity;
  project(observation: ArtifactObservation, plan: ProjectionPlan, limits: typeof PREPARATION_LIMITS): ProjectedArtifact;
}
/** Injected by the owner of existing custody/review/audit stores; never accepted from a serialized request. */
export interface LocalArtifactPreparationHost {
  now(): string;
  readOriginal(custody: OriginalCustody): Uint8Array | null;
  inspector: LocalArtifactInspector;
  minimizer: LocalArtifactMinimizer;
  /** Verify the entire exact binding against CURRENT custody, parser, rights, privacy and source evidence.
   * Unknown, revoked, expired, self-supplied or unverifiable evidence must return null.
   * Reviews must authorize local retention/inspection and the sensitive cell-receipt hashes themselves.
   */
  verifyEvidence(binding: PreparationEvidenceBinding, at: string): { bindingHash: Digest; verified: true } | null;
  /** Atomically insert-if-absent in the parent's existing audit store, or idempotently confirm the
   * SAME payload digest (receipt.id) for this attempt. A conflicting attempt must return null;
   * unconditional overwrite is forbidden even if a prior caller read found no entry.
   * No separate authority ledger is created. The returned/retained digest is receipt.id,
   * which hashes the complete receipt payload excluding its own id field.
   */
  retainAudit(receipt: LocalArtifactPreparationReceipt): Digest | null;
  retainedReceiptHash(attemptId: string): Digest | null;
  /** Mandatory final decision: atomically verify CURRENT custody, rights/privacy/source evidence,
   * installed inspector/minimizer identities and profiles, the independent attempt receipt anchor,
   * and the trusted clock in one consistent store/authority snapshot. Refuse stale or missing state.
   * The returned time is the decision instant. No production adapter composing separate callbacks
   * is provided; actual transaction/isolation behavior remains separately unqualified.
   */
  verifyRetainedEvidence(binding: PreparationEvidenceBinding, receiptId: Digest): {
    bindingHash: Digest; receiptId: Digest; checkedAt: string; verified: true;
  } | null;
}
