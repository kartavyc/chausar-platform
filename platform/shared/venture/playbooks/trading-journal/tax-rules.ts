// Chausar playbook: trading journal (wave 6, 6E7 / D49). The income-tax rules the tax pack names, versioned by year:
// financial year 2025-26 under the Income-tax Act 1961, and tax year 2026-27 under the Income-tax Act 2025 (in force from
// 1 April 2026). Each rule carries its section, its source and how it was read. These are rule labels for the owner's
// CA, never advice: the pack shows computed figures with the rule each one rests on. Read on 1 November 2026. Pure data.
// Written for Chausar.

export type RuleRead = 'official' | 'secondary' | 'unchecked';
export type TaxRule = { section: string; words: string; source: string; read: RuleRead };
export type TaxYearRules = {
  id: 'fy-2025-26' | 'ty-2026-27'; label: string; act: string; from: string; to: string;
  speculative: TaxRule; nonSpeculative: TaxRule; holding: TaxRule & { months: number };
  stcg: TaxRule & { rateBps: number }; ltcg: TaxRule & { rateBps: number; exemptionMinor: string };
  grandfather: TaxRule & { fmvDay: string }; turnover: TaxRule;
};

export const TAX_RULES_READ_ON = '2026-11-01';
const ICAI: TaxRule = { section: 'ICAI Guidance Note on Tax Audit', words: 'Turnover for futures, options and intraday trades is the total of profits and losses on each squared off trade, counted without their sign.',
  source: 'https://taxguru.in/income-tax/methodology-determining-turnover-f-o-transactions.html', read: 'unchecked' };

export const TAX_YEARS: readonly TaxYearRules[] = Object.freeze([
  { id: 'fy-2025-26', label: 'Financial year 2025-26 (assessment year 2026-27)', act: 'Income-tax Act 1961', from: '2025-04-01', to: '2026-03-31',
    speculative: { section: '43(5)', words: 'Equity bought and sold on the same day without delivery is a speculative transaction.', source: 'https://wm.incometaxindia.gov.in/web/guest/w/section-43-64', read: 'official' },
    nonSpeculative: { section: '43(5) proviso (d)', words: 'Futures and options traded on a recognised exchange are not speculative; they are business income.', source: 'https://wm.incometaxindia.gov.in/web/guest/w/section-43-64', read: 'official' },
    holding: { section: '2(42A)', words: 'Listed shares held for more than twelve months are long term.', source: 'https://wm.incometaxindia.gov.in/web/guest/w/section-2-1', read: 'secondary', months: 12 },
    stcg: { section: '111A', words: 'Short-term gains on listed equity with securities transaction tax paid, at the rate shown for transfers on or after 23 July 2024.', source: 'https://incometaxindia.gov.in/w/section-111a', read: 'official', rateBps: 2000 },
    ltcg: { section: '112A', words: 'Long-term gains on listed equity with securities transaction tax paid, above the yearly limit, at the rate shown.', source: 'https://wm.incometaxindia.gov.in/web/guest/w/section-31-118', read: 'official', rateBps: 1250, exemptionMinor: '12500000' },
    grandfather: { section: '55(2)(ac)', words: 'For shares bought before 1 February 2018, cost is the higher of the actual cost and the lower of the fair market value on 31 January 2018 and the sale value.', source: 'https://wm.incometaxindia.gov.in/web/guest/w/section-90-114', read: 'secondary', fmvDay: '2018-01-31' },
    turnover: ICAI },
  { id: 'ty-2026-27', label: 'Tax year 2026-27', act: 'Income-tax Act 2025', from: '2026-04-01', to: '2027-03-31',
    speculative: { section: '66(31) and 26(3)', words: 'A speculative transaction excludes a specified derivative; speculation business is kept apart from other business.', source: 'https://wm.incometaxindia.gov.in/web/guest/w/section-66-126', read: 'official' },
    nonSpeculative: { section: '66(33)', words: 'A specified derivative transaction on a recognised exchange is not speculative; it is business income.', source: 'https://wm.incometaxindia.gov.in/web/guest/w/section-66-126', read: 'official' },
    holding: { section: '2(101)', words: 'Listed securities held for more than twelve months are long term.', source: 'https://wm.incometaxindia.gov.in/web/guest/w/section-2-1', read: 'official', months: 12 },
    stcg: { section: '196', words: 'Short-term gains on equity chargeable to securities transaction tax, at the rate shown.', source: 'https://incometaxindia.gov.in/w/section-196-78', read: 'official', rateBps: 2000 },
    ltcg: { section: '198', words: 'Long-term gains on equity chargeable to securities transaction tax, above the yearly limit, at the rate shown.', source: 'https://incometaxindia.gov.in/w/section-198-76', read: 'official', rateBps: 1250, exemptionMinor: '12500000' },
    grandfather: { section: '90(7) and 90(8)(b)', words: 'For equity bought before 1 February 2018, cost is the higher of the actual cost and the lower of the fair market value on 31 January 2018 and the sale value.', source: 'https://wm.incometaxindia.gov.in/web/guest/w/section-90-114', read: 'official', fmvDay: '2018-01-31' },
    turnover: ICAI },
]);

export function taxYearOf(day: string): TaxYearRules | null {
  return TAX_YEARS.find(year => day >= year.from && day <= year.to) ?? null;
}
export function taxYearById(id: unknown): TaxYearRules | null {
  return TAX_YEARS.find(year => year.id === id) ?? null;
}
export const CHECK_WITH_CA = 'Check with your CA. These figures are computed from your tradebook by Chausar; they are not tax advice and not a filed return.';
