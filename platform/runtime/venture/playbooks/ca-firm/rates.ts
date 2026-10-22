// AI-native CA firm: Indian tax rates as versioned data. A rate change lands as a new version with its own validity
// window and citations, never as an edit, so an old receipt can always be worked again from the table it used. Every
// table, and every section it names, needs the CA's confirmation: a real client's working refuses a version the CA
// has not confirmed, and a rehearsal runs on it but says it is unconfirmed on each receipt.
//
// Nobody in this build has checked these figures against the sources: citations carry checkedOn: null until the CA
// does. Section numbers are data, not prose, because of the open question below.
//
// Ideas taken, code written here: Invaro/opentax-engine (AGPL-3.0, ideas only) for rules with a version, a citation and
// a half-open validity window; NidheeshJain/itr-prep-skill (MIT) for the rules-verification idea, reshaped as rows a
// CA confirms rather than numbers a model looks up.
import { ChausarError } from '../../../contracts.ts';
import { digest } from '../../records.ts';
import type { IsoDate } from './money.ts';

export const RENUMBERING_QUESTION = 'Open question for the CA: does the Income-tax Act, 2025 renumber these sections from 1 April 2026? '
  + 'This working cites the Income-tax Act, 1961, which governs income of the financial year 2025-26 (assessment year 2026-27). '
  + 'A CA confirms each section reference before it appears in a client document.';
export const GST_RATE_QUESTION = 'Open question for the CA: the rate for each HSN or SAC code after 22 September 2025 follows the rate changes '
  + 'agreed at the 56th GST Council meeting. A CA confirms the rate list and the rate each client line uses.';
/** Questions this playbook keeps visible and does not answer. */
export const OPEN_QUESTIONS: readonly string[] = Object.freeze([RENUMBERING_QUESTION, GST_RATE_QUESTION]);

export type RateTableKind = 'income-tax' | 'income-tax-interest' | 'gst-rates' | 'tds-sections';
/** checkedOn stays null until a CA checks the source; the URL is where to look, not proof that anyone looked. */
export type Citation = { source: string; part: string | null; url: string | null; checkedOn: null; note: string | null };
export type SectionRef = { key: string; act: string; section: string; title: string; needsCaConfirmation: true };
export type RateTable<P = unknown> = {
  id: string;
  kind: RateTableKind;
  title: string;
  version: number;
  /** Half-open window: validFrom is the first day it applies, validTo the first day it no longer does. */
  validFrom: IsoDate;
  validTo: IsoDate | null;
  appliesTo: string;
  citations: Citation[];
  sections: SectionRef[];
  needsCaConfirmation: true;
  openQuestions: string[];
  payload: P;
};

export type AgeBand = 'below-60' | '60-79' | '80-plus';
export type Slab = { fromMinor: string; toMinor: string | null; rateBps: string };
/** capMinor null: no cap. A deduction missing from the map is not allowed in that regime. */
export type DeductionRule = { capMinor: string | null; capByAge?: Partial<Record<AgeBand, string>>; seniorOnly?: true; notForSenior?: true; title: string };
export type RegimeRates = {
  slabs: Record<AgeBand, Slab[]>;
  standardDeductionMinor: string;
  professionalTaxCapMinor: string | null; // null: not allowed in this regime
  rebate: { incomeLimitMinor: string; maxMinor: string; marginalRelief: boolean };
  surcharge: { aboveMinor: string; rateBps: string }[];
  deductions: Record<string, DeductionRule>;
};
export type IncomeTaxPayload = {
  assessmentYear: string;
  previousYear: string;
  regimes: { new: RegimeRates; old: RegimeRates };
  cessBps: string;
  presumptive: {
    '44AD': { digitalBps: string; otherBps: string; limitMinor: string; raisedLimitMinor: string; cashShareMaxBps: string };
    '44ADA': { rateBps: string; limitMinor: string; raisedLimitMinor: string; cashShareMaxBps: string };
  };
  /** Deductions this engine refuses: they go to the CA. */
  notModelledDeductions: string[];
};
export type InterestPayload = {
  assessmentYear: string;
  yearStart: IsoDate;
  dueDate: IsoDate;
  ratePerMonthBps: string;
  roundDownMinor: string;
  advanceTaxThresholdMinor: string;
  shortfallShareBps: string;
  installments: { by: IsoDate; shareBps: string; toleranceBps: string | null; months: number }[];
  presumptiveInstallments: { by: IsoDate; shareBps: string; toleranceBps: string | null; months: number }[];
};
export type GstRatesPayload = { ratesBps: string[]; b2clThresholdMinor: string; note: string };
export type TdsThreshold =
  | { kind: 'year'; amountMinor: string }
  | { kind: 'single-or-year'; singleMinor: string; yearMinor: string }
  | { kind: 'month'; amountMinor: string };
export type TdsSectionRate = { code: string; section: string; title: string; individualBps: string; otherBps: string; threshold: TdsThreshold };
export type TdsPayload = {
  financialYear: string;
  sections: TdsSectionRate[];
  noPanMultiplier: string;
  noPanFloorBps: string;
  depositDayNextMonth: number;
  marchDepositDue: string; // MM-DD of the next calendar year
};

const RUPEES = (rupees: number) => String(BigInt(rupees) * 100n);
const IT_1961 = 'Income-tax Act, 1961';
const section = (key: string, act: string, number: string, title: string): SectionRef => ({ key, act, section: number, title, needsCaConfirmation: true });
const cite = (source: string, part: string | null, url: string | null, note: string | null = null): Citation => ({ source, part, url, checkedOn: null, note });
const INCOME_TAX_SITE = 'https://incometaxindia.gov.in';
const GST_SITE = 'https://cbic-gst.gov.in';

const NEW_SLABS: Slab[] = [
  { fromMinor: '0', toMinor: RUPEES(4_00_000), rateBps: '0' },
  { fromMinor: RUPEES(4_00_000), toMinor: RUPEES(8_00_000), rateBps: '500' },
  { fromMinor: RUPEES(8_00_000), toMinor: RUPEES(12_00_000), rateBps: '1000' },
  { fromMinor: RUPEES(12_00_000), toMinor: RUPEES(16_00_000), rateBps: '1500' },
  { fromMinor: RUPEES(16_00_000), toMinor: RUPEES(20_00_000), rateBps: '2000' },
  { fromMinor: RUPEES(20_00_000), toMinor: RUPEES(24_00_000), rateBps: '2500' },
  { fromMinor: RUPEES(24_00_000), toMinor: null, rateBps: '3000' },
];
const oldSlabs = (exempt: number): Slab[] => [
  { fromMinor: '0', toMinor: RUPEES(exempt), rateBps: '0' },
  ...(exempt < 5_00_000 ? [{ fromMinor: RUPEES(exempt), toMinor: RUPEES(5_00_000), rateBps: '500' }] : []),
  { fromMinor: RUPEES(5_00_000), toMinor: RUPEES(10_00_000), rateBps: '2000' },
  { fromMinor: RUPEES(10_00_000), toMinor: null, rateBps: '3000' },
];

const INCOME_TAX_AY_2026_27: RateTable<IncomeTaxPayload> = {
  id: 'in-income-tax-ay-2026-27',
  kind: 'income-tax',
  title: 'Income tax slabs, rebate, surcharge and cess for assessment year 2026-27',
  version: 1,
  validFrom: '2025-04-01',
  validTo: '2026-04-01',
  appliesTo: 'Income earned from 1 April 2025 to 31 March 2026 by an individual, returned for assessment year 2026-27.',
  citations: [
    cite('Finance Act, 2025', 'Section 115BAC(1A) as amended, the new regime slabs; First Schedule, Part III, rates for the financial year 2025-26', INCOME_TAX_SITE),
    cite('Finance Act, 2026', 'First Schedule, Part I, rates for assessment year 2026-27', INCOME_TAX_SITE, 'The CA confirms that Part I repeats the Part III rates used here.'),
    cite(IT_1961, 'Sections 16, 80C to 80U, 87A, 288A and 288B', INCOME_TAX_SITE),
    cite(IT_1961, 'Sections 44AD and 44ADA, presumptive income', INCOME_TAX_SITE),
  ],
  sections: [
    section('new-regime', IT_1961, '115BAC', 'Tax on income of individuals under the new regime'),
    section('standard-deduction', IT_1961, '16(ia)', 'Standard deduction from salary'),
    section('professional-tax', IT_1961, '16(iii)', 'Tax on employment'),
    section('presumptive-business', IT_1961, '44AD', 'Presumptive income of a small business'),
    section('presumptive-profession', IT_1961, '44ADA', 'Presumptive income of a profession'),
    section('deduction-80C', IT_1961, '80C', 'Deduction for listed savings and payments'),
    section('deduction-80CCD(1B)', IT_1961, '80CCD(1B)', 'Deduction for the National Pension System'),
    section('deduction-80D', IT_1961, '80D', 'Deduction for health insurance'),
    section('deduction-80E', IT_1961, '80E', 'Deduction for interest on an education loan'),
    section('deduction-80TTA', IT_1961, '80TTA', 'Deduction for savings bank interest'),
    section('deduction-80TTB', IT_1961, '80TTB', 'Deduction for deposit interest of a senior citizen'),
    section('rebate', IT_1961, '87A', 'Rebate for a resident individual'),
    section('rounding-income', IT_1961, '288A', 'Rounding of total income'),
    section('rounding-tax', IT_1961, '288B', 'Rounding of tax'),
  ],
  needsCaConfirmation: true,
  openQuestions: [RENUMBERING_QUESTION],
  payload: {
    assessmentYear: '2026-27',
    previousYear: '2025-26',
    regimes: {
      new: {
        slabs: { 'below-60': NEW_SLABS, '60-79': NEW_SLABS, '80-plus': NEW_SLABS },
        standardDeductionMinor: RUPEES(75_000),
        professionalTaxCapMinor: null,
        rebate: { incomeLimitMinor: RUPEES(12_00_000), maxMinor: RUPEES(60_000), marginalRelief: true },
        surcharge: [
          { aboveMinor: RUPEES(50_00_000), rateBps: '1000' }, { aboveMinor: RUPEES(1_00_00_000), rateBps: '1500' }, { aboveMinor: RUPEES(2_00_00_000), rateBps: '2500' },
        ],
        deductions: {},
      },
      old: {
        slabs: { 'below-60': oldSlabs(2_50_000), '60-79': oldSlabs(3_00_000), '80-plus': oldSlabs(5_00_000) },
        standardDeductionMinor: RUPEES(50_000),
        professionalTaxCapMinor: RUPEES(2_500),
        rebate: { incomeLimitMinor: RUPEES(5_00_000), maxMinor: RUPEES(12_500), marginalRelief: false },
        surcharge: [
          { aboveMinor: RUPEES(50_00_000), rateBps: '1000' }, { aboveMinor: RUPEES(1_00_00_000), rateBps: '1500' },
          { aboveMinor: RUPEES(2_00_00_000), rateBps: '2500' }, { aboveMinor: RUPEES(5_00_00_000), rateBps: '3700' },
        ],
        deductions: {
          '80C': { capMinor: RUPEES(1_50_000), title: 'Listed savings and payments' },
          '80CCD(1B)': { capMinor: RUPEES(50_000), title: 'National Pension System, own extra contribution' },
          '80D-self': { capMinor: RUPEES(25_000), capByAge: { '60-79': RUPEES(50_000), '80-plus': RUPEES(50_000) }, title: 'Health insurance for self and family' },
          '80D-parents': { capMinor: RUPEES(25_000), title: 'Health insurance for parents below sixty' },
          '80D-parents-senior': { capMinor: RUPEES(50_000), title: 'Health insurance for parents aged sixty or more' },
          '80E': { capMinor: null, title: 'Interest on an education loan' },
          '80TTA': { capMinor: RUPEES(10_000), notForSenior: true, title: 'Savings bank interest' },
          '80TTB': { capMinor: RUPEES(50_000), seniorOnly: true, title: 'Deposit interest of a senior citizen' },
        },
      },
    },
    cessBps: '400',
    presumptive: {
      '44AD': { digitalBps: '600', otherBps: '800', limitMinor: RUPEES(2_00_00_000), raisedLimitMinor: RUPEES(3_00_00_000), cashShareMaxBps: '500' },
      '44ADA': { rateBps: '5000', limitMinor: RUPEES(50_00_000), raisedLimitMinor: RUPEES(75_00_000), cashShareMaxBps: '500' },
    },
    notModelledDeductions: ['80CCD(2)', '80G', '80GG', '80GGC', '80U', '80DD', '80DDB', '80EEA', '80EEB', '80CCH'],
  },
};

const INTEREST_AY_2026_27: RateTable<InterestPayload> = {
  id: 'in-income-tax-interest-ay-2026-27',
  kind: 'income-tax-interest',
  title: 'Interest for late filing and short advance tax, assessment year 2026-27',
  version: 1,
  validFrom: '2025-04-01',
  validTo: '2026-04-01',
  appliesTo: 'Interest on tax for income of the financial year 2025-26, for an individual whose accounts need no audit.',
  citations: [
    cite(IT_1961, 'Sections 139(1), 207, 208, 211, 234A, 234B and 234C', INCOME_TAX_SITE),
    cite('Income-tax Rules, 1962', 'Rule 119A, rounding of the amount interest is charged on', INCOME_TAX_SITE),
  ],
  sections: [
    section('due-date', IT_1961, '139(1)', 'Due date of the return'),
    section('advance-tax-exempt', IT_1961, '207(2)', 'Resident senior citizen with no business income'),
    section('advance-tax-threshold', IT_1961, '208', 'When advance tax is payable'),
    section('installments', IT_1961, '211', 'Advance tax instalments'),
    section('interest-234a', IT_1961, '234A', 'Interest for a late return'),
    section('interest-234b', IT_1961, '234B', 'Interest for short advance tax'),
    section('interest-234c', IT_1961, '234C', 'Interest for deferred advance tax'),
  ],
  needsCaConfirmation: true,
  openQuestions: [RENUMBERING_QUESTION, 'The due date may be extended by the CBDT for the year; the CA confirms the due date used.'],
  payload: {
    assessmentYear: '2026-27',
    yearStart: '2026-04-01',
    dueDate: '2026-07-31',
    ratePerMonthBps: '100',
    roundDownMinor: RUPEES(100),
    advanceTaxThresholdMinor: RUPEES(10_000),
    shortfallShareBps: '9000',
    installments: [
      { by: '2025-06-15', shareBps: '1500', toleranceBps: '1200', months: 3 },
      { by: '2025-09-15', shareBps: '4500', toleranceBps: '3600', months: 3 },
      { by: '2025-12-15', shareBps: '7500', toleranceBps: null, months: 3 },
      { by: '2026-03-15', shareBps: '10000', toleranceBps: null, months: 1 },
    ],
    presumptiveInstallments: [{ by: '2026-03-15', shareBps: '10000', toleranceBps: null, months: 1 }],
  },
};

const GST_SECTIONS = [
  section('levy-intra', 'Central Goods and Services Tax Act, 2017', '9', 'CGST on supplies within a state'),
  section('levy-inter', 'Integrated Goods and Services Tax Act, 2017', '5', 'IGST on supplies between states'),
  section('place-of-supply', 'Integrated Goods and Services Tax Act, 2017', '10 to 13', 'Place of supply'),
  section('credit', 'Central Goods and Services Tax Act, 2017', '16', 'Eligibility for input tax credit'),
  section('blocked-credit', 'Central Goods and Services Tax Act, 2017', '17(5)', 'Credit that is blocked'),
  section('utilisation', 'Central Goods and Services Tax Act, 2017', '49', 'Payment from the electronic credit ledger'),
  section('utilisation-order', 'Central Goods and Services Tax Act, 2017', '49A', 'IGST credit used first'),
  section('utilisation-rule', 'Central Goods and Services Tax Rules, 2017', '88A', 'Order of using credit'),
];

const GST_V1: RateTable<GstRatesPayload> = {
  id: 'in-gst-rates',
  kind: 'gst-rates',
  title: 'GST rates and the GSTR-1 large invoice threshold',
  version: 1,
  validFrom: '2024-08-01',
  validTo: '2025-09-22',
  appliesTo: 'Supplies invoiced from 1 August 2024 to 21 September 2025.',
  citations: [
    cite('CGST and IGST rate notifications of 28 June 2017, as amended', 'Schedules of rates for goods and services', GST_SITE),
    cite('GSTR-1 instructions, as amended from 1 August 2024', 'Invoices to unregistered buyers between states above one lakh rupees go in B2CL', GST_SITE),
  ],
  sections: GST_SECTIONS,
  needsCaConfirmation: true,
  openQuestions: [GST_RATE_QUESTION],
  payload: {
    ratesBps: ['0', '10', '25', '150', '300', '500', '1200', '1800', '2800'],
    b2clThresholdMinor: RUPEES(1_00_000),
    note: 'Rates below five percent apply to listed goods such as gold, diamonds and goods sold to merchant exporters; the CA confirms the HSN.',
  },
};

const GST_V2: RateTable<GstRatesPayload> = {
  ...GST_V1,
  version: 2,
  validFrom: '2025-09-22',
  validTo: null,
  appliesTo: 'Supplies invoiced on or after 22 September 2025.',
  citations: [
    cite('CGST and IGST rate notifications issued after the 56th GST Council meeting of 3 September 2025', 'Rates from 22 September 2025: the twelve and twenty-eight percent rates folded into five and eighteen, and a forty percent rate added', GST_SITE),
    cite('GSTR-1 instructions, as amended from 1 August 2024', 'Invoices to unregistered buyers between states above one lakh rupees go in B2CL', GST_SITE),
  ],
  payload: {
    ratesBps: ['0', '10', '25', '150', '300', '500', '1800', '2800', '4000'],
    b2clThresholdMinor: RUPEES(1_00_000),
    note: 'Twenty-eight percent stays only for tobacco and related goods until the compensation cess ends; the CA confirms the HSN.',
  },
};

const TDS_FY_2025_26: RateTable<TdsPayload> = {
  id: 'in-tds-fy-2025-26',
  kind: 'tds-sections',
  title: 'TDS rates and thresholds for common sections, financial year 2025-26',
  version: 1,
  validFrom: '2025-04-01',
  validTo: '2026-04-01',
  appliesTo: 'Payments made or credited from 1 April 2025 to 31 March 2026 by a business that must deduct tax.',
  citations: [
    cite(IT_1961, 'Sections 194A, 194C, 194H, 194I, 194J, 194T and 206AA, thresholds as amended by the Finance Act, 2025', INCOME_TAX_SITE),
    cite('Income-tax Rules, 1962', 'Rule 30, time for paying tax deducted into the government account', INCOME_TAX_SITE),
  ],
  sections: [
    section('tds-194A', IT_1961, '194A', 'Interest other than on securities'),
    section('tds-194C', IT_1961, '194C', 'Payments to contractors'),
    section('tds-194H', IT_1961, '194H', 'Commission or brokerage'),
    section('tds-194I', IT_1961, '194I', 'Rent'),
    section('tds-194J', IT_1961, '194J', 'Fees for professional or technical services'),
    section('tds-194T', IT_1961, '194T', 'Payments by a firm to its partners'),
    section('no-pan', IT_1961, '206AA', 'Higher rate when the payee gives no PAN'),
    section('deposit', 'Income-tax Rules, 1962', '30', 'Due date for paying tax deducted'),
  ],
  needsCaConfirmation: true,
  openQuestions: [RENUMBERING_QUESTION],
  payload: {
    financialYear: '2025-26',
    sections: [
      { code: '194A', section: '194A', title: 'Interest from a payer that is not a bank', individualBps: '1000', otherBps: '1000', threshold: { kind: 'year', amountMinor: RUPEES(10_000) } },
      { code: '194C', section: '194C', title: 'Payments to contractors', individualBps: '100', otherBps: '200', threshold: { kind: 'single-or-year', singleMinor: RUPEES(30_000), yearMinor: RUPEES(1_00_000) } },
      { code: '194H', section: '194H', title: 'Commission or brokerage', individualBps: '200', otherBps: '200', threshold: { kind: 'year', amountMinor: RUPEES(20_000) } },
      { code: '194I-building', section: '194I', title: 'Rent of land, building or furniture', individualBps: '1000', otherBps: '1000', threshold: { kind: 'month', amountMinor: RUPEES(50_000) } },
      { code: '194I-plant', section: '194I', title: 'Rent of plant or machinery', individualBps: '200', otherBps: '200', threshold: { kind: 'month', amountMinor: RUPEES(50_000) } },
      { code: '194J-professional', section: '194J', title: 'Fees for professional services', individualBps: '1000', otherBps: '1000', threshold: { kind: 'year', amountMinor: RUPEES(50_000) } },
      { code: '194J-technical', section: '194J', title: 'Fees for technical services', individualBps: '200', otherBps: '200', threshold: { kind: 'year', amountMinor: RUPEES(50_000) } },
      { code: '194T', section: '194T', title: 'Salary, commission or interest paid by a firm to a partner', individualBps: '1000', otherBps: '1000', threshold: { kind: 'year', amountMinor: RUPEES(20_000) } },
    ],
    noPanMultiplier: '2',
    noPanFloorBps: '2000',
    depositDayNextMonth: 7,
    marchDepositDue: '04-30',
  },
};

export const RATE_TABLES: readonly RateTable[] = Object.freeze([INCOME_TAX_AY_2026_27, INTEREST_AY_2026_27, GST_V1, GST_V2, TDS_FY_2025_26] as RateTable[]);

const KINDS: readonly RateTableKind[] = ['income-tax', 'income-tax-interest', 'gst-rates', 'tds-sections'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The content a CA confirms: the whole table, so any change to a figure, a window or a citation is a new hash. */
export function rateTableHash(table: RateTable): string {
  return digest(table);
}

/** Tables are well formed, every version is flagged for the CA, and two versions of one table never overlap. */
export function validateRateTables(tables: readonly RateTable[]): void {
  const seen = new Set<string>();
  for (const table of tables) {
    const name = `${table.id} version ${table.version}`;
    if (!/^in-[a-z0-9-]+$/.test(table.id) || !Number.isInteger(table.version) || table.version < 1) throw new Error(`The rate table ${name} needs an id and a whole version.`);
    if (seen.has(name)) throw new Error(`The rate table ${name} is listed twice.`);
    seen.add(name);
    if (!KINDS.includes(table.kind)) throw new Error(`The rate table ${name} has an unknown kind.`);
    if (!DATE.test(table.validFrom) || (table.validTo !== null && (!DATE.test(table.validTo) || table.validTo <= table.validFrom))) throw new Error(`The rate table ${name} has a bad window.`);
    if (!table.citations.length || table.citations.some(item => !item.source || item.checkedOn !== null)) throw new Error(`The rate table ${name} needs citations nobody has marked checked.`);
    if (table.needsCaConfirmation !== true || table.sections.some(item => item.needsCaConfirmation !== true)) throw new Error(`The rate table ${name} must be flagged for the CA's confirmation.`);
    if (table.payload === null || typeof table.payload !== 'object') throw new Error(`The rate table ${name} has no rates.`);
  }
  for (const table of tables) {
    for (const other of tables) {
      if (other === table || other.id !== table.id) continue;
      const endsAfterStart = other.validTo === null || other.validTo > table.validFrom;
      const startsBeforeEnd = table.validTo === null || other.validFrom < table.validTo;
      if (endsAfterStart && startsBeforeEnd) throw new Error(`The rate table ${table.id} has versions ${table.version} and ${other.version} that overlap.`);
    }
  }
}

/** The one table of a kind whose window holds the date; RATE_TABLE_MISSING when none does. */
export function rateTableFor<P = unknown>(kind: RateTableKind, on: IsoDate, tables: readonly RateTable[] = RATE_TABLES): RateTable<P> {
  const found = tables.filter(table => table.kind === kind && table.validFrom <= on && (table.validTo === null || on < table.validTo));
  if (found.length !== 1) throw new ChausarError('RATE_TABLE_MISSING', `No ${kind} rate table covers ${on}. A CA adds a new version before this work can be done.`);
  return found[0] as RateTable<P>;
}

export type RateConfirmation = { tableId: string; version: number; hash: string; caName: string; membershipNumber: string; at: string };
/** 'client': real work for a real client, which needs the CA's confirmation of the exact version. 'rehearsal': practice. */
export type RateUse = { mode: 'rehearsal' | 'client'; confirmations: readonly RateConfirmation[] };
export const REHEARSAL: RateUse = Object.freeze({ mode: 'rehearsal', confirmations: Object.freeze([]) as readonly RateConfirmation[] });
export type TableStamp = {
  id: string; version: number; hash: string; title: string; validFrom: IsoDate; validTo: IsoDate | null;
  confirmed: boolean; confirmedBy: string | null; needsCaConfirmation: true;
};

export function confirmationFor(table: RateTable, confirmations: readonly RateConfirmation[]): RateConfirmation | null {
  const hash = rateTableHash(table);
  return confirmations.find(item => item.tableId === table.id && item.version === table.version && item.hash === hash) ?? null;
}

/** The stamp a receipt carries for a table. A real client's work refuses a version the CA has not confirmed. */
export function useRateTable(table: RateTable, use: RateUse = REHEARSAL): TableStamp {
  const confirmation = confirmationFor(table, use.confirmations);
  if (use.mode === 'client' && !confirmation) {
    throw new ChausarError('RATE_UNCONFIRMED', `Your CA has not confirmed "${table.title}" (version ${table.version}). It can be used in rehearsal only until they do.`);
  }
  return {
    id: table.id, version: table.version, hash: rateTableHash(table), title: table.title, validFrom: table.validFrom, validTo: table.validTo,
    confirmed: !!confirmation, confirmedBy: confirmation ? `${confirmation.caName} (ICAI ${confirmation.membershipNumber})` : null, needsCaConfirmation: true,
  };
}

/** A table's section reference by key. */
export function sectionOf(table: RateTable, key: string): SectionRef {
  const found = table.sections.find(item => item.key === key);
  if (!found) throw new Error(`The rate table ${table.id} has no section ${key}.`);
  return found;
}
