import { check, ChausarError, hash } from '../../contracts.ts';
import { validDate } from '../../memory.ts';
import type { SourceRecipe, FieldSpec } from '../recipe.ts';
import type {
  BoundQuery, CatalogueColumn, PlainDbConnection, PlainDbDateFormat, PlainDbEngine, PlainDbMapping, PlainDbOptions, PlainDbRole,
} from './types.ts';

/**
 * SQL for the plain database connector is assembled only here, from fixed text, catalogue-checked
 * identifiers (always quoted) and bound values. No caller ever supplies SQL text.
 */
export const ROW_LIMIT_MAX = 50_000;
export const CATALOGUE_LIMIT = 20_000;
export const ENGINES: readonly PlainDbEngine[] = ['postgres', 'mysql', 'sqlite'];
export const ROLES: readonly PlainDbRole[] = ['id', 'date', 'amount', 'quantity', 'currency', 'kind', 'customerId', 'invoiceId', 'status', 'description'];
const DATE_FORMATS: readonly PlainDbDateFormat[] = ['ISO', 'ISO-DATETIME', 'YMD8', 'EPOCH-S-IST'];
/** Identifiers: letters, digits, underscore, dollar, space and hyphen. Quotes, semicolons and comment marks never pass. */
const IDENT = /^[\p{L}_][\p{L}\p{N}_$ -]{0,63}$/u;
const KIND = /^[a-z][a-z0-9_]{0,63}$/;

export function identifierShape(name: unknown): name is string {
  return typeof name === 'string' && IDENT.test(name) && !name.endsWith(' ') && !name.includes('--');
}

export type Dialect = {
  engine: PlainDbEngine;
  quote(name: string): string;
  text(expression: string): string;
  /** Adds a value to params and returns its placeholder, or (MySQL text protocol) a checked literal. */
  bind(value: string | number, params: (string | number)[]): string;
};
const doubleQuote = (name: string) => { check(identifierShape(name), 'DB_IDENTIFIER_INVALID', 'A table or column name has characters a plain read does not accept.'); return `"${name.replaceAll('"', '""')}"`; };
/**
 * MySQL's text protocol has no server-side parameters. Only values this connector produced and checked
 * (ISO dates, whole numbers, catalogue-shaped names) become literals; anything else is refused.
 */
export function mysqlLiteral(value: string | number): string {
  if (typeof value === 'number') { check(Number.isSafeInteger(value), 'DB_VALUE_UNSAFE', 'A query value is not a safe whole number.'); return String(value); }
  check(typeof value === 'string' && /^[\p{L}\p{N}_$ .:-]{0,128}$/u.test(value), 'DB_VALUE_UNSAFE', 'A query value has characters a plain read does not accept.');
  return `'${value}'`;
}
export const DIALECTS: Readonly<Record<PlainDbEngine, Dialect>> = {
  postgres: { engine: 'postgres', quote: doubleQuote, text: e => `CAST(${e} AS TEXT)`, bind: (v, p) => { p.push(v); return `$${p.length}`; } },
  sqlite: { engine: 'sqlite', quote: doubleQuote, text: e => `CAST(${e} AS TEXT)`, bind: (v, p) => { p.push(v); return '?'; } },
  mysql: {
    engine: 'mysql',
    quote: name => { check(identifierShape(name), 'DB_IDENTIFIER_INVALID', 'A table or column name has characters a plain read does not accept.'); return `\`${name.replaceAll('`', '``')}\``; },
    text: e => `CAST(${e} AS CHAR)`,
    bind: v => mysqlLiteral(v),
  },
};

const exactKeys = (value: unknown, allowed: readonly string[], required: readonly string[], code: string, message: string): Record<string, unknown> => {
  check(value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), code, message);
  const keys = Object.keys(value as object);
  check(keys.every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value as object, key)), code, message);
  return value as Record<string, unknown>;
};
const wordMap = (value: unknown, target: RegExp, code: string, message: string): Record<string, string> => {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), code, message);
  const entries = Object.entries(value as Record<string, unknown>);
  check(entries.length > 0 && entries.length <= 200 && entries.every(([k, v]) => k.length <= 120 && !['__proto__', 'constructor', 'prototype'].includes(k) && typeof v === 'string' && target.test(v)), code, message);
  return Object.fromEntries(entries) as Record<string, string>;
};

/** Validates the shape of a mapping. Names are checked against the catalogue later, inside the snapshot. */
export function validateMapping(input: unknown): PlainDbMapping {
  const msg = 'A table mapping names an engine, a table, its columns, the measure and the date format.';
  const m = exactKeys(input, ['engine', 'table', 'columns', 'constantKind', 'kindValues', 'statusValues', 'currency', 'measure', 'moneyUnit', 'countUnit', 'dateFormat', 'period'],
    ['engine', 'table', 'columns', 'measure', 'moneyUnit', 'dateFormat'], 'PLAIN_DB_MAPPING_INVALID', msg);
  check(ENGINES.includes(m.engine as PlainDbEngine), 'PLAIN_DB_MAPPING_INVALID', 'Choose postgres, mysql or sqlite.');
  const table = exactKeys(m.table, ['schema', 'name'], ['name'], 'PLAIN_DB_MAPPING_INVALID', 'Name the table to read.');
  check(identifierShape(table.name) && (table.schema === undefined || identifierShape(table.schema)), 'DB_IDENTIFIER_INVALID', 'A table or column name has characters a plain read does not accept.');
  const columns = exactKeys(m.columns, ROLES, ['id', 'date'], 'PLAIN_DB_MAPPING_INVALID', 'Map at least the id and date columns, and nothing else than known roles.');
  for (const name of Object.values(columns)) check(identifierShape(name), 'DB_IDENTIFIER_INVALID', 'A table or column name has characters a plain read does not accept.');
  check(m.measure === 'money' || m.measure === 'count', 'PLAIN_DB_MAPPING_INVALID', 'The measure is money or count.');
  check(m.moneyUnit === 'major' || m.moneyUnit === 'minor', 'PLAIN_DB_MAPPING_INVALID', 'State whether amounts are in major or minor units.');
  check(DATE_FORMATS.includes(m.dateFormat as PlainDbDateFormat), 'PLAIN_DB_MAPPING_INVALID', 'State the date column format.');
  if (m.measure === 'money') {
    check(typeof columns.amount === 'string', 'PLAIN_DB_MAPPING_INVALID', 'A money read needs an amount column.');
    check((typeof m.currency === 'string') !== (typeof columns.currency === 'string'), 'PLAIN_DB_MAPPING_INVALID', 'State a constant currency or a currency column, not both.');
    if (typeof m.currency === 'string') check(/^[A-Z]{3}$/.test(m.currency), 'PLAIN_DB_MAPPING_INVALID', 'A constant currency is an ISO code.');
  } else {
    check(typeof columns.quantity === 'string' && m.currency === undefined && columns.currency === undefined, 'PLAIN_DB_MAPPING_INVALID', 'A count read needs a quantity column and no currency.');
    if (m.countUnit !== undefined) check(typeof m.countUnit === 'string' && /^[a-z][a-z_]{0,30}$/.test(m.countUnit), 'PLAIN_DB_MAPPING_INVALID', 'A count unit is a short lowercase word.');
  }
  check((typeof m.constantKind === 'string') !== (typeof columns.kind === 'string'), 'PLAIN_DB_MAPPING_INVALID', 'State a constant kind or a kind column, not both.');
  if (typeof m.constantKind === 'string') check(KIND.test(m.constantKind) && m.kindValues === undefined, 'PLAIN_DB_MAPPING_INVALID', 'A constant kind is a dictionary kind.');
  else wordMap(m.kindValues, KIND, 'PLAIN_DB_MAPPING_INVALID', 'Map every source record type to a dictionary kind.');
  if (columns.status !== undefined) wordMap(m.statusValues, /^[a-z][a-z_]{0,40}$|^$/, 'PLAIN_DB_MAPPING_INVALID', 'Map every source status to a dictionary status.');
  else check(m.statusValues === undefined, 'PLAIN_DB_MAPPING_INVALID', 'Status words need a status column.');
  if (m.period !== undefined) {
    const p = exactKeys(m.period, ['from', 'to'], ['from', 'to'], 'PLAIN_DB_PERIOD_INVALID', 'A period has a from and a to date.');
    check(typeof p.from === 'string' && typeof p.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.from) && /^\d{4}-\d{2}-\d{2}$/.test(p.to) && validDate(p.from) && validDate(p.to) && p.from <= p.to,
      'PLAIN_DB_PERIOD_INVALID', 'A period is two ISO dates, from no later than to.');
  }
  return JSON.parse(JSON.stringify(m)) as PlainDbMapping;
}

export function limits(options: PlainDbOptions): { rowLimit: number; timeoutMs: number } {
  const rowLimit = options.rowLimit ?? ROW_LIMIT_MAX, timeoutMs = options.timeoutMs ?? 30_000;
  check(Number.isSafeInteger(rowLimit) && rowLimit >= 1 && rowLimit <= ROW_LIMIT_MAX, 'PLAIN_DB_OPTIONS_INVALID', 'The row limit is a whole number from 1 to 50000.');
  check(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 300_000, 'PLAIN_DB_OPTIONS_INVALID', 'The timeout is from 1 to 300 seconds.');
  return { rowLimit, timeoutMs };
}

/**
 * The database's own system catalogues (role and password tables, server settings) are never read as
 * business records, even by a user who could: Postgres pg_* and information_schema schemas, MySQL's
 * mysql, information_schema, performance_schema and sys databases, SQLite's sqlite_* tables.
 */
export function isSystemCatalogue(engine: PlainDbEngine, name: string): boolean {
  const n = name.toLowerCase();
  if (engine === 'postgres') return n === 'information_schema' || n.startsWith('pg_');
  if (engine === 'mysql') return ['mysql', 'information_schema', 'performance_schema', 'sys'].includes(n);
  return n.startsWith('sqlite_');
}
export const SYSTEM_CATALOGUE_REFUSAL = ['DB_SYSTEM_TABLE', 'The database\'s own system tables are not read as business records.'] as const;

const LOOPBACK = (host: string) => host === 'localhost' || host === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
/** Network settings: exact keys, a plain host, and TLS unless the database is on this machine. Never a password. */
export function validateNetworkConnection(input: unknown, engine: 'postgres' | 'mysql'): { host: string; port: number; database: string; user: string; ssl: 'require' | 'disable'; passwordRef: string } {
  const c = exactKeys(input, ['engine', 'host', 'port', 'database', 'user', 'ssl', 'passwordRef'], ['engine', 'host', 'port', 'database', 'user', 'ssl', 'passwordRef'],
    'DB_CONNECTION_INVALID', 'Connection settings name the host, port, database, user, TLS and a keychain reference, never a password.');
  check(c.engine === engine, 'DB_ENGINE_MISMATCH', 'The mapping and the connection are for different database engines.');
  check(typeof c.host === 'string' && (/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(c.host) || /^[0-9A-Fa-f:]{2,39}$/.test(c.host)), 'DB_CONNECTION_INVALID', 'The host is a plain host name or address.');
  check(Number.isSafeInteger(c.port) && (c.port as number) >= 1 && (c.port as number) <= 65535, 'DB_CONNECTION_INVALID', 'The port is a whole number from 1 to 65535.');
  check(typeof c.database === 'string' && /^[\p{L}\p{N}_.$@-]{1,64}$/u.test(c.database), 'DB_CONNECTION_INVALID', 'The database name has characters a plain read does not accept.');
  check(typeof c.user === 'string' && /^[\p{L}\p{N}_.$@-]{1,64}$/u.test(c.user), 'DB_CONNECTION_INVALID', 'The user name has characters a plain read does not accept.');
  check(c.ssl === 'require' || c.ssl === 'disable', 'DB_CONNECTION_INVALID', 'TLS is require or disable.');
  check(c.ssl === 'require' || LOOPBACK(c.host as string), 'DB_TLS_REQUIRED', 'A database on another machine is read only over TLS.');
  if (engine === 'mysql') check(!isSystemCatalogue('mysql', c.database as string), ...SYSTEM_CATALOGUE_REFUSAL);
  check(typeof c.passwordRef === 'string' && /^[A-Za-z0-9._:/-]{1,200}$/.test(c.passwordRef), 'DB_CONNECTION_INVALID', 'The password reference is a keychain reference.');
  return c as any;
}
export async function resolvePassword(options: PlainDbOptions, ref: string): Promise<string> {
  check(typeof options.credentials === 'function', 'DB_CREDENTIAL_REQUIRED', 'A database password comes from the keychain, and no keychain was given.');
  let password: unknown;
  try { password = await options.credentials!(ref); } catch { throw new ChausarError('DB_CREDENTIAL_UNAVAILABLE', 'The keychain did not return the database password.'); }
  check(typeof password === 'string' && password.length <= 1024 && !password.includes('\0'), 'DB_CREDENTIAL_UNAVAILABLE', 'The keychain did not return the database password.');
  return password;
}

const FLOAT: Record<PlainDbEngine, (type: string) => boolean> = {
  postgres: t => ['real', 'double precision', 'float4', 'float8'].includes(t),
  mysql: t => ['float', 'double', 'real', 'double precision'].includes(t),
  sqlite: t => !/INT/.test(t) && !/CHAR|CLOB|TEXT/.test(t) && /REAL|FLOA|DOUB/.test(t),
};
const NUMERIC: Record<PlainDbEngine, (type: string) => boolean> = {
  postgres: t => ['smallint', 'integer', 'bigint', 'numeric', 'decimal', 'int2', 'int4', 'int8'].includes(t),
  mysql: t => ['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'decimal', 'numeric'].includes(t),
  sqlite: t => /INT/.test(t) || (!/CHAR|CLOB|TEXT|BLOB/.test(t) && t !== ''),
};
const normType = (engine: PlainDbEngine, type: string) => engine === 'sqlite' ? type.toUpperCase() : type.toLowerCase();

/** Every mapped column must exist in the catalogue, exactly. Money and counts never come from float columns. */
export function checkAgainstCatalogue(mapping: PlainDbMapping, catalogue: readonly CatalogueColumn[]): Map<string, CatalogueColumn> {
  check(catalogue.length > 0, 'DB_TABLE_UNKNOWN', 'The table is not in the database catalogue, or this user cannot read it.');
  const byName = new Map(catalogue.map(column => [column.name, column]));
  for (const name of Object.values(mapping.columns)) check(byName.has(name!), 'DB_COLUMN_UNKNOWN', 'A mapped column is not in the table, or this user cannot read it.');
  for (const role of ['amount', 'quantity'] as const) {
    const name = mapping.columns[role];
    if (name) check(!FLOAT[mapping.engine](normType(mapping.engine, byName.get(name)!.type)), 'DB_FLOAT_AMOUNT', 'Money and counts are not read from floating-point columns.');
  }
  return byName;
}

const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
/** Midnight India Standard Time (fixed +05:30) as epoch seconds. */
const istEpoch = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000 - 19_800;

export type PlainDbQueries = { aggregate: BoundQuery; rows: BoundQuery; aliases: PlainDbRole[] };
/**
 * The aggregate and the rows read use the same table and the same WHERE. The database's COUNT and SUM
 * are the source's own total; the rows are every mapped column cast to text, ordered by id.
 */
export function buildQueries(mapping: PlainDbMapping, catalogue: Map<string, CatalogueColumn>, rowLimit: number): PlainDbQueries {
  const d = DIALECTS[mapping.engine];
  const table = mapping.engine === 'postgres' ? `${d.quote(mapping.table.schema ?? 'public')}.${d.quote(mapping.table.name)}` : d.quote(mapping.table.name);
  const where = (params: (string | number)[]): string => {
    if (!mapping.period) return '';
    const column = d.quote(mapping.columns.date), { from, to } = mapping.period;
    const numeric = NUMERIC[mapping.engine](normType(mapping.engine, catalogue.get(mapping.columns.date)!.type));
    switch (mapping.dateFormat) {
      case 'ISO': return ` WHERE ${column} >= ${d.bind(from, params)} AND ${column} <= ${d.bind(to, params)}`;
      case 'ISO-DATETIME': return ` WHERE ${column} >= ${d.bind(from, params)} AND ${column} < ${d.bind(nextDay(to), params)}`;
      case 'YMD8': {
        const low = from.replaceAll('-', ''), high = to.replaceAll('-', '');
        return ` WHERE ${column} >= ${d.bind(numeric ? Number(low) : low, params)} AND ${column} <= ${d.bind(numeric ? Number(high) : high, params)}`;
      }
      case 'EPOCH-S-IST':
        check(numeric, 'DB_DATE_COLUMN_TYPE', 'Epoch dates are filtered only on a numeric column.');
        return ` WHERE ${column} >= ${d.bind(istEpoch(from), params)} AND ${column} < ${d.bind(istEpoch(nextDay(to)), params)}`;
    }
  };
  const measure = mapping.measure === 'money' ? mapping.columns.amount! : mapping.columns.quantity!;
  const aggregateParams: (string | number)[] = [];
  const aggregate = `SELECT ${d.text('COUNT(*)')} AS ${d.quote('row_count')}, ${d.text(`SUM(${d.quote(measure)})`)} AS ${d.quote('measure_total')} FROM ${table}${where(aggregateParams)}`;
  const aliases = ROLES.filter(role => mapping.columns[role] !== undefined);
  const rowParams: (string | number)[] = [];
  const select = aliases.map(role => `${d.text(d.quote(mapping.columns[role]!))} AS ${d.quote(role)}`).join(', ');
  const filter = where(rowParams);
  const rows = `SELECT ${select} FROM ${table}${filter} ORDER BY ${d.quote(mapping.columns.id)} LIMIT ${d.bind(rowLimit + 1, rowParams)}`;
  return { aggregate: { text: aggregate, params: aggregateParams }, rows: { text: rows, params: rowParams }, aliases };
}

/** Builds the recipe from the mapping: decoder api-records, fields keyed by the selected aliases, totals declared. */
export function recipeFor(mapping: PlainDbMapping, source: string): SourceRecipe {
  const c = mapping.columns, text = (alias: string, required = false): FieldSpec => ({ from: [alias], type: 'text', ...(required ? { required } : {}) });
  const fields: Record<string, FieldSpec> = { id: text('id', true), date: { from: ['date'], type: 'date', required: true, dateFormats: [mapping.dateFormat] } };
  if (c.amount) fields.amount = { from: ['amount'], type: 'money', required: true };
  if (c.quantity) fields.quantity = { from: ['quantity'], type: 'integer', required: mapping.measure === 'count' };
  for (const role of ['currency', 'kind', 'customerId', 'invoiceId', 'status', 'description'] as const) if (c[role]) fields[role] = text(role, role === 'currency' || role === 'kind');
  const outputs: Record<string, string> = {};
  for (const role of ['customerId', 'invoiceId', 'description'] as const) if (c[role]) outputs[role] = role;
  if (c.status) outputs.status = 'status';
  if (c.quantity && mapping.measure === 'money') outputs.quantity = 'quantity';
  const group = `db-${mapping.engine}-${hash(source).slice(0, 16)}`;
  return {
    id: `plain-db.${mapping.engine}.table-read`, version: '1', group, operation: 'table-read', title: 'Plain database table read', decoder: 'api-records',
    fields,
    measure: mapping.measure === 'money'
      ? { type: 'money', amount: { field: 'amount' }, currency: mapping.currency ? { constant: mapping.currency } : { field: 'currency' }, unit: mapping.moneyUnit }
      : { type: 'count', field: 'quantity', unit: mapping.countUnit ?? 'item' },
    identity: ['id'],
    kind: mapping.constantKind ? { constant: mapping.constantKind } : { field: 'kind', values: mapping.kindValues! },
    ...(c.status ? { status: { field: 'status', values: mapping.statusValues! } } : {}),
    ...(Object.keys(outputs).length ? { outputs } : {}),
    totals: { kind: 'declared' },
    notices: ['Read inside one read-only database snapshot; the source total is the database\'s own COUNT and SUM over the same rows.'],
    sensitivity: mapping.measure === 'money' ? 'financial' : 'operational',
  };
}
