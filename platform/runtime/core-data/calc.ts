import type { MethodSpec } from '../modules/types.ts';
import { registerRateSource } from '../calculator.ts';
import { peekRates } from '../work-books/books-rates.ts';
import { bankTotals, gst2bReceipt, gstr3bTurnover } from './calc-connectors.ts';

/**
 * The calculator part of core-data. At load it registers work-books' owner-entered rate table (`books.setRate`) as
 * the calculator's one exchange-rate reader (BK-19); the calculator itself imports no lane. The methods issue
 * calculator receipts for the connector pages and the GSTR-2B match (RP-02, AS-19); see `calc-connectors.ts`.
 */
registerRateSource(state => peekRates(state));

export const calcMethods: Record<string, MethodSpec> = {
  'coredata.bankTotals': { permission: 'read', handler: bankTotals },
  'coredata.gstr3bTurnover': { permission: 'read', handler: gstr3bTurnover },
  'coredata.gst2bReceipt': { permission: 'read', handler: gst2bReceipt },
};
