import assert from 'node:assert/strict';
import { initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { CalculatorService, type CalculationReceipt, type CalculationRequest } from '../runtime/calculator.ts';
import { MemoryService, type FactInput } from '../runtime/memory.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import { demoRecipe, type ImportInput } from '../runtime/ingest.ts';

export const fixtureOwner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
export const fixturePeriod = { from: '2026-09-01', to: '2026-09-30' };

// This store supports deterministic JavaScript checks only. It is not a database
// adapter, and its tests never establish native SQL or durability qualification.
export class FixtureStateStore implements StateStore {
  #state: State = initialState('Labelled independent database answer key', true);
  read() { return structuredClone(this.#state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const draft = this.read(); const result = await change(draft);
    draft.revision++; this.#state = draft; return result;
  }
}

export type DatabaseFixture = {
  id: string;
  arithmetic: string;
  facts: FactInput[];
  request: CalculationRequest;
  expected?: { primary: string; figures: Record<string, string>; countedRows?: number; selectedRows?: number; excludedRows?: number; completeness?: string; conflicts?: number };
  rejectCode?: string;
  nulls?: 'exclude' | 'reject';
  pack?: string;
};

function fact(entityId: string, kind: string, amountMinor: string | null, fields: Record<string, unknown> = {}, validFrom = '2026-09-10', sourceId = 'answer-key'): FactInput {
  return { entityId, sourceId, sourceRow: 2, kind, validFrom, branch: 'main', fields: { amountMinor, currency: 'INR', status: 'settled', ...fields } };
}
const request = (operation: string, extra: Partial<CalculationRequest> = {}): CalculationRequest => ({ operation, period: fixturePeriod, asOf: '2100-01-01T00:00:00Z', ...extra });
const sum = (primary: string) => ({ primary, figures: { total: primary } });
const aging = (outstanding: string, unallocated: string, buckets: Partial<Record<string, string>> = {}) => ({ primary: outstanding, figures: { notDue: '0', days1to30: '0', days31to60: '0', days61to90: '0', over90: '0', ...buckets, outstanding, unallocated } });

const shopFacts = [
  fact('invoice-a', 'invoice', '100000', { invoiceId: 'A', customerId: 'C', dueDate: '2026-09-15' }),
  fact('invoice-b', 'invoice', '200000', { invoiceId: 'B', customerId: 'C', dueDate: '2026-09-20' }),
  fact('payment-a', 'payment', '60000', { invoiceId: 'A', customerId: 'C' }),
  fact('payment-b', 'payment', '200000', { invoiceId: 'B', customerId: 'C' }),
  fact('sale-a', 'sale', '100000'), fact('sale-b', 'sale', '150000'),
  fact('refund-a', 'refund', '10000', { invoiceId: 'A', customerId: 'C' }),
  fact('cost-a', 'cost', '40000'), fact('cost-b', 'cost', '70000'),
  fact('purchase-a', 'purchase', '70000'),
];

// All expected values below are literal independent answer keys. None are
// computed with compileDictionary, CalculatorService, or the SQL compiler.
export const databaseFixtures: DatabaseFixture[] = [
  ...Object.entries({ billed: '300000', received: '260000', earned: '250000', revenue: '250000', refunds: '10000', costs: '110000', purchases: '70000', net_sales: '240000' }).map(([operation, primary], index) => ({
    id: `shop-${operation}`, arithmetic: 'Invoices 100000+200000; receipts 60000+200000; earned 100000+150000; refunds 10000; costs 40000+70000; purchases 70000.',
    facts: shopFacts, request: request(operation), expected: sum(primary), pack: starterPacks[index % starterPacks.length].pack,
  })),
  { id: 'shop-margin', arithmetic: '(250000-10000)-110000=130000; 130000*10000/240000 truncates to 5416.', facts: shopFacts, request: request('margin'), expected: { primary: '130000', figures: { earned: '250000', refunds: '10000', netSales: '240000', costs: '110000', contribution: '130000', marginBps: '5416' } } },
  { id: 'shop-aging', arithmetic: 'A=100000-60000-10000=30000; B=200000-200000=0.', facts: shopFacts, request: request('aging', { onDate: '2026-09-30' }), expected: aging('30000', '0', { days1to30: '30000' }) },
  { id: 'sum-above-javascript-safe-integer', arithmetic: '900719925474099391+9=900719925474099400 exact minor units.', facts: [fact('huge', 'sale', '900719925474099391'), fact('small', 'sale', '9')], request: request('earned'), expected: sum('900719925474099400') },
  { id: 'sum-at-decimal-38-maximum', arithmetic: 'One event with exactly38 nines equals the DECIMAL(38,0) maximum99999999999999999999999999999999999999.', facts: [fact('decimal-limit', 'sale', '99999999999999999999999999999999999999')], request: request('earned'), expected: sum('99999999999999999999999999999999999999') },
  { id: 'large-margin-ratio-must-not-round-up', arithmetic: 'Earned10000000000000000000000000000000 minus cost1 gives9999999999999999999999999999999. Multiplying by10000 then dividing by earned truncates to9999bps, never rounds to10000.', facts: [fact('large-earned', 'sale', '10000000000000000000000000000000'), fact('one-cost', 'cost', '1')], request: request('margin'), expected: { primary: '9999999999999999999999999999999', figures: { earned: '10000000000000000000000000000000', refunds: '0', netSales: '10000000000000000000000000000000', costs: '1', contribution: '9999999999999999999999999999999', marginBps: '9999' } } },
  { id: 'negative-margin-truncates-toward-zero', arithmetic: '3-0-4=-1; -10000/3 truncates to -3333 (not -3334).', facts: [fact('earned', 'sale', '3'), fact('cost', 'cost', '4')], request: request('margin'), expected: { primary: '-1', figures: { earned: '3', refunds: '0', netSales: '3', costs: '4', contribution: '-1', marginBps: '-3333' } } },
  { id: 'zero-margin-denominator-omits-ratio', arithmetic: 'Earned 3-refund 3=0; contribution 0-1=-1; no defined margin ratio.', facts: [fact('earned', 'sale', '3'), fact('refund', 'refund', '3'), fact('cost', 'cost', '1')], request: request('margin'), expected: { primary: '-1', figures: { earned: '3', refunds: '3', netSales: '0', costs: '1', contribution: '-1' } } },
  { id: 'negative-change-truncates-toward-zero', arithmetic: 'Current 2-prior 3=-1; -10000/3 truncates to -3333.', facts: [fact('current', 'sale', '2'), fact('prior', 'sale', '3', {}, '2026-08-10')], request: request('change', { comparePeriod: { from: '2026-08-01', to: '2026-08-31' } }), expected: { primary: '-1', figures: { current: '2', previous: '3', change: '-1', changeBps: '-3333' } } },
  { id: 'zero-change-denominator-omits-ratio', arithmetic: 'Current 2-prior 0=2; no defined change ratio.', facts: [fact('current', 'sale', '2')], request: request('change', { comparePeriod: { from: '2026-08-01', to: '2026-08-31' } }), expected: { primary: '2', figures: { current: '2', previous: '0', change: '2' } } },
  { id: 'prior-source-conflict-makes-comparison-partial', arithmetic: 'Current2 with conflicting prior3 versus4 has no selected prior winner. Arithmetic difference2 has partial coverage, one prior conflict, and no defined ratio.', facts: [fact('current', 'sale', '2'), fact('prior', 'sale', '3', {}, '2026-08-10', 'books'), fact('prior', 'sale', '4', {}, '2026-08-10', 'bank')], request: request('change', { comparePeriod: { from: '2026-08-01', to: '2026-08-31' } }), expected: { primary: '2', figures: { current: '2', previous: '0', change: '2' }, countedRows: 1, selectedRows: 1, excludedRows: 2, completeness: 'partial', conflicts: 1 } },
  { id: 'overlapping-periods-retain-distinct-lineage', arithmetic: 'August-only3+overlap2+September-only5: current7, prior5, change2, ratio4000bps; three unique facts cover both periods.', facts: [fact('prior-only', 'sale', '3', {}, '2026-08-10'), fact('overlap', 'sale', '2', {}, '2026-09-10'), fact('current-only', 'sale', '5', {}, '2026-09-20')], request: request('change', { comparePeriod: { from: '2026-08-01', to: '2026-09-15' } }), expected: { primary: '2', figures: { current: '7', previous: '5', change: '2', changeBps: '4000' }, countedRows: 3, selectedRows: 3, excludedRows: 0 } },
  { id: 'negative-scenario-truncates-toward-zero', arithmetic: '-3*(10000+1000)/10000=-3.3 truncates to -3; change=0.', facts: [fact('correction-event', 'sale', '-3')], request: request('scenario', { assumptions: { priceChangeBps: '1000' } }), expected: { primary: '-3', figures: { baseline: '-3', scenario: '-3', change: '0', priceChangeBps: '1000' } } },
  { id: 'scenario-preserves-large-integer-and-fractional-minor-unit', arithmetic: '900719925474099391*11000/10000=990791918021509330.1 truncates to990791918021509330; change90071992547409939.', facts: [fact('large-scenario', 'sale', '900719925474099391')], request: request('scenario', { assumptions: { priceChangeBps: '1000' } }), expected: { primary: '990791918021509330', figures: { baseline: '900719925474099391', scenario: '990791918021509330', change: '90071992547409939', priceChangeBps: '1000' } } },
  { id: 'aging-payment-fanout-surplus-and-orphans', arithmetic: 'A=100000-(25000+30000+5000)=40000; B=50000-70000 yields 20000 excess. Wrong customer 15000+missing invoice 3000+unlinked 2000=20000; unallocated=40000.', facts: [
    fact('A', 'invoice', '100000', { invoiceId: 'A', customerId: 'C', dueDate: '2026-09-15' }),
    fact('B', 'invoice', '50000', { invoiceId: 'B', customerId: 'C', dueDate: '2026-09-15' }),
    fact('A-first', 'payment', '25000', { invoiceId: 'A', customerId: 'C' }),
    fact('A-second', 'payment', '30000', { invoiceId: 'A', customerId: 'C' }),
    fact('A-refund', 'refund', '5000', { invoiceId: 'A', customerId: 'C' }),
    fact('B-overpayment', 'payment', '70000', { invoiceId: 'B', customerId: 'C' }),
    fact('wrong-customer', 'payment', '15000', { invoiceId: 'A', customerId: 'OTHER' }),
    fact('missing-invoice', 'refund', '3000', { invoiceId: 'MISSING', customerId: 'C' }),
    fact('unlinked', 'payment', '2000', { customerId: 'C' }),
  ], request: request('aging', { onDate: '2026-09-30' }), expected: aging('40000', '40000', { days1to30: '40000' }) },
  { id: 'aging-unmatched-links-are-unallocated', arithmetic: 'Invoice I/C=100 with no matching receipt stays outstanding100. I/OTHER25+MISSING/C30+unlinked10=unallocated65.', facts: [
    fact('invoice', 'invoice', '100', { invoiceId: 'I', customerId: 'C', dueDate: '2026-09-15' }),
    fact('different-customer', 'payment', '25', { invoiceId: 'I', customerId: 'OTHER' }),
    fact('unknown-invoice', 'payment', '30', { invoiceId: 'MISSING', customerId: 'C' }),
    fact('no-invoice', 'payment', '10'),
  ], request: request('aging', { onDate: '2026-09-30' }), expected: aging('100', '65', { days1to30: '100' }) },
  // Bucket ages use June-issued invoices, so this answer key explicitly chooses
  // all event dates rather than declaring the default September event period.
  { id: 'aging-inclusive-bucket-boundaries', arithmetic: 'Seven invoices of100 due at ages0,30,31,60,61,90,91 days produce100,100,200,200,100; outstanding700.', facts: ['2026-09-30', '2026-08-31', '2026-08-30', '2026-08-01', '2026-07-31', '2026-07-02', '2026-07-01'].map((dueDate, i) => fact(`boundary-${i}`, 'invoice', '100', { invoiceId: `boundary-${i}`, customerId: 'C', dueDate }, '2026-06-01')), request: request('aging', { period: undefined, onDate: '2026-09-30' }), expected: aging('700', '0', { notDue: '100', days1to30: '100', days31to60: '200', days61to90: '200', over90: '100' }) },
  { id: 'explicit-zero-is-a-counted-fact', arithmetic: 'One real zero-valued event counts; it is not an empty selection.', facts: [fact('zero', 'sale', '0')], request: request('earned'), expected: { ...sum('0'), countedRows: 1, excludedRows: 0, completeness: 'unreconciled-facts' } },
  { id: 'empty-selection-is-a-coverage-gap', arithmetic: 'No facts means a zero arithmetic result with empty coverage, not proof of no activity.', facts: [], request: request('earned'), expected: { ...sum('0'), countedRows: 0, excludedRows: 0, completeness: 'empty' } },
  { id: 'missing-amount-explicitly-excluded', arithmetic: 'Null amount is excluded by an explicit rule; zero is counted independently and unknown activity remains a partial coverage gap.', facts: [fact('missing', 'sale', null), fact('zero', 'sale', '0')], request: request('earned'), nulls: 'exclude', expected: { ...sum('0'), countedRows: 1, excludedRows: 1, completeness: 'partial' } },
  { id: 'all-amounts-unknown-remains-partial', arithmetic: 'A selected event with an excluded unknown amount yields zero counted facts but partial coverage; it is neither empty activity nor a known zero.', facts: [fact('missing', 'sale', null)], request: request('earned'), nulls: 'exclude', expected: { ...sum('0'), countedRows: 0, selectedRows: 1, excludedRows: 1, completeness: 'partial' } },
  { id: 'conflicting-claims-are-not-zero-evidence', arithmetic: 'Two independent sources assert100 and90 for the same event; no selected winner yields partial coverage and one conflict.', facts: [fact('same', 'sale', '100', {}, '2026-09-10', 'books'), fact('same', 'sale', '90', {}, '2026-09-10', 'bank')], request: request('earned'), expected: { ...sum('0'), countedRows: 0, excludedRows: 2, completeness: 'partial', conflicts: 1 } },
  { id: 'duplicate-claims-count-once', arithmetic: 'Two independent sources assert the same100 event; one logical event counts100.', facts: [fact('same', 'sale', '100', {}, '2026-09-10', 'books'), fact('same', 'sale', '100', {}, '2026-09-10', 'bank')], request: request('earned'), expected: { ...sum('100'), countedRows: 1, excludedRows: 1 } },
  { id: 'missing-amount-rejected', arithmetic: 'Reject rule cannot silently turn a missing amount into zero.', facts: [fact('missing', 'sale', null)], request: request('earned'), rejectCode: 'MISSING_MEASURE_VALUE' },
  { id: 'unconverted-currency-not-counted', arithmetic: 'A USD100 event with no exchange rate for its date is never summed under an INR dictionary: it is not counted, and coverage is partial (BK-19).', facts: [fact('foreign', 'sale', '100', { currency: 'USD' })], request: request('earned'), expected: { ...sum('0'), countedRows: 0, excludedRows: 1, completeness: 'partial' } },
  { id: 'duplicate-invoice-link-rejected', arithmetic: 'Distinct invoice claims sharing I/C are ambiguous; never duplicate the same payment across two invoice balances.', facts: [fact('first', 'invoice', '100', { invoiceId: 'I', customerId: 'C', dueDate: '2026-09-15' }), fact('second', 'invoice', '100', { invoiceId: 'I', customerId: 'C', dueDate: '2026-09-15' }), fact('payment', 'payment', '25', { invoiceId: 'I', customerId: 'C' })], request: request('aging', { onDate: '2026-09-30' }), rejectCode: 'AGING_AMBIGUOUS_INVOICE' },
  { id: 'missing-customer-link-rejected', arithmetic: 'Invoice identity, customer identity and due date are all needed for an aging balance.', facts: [fact('invoice', 'invoice', '100', { invoiceId: 'I', dueDate: '2026-09-15' })], request: request('aging', { onDate: '2026-09-30' }), rejectCode: 'AGING_LINK_REQUIRED' },
];

export async function prepareDatabaseFixture(fixture: DatabaseFixture, store: StateStore = new FixtureStateStore()): Promise<{ store: StateStore; calculator: CalculatorService }> {
  const draft = structuredClone(starterPacks.find(pack => pack.pack === (fixture.pack ?? 'ecommerce'))!);
  if (fixture.nulls) for (const definition of draft.definitions) definition.nulls = fixture.nulls;
  await new OntologyService(store).publish(fixtureOwner, draft);
  await new MemoryService(store).append(fixtureOwner, structuredClone(fixture.facts));
  return { store, calculator: new CalculatorService(store) };
}

export function assertFixtureReceipt(fixture: DatabaseFixture, receipt: CalculationReceipt): void {
  assert.ok(fixture.expected, `${fixture.id}: this case expects refusal`);
  assert.equal(receipt.valueMinor, fixture.expected.primary, `${fixture.id}: primary answer`);
  assert.equal(receipt.totalMinor, fixture.expected.primary, `${fixture.id}: total answer`);
  assert.deepEqual(Object.fromEntries(receipt.figures.map(figure => [figure.key, figure.minor])), fixture.expected.figures, `${fixture.id}: every figure, including absent undefined ratios`);
  if (fixture.expected.countedRows !== undefined) assert.equal(receipt.coverage.countedRows, fixture.expected.countedRows, fixture.id);
  if (fixture.expected.selectedRows !== undefined) assert.equal(receipt.coverage.selectedRows, fixture.expected.selectedRows, fixture.id);
  if (fixture.expected.excludedRows !== undefined) assert.equal(receipt.coverage.excludedRows, fixture.expected.excludedRows, fixture.id);
  if (fixture.expected.completeness !== undefined) assert.equal(receipt.coverage.completeness, fixture.expected.completeness, fixture.id);
  if (fixture.expected.conflicts !== undefined) assert.equal(receipt.coverage.unresolvedConflicts, fixture.expected.conflicts, fixture.id);
  if (['missing-amount-explicitly-excluded', 'all-amounts-unknown-remains-partial'].includes(fixture.id)) assert.ok(receipt.coverage.gaps.some(gap => gap.includes('unknown') && gap.includes('not zero')), fixture.id);
}

export function hugeDecimalImport(): ImportInput {
  return { sourceId: 'real-engine-exact-decimals', format: 'csv', content: 'id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch\nhuge,sale,2026-09-10,9007199254740993.91,INR,C,H,O,,delivered,Exact source decimal,main\nsmall,sale,2026-09-10,0.09,INR,C,S,O,,delivered,Nine minor units,main\n', expectedTotals: { rowCount: 2, amountMinor: '900719925474099400' } };
}

export function exactCurrencyImport(): ImportInput {
  const recipe = structuredClone(demoRecipe);
  const amount = recipe.bindings.find(binding => binding.target === 'amountMinor')!;
  amount.currency = 'USD'; amount.fx = { numerator: '83', denominator: '1', rounding: 'exact' };
  return { sourceId: 'real-engine-exact-currency', format: 'csv', recipe, content: 'id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch\nforeign,sale,2026-09-10,10.25,USD,C,F,O,,delivered,Explicit exact currency conversion,west\n', expectedTotals: { rowCount: 1, amountMinor: '85075' } };
}
