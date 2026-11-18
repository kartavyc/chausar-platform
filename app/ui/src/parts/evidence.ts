import type { RunEvidenceKind, RunStep } from '../engine/types';

type Evidence = NonNullable<RunStep['evidence']>[number];

/**
 * A rules-judge check the judge did not settle is not a failure: no vote was backed by checked evidence, so nothing was
 * checked. The engine writes it as "Failed: Not settled: ..."; the sheet says "Not checked" and keeps the engine's words.
 */
export function evidenceLabel(item: Evidence, notChecked: (detail: string) => string): string {
  if (item.kind !== 'check' || item.id !== 'rules-judge') return item.label;
  const unsettled = /^Failed:\s*(Not settled\b[\s\S]*)$/.exec(item.label);
  return unsettled ? notChecked(unsettled[1]!) : item.label;
}

/**
 * The sheet that shows each kind of evidence the engine names (views/run-evidence.ts), or null where there is nothing
 * more to read than the words themselves. Every kind is listed, so a new one cannot be forgotten: an evidence link once
 * opened `?sheet=<its own kind>`, and for a file (and, on the real engine, a price receipt) that was no sheet at all, so
 * the panel said only "This can't be shown here."
 *   file: the upload, in the file sheet. work-receipt: its own sheet. price-receipt: the receipt sheet.
 *   draft: the run's draft (the id is the run's). check: a result in words. work-table and delegate-run: the engine has
 *   no read for a tool's table or for what a heavy-work tool left, so they are words, not links, until it has one.
 */
const OPENS: Readonly<Record<RunEvidenceKind, string | null>> = {
  file: 'file', 'work-receipt': 'work-receipt', 'price-receipt': 'receipt', draft: 'draft', 'work-table': null, 'delegate-run': null, check: null,
};

/** Where a piece of evidence opens (`?sheet=<kind>:<id>`), or null when it is words with nothing to open. */
export function evidenceSheet(item: Evidence): { kind: string; id: string } | null {
  const kind = OPENS[item.kind];
  return kind ? { kind, id: item.id } : null;
}
