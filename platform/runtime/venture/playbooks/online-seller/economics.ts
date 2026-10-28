// Chausar seller economics: independent implementation of commerce.md; sealeap ideas (MIT), no copied code.
import { ChausarError } from '../../../contracts.ts';
import { computeUnitEconomics, computeBreakEven, type EconomicsResult, type SellerUse, type SalesBasis } from './model.ts';
export type { EconomicsInput, EconomicsResult, SellerEvidence, SellerRate, SellerUse, SalesBasis } from './model.ts';
/** Adapts browser-safe domain refusals to the engine's common error contract. */
export function sellerCall<T>(call: () => T): T {
  try { return call(); } catch (error) {
    const e = error as Error & { code?: string; missing?: unknown };
    if (e.code) throw Object.assign(new ChausarError(e.code, e.message), e.missing ? { missing: e.missing, details: { missing: e.missing } } : {});
    throw error;
  }
}
/** Code-computed contribution, payout and GST cash from evidenced inputs. */
export function unitEconomics(input: unknown, use: SellerUse): EconomicsResult { return sellerCall(() => computeUnitEconomics(input, use)); }
/** Code-computed break-even after the owner identifies the report's sales basis. */
export function breakEvenAcos(result: EconomicsResult, basis: SalesBasis | null) { return sellerCall(() => computeBreakEven(result, basis)); }
