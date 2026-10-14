/**
 * The write catalogue as small apps see it. Rows come from the writeback lane's
 * `writeback.catalogue` when that method exists, and from the core `actions.catalogue`
 * otherwise (and for any core action writeback does not list). Every row is checked strictly
 * here at the boundary; a row that fails is ignored and counted, never guessed at.
 *
 * Assumed `writeback.catalogue` contract (not merged yet; the minimum this file needs):
 *   request  `{}`
 *   reply    an array of rows, or `{ rows: [...] }` (other reply fields are ignored), at most 500 rows
 *   row      `system`    connector id, `^[a-z][a-z0-9-]{0,63}$` (`connector` is accepted as the same field)
 *            `operation` `^[a-z][a-z0-9-]{0,63}$`
 *            `label`     plain words, at most 120 characters (`title` is accepted as the same field)
 *            `tier`      `^[a-z][a-z0-9-]{0,31}$`, shown as given
 *            `alwaysWaits` boolean
 *            `status`    `^[a-z][a-z0-9-]{0,31}$` (`depth` is accepted as the same field); only
 *                        `available`, `full`, `supported` and `experimental` can go on a card
 *            `impact`    optional: `reversible` | `message` | `money` | `destructive`
 *            `payloadSchema` optional, the small JSON-Schema subset in `parseSchema`; a schema
 *                        using anything else makes the row unreadable
 *            any other field (write table, idempotency, read-back, retry window…) is ignored.
 *   Two rows with the same system and operation are both ignored.
 * Assumed `writeback.prepare` contract: request `{ system, operation, payload, idempotencyKey, sourceIds? }`,
 * reply `{ id, status: 'prepared', digest, … }`. Any other status is refused: preparing never approves or does.
 *
 * Always-waits can only be added here, never removed: a row is always-waits when it says so, when its
 * impact is not `reversible`, or when its operation or label names money, outside messages, deleting
 * or anything that cannot be undone.
 */
import { ChausarError, check } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';

export type Schema =
  | { type: 'string'; minLength: number; maxLength: number; enum?: string[]; format?: 'paise' | 'date' }
  | { type: 'integer'; minimum?: number; maximum?: number }
  | { type: 'boolean' }
  | { type: 'array'; items: Schema; maxItems: number }
  | { type: 'object'; properties: Record<string, Schema>; required: string[] };
export type ActionRow = {
  key: string; connector: string; operation: string; label: string; tier: string | null; alwaysWaits: boolean;
  available: boolean; status: string; impact: 'reversible' | 'message' | 'money' | 'destructive' | null;
  payloadSchema: Schema | null; origin: 'writeback' | 'core';
};
export type Catalogue = { rows: ActionRow[]; writeback: 'used' | 'absent' | 'unreadable'; notCounted: number; words: string | null };

const ABSENT = new Set(['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE', 'INVALID_REQUEST']);
const AVAILABLE = new Set(['available', 'full', 'supported', 'experimental']);
const IMPACTS = new Set(['reversible', 'message', 'money', 'destructive']);
const ID = /^[a-z][a-z0-9-]{0,63}$/, SHORT = /^[a-z][a-z0-9-]{0,31}$/;
/** Words that put an action on the always-waits list whatever its row says (TR-05). */
const WAITS = new Set(['pay', 'payout', 'payouts', 'transfer', 'refund', 'refunds', 'charge', 'debit', 'send', 'message', 'messages', 'whatsapp', 'sms', 'email', 'mail',
  'delete', 'remove', 'erase', 'purge', 'cancel', 'void', 'price', 'prices', 'pricing', 'stock', 'inventory', 'listing', 'listings', 'publish', 'share', 'sharing', 'invite',
  'webhook', 'webhooks', 'tax', 'gst', 'gstr', 'tds', 'filing', 'file']);
const tokens = (text: string) => text.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{M}]+/u).filter(Boolean);
export const mustWait = (operation: string, label: string) => [...tokens(operation), ...tokens(label)].some(t => WAITS.has(t));

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\p{Cc}\p{Cf}]/u.test(value);
const pick = (row: Record<string, unknown>, a: string, b: string) => Object.hasOwn(row, a) ? (Object.hasOwn(row, b) ? undefined : row[a]) : row[b];
const ANNOTATIONS = ['description', 'title'];

/** The payload schema subset small apps understand. Anything else makes the row unreadable (throws). */
export function parseSchema(value: unknown, depth = 0): Schema {
  const bad = () => new ChausarError('SMALLAPP_SCHEMA_UNSUPPORTED', 'This action describes its payload in a form small apps do not read.');
  if (!plain(value) || depth > 5) throw bad();
  const keys = Object.keys(value), allow = (...extra: string[]) => { if (!keys.every(k => ['type', ...ANNOTATIONS, ...extra].includes(k))) throw bad(); };
  const count = (v: unknown, max: number) => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;
  switch (value.type) {
    case 'string': {
      allow('minLength', 'maxLength', 'enum', 'format');
      if ((value.minLength !== undefined && !count(value.minLength, 4000)) || (value.maxLength !== undefined && !count(value.maxLength, 4000))) throw bad();
      if (value.enum !== undefined && !(Array.isArray(value.enum) && value.enum.length > 0 && value.enum.length <= 64 && value.enum.every(e => typeof e === 'string' && e.length <= 200))) throw bad();
      if (value.format !== undefined && value.format !== 'paise' && value.format !== 'date') throw bad();
      const schema: Schema = { type: 'string', minLength: (value.minLength as number | undefined) ?? 0, maxLength: (value.maxLength as number | undefined) ?? 4000 };
      if (value.enum) schema.enum = [...value.enum as string[]];
      if (value.format) schema.format = value.format as 'paise' | 'date';
      if (schema.minLength > schema.maxLength) throw bad();
      return schema;
    }
    case 'integer': {
      allow('minimum', 'maximum');
      if ([value.minimum, value.maximum].some(v => v !== undefined && !Number.isSafeInteger(v))) throw bad();
      return { type: 'integer', ...(value.minimum !== undefined ? { minimum: value.minimum as number } : {}), ...(value.maximum !== undefined ? { maximum: value.maximum as number } : {}) };
    }
    case 'boolean': allow(); return { type: 'boolean' };
    case 'array': {
      allow('items', 'maxItems'); if (value.maxItems !== undefined && !count(value.maxItems, 200)) throw bad();
      return { type: 'array', items: parseSchema(value.items, depth + 1), maxItems: (value.maxItems as number | undefined) ?? 50 };
    }
    case 'object': {
      allow('properties', 'required', 'additionalProperties');
      if (!plain(value.properties) || Object.keys(value.properties).length > 64 || (value.additionalProperties !== undefined && value.additionalProperties !== false)) throw bad();
      const properties: Record<string, Schema> = {};
      for (const [name, inner] of Object.entries(value.properties)) { if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) throw bad(); properties[name] = parseSchema(inner, depth + 1); }
      const required = value.required ?? [];
      if (!Array.isArray(required) || !required.every(r => typeof r === 'string' && Object.hasOwn(properties, r))) throw bad();
      return { type: 'object', properties, required: [...new Set(required as string[])] };
    }
    default: throw bad();
  }
}

/**
 * Check what the person typed for the action against the row's schema. These values are the
 * person's own data (an invoice id, a reminder text, an amount they entered), so the small-app
 * number guard does not apply to them; it applies only to words a model wrote into the app.
 */
export function checkPayload(schema: Schema, value: unknown, depth = 0): void {
  const fail = () => { throw new ChausarError('SMALLAPP_PAYLOAD_INVALID', 'The details for this action do not match what the action takes.'); };
  if (depth > 6) fail();
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string' || value.length < schema.minLength || value.length > schema.maxLength || /[\p{Cc}\p{Cf}]/u.test(value.replace(/[\n\t]/g, ' '))) fail();
      if (schema.enum && !schema.enum.includes(value as string)) fail();
      if (schema.format === 'paise' && !/^(0|[1-9]\d{0,17})$/.test(value as string)) fail();
      if (schema.format === 'date' && !(/^\d{4}-\d{2}-\d{2}$/.test(value as string) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value)) fail();
      return;
    case 'integer':
      if (!Number.isSafeInteger(value) || (schema.minimum !== undefined && (value as number) < schema.minimum) || (schema.maximum !== undefined && (value as number) > schema.maximum)) fail();
      return;
    case 'boolean': if (typeof value !== 'boolean') fail(); return;
    case 'array':
      if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > schema.maxItems) fail();
      for (const item of value as unknown[]) checkPayload(schema.items, item, depth + 1);
      return;
    case 'object': {
      if (!plain(value)) fail();
      const input = value as Record<string, unknown>;
      if (!Object.keys(input).every(k => Object.hasOwn(schema.properties, k)) || !schema.required.every(k => Object.hasOwn(input, k))) fail();
      for (const [k, v] of Object.entries(input)) checkPayload(schema.properties[k], v, depth + 1);
    }
  }
}

/** One writeback row, strictly. Throws on anything outside the assumed contract. */
export function writebackRow(value: unknown): ActionRow {
  const bad = () => new ChausarError('SMALLAPP_ROW_INVALID', 'A write catalogue row is outside the expected shape.');
  if (!plain(value)) throw bad();
  const connector = pick(value, 'system', 'connector'), label = pick(value, 'label', 'title'), status = pick(value, 'status', 'depth');
  const { operation, tier, alwaysWaits, impact } = value;
  if (typeof connector !== 'string' || !ID.test(connector) || typeof operation !== 'string' || !ID.test(operation) || !text(label, 120)
    || typeof tier !== 'string' || !SHORT.test(tier) || typeof alwaysWaits !== 'boolean' || typeof status !== 'string' || !SHORT.test(status)
    || (impact !== undefined && !IMPACTS.has(impact as string))) throw bad();
  const payloadSchema = value.payloadSchema === undefined ? null : parseSchema(value.payloadSchema);
  if (payloadSchema && payloadSchema.type !== 'object') throw bad();
  const rowImpact = (impact as ActionRow['impact'] | undefined) ?? null;
  return { key: `${connector}/${operation}`, connector, operation, label: (label as string).trim(), tier, status, available: AVAILABLE.has(status),
    alwaysWaits: alwaysWaits || (rowImpact !== null && rowImpact !== 'reversible') || mustWait(operation, label as string), impact: rowImpact, payloadSchema, origin: 'writeback' };
}

/** Core `actions.catalogue` rows: connectors with operations and their impact. Core validates payloads itself. */
export function coreRows(value: unknown): { rows: ActionRow[]; notCounted: number } {
  const rows: ActionRow[] = []; let notCounted = 0;
  for (const connector of Array.isArray(value) ? value : []) {
    if (!plain(connector) || typeof connector.id !== 'string' || !ID.test(connector.id) || !Array.isArray(connector.operations)) { notCounted++; continue; }
    for (const op of connector.operations) {
      if (!plain(op) || typeof op.id !== 'string' || !ID.test(op.id) || !text(op.title, 120) || !IMPACTS.has(op.impact as string)) { notCounted++; continue; }
      const impact = op.impact as NonNullable<ActionRow['impact']>;
      rows.push({ key: `${connector.id}/${op.id}`, connector: connector.id, operation: op.id, label: (op.title as string).trim(), tier: null, status: 'available', available: true,
        alwaysWaits: impact !== 'reversible' || mustWait(op.id, op.title as string), impact, payloadSchema: null, origin: 'core' });
    }
  }
  return { rows, notCounted };
}

/** Read the catalogue through writeback when it exists, the core catalogue otherwise. */
export async function loadCatalogue(host: Pick<ModuleHost, 'call'>): Promise<Catalogue> {
  let reply: unknown, writeback: Catalogue['writeback'] = 'used';
  try { reply = await host.call('writeback.catalogue', {}); }
  catch (error) { if (error instanceof ChausarError && ABSENT.has(error.code)) writeback = 'absent'; else throw error; }
  const rows: ActionRow[] = []; let notCounted = 0;
  if (writeback === 'used') {
    const list = Array.isArray(reply) ? reply : plain(reply) && Array.isArray(reply.rows) ? reply.rows : null;
    if (!list || list.length > 500) writeback = 'unreadable';
    else {
      const parsed = list.map(item => { try { return writebackRow(item); } catch { notCounted++; return null; } }).filter((r): r is ActionRow => r !== null);
      const seen = new Map<string, number>(); for (const r of parsed) seen.set(r.key, (seen.get(r.key) ?? 0) + 1);
      for (const r of parsed) if (seen.get(r.key) === 1) rows.push(r); else notCounted++;
    }
  }
  const core = coreRows(await host.call('actions.catalogue', {}));
  notCounted += core.notCounted;
  for (const row of core.rows) if (!rows.some(r => r.key === row.key)) rows.push(row);
  rows.sort((a, b) => a.key.localeCompare(b.key));
  const words = writeback === 'unreadable' ? 'The write catalogue could not be read, so only the built-in actions are offered.'
    : notCounted > 0 ? 'Some catalogue rows could not be read and are not counted; they cannot be put on a card.' : null;
  return { rows, writeback, notCounted, words };
}

export type Prepared = { id: string; connector: string; operation: string; status: 'prepared'; digest: string; impact: string | null; through: 'writeback' | 'core' };
/** Prepare, never more: writeback.prepare for writeback rows when it exists, core actions.prepare otherwise. */
export async function prepareAction(host: Pick<ModuleHost, 'call'>, row: ActionRow, request: { payload: unknown; idempotencyKey: string; sourceIds?: string[] }): Promise<Prepared> {
  let reply: any, through: Prepared['through'] = 'core';
  if (row.origin === 'writeback') {
    try { reply = await host.call('writeback.prepare', { system: row.connector, operation: row.operation, ...request }); through = 'writeback'; }
    catch (error) { if (!(error instanceof ChausarError && ['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE'].includes(error.code))) throw error; }
  }
  if (through === 'core') reply = await host.call('actions.prepare', { connector: row.connector, operation: row.operation, ...request });
  check(plain(reply) && typeof reply.id === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(reply.id) && typeof reply.digest === 'string' && /^[A-Za-z0-9_.:-]{8,200}$/.test(reply.digest),
    'SMALLAPP_PREPARE_UNREADABLE', 'The prepared action came back in an unexpected shape. Check the approvals list before trying again.');
  check(reply.status === 'prepared', 'SMALLAPP_PREPARE_UNREADABLE', 'The action did not come back as only prepared. Check the approvals list; nothing more is done from here.');
  return { id: reply.id, connector: row.connector, operation: row.operation, status: 'prepared', digest: reply.digest,
    impact: typeof reply.impact === 'string' && IMPACTS.has(reply.impact) ? reply.impact : row.impact, through };
}
