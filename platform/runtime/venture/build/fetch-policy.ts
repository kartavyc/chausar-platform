// Chausar connectors: the fetch policy (Ink v2 wave 5, package 5A6). Every web page Chausar reads on its own, for an
// agent or for a page the owner asked it to watch (monitors.ts), goes through politeFetch here, on top of the network
// guard (core/net-guard.ts):
// - sites whose terms bar automated reading are refused before anything is sent, and again at every hop of a redirect
//   (FETCH_POLICY_REFUSED, "This site's terms don't allow automated reading. Paste the text instead."). The list is a
//   dated rule set (FETCH_POLICY_RULES, the kit's DatedRule), each site with its terms page and the day it was checked;
// - Chausar asks only as itself: its own user agent on every request, never another company's browser name, no proxy
//   header and no faked browser fingerprint (FETCH_DISGUISE_REFUSED). There is no proxy option and no CAPTCHA solving;
// - robots.txt is read and obeyed (robotsCheck): Chausar's own group if the site names it, else everyone's.
// The owner's own signed-in posting (build/posting.ts, 2B) drives the owner's own browser for the owner's own post; it
// is a different path and this policy does not touch it.
// The robots.txt matching (longest rule wins, Allow wins a tie, * and $ in a path) follows RFC 9309; written here for
// Chausar, nothing is copied from an outside source.
import { ChausarError, check } from '../../contracts.ts';
import { checkUrl, guardedFetch, pinnedSend, NET_WORDS, type GuardedRequest, type GuardedResponse, type NetResolver, type PinnedSender } from '../core/net-guard.ts';
import type { SiteBreaker } from './site-breaker.ts';

/** The name Chausar asks under, and the token a robots.txt group may name it by. */
export const ROBOTS_TOKEN = 'Chausar';
export const CHAUSAR_USER_AGENT = `${ROBOTS_TOKEN}/1.0 (+https://www.chausar.co.in)`;

export const FETCH_POLICY_WORDS = Object.freeze({
  refused: "This site's terms don't allow automated reading. Paste the text instead.",
  disguise: 'Chausar reads the web only as itself: no other browser\'s name, no proxy and no faked fingerprint.',
  robots: 'This site asks robots not to read that page.',
});

import {fetchPolicySite} from './fetch-policy-core.ts';
export {fetchPolicySite,FETCH_POLICY_RULES} from './fetch-policy-core.ts';

/** The address as the network guard checks it, refused when its site's terms bar automated reading. */
export function checkFetchPolicy(raw: string | URL): URL {
  const url = checkUrl(typeof raw === 'string' ? raw : raw.href);
  if (fetchPolicySite(url)) throw new ChausarError('FETCH_POLICY_REFUSED', FETCH_POLICY_WORDS.refused);
  return url;
}

/** Header names a request may not carry: a proxy's, or a browser's fingerprint (client hints and the like). */
const DISGUISE = /^(?:via|forwarded|x-forwarded-.+|x-real-ip|proxy-.+|sec-ch-.+|sec-fetch-.+|x-requested-with)$/i;

/** Refuses a request that would pass for something else: another user agent, a proxy header or a browser's fingerprint. */
export function refuseDisguise(headers: Readonly<Record<string, string>> | undefined): void {
  for (const [name, value] of Object.entries(headers ?? {})) {
    const lower = name.toLowerCase();
    const otherAgent = lower === 'user-agent' && value !== CHAUSAR_USER_AGENT;
    if (otherAgent || DISGUISE.test(lower)) throw new ChausarError('FETCH_DISGUISE_REFUSED', FETCH_POLICY_WORDS.disguise);
  }
}

// ---------------------------------------------------------------------------
// Politeness (wave 6, 6F3, D32): one request per site every few seconds, robots.txt kept a while, a full stop at a
// CAPTCHA and a pause when a site says too many requests. The state belongs to the underlying sender: the real network
// sender (pinnedSend) is paced by default; any other sender (tests, an owner site's own API) is not paced unless it is
// given politeness with usePoliteness, but every sender stops at a CAPTCHA.
// ---------------------------------------------------------------------------

/** The gap between two requests to the same site on the real network, in milliseconds. */
export const POLITE_GAP_MS = 3000;
const HOUR = 60 * 60 * 1000;

export const POLITE_WORDS = Object.freeze({
  captcha: 'This site asked for a CAPTCHA, so Chausar stopped reading it and will leave it alone today. Open the page in your own browser.',
  paused: 'This site asked Chausar to slow down, so it is paused for a while. Try again later.',
});

export type PolitenessOptions = { gapMs: number; robotsMs: number; stopMs: number; now: () => number; sleep: (ms: number) => Promise<void> };
type Politeness = PolitenessOptions & {
  /** When the next request to a host may go. */ next: Map<string, number>;
  /** Hosts left alone until a time, and why. */ stopped: Map<string, { until: number; code: 'CAPTCHA_STOP' | 'SITE_PAUSED' }>;
  /** robots.txt answers kept per origin. */ robots: Map<string, { at: number; status: number; text: string }>;
};

// Not unref'd: a read waiting its turn must keep the process alive until it goes.
const sleepFor = (ms: number) => new Promise<void>(done => { setTimeout(done, ms); });
const QUIET: PolitenessOptions = { gapMs: 0, robotsMs: 0, stopMs: 24 * HOUR, now: () => Date.now(), sleep: sleepFor };
const STATES = new WeakMap<PinnedSender, Politeness>();
const fresh = (options: PolitenessOptions): Politeness => ({ ...options, next: new Map(), stopped: new Map(), robots: new Map() });

/** Gives a sender its own politeness (tests, or a host that composes its own sender). Replaces any earlier state. */
export function usePoliteness(send: PinnedSender, options: Partial<PolitenessOptions>): void {
  STATES.set(send, fresh({ ...QUIET, ...options }));
}
function stateOf(send: PinnedSender): Politeness {
  let state = STATES.get(send);
  if (!state) { state = fresh(QUIET); STATES.set(send, state); }
  return state;
}
/** A sender's politeness as it is now: the real sender's defaults, or quiet (no pacing) for one never given any. */
export function politenessOf(send: PinnedSender): Readonly<PolitenessOptions> {
  return stateOf(send);
}
usePoliteness(pinnedSend, { gapMs: POLITE_GAP_MS, robotsMs: HOUR, stopMs: 24 * HOUR });

const hostKey = (url: URL) => url.hostname.toLowerCase().replace(/\.$/, '');

/** Signs of a challenge page in the first part of a body, whatever its status. */
const CHALLENGE = /cf-chl-|\/cdn-cgi\/challenge-platform\/|challenges\.cloudflare\.com\/turnstile|captcha-delivery\.com|px-captcha|_Incapsula_Resource|<title>\s*(?:Just a moment\.\.\.|Attention Required! \| Cloudflare|Are you a robot\??|Verify you are human|Human verification)\s*<\/title>/i;
/** A CAPTCHA widget: a stop only on a refusal, since many ordinary pages carry one on a contact form. */
const WIDGET = /g-recaptcha|recaptcha\/api|h-captcha|hcaptcha\.com|cf-turnstile|captcha/i;

/** Whether an answer is a CAPTCHA or bot challenge rather than the page asked for. */
export function captchaPage(answer: { status: number; headers: Record<string, string>; body: Buffer | Uint8Array | string }): boolean {
  if (String(answer.headers['cf-mitigated'] ?? '').toLowerCase() === 'challenge') return true;
  const body = typeof answer.body === 'string' ? answer.body.slice(0, 256 * 1024) : Buffer.from(answer.body).subarray(0, 256 * 1024).toString('utf8');
  if (CHALLENGE.test(body)) return true;
  return [401, 403, 429, 503].includes(answer.status) && WIDGET.test(body);
}

/** How long a Retry-After asks for (seconds or a date), capped at an hour; ten minutes when it says nothing usable. */
function retryAfterMs(value: string | undefined, now: number): number {
  const seconds = Number(value);
  if (value && Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, HOUR);
  const date = value ? Date.parse(value) : NaN;
  return Number.isFinite(date) ? Math.min(Math.max(date - now, 0), HOUR) : 10 * 60 * 1000;
}

/** Refuses a host that is stopped (CAPTCHA) or paused (too many requests) right now. */
function refuseStopped(state: Politeness, host: string): void {
  const stop = state.stopped.get(host);
  if (stop && stop.until > state.now()) throw new ChausarError(stop.code, stop.code === 'CAPTCHA_STOP' ? POLITE_WORDS.captcha : POLITE_WORDS.paused);
}

/**
 * Waits for this sender's next slot on a site (robots.txt excepted), taken from the deadline: answers the time left.
 * A slot further away than the deadline fails as a timeout before anything is sent. Also used by the desktop's
 * JavaScript reader (web/reader.ts) so a page opened in a hidden window keeps the same pace.
 */
export async function paceSite(send: PinnedSender, url: URL, timeoutMs: number): Promise<number> {
  const state = stateOf(send), host = hostKey(url);
  refuseStopped(state, host);
  if (state.gapMs <= 0 || url.pathname === '/robots.txt') return timeoutMs;
  const now = state.now(), slot = Math.max(now, state.next.get(host) ?? now);
  check(slot - now < timeoutMs, 'NET_TIMEOUT', NET_WORDS.timeout);
  state.next.set(host, slot + state.gapMs);
  if (slot > now) await state.sleep(slot - now);
  return timeoutMs - (slot - now);
}

/** Notes what an answer says about its site: a CAPTCHA stops the site and throws; too many requests pauses it. */
export function noteAnswer(send: PinnedSender, url: URL, answer: { status: number; headers: Record<string, string>; body: Buffer | Uint8Array | string }): void {
  const state = stateOf(send), host = hostKey(url);
  if (captchaPage(answer)) {
    state.stopped.set(host, { until: state.now() + state.stopMs, code: 'CAPTCHA_STOP' });
    throw new ChausarError('CAPTCHA_STOP', POLITE_WORDS.captcha);
  }
  if (answer.status === 429) state.stopped.set(host, { until: state.now() + retryAfterMs(answer.headers['retry-after'], state.now()), code: 'SITE_PAUSED' });
}

/**
 * The guard's sender with the policy before every hop, so a redirect never lands on a listed site, and always as Chausar;
 * 6F3: paced per site, and stopped at a CAPTCHA or paused after too many requests.
 */
export function policySafe(send: PinnedSender): PinnedSender {
  return async target => {
    checkFetchPolicy(target.url);
    const timeoutMs = await paceSite(send, target.url, target.timeoutMs);
    const answer = await send({ ...target, timeoutMs, headers: { ...target.headers, 'user-agent': CHAUSAR_USER_AGENT } });
    noteAnswer(send, target.url, answer);
    return answer;
  };
}

/** sites (A2): a run's refusing-site breaker (site-breaker.ts), counted here where the policy's stops are raised. */
export type PoliteNet = { resolve?: NetResolver; send?: PinnedSender; sites?: SiteBreaker };

/** A page sender that checks robots.txt at every hop within the guarded request's remaining deadline. */
export function robotsSafe(send: PinnedSender, resolve?: NetResolver): PinnedSender {
  const polite = policySafe(send);
  return async target => {
    checkFetchPolicy(target.url);
    const started = Date.now();
    const robots = await robotsCheck(target.url, { send, resolve });
    if (!robots.allowed) throw new ChausarError('ROBOTS_REFUSED', FETCH_POLICY_WORDS.robots);
    const timeoutMs = target.timeoutMs - (Date.now() - started);
    check(timeoutMs > 0, 'NET_TIMEOUT', NET_WORDS.timeout);
    return polite({ ...target, timeoutMs });
  };
}

/**
 * One read of the web as Chausar: the policy and the guard first, then the request with Chausar's own user agent, each
 * hop checked again. Only GET or HEAD; the caller's headers may add an accept line, never a disguise.
 */
export async function politeFetch(request: Omit<GuardedRequest, 'method' | 'body'> & { method?: 'GET' | 'HEAD' }, net: PoliteNet = {}): Promise<GuardedResponse> {
  refuseDisguise(request.headers);
  const url = checkFetchPolicy(request.url);
  check(request.method === undefined || request.method === 'GET' || request.method === 'HEAD', 'INVALID_VENTURE_REQUEST', 'Chausar only reads pages here.');
  // A2: a site this run closed after three refusals in a row is not asked again; each answer or stop is counted.
  net.sites?.refuseClosed(url);
  try {
    const answer = await guardedFetch(
      { ...request, url: url.href, headers: { ...request.headers, 'user-agent': CHAUSAR_USER_AGENT } },
      { resolve: net.resolve, send: policySafe(net.send ?? pinnedSend) },
    );
    net.sites?.answered(url, answer.status);
    return answer;
  } catch (error) {
    net.sites?.note(url, error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

type RobotsRule = { allow: boolean; path: string };

/** The groups of a robots.txt: each group's user agents (lower case) and its rules. */
function robotsGroups(text: string): { agents: string[]; rules: RobotsRule[] }[] {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;
  let inRules = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!current || inRules) { current = { agents: [], rules: [] }; groups.push(current); inRules = false; }
      current.agents.push(value.toLowerCase());
    } else if ((field === 'allow' || field === 'disallow') && current) {
      inRules = true;
      if (value) current.rules.push({ allow: field === 'allow', path: value });
    }
  }
  return groups;
}

/** Whether one robots path pattern matches a path: a prefix, with * for any run of characters and a final $ for the end. */
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern).split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path);
}

/**
 * Whether robots.txt lets Chausar read a path (with its query): the group that names Chausar, else the '*' group, else
 * everything is allowed. The longest matching rule decides; Allow wins a tie.
 */
export function robotsAllows(text: string, path: string): boolean {
  const groups = robotsGroups(text);
  const token = ROBOTS_TOKEN.toLowerCase();
  const own = groups.filter(group => group.agents.some(agent => agent === token));
  const chosen = own.length ? own : groups.filter(group => group.agents.includes('*'));
  let best: RobotsRule | null = null;
  for (const rule of chosen.flatMap(group => group.rules)) {
    if (!matches(rule.path, path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

/** The most of a robots.txt Chausar reads. */
export const ROBOTS_BYTES = 512 * 1024;

/**
 * Reads the site's robots.txt as Chausar and says whether the page may be read. No robots.txt (a 4xx answer) means no
 * rule. A server error or a failed read throws, so the caller tries again later rather than reading the page.
 */
export async function robotsCheck(url: URL, net: PoliteNet = {}): Promise<{ allowed: boolean; line: string | null }> {
  // 6F3: a sender with politeness keeps each site's robots.txt for a while (an hour on the real network), so a second
  // page of the same site does not ask for it again. A server error is never kept.
  const state = stateOf(net.send ?? pinnedSend);
  const kept = state.robotsMs > 0 ? state.robots.get(url.origin) : undefined;
  let status: number, text: string;
  if (kept && state.now() - kept.at < state.robotsMs) ({ status, text } = kept);
  else {
    const answer = await politeFetch({ url: `${url.origin}/robots.txt`, headers: { accept: 'text/plain' }, maxBytes: ROBOTS_BYTES, maxRedirects: 2, timeoutMs: 15_000 }, net);
    status = answer.status; text = answer.body.toString('utf8');
    if (state.robotsMs > 0 && status >= 200 && status < 500 && status !== 429) state.robots.set(url.origin, { at: state.now(), status, text });
  }
  if (status >= 400 && status < 500) return { allowed: true, line: null };
  if (status < 200 || status > 299) throw new ChausarError('NET_FAILED', 'The site did not give its robots.txt, so Chausar did not read the page.');
  const allowed = robotsAllows(text, `${url.pathname}${url.search}`);
  return { allowed, line: allowed ? null : FETCH_POLICY_WORDS.robots };
}
