/**
 * Stage-two boundary. The Engine creates this projection only from current,
 * admitted tool results. It is not an RPC input or qualification assertion.
 * Exact amounts, dates and underlying provenance identifiers stay in the host.
 */
export type SynthesisRef = string;
export type SynthesisTool = 'business.describe' | 'calculator.calculate';

export type SynthesisClaim = {
  kind: 'claim'; ref: SynthesisRef; resultRef: SynthesisRef; text: string;
  origin: 'workspace-metadata' | 'published-definition' | 'source-observation' | 'owner-told' | 'draft-assumption';
  qualification: 'metadata-only' | 'unqualified-observation' | 'evidence-qualified' | 'owner-stated' | 'draft';
  citationRefs: SynthesisRef[];
};
export type SynthesisFigure = {
  kind: 'figure'; ref: SynthesisRef; resultRef: SynthesisRef; label: string;
  unit: 'money' | 'basis-points'; currency?: string;
};
export type SynthesisScope = { kind: 'scope'; ref: SynthesisRef; resultRef: SynthesisRef; label: string };
/** The final UI renders every required caution from the admitted local result. */
export type SynthesisCaution = {
  kind: 'caution'; ref: SynthesisRef; resultRef: SynthesisRef; code: string; label: string; required: true;
};
export type SynthesisEvidence = SynthesisClaim | SynthesisFigure | SynthesisScope | SynthesisCaution;

export type GroundedToolSummary = {
  schemaVersion: 1;
  /** Exact reviewed objective; any retained continuation text needs disclosure. */
  question: string;
  results: { ref: SynthesisRef; tool: SynthesisTool; status: 'ok' | 'partial' | 'unavailable'; evidenceRefs: SynthesisRef[] }[];
  evidence: SynthesisEvidence[];
  /** Opaque references only; full BusinessCitation objects remain local. */
  citationRefs: SynthesisRef[];
};

export type SynthesisPart = { kind: 'text'; text: string } | { kind: 'slot'; ref: SynthesisRef };
export type GroundedSynthesisOutput = {
  schemaVersion: 1;
  paragraphs: { parts: SynthesisPart[]; evidenceRefs: SynthesisRef[] }[];
  /** Must retain every required caution; this cannot override local rendering. */
  cautionRefs: SynthesisRef[];
};

/** Local only: never serialize this binding into a provider request. */
export type SynthesisLocalEvidence = {
  ref: SynthesisRef; resultRef: SynthesisRef; answerId: string; evidenceHash: string; renderText: string;
  receiptId?: string; figureKey?: string; citationIds?: string[];
};
export type ConversationSynthesisBinding = {
  toolTurnId: string; plannerModelReceiptId: string;
  toolResultsDigest: string; inputDigest: string; evidence: SynthesisLocalEvidence[];
};

/** Pure worker boundary. Transport, approval, authority and persistence are host-owned. */
export type SynthesisCurrentTextResolver = (ref: SynthesisRef) => string;
