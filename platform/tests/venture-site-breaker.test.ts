// A2: a site that refuses Chausar three times in a row is closed for the rest of the run and named as unavailable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError } from '../runtime/contracts.ts';
import { SiteBreaker, SITE_WORDS } from '../runtime/venture/build/site-breaker.ts';
import type { PinnedAnswer, PinnedTarget } from '../runtime/venture/core/net-guard.ts';

const target = (url: string) => ({ url: new URL(url), address: { address: '93.184.216.34', family: 4 }, method: 'GET', headers: {}, timeoutMs: 1000 } as unknown as PinnedTarget);
const answer = (status: number): PinnedAnswer => ({ status, headers: {}, body: Buffer.from('') });

test('three refusals in a row close the site; a fourth request never goes; other sites still go', async () => {
  const sent: string[] = [], closed: string[] = [];
  const statuses = [403, 429, 451];
  const breaker = new SiteBreaker(host => closed.push(host));
  const send = breaker.wrap(async request => { sent.push(request.url.hostname); return request.url.hostname === 'news.example' ? answer(statuses.shift() ?? 200) : answer(200); });
  for (let n = 0; n < 3; n++) await send(target('https://news.example/a'));
  await assert.rejects(send(target('https://NEWS.example/b')), (error: unknown) => error instanceof ChausarError && error.code === 'SITE_UNAVAILABLE' && error.message === SITE_WORDS.closed('news.example'));
  assert.equal(sent.filter(host => host === 'news.example').length, 3, 'nothing more is sent to a closed site');
  assert.equal((await send(target('https://other.example/'))).status, 200);
  assert.deepEqual(breaker.unavailable(), ['news.example']);
  assert.deepEqual(closed, ['news.example']);
});

test('an ordinary answer in between resets the count; a CAPTCHA stop counts as a refusal', async () => {
  const replies: (number | 'captcha')[] = [403, 403, 200, 403, 403, 'captcha'];
  const breaker = new SiteBreaker();
  const send = breaker.wrap(async () => {
    const next = replies.shift()!;
    if (next === 'captcha') throw new ChausarError('CAPTCHA_STOP', 'This site asked for a CAPTCHA.');
    return answer(next);
  });
  for (let n = 0; n < 5; n++) await send(target('https://shop.example/'));
  assert.deepEqual(breaker.unavailable(), [], 'the 200 reset the count');
  await assert.rejects(send(target('https://shop.example/')), { code: 'CAPTCHA_STOP' });
  assert.deepEqual(breaker.unavailable(), ['shop.example']);
  // A failure that is not the site saying no (a network fault) does not count.
  const quiet = new SiteBreaker();
  const failing = quiet.wrap(async () => { throw new ChausarError('NET_TIMEOUT', 'The site took too long.'); });
  for (let n = 0; n < 4; n++) await assert.rejects(failing(target('https://slow.example/')), { code: 'NET_TIMEOUT' });
  assert.deepEqual(quiet.unavailable(), []);
});
