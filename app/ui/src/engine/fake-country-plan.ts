import { countryProfile } from '../../../../platform/shared/venture/core/countries.ts';
import type { BlueprintLite } from './types';

/** Mirrors the native country reset. No old price is converted into another currency. */
export function resetCountry(plan: BlueprintLite, code: string, beforeCode?: string): void {
  const country = countryProfile(code);
  const oldRail = plan.backOffice.paymentRail;
  const previousRails = beforeCode ? countryProfile(beforeCode).paymentRails : [oldRail];
  const paymentRail = country.paymentRails[0]!;
  const invoicePrefix = (plan.backOffice as { invoicePrefix?: string }).invoicePrefix ?? 'INV';
  plan.country = country;
  plan.backOffice = {
    currency: country.currency, taxLabel: country.tax.label,
    taxRegistered: { value: false, label: 'assumption', by: 'engine' }, taxRateBps: '0', taxState: null,
    lutConfirmed: false, invoiceKind: country.tax.invoiceKind, taxInvoiceReady: false, taxInvoiceMissing: [],
    paymentRail,
    ...{ taxMode: country.tax.mode, taxRateBy: 'not-registered', taxId: null, sacCode: null, invoicePrefix },
  };
  plan.starterConnectorIds = [...new Set(plan.starterConnectorIds.map(id => previousRails.includes(id) ? paymentRail : id))];
  for (const offer of plan.offers) offer.pricing = {
    model: offer.pricing.model, quantityUnit: offer.pricing.quantityUnit,
    unitPriceMinor: null, unitPriceLabel: 'not-set', defaultQuantity: '1',
  };
}
