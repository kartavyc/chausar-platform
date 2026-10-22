// P3-ca-firm: slab tax for AY 2026-27 in both regimes, rebate, surcharge with marginal relief, cess, presumptive
// income, and interest under 234A, 234B and 234C, all in BigInt paise from the versioned rate tables.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeIncomeTax, type IncomeTaxInput } from '../runtime/venture/playbooks/ca-firm/income-tax.ts';
import { computeInterest234 } from '../runtime/venture/playbooks/ca-firm/interest.ts';
import { RENUMBERING_QUESTION } from '../runtime/venture/playbooks/ca-firm/rates.ts';
import type { CaReceipt } from '../runtime/venture/playbooks/ca-firm/receipt.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const R = (rupees: number) => String(BigInt(rupees) * 100n);
const fig = (receipt: CaReceipt, key: string) => {
  const found = receipt.figures.find(item => item.key === key);
  assert.ok(found, `no figure ${key}: ${receipt.figures.map(item => item.key).join(', ')}`);
  return found.minor;
};
const base = (extra: Partial<IncomeTaxInput>): IncomeTaxInput => ({ assessmentYear: '2026-27', regime: 'new', residency: 'resident', ageBand: 'below-60', ...extra });

test('new regime: salary of 15 lakh, standard deduction, slabs and cess', () => {
  const receipt = computeIncomeTax(base({ salaryMinor: R(15_00_000) }));
  assert.equal(receipt.engine, 'income-tax');
  assert.equal(fig(receipt, 'standard-deduction'), R(75_000));
  assert.equal(fig(receipt, 'total-income'), R(14_25_000));
  // 4 to 8 lakh at 5% = 20,000; 8 to 12 lakh at 10% = 40,000; 12 to 14.25 lakh at 15% = 33,750.
  assert.equal(fig(receipt, 'slab-tax'), R(93_750));
  assert.equal(fig(receipt, 'rebate-87a'), '0');
  assert.equal(fig(receipt, 'cess'), R(3_750));
  assert.equal(fig(receipt, 'tax-liability'), R(97_500));
  assert.equal(fig(receipt, 'tax-liability-rounded'), R(97_500));
  assert.equal(receipt.table?.id, 'in-income-tax-ay-2026-27');
  assert.equal(receipt.table?.confirmed, false);
  assert.match(receipt.id, /^ca_[a-f0-9]{24}$/);
  // Same inputs, same receipt.
  assert.deepEqual(computeIncomeTax(base({ salaryMinor: R(15_00_000) })), receipt);
  // Every figure displays from its minor units, and the sections it touched carry the renumbering question.
  for (const item of receipt.figures) assert.match(item.display, /^INR -?[\d,]+\.\d{2}$/);
  assert.ok(receipt.sections.some(section => section.section === '115BAC' && section.needsCaConfirmation));
  assert.ok(receipt.openQuestions.includes(RENUMBERING_QUESTION));
});

test('new regime: income up to 12 lakh is fully rebated; just above it, marginal relief caps the tax at the excess', () => {
  const at = computeIncomeTax(base({ salaryMinor: R(12_75_000) }));
  assert.equal(fig(at, 'total-income'), R(12_00_000));
  assert.equal(fig(at, 'slab-tax'), R(60_000));
  assert.equal(fig(at, 'rebate-87a'), R(60_000));
  assert.equal(fig(at, 'tax-liability'), '0');

  const above = computeIncomeTax(base({ salaryMinor: R(12_85_000) }));
  assert.equal(fig(above, 'total-income'), R(12_10_000));
  assert.equal(fig(above, 'slab-tax'), R(61_500));
  assert.equal(fig(above, 'rebate-87a'), R(51_500));
  assert.equal(fig(above, 'tax-after-rebate'), R(10_000));
  assert.equal(fig(above, 'cess'), R(400));
  assert.equal(fig(above, 'tax-liability'), R(10_400));

  // A non-resident gets no rebate.
  const nri = computeIncomeTax(base({ residency: 'non-resident', salaryMinor: R(12_75_000) }));
  assert.equal(fig(nri, 'rebate-87a'), '0');
  assert.equal(fig(nri, 'tax-liability'), R(62_400));
});

test('old regime: deductions capped by the table, professional tax, slab tax and rounding under 288B', () => {
  const receipt = computeIncomeTax(base({
    regime: 'old', salaryMinor: R(10_00_000), professionalTaxMinor: R(2_500), otherSlabIncomeMinor: R(12_000),
    deductions: [{ code: '80C', claimedMinor: R(2_00_000) }, { code: '80D-self', claimedMinor: R(30_000) }, { code: '80TTA', claimedMinor: R(12_000) }],
  }));
  assert.equal(fig(receipt, 'standard-deduction'), R(50_000));
  assert.equal(fig(receipt, 'gross-total-income'), R(9_59_500));
  assert.equal(fig(receipt, 'deduction-80C'), R(1_50_000));
  assert.equal(fig(receipt, 'deduction-80D-self'), R(25_000));
  assert.equal(fig(receipt, 'deduction-80TTA'), R(10_000));
  assert.equal(fig(receipt, 'total-income'), R(7_74_500));
  assert.equal(fig(receipt, 'slab-tax'), R(67_400));
  assert.equal(fig(receipt, 'cess'), R(2_696));
  assert.equal(fig(receipt, 'tax-liability'), R(70_096));
  assert.equal(fig(receipt, 'tax-liability-rounded'), R(70_100));
  // Each capped claim says how much was cut, in the receipt's own words.
  assert.ok(receipt.steps.some(step => step.key === 'deduction-80C' && /capped/i.test(step.label)));
});

test('old regime: a senior citizen has a higher exemption and the 87A rebate up to 5 lakh', () => {
  const receipt = computeIncomeTax(base({ regime: 'old', ageBand: '60-79', salaryMinor: R(5_50_000) }));
  assert.equal(fig(receipt, 'total-income'), R(5_00_000));
  assert.equal(fig(receipt, 'slab-tax'), R(10_000));
  assert.equal(fig(receipt, 'rebate-87a'), R(10_000));
  assert.equal(fig(receipt, 'tax-liability'), '0');
});

test('new regime: deductions are not allowed and are listed at zero', () => {
  const receipt = computeIncomeTax(base({ salaryMinor: R(10_00_000), deductions: [{ code: '80C', claimedMinor: R(1_50_000) }] }));
  assert.equal(fig(receipt, 'deduction-80C'), '0');
  assert.ok(receipt.steps.some(step => step.key === 'deduction-80C' && /new regime/i.test(step.label)));
  assert.equal(fig(receipt, 'total-income'), R(9_25_000));
});

test('surcharge above 50 lakh with marginal relief', () => {
  const receipt = computeIncomeTax(base({ salaryMinor: R(50_85_000) }));
  assert.equal(fig(receipt, 'total-income'), R(50_10_000));
  assert.equal(fig(receipt, 'slab-tax'), R(10_83_000));
  // 10% would be 1,08,300; relief keeps tax plus surcharge to 10,80,000 plus the 10,000 above 50 lakh.
  assert.equal(fig(receipt, 'surcharge'), R(7_000));
  assert.equal(fig(receipt, 'cess'), R(43_600));
  assert.equal(fig(receipt, 'tax-liability'), R(11_33_600));
});

test('small business: presumptive income under 44AD and 44ADA, refused above the limit', () => {
  const shop = computeIncomeTax(base({ presumptive: { scheme: '44AD', digitalReceiptsMinor: R(40_00_000), cashReceiptsMinor: R(10_00_000) } }));
  // 6% of 40 lakh digital = 2,40,000; 8% of 10 lakh cash = 80,000.
  assert.equal(fig(shop, 'business-income'), R(3_20_000));
  assert.equal(fig(shop, 'tax-liability'), '0');
  const doctor = computeIncomeTax(base({ presumptive: { scheme: '44ADA', grossReceiptsMinor: R(40_00_000), cashReceiptsMinor: R(1_00_000) } }));
  assert.equal(fig(doctor, 'business-income'), R(20_00_000));
  // 20 lakh: 20,000 + 40,000 + 60,000 + 80,000 = 2,00,000; cess 8,000.
  assert.equal(fig(doctor, 'tax-liability'), R(2_08_000));
  // 44ADA: above 50 lakh with more than 5% in cash goes to the CA (books and maybe an audit).
  assert.throws(() => computeIncomeTax(base({ presumptive: { scheme: '44ADA', grossReceiptsMinor: R(60_00_000), cashReceiptsMinor: R(10_00_000) } })), code('NOT_MODELLED'));
  // Within the raised limit when cash is at most 5%.
  const raised = computeIncomeTax(base({ presumptive: { scheme: '44ADA', grossReceiptsMinor: R(60_00_000), cashReceiptsMinor: R(3_00_000) } }));
  assert.equal(fig(raised, 'business-income'), R(30_00_000));
});

test('refusals: incomes this engine does not model go to the CA, and bad inputs are refused', () => {
  assert.throws(() => computeIncomeTax(base({ salaryMinor: R(10_00_000), alsoHas: ['capital-gains'] })), code('NOT_MODELLED'));
  assert.throws(() => computeIncomeTax(base({ deductions: [{ code: '80CCD(2)', claimedMinor: R(10_000) }] })), code('NOT_MODELLED'));
  assert.throws(() => computeIncomeTax(base({ assessmentYear: '2027-28' as '2026-27', salaryMinor: R(1) })), code('RATE_TABLE_MISSING'));
  assert.throws(() => computeIncomeTax(base({ salaryMinor: '12.5' })), code('TAX_INPUT_INVALID'));
  assert.throws(() => computeIncomeTax(base({ salaryMinor: R(10_00_000) }), { mode: 'client', confirmations: [] }), code('RATE_UNCONFIRMED'));
});

test('interest: 234A, 234B and 234C with rule 119A rounding and the advance tax schedule', () => {
  const receipt = computeInterest234({
    assessmentYear: '2026-27', taxOnTotalIncomeMinor: R(1_50_000), tdsMinor: R(30_000), filedOn: '2026-09-20',
    advanceTax: [
      { date: '2025-06-15', amountMinor: R(10_000) }, { date: '2025-09-15', amountMinor: R(20_000) },
      { date: '2025-12-15', amountMinor: R(20_000) }, { date: '2026-03-15', amountMinor: R(20_000) },
    ],
  });
  assert.equal(receipt.engine, 'interest-234');
  assert.equal(fig(receipt, 'interest-234a'), R(1_000));
  assert.equal(fig(receipt, 'interest-234b'), R(3_000));
  assert.equal(fig(receipt, 'interest-234c-1'), R(240));
  assert.equal(fig(receipt, 'interest-234c-2'), R(720));
  assert.equal(fig(receipt, 'interest-234c-3'), R(1_200));
  assert.equal(fig(receipt, 'interest-234c-4'), R(500));
  assert.equal(fig(receipt, 'interest-234c'), R(2_660));
  assert.equal(fig(receipt, 'interest-total'), R(6_660));
  assert.ok(receipt.assumptions.some(line => /self-assessment tax/i.test(line)));
  assert.equal(receipt.table?.id, 'in-income-tax-interest-ay-2026-27');
});

test('interest: on time and small, nothing; the June and September tolerances; presumptive pays once', () => {
  const small = computeInterest234({ assessmentYear: '2026-27', taxOnTotalIncomeMinor: R(9_000), filedOn: '2026-07-20', advanceTax: [] });
  assert.equal(fig(small, 'interest-total'), '0');
  const tolerated = computeInterest234({
    assessmentYear: '2026-27', taxOnTotalIncomeMinor: R(1_00_000), filedOn: '2026-07-20',
    advanceTax: [{ date: '2025-06-10', amountMinor: R(12_000) }, { date: '2025-09-10', amountMinor: R(24_000) }, { date: '2025-12-10', amountMinor: R(39_000) }, { date: '2026-03-10', amountMinor: R(25_000) }],
  });
  assert.equal(fig(tolerated, 'interest-234c-1'), '0');
  assert.equal(fig(tolerated, 'interest-234c-2'), '0');
  assert.equal(fig(tolerated, 'interest-234c'), '0');
  assert.equal(fig(tolerated, 'interest-234a'), '0');
  const presumptive = computeInterest234({
    assessmentYear: '2026-27', taxOnTotalIncomeMinor: R(1_20_000), filedOn: '2026-07-31', presumptive: true,
    advanceTax: [{ date: '2026-03-14', amountMinor: R(50_000) }],
  });
  assert.equal(fig(presumptive, 'interest-234c'), R(700));
  const senior = computeInterest234({ assessmentYear: '2026-27', taxOnTotalIncomeMinor: R(1_20_000), filedOn: '2026-07-31', advanceTax: [], advanceTaxExempt: true });
  assert.equal(fig(senior, 'interest-234b'), '0');
  assert.equal(fig(senior, 'interest-234c'), '0');
  assert.throws(() => computeInterest234({ assessmentYear: '2026-27', taxOnTotalIncomeMinor: R(1), filedOn: '2026-13-01', advanceTax: [] }), code('TAX_INPUT_INVALID'));
});
