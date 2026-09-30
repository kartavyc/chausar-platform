import type {
  CompanyRules, ControlTotal, GoldenCase, MappingPack, OntologyContract,
  OperationExpectation, OperationId, SourceBatch, SourceReport, SourceRow,
} from '../src/contracts.ts';

/**
 * Independently authored fixture evidence. No mapper is imported here, and no
 * expected monetary control or operation value is computed from source rows.
 * These are disclosed synthetic businesses, not sealed real-company holdouts.
 * The harness replaces the digest placeholders after preserving these values.
 */
const HASH_PENDING = 'root-must-fill-sha256';
const operations: OperationId[] = ['billed', 'earned', 'refunds', 'received', 'purchases', 'costs', 'net_sales'];
type MoneyValues = OperationExpectation['values'];
type ExpectedValues = Record<OperationId, MoneyValues>;

export type SyntheticQualificationCase = {
  /** Template provenance is distinct across tuning and disclosed holdout. */
  originFamily: 'tuning-source-v1' | 'holdout-inclusive-dmy-v1';
  pack: MappingPack;
  goldenCase: GoldenCase;
  rules: CompanyRules;
  batch: SourceBatch;
  report: SourceReport;
};

const ontology: OntologyContract = {
  version: 'synthetic-register-ontology-v1',
  definitions: {
    invoice: { amount: 'net-excluding-tax', dateBasis: 'event-date' },
    sale: { amount: 'net-excluding-tax', dateBasis: 'event-date' },
    refund: { amount: 'net-excluding-tax', dateBasis: 'event-date' },
    payment: { amount: 'net-excluding-tax', dateBasis: 'event-date' },
    purchase: { amount: 'net-excluding-tax', dateBasis: 'event-date' },
    cost: { amount: 'net-excluding-tax', dateBasis: 'event-date' },
  },
  operations,
};

const pack: MappingPack = {
  contractVersion: 1,
  id: 'synthetic-register-tax-exclusive',
  version: '1',
  system: 'synthetic-register',
  product: { name: 'synthetic-register', version: '1', edition: 'fixture', configuration: 'tax-exclusive' },
  ontologyHash: HASH_PENDING,
  sourceSchema: { fields: {
    id: 'text', type: 'text', date: 'text', amount: 'text', tax: 'text', currency: 'text',
    status: 'text', company: 'text', branch: 'text', taxRegistration: 'text',
    quantity: 'text', unit: 'text', related: 'text',
  } },
  bindings: {
    identity: 'id', kind: 'type', date: 'date', amount: 'amount', tax: 'tax', currency: 'currency',
    status: 'status', company: 'company', branch: 'branch', taxRegistration: 'taxRegistration',
    quantity: 'quantity', unit: 'unit', relatedIdentity: 'related',
  },
  semantics: {
    taxInclusion: 'exclusive', amountUnit: 'major', dateFormat: 'ISO', dateBasis: 'event-date',
    calendar: 'gregorian-date',
    kindValues: { invoice: 'invoice', sale: 'sale', refund: 'refund', payment: 'payment', purchase: 'purchase', cost: 'cost' },
    statusValues: { posted: 'include', cancelled: 'exclude-cancelled', draft: 'exclude-draft', bounced: 'exclude-bounced' },
    refundSign: 'positive', refundsRequireLink: true,
    missing: 'abstain', unknownState: 'abstain', onSchemaDrift: 'invalidate', quantityScale: 3,
  },
  provenanceIds: ['synthetic-register-independent-v1'],
};

/** Independently specified template: renamed fields, gross money and DMY dates. */
const holdoutPack: MappingPack = {
  contractVersion: 1,
  id: 'synthetic-register-holdout-inclusive-dmy',
  version: '1',
  system: 'synthetic-register',
  product: { name: 'synthetic-register', version: '1', edition: 'fixture', configuration: 'holdout-inclusive-dmy-v1' },
  ontologyHash: HASH_PENDING,
  sourceSchema: { fields: {
    document_id: 'text', event_type: 'text', event_on: 'text', gross_value: 'text', tax_value: 'text', currency_code: 'text',
    state: 'text', business_key: 'text', branch_key: 'text', tax_registration: 'text',
    units: 'text', unit_code: 'text', original_document: 'text',
  } },
  bindings: {
    identity: 'document_id', kind: 'event_type', date: 'event_on', amount: 'gross_value', tax: 'tax_value', currency: 'currency_code',
    status: 'state', company: 'business_key', branch: 'branch_key', taxRegistration: 'tax_registration',
    quantity: 'units', unit: 'unit_code', relatedIdentity: 'original_document',
  },
  semantics: {
    taxInclusion: 'inclusive', amountUnit: 'major', dateFormat: 'DMY', dateBasis: 'event-date',
    calendar: 'gregorian-date',
    kindValues: { invoice: 'invoice', sale: 'sale', refund: 'refund', payment: 'payment', purchase: 'purchase', cost: 'cost' },
    statusValues: { posted: 'include', cancelled: 'exclude-cancelled', draft: 'exclude-draft', bounced: 'exclude-bounced' },
    refundSign: 'positive', refundsRequireLink: true,
    missing: 'abstain', unknownState: 'abstain', onSchemaDrift: 'invalidate', quantityScale: 3,
  },
  provenanceIds: ['synthetic-register-independent-v1'],
};

function companyRules(company: string): CompanyRules {
  return {
    contractVersion: 1, id: `${company}-rules`, version: '1', packHash: HASH_PENDING,
    company, branches: ['main'], taxRegistrations: ['synthetic-tax'], timezone: 'Asia/Kolkata',
    currencies: { INR: { scale: 2 }, JPY: { scale: 0 }, USD: { scale: 2 } },
    units: {
      pcs: { canonical: 'pcs', numerator: '1', denominator: '1' },
      box: { canonical: 'pcs', numerator: '12', denominator: '1' },
    },
    period: { from: '2026-04-01', to: '2026-04-30' },
    provenanceIds: ['synthetic-register-independent-v1'],
  };
}

type RowDetails = Partial<Pick<SourceRow, 'date' | 'status' | 'quantity' | 'unit' | 'related'>>;
function row(company: string, id: string, type: string, amount: string | null, tax: string | null, currency: string, details: RowDetails = {}): SourceRow {
  return {
    id, type, date: '2026-04-10', amount, tax, currency, status: 'posted',
    company, branch: 'main', taxRegistration: 'synthetic-tax',
    quantity: '0.000', unit: 'pcs', related: '', ...details,
  };
}

/** Gross amounts and DMY dates below are literal authored evidence, not conversions. */
function holdoutRow(company: string, id: string, type: string, gross: string | null, tax: string | null, currency: string, details: RowDetails = {}): SourceRow {
  return {
    document_id: id, event_type: type, event_on: details.date ?? '10/04/2026',
    gross_value: gross, tax_value: tax, currency_code: currency, state: details.status ?? 'posted',
    business_key: company, branch_key: 'main', tax_registration: 'synthetic-tax',
    units: details.quantity ?? '0.000', unit_code: details.unit ?? 'pcs', original_document: details.related ?? '',
  };
}

function inr(minor: string): MoneyValues { return [{ currency: 'INR', minor }]; }
function threeCurrencies(inrMinor: string, jpyMinor: string, usdMinor: string): MoneyValues {
  return [{ currency: 'INR', minor: inrMinor }, { currency: 'JPY', minor: jpyMinor }, { currency: 'USD', minor: usdMinor }];
}
function expectations(values: ExpectedValues): OperationExpectation[] {
  return operations.map(operation => ({ operation, values: values[operation] }));
}
function emptyExpectations(): OperationExpectation[] {
  return expectations({ billed: [], earned: [], refunds: [], received: [], purchases: [], costs: [], net_sales: [] });
}

type CaseInput = {
  id: string; company: string; split: GoldenCase['split']; rows: SourceRow[];
  included: number; excluded: number; totals: ControlTotal[];
  expectations: OperationExpectation[]; rationale: string;
  expectedDecision?: GoldenCase['expectedDecision']; expectedIssueCodes?: string[];
};
function businessCase(input: CaseInput): SyntheticQualificationCase {
  const datasetId = `${input.id}-dataset-v1`;
  const snapshotId = `${input.id}-snapshot-v1`;
  const rules = companyRules(input.company);
  const casePack = input.split === 'holdout' ? holdoutPack : pack;
  const originFamily = input.split === 'holdout' ? 'holdout-inclusive-dmy-v1' : 'tuning-source-v1';
  return {
    originFamily,
    pack: casePack,
    goldenCase: {
      id: input.id, businessId: input.company, datasetId, rationale: input.rationale,
      split: input.split, expectedDecision: input.expectedDecision ?? 'qualified',
      expectedIssueCodes: input.expectedIssueCodes ?? [], expectations: input.expectations,
      semanticAssertions: [], exclusionAssertions: [],
    },
    rules,
    batch: {
      receiptId: `${input.id}-receipt-v1`, datasetId, system: casePack.system, product: casePack.product,
      company: input.company, schema: casePack.sourceSchema, rows: input.rows,
      rowsHash: HASH_PENDING, complete: true, snapshotId,
      origins: { business: input.company, template: originFamily, configuration: casePack.product.configuration },
    },
    report: {
      reportId: `${input.id}-hand-report-v1`, datasetId, origin: 'independent-source-report',
      captureMethod: 'hand-worked-synthetic', evidenceHash: HASH_PENDING,
      company: input.company, system: casePack.system, snapshotId, dateBasis: 'event-date',
      period: rules.period, branches: rules.branches, taxRegistrations: rules.taxRegistrations,
      sourceRowCount: input.rows.length, includedRowCount: input.included, excludedRowCount: input.excluded,
      totals: input.totals,
    },
  };
}

/** Return fresh fixture objects so mutation tests cannot alter later invocations. */
export function makeSyntheticCases(): { pack: MappingPack; ontology: OntologyContract; cases: SyntheticQualificationCase[] } {
  const cases: SyntheticQualificationCase[] = [
    businessCase({
      id: 'tuning-retail-separated-events', company: 'synthetic-tuning-retail', split: 'tuning',
      rows: [
        row('synthetic-tuning-retail', 'TR-INV-1', 'invoice', '1200.00', '216.00', 'INR', { quantity: '2.000' }),
        row('synthetic-tuning-retail', 'TR-SALE-1', 'sale', '1000.00', '180.00', 'INR', { quantity: '3.000', unit: 'box' }),
        row('synthetic-tuning-retail', 'TR-SALE-2', 'sale', '500.00', '90.00', 'INR', { quantity: '1.000' }),
        row('synthetic-tuning-retail', 'TR-REFUND-1', 'refund', '200.00', '36.00', 'INR', { quantity: '1.000', related: 'TR-SALE-1' }),
        row('synthetic-tuning-retail', 'TR-PAY-1', 'payment', '800.00', '0.00', 'INR'),
        row('synthetic-tuning-retail', 'TR-PURCHASE-1', 'purchase', '600.00', '108.00', 'INR', { quantity: '5.000' }),
        row('synthetic-tuning-retail', 'TR-COST-1', 'cost', '50.00', '9.00', 'INR'),
        row('synthetic-tuning-retail', 'TR-CANCELLED-1', 'sale', '999.00', '179.82', 'INR', { status: 'cancelled', quantity: '1.000' }),
        row('synthetic-tuning-retail', 'TR-DRAFT-1', 'invoice', '777.00', '139.86', 'INR', { status: 'draft', quantity: '1.000' }),
        row('synthetic-tuning-retail', 'TR-BOUNCED-1', 'payment', '123.00', '0.00', 'INR', { status: 'bounced' }),
      ],
      included: 7, excluded: 3,
      totals: [
        { kind: 'invoice', currency: 'INR', netMinor: '120000', taxMinor: '21600', grossMinor: '141600' },
        { kind: 'sale', currency: 'INR', netMinor: '150000', taxMinor: '27000', grossMinor: '177000' },
        { kind: 'refund', currency: 'INR', netMinor: '20000', taxMinor: '3600', grossMinor: '23600' },
        { kind: 'payment', currency: 'INR', netMinor: '80000', taxMinor: '0', grossMinor: '80000' },
        { kind: 'purchase', currency: 'INR', netMinor: '60000', taxMinor: '10800', grossMinor: '70800' },
        { kind: 'cost', currency: 'INR', netMinor: '5000', taxMinor: '900', grossMinor: '5900' },
      ],
      expectations: expectations({ billed: inr('120000'), earned: inr('150000'), refunds: inr('20000'), received: inr('80000'), purchases: inr('60000'), costs: inr('5000'), net_sales: inr('130000') }),
      rationale: 'Hand calculation: billed 1200.00; earned 1000.00 + 500.00 = 1500.00; one refund 200.00 links to TR-SALE-1, so net sales 1500.00 - 200.00 = 1300.00. Received is gross settled cash 800.00 with zero tax; purchase 600.00 and cost 50.00 each belong only to their own operation. Exclusive sale tax 180.00 + 90.00 = 270.00 gives gross 1770.00; invoice gross 1416.00; refund gross 236.00; purchase gross 708.00; cost gross 59.00. Cancelled 999.00, draft 777.00 and bounced 123.00 are excluded exactly once. Quantity 3.000 boxes times 12 = 36.000 pcs. Billed, earned, refunds, purchases, costs and net sales exclude tax; received includes cash tax.',
    }),
    businessCase({
      id: 'tuning-zero-and-large-money', company: 'synthetic-tuning-exact-money', split: 'tuning',
      rows: [
        row('synthetic-tuning-exact-money', 'TE-SALE-HUGE', 'sale', '9007199254740993.12', '0.88', 'INR', { quantity: '1.000' }),
        row('synthetic-tuning-exact-money', 'TE-SALE-ZERO', 'sale', '0.00', '0.00', 'INR', { quantity: '0.000' }),
        row('synthetic-tuning-exact-money', 'TE-INV-ZERO', 'invoice', '0.00', '0.00', 'INR'),
      ],
      included: 3, excluded: 0,
      totals: [
        { kind: 'invoice', currency: 'INR', netMinor: '0', taxMinor: '0', grossMinor: '0' },
        { kind: 'sale', currency: 'INR', netMinor: '900719925474099312', taxMinor: '88', grossMinor: '900719925474099400' },
      ],
      expectations: expectations({ billed: inr('0'), earned: inr('900719925474099312'), refunds: inr('0'), received: inr('0'), purchases: inr('0'), costs: inr('0'), net_sales: inr('900719925474099312') }),
      rationale: 'Hand calculation: 9007199254740993.12 major INR is 900719925474099312 minor INR; adding explicit zero changes nothing. Tax 0.88 is 88 minor, giving gross 900719925474099400. Billed zero is valid data. Earned and net sales are identical because no refunds exist. This amount exceeds JavaScript safe integer precision before and after minor-unit conversion.',
    }),
    businessCase({
      id: 'tuning-separated-currencies', company: 'synthetic-tuning-currencies', split: 'tuning',
      rows: [
        row('synthetic-tuning-currencies', 'TC-INR-SALE', 'sale', '100.00', '18.00', 'INR', { quantity: '1.000' }),
        row('synthetic-tuning-currencies', 'TC-USD-SALE', 'sale', '10.01', '0.80', 'USD', { quantity: '1.000' }),
        row('synthetic-tuning-currencies', 'TC-JPY-SALE', 'sale', '1000', '80', 'JPY', { quantity: '1.000' }),
        row('synthetic-tuning-currencies', 'TC-USD-INV', 'invoice', '5.00', '0.40', 'USD'),
        row('synthetic-tuning-currencies', 'TC-USD-REFUND', 'refund', '1.01', '0.08', 'USD', { related: 'TC-USD-SALE' }),
        row('synthetic-tuning-currencies', 'TC-INR-COST', 'cost', '2.00', '0.36', 'INR'),
      ],
      included: 6, excluded: 0,
      totals: [
        { kind: 'sale', currency: 'INR', netMinor: '10000', taxMinor: '1800', grossMinor: '11800' },
        { kind: 'sale', currency: 'JPY', netMinor: '1000', taxMinor: '80', grossMinor: '1080' },
        { kind: 'sale', currency: 'USD', netMinor: '1001', taxMinor: '80', grossMinor: '1081' },
        { kind: 'invoice', currency: 'USD', netMinor: '500', taxMinor: '40', grossMinor: '540' },
        { kind: 'refund', currency: 'USD', netMinor: '101', taxMinor: '8', grossMinor: '109' },
        { kind: 'cost', currency: 'INR', netMinor: '200', taxMinor: '36', grossMinor: '236' },
      ],
      expectations: expectations({
        billed: threeCurrencies('0', '0', '500'), earned: threeCurrencies('10000', '1000', '1001'),
        refunds: threeCurrencies('0', '0', '101'), received: threeCurrencies('0', '0', '0'),
        purchases: threeCurrencies('0', '0', '0'), costs: threeCurrencies('200', '0', '0'),
        net_sales: threeCurrencies('10000', '1000', '900'),
      }),
      rationale: 'Hand calculation by currency only: INR earned 100.00 and cost 2.00; JPY earned 1000 at scale zero; USD earned 10.01, billed 5.00, refund 1.01, net sales 10.01 - 1.01 = 9.00. INR gross sale 118.00 and cost 2.36; JPY gross sale 1080; USD gross sale 10.81, invoice 5.40 and refund 1.09. There is no cross-currency sum or exchange-rate assumption.',
    }),
    businessCase({
      id: 'holdout-wholesale-independent', company: 'synthetic-holdout-wholesale', split: 'holdout',
      rows: [
        holdoutRow('synthetic-holdout-wholesale', 'HW-INV-A', 'invoice', '2360.00', '360.00', 'INR', { date: '03/04/2026', quantity: '3.000', unit: 'box' }),
        holdoutRow('synthetic-holdout-wholesale', 'HW-SALE-A', 'sale', '1770.00', '270.00', 'INR', { date: '08/04/2026', quantity: '3.000', unit: 'box' }),
        holdoutRow('synthetic-holdout-wholesale', 'HW-SALE-B', 'sale', '295.00', '45.00', 'INR', { date: '09/04/2026', quantity: '2.000' }),
        holdoutRow('synthetic-holdout-wholesale', 'HW-REFUND-A', 'refund', '59.00', '9.00', 'INR', { date: '12/04/2026', related: 'HW-INV-A', quantity: '1.000' }),
        holdoutRow('synthetic-holdout-wholesale', 'HW-PAY-A', 'payment', '1000.00', '0.00', 'INR', { date: '13/04/2026' }),
        holdoutRow('synthetic-holdout-wholesale', 'HW-PURCHASE-A', 'purchase', '826.00', '126.00', 'INR', { date: '02/04/2026', quantity: '7.000' }),
        holdoutRow('synthetic-holdout-wholesale', 'HW-COST-A', 'cost', '47.20', '7.20', 'INR', { date: '15/04/2026' }),
        holdoutRow('synthetic-holdout-wholesale', 'HW-CANCELLED-A', 'purchase', '1062.00', '162.00', 'INR', { date: '18/04/2026', status: 'cancelled', quantity: '9.000' }),
        holdoutRow('synthetic-holdout-wholesale', 'HW-DRAFT-A', 'sale', '590.00', '90.00', 'INR', { date: '20/04/2026', status: 'draft', quantity: '5.000' }),
        holdoutRow('synthetic-holdout-wholesale', 'HW-BOUNCED-A', 'payment', '60.00', '0.00', 'INR', { date: '22/04/2026', status: 'bounced' }),
      ],
      included: 7, excluded: 3,
      totals: [
        { kind: 'invoice', currency: 'INR', netMinor: '200000', taxMinor: '36000', grossMinor: '236000' },
        { kind: 'sale', currency: 'INR', netMinor: '175000', taxMinor: '31500', grossMinor: '206500' },
        { kind: 'refund', currency: 'INR', netMinor: '5000', taxMinor: '900', grossMinor: '5900' },
        { kind: 'payment', currency: 'INR', netMinor: '100000', taxMinor: '0', grossMinor: '100000' },
        { kind: 'purchase', currency: 'INR', netMinor: '70000', taxMinor: '12600', grossMinor: '82600' },
        { kind: 'cost', currency: 'INR', netMinor: '4000', taxMinor: '720', grossMinor: '4720' },
      ],
      expectations: expectations({ billed: inr('200000'), earned: inr('175000'), refunds: inr('5000'), received: inr('100000'), purchases: inr('70000'), costs: inr('4000'), net_sales: inr('175000') }),
      rationale: 'Independent disclosed holdout uses renamed raw fields, DMY dates and tax-inclusive source money. Hand calculation: invoice gross 2360.00 - tax 360.00 = issued billed 2000.00; sale nets (1770.00 - 270.00) + (295.00 - 45.00) = earned 1750.00. Refund gross 59.00 - tax 9.00 = 50.00 is an invoice-only credit linked to HW-INV-A. It contributes to refunds but establishes no delivered-goods reversal: no sale-linked refund exists, so net sales remain 1750.00. Received is gross settled cash 1000.00 with zero tax; purchase net 826.00 - 126.00 = 700.00 and cost net 47.20 - 7.20 = 40.00 stay separate. Sale tax 315.00 gives gross 2065.00. Three excluded records remain covered. Each 3.000 box quantity is exactly 36.000 pcs. Neither company, rows nor raw-template family appears in tuning.',
    }),
    businessCase({
      id: 'holdout-crosscurrency-independent', company: 'synthetic-holdout-crosscurrency', split: 'holdout',
      rows: [
        holdoutRow('synthetic-holdout-crosscurrency', 'HX-JPY-INV', 'invoice', '3240', '240', 'JPY', { date: '01/04/2026' }),
        holdoutRow('synthetic-holdout-crosscurrency', 'HX-JPY-SALE', 'sale', '2700', '200', 'JPY', { date: '07/04/2026', quantity: '2.000' }),
        holdoutRow('synthetic-holdout-crosscurrency', 'HX-JPY-REFUND', 'refund', '540', '40', 'JPY', { date: '11/04/2026', related: 'HX-JPY-SALE' }),
        holdoutRow('synthetic-holdout-crosscurrency', 'HX-USD-PAY', 'payment', '7.25', '0.00', 'USD', { date: '16/04/2026' }),
        holdoutRow('synthetic-holdout-crosscurrency', 'HX-INR-COST', 'cost', '0.59', '0.09', 'INR', { date: '21/04/2026' }),
        holdoutRow('synthetic-holdout-crosscurrency', 'HX-USD-PURCHASE', 'purchase', '5.40', '0.40', 'USD', { date: '30/04/2026', quantity: '1.000' }),
      ],
      included: 6, excluded: 0,
      totals: [
        { kind: 'invoice', currency: 'JPY', netMinor: '3000', taxMinor: '240', grossMinor: '3240' },
        { kind: 'sale', currency: 'JPY', netMinor: '2500', taxMinor: '200', grossMinor: '2700' },
        { kind: 'refund', currency: 'JPY', netMinor: '500', taxMinor: '40', grossMinor: '540' },
        { kind: 'payment', currency: 'USD', netMinor: '725', taxMinor: '0', grossMinor: '725' },
        { kind: 'cost', currency: 'INR', netMinor: '50', taxMinor: '9', grossMinor: '59' },
        { kind: 'purchase', currency: 'USD', netMinor: '500', taxMinor: '40', grossMinor: '540' },
      ],
      expectations: expectations({
        billed: threeCurrencies('0', '3000', '0'), earned: threeCurrencies('0', '2500', '0'),
        refunds: threeCurrencies('0', '500', '0'), received: threeCurrencies('0', '0', '725'),
        purchases: threeCurrencies('0', '0', '500'), costs: threeCurrencies('50', '0', '0'),
        net_sales: threeCurrencies('0', '2000', '0'),
      }),
      rationale: 'Independent disclosed inclusive-DMY holdout calculation: JPY invoice 3240 - 240 = 3000, sale 2700 - 200 = 2500, refund 540 - 40 = 500, net sales 2000; scale zero remains explicit. USD receipt 7.25 is 725 minor; purchase 5.40 - 0.40 = 5.00 is 500 minor. INR cost 0.59 - 0.09 = 0.50 is 50 minor. DMY 01/04/2026 and 30/04/2026 are included April boundary dates, not month/day guesses. All three currencies remain separate, with explicit zero values in operations having no corresponding kind.',
    }),
    businessCase({
      id: 'holdout-large-and-explicit-zero', company: 'synthetic-holdout-large-money', split: 'holdout',
      rows: [
        holdoutRow('synthetic-holdout-large-money', 'HL-SALE', 'sale', '1000000000000000000.00', '0.01', 'INR', { date: '04/04/2026', quantity: '1.000' }),
        holdoutRow('synthetic-holdout-large-money', 'HL-REFUND-ZERO', 'refund', '0.00', '0.00', 'INR', { date: '05/04/2026', related: 'HL-SALE' }),
        holdoutRow('synthetic-holdout-large-money', 'HL-INVOICE-ZERO', 'invoice', '0.00', '0.00', 'INR', { date: '06/04/2026' }),
        holdoutRow('synthetic-holdout-large-money', 'HL-PAY-ZERO', 'payment', '0.00', '0.00', 'INR', { date: '07/04/2026' }),
        holdoutRow('synthetic-holdout-large-money', 'HL-PURCHASE-ZERO', 'purchase', '0.00', '0.00', 'INR', { date: '08/04/2026' }),
        holdoutRow('synthetic-holdout-large-money', 'HL-COST-ZERO', 'cost', '0.00', '0.00', 'INR', { date: '09/04/2026' }),
      ],
      included: 6, excluded: 0,
      totals: [
        { kind: 'sale', currency: 'INR', netMinor: '99999999999999999999', taxMinor: '1', grossMinor: '100000000000000000000' },
        { kind: 'refund', currency: 'INR', netMinor: '0', taxMinor: '0', grossMinor: '0' },
        { kind: 'invoice', currency: 'INR', netMinor: '0', taxMinor: '0', grossMinor: '0' },
        { kind: 'payment', currency: 'INR', netMinor: '0', taxMinor: '0', grossMinor: '0' },
        { kind: 'purchase', currency: 'INR', netMinor: '0', taxMinor: '0', grossMinor: '0' },
        { kind: 'cost', currency: 'INR', netMinor: '0', taxMinor: '0', grossMinor: '0' },
      ],
      expectations: expectations({ billed: inr('0'), earned: inr('99999999999999999999'), refunds: inr('0'), received: inr('0'), purchases: inr('0'), costs: inr('0'), net_sales: inr('99999999999999999999') }),
      rationale: 'Independent disclosed inclusive-DMY holdout calculation: gross 1000000000000000000.00 INR less tax 0.01 gives net 999999999999999999.99, or 99999999999999999999 minor. Gross is 100000000000000000000 minor. A linked refund of explicit zero leaves net sales unchanged. Explicit zero invoice, payment, purchase and cost each produce valid zero controls, unlike absent or null money. This independently chosen amount exceeds JavaScript safe integer precision.',
    }),
    businessCase({
      id: 'tuning-taxed-settled-cash', company: 'synthetic-tuning-taxed-cash', split: 'tuning',
      rows: [row('synthetic-tuning-taxed-cash', 'TP-SETTLED', 'payment', '100.00', '18.00', 'INR', { date: '2026-04-27' })],
      included: 1, excluded: 0,
      totals: [{ kind: 'payment', currency: 'INR', netMinor: '10000', taxMinor: '1800', grossMinor: '11800' }],
      expectations: expectations({ billed: inr('0'), earned: inr('0'), refunds: inr('0'), received: inr('11800'), purchases: inr('0'), costs: inr('0'), net_sales: inr('0') }),
      rationale: 'Hand calculation for settled cash: exclusive payment net 100.00 plus tax 18.00 is gross receipt 118.00, or 11800 minor INR. Received must use gross cash, including the tax portion. Canonical net 10000 and tax 1800 remain separately reconciled. A payment creates no invoice, earned sale, refund, purchase, cost or net sale.',
    }),
    businessCase({
      id: 'holdout-taxed-settled-cash', company: 'synthetic-holdout-taxed-cash', split: 'holdout',
      rows: [holdoutRow('synthetic-holdout-taxed-cash', 'HP-SETTLED', 'payment', '59.00', '9.00', 'INR', { date: '29/04/2026' })],
      included: 1, excluded: 0,
      totals: [{ kind: 'payment', currency: 'INR', netMinor: '5000', taxMinor: '900', grossMinor: '5900' }],
      expectations: expectations({ billed: inr('0'), earned: inr('0'), refunds: inr('0'), received: inr('5900'), purchases: inr('0'), costs: inr('0'), net_sales: inr('0') }),
      rationale: 'Independent disclosed inclusive-DMY holdout calculation: settled payment gross 59.00 includes tax 9.00; canonical net is 59.00 - 9.00 = 50.00, or 5000 minor. Received is the full cash receipt 5900 minor, not canonical net 5000. Tax 900 and gross 5900 reconcile separately. All six other operations are zero because no corresponding business events exist.',
    }),
    businessCase({
      id: 'tuning-null-amount-abstains', company: 'synthetic-tuning-missing-amount', split: 'tuning',
      rows: [row('synthetic-tuning-missing-amount', 'TM-SALE', 'sale', null, '0.00', 'INR')],
      included: 0, excluded: 0, totals: [], expectations: emptyExpectations(),
      expectedDecision: 'abstained', expectedIssueCodes: ['MISSING_VALUE'],
      rationale: 'Null sale amount is unknown, not zero. No operation is qualified and no partial facts may escape. Empty controls are deliberate rejection-fixture evidence and must never pass as a reconciled source report.',
    }),
    businessCase({
      id: 'holdout-null-tax-abstains', company: 'synthetic-holdout-missing-tax', split: 'holdout',
      rows: [holdoutRow('synthetic-holdout-missing-tax', 'HM-INVOICE', 'invoice', '12.50', null, 'INR', { date: '17/04/2026' })],
      included: 0, excluded: 0, totals: [], expectations: emptyExpectations(),
      expectedDecision: 'abstained', expectedIssueCodes: ['MISSING_VALUE'],
      rationale: 'A known inclusive gross amount 12.50 does not make null tax or net amount known. All operations abstain before report reconciliation; no zero-tax guess is authorized. Company, source row and inclusive-DMY template are distinct from tuning.',
    }),
    businessCase({
      id: 'holdout-unknown-status-abstains', company: 'synthetic-holdout-unknown-state', split: 'holdout',
      rows: [holdoutRow('synthetic-holdout-unknown-state', 'HS-INVOICE', 'invoice', '130.98', '19.98', 'INR', { status: 'approved', date: '19/04/2026' })],
      included: 0, excluded: 0, totals: [], expectations: emptyExpectations(),
      expectedDecision: 'abstained', expectedIssueCodes: ['UNKNOWN_STATE'],
      rationale: 'Approved is not one of posted, cancelled, draft or bounced. Its inclusion cannot be inferred from its wording; every operation abstains and requests clarification. Zero report controls do not authorize dropping an unknown state.',
    }),
    businessCase({
      id: 'tuning-impossible-date-abstains', company: 'synthetic-tuning-impossible-date', split: 'tuning',
      rows: [row('synthetic-tuning-impossible-date', 'TD-SALE', 'sale', '15.00', '2.70', 'INR', { date: '2026-04-31' })],
      included: 0, excluded: 0, totals: [], expectations: emptyExpectations(),
      expectedDecision: 'abstained', expectedIssueCodes: ['INVALID_DATE'],
      rationale: 'April has 30 days. The literal 2026-04-31 is impossible and must not roll into May or be silently excluded as outside April. No qualified monetary value is expected.',
    }),
    businessCase({
      id: 'holdout-refund-without-link-abstains', company: 'synthetic-holdout-orphan-refund', split: 'holdout',
      rows: [holdoutRow('synthetic-holdout-orphan-refund', 'HR-REFUND', 'refund', '5.90', '0.90', 'INR', { date: '23/04/2026', related: '' })],
      included: 0, excluded: 0, totals: [], expectations: emptyExpectations(),
      expectedDecision: 'abstained', expectedIssueCodes: ['REFUND_LINK_MISSING'],
      rationale: 'Inclusive gross 5.90 less tax 0.90 would mean a positive 5.00 refund, but it has no original sale or invoice identity. The whole batch abstains despite valid decimal fields. No invented original event is allowed.',
    }),
    businessCase({
      id: 'tuning-cumulative-refund-limit-abstains', company: 'synthetic-tuning-refund-overflow', split: 'tuning',
      rows: [
        row('synthetic-tuning-refund-overflow', 'TL-SALE', 'sale', '10.00', '1.80', 'INR', { date: '2026-04-10' }),
        row('synthetic-tuning-refund-overflow', 'TL-REFUND-A', 'refund', '6.00', '1.08', 'INR', { date: '2026-04-11', related: 'TL-SALE' }),
        row('synthetic-tuning-refund-overflow', 'TL-REFUND-B', 'refund', '5.00', '0.90', 'INR', { date: '2026-04-12', related: 'TL-SALE' }),
      ],
      included: 0, excluded: 0, totals: [], expectations: emptyExpectations(),
      expectedDecision: 'abstained', expectedIssueCodes: ['REFUND_LIMIT'],
      rationale: 'Hand calculation: linked INR refunds 6.00 + 5.00 = 11.00 exceed the original INR sale 10.00. Each refund individually is below 10.00, so the test requires the cumulative limit rather than a per-row check. Entire-batch abstention prevents even the otherwise valid sale from escaping as qualified.',
    }),
    businessCase({
      id: 'holdout-unconfigured-currency-abstains', company: 'synthetic-holdout-unconfigured-currency', split: 'holdout',
      rows: [holdoutRow('synthetic-holdout-unconfigured-currency', 'HC-SALE', 'sale', '1.00', '0.00', 'EUR', { date: '24/04/2026' })],
      included: 0, excluded: 0, totals: [], expectations: emptyExpectations(),
      expectedDecision: 'abstained', expectedIssueCodes: ['CURRENCY_UNCONFIGURED'],
      rationale: 'Company rules configure INR, JPY and USD only. EUR is not inferred from ISO knowledge or assigned an assumed scale; the whole batch abstains pending explicit company configuration.',
    }),
    businessCase({
      id: 'tuning-inexact-money-abstains', company: 'synthetic-tuning-inexact-money', split: 'tuning',
      rows: [row('synthetic-tuning-inexact-money', 'TI-SALE', 'sale', '1.001', '0.00', 'INR')],
      included: 0, excluded: 0, totals: [], expectations: emptyExpectations(),
      expectedDecision: 'abstained', expectedIssueCodes: ['INEXACT_DECIMAL'],
      rationale: 'INR scale two cannot exactly represent 1.001 major units: 100.1 minor units is not an integer. Rounding would change source evidence, so every operation abstains.',
    }),
    businessCase({
      id: 'holdout-inexact-quantity-abstains', company: 'synthetic-holdout-inexact-quantity', split: 'holdout',
      rows: [holdoutRow('synthetic-holdout-inexact-quantity', 'HQ-SALE', 'sale', '29.50', '4.50', 'INR', { date: '26/04/2026', quantity: '1.0001', unit: 'pcs' })],
      included: 0, excluded: 0, totals: [], expectations: emptyExpectations(),
      expectedDecision: 'abstained', expectedIssueCodes: ['INEXACT_DECIMAL'],
      rationale: 'The declared quantity scale is three. Quantity 1.0001 pcs cannot be represented exactly at that scale, even with an identity unit conversion. Valid monetary fields do not permit the invalid quantity to be ignored; all operations abstain.',
    }),
  ];
  return structuredClone({ pack, ontology, cases });
}
