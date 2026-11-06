// Chausar venture launcher, notify (Ink v2 wave 4, package 4G3; spec 5.7 and 8, catalogue O13): phone alerts by web
// push on the hosted app. venture.notify.push.key gives the browser the server's public key; push.subscribe keeps one
// record per browser (its endpoint on a known push service, its two keys and a hash of the hosted session that asked,
// nothing more) and turns phone alerts on; push.unsubscribe deletes that record, and the last one gone turns them off.
// A subscription ends when its session signs out or is revoked (endPushSessions, from the hosted server). On the
// desktop there is no web address a phone could subscribe to, so these say so (TIER_UNAVAILABLE) and the tray shows
// the count instead.
// deliverPush sends one alert, a count only (webpush.ts), to each browser through the network guard with no redirects,
// as the owner inside the app (VentureDeps.ownerContext) whoever's request started the look. Each try is its own
// action journal entry (notify.push) under the owner's standing setting, holding the count, the push service's host
// and the outcome, never the address, the keys or the topic, and never left as an unknown to resolve: a try that may
// not have arrived says the next alert carries the current count. 404 and 410 mean the browser is gone and its record
// is deleted (unless it was subscribed again meanwhile), as do 401 and 403, unless every browser answered so, which
// points at this server's clock or key: then each is counted as a failure. A redirect or an address the guard refuses
// is final; any other failure is tried once more, as a new entry, and the third failing delivery in a row deletes the
// record. A journal that refuses (a broken chain, 4J10) stops the delivery. Nothing here reads the business's words.
import { createHash, randomBytes } from 'node:crypto';
import { ChausarError, check, type Context } from '../../contracts.ts';
import { currentVenture, exactPayload, readVenture, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import { guardedFetch } from '../core/net-guard.ts';
import { ALERT_MAY_NOT_HAVE_ARRIVED, journalled, type ApplyResult } from '../journal/journal.ts';
import type { NotifySettingsRecord, PushKeyView, PushStateView, PushSubscriptionRecord, VentureDeps, WebPushPort } from '../contracts.ts';
import { currentNotifySettings } from './settings.ts';
import { endedSessions, pushBrowsers } from './browsers.ts';
import { MAX_ENDPOINT_LENGTH, pushRequest, pushServiceOf, subscriptionKeys } from './webpush.ts';

/** The most browsers one business sends phone alerts to. */
export const MAX_PUSH_BROWSERS = 10;
/** Each try of one push waits this long for the push service at most. */
export const PUSH_TIMEOUT_MS = 5_000;
/** The third failing delivery in a row deletes the browser's record. */
export const MAX_PUSH_FAILURES = 3;
/** Answers that mean the browser is gone for good. */
const GONE_STATUSES: ReadonlySet<number> = new Set([404, 410]);
/** Answers that mean this server is not allowed there: gone, unless every browser says it (then the fault is ours). */
const REFUSED_STATUSES: ReadonlySet<number> = new Set([401, 403]);
/** Refusals that another try cannot change: a redirect, and an address the network guard will not open. */
const FINAL_CODES: ReadonlySet<string> = new Set(['NET_REDIRECT_REFUSED', 'NET_URL_REFUSED', 'NET_ADDRESS_REFUSED']);
/** Failures before anything left this computer: nothing could have arrived. */
const BEFORE_SENDING: ReadonlySet<string> = new Set(['NET_URL_REFUSED', 'NET_ADDRESS_REFUSED', 'NET_LOOKUP_FAILED', 'PUSH_ENDPOINT_REFUSED']);
const SESSION_HASH = /^[a-f0-9]{64}$/;
export const PUSH_WORDS = Object.freeze({
  desktop: 'Phone alerts need the hosted app. On this computer the tray shows the count.',
  notSetUp: 'Phone alerts are not set up on this server yet. The bell still lists everything.',
  on: 'Phone alerts are on for this browser. They carry a count only, never names or figures.',
  off: 'Phone alerts are off. The bell still lists everything.',
  tooMany: `Phone alerts go to ${MAX_PUSH_BROWSERS} browsers at most. Remove one first.`,
  session: 'Turn phone alerts on from the Chausar page while you are signed in.',
  standing: 'Phone alerts are on in Notifications: the count alone goes to your own browser.',
});

/** The hosted app's push key, or the honest reason there is none. */
function pushPort(deps: VentureDeps): WebPushPort {
  check(deps.host === 'hosted-web', 'TIER_UNAVAILABLE', PUSH_WORDS.desktop);
  check(deps.push, 'TIER_UNAVAILABLE', PUSH_WORDS.notSetUp);
  return deps.push!;
}

/** Writes the push switch when it changes; every other setting is carried forward (settings.ts). */
function setPush(tx: VentureTx, on: boolean): void {
  const current = currentNotifySettings(tx.state, tx.venture!.id);
  if (current.push === on) return;
  tx.put<NotifySettingsRecord>({ ...tx.base('venture-notify-settings'), ...current, push: on });
}

/** Deletes subscription records outright (a gone browser leaves no endpoint or key behind); none left turns push off. */
function removeBrowsers(tx: VentureTx, ids: ReadonlySet<string>): void {
  if (!ids.size) return;
  const records = tx.state.conversations;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record?.kind === 'venture-push-subscription' && ids.has(record.id)) records.splice(index, 1);
  }
  if (!tx.list('venture-push-subscription').length) setPush(tx, false);
}

/** venture.notify.push.key {} (read): the public key a browser subscribes with, on the hosted app only. */
export async function pushKeyHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PushKeyView> {
  exactPayload(payload, []);
  const port = pushPort(deps);
  readVenture(deps, ctx);
  return { publicKey: port.publicKey };
}

/**
 * venture.notify.push.subscribe { subscription, session } (approve, app only): this browser gets phone alerts until
 * session (a hash of the hosted session asking, which the hosted app adds and a page can never send) signs out or is
 * revoked. The same browser again keeps its one record with the newer keys and session. Turns push on in the settings.
 */
export async function pushSubscribeHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PushStateView> {
  requireAppChannel(ctx, 'venture.notify.push.subscribe');
  const body = exactPayload(payload, ['subscription', 'session'], ['subscription']);
  pushPort(deps);
  check(typeof body.session === 'string' && SESSION_HASH.test(body.session), 'INVALID_VENTURE_REQUEST', PUSH_WORDS.session);
  const sessionHash = body.session as string;
  const input = exactPayload(body.subscription, ['endpoint', 'keys', 'expirationTime'], ['endpoint', 'keys']);
  check(input.expirationTime === undefined || input.expirationTime === null || (Number.isSafeInteger(input.expirationTime) && (input.expirationTime as number) > 0),
    'INVALID_VENTURE_REQUEST', 'The browser sent an expiry Chausar cannot read.');
  const { url, host } = pushServiceOf(input.endpoint);
  const keys = subscriptionKeys(input.keys);
  return ventureAction(deps, ctx, 'approve', 'notify.push.subscribe', tx => {
    const all = tx.list('venture-push-subscription');
    const same = all.find(record => record.endpoint === url.href);
    if (same) tx.replace<PushSubscriptionRecord>({ ...same, keys, host, sessionHash, failures: 0, lastFailure: null });
    else {
      check(all.length < MAX_PUSH_BROWSERS, 'INVALID_VENTURE_REQUEST', PUSH_WORDS.tooMany);
      tx.put<PushSubscriptionRecord>({ ...tx.base('venture-push-subscription'), endpoint: url.href, keys, host, sessionHash, failures: 0, lastFailure: null });
    }
    setPush(tx, true);
    return { subscribed: true, line: PUSH_WORDS.on };
  });
}

/** The endpoint as it was stored (pushServiceOf keeps the parsed spelling). */
function storedSpelling(endpoint: string): string {
  try { return new URL(endpoint).href; } catch { return endpoint; }
}

/**
 * venture.notify.push.unsubscribe { endpoint } (approve, app only): this browser no longer gets phone alerts; its
 * record is deleted. Removing one already gone is fine. The last one gone turns push off. Allowed everywhere.
 */
export async function pushUnsubscribeHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PushStateView> {
  requireAppChannel(ctx, 'venture.notify.push.unsubscribe');
  const body = exactPayload(payload, ['endpoint'], ['endpoint']);
  check(typeof body.endpoint === 'string' && body.endpoint.length > 0 && body.endpoint.length <= MAX_ENDPOINT_LENGTH,
    'INVALID_VENTURE_REQUEST', 'Send the address of the browser to remove.');
  const endpoint = storedSpelling(body.endpoint as string);
  return ventureAction(deps, ctx, 'approve', 'notify.push.unsubscribe', tx => {
    removeBrowsers(tx, new Set(tx.list('venture-push-subscription').filter(record => record.endpoint === endpoint).map(record => record.id)));
    const left = tx.list('venture-push-subscription').length;
    if (!left) setPush(tx, false);
    const line = left ? `This browser will not get phone alerts. ${left === 1 ? '1 other browser still gets them.' : `${left} other browsers still get them.`}` : PUSH_WORDS.off;
    return { subscribed: false, line };
  });
}

/**
 * Trusted host only (the hosted server, through VentureHost.endPushSessions): hosted sessions that signed out or were
 * revoked, as hashes of their ids. Their browsers' records are deleted. Answers how many went.
 */
export async function endPushSessions(deps: VentureDeps, ctx: Context, hashes: readonly string[]): Promise<number> {
  check(Array.isArray(hashes) && hashes.length <= 500 && hashes.every(hash => typeof hash === 'string' && SESSION_HASH.test(hash)),
    'INVALID_VENTURE_REQUEST', 'Send the hashes of the sessions that ended.');
  const ended = new Set(hashes);
  const state = deps.store.read();
  const venture = currentVenture(state);
  if (!venture || !pushBrowsers(state, venture.id).some(record => record.sessionHash !== null && ended.has(record.sessionHash))) return 0;
  return ventureAction(deps, ctx, 'read', 'notify.push.ended', tx => {
    const gone = tx.list('venture-push-subscription').filter(record => record.sessionHash !== null && ended.has(record.sessionHash));
    removeBrowsers(tx, new Set(gone.map(record => record.id)));
    return gone.length;
  });
}

/**
 * How one try ended: sent; gone (the browser no longer exists); refused (401 or 403); final or retry (failed); halted
 * (the journal refused). wentOut: a request may have reached the push service.
 */
type Try = { kind: 'sent' | 'gone' | 'refused' | 'final' | 'retry' | 'halted'; status: number | null; wentOut: boolean };
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const TIMED_OUT = Symbol('timed-out');

/** One try to one browser, as its own journal entry: the count, the push service's host and the outcome. */
async function tryOnce(deps: VentureDeps, owner: Context, port: WebPushPort, browser: PushSubscriptionRecord, count: number, alert: string, attempt: number): Promise<Try> {
  let tried: Try = { kind: 'halted', status: null, wentOut: false };
  try {
    await journalled<null>(deps, owner, {
      action: 'notify.push', subject: `notify-push:${browser.id}:${alert}:${attempt}`, target: browser.host,
      actionDigest: sha256(`${browser.id}\n${alert}\n${attempt}\n${count}`),
      line: `Send a phone alert to a browser at ${browser.host}: the count (${count}) and nothing else.`, descriptionComplete: true,
    }, async (): Promise<ApplyResult<null>> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // A fresh key and salt for each try (webpush.ts), so a retry is a new message.
        const request = pushRequest(port, browser, count, deps.clock().getTime());
        const sending = guardedFetch({ url: request.url, method: 'POST', headers: request.headers, body: request.body, maxRedirects: 0, timeoutMs: PUSH_TIMEOUT_MS, maxBytes: 64 * 1024 }, deps.net ?? {});
        const answer = await Promise.race([sending, new Promise<typeof TIMED_OUT>(resolve => { timer = setTimeout(() => resolve(TIMED_OUT), PUSH_TIMEOUT_MS); })]);
        if (answer === TIMED_OUT) {
          sending.catch(() => {});
          tried = { kind: 'retry', status: null, wentOut: true };
          return { outcome: 'not-sent', line: `${browser.host} did not answer in time. ${ALERT_MAY_NOT_HAVE_ARRIVED}`, value: null, by: 'engine' };
        }
        const status = answer.status;
        if (status >= 200 && status < 300) {
          tried = { kind: 'sent', status, wentOut: true };
          return { outcome: 'applied', line: `${browser.host} took the phone alert (${count}).`, value: null, by: 'platform' };
        }
        tried = { kind: GONE_STATUSES.has(status) ? 'gone' : REFUSED_STATUSES.has(status) ? 'refused' : 'retry', status, wentOut: true };
        const why = GONE_STATUSES.has(status) ? 'the browser is no longer there' : 'it did not take the alert';
        return { outcome: 'not-sent', line: `${browser.host} answered ${status}: ${why}.`, value: null, by: 'platform' };
      } catch (error) {
        const code = error instanceof ChausarError ? error.code : '';
        const before = BEFORE_SENDING.has(code);
        tried = { kind: code === 'PUSH_ENDPOINT_REFUSED' ? 'gone' : FINAL_CODES.has(code) ? 'final' : 'retry', status: null, wentOut: !before };
        if (before || code === 'NET_REDIRECT_REFUSED') return { outcome: 'not-sent', line: (error as ChausarError).message, value: null, by: 'engine' };
        return { outcome: 'not-sent', line: `The phone alert to ${browser.host} stopped part way. ${ALERT_MAY_NOT_HAVE_ARRIVED}`, value: null, by: 'engine' };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }, { standing: { line: PUSH_WORDS.standing } });
    return tried;
  } catch {
    // The journal refused (a broken chain, a business that closed, a context that may not act): nothing went out.
    return { kind: 'halted', status: null, wentOut: tried.wentOut };
  }
}

/** One delivery to one browser: a second try, as a new entry, after a failure another try could change. */
async function deliverTo(deps: VentureDeps, owner: Context, port: WebPushPort, browser: PushSubscriptionRecord, count: number, alert: string): Promise<Try> {
  const first = await tryOnce(deps, owner, port, browser, count, alert, 1);
  if (first.kind !== 'retry') return first;
  const second = await tryOnce(deps, owner, port, browser, count, alert, 2);
  return { ...second, wentOut: first.wentOut || second.wentOut };
}

/** What a delivery did. reached: some request may have reached a push service, so the alert counts as given. */
export type PushDelivery = { sent: number; failed: number; removed: number; reached: boolean };

/** Whether a record is still the browser a push went to: the same endpoint and keys (not subscribed again since). */
const sameBrowser = (record: PushSubscriptionRecord, sent: PushSubscriptionRecord) =>
  record.endpoint === sent.endpoint && record.keys.p256dh === sent.keys.p256dh && record.keys.auth === sent.keys.auth;

/**
 * One alert outside the app, a count only, to every browser of the business (see the header). Only on the hosted app,
 * with push on. Never throws: the journal and the records say what happened, and the bell lists everything.
 */
export async function deliverPush(deps: VentureDeps, ctx: Context, count: number): Promise<PushDelivery> {
  const none: PushDelivery = { sent: 0, failed: 0, removed: 0, reached: false };
  try {
    if (deps.host !== 'hosted-web' || !deps.push) return none;
    const state = deps.store.read();
    const venture = currentVenture(state);
    if (!venture || !currentNotifySettings(state, venture.id).push) return none;
    // A browser whose session the account lists as ended gets nothing, even before its record is deleted.
    const browsers = pushBrowsers(state, venture.id, endedSessions(deps));
    if (!browsers.length) return none;
    const owner = deps.ownerContext?.() ?? ctx;
    const port = deps.push;
    const alert = randomBytes(6).toString('hex');
    const outcomes = await Promise.all(browsers.map(async browser => ({ browser, ...(await deliverTo(deps, owner, port, browser, count, alert)) })));
    // Every browser said 401 or 403: it is this server's clock or key, not the browsers. Each counts as a failure.
    const allRefused = outcomes.every(item => item.kind === 'refused');
    for (const item of outcomes) if (item.kind === 'refused') item.kind = allRefused ? 'final' : 'gone';
    const done: PushDelivery = {
      sent: outcomes.filter(item => item.kind === 'sent').length,
      failed: outcomes.filter(item => item.kind === 'final' || item.kind === 'retry').length, removed: 0,
      reached: outcomes.some(item => item.wentOut),
    };
    const changes = outcomes.filter(item => item.kind !== 'halted' && (item.kind !== 'sent' || item.browser.failures > 0 || (item.browser.lastFailure ?? null) !== null));
    if (!changes.length) return done;
    done.removed = await ventureAction(deps, owner, 'read', 'notify.push.deliver', tx => {
      const gone = new Set<string>();
      for (const item of changes) {
        const record = tx.find('venture-push-subscription', item.browser.id);
        // Subscribed again meanwhile: the record is another browser now, and this outcome is not about it.
        if (!record || !sameBrowser(record, item.browser)) continue;
        if (item.kind === 'gone') gone.add(record.id);
        else if (item.kind === 'sent') tx.replace<PushSubscriptionRecord>({ ...record, failures: 0, lastFailure: null });
        else if (record.failures + 1 >= MAX_PUSH_FAILURES) gone.add(record.id);
        else tx.replace<PushSubscriptionRecord>({ ...record, failures: record.failures + 1, lastFailure: { at: tx.now, status: item.status } });
      }
      removeBrowsers(tx, gone);
      return gone.size;
    });
    return done;
  } catch {
    return none;
  }
}
