/**
 * Reply checks for the connectors-ext Books sub-places (scheduled reads, the database road,
 * Tally on another computer), mirroring docs/lanes/connectors-ext.md and the engine's own
 * reply shapes (platform/runtime/connectors-ext/service.ts). Every reply is untrusted data:
 * it is drawn only after it passed its check here. Unknown extra fields are ignored.
 */
import { bool, count, either, id, instant, isoDate, list, month, nullable, object, oneOf, record, text, type Check } from '../work/kit/validate.ts';
import { InvalidReply } from '../work/kit/validate.ts';

const name = text(400);
const line = text(4000);
const code = text(64);
/** Exact whole minor units (or a whole count) as text. Never a float. */
const digits: Check<string> = (value, path) => typeof value === 'string' && /^-?\d{1,30}$/.test(value) ? value : (() => { throw new InvalidReply(path); })();
const when: Check<string> = either(instant, isoDate);
const period = nullable(object({ from: isoDate, to: isoDate }));
export const ROADS = ['interface', 'file', 'screen', 'database'] as const;
export type Road = typeof ROADS[number];

/** Short text values keyed by short names: connection settings are non-secret, never a credential. */
const settings: Check<Readonly<Record<string, string>>> = (value, path) => {
  const source = record(value, path);
  const entries = Object.entries(source);
  if (entries.length > 40) throw new InvalidReply(path);
  return Object.freeze(Object.fromEntries(entries.map(([key, v]) => {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(key)) throw new InvalidReply(`${path}.key`);
    return [key, text(400)(v, `${path}.${key}`)];
  })));
};

const CATCH_UP = ['run-once', 'skip'] as const;
export type CatchUp = typeof CATCH_UP[number];
const hours: Check<number> = (value, path) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 1488 ? value : (() => { throw new InvalidReply(path); })();
const scheduleShape = {
  operation: name, everyHours: hours, freshnessTargetHours: hours, catchUp: oneOf(CATCH_UP),
  lastRunAt: nullable(when), lastOutcome: nullable(text(200)),
};

/** One connection from `connectorsx.connections` (and the reply of `connectorsx.schedule`). */
export const connection = object({
  id, group: name, road: oneOf(ROADS), label: name, company: text(400), branch: name, sourceId: id, status: oneOf(['active', 'paused']),
}, {
  settings,
  schedule: nullable(object(scheduleShape, { autoImport: bool })),
});
export type Connection = ReturnType<typeof connection>;
export const connectionsReply = list(connection, 400);

const MONTH_STATES = ['loaded', 'not-loaded-yet', 'refused', 'failed', 'loading'] as const;
export type MonthState = typeof MONTH_STATES[number];
/** One source from `connectorsx.freshness`: twelve squares, the last read, the schedule and staleness. */
export const freshnessRow = object({
  sourceId: id,
  months: (value: unknown, path: string) => {
    const months = list(object({ month, status: oneOf(MONTH_STATES) }), 12)(value, path);
    if (months.length !== 12) throw new InvalidReply(path);
    return months;
  },
  lastRead: nullable(when),
  schedule: nullable(object(scheduleShape)),
  stale: nullable(bool),
}, {
  lastFailure: nullable(object({ at: when, status: oneOf(['accepted', 'refused', 'abstained', 'failed']), code: nullable(code) })),
  connection: nullable(object({ id, group: name, road: oneOf(ROADS), label: name, status: oneOf(['active', 'paused']) })),
  unmappedFields: list(name, 2000),
});
export type FreshnessRow = ReturnType<typeof freshnessRow>;
export const freshnessReply = list(freshnessRow, 400);

const DEPTHS = ['import', 'read', 'full'] as const;
const STATUS = ['tested', 'experimental', 'planned', 'not-possible'] as const;
/** One operation of a system on the coverage board. `live` is read when the engine sends it. */
export const systemOperation = object({
  id: name, label: line, depth: oneOf(DEPTHS), road: oneOf(ROADS), status: oneOf(STATUS), limitation: line,
}, { owner: name, live: bool, tier: name });
export type SystemOperation = ReturnType<typeof systemOperation>;
export const systemsReply = object({
  groups: list(object({ id: name, name, operations: list(systemOperation, 400) }), 400),
});
export type SystemsReply = ReturnType<typeof systemsReply>;

/**
 * Reads that may repeat on their own: a read through the system's own interface, built by this
 * lane, that the engine marks live (or, where `live` is not sent, tested). The engine still
 * decides: a read checked only against a typed total is refused with SCHEDULE_NEEDS_SOURCE_TOTAL.
 */
export function repeatable(reply: SystemsReply, group: string): readonly SystemOperation[] {
  const found = reply.groups.find(g => g.id === group);
  if (!found) return [];
  return found.operations.filter(op => op.road === 'interface' && op.depth === 'read' && (op.owner === undefined || op.owner === 'connectors-ext')
    && (op.live !== undefined ? op.live : op.status === 'tested'));
}

const checkValue = nullable(either(digits, count));
/** The envelope a read, a file or an answer file produced. Summary only: never source rows. */
export const envelope = object({
  id, sourceId: id, group: name, operation: name, recipeId: name, road: oneOf(ROADS), fetchedAt: when,
  status: oneOf(['accepted', 'refused', 'abstained', 'failed']),
  refusal: nullable(object({ code, reason: line }, { line: count })),
  abstention: nullable(object({ reason: code, field: name, question: line, options: list(name, 40) })),
  checks: list(object({ id: name, status: oneOf(['passed', 'failed', 'unavailable']) }, { expected: checkValue, observed: checkValue, line: count }), 50),
  observed: object({ rowCount: count, total: digits, unit: text(40) }),
  sourceTotals: nullable(object({ rowCount: nullable(count), total: nullable(digits), reference: name, provenance: name })),
  unmappedFields: list(name, 2000),
  excludedRows: count,
  committed: nullable(object({ at: when, rows: count, duplicate: bool }, { importId: id })),
}, {
  connectionId: nullable(id), company: text(400), recipeVersion: name, period, requestedPeriod: period,
  notices: list(line, 40), pendingRows: count, pendingExpiresAt: nullable(when), duplicate: bool,
});
export type Envelope = ReturnType<typeof envelope>;
/** Whether an envelope is still waiting for a person: accepted, rows held, not yet imported. */
export const waiting = (e: Envelope): boolean => e.status === 'accepted' && e.committed === null && (e.pendingRows === undefined || e.pendingRows > 0);

/** `connectorsx.plainDb.tables`: the database's own catalogue, system catalogues already left out. */
export const tablesReply = list(object({
  schema: nullable(name), name, columns: list(object({ name, type: text(120), nullable: bool }), 2000),
}), 2000);
export type DbTable = ReturnType<typeof tablesReply>[number];

const fileName = (suffix: RegExp): Check<string> => (value, path) =>
  typeof value === 'string' && value.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(value) && suffix.test(value) && !value.includes('..') ? value : (() => { throw new InvalidReply(path); })();
/** `connectorsx.tally.exporter`: the PowerShell script, the one-page guide in both languages, and when it expires. */
export const exporterReply = object({
  exportId: id, fileName: fileName(/\.ps1$/i), script: text(2_000_000), guideFileName: fileName(/\.(txt|md)$/i),
  guide: object({ en: text(40_000), hi: text(40_000) }), expiresAt: when,
});
export type ExporterReply = ReturnType<typeof exporterReply>;

/** Methods that read outside: refused in demo mode with DEMO_EXTERNAL_DISABLED. */
export const EXTERNAL_METHODS: ReadonlySet<string> = new Set(['connectorsx.plainDb.tables', 'connectorsx.plainDb.read']);
