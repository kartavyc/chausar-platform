/** Data-only boundary. Decimal values are strings, never JavaScript numbers. */
export type Digest = string;
export type SemanticKind = 'invoice' | 'sale' | 'refund' | 'payment' | 'purchase' | 'cost';
export type OperationId = 'billed' | 'earned' | 'refunds' | 'received' | 'purchases' | 'costs' | 'net_sales';
export type SourceSchema = { fields: Record<string, 'text' | 'boolean'> };
export type OntologyContract = {
  version: string; definitions: Record<SemanticKind, { amount: 'net-excluding-tax'; dateBasis: string }>;
  operations: OperationId[];
};
export type MappingPack = {
  contractVersion: 1; id: string; version: string; system: string;
  product: { name: string; version: string; edition: string; configuration: string };
  ontologyHash: Digest; sourceSchema: SourceSchema;
  bindings: {
    identity: string; kind: string; date: string; amount: string; tax: string; currency: string;
    status: string; company: string; branch: string; taxRegistration: string;
    quantity: string; unit: string; relatedIdentity: string;
  };
  semantics: {
    taxInclusion: 'inclusive' | 'exclusive'; amountUnit: 'major' | 'minor';
    dateFormat: 'ISO' | 'DMY' | 'YMD8'; dateBasis: string; calendar: 'gregorian-date';
    kindValues: Record<string, SemanticKind>;
    statusValues: Record<string, 'include' | 'exclude-cancelled' | 'exclude-draft' | 'exclude-bounced'>;
    refundSign: 'positive' | 'negative'; refundsRequireLink: true;
    missing: 'abstain'; unknownState: 'abstain'; onSchemaDrift: 'invalidate';
    quantityScale: number;
  };
  provenanceIds: string[];
};
/** Company rules never appear in the reusable product mapping pack. */
export type CompanyRules = {
  contractVersion: 1; id: string; version: string; packHash: Digest;
  company: string; branches: string[]; taxRegistrations: string[]; timezone: string;
  currencies: Record<string, { scale: number }>;
  units: Record<string, { canonical: string; numerator: string; denominator: string }>;
  period: { from: string; to: string }; provenanceIds: string[];
};
export type DatasetManifest = {
  contractVersion: 1; id: string; title: string;
  origin: 'synthetic' | 'official-public' | 'authorized-upload';
  category: 'reference-schema' | 'business-books' | 'configuration-family' | 'synthetic-cases';
  source: { publisher: string; url: string | null; retrievedAt: string; productVersion: string };
  rights: {
    status: 'allowed' | 'discovery-only' | 'denied'; license: string;
    evidence: string; permittedUses: Array<'qualification' | 'redistribution'>;
    personalData: 'none' | 'redacted' | 'unreviewed';
    permissions: { acquisition: 'allowed' | 'unknown' | 'denied'; reuse: 'allowed' | 'unknown' | 'denied'; redistribution: 'allowed' | 'unknown' | 'denied'; training: 'allowed' | 'unknown' | 'denied' };
  };
  artifacts: Array<{ path: string; sha256: Digest; role: 'source-rows' | 'source-report' | 'golden-cases' | 'schema-reference' | 'authorization' }>;
  limitations: string[];
};
export type SourceRow = Record<string, string | boolean | null>;
export type SourceBatch = {
  receiptId: string; datasetId: string; system: string; product: MappingPack['product'];
  company: string; schema: SourceSchema; rows: SourceRow[]; rowsHash: Digest;
  complete: boolean; snapshotId: string;
  origins: { business: string; template: string; configuration: string };
};
export type ControlTotal = { kind: SemanticKind; currency: string; netMinor: string; taxMinor: string; grossMinor: string };
export type SourceReport = {
  reportId: string; datasetId: string; origin: 'independent-source-report';
  captureMethod: 'hand-worked-synthetic' | 'upstream-report'; evidenceHash: Digest;
  company: string; system: string; snapshotId: string; dateBasis: string;
  period: CompanyRules['period']; branches: string[]; taxRegistrations: string[];
  sourceRowCount: number; includedRowCount: number; excludedRowCount: number;
  totals: ControlTotal[];
};
export type CanonicalFact = {
  entityId: string; kind: SemanticKind; date: string; company: string; branch: string;
  taxRegistration: string; currency: string; currencyScale: number;
  netMinor: string; taxMinor: string; grossMinor: string;
  quantity: string; unit: string; relatedIdentity: string | null;
  source: { receiptId: string; row: number; rowsHash: Digest; schemaHash: Digest };
};
export type Exclusion = { entityId: string; row: number; reason: string };
export type SemanticIssue = { code: string; message: string; row?: number; field?: string };
export type CompiledMapping = { compilerVersion: string; compilerBuildHash: Digest; pack: MappingPack; rules: CompanyRules; ontology: OntologyContract; packHash: Digest; rulesHash: Digest; ontologyHash: Digest; schemaHash: Digest; productFingerprint: Digest; fingerprint: Digest };
export type MappingResult = { decision: 'mapped' | 'abstained' | 'invalidated'; facts: CanonicalFact[]; exclusions: Exclusion[]; issues: SemanticIssue[]; sourceRowCount: number; controls: ControlTotal[] };
export type SplitPlan = {
  contractVersion: 1; id: string; mappingFingerprint: Digest; reviewer: string;
  tuning: Array<{ businessId: string; datasetId: string; rowsHash: Digest; origins: SourceBatch['origins'] }>;
  holdout: Array<{ businessId: string; datasetId: string; rowsHash: Digest; origins: SourceBatch['origins'] }>;
  disclosure: 'public-synthetic' | 'sealed-authorized'; evidence: string;
};
export type OperationExpectation = { operation: OperationId; values: Array<{ currency: string; minor: string }> };
export type GoldenSemanticAssertion = Omit<CanonicalFact,'source'> & { sourceRow: number };
export type GoldenCase = {
  id: string; businessId: string; datasetId: string; rationale: string;
  split: 'tuning' | 'holdout'; expectedDecision: 'qualified' | 'abstained' | 'invalidated';
  expectedIssueCodes: string[]; expectations: OperationExpectation[];
  semanticAssertions: GoldenSemanticAssertion[]; exclusionAssertions: Exclusion[];
};
export type OperationEvidence = {
  contractVersion: 1; id: Digest; previousHash: Digest | null; at: string;
  operation: OperationId; caseId: string; businessId: string; datasetId: string;
  decision: 'qualified' | 'abstained' | 'invalidated'; qualification: 'synthetic-qualified' | 'scoped-evidence' | 'unqualified';
  scope: { system: string; product: MappingPack['product']; company: string; period: CompanyRules['period']; branches: string[]; taxRegistrations: string[]; currencies: string[]; snapshotId: string };
  compilerVersion: string; compilerBuildHash: Digest; mappingFingerprint: Digest; packHash: Digest; rulesHash: Digest;
  ontologyHash: Digest; schemaHash: Digest; sourceReceiptId: string; rowsHash: Digest;
  sourceReportId: string; sourceReportHash: Digest; manifestHash: Digest; splitPlanHash: Digest;
  goldenCaseHash: Digest; values: Array<{ currency: string; minor: string }>;
  countedRows: number[]; exclusions: Exclusion[]; controlTotals: ControlTotal[];
  issues: SemanticIssue[]; question: string | null;
  liveVerified: false; arbitraryCompanyGuarantee: false; writebackQualified: false;
};
