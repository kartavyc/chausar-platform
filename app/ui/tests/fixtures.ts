import type {
  ApprovalView, CAConsoleView, CalculationReceiptEvidence, ChartView, MoneyFigure,
  PhoneHeadlineView, RowView, TodayView,
} from '../src/bridge/presentation.ts';

/** Synthetic, source-shaped fixtures. They make no claim about a live business. */
export const HUGE_INTEGER = '900719925474099312345678901234567890';
export const FUTURE_EXPIRY = '2030-01-01T00:00:00.000Z';

export function moneyFigure(paise = HUGE_INTEGER): MoneyFigure {
  return { kind: 'money', currency: 'INR', paise, receiptId: 'receipt_fixture', labels: [] };
}

export function rowFixture(id = 'row_fixture'): RowView {
  return {
    id, mark: 'you', title: 'Review this fixture', note: '',
    figure: moneyFigure('0'), action: { type: 'open-sheet', address: '#/work/approvals?sheet=fixture' },
  };
}

export function chartFixture(): ChartView {
  return {
    kind: 'line', description: 'Fixture values with an explicit unknown month.',
    points: [
      { id: 'aug', label: 'August', value: moneyFigure('-200') },
      { id: 'sep', label: 'September', value: { kind: 'missing', state: 'unknown' } },
      { id: 'oct', label: 'October', value: moneyFigure(HUGE_INTEGER) },
    ],
  };
}

export function todayFixture(): TodayView {
  return {
    title: 'Today', date: '2026-10-01', pendingCount: null,
    attention: [rowFixture()], worthLook: [],
    stats: [{ id: 'margin', label: 'Contribution', figure: moneyFigure('275'), chart: null }],
    dayEvents: [{ id: 'event_fixture', at: '2026-10-01T09:00:00.000Z', mark: 'cha', label: 'Fixture read' }],
    state: { kind: 'partial', asOf: '2026-10-01T09:00:00.000Z', reasonCode: 'COVERAGE_PARTIAL' },
  };
}

export function receiptEvidenceFixture(): CalculationReceiptEvidence {
  return {
    id: 'receipt_fixture', memberId: 'member_fixture', epoch: 1,
    sourceIds: ['source_orders', 'source_costs'], operation: 'margin',
    createdAt: '2026-10-01T09:00:00.000Z', asOf: '2026-10-01T09:00:00.000Z',
    period: { from: '2026-09-01', to: '2026-09-30' }, comparePeriod: null, branch: null,
    currency: 'INR', ontologyVersion: 1, dictionaryHash: 'a'.repeat(64), definitionHash: 'b'.repeat(64),
    figures: [
      { key: 'earned', label: 'Earned', minor: '900', display: 'INR 9.00', unit: 'money', currency: 'INR' },
      { key: 'refunds', label: 'Refunds', minor: '100', display: 'INR 1.00', unit: 'money', currency: 'INR' },
      { key: 'netSales', label: 'Net sales', minor: '800', display: 'INR 8.00', unit: 'money', currency: 'INR' },
      { key: 'costs', label: 'Imported costs', minor: '525', display: 'INR 5.25', unit: 'money', currency: 'INR' },
      { key: 'contribution', label: 'Contribution', minor: '275', display: 'INR 2.75', unit: 'money', currency: 'INR' },
      { key: 'marginBps', label: 'Margin in basis points (truncated)', minor: '3437', display: '3437 bps', unit: 'basis-points' },
    ],
    valueMinor: '275', totalMinor: '275', rowIds: ['fact_earned', 'fact_refund', 'fact_cost'],
    rows: [
      { factId: 'fact_earned', entityId: 'order_fixture', sourceId: 'source_orders', sourceRow: 1, kind: 'order', amountMinor: '900', validFrom: '2026-09-01' },
      { factId: 'fact_refund', entityId: 'refund_fixture', sourceId: 'source_orders', sourceRow: 2, kind: 'refund', amountMinor: '100', validFrom: '2026-09-02' },
      { factId: 'fact_cost', entityId: 'cost_fixture', sourceId: 'source_costs', sourceRow: 1, kind: 'cost', amountMinor: '525', validFrom: '2026-09-03' },
    ],
    exclusions: [{ rowId: 'fact_outside_period', reason: 'Outside the requested event period.' }],
    coverage: {
      selectedRows: 3, countedRows: 3, excludedRows: 1, unresolvedConflicts: 0,
      importIds: ['import_orders', 'import_costs'], completeness: 'reconciled-imports',
      gaps: ['Contribution includes imported costs only.'],
    },
    assumptions: {}, explanation: 'Synthetic fixture. Contribution: INR 2.75.', stale: false,
    allowedNumbers: ['900', '100', '800', '525', '275', '3437', '9.00', '1.00', '8.00', '5.25', '2.75', '3', '1'],
  };
}

export function fullCalculationReceiptFixture() {
  return {
    ...receiptEvidenceFixture(),
    definitions: [
      { name: 'earned', label: 'Earned', meaning: 'Fixture order earnings.', kind: 'order', field: 'amountMinor', currency: 'INR', nulls: 'reject' },
      { name: 'refunds', label: 'Refunds', meaning: 'Fixture refund events.', kind: 'refund', field: 'amountMinor', currency: 'INR', nulls: 'reject' },
      { name: 'costs', label: 'Costs', meaning: 'Fixture imported costs.', kind: 'cost', field: 'amountMinor', currency: 'INR', nulls: 'reject' },
    ],
    databaseProof: { fixture: true, method: 'test-only' },
  };
}

export function approvalFixture(): ApprovalView {
  return {
    id: 'approval_fixture', kind: 'message', state: 'prepared', title: 'Review the exact fixture', note: '',
    can: ['approve', 'notNow', 'change', 'drop'], readOnly: false, prepareOnly: false,
    needsSecondAsk: false, digest: 'c'.repeat(64), revision: 1,
  };
}

export function phoneFixture(): PhoneHeadlineView {
  return {
    id: 'headline_fixture', template: 'review-waiting', linkId: 'link_fixture',
    approval: { policy: 'simple-reversible', expiresAt: FUTURE_EXPIRY, actions: ['approve', 'notNow', 'open-app'] },
  };
}

export function caFixture(): CAConsoleView {
  return {
    title: 'Clients', capability: { state: 'missing', reasonCode: 'CA_ADAPTER_NOT_BUILT' },
    clients: [{ clientId: 'client_fixture', clientLabel: 'Fixture client company', booksReadAt: null, closeState: 'unknown', awaitingFirm: null, nextDueDate: null }],
  };
}

export function jsonCopy<T>(value: T): T { return structuredClone(value); }
