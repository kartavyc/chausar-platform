// How tax applies to one price: the owner's own settings, the client and the place of supply.
// India splits GST into CGST and SGST inside one state, IGST across states, and zero-rates an export
// only after the owner confirms an LUT. Other countries charge one tax at the owner's rate.
import { check } from '../../contracts.ts';
import { bpsPercent } from '../records.ts';
import { INDIA_STATES } from '../contracts.ts';
import type { BackOffice, BpsString, ClientRecord, CountryCode, CountryProfile, TaxTreatment } from '../contracts.ts';

export type TaxDecision = {
  treatment: TaxTreatment;
  /** The rate the arithmetic uses: '0' when no tax applies. */
  rateBps: BpsString;
  /** True when India's CGST and SGST split was chosen because the client's or the owner's state is unknown. */
  stateAssumed: boolean;
};

function countryCode(country: CountryProfile | CountryCode): CountryCode {
  return typeof country === 'string' ? country : country.code;
}

/** The full decision: treatment, the rate used, and whether the place of supply was assumed. */
export function taxDecision(backOffice: BackOffice, client: ClientRecord | null, country: CountryProfile | CountryCode): TaxDecision {
  if (!backOffice.taxRegistered.value || backOffice.taxRateBps === '0') return { treatment: 'none', rateBps: '0', stateAssumed: false };
  const rateBps = backOffice.taxRateBps;
  if (countryCode(country) !== 'IN' || client === null) return { treatment: 'single', rateBps, stateAssumed: false };
  if (client.countryCode !== null && client.countryCode !== 'IN') return { treatment: backOffice.lutConfirmed ? 'zero-rated-lut' : 'igst', rateBps, stateAssumed: false };
  if (client.stateCode !== null && backOffice.taxState !== null && client.stateCode !== backOffice.taxState) return { treatment: 'igst', rateBps, stateAssumed: false };
  return { treatment: 'cgst-sgst', rateBps, stateAssumed: client.stateCode === null || backOffice.taxState === null };
}

/**
 * Not registered or a zero rate: 'none'. Outside India: 'single'. India with no client (an offer quote): 'single'.
 * India with a foreign client: 'zero-rated-lut' once the LUT is confirmed, else 'igst'. India with two known,
 * different states: 'igst'. Otherwise 'cgst-sgst' (an unknown state is taken as the owner's own).
 */
export function taxTreatmentFor(backOffice: BackOffice, client: ClientRecord | null, country: CountryProfile | CountryCode): TaxTreatment {
  return taxDecision(backOffice, client, country).treatment;
}

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
