// AI-native CA firm: income tax for an individual, from the versioned rate table, in BigInt paise. Salary with the
// standard deduction, other income at slab rates, presumptive business income (44AD, 44ADA), capped deductions,
// total income rounded under 288A, slab tax, the 87A rebate with its marginal relief, surcharge with marginal relief,
// cess, and the liability rounded under 288B. The model never does this arithmetic: an agent picks the inputs from
// the client's documents and says why; this code answers with a receipt, or refuses what it does not model.
//
// Ideas taken, code written here: NidheeshJain/itr-prep-skill (MIT) for the order of the tax stack; Invaro/
// opentax-engine (AGPL-3.0, ideas only) for refusing loudly when a case is not modelled.
import { ChausarError } from '../../../portable.ts';
import {
  applyBps, invalid, minBig, maxBig, notModelled, optionalPaise, paise, round288, sumBig, inr,
} from './money.ts';
import { rateTableFor, sectionOf, useRateTable, REHEARSAL, type AgeBand, type IncomeTaxPayload, type RateTable, type RateUse, type RegimeRates, type Slab } from './rates.ts';
import { ReceiptBuilder, type CaReceipt } from './receipt.ts';
import { absent, requireFacts } from './needs-facts.ts';

export type Presumptive =
  | { scheme: '44AD'; digitalReceiptsMinor: string; cashReceiptsMinor: string }
  | { scheme: '44ADA'; grossReceiptsMinor: string; cashReceiptsMinor: string };
export type NotModelledIncome = 'capital-gains' | 'house-property' | 'foreign-income' | 'agricultural-income' | 'lottery-or-winnings' | 'virtual-digital-assets';
export type IncomeTaxInput = {
  assessmentYear: '2026-27' | '2027-28';
  regime: 'new' | 'old';
  residency: 'resident' | 'non-resident';
  ageBand: AgeBand;
  /** Taxable salary after exempt allowances, as on Form 16, before the standard deduction. */
  salaryMinor?: string;
  professionalTaxMinor?: string;
  /** Interest and other income taxed at slab rates. */
  otherSlabIncomeMinor?: string;
  /** Business or professional profit worked out from the books. Use presumptive instead for 44AD or 44ADA. */
  businessIncomeMinor?: string;
  presumptive?: Presumptive;
  deductions?: { code: string; claimedMinor: string }[];
  /** Incomes the client has that this engine does not model: the CA works them. */
  alsoHas?: NotModelledIncome[];
  /** Tax already paid, for the balance. */
  prepaid?: { tdsMinor?: string; tcsMinor?: string; advanceTaxMinor?: string };
};
export type IncomeTaxWorking = { regime: 'new' | 'old'; assessmentYear: string; ageBand: AgeBand; residency: 'resident' | 'non-resident'; slabs: { fromMinor: string; toMinor: string | null; rateBps: string; taxMinor: string }[] };

const AGE_BANDS: readonly AgeBand[] = ['below-60', '60-79', '80-plus'];
const NOT_MODELLED_INCOMES: readonly NotModelledIncome[] = ['capital-gains', 'house-property', 'foreign-income', 'agricultural-income', 'lottery-or-winnings', 'virtual-digital-assets'];
const INCOME_WORDS: Readonly<Record<NotModelledIncome, string>> = {
  'capital-gains': 'capital gains', 'house-property': 'income from house property', 'foreign-income': 'foreign income',
  'agricultural-income': 'agricultural income', 'lottery-or-winnings': 'lottery or other winnings', 'virtual-digital-assets': 'virtual digital assets',
};

/** The first day of the previous year for an assessment year: '2026-27' gives '2025-04-01'. */
export function previousYearStart(assessmentYear: string): string {
  if (typeof assessmentYear !== 'string' || !/^\d{4}-\d{2}$/.test(assessmentYear)) invalid('The assessment year is written like 2026-27.');
  const first = Number(assessmentYear.slice(0, 4));
  if ((first + 1) % 100 !== Number(assessmentYear.slice(5))) invalid('The assessment year is written like 2026-27.');
  return `${first - 1}-04-01`;
}

/** The income-tax table for an assessment year, checked to be that year's. */
export function incomeTaxTable(assessmentYear: string): RateTable<IncomeTaxPayload> {
  const table = rateTableFor<IncomeTaxPayload>('income-tax', previousYearStart(assessmentYear));
  if (table.payload.assessmentYear !== assessmentYear) throw new ChausarError('RATE_TABLE_MISSING', `No income-tax rate table is kept for assessment year ${assessmentYear}.`);
  return table;
}

/** Tax on an income by slabs, half-up to the paisa per slab. */
export function slabTax(income: bigint, slabs: readonly Slab[]): { total: bigint; rows: IncomeTaxWorking['slabs'] } {
  const rows: IncomeTaxWorking['slabs'] = [];
  for (const slab of slabs) {
    const from = BigInt(slab.fromMinor);
    const to = slab.toMinor === null ? null : BigInt(slab.toMinor);
    const top = to === null ? income : minBig(income, to);
    const portion = maxBig(0n, top - from);
    rows.push({ fromMinor: slab.fromMinor, toMinor: slab.toMinor, rateBps: slab.rateBps, taxMinor: String(applyBps(portion, BigInt(slab.rateBps))) });
  }
  return { total: sumBig(rows.map(row => BigInt(row.taxMinor))), rows };
}

function deductionSection(table: RateTable, code: string) {
  const key = code.startsWith('80D') ? 'deduction-80D' : `deduction-${code}`;
  return table.sections.find(item => item.key === key) ?? null;
}

function presumptiveIncome(builder: ReceiptBuilder, table: RateTable<IncomeTaxPayload>, presumptive: Presumptive): bigint {
  const rates = table.payload.presumptive;
  if (presumptive.scheme === '44AD') {
    const digital = paise(presumptive.digitalReceiptsMinor, 'Digital receipts');
    const cash = paise(presumptive.cashReceiptsMinor, 'Cash receipts');
    const total = digital + cash;
    const raised = cash * 10000n <= total * BigInt(rates['44AD'].cashShareMaxBps);
    const limit = BigInt(raised ? rates['44AD'].raisedLimitMinor : rates['44AD'].limitMinor);
    if (total > limit) notModelled(`Turnover of ${inr(total)} is above the 44AD limit of ${inr(limit)}. The business needs books and maybe a tax audit: your CA works this.`);
    builder.step('turnover', 'Turnover of the small business, presumptive scheme', total, sectionOf(table, 'presumptive-business'));
    builder.step('presumptive-digital', 'Six percent of receipts by bank or digital means', applyBps(digital, BigInt(rates['44AD'].digitalBps)));
    builder.step('presumptive-other', 'Eight percent of other receipts', applyBps(cash, BigInt(rates['44AD'].otherBps)));
    return applyBps(digital, BigInt(rates['44AD'].digitalBps)) + applyBps(cash, BigInt(rates['44AD'].otherBps));
  }
  if (presumptive.scheme === '44ADA') {
    const gross = paise(presumptive.grossReceiptsMinor, 'Gross receipts');
    const cash = paise(presumptive.cashReceiptsMinor, 'Cash receipts');
    if (cash > gross) invalid('Cash receipts cannot be more than gross receipts.');
    const raised = cash * 10000n <= gross * BigInt(rates['44ADA'].cashShareMaxBps);
    const limit = BigInt(raised ? rates['44ADA'].raisedLimitMinor : rates['44ADA'].limitMinor);
    if (gross > limit) notModelled(`Gross receipts of ${inr(gross)} are above the 44ADA limit of ${inr(limit)}. The practice needs books and maybe a tax audit: your CA works this.`);
    builder.step('gross-receipts', 'Gross receipts of the profession, presumptive scheme', gross, sectionOf(table, 'presumptive-profession'));
    return applyBps(gross, BigInt(rates['44ADA'].rateBps));
  }
  return invalid('The presumptive scheme is 44AD or 44ADA.');
}

function deductionsAllowed(builder: ReceiptBuilder, table: RateTable<IncomeTaxPayload>, regime: RegimeRates, input: IncomeTaxInput): bigint {
  const claims = input.deductions ?? [];
  if (!Array.isArray(claims)) invalid('Deductions are a list of code and amount.');
  const known = new Set(Object.keys(table.payload.regimes.old.deductions));
  const seen = new Set<string>();
  const senior = input.ageBand !== 'below-60';
  let total = 0n;
  for (const claim of claims) {
    const code = claim?.code;
    if (typeof code !== 'string') return invalid('Each deduction needs its code.');
    if (table.payload.notModelledDeductions.includes(code)) notModelled(`The deduction under ${code} is not modelled here. Your CA works it.`);
    if (!known.has(code)) invalid(`The deduction code ${code} is not one this working knows.`);
    if (seen.has(code)) invalid(`The deduction ${code} is listed twice.`);
    seen.add(code);
    const claimed = paise(claim.claimedMinor, `The ${code} claim`);
    const rule = regime.deductions[code];
    const section = deductionSection(table, code);
    let allowed: bigint;
    let label: string;
    // Labels name the deduction in words, never its section number: a client document quotes them, and section numbers
    // wait for the CA's confirmation (claims.ts sections-flagged). The step's key and section keep the code.
    const title = (rule ?? table.payload.regimes.old.deductions[code])!.title;
    if (!rule) { allowed = 0n; label = `${title}: not allowed under the new regime`; }
    else if (rule.seniorOnly && !senior) { allowed = 0n; label = `${title}: only for a senior citizen`; }
    else if (rule.notForSenior && senior) { allowed = 0n; label = `${title}: not for a senior citizen, who claims the deduction for deposit interest instead`; }
    else {
      const capText = rule.capByAge?.[input.ageBand] ?? rule.capMinor;
      const cap = capText === null ? null : BigInt(capText);
      allowed = cap === null ? claimed : minBig(claimed, cap);
      label = allowed < claimed ? `${title}: claimed ${inr(claimed)}, capped at ${inr(cap!)}` : title;
    }
    builder.step(`deduction-${code}`, label, allowed, section);
    total += allowed;
  }
  return total;
}

/**
 * Income tax for one individual for one assessment year. Refuses (NOT_MODELLED) incomes and deductions this engine
 * does not cover, refuses (RATE_UNCONFIRMED) a real client's work on a table the CA has not confirmed, and refuses
 * (TAX_INPUT_INVALID) amounts that are not whole paise.
 */
export function computeIncomeTax(input: IncomeTaxInput, use: RateUse = REHEARSAL): CaReceipt<IncomeTaxWorking> {
  if (!input || typeof input !== 'object') invalid('Send the income tax inputs.');
  const also = input.alsoHas ?? [];
  if (!Array.isArray(also) || also.some(item => !NOT_MODELLED_INCOMES.includes(item))) invalid('Other incomes are named from the list this working knows.');
  if (also.length) notModelled(`This working does not compute ${also.map(item => INCOME_WORDS[item]).join(', ')}. Your CA works the return.`);
  // Ink v2 4J16 (CA8): facts only the client can give are asked, never guessed (needs-facts.ts). No income named at
  // all is a gap too: a nil tax is never assumed (a zero the files show is a fact). A case the CA works comes first,
  // so with every person fact given, the income gap is asked only after the deductions are read.
  const noIncome = [input.salaryMinor, input.otherSlabIncomeMinor, input.businessIncomeMinor, input.presumptive].every(value => value === undefined || value === null);
  const unknown = (['regime', 'residency', 'ageBand'] as const).filter(field => absent(input[field]));
  if (unknown.length) requireFacts('income tax working', [...unknown.map(field => ({ field })), ...(noIncome ? [{ field: 'income' as const }] : [])]);
  if (input.regime !== 'new' && input.regime !== 'old') invalid('Choose the new or the old regime.');
  if (input.residency !== 'resident' && input.residency !== 'non-resident') invalid('Say whether the person is resident.');
  if (!AGE_BANDS.includes(input.ageBand)) invalid('Choose the age band: below 60, 60 to 79, or 80 and over.');
  if (input.presumptive && input.businessIncomeMinor !== undefined) invalid('Business income comes from the books or from a presumptive scheme, not both.');

  const table = incomeTaxTable(input.assessmentYear);
  const stamp = useRateTable(table, use);
  const regime = table.payload.regimes[input.regime];
  const builder = new ReceiptBuilder('income-tax');
  builder.useTable(table, stamp);
  if (input.regime === 'new') builder.cite(sectionOf(table, 'new-regime'));

  const salary = optionalPaise(input.salaryMinor, 'Salary');
  let salaryIncome = 0n;
  if (salary > 0n) {
    builder.step('salary', 'Salary as on Form 16', salary);
    const standard = builder.step('standard-deduction', 'Standard deduction', minBig(salary, BigInt(regime.standardDeductionMinor)), sectionOf(table, 'standard-deduction'));
    const claimedTax = optionalPaise(input.professionalTaxMinor, 'Professional tax');
    let professional = 0n;
    if (claimedTax > 0n) {
      professional = regime.professionalTaxCapMinor === null
        ? builder.step('professional-tax', 'Professional tax: not allowed under the new regime', 0n, sectionOf(table, 'professional-tax'))
        : builder.step('professional-tax', 'Professional tax paid', minBig(claimedTax, BigInt(regime.professionalTaxCapMinor)), sectionOf(table, 'professional-tax'));
    }
    salaryIncome = builder.step('salary-income', 'Income from salary', maxBig(0n, salary - standard - professional));
  } else if (input.professionalTaxMinor !== undefined && optionalPaise(input.professionalTaxMinor, 'Professional tax') > 0n) {
    invalid('Professional tax is deducted from salary; there is no salary here.');
  }

  const other = optionalPaise(input.otherSlabIncomeMinor, 'Other income');
  if (other > 0n) builder.step('other-income', 'Income from other sources at slab rates', other);
  let business = 0n;
  if (input.presumptive) business = builder.step('business-income', 'Presumptive business income', presumptiveIncome(builder, table, input.presumptive));
  else if (input.businessIncomeMinor !== undefined) {
    business = builder.step('business-income', 'Business income from the books', paise(input.businessIncomeMinor, 'Business income'));
    builder.assume('Business income from the books is taken as given; the CA checks the accounts behind it.');
  }

  const gross = builder.step('gross-total-income', 'Gross total income', salaryIncome + other + business);
  const claimed = deductionsAllowed(builder, table, regime, input);
  if (noIncome) requireFacts('income tax working', [{ field: 'income' }]);
  const deductions = minBig(claimed, gross);
  if (input.deductions?.length) builder.step('deductions', claimed > gross ? 'Deductions, limited to gross total income' : 'Deductions allowed', deductions);
  const total = builder.step('total-income', 'Total income, rounded to the nearest ten rupees', round288(gross - deductions), sectionOf(table, 'rounding-income'));

  const resident = input.residency === 'resident';
  if (!resident && input.ageBand !== 'below-60') builder.assume('Senior citizen slabs apply to residents only, so the basic slabs are used.');
  const slabs = regime.slabs[resident ? input.ageBand : 'below-60'];
  const { total: tax, rows } = slabTax(total, slabs);
  builder.step('slab-tax', 'Tax at slab rates', tax);

  let rebate = 0n;
  const limit = BigInt(regime.rebate.incomeLimitMinor);
  if (resident) {
    if (total <= limit) rebate = minBig(tax, BigInt(regime.rebate.maxMinor));
    else if (regime.rebate.marginalRelief) rebate = maxBig(0n, tax - (total - limit));
  } else {
    builder.assume('The 87A rebate is for residents only.');
  }
  builder.step('rebate-87a', total > limit && rebate > 0n ? 'Rebate, as marginal relief above the limit' : 'Rebate', rebate, sectionOf(table, 'rebate'));
  const afterRebate = builder.step('tax-after-rebate', 'Tax after rebate', tax - rebate);

  let surcharge = 0n;
  const bands = regime.surcharge.map(band => ({ above: BigInt(band.aboveMinor), rate: BigInt(band.rateBps) }));
  const band = [...bands].reverse().find(item => total > item.above);
  let relief = false;
  if (band) {
    surcharge = applyBps(afterRebate, band.rate);
    const lower = bands.filter(item => item.above < band.above).at(-1)?.rate ?? 0n;
    const atThreshold = slabTax(band.above, slabs).total;
    const ceiling = atThreshold + applyBps(atThreshold, lower) + (total - band.above);
    if (afterRebate + surcharge > ceiling) { surcharge = maxBig(0n, ceiling - afterRebate); relief = true; }
  }
  builder.step('surcharge', relief ? 'Surcharge, with marginal relief' : 'Surcharge', surcharge);
  const cess = builder.step('cess', 'Health and education cess', applyBps(afterRebate + surcharge, BigInt(table.payload.cessBps)));
  const liability = builder.step('tax-liability', 'Tax liability', afterRebate + surcharge + cess);
  const rounded = builder.step('tax-liability-rounded', 'Tax liability, rounded to the nearest ten rupees', round288(liability), sectionOf(table, 'rounding-tax'));
  builder.assume('Rounding under 288B is shown on the tax liability; the CA confirms where the return utility rounds.');

  if (input.prepaid) {
    const paid = optionalPaise(input.prepaid.tdsMinor, 'TDS') + optionalPaise(input.prepaid.tcsMinor, 'TCS') + optionalPaise(input.prepaid.advanceTaxMinor, 'Advance tax');
    builder.step('prepaid', 'Tax already paid', paid);
    builder.step('balance', rounded >= paid ? 'Balance payable before interest' : 'Refund due before interest', rounded - paid);
  }

  const working: IncomeTaxWorking = { regime: input.regime, assessmentYear: input.assessmentYear, ageBand: input.ageBand, residency: input.residency, slabs: rows };
  return builder.build(input, working, `Income tax for assessment year ${input.assessmentYear} under the ${input.regime} regime, from rate table version ${stamp.version}${stamp.confirmed ? ', confirmed by the CA' : ', not yet confirmed by the CA'}.`, stamp);
}
