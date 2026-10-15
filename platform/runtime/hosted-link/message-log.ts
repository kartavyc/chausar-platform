/**
 * TR-09/TL-09: the log of fixed messages this desktop asked the relay to send, and the ones whose result was lost.
 * A send that got no reply stays `unknown`; a check asks the relay, without sending anything, whether it received
 * that idempotency key, and records what it says: the relay's own status, or `not-sent` when it never received it.
 * A check never resends. After `not-sent` the person may send again, which makes a new entry with a new key and
 * freshly sealed buttons; the old entry's approval offer is voided, so its sealed blobs can never be used.
 *
 * "Not received" is read as `not-sent` only once `RECHECK_AFTER_MS` has passed since the entry's last attempt
 * (`lastAttemptAt`, refreshed by every retry): a post still in flight, or a retry racing the lookup, must not become
 * `not-sent` and invite a duplicate send. Entries carry the hosted account of the pairing that sent them; the relay
 * answers lookups per account, so an entry from another pairing is never looked up (it is marked, and stays as it was).
 */
import { audit, check, ChausarError } from '../contracts.ts';
import type { Context } from '../contracts.ts';
import { moduleState, peekModuleState } from '../modules/types.ts';
import type { ModuleHost } from '../modules/types.ts';
import { configuration, connected, desktopOnly, initialHostedLinkState, input, MODULE_ID } from './service.ts';
import type { HostedLinkState, LogEntry } from './service.ts';

/**
 * How long after its last attempt an `unknown` entry must wait before "not received" can mean `not-sent`, and before
 * the tick re-checks it; at most `RECHECKS_PER_TICK` per tick.
 */
export const RECHECK_AFTER_MS = 5 * 60 * 1000;
export const RECHECKS_PER_TICK = 5;
/** The note (`errorCode`) on an entry sent under another pairing: it is never looked up and keeps its status. */
export const OTHER_PAIRING = 'MESSAGE_OTHER_PAIRING';
const LOST: ReadonlySet<LogEntry['status']> = new Set(['unknown', 'failed']);
const OTHER_PAIRING_TEXT = 'This message was sent while this computer was paired with another account, so its result cannot be checked from here.';

const entries = (host: ModuleHost): LogEntry[] => structuredClone(peekModuleState<HostedLinkState>(host.store.read(), MODULE_ID)?.messages ?? []);
/** What the screen may show: no key, message id, action id or sealed blob. */
const row = (entry: LogEntry) => ({ id: entry.id, event: entry.event, channel: entry.channel, status: entry.status, at: entry.at, buttons: entry.buttons,
  errorCode: entry.errorCode ?? null, checkedAt: entry.checkedAt ?? null });
/** When the desktop last posted this entry. */
const lastAttempt = (entry: LogEntry) => Date.parse(entry.lastAttemptAt ?? entry.at);
/** Entries from before entries carried an account cannot be told apart from another pairing's, so they are never looked up either. */
const ownedBy = (entry: LogEntry, accountId: string) => entry.accountId === accountId;

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
  check(ownedBy(entry, pairing.accountId), OTHER_PAIRING, OTHER_PAIRING_TEXT);
  const found = await client.messageByKey(pairing.sessionToken, entry.idempotencyKey);
  const now = c.clock(), checkedAt = now.toISOString();
  const outcome = await host.store.update(state => {
    const m = moduleState<HostedLinkState>(state, MODULE_ID, initialHostedLinkState);
    check(m.pairing?.accountId === pairing.accountId, 'HOSTED_NOT_PAIRED', 'Pair this computer with Chausar first.');
    const item = m.messages.find(x => x.id === id);
    check(item, 'MESSAGE_NOT_IN_LOG', 'That message is not in this computer\'s log.');
    check(ownedBy(item, pairing.accountId), OTHER_PAIRING, OTHER_PAIRING_TEXT);
    // Read inside the update: a retry that started after the lookup was sent has already moved `lastAttemptAt` on.
    if (!found && item.status === 'unknown' && !(now.getTime() - lastAttempt(item) >= RECHECK_AFTER_MS)) return { tooSoon: true as const };
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
    return { tooSoon: false as const, item: structuredClone(item) };
  });
  check(!outcome.tooSoon, 'MESSAGE_CHECK_TOO_SOON', 'It is too soon to tell whether this message was sent. Check again in a few minutes.');
  return outcome.item;
}

/** Notes, without asking the relay, that these entries were sent under another pairing. Their status is kept. */
function markOtherPairing(host: ModuleHost, accountId: string, ids: ReadonlySet<string>): Promise<number> {
  return host.store.update(state => {
    const m = moduleState<HostedLinkState>(state, MODULE_ID, initialHostedLinkState);
    let marked = 0;
    for (const item of m.messages) if (ids.has(item.id) && !ownedBy(item, accountId) && item.status === 'unknown' && item.errorCode !== OTHER_PAIRING) {
      item.errorCode = OTHER_PAIRING; marked++;
    }
    return marked;
  });
}

/**
 * `phone.messages.check`: asks the relay about one entry by its idempotency key. Never resends. Refuses
 * `MESSAGE_CHECK_TOO_SOON` (the entry stays `unknown`) while the relay has not got an `unknown` entry and its last
 * attempt is younger than `RECHECK_AFTER_MS`, and `MESSAGE_OTHER_PAIRING` for an entry sent under another pairing
 * (which is marked with that note and keeps its status).
 */
export async function messagesCheck(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, ['id']);
  check(typeof payload.id === 'string' && payload.id.length > 0 && payload.id.length <= 200, 'INVALID_REQUEST', 'Choose a message from the log.');
  const entry = entries(host).find(item => item.id === payload.id);
  check(entry, 'MESSAGE_NOT_IN_LOG', 'That message is not in this computer\'s log.');
  const { pairing } = connected(host);
  if (!ownedBy(entry, pairing.accountId)) {
    await markOtherPairing(host, pairing.accountId, new Set([entry.id]));
    throw new ChausarError(OTHER_PAIRING, OTHER_PAIRING_TEXT);
  }
  const checked = await recheck(host, payload.id);
  return { ...row(checked), sendAgain: checked.status === 'not-sent' };
}

/**
 * Re-checks this pairing's `unknown` entries whose last attempt is at least `RECHECK_AFTER_MS` old, least recently
 * checked first, a few per tick. Entries from another pairing are only marked, never looked up.
 */
export async function tickMessageLog(_ctx: Context, host: ModuleHost): Promise<unknown[]> {
  if (host.demo) return [];
  let c; try { c = configuration(host); } catch { return []; }
  const s = peekModuleState<HostedLinkState>(host.store.read(), MODULE_ID);
  if (!c.client || !s?.pairing || !s.relayKey) return [];
  const now = c.clock().getTime();
  if (!Number.isFinite(now)) return [];
  const accountId = s.pairing.accountId;
  const foreign = s.messages.filter(item => item.status === 'unknown' && !ownedBy(item, accountId) && item.errorCode !== OTHER_PAIRING);
  if (foreign.length) await markOtherPairing(host, accountId, new Set(foreign.map(item => item.id)));
  const due = s.messages.filter(item => item.status === 'unknown' && ownedBy(item, accountId) && now - lastAttempt(item) >= RECHECK_AFTER_MS
      && (item.checkedAt === undefined || now - Date.parse(item.checkedAt) >= RECHECK_AFTER_MS))
    .sort((a, b) => Date.parse(a.checkedAt ?? a.at) - Date.parse(b.checkedAt ?? b.at)).slice(0, RECHECKS_PER_TICK);
  const checked: string[] = [];
  for (const item of due) {
    try { checked.push((await recheck(host, item.id)).status); }
    catch (error) {
      // A retry raced this tick: that entry waits for a later one.
      if (error instanceof ChausarError && error.code === 'MESSAGE_CHECK_TOO_SOON') continue;
      if (error instanceof ChausarError) break;
      throw error;
    }
  }
  return checked.length ? [{ module: MODULE_ID, messagesChecked: checked.map(status => ({ status })) }] : [];
}
