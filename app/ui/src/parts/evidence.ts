import type { RunStep } from '../engine/types';

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
