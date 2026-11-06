/**
 * The fake engine's spend leads (4Z3), as the engine's money/spend.ts works them out: which currency leads spend (the
 * owner's choice, or on Auto rupees for a business in India once a rupee rate is set), a lead figure with never more
 * than two decimals of dollars, and the other currency beneath it at the owner's rate. The UI computes none of this.
 */

import { EngineError, type CurrencyLead, type SpendLead } from './types';

/** The owner's choices, as the engine's CURRENCY_LEADS; anything else is refused in the engine's words. */
export function currencyLeadOf(value: unknown): CurrencyLead {
  if (value === 'auto' || value === 'inr' || value === 'usd') return value;
  throw new EngineError('INVALID_VENTURE_REQUEST', 'Which currency leads is auto (by where your business is), inr (rupees first) or usd (dollars first).');
}

/** Whether rupees lead (when a rate is set): the owner's choice, or on Auto, a business in India (every sample is). */
export function rupeesLead(choice: CurrencyLead, countryCode = 'IN'): boolean {
  return choice === 'inr' || (choice === 'auto' && countryCode === 'IN');
}

/** Dollars for a lead figure: micro-dollars to cents, a half cent up; above zero but under a cent reads so. */
export function dollarsLead(micros: number | string | bigint): string {
  const value = BigInt(micros);
  const cents = (value + 5_000n) / 10_000n;
  if (value > 0n && cents === 0n) return 'under USD 0.01';
  return `USD ${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

/** Micro-dollars as rupees at a rate in ten-thousandths, to the nearest paisa, a half paisa up ('₹60.10'). */
function rupeeFigure(micros: bigint, perUsd: bigint): string {
  const paise = (micros * perUsd + 50_000_000n) / 100_000_000n;
  return `₹${(paise / 100n).toLocaleString('en-IN')}.${String(paise % 100n).padStart(2, '0')}`;
}

/** A spend figure as it leads, as the engine's spendLead: `perUsd` null when no rate is set (dollars alone). */
export function spendLead(micros: number | string | bigint, perUsd: bigint | null, leads: boolean, words = '', before = ''): SpendLead {
  const value = BigInt(micros);
  const dollars = dollarsLead(value);
  if (perUsd === null) return { currency: 'USD', figure: before + dollars + words };
  const rate = `₹${(perUsd / 10_000n).toLocaleString('en-IN')}.${String(perUsd % 10_000n).padStart(4, '0').replace(/0+$/, '').padEnd(2, '0')} per $1`;
  const inr = rupeeFigure(value, perUsd);
  return leads
    ? { currency: 'INR', figure: before + inr + words, beside: `${dollars} at ${rate}`, other: dollars }
    : { currency: 'USD', figure: before + dollars + words, beside: `${inr} at ${rate}`, other: inr };
}

/** A typed rate ('83.50') in ten-thousandths of a rupee, or null. */
export function perUsdOf(typed: string | null | undefined): bigint | null {
  if (!typed) return null;
  const [whole = '0', fraction = ''] = typed.split('.');
  return BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0').slice(0, 4));
}

/** The owner's rupee rate as the spend settings say it: ten-thousandths of a rupee, and its words with the day it was set. */
export interface SampleRate { perUsd: bigint; words: string }

/** The owner's rate and currency choice as venture.spend.policy.get says them now; no rate and Auto when unread. */
export function spendSettings(ask: () => unknown): { rate: SampleRate | null; choice: CurrencyLead } {
  try {
    const policy = ask() as { inrPerUsd?: string | null; rupeeRate?: string | null; currencyLead?: CurrencyLead };
    const perUsd = policy.rupeeRate ? perUsdOf(policy.inrPerUsd) : null;
    return { rate: perUsd !== null && policy.rupeeRate ? { perUsd, words: policy.rupeeRate } : null, choice: policy.currencyLead ?? 'auto' };
  } catch {
    return { rate: null, choice: 'auto' };
  }
}

/** '₹60.10 at ₹83.50 per $1 (your rate, set 15 Oct 2026)', as the engine's rupeesBeside. */
export function rupeesAt(micros: number | string | bigint, rate: SampleRate): string {
  return `${rupeeAmount(BigInt(micros), rate.perUsd)} at ${rate.words}`;
}

/** Micro-dollars as rupees at a rate, as the engine's rupeeFigure ('₹18.00'). */
export function rupeeAmount(micros: number | string | bigint, perUsd: bigint): string {
  return rupeeFigure(BigInt(micros), perUsd);
}
