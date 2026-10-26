// Chausar venture launcher, notify (Ink v2 wave 4, package 4G3; spec 5.7, catalogue O13): the phone relay from the
// desktop. The desktop has no web address a phone could subscribe to, so the owner may set one https address of their
// own (an ntfy topic or similar) inside the app; each alert outside the app then posts {"count":N} to it and nothing
// else, over https, through the network guard with redirects refused, as the owner inside the app. Each post is its
// own action journal entry (notify.relay) under the owner's standing setting, holding the count, the relay's host and
// the outcome, never the address: a topic in its path can work like a password, so the screen and the entry's digest
// use the host alone too. A post that may not have arrived settles as not sent, saying the next alert carries the
// current count, and is tried once more at most, as a new entry, as is a server error; a refusal is not. The hosted
// app has web push, so a relay there says so.
import { createHash, randomBytes } from 'node:crypto';
import { ChausarError, check, type Context } from '../../contracts.ts';
import { currentVenture, exactPayload, readVenture, requireAppChannel, ventureAction } from '../records.ts';
import { checkUrl, guardedFetch } from '../core/net-guard.ts';
import { ALERT_MAY_NOT_HAVE_ARRIVED, journalled, type ApplyResult } from '../journal/journal.ts';
import type { NotifySettingsRecord, RelayView, VentureDeps } from '../contracts.ts';
import { currentNotifySettings } from './settings.ts';
import { pushPayload } from './webpush.ts';

export const RELAY_TIMEOUT_MS = 5_000;
const MAX_RELAY_LENGTH = 500;
const RELAY_WORDS = Object.freeze({
  address: 'Give the relay as one https address of your own, like https://ntfy.sh/your-topic, with no name or password in it.',
  hosted: 'The hosted app sends phone alerts with web push. A relay is for the desktop app.',
  none: 'No relay is set. The tray on this computer shows the count.',
});

/** The owner's relay address, checked: https, no name or password, no fragment, never inside this network. */
export function relayAddress(value: unknown): string {
  check(typeof value === 'string' && value.length > 0 && value.length <= MAX_RELAY_LENGTH, 'INVALID_VENTURE_REQUEST', RELAY_WORDS.address);
  let url: URL;
  try { url = new URL(value as string); } catch { throw new ChausarError('INVALID_VENTURE_REQUEST', RELAY_WORDS.address); }
  check(url.protocol === 'https:' && !url.username && !url.password && !url.hash && !(value as string).includes('#'), 'INVALID_VENTURE_REQUEST', RELAY_WORDS.address);
  // The network guard (W1 H16): never an address inside this computer or its network, in any spelling.
  return checkUrl(url.href).href;
}

/** What the screen shows: the host alone, and what goes there. */
export function relayView(url: string | null): RelayView {
  if (!url) return { relay: null, line: RELAY_WORDS.none };
  const host = new URL(url).host;
  return { relay: host, line: `Each alert sends ${host} a count only, never names or figures.` };
}

/**
 * venture.notify.relay { url } (approve, app only): sets the owner's relay address, or clears it with null. An empty
 * request reads it and writes nothing. Not on the hosted app.
 */
export async function relayHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RelayView> {
  requireAppChannel(ctx, 'venture.notify.relay');
  const body = exactPayload(payload, ['url']);
  check(deps.host !== 'hosted-web', 'TIER_UNAVAILABLE', RELAY_WORDS.hosted);
  if (!Object.hasOwn(body, 'url')) {
    const { state, venture } = readVenture(deps, ctx);
    return relayView(currentNotifySettings(state, venture.id).relay);
  }
  const url = body.url === null ? null : relayAddress(body.url);
  return ventureAction(deps, ctx, 'approve', 'notify.relay', tx => {
    const current = currentNotifySettings(tx.state, tx.venture!.id);
    if (current.relay !== url) tx.put<NotifySettingsRecord>({ ...tx.base('venture-notify-settings'), ...current, relay: url });
    return relayView(url);
  });
}

/** Whether a failed post is worth one more try: it may not have arrived, or the server had trouble. */
function worthRetry(post: Post): boolean {
  if (post.halted) return false;
  if (post.status !== null) return post.status >= 500 || post.status === 429;
  return post.wentOut && post.code !== 'NET_REDIRECT_REFUSED';
}
/** Failures before anything left this computer: nothing could have arrived. */
const BEFORE_SENDING: ReadonlySet<string> = new Set(['NET_URL_REFUSED', 'NET_ADDRESS_REFUSED', 'NET_LOOKUP_FAILED']);
const STANDING_LINE = 'A relay is set in Notifications: the count alone goes to it.';
const TIMED_OUT = Symbol('timed-out');
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
/** How one post ended. wentOut: the post may have reached the relay. halted: the journal refused it. */
type Post = { took: boolean; status: number | null; code: string; wentOut: boolean; halted: boolean };

/**
 * One post to the relay, as its own journal entry under the owner's standing setting: the count, the relay's host and
 * the outcome. Its digest is made from the host, not the address, so an exported journal cannot confirm a topic.
 */
async function postOnce(deps: VentureDeps, owner: Context, url: string, count: number, alert: string, attempt: number): Promise<Post> {
  const host = new URL(url).host;
  const body = pushPayload(count);
  const post: Post = { took: false, status: null, code: '', wentOut: false, halted: true };
  try {
    await journalled<null>(deps, owner, {
      action: 'notify.relay', subject: `notify-relay:${alert}:${attempt}`, target: host, actionDigest: sha256([host, alert, String(attempt), body].join(String.fromCharCode(10))),
      line: `Send the alert count (${count}) to your relay at ${host}. Only the number goes out.`, descriptionComplete: true,
    }, async (): Promise<ApplyResult<null>> => {
      post.halted = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const sending = guardedFetch({
          url, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }, body,
          maxRedirects: 0, timeoutMs: RELAY_TIMEOUT_MS, maxBytes: 64 * 1024,
        }, deps.net ?? {});
        const answer = await Promise.race([sending, new Promise<typeof TIMED_OUT>(resolve => { timer = setTimeout(() => resolve(TIMED_OUT), RELAY_TIMEOUT_MS); })]);
        post.wentOut = true;
        if (answer === TIMED_OUT) {
          sending.catch(() => {});
          return { outcome: 'not-sent', line: `${host} did not answer in time. ${ALERT_MAY_NOT_HAVE_ARRIVED}`, value: null, by: 'engine' };
        }
        post.status = answer.status;
        if (answer.status >= 200 && answer.status < 300) {
          post.took = true;
          return { outcome: 'applied', line: `${host} took the alert count (${count}).`, value: null, by: 'platform' };
        }
        return { outcome: 'not-sent', line: `${host} answered ${answer.status}: it did not take the alert.`, value: null, by: 'platform' };
      } catch (error) {
        post.code = error instanceof ChausarError ? error.code : '';
        post.wentOut = !BEFORE_SENDING.has(post.code);
        if (!post.wentOut || post.code === 'NET_REDIRECT_REFUSED') return { outcome: 'not-sent', line: (error as ChausarError).message, value: null, by: 'engine' };
        return { outcome: 'not-sent', line: `The alert count to ${host} stopped part way. ${ALERT_MAY_NOT_HAVE_ARRIVED}`, value: null, by: 'engine' };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }, { standing: { line: STANDING_LINE } });
  } catch {
    // The journal refused it (a broken chain, a business that closed, a context that may not act).
    post.halted = true;
  }
  return post;
}

/** What a relay delivery did. reached: a post may have reached the relay, so the alert counts as given. */
export type RelayDelivery = { took: boolean; reached: boolean };

/**
 * One alert outside the app to the owner's relay: the body is {"count":N} and nothing else, sent as the owner inside
 * the app (VentureDeps.ownerContext) whoever's request started the look. Never on the hosted app. Never throws.
 */
export async function deliverRelay(deps: VentureDeps, ctx: Context, count: number): Promise<RelayDelivery> {
  const none: RelayDelivery = { took: false, reached: false };
  try {
    if (deps.host === 'hosted-web') return none;
    const state = deps.store.read();
    const venture = currentVenture(state);
    const url = venture ? currentNotifySettings(state, venture.id).relay : null;
    if (!url) return none;
    const owner = deps.ownerContext?.() ?? ctx;
    const alert = randomBytes(6).toString('hex');
    let reached = false;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const post = await postOnce(deps, owner, url, count, alert, attempt);
      reached ||= post.wentOut;
      if (post.took) return { took: true, reached: true };
      if (!worthRetry(post)) break;
    }
    return { took: false, reached };
  } catch {
    return none;
  }
}
