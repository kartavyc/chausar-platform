// Existing tax treatment decision, shared without native state or transport dependencies.
import type {TaxTreatment} from './price-types.ts';
export type TaxSettings={taxRegistered:{value:boolean};taxRateBps:string;taxState:string|null;lutConfirmed:boolean};
export type TaxClient={countryCode:string|null;stateCode:string|null};
export type TaxCountry={code:string};
export type TaxDecision = {
  treatment: TaxTreatment;
  /** The rate the arithmetic uses: '0' when no tax applies. */
  rateBps: string;
  /** True when India's CGST and SGST split was chosen because the client's or the owner's state is unknown. */
  stateAssumed: boolean;
};

function countryCode(country: TaxCountry | string): string {
  return typeof country === 'string' ? country : country.code;
}

/** The full decision: treatment, the rate used, and whether the place of supply was assumed. */
export function taxDecision(backOffice: TaxSettings, client: TaxClient | null, country: TaxCountry | string): TaxDecision {
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
export function taxTreatmentFor(backOffice: TaxSettings, client: TaxClient | null, country: TaxCountry | string): TaxTreatment {
  return taxDecision(backOffice, client, country).treatment;
}
