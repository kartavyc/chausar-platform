// Chausar flagship playbook: the CA firm's wave 5 records and methods' shapes (Ink v2 wave 5, packages 5C1 and 5C2).
// Package 5-0 named each as a placeholder; the package replaces it here, never in contracts.ts. Types only. Written for
// Chausar; nothing here is learned from an outside source.

/** venture-ca-citations: the citations table and its confirmation, a placeholder until 5C1 lands. */
export type CaCitationsView = { version: number; tableHash: string; rows: import('./citations.ts').CitationRow[]; rules: { id: string; title: string; assessmentYear: string; validFrom: string; validTo: string; verification: string; source: string }[]; confirmedBy: import('./citations.ts').CitationConfirmation | null };
export type CaCitationsBody = { version: number; tableHash: string; confirmedBy: { name: string; membershipNumber: string; at: string } };
/** venture-ca-differential: one case captured from the department's calculator, a placeholder until 5C2 lands. */
export type CaDifferentialBody = { name: string; inputs: Record<string, unknown>; outputs: Record<string,string>; capturedBy: string; membershipNumber: string; capturedAt: string };
/** venture-ca-data-pack: the ITR data pack, held encrypted, a placeholder until 5C2 lands. */
export type CaDataPackBody = { clientId:string; facts:import('./pack-core.ts').PackFacts; receiptId:string; exportApprovals:string[] };
/** venture.ca.confirmCitations's answer (5C1). */
export type CitationsConfirmView = CaCitationsBody;
/** venture.ca.signoff.get's answer: same, or the first difference (5C1). */
export type SignoffCheckView = { id: string; ca: { name: string; membershipNumber: string }; at: string; decision: 'signed' | 'returned'; playbookHash: string | null; workingDigest: string; receipts: { id: string; digest: string | null }[]; rederived: 'same' | 'differs'; differs: { key: string; line: string } | null };
/** venture.ca.differential.add's answer (5C2). */
export type DifferentialAddView = CaDifferentialBody & { id: string };
/** venture.ca.dataPack.export's answer (5C2). */
export type DataPackExportView = { name:string; mime:string; contentBase64:string; digest:string; approvalDigest:string };
