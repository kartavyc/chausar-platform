import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ReplyValidationError, projectCalculationReceipt, receiptEvidenceKeys,
  validateApproval, validateCAConsole, validateCapability, validateChart,
  validateFigure, validatePhoneHeadline, validateReceiptEvidence, validateRow,
  validateToday, validateViewState,
} from '../src/bridge/validate.ts';
import {
  HUGE_INTEGER, approvalFixture, caFixture, chartFixture, fullCalculationReceiptFixture,
  jsonCopy, moneyFigure, phoneFixture, receiptEvidenceFixture, rowFixture, todayFixture,
} from './fixtures.ts';

function invalid(read: () => unknown): void {
  assert.throws(read, (error: unknown) => {
    assert.ok(error instanceof ReplyValidationError);
    assert.equal(error.code, 'INVALID_REPLY');
    assert.equal(error.message, 'INVALID_REPLY');
    assert.equal(typeof error.path, 'string');
    assert.ok(!error.message.includes('PRIVATE_CUSTOMER_FIXTURE'));
    return true;
  });
}

function corrupt<T>(fixture: T, path: readonly string[], value: unknown): unknown {
  const result = jsonCopy(fixture);
  let parent = result as Record<string, unknown>;
  for (const part of path.slice(0, -1)) parent = parent[part] as Record<string, unknown>;
  parent[path.at(-1)!] = value;
  return result;
}

test('known figures retain exact large signed integers and distinguish zero from every missing category', () => {
  for (const paise of [HUGE_INTEGER, `-${HUGE_INTEGER}`, '0', '-1']) {
    const output = validateFigure(moneyFigure(paise));
    assert.deepEqual(output, moneyFigure(paise));
    assert.ok(Object.isFrozen(output));
  }
  for (const state of ['absent', 'null', 'unknown', 'withheld', 'not-applicable', 'not-loaded-yet', 'not-counted']) {
    assert.deepEqual(validateFigure({ kind: 'missing', state }), { kind: 'missing', state });
  }
  assert.deepEqual(validateFigure({ kind: 'count', count: HUGE_INTEGER, receiptId: 'receipt_fixture', labels: [] }), { kind: 'count', count: HUGE_INTEGER, receiptId: 'receipt_fixture', labels: [] });
  assert.deepEqual(validateFigure({ kind: 'percent', basisPoints: '-175', receiptId: 'receipt_fixture', labels: ['what-if'] }), { kind: 'percent', basisPoints: '-175', receiptId: 'receipt_fixture', labels: ['what-if'] });
});

test('financial values reject coercion, malformed labels, missing evidence and invented fields', () => {
  for (const paise of [null, undefined, 0, 9007199254740992, NaN, Infinity, '', '1e3', '1.25', '+1', ' 1', '1,000', '1\n', '1'.repeat(257)]) {
    invalid(() => validateFigure(corrupt(moneyFigure(), ['paise'], paise)));
  }
  for (const receiptId of ['', null, 123, 'x'.repeat(201)]) invalid(() => validateFigure(corrupt(moneyFigure(), ['receiptId'], receiptId)));
  for (const labels of [['reconciled'], ['seed', 'seed'], ['stale', 1], null]) invalid(() => validateFigure(corrupt(moneyFigure(), ['labels'], labels)));
  invalid(() => validateFigure({ ...moneyFigure(), currency: 'USD' }));
  invalid(() => validateFigure({ ...moneyFigure(), display: 'invented display' }));
  invalid(() => validateFigure({ kind: 'missing', state: 'unknown', paise: '0' }));
  invalid(() => validateFigure({ kind: 'missing', state: 'unavailable' }));
  invalid(() => validateFigure({ kind: 'count', count: '-1', receiptId: 'receipt_fixture', labels: [] }));
});

test('rows offer only local sheet intents and immutable presentation data', () => {
  const fixture = rowFixture();
  const row = validateRow(fixture);
  assert.deepEqual(row, fixture);
  assert.notEqual(row, fixture);
  assert.ok(Object.isFrozen(row.action));
  assert.ok(Object.isFrozen(row.figure));
  invalid(() => validateRow({ ...fixture, mark: 'success' }));
  invalid(() => validateRow({ ...fixture, title: '' }));
  invalid(() => validateRow({ ...fixture, figure: undefined }));
  for (const address of ['https://private.invalid', 'javascript:alert(1)', '#/work/../trust', '/api/rpc', '#/work/approvals\n']) {
    invalid(() => validateRow({ ...fixture, action: { type: 'open-sheet', address } }));
  }
  invalid(() => validateRow({ ...fixture, action: { type: 'execute', address: '#/work/actions' } }));
});

test('local routes preserve opaque engine sheet IDs while rejecting foreign routes and extra context', () => {
  const fixture = rowFixture();
  for (const address of ['#/today', '#/work/approvals', '#/work/approvals?sheet=action_01234567-89ab-cdef-0123-456789abcdef', '#/trust/receipts?sheet=receipt_01234567-89ab-cdef-0123-456789abcdef', '#/clients?sheet=client_A.1']) {
    assert.equal(validateRow({ ...fixture, action: { type: 'open-sheet', address } }).action?.address, address);
  }
  for (const address of ['#/foreign?sheet=action_1', '#/work/approval_list?sheet=action_1', '#/work/approvals/fixture', '#/work?sheet=action_1&sheet=action_2', '#/work?sheet=action_1&url=https://private.invalid', '#/work?other=action_1', '#/work?sheet=%2F%2Fprivate.invalid', '#/work?sheet=', `#/work?sheet=${'a'.repeat(201)}`, '#/work?sheet=action_1\n', '//private.invalid', '#//work']) {
    invalid(() => validateRow({ ...fixture, action: { type: 'open-sheet', address } }));
  }
});

test('guess rows carry no known business figure, including a genuine measured zero', () => {
  const fixture = rowFixture();
  for (const figure of [moneyFigure('0'), moneyFigure(), { kind: 'count', count: '0', receiptId: 'receipt_fixture', labels: [] }, { kind: 'percent', basisPoints: '0', receiptId: 'receipt_fixture', labels: [] }]) {
    invalid(() => validateRow({ ...fixture, mark: 'guess', figure }));
    invalid(() => validateToday({ ...todayFixture(), attention: [{ ...fixture, mark: 'guess', figure }] }));
  }
  assert.deepEqual(validateRow({ id: 'possible_cause', mark: 'guess', title: 'Possible cause', note: 'Evidence for and against.' }), { id: 'possible_cause', mark: 'guess', title: 'Possible cause', note: 'Evidence for and against.' });
  assert.deepEqual(validateRow({ ...fixture, mark: 'guess', figure: { kind: 'missing', state: 'not-applicable' } }).figure, { kind: 'missing', state: 'not-applicable' });
});

test('all chart forms preserve explicit missing gaps and exact engine values', () => {
  const kinds = ['columns', 'line', 'ordered-bar', 'ranked-bars', 'bridge', 'goal-line', 'step-line', 'pair-bars', 'strip', 'spark', 'rule-bar'] as const;
  for (const kind of kinds) {
    const fixture = { ...chartFixture(), kind };
    const chart = validateChart(fixture);
    assert.deepEqual(chart, fixture);
    assert.deepEqual(chart.points[1]!.value, { kind: 'missing', state: 'unknown' });
    assert.ok(Object.isFrozen(chart.points));
    assert.ok(Object.isFrozen(chart.points[0]!.value));
  }
});

test('charts reject mixed units, duplicate points, unlabeled geometry and excessive payloads', () => {
  const known = [moneyFigure(), { kind: 'count', count: '1', receiptId: 'receipt_fixture', labels: [] }, { kind: 'percent', basisPoints: '1', receiptId: 'receipt_fixture', labels: [] }];
  for (let i = 0; i < known.length; i++) for (let j = i + 1; j < known.length; j++) {
    invalid(() => validateChart({ kind: 'line', description: 'Mixed fixture.', points: [{ id: 'one', label: 'One', value: known[i] }, { id: 'two', label: 'Two', value: known[j] }] }));
  }
  invalid(() => validateChart({ ...chartFixture(), points: [chartFixture().points[0], chartFixture().points[0]] }));
  invalid(() => validateChart({ ...chartFixture(), description: '' }));
  invalid(() => validateChart(corrupt(chartFixture(), ['points', '0', 'value'], { kind: 'missing' })));
  invalid(() => validateChart({ ...chartFixture(), points: Array.from({ length: 121 }, (_, i) => ({ id: String(i), label: 'Fixture', value: moneyFigure() })) }));
});

test('Today preserves null versus zero metadata counts and enforces the visible list bounds', () => {
  for (const pendingCount of [null, '0', HUGE_INTEGER]) assert.equal(validateToday({ ...todayFixture(), pendingCount }).pendingCount, pendingCount);
  for (const [field, maximum] of [['attention', 4], ['worthLook', 5]] as const) {
    const rows = Array.from({ length: maximum }, (_, i) => rowFixture(`row_${i}`));
    const base = { ...todayFixture(), attention: [], worthLook: [] };
    assert.equal(validateToday({ ...base, [field]: rows })[field].length, maximum);
    invalid(() => validateToday({ ...base, [field]: [...rows, rowFixture('overflow')] }));
  }
  const attention = Array.from({ length: 4 }, (_, i) => rowFixture(`attention_${i}`));
  assert.equal(validateToday({ ...todayFixture(), attention, worthLook: [rowFixture('worth_fixture')] }).worthLook.length, 1);
  invalid(() => validateToday({ ...todayFixture(), attention, worthLook: [rowFixture('worth_one'), rowFixture('worth_two')] }));
  invalid(() => validateToday({ ...todayFixture(), attention: [rowFixture('shared')], worthLook: [rowFixture('shared')] }));
  const stats = Array.from({ length: 12 }, (_, i) => ({ id: `stat_${i}`, label: 'Fixture', figure: moneyFigure(), chart: null }));
  assert.equal(validateToday({ ...todayFixture(), stats }).stats.length, 12);
  invalid(() => validateToday({ ...todayFixture(), stats: [...stats, { ...stats[0], id: 'overflow' }] }));
  const dayEvents = Array.from({ length: 6 }, (_, i) => ({ id: `event_${i}`, at: '2026-10-01T09:00:00.000Z', mark: 'cha', label: 'Fixture' }));
  assert.equal(validateToday({ ...todayFixture(), dayEvents }).dayEvents.length, 6);
  invalid(() => validateToday({ ...todayFixture(), dayEvents: [...dayEvents, { ...dayEvents[0], id: 'overflow' }] }));
  for (const pendingCount of [0, '-1', '', '1.5']) invalid(() => validateToday({ ...todayFixture(), pendingCount }));
  invalid(() => validateToday({ ...todayFixture(), date: '2026-02-31' }));
  invalid(() => validateToday({ ...todayFixture(), attention: [rowFixture(), rowFixture()] }));
});

test('Today change labels accompany figures and never smuggle a business number into text', () => {
  const stat = { ...todayFixture().stats[0], change: moneyFigure('-20'), changeLabel: 'Compared with prior' };
  assert.deepEqual(validateToday({ ...todayFixture(), stats: [stat] }).stats[0], stat);
  invalid(() => validateToday({ ...todayFixture(), stats: [{ ...todayFixture().stats[0], changeLabel: 'Compared with prior' }] }));
  for (const changeLabel of ['Up 1', '+1%', 'Down ₹20', 'September 2026']) invalid(() => validateToday({ ...todayFixture(), stats: [{ ...stat, changeLabel }] }));
});

test('locked Today refuses cached figures, rows, day events and pending metadata', () => {
  const emptyLocked = { ...todayFixture(), attention: [], worthLook: [], stats: [], dayEvents: [], pendingCount: null, state: { kind: 'locked', reasonCode: 'VAULT_LOCKED' } };
  assert.deepEqual(validateToday(emptyLocked), emptyLocked);
  invalid(() => validateToday({ ...emptyLocked, pendingCount: '0' }));
  for (const field of ['attention', 'worthLook'] as const) invalid(() => validateToday({ ...emptyLocked, [field]: [rowFixture()] }));
  invalid(() => validateToday({ ...emptyLocked, stats: todayFixture().stats }));
  invalid(() => validateToday({ ...emptyLocked, dayEvents: todayFixture().dayEvents }));
});

test('view states and capability limitations remain categorical, explicit and bounded', () => {
  for (const kind of ['ready', 'empty', 'no-change']) assert.deepEqual(validateViewState({ kind }), { kind });
  for (const kind of ['loading', 'partial', 'stale']) {
    for (const asOf of [null, '2026-10-01', '2026-10-01T09:00:00.000Z']) assert.deepEqual(validateViewState({ kind, asOf, reasonCode: 'FIXTURE_REASON' }), { kind, asOf, reasonCode: 'FIXTURE_REASON' });
  }
  for (const kind of ['insufficient', 'not-yet', 'rule-stopped', 'failed', 'network-waiting', 'read-only', 'hidden', 'locked', 'not-built']) assert.equal(validateViewState({ kind, reasonCode: 'FIXTURE_REASON' }).kind, kind);
  for (const fixture of [{ kind: 'ready', reasonCode: 'EXTRA' }, { kind: 'partial' }, { kind: 'stale', asOf: '2026-02-31', reasonCode: 'FIXTURE' }, { kind: 'failed', reasonCode: '' }, { kind: 'success' }]) invalid(() => validateViewState(fixture));
  assert.deepEqual(validateCapability({ state: 'live' }), { state: 'live' });
  assert.deepEqual(validateCapability({ state: 'partial', reasonCode: 'HOST_MISSING', expectedDay: 9 }), { state: 'partial', reasonCode: 'HOST_MISSING', expectedDay: 9 });
  assert.deepEqual(validateCapability({ state: 'missing', reasonCode: 'ADAPTER_MISSING' }), { state: 'missing', reasonCode: 'ADAPTER_MISSING' });
  for (const fixture of [{ state: 'live', reasonCode: 'EXTRA' }, { state: 'missing' }, { state: 'ready' }, { state: 'partial', reasonCode: 'FIXTURE', expectedDay: 11 }, { state: 'partial', reasonCode: 'FIXTURE', expectedDay: 1.5 }]) invalid(() => validateCapability(fixture));
});

test('real receipt projection selects actual engine fields without inventing data or recalculating margin', () => {
  const full = fullCalculationReceiptFixture();
  const projected = projectCalculationReceipt(full);
  assert.deepEqual(projected, receiptEvidenceFixture());
  assert.deepEqual(Object.keys(projected).sort(), [...receiptEvidenceKeys].sort());
  assert.equal(projected.totalMinor, '275');
  assert.deepEqual(projected.rows.map(row => row.amountMinor), ['900', '100', '525']);
  assert.equal(projected.coverage.selectedRows, 3);
  assert.equal(projected.coverage.excludedRows, 1);
  assert.equal(projected.figures[4]!.display, 'INR 2.75');
  assert.equal(projected.figures[5]!.unit, 'basis-points');
  assert.ok(!Object.hasOwn(projected.figures[5]!, 'currency'));
  for (const invented of ['receiptId', 'definitionId', 'modelRoute', 'definitions', 'databaseProof']) assert.ok(!Object.hasOwn(projected, invented));
  assert.ok(Object.isFrozen(projected.rows[0]));
  assert.ok(Object.isFrozen(projected.coverage.gaps));
});

test('receipt partial, stale, null period and empty-zero facts survive as reported', () => {
  const partial = { ...receiptEvidenceFixture(), stale: true, staleReason: 'Definitions changed.', period: null, coverage: { ...receiptEvidenceFixture().coverage, completeness: 'partial', unresolvedConflicts: 1, gaps: ['Unknown amounts were excluded.'] } };
  assert.deepEqual(validateReceiptEvidence(partial), partial);
  const empty = { ...receiptEvidenceFixture(), sourceIds: [], rowIds: [], rows: [], exclusions: [], valueMinor: '0', totalMinor: '0', figures: [{ key: 'total', label: 'Fixture total', minor: '0', display: 'INR 0.00', unit: 'money', currency: 'INR' }], coverage: { selectedRows: 0, countedRows: 0, excludedRows: 0, unresolvedConflicts: 0, importIds: [], completeness: 'empty', gaps: ['An empty selection is not proof of zero activity.'] } };
  assert.deepEqual(validateReceiptEvidence(empty), empty);
  assert.equal(validateReceiptEvidence(empty).coverage.completeness, 'empty');
});

test('receipt shape rejects corrupted figures, dates, coverage and source-row identities', () => {
  const malformed: [readonly string[], unknown][] = [
    [['totalMinor'], 275], [['valueMinor'], '2.75'], [['period', 'from'], '2026-02-31'],
    [['period', 'to'], '2026-08-01'], [['createdAt'], '2026-10-01T25:00:00Z'],
    [['figures', '0', 'unit'], 'percent'], [['figures', '0', 'currency'], 'USD'],
    [['figures', '0', 'minor'], '1e3'], [['figures', '0', 'display'], ''],
    [['coverage', 'completeness'], 'complete'], [['coverage', 'countedRows'], -1],
    [['coverage', 'selectedRows'], 1.5], [['coverage', 'unresolvedConflicts'], Infinity],
    [['rows', '0', 'sourceRow'], 0], [['rows', '0', 'sourceRow'], -1], [['rows', '0', 'sourceRow'], 1.5], [['rows', '0', 'amountMinor'], 900],
    [['rows', '0', 'validFrom'], '2026-02-31'], [['allowedNumbers'], ['2.75', NaN]],
  ];
  for (const [path, value] of malformed) invalid(() => validateReceiptEvidence(corrupt(receiptEvidenceFixture(), path, value)));
  invalid(() => validateReceiptEvidence({ ...receiptEvidenceFixture(), figures: [receiptEvidenceFixture().figures[0], receiptEvidenceFixture().figures[0]] }));
  invalid(() => validateReceiptEvidence({ ...receiptEvidenceFixture(), rowIds: ['missing_fact'] }));
  invalid(() => validateReceiptEvidence({ ...receiptEvidenceFixture(), rows: [receiptEvidenceFixture().rows[0], receiptEvidenceFixture().rows[0]] }));
  invalid(() => validateReceiptEvidence(corrupt(receiptEvidenceFixture(), ['coverage', 'countedRows'], 2)));
  invalid(() => validateReceiptEvidence({ ...receiptEvidenceFixture(), receiptId: 'invented' }));
});

test('full receipt projection accepts defined engine extensions, rejects proposed-design shapes and extra fields', () => {
  const full = fullCalculationReceiptFixture();
  assert.deepEqual(projectCalculationReceipt({ ...full, compiledCalculation: { dictionaryHash: full.dictionaryHash, sum: { fixture: true } } }), receiptEvidenceFixture());
  invalid(() => projectCalculationReceipt({ ...full, definitions: null }));
  invalid(() => projectCalculationReceipt({ receiptId: 'receipt_fixture', total: { currency: 'INR', paise: '275' } }));
  invalid(() => projectCalculationReceipt({ ...full, modelRoute: 'invented' }));
  invalid(() => validateReceiptEvidence(full));
});

test('ce5 receipts preserve explicit reviewed source selection separately from counted sources', () => {
  const full = fullCalculationReceiptFixture();
  const withScope = { ...full, requestedSourceIds: ['source_orders', 'source_costs', 'selected_source_with_no_rows'] };
  assert.deepEqual(projectCalculationReceipt(withScope).requestedSourceIds, withScope.requestedSourceIds);
  assert.equal(Object.hasOwn(projectCalculationReceipt(full), 'requestedSourceIds'), false);
  const empty = { ...full, sourceIds: [], rowIds: [], rows: [], exclusions: [], requestedSourceIds: [], coverage: { ...full.coverage, selectedRows: 0, countedRows: 0, excludedRows: 0, importIds: [], completeness: 'empty' } };
  assert.deepEqual(projectCalculationReceipt(empty).requestedSourceIds, []);
  for (const requestedSourceIds of [[], ['source_orders'], ['source_orders', 'source_orders'], ['source_orders', 'source_costs', 'https://private.invalid'], Array.from({ length: 65 }, (_, i) => `source_${i}`)]) invalid(() => projectCalculationReceipt({ ...full, requestedSourceIds }));
});

test('approval controls cannot be offered across read-only, prepare-only, uncertain and terminal states', () => {
  assert.deepEqual(validateApproval(approvalFixture()), approvalFixture());
  assert.deepEqual(validateApproval({ ...approvalFixture(), readOnly: true, can: ['open-app'] }).can, ['open-app']);
  assert.deepEqual(validateApproval({ ...approvalFixture(), kind: 'prepare-only', prepareOnly: true, can: ['change', 'drop'] }).can, ['change', 'drop']);
  assert.deepEqual(validateApproval({ ...approvalFixture(), state: 'unknown', can: ['reconcile', 'open-app'] }).can, ['reconcile', 'open-app']);
  for (const can of [['approve'], ['notNow'], ['change'], ['drop'], ['reconcile']]) invalid(() => validateApproval({ ...approvalFixture(), readOnly: true, can }));
  invalid(() => validateApproval({ ...approvalFixture(), prepareOnly: true }));
  invalid(() => validateApproval({ ...approvalFixture(), kind: 'prepare-only', prepareOnly: false, can: [] }));
  for (const action of ['approve', 'notNow', 'change', 'drop']) invalid(() => validateApproval({ ...approvalFixture(), state: 'unknown', can: [action] }));
  for (const state of ['executing', 'verified', 'rejected', 'cancelled']) {
    assert.deepEqual(validateApproval({ ...approvalFixture(), state, can: ['open-app'] }).can, ['open-app']);
    for (const action of ['approve', 'notNow', 'change', 'drop', 'reconcile']) invalid(() => validateApproval({ ...approvalFixture(), state, can: [action] }));
  }
  invalid(() => validateApproval({ ...approvalFixture(), kind: 'money', needsSecondAsk: false }));
  assert.equal(validateApproval({ ...approvalFixture(), kind: 'money', needsSecondAsk: true }).needsSecondAsk, true);
  for (const revision of [0, -1, 1.5, '1']) invalid(() => validateApproval({ ...approvalFixture(), revision }));
  invalid(() => validateApproval({ ...approvalFixture(), can: ['approve', 'approve'] }));
  invalid(() => validateApproval({ ...approvalFixture(), can: ['execute'] }));
});

test('phone headlines contain only fixed templates and opaque intents, with policy-bound offers', () => {
  for (const template of ['week-ready', 'review-waiting', 'document-received', 'due-soon']) {
    assert.deepEqual(validatePhoneHeadline({ ...phoneFixture(), template, approval: null }), { ...phoneFixture(), template, approval: null });
  }
  assert.deepEqual(validatePhoneHeadline(phoneFixture()), phoneFixture());
  assert.deepEqual(validatePhoneHeadline({ ...phoneFixture(), approval: { ...phoneFixture().approval, policy: 'open-app-only', actions: ['open-app'] } }).approval?.actions, ['open-app']);
  for (const field of ['amount', 'customerName', 'summary', 'receiptIds', 'credential', 'token', 'binding']) {
    invalid(() => validatePhoneHeadline({ ...phoneFixture(), [field]: 'PRIVATE_CUSTOMER_FIXTURE' }));
    invalid(() => validatePhoneHeadline({ ...phoneFixture(), approval: { ...phoneFixture().approval, [field]: 'PRIVATE_CUSTOMER_FIXTURE' } }));
  }
  for (const linkId of ['https://private.invalid/?token=secret', 'javascript:alert(1)', '#/books/receipt_fixture']) invalid(() => validatePhoneHeadline({ ...phoneFixture(), linkId }));
  invalid(() => validatePhoneHeadline({ ...phoneFixture(), template: 'CUSTOMER_1 owes money' }));
  invalid(() => validatePhoneHeadline({ ...phoneFixture(), approval: { ...phoneFixture().approval, expiresAt: '2030-02-31T00:00:00Z' } }));
  for (const actions of [['approve'], ['notNow']]) invalid(() => validatePhoneHeadline({ ...phoneFixture(), approval: { ...phoneFixture().approval, policy: 'open-app-only', actions } }));
});

test('CA console exports only status metadata per client and keeps nullable counts exact', () => {
  for (const awaitingFirm of [null, '0', HUGE_INTEGER]) {
    const fixture = { ...caFixture(), clients: [{ ...caFixture().clients[0], awaitingFirm }] };
    assert.deepEqual(validateCAConsole(fixture), fixture);
  }
  const dated = { ...caFixture(), clients: [{ ...caFixture().clients[0], booksReadAt: '2026-10-01T09:00:00.000Z', nextDueDate: '2026-10-20', closeState: 'ready' }] };
  assert.deepEqual(validateCAConsole(dated), dated);
  for (const field of ['customerName', 'balance', 'rows', 'document', 'receipt', 'figures', 'amount']) {
    invalid(() => validateCAConsole({ ...caFixture(), [field]: 'PRIVATE_CUSTOMER_FIXTURE' }));
    invalid(() => validateCAConsole({ ...caFixture(), clients: [{ ...caFixture().clients[0], [field]: 'PRIVATE_CUSTOMER_FIXTURE' }] }));
  }
  for (const [field, value] of [['booksReadAt', '2026-02-31T09:00:00Z'], ['nextDueDate', '2026-02-31'], ['awaitingFirm', '-1'], ['awaitingFirm', 1], ['closeState', 'success']] as const) {
    invalid(() => validateCAConsole({ ...caFixture(), clients: [{ ...caFixture().clients[0], [field]: value }] }));
  }
  invalid(() => validateCAConsole({ ...caFixture(), clients: [caFixture().clients[0], caFixture().clients[0]] }));
});

test('invalid object prototypes and cyclic source values fail without serialization hooks', () => {
  invalid(() => validateFigure(Object.assign(Object.create({ private: 'PRIVATE_CUSTOMER_FIXTURE' }), moneyFigure())));
  invalid(() => validateFigure(Object.assign(Object.create(null), moneyFigure())));
  let invoked = 0;
  const payload = { ...phoneFixture(), toJSON: () => { invoked++; return phoneFixture(); } };
  invalid(() => validatePhoneHeadline(payload));
  assert.equal(invoked, 0);
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  invalid(() => validateReceiptEvidence({ ...receiptEvidenceFixture(), assumptions: cycle }));
  invalid(() => projectCalculationReceipt({ ...fullCalculationReceiptFixture(), databaseProof: cycle }));
});

test('validators reject accessors without reading them, including required fields and nested evidence', () => {
  const cases: [unknown, (value: unknown) => unknown, string][] = [
    [moneyFigure(), validateFigure, 'kind'], [rowFixture(), validateRow, 'title'],
    [todayFixture(), validateToday, 'pendingCount'], [receiptEvidenceFixture(), validateReceiptEvidence, 'totalMinor'],
    [phoneFixture(), validatePhoneHeadline, 'template'], [caFixture(), validateCAConsole, 'clients'],
  ];
  for (const [fixture, validate, property] of cases) {
    let invoked = 0;
    const payload = fixture as object;
    Object.defineProperty(payload, property, { enumerable: true, get() { invoked++; return 'PRIVATE_CUSTOMER_FIXTURE'; } });
    invalid(() => validate(payload));
    assert.equal(invoked, 0, `Accessor ${property} was executed`);
  }
  let invoked = 0;
  const assumptions = Object.defineProperty({}, 'fixture', { enumerable: true, get() { invoked++; return 1; } });
  invalid(() => validateReceiptEvidence({ ...receiptEvidenceFixture(), assumptions }));
  assert.equal(invoked, 0);
});

test('nested arrays reject index accessors, sparse content and altered prototypes without invocation', () => {
  let invoked = 0;
  const points = [...chartFixture().points];
  Object.defineProperty(points, '0', { enumerable: true, get() { invoked++; return chartFixture().points[0]; } });
  invalid(() => validateChart({ ...chartFixture(), points }));
  assert.equal(invoked, 0);
  const altered = [...chartFixture().points];
  Object.setPrototypeOf(altered, Object.create(Array.prototype));
  invalid(() => validateChart({ ...chartFixture(), points: altered }));
  const sparse = [...chartFixture().points];
  delete sparse[1];
  invalid(() => validateChart({ ...chartFixture(), points: sparse }));
  const samples = ['fixture'];
  Object.defineProperty(samples, '0', { enumerable: true, get() { invoked++; return 'PRIVATE_CUSTOMER_FIXTURE'; } });
  invalid(() => validateReceiptEvidence({ ...receiptEvidenceFixture(), assumptions: { samples } }));
  assert.equal(invoked, 0);
  const opaque = ['fixture'];
  Object.setPrototypeOf(opaque, Object.create(Array.prototype));
  invalid(() => projectCalculationReceipt({ ...fullCalculationReceiptFixture(), databaseProof: { samples: opaque } }));
});
