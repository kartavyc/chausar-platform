// How tax applies to one price: the owner's own settings, the client and the place of supply.
// India splits GST into CGST and SGST inside one state, IGST across states, and zero-rates an export
// only after the owner confirms an LUT. Other countries charge one tax at the owner's rate.
import { check } from '../../contracts.ts';
import { bpsPercent } from '../records.ts';
import { INDIA_STATES } from '../contracts.ts';
import type { BackOffice, BpsString, ClientRecord, CountryCode, CountryProfile, TaxTreatment } from '../contracts.ts';

import {taxDecision,type TaxDecision} from './tax-decision.ts';
export {taxDecision,taxTreatmentFor,type TaxDecision} from './tax-decision.ts';

/** Half of a basis-point rate as percent text, by BigInt, with up to three decimals: '1800' gives '9', '25' gives '0.125'. */
export function halfRatePercent(bps: BpsString): string {
  check(/^\d{1,5}$/.test(bps), 'INVALID_TAX_RATE', 'A tax rate must be whole basis points.');
  const thousandths = BigInt(bps) * 5n; // bps / 200 percent, in thousandths of a percent
  const whole = thousandths / 1000n, fraction = thousandths % 1000n;
  if (fraction === 0n) return String(whole);
  return `${whole}.${String(fraction).padStart(3, '0').replace(/0+$/, '')}`;
}

/** Half of a basis-point rate as exact decimal text: '1800' gives '900', '25' gives '12.5'. */
export function halfRateBps(bps: BpsString): string {
  check(/^\d{1,5}$/.test(bps), 'INVALID_TAX_RATE', 'A tax rate must be whole basis points.');
  const value = BigInt(bps);
  return value % 2n === 0n ? String(value / 2n) : `${value / 2n}.5`;
}

/** Full rate as percent text: '1800' gives '18', '825' gives '8.25'. */
export function ratePercent(bps: BpsString): string {
  return bpsPercent(bps);
}

/** 'Maharashtra (27)' for a known India state code, else null. */
export function stateName(code: string | null): string | null {
  if (code === null || !Object.hasOwn(INDIA_STATES, code)) return null;
  return `${INDIA_STATES[code]} (${code})`;
}
