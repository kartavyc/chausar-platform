import type { State } from '../../contracts.ts';
import type { BlueprintRecord, CountryProfile, InvoiceRecord, VentureRecord } from '../contracts.ts';
import { listRecords } from '../records.ts';

/** Older immutable plans inherit the profile saved at the first country change. */
export function blueprintCountry(venture: VentureRecord, blueprint?: BlueprintRecord | null): CountryProfile {
  return blueprint?.country ?? venture.originalCountry ?? venture.country;
}

export function invoiceCountry(state: State, venture: VentureRecord, invoice: Pick<InvoiceRecord, 'priceReceiptId'>): CountryProfile {
  const receipt = listRecords(state, 'venture-price-receipt', venture.id).find(item => item.id === invoice.priceReceiptId);
  const blueprint = receipt && listRecords(state, 'venture-blueprint', venture.id).find(item => item.digest === receipt.inputs.blueprintDigest);
  return blueprintCountry(venture, blueprint);
}
