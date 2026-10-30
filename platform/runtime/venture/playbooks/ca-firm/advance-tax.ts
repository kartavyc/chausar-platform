// CA5 advance tax. Original implementation; opentax-engine (AGPL) supplied the idea, no code copied.
// Shares and threshold verified: https://www.incometaxindia.gov.in/documents/d/guest/faq-on-advance-tax (27 October 2026).
import { check } from '../../../contracts.ts';
import { interestTable } from './interest.ts';
import { useRateTable, REHEARSAL, type RateUse, type AgeBand } from './rates.ts';
import { ReceiptBuilder } from './receipt.ts';
import { applyBps, paise, maxBig } from './money.ts';
import { requireFacts, type FactField } from './needs-facts.ts';
export type AdvanceInput = {
    financialYear: string;
    estimate: {
        taxMinor: string;
        tdsMinor: string;
        tcsMinor: string;
        reliefMinor: string;
        residency: 'resident' | 'non-resident';
        ageBand: AgeBand;
        hasBusinessIncome: boolean;
        presumptive: boolean;
    };
};
/** Client estimates remain assumptions even though the instalments are code-computed and receipted. */
export function advanceTax(input: AdvanceInput, use: RateUse = REHEARSAL) {
    check(input && ['2025-26', '2026-27'].includes(input.financialYear), 'RATE_TABLE_STALE', 'No dated advance-tax rules cover this financial year.');
    const e = input.estimate;
    const fields: Record<string, FactField> = { taxMinor: 'taxEstimate', tdsMinor: 'taxCredits', tcsMinor: 'taxCredits', reliefMinor: 'taxCredits', residency: 'residency', ageBand: 'ageBand', hasBusinessIncome: 'businessIncome', presumptive: 'presumptive' };
    requireFacts('advance tax', [...new Set(Object.entries(fields).filter(([key]) => !e || e[key as keyof typeof e] === undefined || e[key as keyof typeof e] === null).map(([, field]) => field))].map(field => ({ field })));
    check(['resident', 'non-resident'].includes(e.residency) && ['below-60', '60-79', '80-plus'].includes(e.ageBand) && typeof e.hasBusinessIncome === 'boolean' && typeof e.presumptive === 'boolean', 'TAX_INPUT_INVALID', 'Give residency, age band and explicit business and presumptive facts.');
    check(!e.presumptive || e.hasBusinessIncome, 'TAX_INPUT_INVALID', 'Presumptive treatment requires business or professional income.');
    const table = interestTable(input.financialYear === '2025-26' ? '2026-27' : '2027-28'), stamp = useRateTable(table, use), builder = new ReceiptBuilder('advance-tax');
    builder.useTable(table, stamp);
    for (const key of ['advance-tax-exempt', 'advance-tax-threshold', 'installments'])
        builder.cite(table.sections.find(section => section.key === key) ?? null);
    builder.assume('These instalments use the client\'s own tax and credit estimate. This is an assumption, not an established income or tax fact.');
    const net = maxBig(0n, paise(e.taxMinor, 'Client estimated annual tax') - paise(e.tdsMinor, 'Estimated TDS') - paise(e.tcsMinor, 'Estimated TCS') - paise(e.reliefMinor, 'Estimated relief'));
    builder.step('estimated-net-tax', 'Client estimate after expected credits', net);
    const exempt = e.residency === 'resident' && e.ageBand !== 'below-60' && !e.hasBusinessIncome;
    const due = !exempt && net >= BigInt(table.payload.advanceTaxThresholdMinor);
    const rows = due ? (e.presumptive ? table.payload.presumptiveInstallments : table.payload.installments) : [];
    const instalments = rows.map((row, index) => { const amount = applyBps(net, BigInt(row.shareBps)); builder.step('instalment-' + (index + 1), 'Cumulative advance tax by ' + row.by, amount, table.sections.find(section => section.key === 'installments') ?? null); return { by: row.by, shareBps: row.shareBps, requiredMinor: String(amount), basis: 'client-estimate' as const }; });
    const reason = exempt ? 'Resident senior citizen without business income.' : !due ? 'Estimated tax after credits is below the dated advance-tax threshold.' : 'Cumulative shares of the estimated annual tax after credits.';
    return builder.build(input, { instalments, reason, source: 'https://www.incometaxindia.gov.in/documents/d/guest/faq-on-advance-tax' }, reason);
}
