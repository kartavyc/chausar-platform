/**
 * Sources through the connector factory (BK-01, BK-02, BK-03): the books.* methods that call
 * the connectors-ext lane's `connectorsx.*` family as the same caller. Every reply from that
 * lane is untrusted here: each field is checked and copied into the Books shapes below, never
 * passed through whole. When the family is not installed, readers answer `{ available: false }`
 * and changers refuse `CONNECTORS_NOT_INSTALLED`.
 */
import { check, ChausarError, type Context } from '../contracts.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { optionalCall } from './adapters.ts';
import { input, plainId, text, isoDay } from './books-common.ts';
import { sourceVisible } from './books-sources.ts';

type Raw = Record<string, unknown>;
const plain = (value: unknown): value is Raw => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const str = (value: unknown, max = 400): string | null => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ? value : null;
const int = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const digits = (value: unknown): string | null => typeof value === 'string' && /^-?\d{1,30}$/.test(value) ? String(BigInt(value)) : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : null;
const one = <T extends string>(value: unknown, allowed: readonly T[]): T | null => typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : null;
const rows = (value: unknown, max = 2000): Raw[] => Array.isArray(value) ? value.filter(plain).slice(0, max) : [];
const strings = (value: unknown, max = 200): string[] => Array.isArray(value) ? value.map(v => str(v)).filter((v): v is string => v !== null).slice(0, max) : [];
const period = (value: unknown) => plain(value) && isoDay(value.from) && isoDay(value.to) ? { from: value.from as string, to: value.to as string } : null;

export const NOT_INSTALLED = 'CONNECTORS_NOT_INSTALLED';
/** A required connectorsx call: a missing family refuses with a typed code; other refusals pass through. */
async function required(host: ModuleHost, method: string, payload: Raw): Promise<unknown> {
  try { return await host.call(method, payload); }
  catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code === 'UNKNOWN_METHOD' || code === 'METHOD_UNAVAILABLE') throw new ChausarError(NOT_INSTALLED, 'Connecting systems is not installed in this build. Bring a file instead.');
    throw error;
  }
}

/* ------------------------------------------------------------------ connections */

export type ConnectionView = { connectionId: string; sourceId: string; group: string; road: 'interface' | 'file' | 'database'; label: string; company: string; branch: string; status: 'active' | 'paused' };
export function connectionOf(raw: unknown): ConnectionView | null {
  if (!plain(raw)) return null;
  const connectionId = str(raw.id, 200), sourceId = str(raw.sourceId, 200), group = str(raw.group, 80), road = one(raw.road, ['interface', 'file', 'database'] as const);
  const status = one(raw.status, ['active', 'paused'] as const);
  if (!connectionId || !sourceId || !group || !road || !status) return null;
  return { connectionId, sourceId, group, road, label: str(raw.label, 120) ?? group, company: str(raw.company, 200) ?? '', branch: str(raw.branch, 100) ?? 'main', status };
}
/** Connections the caller may see (connectorsx already scopes them), each checked again against the Books source rule. */
export async function connections(host: ModuleHost, ctx: Context): Promise<{ available: boolean; items: ConnectionView[] }> {
  const reply = await optionalCall(host, 'connectorsx.connections', {});
  if (!reply.available) return { available: false, items: [] };
  return { available: true, items: rows(reply.value).map(connectionOf).filter((c): c is ConnectionView => c !== null && sourceVisible(host.store, ctx, c.sourceId)) };
}
async function connectionFor(host: ModuleHost, ctx: Context, sourceId: string): Promise<ConnectionView> {
  const list = await connections(host, ctx);
  check(list.available, NOT_INSTALLED, 'Connecting systems is not installed in this build. Bring a file instead.');
  const found = list.items.find(c => c.sourceId === sourceId);
  check(found, 'CONNECTION_REQUIRED', 'This source was brought as a file. It has no connection to read, pause or sign in to.');
  return found;
}

/* ------------------------------------------------------------------ envelopes */

export type EnvelopeView = {
  id: string; sourceId: string; at: string; operation: string; recipeId: string; recipeVersion: string;
  status: 'accepted' | 'refused' | 'abstained' | 'failed';
  refusal: { code: string; reason: string } | null;
  abstention: { reason: string; field: string; question: string; options: string[] } | null;
  period: { from: string; to: string } | null; rows: number; excludedRows: number;
  total: { measure: 'money' | 'count'; unit: string; ours: string | null; theirs: string | null; match: 'yes' | 'no' | 'unavailable' };
  checks: { id: string; status: 'passed' | 'failed' | 'unavailable' }[];
  unmappedFields: string[]; notices: string[]; waiting: boolean;
  committed: { at: string; rows: number; duplicate: boolean } | null;
};
export function envelopeOf(raw: unknown): EnvelopeView | null {
  if (!plain(raw)) return null;
  const id = str(raw.id, 200), sourceId = str(raw.sourceId, 200), at = str(raw.fetchedAt, 40), status = one(raw.status, ['accepted', 'refused', 'abstained', 'failed'] as const);
  if (!id || !sourceId || !at || !status) return null;
  const observed = plain(raw.observed) ? raw.observed : {}, totals = plain(raw.sourceTotals) ? raw.sourceTotals : null;
  const checks = rows(raw.checks, 50).map(c => ({ id: str(c.id, 80) ?? 'check', status: one(c.status, ['passed', 'failed', 'unavailable'] as const) ?? 'unavailable' }));
  const totalCheck = checks.find(c => c.id === 'source-total' || c.id === 'closing-balance');
  const unit = str(observed.unit, 40) ?? '';
  const refusal = plain(raw.refusal) && str(raw.refusal.code, 64) ? { code: raw.refusal.code as string, reason: str(raw.refusal.reason, 400) ?? '' } : null;
  const abstention = plain(raw.abstention) && str(raw.abstention.reason, 64)
    ? { reason: raw.abstention.reason as string, field: str(raw.abstention.field, 200) ?? '', question: str(raw.abstention.question, 600) ?? '', options: strings(raw.abstention.options, 20) } : null;
  const committed = plain(raw.committed) && str(raw.committed.at, 40) ? { at: raw.committed.at as string, rows: int(raw.committed.rows), duplicate: raw.committed.duplicate === true } : null;
  return { id, sourceId, at, operation: str(raw.operation, 120) ?? '', recipeId: str(raw.recipeId, 200) ?? '', recipeVersion: str(raw.recipeVersion, 40) ?? '', status, refusal, abstention,
    period: period(raw.period) ?? period(raw.requestedPeriod), rows: int(observed.rowCount), excludedRows: int(raw.excludedRows),
    total: { measure: /^[A-Z]{3}$/.test(unit) ? 'money' : 'count', unit, ours: digits(observed.total), theirs: totals ? digits(totals.total) : null,
      match: totalCheck?.status === 'passed' ? 'yes' : totalCheck?.status === 'failed' ? 'no' : 'unavailable' },
    checks, unmappedFields: strings(raw.unmappedFields), notices: strings(raw.notices, 20).map(n => n.slice(0, 400)),
    waiting: status === 'accepted' && int(raw.pendingRows) > 0 && committed === null, committed };
}
/** Read history, newest first, for the sources the caller may see. */
export async function envelopes(host: ModuleHost, ctx: Context, sourceId?: string): Promise<{ available: boolean; items: EnvelopeView[] }> {
  const reply = await optionalCall(host, 'connectorsx.envelopes', sourceId ? { sourceId, limit: 50 } : { limit: 400 });
  if (!reply.available) return { available: false, items: [] };
  return { available: true, items: rows(reply.value, 400).map(envelopeOf).filter((e): e is EnvelopeView => e !== null && sourceVisible(host.store, ctx, e.sourceId)) };
}

/** A read the caller may see, checked before anything is imported or set aside. */
async function visibleEnvelope(host: ModuleHost, ctx: Context, envelopeId: string): Promise<EnvelopeView> {
  const list = await envelopes(host, ctx);
  check(list.available, NOT_INSTALLED, 'Connecting systems is not installed in this build. Bring a file instead.');
  const found = list.items.find(e => e.id === envelopeId);
  check(found, 'ENVELOPE_NOT_FOUND', 'This read is no longer waiting.'); return found;
}

/* ------------------------------------------------------------------ freshness */

export type FreshnessView = { sourceId: string; months: Map<string, 'loaded' | 'not-loaded-yet' | 'refused' | 'failed'>; lastRead: string | null; lastFailure: { at: string; status: string; code: string | null } | null; unmappedFields: string[]; stale: boolean };
export async function freshness(host: ModuleHost, ctx: Context, asOf: string): Promise<{ available: boolean; items: FreshnessView[] }> {
  const reply = await optionalCall(host, 'connectorsx.freshness', { asOf });
  if (!reply.available) return { available: false, items: [] };
  return { available: true, items: rows(reply.value).flatMap(item => {
    const sourceId = str(item.sourceId, 200); if (!sourceId || !sourceVisible(host.store, ctx, sourceId)) return [];
    const months = new Map<string, 'loaded' | 'not-loaded-yet' | 'refused' | 'failed'>();
    for (const m of rows(item.months, 12)) { const month = str(m.month, 7), state = one(m.status, ['loaded', 'not-loaded-yet', 'refused', 'failed'] as const); if (month && state) months.set(month, state); }
    const failure = plain(item.lastFailure) && str(item.lastFailure.at, 40) ? { at: item.lastFailure.at as string, status: str(item.lastFailure.status, 40) ?? 'failed', code: str(item.lastFailure.code, 64) } : null;
    return [{ sourceId, months, lastRead: str(item.lastRead, 40), lastFailure: failure, unmappedFields: strings(item.unmappedFields), stale: item.stale === true }];
  }) };
}

/* ------------------------------------------------------------------ systems (BK-03) */

export type OperationStatus = 'tested' | 'experimental' | 'planned' | 'not-possible';
export type SystemRow = {
  id: string; name: string; family: string; depth: 'full' | 'read' | 'import' | null; available: boolean;
  status: OperationStatus; tier: 'supported' | 'experimental' | 'planned'; liveVerified: boolean;
  evidence: { synthetic: number; madeToOrder: number; realWithConsent: number };
  ways: ('interface' | 'file' | 'database')[];
  signIn: { method: 'browser' | 'key' | 'none'; note: string | null };
  settings: string[];
  operations: { id: string; label: string; depth: 'full' | 'read' | 'import'; road: string; status: OperationStatus; tier: 'supported' | 'experimental' | 'planned'; limitation: string; evidence: { synthetic: number; madeToOrder: number; realWithConsent: number } }[];
};
/**
 * The non-secret settings each system's interface read takes (mirrors the connectors-ext read
 * bindings; `connectorsx.connect` refuses any other key, so a stale entry here refuses, never leaks).
 */
const SETTINGS: Readonly<Record<string, readonly string[]>> = {
  tally: ['company', 'ledgers'], 'zoho-books': ['dataCenter', 'organizationId'], xero: ['tenantId'], quickbooks: ['realmId', 'environment'],
  shopify: ['shop'], woocommerce: ['site'], cashfree: ['environment'], payu: ['environment'], 'zoho-crm': ['dataCenter', 'orgCurrency'], hubspot: ['orgCurrency'],
};
const STATUS_RANK: Record<OperationStatus, number> = { tested: 3, experimental: 2, planned: 1, 'not-possible': 0 };
const evidenceOf = (value: unknown) => plain(value) ? { synthetic: int(value.synthetic), madeToOrder: int(value.madeToOrder), realWithConsent: int(value.realWithConsent) } : { synthetic: 0, madeToOrder: 0, realWithConsent: 0 };
export function systemOf(raw: unknown, signIn: unknown): SystemRow | null {
  if (!plain(raw)) return null;
  const id = str(raw.id, 80), name = str(raw.name, 200); if (!id || !name) return null;
  const operations = rows(raw.operations, 200).flatMap(op => {
    const opId = str(op.id, 120), depth = one(op.depth, ['full', 'read', 'import'] as const), status = one(op.status, ['tested', 'experimental', 'planned', 'not-possible'] as const);
    if (!opId || !depth || !status) return [];
    return [{ id: opId, label: str(op.label, 300) ?? opId, depth, road: str(op.road, 40) ?? 'file', status, tier: one(op.tier, ['supported', 'experimental', 'planned'] as const) ?? 'planned', limitation: str(op.limitation, 600) ?? '', evidence: evidenceOf(op.evidence) }];
  });
  const usable = operations.filter(op => op.status === 'tested' || op.status === 'experimental');
  const status = operations.reduce<OperationStatus>((best, op) => STATUS_RANK[op.status] > STATUS_RANK[best] ? op.status : best, 'not-possible');
  const evidence = operations.reduce((sum, op) => ({ synthetic: Math.max(sum.synthetic, op.evidence.synthetic), madeToOrder: Math.max(sum.madeToOrder, op.evidence.madeToOrder), realWithConsent: Math.max(sum.realWithConsent, op.evidence.realWithConsent) }), { synthetic: 0, madeToOrder: 0, realWithConsent: 0 });
  const depth = one(raw.depth, ['full', 'read', 'import'] as const);
  const ways = [...new Set(usable.filter(op => op.depth !== 'full').map(op => op.road === 'interface' ? 'interface' as const : op.road === 'database' ? 'database' as const : 'file' as const))];
  const sign = plain(signIn) ? signIn : {};
  return { id, name, family: str(raw.family, 80) ?? '', depth, available: depth !== null && usable.length > 0,
    status, tier: usable.some(op => op.tier === 'supported') ? 'supported' : usable.length ? 'experimental' : 'planned', liveVerified: raw.liveVerified === true, evidence, ways,
    signIn: { method: one(sign.method, ['browser', 'key', 'none'] as const) ?? 'none', note: str(sign.note, 600) },
    settings: ways.includes('interface') ? [...(SETTINGS[id] ?? [])] : [], operations };
}

/* ------------------------------------------------------------------ methods */

const REQUEST = 'INVALID_BOOKS_REQUEST';
export const connectorMethods: Record<string, MethodSpec> = {
  'books.systems': { permission: 'read', async handler(_ctx, payload, host) {
    const request = input(payload, ['group']); check(request.group === undefined || (typeof request.group === 'string' && /^[a-z0-9-]{1,80}$/.test(request.group)), REQUEST, 'Name one system.');
    const reply = await optionalCall(host, 'connectorsx.systems', request.group === undefined ? {} : { group: request.group });
    if (!reply.available || !plain(reply.value)) return { available: false, systems: [] };
    const signIn = plain(reply.value.signIn) ? reply.value.signIn : {};
    return { available: true, systems: rows(reply.value.groups, 200).map(g => systemOf(g, typeof g.id === 'string' && Object.hasOwn(signIn, g.id) ? signIn[g.id] : null)).filter((s): s is SystemRow => s !== null) };
  } },
  'books.connect': { permission: 'admin', async handler(_ctx, payload, host) {
    const request = input(payload, ['group', 'road', 'company', 'branch', 'label', 'settings'], ['group', 'road', 'company']);
    check(typeof request.group === 'string' && /^[a-z0-9-]{1,80}$/.test(request.group) && ['interface', 'file', 'database'].includes(request.road) && text(request.company)
      && (request.branch === undefined || text(request.branch, 100)) && (request.label === undefined || text(request.label, 120)), REQUEST, 'Choose the system, the way in and the company.');
    const settings = request.settings ?? {};
    check(plain(settings) && Object.keys(settings).length <= 20 && Object.values(settings).every(v => text(v, 300)), REQUEST, 'Settings are short text values.');
    // Credentials never travel with a connection; the connector lane refuses them too.
    check(!Object.keys(settings).some(key => /secret|password|token|key$|ref$/i.test(key)), 'CREDENTIAL_NOT_ACCEPTED', 'Credentials are never stored with a connection. Enter them in Trust, credentials.');
    const body: Raw = { group: request.group, road: request.road, company: request.company.trim(), ...(request.branch ? { branch: request.branch } : {}), ...(request.label ? { label: request.label } : {}), ...(Object.keys(settings).length ? { settings } : {}) };
    const made = connectionOf(await required(host, 'connectorsx.connect', body));
    check(made, 'CONNECTOR_REPLY_INVALID', 'The connector lane answered in an unexpected shape.');
    return made;
  } },
  'books.pause': { permission: 'admin', async handler(ctx, payload, host) {
    const request = input(payload, ['sourceId', 'paused'], ['sourceId', 'paused']); check(plainId(request.sourceId) && typeof request.paused === 'boolean', REQUEST, 'Name the source and whether to pause it.');
    const found = await connectionFor(host, ctx, request.sourceId);
    const made = connectionOf(await required(host, 'connectorsx.pause', { connectionId: found.connectionId, paused: request.paused }));
    check(made, 'CONNECTOR_REPLY_INVALID', 'The connector lane answered in an unexpected shape.'); return made;
  } },
  'books.disconnect': { permission: 'admin', async handler(ctx, payload, host) {
    const request = input(payload, ['sourceId'], ['sourceId']); check(plainId(request.sourceId), REQUEST, 'Name the source.');
    const found = await connectionFor(host, ctx, request.sourceId);
    const reply = await required(host, 'connectorsx.disconnect', { connectionId: found.connectionId });
    const factsKept = host.store.read().facts.some(f => f.sourceId === found.sourceId && !f.deletedAt);
    return { sourceId: found.sourceId, removed: plain(reply) && reply.removed === true, factsKept };
  } },
  'books.signIn': { permission: 'admin', async handler(ctx, payload, host) {
    const request = input(payload, ['sourceId', 'operation'], ['sourceId']); check(plainId(request.sourceId) && (request.operation === undefined || text(request.operation, 80)), REQUEST, 'Name the source.');
    const found = await connectionFor(host, ctx, request.sourceId);
    const reply = await required(host, 'connectorsx.signIn', { connectionId: found.connectionId, ...(request.operation ? { operation: request.operation } : {}) });
    check(plain(reply), 'CONNECTOR_REPLY_INVALID', 'The connector lane answered in an unexpected shape.');
    if (reply.method === 'browser') {
      const url = str(reply.authorizeUrl, 4000); check(url && /^https:\/\//.test(url), 'CONNECTOR_REPLY_INVALID', 'The connector lane answered in an unexpected shape.');
      // The address is shown as text: the screen never opens a browser on its own.
      return { sourceId: found.sourceId, method: 'browser' as const, url, expiresInSeconds: int(reply.expiresInSeconds), note: str(reply.note, 600) };
    }
    return { sourceId: found.sourceId, method: reply.method === 'key' ? 'key' as const : 'none' as const, instruction: str(reply.instruction, 600) ?? '' };
  } },
  'books.readNow': { permission: 'prepare', async handler(ctx, payload, host) {
    const request = input(payload, ['sourceId', 'operation', 'period', 'reportTotals', 'parameters'], ['sourceId', 'operation']);
    check(plainId(request.sourceId) && text(request.operation, 80), REQUEST, 'Name the source and what to read.');
    check(request.period === undefined || period(request.period) !== null, REQUEST, 'A period has a from and a to date.');
    check(request.reportTotals === undefined || (plain(request.reportTotals) && typeof request.reportTotals.total === 'string' && /^-?\d{1,30}$/.test(request.reportTotals.total)), REQUEST, 'Enter the report total as whole paise.');
    check(request.parameters === undefined || (plain(request.parameters) && Object.values(request.parameters).every(v => text(v, 200))), REQUEST, 'Read choices are short text values.');
    const found = await connectionFor(host, ctx, request.sourceId);
    const body: Raw = { connectionId: found.connectionId, operation: request.operation };
    for (const key of ['period', 'reportTotals', 'parameters'] as const) if (request[key] !== undefined) body[key] = request[key];
    const view = envelopeOf(await required(host, 'connectorsx.read', body));
    check(view, 'CONNECTOR_REPLY_INVALID', 'The connector lane answered in an unexpected shape.'); return view;
  } },
  'books.importRead': { permission: 'prepare', async handler(ctx, payload, host) {
    const request = input(payload, ['envelopeId'], ['envelopeId']); check(plainId(request.envelopeId), REQUEST, 'Choose a read to import.');
    await visibleEnvelope(host, ctx, request.envelopeId);
    const view = envelopeOf(await required(host, 'connectorsx.importCommit', { envelopeId: request.envelopeId }));
    check(view && sourceVisible(host.store, ctx, view.sourceId), 'CONNECTOR_REPLY_INVALID', 'The connector lane answered in an unexpected shape.'); return view;
  } },
  'books.discardRead': { permission: 'prepare', async handler(ctx, payload, host) {
    const request = input(payload, ['envelopeId'], ['envelopeId']); check(plainId(request.envelopeId), REQUEST, 'Choose a read to set aside.');
    await visibleEnvelope(host, ctx, request.envelopeId);
    const view = envelopeOf(await required(host, 'connectorsx.discard', { envelopeId: request.envelopeId }));
    check(view && sourceVisible(host.store, ctx, view.sourceId), 'CONNECTOR_REPLY_INVALID', 'The connector lane answered in an unexpected shape.'); return view;
  } },
};
