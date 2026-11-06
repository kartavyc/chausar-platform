// Wave 6 package 6F3 (D32): polite reading on top of the 5A6 fetch policy. Every page Chausar reads by itself goes
// through politeFetch and robotsSafe (build/fetch-policy.ts), which the SEO source checks, Before you write, monitors
// and job capture already use. 6F3 adds, there and nowhere else: one request per site every few seconds, robots.txt
// read once and kept a while, and a full stop at a CAPTCHA (no retry, no other route, that site left alone for the day).
// A site that says "too many requests" is paused for as long as it asks. The real network sender is paced by default;
// a test sender opts in with usePoliteness.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PinnedTarget } from '../runtime/venture/core/net-guard.ts';
import { pinnedSend } from '../runtime/venture/core/net-guard.ts';
import {
  POLITE_GAP_MS, POLITE_WORDS, captchaPage, politeFetch, politenessOf, robotsSafe, usePoliteness,
} from '../runtime/venture/build/fetch-policy.ts';

const resolve = async () => [{ address: '142.250.1.10', family: 4 as const }];

function sender(table: Record<string, { status: number; body?: string; headers?: Record<string, string> }>) {
  const sent: PinnedTarget[] = [];
  const send = async (target: PinnedTarget) => {
    sent.push(target);
    const answer = table[target.url.href] ?? { status: 404 };
    return { status: answer.status, headers: answer.headers ?? { 'content-type': 'text/html' }, body: Buffer.from(answer.body ?? '') };
  };
  return { sent, send };
}

/** A fake clock: sleeping moves it on and is written down. */
function clock(start = 1_000_000) {
  const state = { at: start, waits: [] as number[] };
  return { state, now: () => state.at, sleep: async (ms: number) => { state.waits.push(ms); state.at += ms; } };
}

test('the real network sender is paced by default: one request per site every few seconds, robots.txt kept for an hour', () => {
  assert.ok(POLITE_GAP_MS >= 2000 && POLITE_GAP_MS <= 5000, 'a few seconds');
  const real = politenessOf(pinnedSend);
  assert.equal(real.gapMs, POLITE_GAP_MS);
  assert.ok(real.robotsMs >= 60 * 60 * 1000);
  assert.ok(real.stopMs >= 12 * 60 * 60 * 1000, 'a CAPTCHA stop lasts the day');
});

test('a sender with no politeness set is not paced (tests and owner-site API calls), but still stops at a CAPTCHA', async () => {
  const { send } = sender({ 'https://a.example/1': { status: 200, body: 'one' }, 'https://a.example/2': { status: 200, body: 'two' } });
  assert.equal(politenessOf(send).gapMs, 0);
  await politeFetch({ url: 'https://a.example/1' }, { resolve, send });
  await politeFetch({ url: 'https://a.example/2' }, { resolve, send });
});

test('pages on the same site wait the gap; another site does not; robots.txt is exempt from the wait', async () => {
  const time = clock();
  const { sent, send } = sender({
    'https://a.example/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /\n', headers: { 'content-type': 'text/plain' } },
    'https://a.example/1': { status: 200, body: 'one' }, 'https://a.example/2': { status: 200, body: 'two' },
    'https://b.example/robots.txt': { status: 404 }, 'https://b.example/1': { status: 200, body: 'bee' },
  });
  usePoliteness(send, { gapMs: 3000, robotsMs: 60 * 60 * 1000, now: time.now, sleep: time.sleep });
  const polite = robotsSafe(send, resolve);
  const read = (url: string) => politeFetch({ url, maxRedirects: 0 }, { resolve, send: polite });
  await read('https://a.example/1');
  assert.deepEqual(time.state.waits, [], 'the first page of a site goes at once, robots.txt first');
  await read('https://b.example/1');
  assert.deepEqual(time.state.waits, [], 'another site is not held up');
  await read('https://a.example/2');
  assert.deepEqual(time.state.waits, [3000], 'the second page of a site waits the gap');
  // robots.txt was read once per site and kept, not again before the second page.
  assert.deepEqual(sent.map(target => target.url.href), [
    'https://a.example/robots.txt', 'https://a.example/1', 'https://b.example/robots.txt', 'https://b.example/1', 'https://a.example/2',
  ]);
});

test('the wait is taken from the request deadline, so a wait longer than the deadline fails as a timeout without sending', async () => {
  const time = clock();
  const { sent, send } = sender({ 'https://a.example/1': { status: 200, body: 'one' }, 'https://a.example/2': { status: 200, body: 'two' } });
  usePoliteness(send, { gapMs: 3000, now: time.now, sleep: time.sleep });
  await politeFetch({ url: 'https://a.example/1' }, { resolve, send });
  await assert.rejects(politeFetch({ url: 'https://a.example/2', timeoutMs: 1000 }, { resolve, send }), (error: any) => error.code === 'NET_TIMEOUT');
  assert.equal(sent.length, 1);
});

test('a CAPTCHA page stops reading that site fully: the read fails in plain words and nothing more is sent to it', async () => {
  const time = clock();
  const challenge = '<!doctype html><html><head><title>Just a moment...</title></head><body><div id="cf-chl-widget"></div></body></html>';
  const { sent, send } = sender({
    'https://guarded.example/a': { status: 403, body: challenge },
    'https://guarded.example/b': { status: 200, body: 'fine' },
    'https://other.example/a': { status: 200, body: 'fine' },
  });
  usePoliteness(send, { gapMs: 0, now: time.now, sleep: time.sleep });
  await assert.rejects(politeFetch({ url: 'https://guarded.example/a' }, { resolve, send }), (error: any) => {
    assert.equal(error.code, 'CAPTCHA_STOP');
    assert.equal(error.message, POLITE_WORDS.captcha);
    return true;
  });
  await assert.rejects(politeFetch({ url: 'https://guarded.example/b' }, { resolve, send }), (error: any) => error.code === 'CAPTCHA_STOP');
  assert.equal(sent.filter(target => target.url.hostname === 'guarded.example').length, 1, 'no retry and no second page');
  assert.equal((await politeFetch({ url: 'https://other.example/a' }, { resolve, send })).status, 200, 'other sites carry on');
  time.state.at += politenessOf(send).stopMs + 1;
  assert.equal((await politeFetch({ url: 'https://guarded.example/b' }, { resolve, send })).status, 200, 'after the day it may be read again');
  assert.doesNotMatch(POLITE_WORDS.captcha, /\u2014/);
});

test('a CAPTCHA reached through a redirect stops too', async () => {
  const { send } = sender({
    'https://site.example/start': { status: 302, headers: { location: 'https://site.example/check' } },
    'https://site.example/check': { status: 200, body: '<html><head><title>Verify you are human</title></head><body>.</body></html>' },
  });
  await assert.rejects(politeFetch({ url: 'https://site.example/start' }, { resolve, send }), (error: any) => error.code === 'CAPTCHA_STOP');
});

test('a contact form with a reCAPTCHA on an ordinary page is not a stop; the same widget on a refusal is', () => {
  const html = (title: string) => Buffer.from(`<html><head><title>${title}</title></head><body><form><div class="g-recaptcha" data-sitekey="x"></div></form></body></html>`);
  assert.equal(captchaPage({ status: 200, headers: {}, body: html('Contact us') }), false);
  assert.equal(captchaPage({ status: 403, headers: {}, body: html('Blocked') }), true);
  assert.equal(captchaPage({ status: 200, headers: { 'cf-mitigated': 'challenge' }, body: Buffer.from('') }), true);
  assert.equal(captchaPage({ status: 200, headers: {}, body: Buffer.from('<p>We explain what a captcha is.</p>') }), false);
  for (const marker of ['/cdn-cgi/challenge-platform/h/b', 'geo.captcha-delivery.com', 'px-captcha', '_Incapsula_Resource']) {
    assert.equal(captchaPage({ status: 200, headers: {}, body: Buffer.from(`<script src="${marker}"></script>`) }), true, marker);
  }
});

test('too many requests pauses that site for as long as it asks (capped at an hour), then it may be read again', async () => {
  const time = clock();
  const { sent, send } = sender({
    'https://busy.example/a': { status: 429, headers: { 'retry-after': '120', 'content-type': 'text/plain' }, body: 'slow down' },
    'https://busy.example/b': { status: 200, body: 'ok' },
  });
  usePoliteness(send, { gapMs: 0, now: time.now, sleep: time.sleep });
  assert.equal((await politeFetch({ url: 'https://busy.example/a' }, { resolve, send })).status, 429);
  await assert.rejects(politeFetch({ url: 'https://busy.example/b' }, { resolve, send }), (error: any) => {
    assert.equal(error.code, 'SITE_PAUSED');
    assert.equal(error.message, POLITE_WORDS.paused);
    return true;
  });
  assert.equal(sent.length, 1);
  time.state.at += 120_001;
  assert.equal((await politeFetch({ url: 'https://busy.example/b' }, { resolve, send })).status, 200);
});
