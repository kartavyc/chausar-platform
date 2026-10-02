import test from 'node:test';
import assert from 'node:assert/strict';
import { hash } from '../runtime/contracts.ts';
import type { CalculationReceipt } from '../runtime/calculator.ts';
import { DatabaseCalculator, type SQLConnection, type SQLDialect } from '../runtime/analytics.ts';

// These are authored source-compilation fixtures. The injected connection records
// statements and returns independent literal result rows; it executes no database.
const CREATE_ROWS = 'CREATE TEMP TABLE receipt_rows (fact_id VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL, amount_minor DECIMAL(38,0) NOT NULL, event_date DATE NOT NULL, due_date DATE, invoice_id VARCHAR, customer_id VARCHAR)';
const CREATE_DEFINITIONS = 'CREATE TEMP TABLE receipt_definitions (name VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL, sign INTEGER NOT NULL CHECK(sign IN (-1,1)))';
const INSERT_ROW = 'INSERT INTO receipt_rows VALUES ($1, $2, CAST($3 AS DECIMAL(38,0)), CAST($4 AS DATE), CAST($5 AS DATE), $6, $7)';
const INSERT_DEFINITION = 'INSERT INTO receipt_definitions VALUES ($1, $2, $3)';
const QUERIES: Record<SQLDialect, Record<'change' | 'scenario', string>> = {
  duckdb: {
    change: "WITH totals AS (SELECT CAST(COALESCE(SUM(CASE WHEN r.event_date BETWEEN CAST($1 AS DATE) AND CAST($2 AS DATE) THEN r.amount_minor*d.sign ELSE 0 END),0) AS HUGEINT) AS current_value,CAST(COALESCE(SUM(CASE WHEN r.event_date BETWEEN CAST($3 AS DATE) AND CAST($4 AS DATE) THEN r.amount_minor*d.sign ELSE 0 END),0) AS HUGEINT) AS previous_value FROM receipt_definitions d LEFT JOIN receipt_rows r ON r.kind=d.kind WHERE d.name='earned') SELECT CAST(current_value AS VARCHAR) AS current,CAST(previous_value AS VARCHAR) AS previous,CAST(current_value-previous_value AS VARCHAR) AS change,CASE WHEN previous_value=0 THEN NULL ELSE CAST(((current_value-previous_value)*CAST(10000 AS HUGEINT)) // previous_value AS VARCHAR) END AS changeBps FROM totals",
    scenario: "WITH metrics AS (SELECT d.name, CAST(COALESCE(SUM(r.amount_minor * d.sign), 0) AS HUGEINT) AS value FROM receipt_definitions d LEFT JOIN receipt_rows r ON r.kind=d.kind GROUP BY d.name), calculated AS (SELECT value AS baseline,(value*(CAST(10000 AS HUGEINT)+CAST($1 AS HUGEINT))) // CAST(10000 AS HUGEINT) AS scenario FROM metrics WHERE name='earned') SELECT CAST(baseline AS VARCHAR) AS baseline,CAST(scenario AS VARCHAR) AS scenario,CAST(scenario-baseline AS VARCHAR) AS change,CAST(CAST($1 AS HUGEINT) AS VARCHAR) AS priceChangeBps FROM calculated",
  },
  postgres: {
    change: "WITH totals AS (SELECT CAST(COALESCE(SUM(CASE WHEN r.event_date BETWEEN CAST($1 AS DATE) AND CAST($2 AS DATE) THEN r.amount_minor*d.sign ELSE 0 END),0) AS NUMERIC(38,0)) AS current_value,CAST(COALESCE(SUM(CASE WHEN r.event_date BETWEEN CAST($3 AS DATE) AND CAST($4 AS DATE) THEN r.amount_minor*d.sign ELSE 0 END),0) AS NUMERIC(38,0)) AS previous_value FROM receipt_definitions d LEFT JOIN receipt_rows r ON r.kind=d.kind WHERE d.name='earned') SELECT CAST(current_value AS VARCHAR) AS current,CAST(previous_value AS VARCHAR) AS previous,CAST(current_value-previous_value AS VARCHAR) AS change,CASE WHEN previous_value=0 THEN NULL ELSE CAST(div((current_value-previous_value)*CAST(10000 AS NUMERIC(38,0)), previous_value) AS VARCHAR) END AS \"changeBps\" FROM totals",
    scenario: "WITH metrics AS (SELECT d.name, CAST(COALESCE(SUM(r.amount_minor * d.sign), 0) AS NUMERIC(38,0)) AS value FROM receipt_definitions d LEFT JOIN receipt_rows r ON r.kind=d.kind GROUP BY d.name), calculated AS (SELECT value AS baseline,div(value*(CAST(10000 AS NUMERIC(38,0))+CAST($1 AS NUMERIC(38,0))), CAST(10000 AS NUMERIC(38,0))) AS scenario FROM metrics WHERE name='earned') SELECT CAST(baseline AS VARCHAR) AS baseline,CAST(scenario AS VARCHAR) AS scenario,CAST(scenario-baseline AS VARCHAR) AS change,CAST(CAST($1 AS NUMERIC(38,0)) AS VARCHAR) AS \"priceChangeBps\" FROM calculated",
  },
};
const CURRENT = { from: '2025-04-01', to: '2025-04-30' };
const PREVIOUS = { from: '2025-03-01', to: '2025-03-31' };
const CHANGE = { current: '30002', previous: '30000', change: '2', changeBps: '0' };
const SCENARIO = { baseline: '30002', scenario: '31502', change: '1500', priceChangeBps: '500' };
const DIALECTS: SQLDialect[] = ['duckdb', 'postgres'];
type Result = Record<string, string | null>;

function figures(result: Result): CalculationReceipt['figures'] {
  return Object.entries(result).flatMap(([key, minor]) => minor === null ? [] : [{ key, label: key, minor, display: minor,
    unit: key.endsWith('Bps') ? 'basis-points' as const : 'money' as const,
    ...(key.endsWith('Bps') ? {} : { currency: 'INR' }) }]);
}

function receipt(operation: 'change' | 'scenario', result: Result = operation === 'change' ? CHANGE : SCENARIO): CalculationReceipt {
  const definitions: CalculationReceipt['definitions'] = [{ name: 'earned', label: 'Earned fees', meaning: 'Explicit independently mapped earned fees', kind: 'sale', field: 'feeMinor', currency: 'INR', nulls: 'reject' }];
  const rows: CalculationReceipt['rows'] = [
    { factId: 'fee:first', entityId: 'first', sourceId: 'synthetic', sourceRow: 1, kind: 'sale', amountMinor: '10001', measureField: 'feeMinor', validFrom: '2025-04-01' },
    { factId: 'fee:last', entityId: 'last', sourceId: 'synthetic', sourceRow: 2, kind: 'sale', amountMinor: '20001', measureField: 'feeMinor', validFrom: '2025-04-30' },
    ...(operation === 'change' ? [{ factId: 'fee:prior', entityId: 'prior', sourceId: 'synthetic', sourceRow: 3, kind: 'sale', amountMinor: '30000', measureField: 'feeMinor', validFrom: '2025-03-31' }] : []),
  ];
  const primary = result[operation === 'change' ? 'change' : 'scenario']!;
  return {
    id: 'synthetic:custom-field-sql', memberId: 'synthetic-owner', epoch: 1, sourceIds: ['synthetic'], operation,
    createdAt: '2025-05-01T00:00:00.000Z', asOf: '2025-05-01T00:00:00.000Z', period: { ...CURRENT }, comparePeriod: operation === 'change' ? { ...PREVIOUS } : null,
    branch: null, currency: 'INR', ontologyVersion: 1,
    // This is a fixture pin, not a claim of authenticated publication or freshness.
    dictionaryHash: hash({ fixture: 'authored-custom-field-sql', field: 'feeMinor', version: 1 }), definitionHash: hash(definitions), definitions,
    figures: figures(result), valueMinor: primary, totalMinor: primary, rowIds: rows.map(row => row.factId), rows, exclusions: [],
    coverage: { selectedRows: rows.length, countedRows: rows.length, excludedRows: 0, unresolvedConflicts: 0, importIds: ['synthetic-import'], completeness: 'reconciled-imports', gaps: [] },
    assumptions: operation === 'scenario' ? { priceChangeBps: '500' } : {}, explanation: 'Synthetic source-compilation fixture.', stale: false,
    allowedNumbers: Object.values(result).filter((value): value is string => value !== null),
  };
}

function rebind(value: CalculationReceipt, field: string) {
  value.definitions[0].field = field;
  for (const row of value.rows) row.measureField = field;
  value.definitionHash = hash(value.definitions);
}

function recorder(dialect: SQLDialect, result: Record<string, unknown>[]) {
  const calls: { sql: string; parameters: (string | number | null)[] }[] = [];
  let acquisitions = 0, closes = 0;
  const connection: SQLConnection = {
    async execute(sql, parameters = []) { calls.push({ sql, parameters: [...parameters] }); return sql.startsWith('WITH ') ? structuredClone(result) : []; },
    close() { closes++; },
  };
  const calculator = new DatabaseCalculator({ sqlDialect: dialect, connectionFactory: async () => { acquisitions++; return connection; } });
  return { calculator, calls, get acquisitions() { return acquisitions; }, get closes() { return closes; } };
}

function assertStatements(calls: ReturnType<typeof recorder>['calls'], value: CalculationReceipt, dialect: SQLDialect) {
  assert.deepEqual(calls, [
    { sql: CREATE_ROWS + (dialect === 'postgres' ? ' ON COMMIT DROP' : ''), parameters: [] },
    { sql: CREATE_DEFINITIONS + (dialect === 'postgres' ? ' ON COMMIT DROP' : ''), parameters: [] },
    { sql: INSERT_DEFINITION, parameters: ['earned', 'sale', value.definitions[0].sign ?? 1] },
    ...value.rows.map(row => ({ sql: INSERT_ROW, parameters: [row.factId, row.kind, row.amountMinor, row.validFrom, row.dueDate ?? null, row.invoiceId ?? null, row.customerId ?? null] })),
    { sql: QUERIES[dialect][value.operation as 'change' | 'scenario'], parameters: value.operation === 'change'
      ? [value.period!.from, value.period!.to, value.comparePeriod!.from, value.comparePeriod!.to]
      : [String(BigInt(value.assumptions.priceChangeBps as string))] },
  ]);
  assert.ok(calls.every(call => !call.sql.includes(value.definitions[0].field)));
}

for (const dialect of DIALECTS) {
  for (const operation of ['change', 'scenario'] as const) {
    test(`injected-sql ${dialect}: custom ${operation} uses exact registered statements and prepared fee values`, async () => {
      const value = receipt(operation), before = structuredClone(value);
      const port = recorder(dialect, [operation === 'change' ? CHANGE : SCENARIO]);
      const proof = await port.calculator.verify(value);
      assert.equal(proof.engine, 'injected-sql'); assert.equal(proof.verified, true);
      assert.equal(proof.receiptId, value.id); assert.equal(proof.operation, operation);
      assert.equal(port.acquisitions, 1); assert.equal(port.closes, 1);
      assertStatements(port.calls, value, dialect); assert.deepEqual(value, before);
    });

    test(`injected-sql ${dialect}: legacy amountMinor ${operation} retains optional row markers`, async () => {
      const value = receipt(operation); rebind(value, 'amountMinor');
      for (const row of value.rows) delete row.measureField;
      const port = recorder(dialect, [operation === 'change' ? CHANGE : SCENARIO]);
      assert.equal((await port.calculator.verify(value)).engine, 'injected-sql');
      // The legacy field name is a canonical SQL column, so omit custom-text check.
      assert.equal(port.calls.at(-1)!.sql, QUERIES[dialect][operation]);
      assert.equal(port.closes, 1);
    });
  }

  test(`injected-sql ${dialect}: custom sign and negative scenario truncate toward zero`, async () => {
    const result = { baseline: '-30002', scenario: '-27001', change: '3001', priceChangeBps: '-1000' };
    const value = receipt('scenario', result); value.definitions[0].sign = -1; value.definitionHash = hash(value.definitions);
    value.assumptions.priceChangeBps = '-1000';
    const port = recorder(dialect, [result]);
    assert.equal((await port.calculator.verify(value)).engine, 'injected-sql'); assertStatements(port.calls, value, dialect);
  });

  test(`injected-sql ${dialect}: zero prior omits an unavailable ratio`, async () => {
    const result = { current: '30002', previous: '0', change: '30002', changeBps: null };
    const value = receipt('change', result); value.rows.pop(); value.rowIds.pop();
    const port = recorder(dialect, [result]);
    assert.equal((await port.calculator.verify(value)).engine, 'injected-sql'); assertStatements(port.calls, value, dialect);
  });

  test(`injected-sql ${dialect}: overlapping inclusive periods retain one row identity`, async () => {
    const result = { current: '30002', previous: '40001', change: '-9999', changeBps: '-2499' };
    const value = receipt('change', result); value.comparePeriod = { from: '2025-03-01', to: '2025-04-01' };
    const port = recorder(dialect, [result]);
    assert.equal((await port.calculator.verify(value)).engine, 'injected-sql'); assertStatements(port.calls, value, dialect);
    assert.equal(port.calls.filter(call => call.sql === INSERT_ROW).length, 3);
  });

  test(`injected-sql ${dialect}: custom scenario preserves money beyond Number precision`, async () => {
    const result = { baseline: '9007199254740993', scenario: '9457559217478042', change: '450359962737049', priceChangeBps: '500' };
    const value = receipt('scenario', result); value.rows = [{ ...value.rows[0], amountMinor: '9007199254740993' }]; value.rowIds = [value.rows[0].factId];
    const port = recorder(dialect, [result]);
    assert.equal((await port.calculator.verify(value)).engine, 'injected-sql'); assertStatements(port.calls, value, dialect);
  });

  test(`injected-sql ${dialect}: typed result failures close the injected port`, async t => {
    const cases: { name: string; result: Record<string, unknown>[]; code: string }[] = [
      { name: 'wrong custom amount', result: [{ ...CHANGE, current: '333' }], code: 'SQL_RESULT_MISMATCH' },
      { name: 'missing ratio', result: [{ current: '30002', previous: '30000', change: '2' }], code: 'SQL_RESULT_MISMATCH' },
      { name: 'extra result figure', result: [{ ...CHANGE, extra: '1' }], code: 'SQL_RESULT_MISMATCH' },
      { name: 'untyped numeric result', result: [{ ...CHANGE, change: 2 }], code: 'SQL_PROJECTION_INVALID' },
      { name: 'missing primary result', result: [{ current: '30002', previous: '30000', changeBps: '0' }], code: 'SQL_RESULT_INVALID' },
      { name: 'multiple result rows', result: [CHANGE, CHANGE], code: 'SQL_RESULT_INVALID' },
    ];
    for (const sample of cases) await t.test(sample.name, async () => {
      const port = recorder(dialect, sample.result);
      await assert.rejects(port.calculator.verify(receipt('change')), { code: sample.code });
      assert.equal(port.acquisitions, 1); assert.equal(port.closes, 1);
    });
  });
}

test('injected-sql: projection digest binds custom field and internally coherent definition/dictionary pins', async () => {
  const values = [receipt('change'), receipt('change'), receipt('change'), receipt('change'), receipt('change')];
  rebind(values[1], 'recognizedMinor');
  values[2].definitions[0].meaning = 'Another exact published meaning'; values[2].definitionHash = hash(values[2].definitions);
  values[3].dictionaryHash = hash({ fixture: 'another internally coherent dictionary pin' });
  values[4].ontologyVersion = 2;
  const digests: string[] = [];
  for (const value of values) {
    const port = recorder('duckdb', [CHANGE]);
    const proof = await port.calculator.verify(value); assert.equal(proof.engine, 'injected-sql'); digests.push(proof.projectionDigest);
    assertStatements(port.calls, value, 'duckdb');
  }
  assert.equal(new Set(digests).size, values.length);
});

test('custom comparison/scenario malformed projections refuse before injected connection acquisition', async t => {
  type Case = { name: string; operation?: 'change' | 'scenario'; change: (value: CalculationReceipt) => void; code: string };
  const cases: Case[] = [
    { name: 'missing custom marker', change: v => { delete v.rows[0].measureField; }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'wrong custom marker', change: v => { v.rows[0].measureField = 'amountMinor'; }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'mixed custom markers', change: v => { v.rows[1].measureField = 'recognizedMinor'; }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'definition changed with old markers', change: v => { v.definitions[0].field = 'recognizedMinor'; v.definitionHash = hash(v.definitions); }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'definition hash tampered', change: v => { v.definitionHash = hash([]); }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'dictionary hash malformed', change: v => { v.dictionaryHash = 'not-a-pin'; }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'dictionary hash uppercase', change: v => { v.dictionaryHash = 'A'.repeat(64); }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'zero ontology version', change: v => { v.ontologyVersion = 0; }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'fractional ontology version', change: v => { v.ontologyVersion = 1.5; }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'unsafe ontology version', change: v => { v.ontologyVersion = Number.MAX_SAFE_INTEGER + 1; }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'field expression', change: v => { rebind(v, 'feeMinor + amountMinor'); }, code: 'SQL_DEFINITION_UNSUPPORTED' },
    { name: 'field SQL punctuation', change: v => { rebind(v, 'feeMinor;DROP_TABLE'); }, code: 'SQL_DEFINITION_UNSUPPORTED' },
    { name: 'field over limit', change: v => { rebind(v, 'f'.repeat(65)); }, code: 'SQL_DEFINITION_UNSUPPORTED' },
    { name: 'missing null policy', change: v => { Reflect.deleteProperty(v.definitions[0], 'nulls'); v.definitionHash = hash(v.definitions); }, code: 'SQL_DEFINITION_UNSUPPORTED' },
    { name: 'ambiguous earned definitions', change: v => { v.definitions.push({ ...v.definitions[0] }); v.definitionHash = hash(v.definitions); }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'missing earned definition', change: v => { v.definitions = []; v.definitionHash = hash(v.definitions); }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'wrong earned name', change: v => { v.definitions[0].name = 'fees'; v.definitionHash = hash(v.definitions); }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'currency changed', change: v => { v.definitions[0].currency = 'USD'; v.definitionHash = hash(v.definitions); }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'invalid sign', change: v => { Reflect.set(v.definitions[0], 'sign', 2); v.definitionHash = hash(v.definitions); }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'duplicate lineage', change: v => { v.rowIds[1] = v.rowIds[0]; }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'missing comparison input', change: v => { v.comparePeriod = null; }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'invalid calendar boundary', change: v => { v.period!.to = '2025-04-31'; }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'out of period event', change: v => { v.rows[0].validFrom = '2025-05-01'; }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'counted nullable money', change: v => { Reflect.set(v.rows[0], 'amountMinor', null); }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'noncanonical counted money', change: v => { v.rows[0].amountMinor = '010001'; }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'transformed precision budget', change: v => { v.rows[0].amountMinor = '1' + '0'.repeat(33); }, code: 'SQL_PRECISION_LIMIT' },
    { name: 'scenario assumption absent', operation: 'scenario', change: v => { v.assumptions = {}; }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'scenario above supported bound', operation: 'scenario', change: v => { v.assumptions.priceChangeBps = '100001'; }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'scenario below supported bound', operation: 'scenario', change: v => { v.assumptions.priceChangeBps = '-10001'; }, code: 'SQL_PROJECTION_INVALID' },
    { name: 'uncompiled custom revenue remains unsupported', change: v => { v.operation = 'revenue'; }, code: 'SQL_DEFINITION_UNSUPPORTED' },
  ];
  for (const dialect of DIALECTS) for (const sample of cases) await t.test(`${dialect}: ${sample.name}`, async () => {
    const value = receipt(sample.operation ?? 'change'); sample.change(value);
    const port = recorder(dialect, [CHANGE]);
    await assert.rejects(port.calculator.verify(value), { code: sample.code });
    assert.equal(port.acquisitions, 0); assert.equal(port.closes, 0); assert.deepEqual(port.calls, []);
  });
});
