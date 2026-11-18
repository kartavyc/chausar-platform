// The kinds of evidence a run's step can name (views/runs.ts builds them, and nothing else may). Browser safe, with no
// import: the app reads this list to say what each kind opens (app/ui/src/parts/evidence.ts), so a kind added here
// without a place to open fails the app's typecheck and its test, and never opens an empty panel.
//   file: a file the run read (an upload's id, labelled with its name).
//   work-receipt: the receipt of a figure code worked out (venture.work.get).
//   work-table: a table a tool made. delegate-run: what a heavy-work tool left. Neither has a read of its own yet.
//   price-receipt: the order's price receipt (venture.receipt.get).
//   draft: the run's own draft (the run's id).
//   check: a check's result, in words.
export const RUN_EVIDENCE_KINDS = Object.freeze(['file', 'work-receipt', 'work-table', 'delegate-run', 'price-receipt', 'draft', 'check'] as const);
export type RunEvidenceKind = typeof RUN_EVIDENCE_KINDS[number];
export type RunEvidence = { kind: RunEvidenceKind; id: string; label: string };
