/**
 * TR-09/TL-09: the log of fixed messages this desktop asked the relay to send, and the ones whose result was lost.
 * A send that got no reply stays `unknown`; a check asks the relay, without sending anything, whether it received
 * that idempotency key, and records what it says: the relay's own status, or `not-sent` when it never received it.
 * A check never resends. After `not-sent` the person may send again, which makes a new entry with a new key and
 * freshly sealed buttons; the old entry's approval offer is voided, so its sealed blobs can never be used.
 */
import { audit, check, ChausarError } from '../contracts.ts';
import type { Context } from '../contracts.ts';
import { moduleState, peekModuleState } from '../modules/types.ts';
import type { ModuleHost } from '../modules/types.ts';
import { configuration, connected, desktopOnly, initialHostedLinkState, input, MODULE_ID } from './service.ts';
import type { HostedLinkState, LogEntry } from './service.ts';

/** An `unknown` entry older than this is re-checked by the tick; at most this many per tick. */
export const RECHECK_AFTER_MS = 5 * 60 * 1000;
export const RECHECKS_PER_TICK = 5;
const LOST: ReadonlySet<LogEntry['status']> = new Set(['unknown', 'failed']);

const entries = (host: ModuleHost): LogEntry[] => structuredClone(peekModuleState<HostedLinkState>(host.store.read(), MODULE_ID)?.messages ?? []);
/** What the screen may show: no key, message id, action id or sealed blob. */
const row = (entry: LogEntry) => ({ id: entry.id, event: entry.event, channel: entry.channel, status: entry.status, at: entry.at, buttons: entry.buttons,
  errorCode: entry.errorCode ?? null, checkedAt: entry.checkedAt ?? null });

/** `phone.messages.log`: newest first. `lost` counts entries with no reply (`unknown`) or `failed`. */
export function messagesLog(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  input(payload, [], ['filter']);
  const filter = payload.filter ?? 'all';
  check(filter === 'all' || filter === 'lost', 'INVALID_REQUEST', 'Show all messages or only those whose result was lost.');
  const all = entries(host).reverse();
  return { messages: all.filter(entry => filter === 'all' || LOST.has(entry.status)).map(row), lost: all.filter(entry => LOST.has(entry.status)).length };
}

async function recheck(host: ModuleHost, id: string): Promise<LogEntry> {
  const { client, pairing, c } = connected(host);
  const entry = entries(host).find(item => item.id === id);
  check(entry, 'MESSAGE_NOT_IN_LOG', 'That message is not in this computer\'s log.');
  const found = await client.messageByKey(pairing.sessionToken, entry.idempotencyKey);
  const checkedAt = c.clock().toISOString();
  return host.store.update(state => {
    const m = moduleState<HostedLinkState>(state, MODULE_ID, initialHostedLinkState);
    check(m.pairing?.accountId === pairing.accountId, 'HOSTED_NOT_PAIRED', 'Pair this computer with Chausar first.');
    const item = m.messages.find(x => x.id === id);
    check(item, 'MESSAGE_NOT_IN_LOG', 'That message is not in this computer\'s log.');
    const offer = item.offerId ? m.offers.find(o => o.offerId === item.offerId) : undefined;
    const before = item.status;
    item.checkedAt = checkedAt;
    if (found) {
      item.status = found.status; item.messageId = found.messageId;
      if (found.status === 'failed') item.errorCode = 'RELAY_SEND_FAILED'; else delete item.errorCode;
      if (offer) offer.messageId = found.messageId;
      // The relay holds the buttons now (or dropped them on failure): the desktop's copy of the blobs is no longer needed.
      delete item.pendingOffer;
      if (found.status === 'failed' && offer && !offer.used) { offer.used = true; offer.outcome = 'not-sent'; }
    } else {
      item.status = 'not-sent'; item.messageId = null; delete item.pendingOffer;
      // Never received: the offer can never be pressed, and a later send seals new buttons under a new key.
      if (offer && !offer.used) { offer.used = true; offer.outcome = 'not-sent'; }
    }
    if (before !== item.status) audit(state, 'hosted.relay.checked', { event: item.event, channel: item.channel, from: before, to: item.status });
    return structuredClone(item);
  });
}

/** `phone.messages.check`: asks the relay about one entry by its idempotency key. Never resends. */
export async function messagesCheck(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, ['id']);
  check(typeof payload.id === 'string' && payload.id.length > 0 && payload.id.length <= 200, 'INVALID_REQUEST', 'Choose a message from the log.');
  check(entries(host).some(item => item.id === payload.id), 'MESSAGE_NOT_IN_LOG', 'That message is not in this computer\'s log.');
  const entry = await recheck(host, payload.id);
  return { ...row(entry), sendAgain: entry.status === 'not-sent' };
}

/** Re-checks `unknown` entries older than a few minutes, least recently checked first, a few per tick. */
export async function tickMessageLog(_ctx: Context, host: ModuleHost): Promise<unknown[]> {
  if (host.demo) return [];
  let c; try { c = configuration(host); } catch { return []; }
  const s = peekModuleState<HostedLinkState>(host.store.read(), MODULE_ID);
  if (!c.client || !s?.pairing || !s.relayKey) return [];
  const now = c.clock().getTime();
  if (!Number.isFinite(now)) return [];
  const due = s.messages.filter(item => item.status === 'unknown' && now - Date.parse(item.at) >= RECHECK_AFTER_MS
      && (item.checkedAt === undefined || now - Date.parse(item.checkedAt) >= RECHECK_AFTER_MS))
    .sort((a, b) => Date.parse(a.checkedAt ?? a.at) - Date.parse(b.checkedAt ?? b.at)).slice(0, RECHECKS_PER_TICK);
  const checked: string[] = [];
  for (const item of due) {
    try { checked.push((await recheck(host, item.id)).status); }
    catch (error) { if (error instanceof ChausarError) break; throw error; }
  }
  return checked.length ? [{ module: MODULE_ID, messagesChecked: checked.map(status => ({ status })) }] : [];
}
