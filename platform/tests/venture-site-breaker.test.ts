// A2: a site that refuses Chausar three times in a row is closed for the rest of the run and named as unavailable.
// A2 review: counted through the real politeFetch, where the CAPTCHA, robots and slow-down stops are raised.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError } from '../runtime/contracts.ts';
import { SiteBreaker, SITE_WORDS } from '../runtime/venture/build/site-breaker.ts';
import { politeFetch } from '../runtime/venture/build/fetch-policy.ts';
import type { NetAddress, PinnedAnswer, PinnedTarget } from '../runtime/venture/core/net-guard.ts';

const resolve = async (): Promise<NetAddress[]> => [{ address: '93.184.216.34', family: 4 }];
const answer = (status: number, body = 'ok', headers: Record<string, string> = {}): PinnedAnswer => ({ status, headers, body: Buffer.from(body) });
const CHALLENGE = '<html><head><title>Just a moment...</title></head><body>cf-chl-</body></html>';

/** A fresh sender each time, so the fetch policy's per-sender pacing and stops start clean. */
function net(reply: (target: PinnedTarget) => PinnedAnswer, sites: SiteBreaker) {
  const sent: string[] = [];
  return { sent, net: { resolve, sites, send: async (target: PinnedTarget) => { sent.push(target.url.href); return reply(target); } } };
}

test('three challenge pages close the site; the next read never goes; another site still does', async () => {
  const closed: string[] = [];
  const sites = new SiteBreaker(host => closed.push(host));
  const { sent, net: wired } = net(target => (target.url.hostname === 'news.example' ? answer(200, CHALLENGE) : answer(200)), sites);
  for (let n = 0; n < 3; n++) await assert.rejects(politeFetch({ url: 'https://news.example/a' }, wired), { code: 'CAPTCHA_STOP' });
  await assert.rejects(politeFetch({ url: 'https://NEWS.example/b' }, wired), (error: unknown) => error instanceof ChausarError && error.code === 'SITE_UNAVAILABLE' && error.message === SITE_WORDS.closed('news.example'));
  assert.equal(sent.filter(url => url.includes('news.example')).length, 1, 'after the first challenge nothing more goes to it');
  assert.equal((await politeFetch({ url: 'https://other.example/' }, wired)).status, 200);
  assert.deepEqual(sites.unavailable(), ['news.example']);
  assert.deepEqual(closed, ['news.example']);
});

test('a 429 and the slow-down that follows count as refusals', async () => {
  const sites = new SiteBreaker();
  const { net: wired } = net(() => answer(429, 'slow down', { 'retry-after': '60' }), sites);
  assert.equal((await politeFetch({ url: 'https://shop.example/' }, wired)).status, 429);
  await assert.rejects(politeFetch({ url: 'https://shop.example/' }, wired), { code: 'SITE_PAUSED' });
  await assert.rejects(politeFetch({ url: 'https://shop.example/' }, wired), { code: 'SITE_PAUSED' });
  assert.deepEqual(sites.unavailable(), ['shop.example']);
  await assert.rejects(politeFetch({ url: 'https://shop.example/' }, wired), { code: 'SITE_UNAVAILABLE' });
});

test('an answer the policy lets through resets the count; a network fault does not count', async () => {
  const sites = new SiteBreaker();
  const statuses = [403, 403, 200, 403, 403];
  const { net: wired } = net(() => answer(statuses.shift() ?? 200), sites);
  for (let n = 0; n < 5; n++) await politeFetch({ url: 'https://blog.example/' }, wired);
  assert.deepEqual(sites.unavailable(), [], 'the 200 reset the count');
  const faults = new SiteBreaker();
  const failing = { resolve, sites: faults, send: async () => { throw new ChausarError('NET_TIMEOUT', 'The site took too long.'); } };
  for (let n = 0; n < 4; n++) await assert.rejects(politeFetch({ url: 'https://slow.example/' }, failing), { code: 'NET_TIMEOUT' });
  assert.deepEqual(faults.unavailable(), []);
});

test('through the job\'s real source check: a site that keeps answering with challenge pages is closed for the run', async () => {
  const { corroborateClaims } = await import('../runtime/venture/playbooks/seo-visibility/corroborate.ts');
  const sites = new SiteBreaker();
  const send = async (target: PinnedTarget) => (target.url.pathname === '/robots.txt' ? answer(200, 'User-agent: *\nAllow: /') : answer(200, CHALLENGE));
  const claims = [{ id: 'c1', number: '35%', urls: ['https://wall.example/a', 'https://wall.example/b', 'https://wall.example/c', 'https://wall.example/d'] }];
  await corroborateClaims({ text: '35% [claim:c1] of visitors.', claims, competitors: [] }, { resolve, send, sites });
  assert.deepEqual(sites.unavailable(), ['wall.example']);
});
