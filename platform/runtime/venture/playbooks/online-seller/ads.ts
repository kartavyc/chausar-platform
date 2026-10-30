// Chausar seller ads: sealeap-amazon-skills ideas (MIT), no copied code.
import { computeAds, type EconomicsResult } from './model.ts';
import { sellerCall } from './economics.ts';
/** Recomputes ACOS and compares the report, with a basis-matched break-even only. */
export function diagnoseAds(input: unknown, economics?: EconomicsResult) { return sellerCall(() => computeAds(input, economics)); }
