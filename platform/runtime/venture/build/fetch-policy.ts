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

/** The guard's sender with the policy before every hop, so a redirect never lands on a listed site, and always as Chausar. */
export function policySafe(send: PinnedSender): PinnedSender {
  return async target => {
    checkFetchPolicy(target.url);
    return send({ ...target, headers: { ...target.headers, 'user-agent': CHAUSAR_USER_AGENT } });
  };
}

export type PoliteNet = { resolve?: NetResolver; send?: PinnedSender };

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
  return guardedFetch(
    { ...request, url: url.href, headers: { ...request.headers, 'user-agent': CHAUSAR_USER_AGENT } },
    { resolve: net.resolve, send: policySafe(net.send ?? pinnedSend) },
  );
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
  const answer = await politeFetch({ url: `${url.origin}/robots.txt`, headers: { accept: 'text/plain' }, maxBytes: ROBOTS_BYTES, maxRedirects: 2, timeoutMs: 15_000 }, net);
  if (answer.status >= 400 && answer.status < 500) return { allowed: true, line: null };
  if (answer.status < 200 || answer.status > 299) throw new ChausarError('NET_FAILED', 'The site did not give its robots.txt, so Chausar did not read the page.');
  const allowed = robotsAllows(answer.body.toString('utf8'), `${url.pathname}${url.search}`);
  return { allowed, line: allowed ? null : FETCH_POLICY_WORDS.robots };
}
