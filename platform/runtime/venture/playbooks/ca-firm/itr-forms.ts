// CA3 ITR selection: first-match dated rows. itr-prep-skill (MIT), ideas only; rules from official 2026-27 FAQs.
import { check } from '../../../contracts.ts';
import { requireFacts, type FactField } from './needs-facts.ts';
import type { CitationUse } from './citations.ts';
export const ITR_SOURCES = { itr1: 'https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/ITR1-FAQ', itr4: 'https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/itr%204-faqs' };
export const ITR_YEARS = [{ assessmentYear: '2026-27', validFrom: '2026-04-01', validTo: '2027-03-31', verification: 'Official AY 2026-27 instructions checked on 27 October 2026.' }, { assessmentYear: '2027-28', validFrom: '2027-04-01', validTo: '2028-03-31', verification: 'not verified, needs CA confirmation' }] as const;
export const FORM_EXCLUSIONS = ['foreign-assets', 'foreign-income', 'foreign-signing-authority', 'director', 'unlisted-shares', 'deferred-esop-tax', 'tds-194n', 'brought-forward-loss', 'carry-forward-loss', 'special-rate-income', 'lottery', 'racehorses', 'portuguese-civil-code'] as const;
const REQUIRED = ['entity', 'residency', 'totalIncomeMinor', 'houseProperties', 'hasBusinessIncome', 'presumptive', 'capitalGains', 'capitalGainsMinor', 'agricultureMinor', 'exclusions', 'regimeLastYear', 'wantedRegime', 'switchedBack'];
const minor = (v: unknown) => typeof v === 'string' && /^\d{1,18}$/.test(v);
/** Derive only explicit categories already in generic typed tables. This is not a Form 16 or AIS reader. */
export function formIntake(facts: Record<string, unknown>, tables: readonly {
    columns: string[];
    rows: {
        cells: Record<string, string>;
    }[];
}[] = []) {
    const derived = { ...facts };
    if (!Array.isArray(derived.incomeKinds)) {
        const kinds = new Set<string>();
        for (const table of tables)
            for (const row of table.rows) {
                const category = Object.entries(row.cells).find(([key]) => /^(?:category|income kind)$/i.test(key))?.[1]?.trim().toLowerCase();
                if (category && ['salary', 'house-property', 'business', 'capital-gains', 'other'].includes(category))
                    kinds.add(category);
            }
        if (kinds.size)
            derived.incomeKinds = [...kinds];
    }
    const questions = [
        { field: 'incomeKinds', question: 'Which kinds of income did you have?', why: 'The return form depends on all of your income sources.', round: 1 },
        { field: 'residency', question: 'Were you ordinarily resident, not ordinarily resident, or non-resident in India?', why: 'Some simple return forms are only for ordinarily resident taxpayers.', round: 1 },
        { field: 'hasBusinessIncome', question: 'Did you earn from a business or profession?', why: 'Business income changes both the form and the regime switching rules.', round: 1 },
        { field: 'regimeLastYear', question: 'Which tax regime did you use last year?', why: 'Past choices can limit a business taxpayer switching regimes.', round: 1 },
        { field: 'exclusions', question: 'Ask your CA to check the form exclusion list for your circumstances.', why: 'Foreign interests, losses and special income can rule out the simpler forms.', round: 2 },
        { field: 'switchedBack', question: 'Have you already switched from the old regime back to the new regime?', why: 'Business taxpayers normally get only one switch back.', round: 2 },
    ].filter(row => derived[row.field] === undefined || derived[row.field] === null);
    return { facts: derived, questions };
}
/** Choose the first applicable form; unsupported years and absent facts are never guessed. */
export function chooseItrForm(input: {
    assessmentYear: string;
    facts: Record<string, unknown>;
}, use: CitationUse) {
    const year = ITR_YEARS.find(row => row.assessmentYear === input.assessmentYear);
    check(year, 'RATE_TABLE_STALE', 'No dated form rules cover this assessment year. Ask your CA.');
    check(use.mode === 'rehearsal' || use.confirmedBy, 'CITATIONS_UNCONFIRMED', 'Your CA must confirm the dated form and regime rules before client work.');
    const f = input.facts;
    check(f && typeof f === 'object' && !Array.isArray(f), 'TAX_INPUT_INVALID', 'Send the client facts.');
    const fieldOf: Record<string, FactField> = { entity: 'entity', residency: 'residency', totalIncomeMinor: 'totalIncome', houseProperties: 'houseProperties', hasBusinessIncome: 'businessIncome', presumptive: 'presumptive', capitalGains: 'capitalGains', capitalGainsMinor: 'capitalGains', agricultureMinor: 'agriculture', exclusions: 'formExclusions', regimeLastYear: 'regimeHistory', wantedRegime: 'regimeHistory', switchedBack: 'regimeHistory' };
    requireFacts('ITR form choice', [...new Set(REQUIRED.filter(key => f[key] === undefined || f[key] === null).map(key => fieldOf[key]))].map(field => ({ field })));
    check(['individual', 'huf', 'firm'].includes(String(f.entity)), 'NOT_MODELLED', 'This chooser handles individuals, HUFs and firms other than LLPs. Your CA chooses other forms.');
    check(['resident', 'rnor', 'non-resident'].includes(String(f.residency)) && minor(f.totalIncomeMinor) && minor(f.capitalGainsMinor) && minor(f.agricultureMinor), 'TAX_INPUT_INVALID', 'Give residency and non-negative amounts in paise.');
    check(Number.isInteger(f.houseProperties) && Number(f.houseProperties) >= 0 && Number(f.houseProperties) <= 100 && typeof f.hasBusinessIncome === 'boolean' && typeof f.presumptive === 'boolean' && typeof f.switchedBack === 'boolean', 'TAX_INPUT_INVALID', 'Give house count and explicit business, presumptive and switching facts.');
    check(['none', '112A', 'other'].includes(String(f.capitalGains)) && ['old', 'new'].includes(String(f.regimeLastYear)) && ['old', 'new'].includes(String(f.wantedRegime)), 'TAX_INPUT_INVALID', 'Give the capital gain kind and both regime choices.');
    check(Array.isArray(f.exclusions) && f.exclusions.every(value => FORM_EXCLUSIONS.includes(value as typeof FORM_EXCLUSIONS[number])), 'TAX_INPUT_INVALID', 'Choose exclusions from the dated eligibility checklist.');
    check(f.capitalGains !== 'none' || BigInt(f.capitalGainsMinor as string) === 0n, 'TAX_INPUT_INVALID', 'A positive capital gain cannot be labelled none. Ask the client to clarify.');
    check(!f.presumptive || f.hasBusinessIncome, 'TAX_INPUT_INVALID', 'Presumptive treatment requires business or professional income.');
    const simple = f.residency === 'resident' && BigInt(f.totalIncomeMinor as string) <= 500000000n && Number(f.houseProperties) <= 2 && BigInt(f.agricultureMinor as string) <= 500000n && (f.capitalGains === 'none' || f.capitalGains === '112A' && BigInt(f.capitalGainsMinor as string) <= 12500000n) && f.exclusions.length === 0;
    const rows = [
        { id: 'itr1', form: 'ITR-1', matches: f.entity === 'individual' && !f.hasBusinessIncome && simple, source: ITR_SOURCES.itr1 },
        { id: 'itr4', form: 'ITR-4', matches: f.hasBusinessIncome && f.presumptive && simple, source: ITR_SOURCES.itr4 },
        { id: 'itr2', form: 'ITR-2', matches: f.entity !== 'firm' && !f.hasBusinessIncome, source: 'https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/file-itr-2-online' },
        { id: 'itr3', form: 'ITR-3', matches: f.entity !== 'firm' && f.hasBusinessIncome, source: 'https://www.incometax.gov.in/iec/foportal/downloads' },
    ];
    const chosen = rows.find(row => row.matches);
    check(chosen, 'NOT_MODELLED', 'This firm does not qualify for ITR-4. Your CA must choose the appropriate return.');
    const allowed = !(f.hasBusinessIncome && f.switchedBack && f.wantedRegime === 'old');
    const form = f.hasBusinessIncome && f.wantedRegime !== f.regimeLastYear ? 'Form 10-IEA' : null;
    return { form: chosen.form, rowId: chosen.id, assessmentYear: year.assessmentYear, verification: year.verification, source: chosen.source, confirmedBy: use.confirmedBy, regime: { allowed, form, source: ITR_SOURCES.itr4, note: allowed ? (form ? 'The CA checks the form and statutory due date. Chausar does not file it.' : 'The CA checks the stated history before the client files.') : 'After switching back to new, a taxpayer with business income cannot opt for old again.' } };
}
