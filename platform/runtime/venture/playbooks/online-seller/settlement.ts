// Chausar settlement audit, sealeap-amazon-skills ideas (MIT), no source code copied.
import { computeSettlements } from './model.ts';
import { sellerCall } from './economics.ts';
/** Splits differences using source-backed reasons; never records a receivable or submits a claim. */
export function auditSettlements(input: unknown) { return sellerCall(() => computeSettlements(input)); }
