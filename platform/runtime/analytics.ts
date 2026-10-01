import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChausarError, check, hash } from './contracts.ts';
import type { CalculationReceipt } from './calculator.ts';
import { assertCompiledSingleSum } from './compiled-calculation.ts';

export type SQLConnection = {
  execute(sql: string, parameters?: (string | number | null)[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void> | void;
  interrupt?(): void;
};
export type SQLDialect = 'duckdb' | 'postgres';
export type DatabaseCalculatorOptions = { connectionFactory?: (signal: AbortSignal) => Promise<SQLConnection>; sqlDialect?: SQLDialect; operationTimeoutMs?: number; maxRows?: number };
export type DatabaseVerification = { verified: true; engine: 'duckdb' | 'postgres' | 'injected-sql'; receiptId: string; operation: string; projectionDigest: string; compiledDigest?: string; checks: string[] };
type ProjectionRow = { id: string; kind: string; amount: string; date: string; due: string | null; invoice: string | null; customer: string | null };
type Projection = { receiptId: string; operation: string; currency: string; compiledCalculation: CalculationReceipt['compiledCalculation'] | null; compiledDefinition: CalculationReceipt['definitions'][number] | null; ontologyVersion: number; definitions: { name: string; kind: string; sign: number }[]; rows: ProjectionRow[]; period: { from: string; to: string } | null; comparePeriod: { from: string; to: string } | null; onDate: string | null; priceChangeBps: string | null; expected: Record<string, string> };
const FILE = fileURLToPath(import.meta.url);
const MAX_BYTES = 16 * 1024 * 1024;
const OPERATIONS: Record<string, string[]> = { billed: ['billed'], received: ['received'], earned: ['earned'], refunds: ['refunds'], costs: ['costs'], purchases: ['purchases'], revenue: ['earned'], net_sales: ['earned', 'refunds'], margin: ['earned', 'refunds', 'costs'], aging: ['billed', 'received', 'refunds'], change: ['earned'], scenario: ['earned'] };
const absolute = (n: bigint) => n < 0n ? -n : n;
function integer(value: unknown): string {
  check(typeof value === 'string' && /^-?(?:0|[1-9]\d{0,37})$/.test(value), 'SQL_PROJECTION_INVALID', 'SQL money projection requires integer strings within DECIMAL(38,0).');
  return String(BigInt(value));
}
function date(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
function period(value: any) {
  if (value === null || value === undefined) return null;
  check(value && Object.keys(value).length === 2 && date(value.from) && date(value.to) && value.from <= value.to, 'SQL_PROJECTION_INVALID', 'SQL periods need valid inclusive calendar bounds.');
  return { from: value.from, to: value.to };
}
function optionalText(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  check(typeof value === 'string' && value.length <= 300, 'SQL_PROJECTION_INVALID', 'Projected identities must be bounded text.'); return value;
}
function project(receipt: CalculationReceipt, maxRows: number): Projection {
  check(receipt && typeof receipt.operation === 'string', 'SQL_OPERATION_UNSUPPORTED', 'The SQL calculator needs a published operation.');
  const binding = receipt.compiledCalculation;
  if (binding) {
    check(Object.keys(binding).length === 2 && Object.hasOwn(binding, 'dictionaryHash') && Object.hasOwn(binding, 'sum') && binding.dictionaryHash === receipt.dictionaryHash && /^[a-f0-9]{64}$/.test(binding.dictionaryHash), 'SQL_PROJECTION_INVALID', 'The compiler artifact must belong to the receipt dictionary.');
    check(receipt.definitions?.length === 1 && receipt.definitionHash === hash(receipt.definitions), 'SQL_PROJECTION_INVALID', 'A compiled sum carries exactly its published definition.');
    assertCompiledSingleSum(binding.sum, receipt.operation, receipt.definitions[0], receipt.ontologyVersion);
  }
  check(binding || Object.hasOwn(OPERATIONS, receipt.operation), 'SQL_OPERATION_UNSUPPORTED', 'The SQL calculator has no compiled or registered query for this operation.');
  const required = binding ? [binding.sum.definitionName] : OPERATIONS[receipt.operation];
  const registered = !binding;
  check(typeof receipt.id === 'string' && receipt.id.length <= 200 && /^[A-Z]{3}$/.test(receipt.currency), 'SQL_PROJECTION_INVALID', 'The calculation receipt needs an identity and currency.');
  check(Array.isArray(receipt.definitions) && receipt.definitions.length === required.length && required.every(name => receipt.definitions.some(d => d.name === name)), 'SQL_PROJECTION_INVALID', 'The SQL projection must carry exactly the operation definitions.');
  const names = new Set<string>(); const definitions = receipt.definitions.map(d => {
    check(!names.has(d.name) && /^[a-z][a-z0-9_]{0,63}$/.test(d.kind) && d.currency === receipt.currency && (d.sign === undefined || d.sign === 1 || d.sign === -1), 'SQL_PROJECTION_INVALID', 'Projected definitions must have distinct names, typed kinds, currency and signs.'); names.add(d.name);
    check(binding ? d.field === binding.sum.moneyField : d.field === 'amountMinor', 'SQL_DEFINITION_UNSUPPORTED', 'SQL verification requires the published exact money field.');
    return { name: d.name, kind: d.kind, sign: d.sign ?? 1 };
  });
  check(Array.isArray(receipt.rows) && receipt.rows.length <= maxRows && Array.isArray(receipt.rowIds) && receipt.rowIds.length === receipt.rows.length, 'SQL_ROW_LIMIT', 'The receipt projection exceeds its row budget or has incomplete lineage.');
  const lineage = new Set(receipt.rowIds); check(lineage.size === receipt.rowIds.length,'SQL_PROJECTION_INVALID','Receipt lineage identifiers must be distinct.');
  const ids = new Set<string>(); let absoluteSum = 0n;
  const rows = receipt.rows.map(r => {
    check(typeof r.factId === 'string' && r.factId.length > 0 && r.factId.length <= 200 && !ids.has(r.factId) && lineage.has(r.factId), 'SQL_PROJECTION_INVALID', 'Each projected row needs one distinct receipt lineage identity.'); ids.add(r.factId);
    check(definitions.some(d => d.kind === r.kind) && date(r.validFrom), 'SQL_PROJECTION_INVALID', 'Rows must use an operation kind and explicit event date.');
    check(!['cancelled', 'void', 'draft', 'bounced'].includes(r.status ?? ''), 'SQL_PROJECTION_INVALID', 'Cancelled, void, draft and bounced events cannot be counted.');
    check(binding ? r.measureField === binding.sum.moneyField : r.measureField === undefined || r.measureField === 'amountMinor', 'SQL_PROJECTION_INVALID', 'Each row must project the declared money field.');
    const amount = integer(r.amountMinor); absoluteSum += absolute(BigInt(amount));
    check(!definitions.some(d => d.kind === r.kind && ['refunds', 'costs'].includes(d.name)) || BigInt(amount) >= 0n, 'SQL_PROJECTION_INVALID', 'Refund and cost event values must be positive.');
    check(r.dueDate === undefined || date(r.dueDate), 'SQL_PROJECTION_INVALID', 'Projected due dates must be valid calendar dates.');
    return { id: r.factId, kind: r.kind, amount, date: r.validFrom, due: r.dueDate ?? null, invoice: optionalText(r.invoiceId), customer: optionalText(r.customerId) };
  });
  check(absoluteSum <= 10n ** 38n - 1n, 'SQL_PRECISION_LIMIT', 'The projected absolute total exceeds DECIMAL(38,0).');
  if (registered && ['margin', 'change', 'scenario'].includes(receipt.operation)) check(absoluteSum <= 10n ** 32n, 'SQL_PRECISION_LIMIT', 'Exact transformed SQL calculations reserve integer precision for basis points.');
  const current = period(receipt.period), compare = period(receipt.comparePeriod);
  if (registered && receipt.operation === 'change') check(current && compare, 'SQL_PROJECTION_INVALID', 'Change verification needs both event periods.');
  if (current) check(rows.every(r => (r.date >= current.from && r.date <= current.to) || (registered && receipt.operation === 'change' && compare && r.date >= compare.from && r.date <= compare.to)), 'SQL_PROJECTION_INVALID', 'Projected events must belong to a declared calculation period.');
  if (binding) check(compare === null && Object.keys(receipt.assumptions ?? {}).length === 0, 'SQL_PROJECTION_INVALID', 'A compiled sum has no comparison or scenario assumptions.');
  let onDate: string | null = null; let priceChangeBps: string | null = null;
  if (registered && receipt.operation === 'aging') {
    check(date(receipt.assumptions?.onDate), 'SQL_PROJECTION_INVALID', 'Aging verification needs its explicit observation date.'); onDate = receipt.assumptions.onDate as string;
    check(definitions.every(d => d.sign === 1) && new Set(definitions.map(d => d.kind)).size === 3, 'SQL_DEFINITION_UNSUPPORTED', 'Aging requires three distinct positively defined event kinds.');
    const invoiceKind = definitions.find(d => d.name === 'billed')!.kind; const links = new Set<string>();
    for (const r of rows) {
      check(r.date <= onDate, 'SQL_PROJECTION_INVALID', 'Aging cannot count events after the observation date.');
      check(BigInt(r.amount) >= 0n, 'SQL_PROJECTION_INVALID', 'Aging invoices, receipts and credits must be nonnegative event values.');
      if (r.kind === invoiceKind) { check(r.invoice && r.customer && r.due, 'SQL_PROJECTION_INVALID', 'Aging invoices need invoice, customer and due-date links.'); const key = JSON.stringify([r.invoice, r.customer]); check(!links.has(key), 'SQL_AMBIGUOUS_INVOICE', 'Distinct invoice claims cannot reuse one invoice/customer link.'); links.add(key); }
    }
  }
  if (registered && receipt.operation === 'scenario') {
    priceChangeBps = integer(receipt.assumptions?.priceChangeBps); check(BigInt(priceChangeBps) >= -10000n && BigInt(priceChangeBps) <= 100000n, 'SQL_PROJECTION_INVALID', 'The price scenario is outside the supported range.');
  }
  const figures = new Map<string, string>(); check(Array.isArray(receipt.figures), 'SQL_PROJECTION_INVALID', 'The receipt must contain typed figures.');
  for (const figure of receipt.figures) { check(typeof figure.key === 'string' && !figures.has(figure.key) && ['money', 'basis-points'].includes(figure.unit) && (figure.unit !== 'money' || figure.currency === receipt.currency), 'SQL_PROJECTION_INVALID', 'Receipt figures must have distinct keys and explicit compatible units.'); figures.set(figure.key, integer(figure.minor)); }
  const expected = Object.fromEntries(figures); expected.valueMinor = integer(receipt.valueMinor); expected.totalMinor = integer(receipt.totalMinor);
  return { receiptId: receipt.id, operation: receipt.operation, currency: receipt.currency, compiledCalculation: binding ? structuredClone(binding) : null, compiledDefinition: binding ? structuredClone(receipt.definitions[0]) : null, ontologyVersion: receipt.ontologyVersion, definitions, rows, period: current, comparePeriod: compare, onDate, priceChangeBps, expected };
}

const CREATE_ROWS = 'CREATE TEMP TABLE receipt_rows (fact_id VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL, amount_minor DECIMAL(38,0) NOT NULL, event_date DATE NOT NULL, due_date DATE, invoice_id VARCHAR, customer_id VARCHAR)';
const CREATE_DEFINITIONS = 'CREATE TEMP TABLE receipt_definitions (name VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL, sign INTEGER NOT NULL CHECK(sign IN (-1,1)))';
const INSERT_ROW = 'INSERT INTO receipt_rows VALUES ($1, $2, CAST($3 AS DECIMAL(38,0)), CAST($4 AS DATE), CAST($5 AS DATE), $6, $7)';
const INSERT_DEFINITION = 'INSERT INTO receipt_definitions VALUES ($1, $2, $3)';
const METRICS = `metrics AS (SELECT d.name, CAST(COALESCE(SUM(r.amount_minor * d.sign), 0) AS HUGEINT) AS value FROM receipt_definitions d LEFT JOIN receipt_rows r ON r.kind=d.kind GROUP BY d.name)`;
const SUM_QUERY = `WITH ${METRICS} SELECT CAST(value AS VARCHAR) AS total FROM metrics WHERE name=$1`;
const NET_QUERY = `WITH ${METRICS}, totals AS (SELECT COALESCE(MAX(CASE WHEN name='earned' THEN value END),0) AS earned, COALESCE(MAX(CASE WHEN name='refunds' THEN value END),0) AS refunds FROM metrics) SELECT CAST(earned-refunds AS VARCHAR) AS total FROM totals`;
const MARGIN_QUERY = `WITH ${METRICS}, totals AS (SELECT COALESCE(MAX(CASE WHEN name='earned' THEN value END),0) AS earned, COALESCE(MAX(CASE WHEN name='refunds' THEN value END),0) AS refunds, COALESCE(MAX(CASE WHEN name='costs' THEN value END),0) AS costs FROM metrics), calculated AS (SELECT earned,refunds,costs,earned-refunds AS net_sales,earned-refunds-costs AS contribution FROM totals) SELECT CAST(earned AS VARCHAR) AS earned,CAST(refunds AS VARCHAR) AS refunds,CAST(net_sales AS VARCHAR) AS netSales,CAST(costs AS VARCHAR) AS costs,CAST(contribution AS VARCHAR) AS contribution,CASE WHEN net_sales=0 THEN NULL ELSE CAST((contribution*CAST(10000 AS HUGEINT)) // net_sales AS VARCHAR) END AS marginBps FROM calculated`;
const CHANGE_QUERY = `WITH totals AS (SELECT CAST(COALESCE(SUM(CASE WHEN r.event_date BETWEEN CAST($1 AS DATE) AND CAST($2 AS DATE) THEN r.amount_minor*d.sign ELSE 0 END),0) AS HUGEINT) AS current_value,CAST(COALESCE(SUM(CASE WHEN r.event_date BETWEEN CAST($3 AS DATE) AND CAST($4 AS DATE) THEN r.amount_minor*d.sign ELSE 0 END),0) AS HUGEINT) AS previous_value FROM receipt_definitions d LEFT JOIN receipt_rows r ON r.kind=d.kind WHERE d.name='earned') SELECT CAST(current_value AS VARCHAR) AS current,CAST(previous_value AS VARCHAR) AS previous,CAST(current_value-previous_value AS VARCHAR) AS change,CASE WHEN previous_value=0 THEN NULL ELSE CAST(((current_value-previous_value)*CAST(10000 AS HUGEINT)) // previous_value AS VARCHAR) END AS changeBps FROM totals`;
const SCENARIO_QUERY = `WITH ${METRICS}, calculated AS (SELECT value AS baseline,(value*(CAST(10000 AS HUGEINT)+CAST($1 AS HUGEINT))) // CAST(10000 AS HUGEINT) AS scenario FROM metrics WHERE name='earned') SELECT CAST(baseline AS VARCHAR) AS baseline,CAST(scenario AS VARCHAR) AS scenario,CAST(scenario-baseline AS VARCHAR) AS change,CAST(CAST($1 AS HUGEINT) AS VARCHAR) AS priceChangeBps FROM calculated`;
const AGING_QUERY = `WITH classified AS (SELECT r.*,d.name AS metric FROM receipt_rows r JOIN receipt_definitions d ON r.kind=d.kind WHERE r.event_date<=CAST($1 AS DATE)), linked AS (SELECT invoice_id,customer_id,SUM(amount_minor) AS credits FROM classified WHERE metric IN ('received','refunds') GROUP BY invoice_id,customer_id), balances AS (SELECT i.due_date,i.amount_minor-COALESCE(l.credits,0) AS balance FROM classified i LEFT JOIN linked l ON i.invoice_id=l.invoice_id AND i.customer_id=l.customer_id WHERE i.metric='billed'), outstanding AS (SELECT GREATEST(balance,0) AS amount,GREATEST(-balance,0) AS excess,date_diff('day',due_date,CAST($1 AS DATE)) AS days FROM balances), summary AS (SELECT COALESCE(SUM(CASE WHEN days<=0 THEN amount ELSE 0 END),0) AS not_due,COALESCE(SUM(CASE WHEN days BETWEEN 1 AND 30 THEN amount ELSE 0 END),0) AS days_1_30,COALESCE(SUM(CASE WHEN days BETWEEN 31 AND 60 THEN amount ELSE 0 END),0) AS days_31_60,COALESCE(SUM(CASE WHEN days BETWEEN 61 AND 90 THEN amount ELSE 0 END),0) AS days_61_90,COALESCE(SUM(CASE WHEN days>90 THEN amount ELSE 0 END),0) AS over_90,COALESCE(SUM(amount),0) AS outstanding,COALESCE(SUM(excess),0)+(SELECT COALESCE(SUM(c.amount_minor),0) FROM classified c WHERE c.metric IN ('received','refunds') AND NOT EXISTS (SELECT 1 FROM classified i WHERE i.metric='billed' AND i.invoice_id=c.invoice_id AND i.customer_id=c.customer_id)) AS unallocated FROM outstanding) SELECT CAST(not_due AS VARCHAR) AS "notDue",CAST(days_1_30 AS VARCHAR) AS "days1to30",CAST(days_31_60 AS VARCHAR) AS "days31to60",CAST(days_61_90 AS VARCHAR) AS "days61to90",CAST(over_90 AS VARCHAR) AS "over90",CAST(outstanding AS VARCHAR) AS outstanding,CAST(unallocated AS VARCHAR) AS unallocated FROM summary`;

/** Compile only registered statements; caller data never enters SQL text. */
function dialectSQL(sql: string, dialect: SQLDialect): string {
  if (dialect === 'duckdb') return sql;
  // PostgreSQL div(numeric,numeric) returns an exact quotient truncated toward
  // zero. Ordinary numeric '/' can round near integer boundaries.
  let compiled = sql.replaceAll('HUGEINT', 'NUMERIC(38,0)')
    .replaceAll('(contribution*CAST(10000 AS NUMERIC(38,0))) // net_sales', 'div(contribution*CAST(10000 AS NUMERIC(38,0)), net_sales)')
    .replaceAll('((current_value-previous_value)*CAST(10000 AS NUMERIC(38,0))) // previous_value', 'div((current_value-previous_value)*CAST(10000 AS NUMERIC(38,0)), previous_value)')
    .replaceAll('(value*(CAST(10000 AS NUMERIC(38,0))+CAST($1 AS NUMERIC(38,0)))) // CAST(10000 AS NUMERIC(38,0))', 'div(value*(CAST(10000 AS NUMERIC(38,0))+CAST($1 AS NUMERIC(38,0))), CAST(10000 AS NUMERIC(38,0)))')
    .replaceAll("date_diff('day',due_date,CAST($1 AS DATE))", '(CAST($1 AS DATE)-due_date)');
  // Preserve case-sensitive receipt figure keys in PostgreSQL result metadata.
  for (const name of ['netSales', 'marginBps', 'changeBps', 'priceChangeBps']) compiled = compiled.replaceAll(`AS ${name}`, `AS "${name}"`);
  check(!compiled.includes('//') && !compiled.includes('HUGEINT'), 'SQL_DIALECT_UNSUPPORTED', 'The registered query has no exact PostgreSQL form.');
  return compiled;
}

async function verifySQL(connection: SQLConnection, projection: Projection, engine: DatabaseVerification['engine'], dialect: SQLDialect = 'duckdb'): Promise<DatabaseVerification> {
  await connection.execute(CREATE_ROWS + (dialect === 'postgres' ? ' ON COMMIT DROP' : '')); await connection.execute(CREATE_DEFINITIONS + (dialect === 'postgres' ? ' ON COMMIT DROP' : ''));
  for (const definition of projection.definitions) await connection.execute(INSERT_DEFINITION, [definition.name, definition.kind, definition.sign]);
  for (const row of projection.rows) await connection.execute(INSERT_ROW, [row.id, row.kind, row.amount, row.date, row.due, row.invoice, row.customer]);
  let sql: string; let parameters: (string | number | null)[]; let primary: string;
  if (projection.compiledCalculation) { sql = SUM_QUERY; parameters = [projection.compiledCalculation.sum.definitionName]; primary = 'total'; }
  else if (projection.operation === 'margin') { sql = MARGIN_QUERY; parameters = []; primary = 'contribution'; }
  else if (projection.operation === 'net_sales') { sql = NET_QUERY; parameters = []; primary = 'total'; }
  else if (projection.operation === 'change') { sql = CHANGE_QUERY; parameters = [projection.period!.from,projection.period!.to,projection.comparePeriod!.from,projection.comparePeriod!.to]; primary = 'change'; }
  else if (projection.operation === 'scenario') { sql = SCENARIO_QUERY; parameters = [projection.priceChangeBps]; primary = 'scenario'; }
  else if (projection.operation === 'aging') { sql = AGING_QUERY; parameters = [projection.onDate]; primary = 'outstanding'; }
  else { sql = SUM_QUERY; parameters = [projection.definitions[0].name]; primary = 'total'; }
  const result = await connection.execute(dialectSQL(sql, dialect), parameters);
  check(result.length === 1 && result[0] && typeof result[0] === 'object', 'SQL_RESULT_INVALID', 'The SQL calculation must return one exact result row.');
  const computed: Record<string, string> = {};
  for (const [key,value] of Object.entries(result[0])) { if (value !== null) computed[key] = integer(value); }
  check(Object.hasOwn(computed, primary), 'SQL_RESULT_INVALID', 'The SQL result omitted its primary figure.');
  computed.valueMinor = computed[primary]; computed.totalMinor = computed[primary];
  check(Object.keys(computed).length === Object.keys(projection.expected).length && Object.entries(projection.expected).every(([key,value]) => computed[key] === value), 'SQL_RESULT_MISMATCH', 'The database result disagrees with the calculation receipt.');
  return { verified: true, engine, receiptId: projection.receiptId, operation: projection.operation, projectionDigest: hash(projection), ...(projection.compiledCalculation ? { compiledDigest: projection.compiledCalculation.sum.digest } : {}), checks: ['typed-authorized-row-projection','registered-prepared-sql','exact-minor-unit-figures','receipt-arithmetic-conformance', ...(projection.compiledCalculation ? ['compiler-bound-single-definition-sum'] : [])] };
}

// Configure temporary storage before disabling external access: the pinned
// native engine refuses even an empty temp-directory change once access is off.
// enable_logging is not accepted by the C configuration API; verify its disabled
// session state before exposing the connection, with the configuration locked.
const SAFE_DUCKDB_CONFIG = { temp_directory: '', max_temp_directory_size: '0B', threads: '1', memory_limit: '128MB', autoinstall_known_extensions: 'false', autoload_known_extensions: 'false', allow_community_extensions: 'false', allow_unsigned_extensions: 'false', allow_persistent_secrets: 'false', enable_external_access: 'false', lock_configuration: 'true' };
async function nativeConnection(): Promise<SQLConnection> {
  let api: any;
  try { const packageName = '@duckdb/node-api'; api = await import(packageName); }
  catch { throw new ChausarError('DUCKDB_UNAVAILABLE', 'Install and qualify the pinned DuckDB runtime before using production calculations.'); }
  const instance = await api.DuckDBInstance.create(':memory:', SAFE_DUCKDB_CONFIG);
  let connection: any;
  try {
    connection = await instance.connect();
    const logging = (await connection.runAndReadAll("SELECT current_setting('enable_logging') AS enabled")).getRowObjectsJson();
    check(logging.length === 1 && (logging[0].enabled === false || logging[0].enabled === 0), 'SQL_SANDBOX_UNSUPPORTED', 'The pinned DuckDB runtime must disable logging before verifying receipts.');
  } catch (error) { connection?.closeSync(); if (typeof instance.closeSync === 'function') instance.closeSync(); throw error; }
  const prepared = new Map<string, any>();
  return {
    async execute(sql, parameters = []) { let statement = prepared.get(sql); if (!statement) { statement = await connection.prepare(sql); prepared.set(sql, statement); } statement.bind(parameters); const reader = await statement.runAndReadAll(); return reader.getRowObjectsJson(); },
    close() { connection.closeSync(); if (typeof instance.closeSync === 'function') instance.closeSync(); },
    interrupt() { if (typeof connection.interrupt === 'function') connection.interrupt(); },
  };
}

export class DatabaseCalculator {
  options: Required<Pick<DatabaseCalculatorOptions,'operationTimeoutMs'|'maxRows'|'sqlDialect'>> & Pick<DatabaseCalculatorOptions,'connectionFactory'>;
  constructor(options: DatabaseCalculatorOptions = {}) {
    this.options = { ...options, sqlDialect: options.sqlDialect ?? 'duckdb', operationTimeoutMs: options.operationTimeoutMs ?? 15000, maxRows: options.maxRows ?? 50000 };
    check(['duckdb','postgres'].includes(this.options.sqlDialect) && (this.options.sqlDialect === 'duckdb' || !!this.options.connectionFactory), 'SQL_DIALECT_UNSUPPORTED', 'PostgreSQL requires an explicit trusted connection adapter.');
    check(Number.isInteger(this.options.operationTimeoutMs) && this.options.operationTimeoutMs >= 50 && this.options.operationTimeoutMs <= 30000 && Number.isInteger(this.options.maxRows) && this.options.maxRows > 0 && this.options.maxRows <= 100000, 'SQL_LIMIT_INVALID', 'Set bounded SQL execution and projection limits.');
  }
  async verify(receipt: CalculationReceipt): Promise<DatabaseVerification> {
    const projection = project(receipt, this.options.maxRows);
    if (!this.options.connectionFactory) return this.subprocess(projection);
    const controller = new AbortController(); let connection: SQLConnection | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_,reject) => { timer = setTimeout(() => { controller.abort(); connection?.interrupt?.(); reject(new ChausarError('SQL_TIMEOUT','The SQL calculation exceeded its execution budget.')); },this.options.operationTimeoutMs); });
    const operation = (async () => {
      connection = await this.options.connectionFactory!(controller.signal);
      try {
        check(!controller.signal.aborted, 'SQL_TIMEOUT', 'The SQL connection arrived after its execution deadline.');
        return await verifySQL(connection, projection, 'injected-sql', this.options.sqlDialect);
      } finally { if (controller.signal.aborted) connection.interrupt?.(); await connection.close(); }
    })();
    // Acquisition, session initialization, execution and cleanup share one budget.
    try { return await Promise.race([operation, deadline]); }
    finally { if (timer) clearTimeout(timer); }
  }
  private async subprocess(projection: Projection): Promise<DatabaseVerification> {
    const payload = JSON.stringify(projection); check(Buffer.byteLength(payload) <= MAX_BYTES, 'SQL_ROW_LIMIT', 'The SQL projection exceeds its transfer budget.');
    const directory = await mkdtemp(join(tmpdir(),'chausar-sql-'));
    try {
      return await new Promise((accept,reject) => {
        const child = spawn(process.execPath,[FILE,'--duckdb-worker'],{ cwd: directory, windowsHide: true, shell: false, stdio: ['pipe','pipe','pipe'], env: process.platform === 'win32' ? { ELECTRON_RUN_AS_NODE: '1', SystemRoot: process.env.SystemRoot ?? 'C:\\Windows', TEMP: directory, TMP: directory } : { ELECTRON_RUN_AS_NODE: '1', TMPDIR: directory } });
        let bytes = 0; let output = ''; let settled = false; let failure: ChausarError | undefined;
        const timer = setTimeout(() => { failure = new ChausarError('SQL_TIMEOUT','The database calculation exceeded its process deadline.'); child.kill('SIGKILL'); },this.options.operationTimeoutMs);
        const finish = (error?: Error, result?: DatabaseVerification) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else accept(result!); };
        child.on('error',() => finish(new ChausarError('DUCKDB_UNAVAILABLE','The database worker could not start.')));
        child.stdout.on('data',chunk => { bytes += chunk.length; if (bytes > 65536) { failure = new ChausarError('SQL_OUTPUT_LIMIT','The database worker exceeded its result budget.'); child.kill('SIGKILL'); } else output += chunk.toString(); });
        child.stderr.on('data',() => {}); // Raw engine errors and source identifiers never enter product output.
        child.stdin.on('error',() => {});
        child.on('close',code => {
          if (failure) return finish(failure);
          try { const response = JSON.parse(output); if (!response.ok) throw new ChausarError(['DUCKDB_UNAVAILABLE','SQL_RESULT_MISMATCH','SQL_RESULT_INVALID','SQL_PRECISION_LIMIT','SQL_SANDBOX_UNSUPPORTED'].includes(response.code) ? response.code : 'SQL_EXECUTION_FAILED','The database could not verify this receipt.'); check(code === 0 && response.result?.verified === true && response.result.engine === 'duckdb' && response.result.projectionDigest === hash(projection) && response.result.receiptId === projection.receiptId && response.result.operation === projection.operation,'SQL_RESULT_INVALID','The database worker returned an invalid receipt.'); finish(undefined,response.result); }
          catch (error) { finish(error instanceof ChausarError ? error : new ChausarError('SQL_EXECUTION_FAILED','The database worker returned an invalid result.')); }
        });
        child.stdin.end(payload);
      });
    } finally { check(dirname(resolve(directory)) === resolve(tmpdir()) && directory.split(/[\\/]/).at(-1)!.startsWith('chausar-sql-'),'SQL_PATH_INVALID','The SQL worker directory left its temporary root.'); await rm(directory,{recursive:true,force:true}); }
  }
}

async function workerMain() {
  let connection: SQLConnection | undefined;
  try {
    const chunks: Buffer[] = []; let length = 0;
    for await (const chunk of process.stdin) { length += chunk.length; check(length <= MAX_BYTES,'SQL_ROW_LIMIT','The SQL projection is too large.'); chunks.push(Buffer.from(chunk)); }
    const projection = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Projection;
    // The private worker receives only the parent-generated projection; it never accepts SQL.
    check(Array.isArray(projection.rows) && projection.rows.length <= 100000,'SQL_PROJECTION_INVALID','Invalid private database projection.');
    if (projection.compiledCalculation) {
      check(projection.compiledDefinition && projection.definitions.length === 1 && projection.definitions[0].name === projection.compiledCalculation.sum.definitionName && projection.definitions[0].kind === projection.compiledCalculation.sum.recordKind && projection.definitions[0].sign === projection.compiledCalculation.sum.sign && projection.currency === projection.compiledCalculation.sum.currency, 'SQL_PROJECTION_INVALID', 'The private projection must retain the compiled measure binding.');
      assertCompiledSingleSum(projection.compiledCalculation.sum, projection.operation, projection.compiledDefinition, projection.ontologyVersion);
    } else check(Object.hasOwn(OPERATIONS, projection.operation), 'SQL_OPERATION_UNSUPPORTED', 'The private worker needs a registered operation or compiled sum.');
    connection = await nativeConnection(); const result = await verifySQL(connection,projection,'duckdb');
    process.stdout.write(JSON.stringify({ok:true,result}));
  } catch (error) { process.stdout.write(JSON.stringify({ok:false,code:error instanceof ChausarError ? error.code : 'SQL_EXECUTION_FAILED'})); process.exitCode = 1; }
  finally { await connection?.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(FILE) && process.argv[2] === '--duckdb-worker') await workerMain();
