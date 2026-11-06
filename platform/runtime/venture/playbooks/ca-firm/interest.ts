// AI-native CA firm: interest under sections 234A, 234B and 234C for an individual, from the versioned interest
// table, in BigInt paise. The amount interest runs on is rounded down to a hundred rupees (rule 119A); a part of a
// month counts as a month. Self-assessment tax is taken as paid on the day the return is filed, and the receipt says
// so. Tax paid after 31 March is not advance tax and is refused here.
import { ChausarError } from '../../../contracts.ts';
import { applyBps, floorToMultiple, invalid, isoDate, maxBig, monthsOrPart, nextDay, optionalPaise, paise, sumBig, type IsoDate } from './money.ts';
import { previousYearStart } from './income-tax.ts';
import { rateTableFor, sectionOf, useRateTable, REHEARSAL, type InterestPayload, type RateTable, type RateUse } from './rates.ts';
import { ReceiptBuilder, type CaReceipt } from './receipt.ts';

export type InterestInput = {
  /** The years the income-tax tables cover; each has an interest table of its own (2027-28 from Ink v2 2A2). */
  assessmentYear: '2026-27' | '2027-28';
  /** Tax on total income after rebate, with surcharge and cess: the income-tax receipt's tax liability. */
  taxOnTotalIncomeMinor: string;
  reliefMinor?: string;
  tdsMinor?: string;
  tcsMinor?: string;
  advanceTax: { date: IsoDate; amountMinor: string }[];
  filedOn: IsoDate;
  /** The due date when the CBDT extended it, or the accounts need an audit; the table's date otherwise. */
  dueDate?: IsoDate;
  /**
   * Business or professional income whose accounts need no audit: the return is due on the table's business due date
   * when it has one (31 August from assessment year 2026-27, under the Finance Act, 2026), else on its usual due date.
   */
  business?: boolean;
  /** Presumptive income under 44AD or 44ADA: one instalment by 15 March. */
  presumptive?: boolean;
  /** A resident senior citizen with no business income pays no advance tax. */
  advanceTaxExempt?: boolean;
};
export type InterestWorking = {
  assessedTaxMinor: string;
  advancePaidMinor: string;
  months234a: number;
  months234b: number;
  instalments: { by: IsoDate; requiredMinor: string; paidMinor: string; shortfallMinor: string; months: number; interestMinor: string }[];
};

export function interestTable(assessmentYear: string): RateTable<InterestPayload> {
  const table = rateTableFor<InterestPayload>('income-tax-interest', previousYearStart(assessmentYear));
  if (table.payload.assessmentYear !== assessmentYear) throw new ChausarError('RATE_TABLE_MISSING', `No interest table is kept for assessment year ${assessmentYear}.`);
  return table;
}

export function computeInterest234(input: InterestInput, use: RateUse = REHEARSAL): CaReceipt<InterestWorking> {
  if (!input || typeof input !== 'object') invalid('Send the interest inputs.');
  const table = interestTable(input.assessmentYear);
  const stamp = useRateTable(table, use);
  const rates = table.payload;
  const filedOn = isoDate(input.filedOn, 'The filing date');
  // Business income with no audit has its own due date where the table keeps one (31 August from assessment year 2026-27).
  const tableDue = input.business && rates.businessDueDate ? rates.businessDueDate : rates.dueDate;
  const dueDate = input.dueDate === undefined ? tableDue : isoDate(input.dueDate, 'The due date');
  if (!Array.isArray(input.advanceTax)) invalid('Advance tax is a list of dated payments.');
  const advance = input.advanceTax.map((payment, index) => {
    const date = isoDate(payment?.date, `Advance tax payment ${index + 1}`);
    if (date < table.validFrom || date >= rates.yearStart) invalid(`The payment on ${date} is not advance tax for this year: advance tax is paid from 1 April to 31 March.`);
    return { date, amount: paise(payment.amountMinor, `Advance tax payment ${index + 1}`) };
  });
  const rate = BigInt(rates.ratePerMonthBps);
  const hundred = BigInt(rates.roundDownMinor);
  const builder = new ReceiptBuilder('interest-234');
  builder.useTable(table, stamp);
  builder.assume('Self-assessment tax is taken as paid on the day the return is filed; tax paid earlier lowers 234A and 234B, and the CA adjusts for it.');
  if (input.dueDate !== undefined && input.dueDate !== tableDue) builder.assume(`The due date used is ${dueDate}, not the table's ${tableDue}.`);
  if (input.dueDate === undefined && tableDue !== rates.dueDate) {
    builder.assume(`The return is due on ${tableDue}: the person has business or professional income and the accounts need no audit. With an audit it is due later, and the CA confirms which.`);
  }

  const tax = paise(input.taxOnTotalIncomeMinor, 'Tax on total income');
  const credits = optionalPaise(input.reliefMinor, 'Relief') + optionalPaise(input.tdsMinor, 'TDS') + optionalPaise(input.tcsMinor, 'TCS');
  const assessed = builder.step('assessed-tax', 'Tax on total income less relief, TDS and TCS', maxBig(0n, tax - credits));
  const advancePaid = builder.step('advance-tax-paid', 'Advance tax paid by 31 March', sumBig(advance.map(item => item.amount)));

  const months234a = filedOn > dueDate ? monthsOrPart(nextDay(dueDate), filedOn) : 0;
  const base234a = floorToMultiple(maxBig(0n, assessed - advancePaid), hundred);
  const a = builder.step('interest-234a', `Interest for filing ${months234a} ${months234a === 1 ? 'month' : 'months'} late`, applyBps(base234a, rate * BigInt(months234a)), sectionOf(table, 'interest-234a'));

  const threshold = BigInt(rates.advanceTaxThresholdMinor);
  const liable = !input.advanceTaxExempt && assessed >= threshold;
  if (input.advanceTaxExempt) builder.cite(sectionOf(table, 'advance-tax-exempt'));
  if (!liable && !input.advanceTaxExempt) builder.cite(sectionOf(table, 'advance-tax-threshold'));
  const short = liable && advancePaid * 10000n < assessed * BigInt(rates.shortfallShareBps);
  const months234b = short ? monthsOrPart(rates.yearStart, filedOn) : 0;
  const base234b = short ? floorToMultiple(assessed - advancePaid, hundred) : 0n;
  const b = builder.step('interest-234b', `Interest for short advance tax over ${months234b} ${months234b === 1 ? 'month' : 'months'}`, applyBps(base234b, rate * BigInt(months234b)), sectionOf(table, 'interest-234b'));

  const schedule = input.presumptive ? rates.presumptiveInstallments : rates.installments;
  const instalments: InterestWorking['instalments'] = [];
  schedule.forEach((step, index) => {
    const required = liable ? applyBps(assessed, BigInt(step.shareBps)) : 0n;
    const paid = sumBig(advance.filter(item => item.date <= step.by).map(item => item.amount));
    const tolerated = step.toleranceBps !== null && paid * 10000n >= assessed * BigInt(step.toleranceBps);
    const shortfall = !liable || tolerated ? 0n : maxBig(0n, required - paid);
    const interest = applyBps(floorToMultiple(shortfall, hundred), rate * BigInt(step.months));
    instalments.push({ by: step.by, requiredMinor: String(required), paidMinor: String(paid), shortfallMinor: String(shortfall), months: step.months, interestMinor: String(interest) });
    builder.step(`interest-234c-${index + 1}`, `Interest for the instalment due ${step.by}`, interest, sectionOf(table, 'interest-234c'));
  });
  const c = builder.step('interest-234c', 'Interest for deferred advance tax', sumBig(instalments.map(item => BigInt(item.interestMinor))));
  builder.step('interest-total', 'Interest for the late return, short advance tax and deferred advance tax', a + b + c);
  if (liable) builder.cite(sectionOf(table, 'installments'));
  if (filedOn > dueDate) builder.cite(sectionOf(table, 'due-date'));

  const working: InterestWorking = { assessedTaxMinor: String(assessed), advancePaidMinor: String(advancePaid), months234a, months234b, instalments };
  return builder.build(input, working, `Interest for assessment year ${input.assessmentYear}, return filed on ${filedOn}, from interest table version ${stamp.version}.`, stamp);
}
