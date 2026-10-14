/**
 * Adapters over methods that other lanes own. Each one names the method it expects, treats
 * a missing method as "not built yet" and never guesses a value in its place.
 *
 *  - models-ext:  `modelsx.price`   { routeId } → { routeId, unitMinor, basis, pricedAt }
 *  - writeback:   `writeback.prepare` { system, action, payload, idempotencyKey, sourceIds } → { id | actionId }
 *  - work-books:  `records.optIn`   { customerId } → { channels: [{ channel, agreed, source, at, stoppedAt? }] }
 *  - connectors-ext: `connectorsx.gstMatch` { sourceIds } → a match summary
 */
import { check, ChausarError } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { paise } from './state.ts';

export const NOT_BUILT = new Set(['UNKNOWN_METHOD', 'INVALID_REQUEST', 'METHOD_UNAVAILABLE']);

export type Optional<T> = { available: true; value: T } | { available: false; code: string };

export async function optionalCall<T = unknown>(host: Pick<ModuleHost, 'call'>, method: string, payload: Record<string, unknown>, options?: { tainted?: boolean }): Promise<Optional<T>> {
  try { return { available: true, value: await (options ? host.call(method, payload, options) : host.call(method, payload)) as T }; }
  catch (error) {
    const code = (error as { code?: string }).code ?? 'REQUEST_FAILED';
    if (NOT_BUILT.has(code)) return { available: false, code };
    throw error;
  }
}

/** How a route's cost is known. A CLI route is an estimate; a local model is priced at zero. */
export type RoutePrice = { routeId: string; unitMinor: string; basis: 'measured' | 'estimate' | 'zero'; pricedAt: string; source: 'modelsx' | 'host' | 'local' };
type HostPrices = Record<string, { unitMinor: string; basis?: 'measured' | 'estimate' | 'zero'; pricedAt?: string }>;

const LOCAL_KINDS = new Set(['ollama']);
const CLI_KINDS = new Set(['codex-cli', 'claude-cli']);

function validPrice(value: any, routeId: string): RoutePrice | null {
  if (!value || typeof value !== 'object') return null;
  try { paise(value.unitMinor); } catch { return null; }
  if (!['measured', 'estimate', 'zero'].includes(value.basis) || typeof value.pricedAt !== 'string' || !Number.isFinite(Date.parse(value.pricedAt))) return null;
  return { routeId, unitMinor: value.unitMinor, basis: value.basis, pricedAt: value.pricedAt, source: 'modelsx' };
}

/**
 * The price per model unit for one route, in whole paise. Resolution order: the models-ext
 * pricing table, then trusted host prices (tests and Practice), then the local-model rule.
 * An unpriced remote route is refused rather than counted as free.
 */
export async function routePrice(host: Pick<ModuleHost, 'call' | 'options' | 'store'>, routeId: string): Promise<RoutePrice> {
  check(typeof routeId === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(routeId), 'INVALID_ROUTE', 'Name one model route.');
  const fromModels = await optionalCall(host, 'modelsx.price', { routeId });
  if (fromModels.available) {
    const price = validPrice(fromModels.value, routeId);
    check(price, 'ROUTE_PRICE_INVALID', 'The route pricing table returned an unusable price.');
    return price;
  }
  const hostPrices = (host.options.routePrices ?? {}) as HostPrices;
  if (Object.hasOwn(hostPrices, routeId)) {
    const entry = hostPrices[routeId]; paise(entry.unitMinor);
    return { routeId, unitMinor: entry.unitMinor, basis: entry.basis ?? 'measured', pricedAt: entry.pricedAt ?? '1970-01-01T00:00:00.000Z', source: 'host' };
  }
  const route = host.store.read().routes.find((item: any) => item.id === routeId);
  if (route && LOCAL_KINDS.has(route.kind)) return { routeId, unitMinor: '0', basis: 'zero', pricedAt: '1970-01-01T00:00:00.000Z', source: 'local' };
  throw new ChausarError(route && CLI_KINDS.has(route.kind) ? 'ROUTE_ESTIMATE_UNAVAILABLE' : 'ROUTE_PRICE_UNAVAILABLE',
    'This model route has no dated price, so its cost cannot be counted against a rupee budget.');
}

export function costOf(price: RoutePrice, units: number): bigint {
  check(Number.isSafeInteger(units) && units >= 0, 'INVALID_JOB_LIMITS', 'Model use is counted in whole units.');
  return BigInt(price.unitMinor) * BigInt(units);
}

export type ConsentAnswer = { channel: 'mail' | 'whatsapp'; agreed: 'yes' | 'no' | 'not-asked'; source: string; at?: string; stoppedAt?: string; via: 'records' | 'local' };

/** Customer agreement per channel. Prefers work-books' `records.optIn`; falls back to the local register. */
export async function consentFor(host: Pick<ModuleHost, 'call'>, local: { customerId: string; channel: 'mail' | 'whatsapp'; agreed: boolean; source: string; at: string; stoppedAt?: string }[], customerId: string, channel: 'mail' | 'whatsapp'): Promise<ConsentAnswer> {
  const remote = await optionalCall<any>(host, 'records.optIn', { customerId });
  if (remote.available && remote.value && Array.isArray(remote.value.channels)) {
    const row = remote.value.channels.find((item: any) => item && item.channel === channel);
    if (row && ['yes', 'no', 'not-asked'].includes(row.agreed)) return { channel, agreed: row.agreed, source: typeof row.source === 'string' ? row.source.slice(0, 200) : 'records', at: typeof row.at === 'string' ? row.at : undefined, stoppedAt: typeof row.stoppedAt === 'string' ? row.stoppedAt : undefined, via: 'records' };
    return { channel, agreed: 'not-asked', source: 'records', via: 'records' };
  }
  const wb = await optionalCall<any>(host, 'writeback.followUp.consents', {});
  if (wb.available && Array.isArray(wb.value)) {
    const latest = [...wb.value].reverse().find((c: any) => c && c.customerId === customerId && c.channel === (channel === 'mail' ? 'email' : 'whatsapp'));
    if (latest && ['yes', 'no', 'not-asked', 'stopped'].includes(latest.answer))
      return { channel, agreed: latest.answer === 'stopped' ? 'no' : latest.answer, source: 'writeback', at: typeof latest.observedOn === 'string' ? latest.observedOn : undefined, ...(latest.answer === 'stopped' ? { stoppedAt: String(latest.observedOn ?? 'stopped') } : {}), via: 'records' };
  }
  const row = [...local].reverse().find(item => item.customerId === customerId && item.channel === channel);
  if (!row) return { channel, agreed: 'not-asked', source: 'none', via: 'local' };
  return { channel, agreed: row.agreed ? 'yes' : 'no', source: row.source, at: row.at, stoppedAt: row.stoppedAt, via: 'local' };
}

export type ReminderOutcome = { prepared: true; actionId: string; via: 'writeback' | 'local-draft' } | { prepared: false; reason: string };

/** Writeback's own refusals are rules, not failures: the case is blocked with the reason. */
const WRITEBACK_REFUSALS: Record<string, string> = { FOLLOW_UP_NO_CONSENT: 'no-agreement', FOLLOW_UP_STOPPED: 'stopped-by-customer', FOLLOW_UP_DAILY_CAP: 'daily-cap',
  FOLLOW_UP_NEEDS_REVIEW: 'needs-review', FOLLOW_UP_NOTHING_DUE: 'nothing-due', FOLLOW_UP_RECIPIENT_CHANGED: 'needs-review' };

/**
 * Prepares a payment reminder. With a live or sandbox mail (or WhatsApp) connection granted to send,
 * it goes through `writeback.followUp.prepare`: writeback checks consent, caps and the invoice evidence,
 * fills its fixed template, and the reminder waits for a person's yes. Without one, a local draft is
 * prepared instead: it stays inside the workspace and sends nothing.
 * An agent-touched reminder carries its outside-text mark on the call's own context.
 */
export async function prepareReminder(host: Pick<ModuleHost, 'call' | 'services'>, context: import('../contracts.ts').Context, request: { invoiceId: string; customerId: string; text: string; channel: 'mail' | 'whatsapp'; idempotencyKey: string; sourceIds: string[] }): Promise<ReminderOutcome> {
  const system = request.channel === 'mail' ? 'mail' : 'whatsapp'; const send = system === 'mail' ? 'smtp.send' : 'template.send';
  const listed = await optionalCall<any>(host, 'writeback.connections', {});
  const connection = listed.available && Array.isArray(listed.value) ? listed.value.find((c: any) => c && c.system === system && !c.revokedAt && ['live', 'sandbox'].includes(c.environment) && Array.isArray(c.write) && c.write.includes(send) && typeof c.id === 'string') : undefined;
  if (connection) {
    let value: any;
    try {
      value = await optionalCall<any>(host, 'writeback.followUp.prepare', { connectionId: connection.id, customerId: request.customerId, invoiceId: request.invoiceId, sourceIds: request.sourceIds },
        context.sourceTainted ? { tainted: true } : undefined);
    } catch (error) {
      const reason = WRITEBACK_REFUSALS[(error as { code?: string }).code ?? ''];
      if (reason) return { prepared: false, reason };
      throw error;
    }
    if (value.available) {
      if (value.value?.status === 'already-done') return { prepared: false, reason: 'already-done' };
      const id = value.value?.id ?? value.value?.actionId;
      check(typeof id === 'string' && id.length > 0, 'WRITEBACK_REPLY_INVALID', 'The writeback lane returned no prepared action.');
      return { prepared: true, actionId: id, via: 'writeback' };
    }
  }
  const prepared = await host.services.actions.prepare(context, { connector: 'local', operation: 'reminder-draft', payload: { invoiceId: request.invoiceId, text: request.text }, idempotencyKey: request.idempotencyKey, sourceIds: request.sourceIds });
  return { prepared: true, actionId: prepared.id, via: 'local-draft' };
}
