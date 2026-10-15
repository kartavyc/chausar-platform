/**
 * The write catalogue as small apps see it. Rows come from the writeback lane's
 * `writeback.catalogue` when that method exists, and from the core `actions.catalogue`
 * otherwise (and for any core action writeback does not list). Every row is checked strictly
 * here at the boundary; a row that fails is ignored and counted, never guessed at.
 *
 * Confirmed `writeback.catalogue` contract, checked against writeback commit 1bba591
 * (`platform/runtime/writeback/catalogue.ts` CatalogueEntry, `WritebackService.row` in
 * `platform/runtime/writeback/service.ts`, `platform/runtime/modules/lane-writeback.ts`):
 *   request  `{}`; reply a plain array of rows (at most 500 here)
 *   row      `system`  connector id (`tally`, `zoho-books`, …), `^[a-z][a-z0-9-]{0,63}$`
 *            `action`  dotted action id (`voucher.create`, `invoice.createDraft`), see ACTION_ID
 *            `title`   plain words, at most 120 characters
 *            `kind`    `inside-undoable` | `seen-outside` | `money` | `cannot-undo`
 *                      (shown as impact `reversible` | `message` | `money` | `destructive`)
 *            `tier`    `1` | `2` | `'prepare-only'`
 *            `alwaysWaits` boolean
 *            `status`  `live` | `experimental` | `prepare-only` | `not-yet` (effective status);
 *                      with `installed: true` and a tier other than prepare-only, `live` and
 *                      `experimental` can go on a card
 *            `recipe.requiredFields` the payload's required top-level fields
 *            `connections` `[{ id, label, environment: live|sandbox|practice, read, write }]`,
 *                      `write` meaning this action is granted on that connection
 *            other fields (idempotency, reference, read-back, windows, reversal…) are ignored.
 *   There is no JSON payload schema: each adapter's own `validate` is the schema and runs inside
 *   `writeback.prepare` (refusing unknown fields, `INVALID_WRITE_PAYLOAD`, `INVALID_AMOUNT`,
 *   `INVALID_DATE`, …). Here a payload is checked only as a small plain object holding every
 *   required field. Two rows with the same system and action are both ignored.
 * Confirmed `writeback.prepare` contract: request `{ connectionId, action, payload, intentId, sourceIds? }`.
 * The idempotency key is derived from (system, action, connection, intentId): the same intent and
 * payload returns the same prepared action; the same intent with another payload is refused
 * (`IDEMPOTENCY_CONFLICT`). Reply: the action view `{ id, system, action, digest, status: 'prepared',
 * word, alwaysWaits, kind, tier, practice, expiresAt, approval: { needsSecondAsk, … }, … }`, or
 * `{ status: 'already-done', externalId, … }` when the effect is already in the system (nothing is
 * prepared). Any other status is refused: preparing never approves or does. Approval stays with
 * `writeback.approve {id, digest, secondAsk?}`; money and changes that cannot be undone first need
 * `writeback.reauth` (the second ask, `REAUTH_REQUIRED` without it). A practice connection
 * (`environment: 'practice'`) prepares against Practice systems and is marked `practice`.
 *
 * Always-waits can only be added here, never removed. A row is NOT always-waits only when all three
 * hold: its kind is `inside-undoable` (core: impact `reversible`), it says `alwaysWaits: false`, and
 * neither its action nor its title names money, outside messages, deleting or anything that cannot
 * be undone.
 */
import { ChausarError, check } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';

type Impact = 'reversible' | 'message' | 'money' | 'destructive';
export type Connection = { id: string; label: string; environment: 'live' | 'sandbox' | 'practice'; write: boolean };
export type ActionRow = {
  key: string; connector: string; operation: string; label: string; tier: 1 | 2 | 'prepare-only' | null; alwaysWaits: boolean;
  available: boolean; status: string; impact: Impact | null; requiredFields: string[]; connections: Connection[]; origin: 'writeback' | 'core';
};
export type Catalogue = { rows: ActionRow[]; writeback: 'used' | 'absent' | 'unreadable'; notCounted: number; words: string | null };

const ABSENT = new Set(['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE', 'INVALID_REQUEST']);
const KIND_IMPACT: Record<string, Impact> = { 'inside-undoable': 'reversible', 'seen-outside': 'message', money: 'money', 'cannot-undo': 'destructive' };
const IMPACTS = new Set<string>(Object.values(KIND_IMPACT));
const STATUSES = new Set(['live', 'experimental', 'prepare-only', 'not-yet']), CARD_STATUSES = new Set(['live', 'experimental']);
const ENVIRONMENTS = new Set(['live', 'sandbox', 'practice']);
const ID = /^[a-z][a-z0-9-]{0,63}$/, FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/, REF = /^[A-Za-z0-9_.:-]{1,200}$/;
/** Writeback actions are dotted (`invoice.createDraft`); core operations are kebab (`reminder-draft`). */
export const ACTION_ID = /^(?=.{1,64}$)[a-z][A-Za-z0-9-]*(\.[A-Za-z][A-Za-z0-9-]*)*$/;
/** Words that put an action on the always-waits list whatever its row says (TR-05). */
const WAITS = new Set(['pay', 'payout', 'payouts', 'transfer', 'refund', 'refunds', 'charge', 'debit', 'send', 'message', 'messages', 'whatsapp', 'sms', 'email', 'mail',
  'delete', 'remove', 'erase', 'purge', 'cancel', 'void', 'price', 'prices', 'pricing', 'stock', 'inventory', 'listing', 'listings', 'publish', 'share', 'sharing', 'invite',
  'webhook', 'webhooks', 'tax', 'gst', 'gstr', 'tds', 'filing']);
/** Words of an id or label, camelCase split (`paymentLink` reads as payment, link). */
const tokens = (text: string) => text.normalize('NFKC').replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').toLowerCase().split(/[^\p{L}\p{M}]+/u).filter(Boolean);
export const mustWait = (operation: string, label: string) => [...tokens(operation), ...tokens(label)].some(t => WAITS.has(t));

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\p{Cc}\p{Cf}]/u.test(value);

/**
 * The boundary check on what the person typed for a writeback action: a small plain JSON object
 * holding every required field. Its full shape is the writeback adapter's to judge. These values are
 * the person's own data, so the small-app number guard does not apply to them.
 */
export function checkPayload(row: ActionRow, value: unknown): void {
  let size = Infinity; try { size = JSON.stringify(value)?.length ?? Infinity; } catch { /* cycles and exotic values are refused below */ }
  check(plain(value) && size <= 64_000 && row.requiredFields.every(field => Object.hasOwn(value, field)),
    'SMALLAPP_PAYLOAD_INVALID', 'The details for this action do not match what the action takes.');
}

function connection(value: unknown): Connection {
  if (!plain(value) || typeof value.id !== 'string' || !REF.test(value.id) || !text(value.label, 100) || !ENVIRONMENTS.has(value.environment as string)
    || typeof value.write !== 'boolean' || typeof value.read !== 'boolean') throw new ChausarError('SMALLAPP_ROW_INVALID', 'A write catalogue row is outside the expected shape.');
  return { id: value.id, label: (value.label as string).trim(), environment: value.environment as Connection['environment'], write: value.write && value.read };
}

/** One `writeback.catalogue` row, strictly. Throws on anything outside the confirmed contract. */
export function writebackRow(value: unknown): ActionRow {
  const bad = () => new ChausarError('SMALLAPP_ROW_INVALID', 'A write catalogue row is outside the expected shape.');
  if (!plain(value)) throw bad();
  const { system, action, title, kind, tier, alwaysWaits, status, installed, recipe, connections } = value;
  if (typeof system !== 'string' || !ID.test(system) || typeof action !== 'string' || !ACTION_ID.test(action) || !text(title, 120)
    || typeof kind !== 'string' || !Object.hasOwn(KIND_IMPACT, kind) || !(tier === 1 || tier === 2 || tier === 'prepare-only') || typeof alwaysWaits !== 'boolean'
    || typeof status !== 'string' || !STATUSES.has(status) || typeof installed !== 'boolean'
    || !plain(recipe) || !Array.isArray(recipe.requiredFields) || recipe.requiredFields.length > 64 || !recipe.requiredFields.every(f => typeof f === 'string' && FIELD.test(f))
    || !Array.isArray(connections) || connections.length > 50) throw bad();
  const impact = KIND_IMPACT[kind];
  return { key: `${system}/${action}`, connector: system, operation: action, label: (title as string).trim(), tier, status,
    available: CARD_STATUSES.has(status) && installed && tier !== 'prepare-only',
    alwaysWaits: !(kind === 'inside-undoable' && alwaysWaits === false && !mustWait(action, title as string)), impact,
    requiredFields: [...new Set(recipe.requiredFields as string[])], connections: connections.map(connection), origin: 'writeback' };
}

/** Core `actions.catalogue` rows: connectors with operations and their impact. Core validates payloads itself. */
export function coreRows(value: unknown): { rows: ActionRow[]; notCounted: number } {
  const rows: ActionRow[] = []; let notCounted = 0;
  for (const connector of Array.isArray(value) ? value : []) {
    if (!plain(connector) || typeof connector.id !== 'string' || !ID.test(connector.id) || !Array.isArray(connector.operations)) { notCounted++; continue; }
    for (const op of connector.operations) {
      if (!plain(op) || typeof op.id !== 'string' || !ID.test(op.id) || !text(op.title, 120) || !IMPACTS.has(op.impact as string)) { notCounted++; continue; }
      const impact = op.impact as Impact;
      rows.push({ key: `${connector.id}/${op.id}`, connector: connector.id, operation: op.id, label: (op.title as string).trim(), tier: null, status: 'available', available: true,
        alwaysWaits: impact !== 'reversible' || mustWait(op.id, op.title as string), impact, requiredFields: [], connections: [], origin: 'core' });
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
    if (!Array.isArray(reply) || reply.length > 500) writeback = 'unreadable';
    else {
      const parsed = reply.map(item => { try { return writebackRow(item); } catch { notCounted++; return null; } }).filter((r): r is ActionRow => r !== null);
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

/** Connections a writeback row can be prepared through: read and this action's write granted. */
export const grantedConnections = (row: ActionRow) => row.connections.filter(c => c.write);
/** The one connection a press goes through: the named one, or the only granted one. */
export function pressConnection(row: ActionRow, connectionId: unknown): Connection {
  const granted = grantedConnections(row);
  if (connectionId !== undefined) {
    const chosen = granted.find(c => c.id === connectionId);
    check(chosen, 'SMALLAPP_CONNECTION_NOT_GRANTED', 'That connection is not allowed to do this action. Nothing was prepared.');
    return chosen;
  }
  check(granted.length > 0, 'SMALLAPP_CONNECTION_NOT_GRANTED', 'Connect this system and allow this action on it first. Nothing was prepared.');
  check(granted.length === 1, 'SMALLAPP_CONNECTION_REQUIRED', 'More than one connection can do this action. Choose one. Nothing was prepared.');
  return granted[0];
}

export type Prepared =
  | { status: 'prepared'; id: string; connector: string; operation: string; digest: string; impact: string | null; through: 'writeback' | 'core';
      alwaysWaits: boolean; secondAsk: boolean; practice: boolean; connectionId: string | null; expiresAt: string | null }
  | { status: 'already-done'; connector: string; operation: string; externalId: string | null; through: 'writeback' };
const unreadable = 'SMALLAPP_PREPARE_UNREADABLE';
/** Prepare, never more: writeback.prepare for writeback rows, core actions.prepare for core rows. */
export async function prepareAction(host: Pick<ModuleHost, 'call'>, row: ActionRow, request: { payload: unknown; intentId: string; sourceIds?: string[]; connectionId?: unknown }): Promise<Prepared> {
  const base = { connector: row.connector, operation: row.operation };
  if (row.origin === 'writeback') {
    const via = pressConnection(row, request.connectionId);
    let reply: any;
    try { reply = await host.call('writeback.prepare', { connectionId: via.id, action: row.operation, payload: request.payload, intentId: request.intentId, ...(request.sourceIds ? { sourceIds: request.sourceIds } : {}) }); }
    catch (error) { if (error instanceof ChausarError && ['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE'].includes(error.code)) throw new ChausarError('SMALLAPP_ACTION_UNAVAILABLE', 'This action is in the catalogue but not available now. Nothing was prepared.'); throw error; }
    check(plain(reply), unreadable, 'The prepared action came back in an unexpected shape. Check the approvals list before trying again.');
    if (reply.status === 'already-done') {
      return { status: 'already-done', ...base, through: 'writeback', externalId: typeof reply.externalId === 'string' && REF.test(reply.externalId) ? reply.externalId : null };
    }
    check(typeof reply.id === 'string' && REF.test(reply.id) && typeof reply.digest === 'string' && /^[A-Za-z0-9_.:-]{8,200}$/.test(reply.digest)
      && reply.system === row.connector && reply.action === row.operation && typeof reply.alwaysWaits === 'boolean' && typeof reply.practice === 'boolean'
      && typeof reply.kind === 'string' && Object.hasOwn(KIND_IMPACT, reply.kind) && plain(reply.approval) && typeof reply.approval.needsSecondAsk === 'boolean'
      && (reply.expiresAt === null || typeof reply.expiresAt === 'string'),
    unreadable, 'The prepared action came back in an unexpected shape. Check the approvals list before trying again.');
    check(reply.status === 'prepared', unreadable, 'The action did not come back as only prepared. Check the approvals list; nothing more is done from here.');
    return { status: 'prepared', id: reply.id, ...base, digest: reply.digest, impact: KIND_IMPACT[reply.kind as string], through: 'writeback',
      alwaysWaits: row.alwaysWaits || reply.alwaysWaits, secondAsk: reply.approval.needsSecondAsk, practice: reply.practice, connectionId: via.id,
      expiresAt: typeof reply.expiresAt === 'string' && reply.expiresAt.length <= 40 ? reply.expiresAt : null };
  }
  check(request.connectionId === undefined, 'SMALLAPP_INVALID', 'Built-in actions do not take a connection.');
  const reply: any = await host.call('actions.prepare', { ...base, payload: request.payload, idempotencyKey: request.intentId, ...(request.sourceIds ? { sourceIds: request.sourceIds } : {}) });
  check(plain(reply) && typeof reply.id === 'string' && REF.test(reply.id) && typeof reply.digest === 'string' && /^[A-Za-z0-9_.:-]{8,200}$/.test(reply.digest),
    unreadable, 'The prepared action came back in an unexpected shape. Check the approvals list before trying again.');
  check(reply.status === 'prepared', unreadable, 'The action did not come back as only prepared. Check the approvals list; nothing more is done from here.');
  return { status: 'prepared', id: reply.id, ...base, digest: reply.digest, impact: typeof reply.impact === 'string' && IMPACTS.has(reply.impact) ? reply.impact : row.impact,
    through: 'core', alwaysWaits: row.alwaysWaits, secondAsk: false, practice: false, connectionId: null, expiresAt: null };
}
