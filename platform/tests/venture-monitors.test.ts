// Package 5A6 (Ink v2 wave 5, catalogue K16): page monitors. venture.monitors.add (approve, inside the app; a recurring
// check is on the always-ask floor, H12) refuses addresses inside the computer's network, sites on the fetch policy list
// and pages robots.txt keeps robots away from. Keeper's 'monitors' job checks each page as Chausar: the first check keeps
// a seed and alerts nothing, a later change alerts once, errors back off 1, 2, 4, 8 hours up to 24, one site is read at
// most once an hour, and a price comes only from the element the owner picked, parsed by code into paise.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { MonitorRecord, VentureDeps } from '../runtime/venture/contracts.ts';
import type { PinnedTarget } from '../runtime/venture/core/net-guard.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { handlers } from '../runtime/venture/build/index.ts';
import { checkMonitorsDue, monitorRows, parsePricePaise, selectText, MONITOR_WORDS } from '../runtime/venture/build/monitors.ts';
import { CHAUSAR_USER_AGENT } from '../runtime/venture/build/fetch-policy.ts';
import { code, owner, phone, setup, type Env } from './venture-views-env.ts';

const PUBLIC = '142.250.1.10';
const HOUR = 3_600_000;

type Page = { status: number; body?: string; headers?: Record<string, string> };
/** The web as a table by address: a missing robots.txt is a 404, a missing page a 404. */
function web(env: Env, pages: Record<string, Page>) {
  const sent: PinnedTarget[] = [];
  const resolveTo: Record<string, string> = {};
  env.deps.net = {
    resolve: async host => [{ address: resolveTo[host] ?? PUBLIC, family: 4 }],
    send: async target => {
      sent.push(target);
      const page = pages[target.url.href] ?? { status: 404 };
      return { status: page.status, headers: page.headers ?? { 'content-type': 'text/html' }, body: Buffer.from(page.body ?? '') };
    },
  };
  return { sent, pages, resolveTo };
}

const call = <T>(env: Env, method: string, payload: unknown, ctx: Context = owner) =>
  (handlers as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>>)[method](env.deps, ctx, payload) as Promise<T>;
const monitors = (env: Env): MonitorRecord[] => listRecords(env.store.read(), 'venture-monitor');
const add = (env: Env, payload: Record<string, unknown>, ctx: Context = owner) => call<any>(env, 'venture.monitors.add', payload, ctx);

test('add refuses a private address, a site on the fetch policy list, a page robots.txt disallows, the phone and the hosted app', async () => {
  const env = await setup();
  const net = web(env, { 'https://shop.example/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /private' } });
  await assert.rejects(add(env, { url: 'http://192.168.1.4/menu', kind: 'change' }), code('NET_ADDRESS_REFUSED'));
  net.resolveTo['inside.example'] = '10.0.0.7';
  await assert.rejects(add(env, { url: 'https://inside.example/menu', kind: 'change' }), code('NET_ADDRESS_REFUSED'));
  await assert.rejects(add(env, { url: 'https://www.justdial.com/Pune/Cafes', kind: 'change' }), code('FETCH_POLICY_REFUSED'));
  await assert.rejects(add(env, { url: 'https://www.amazon.in/Tea/dp/B0ABCDEF12', kind: 'price-below', selector: '#price', belowRupees: '500' }), code('FETCH_POLICY_REFUSED'));
  await assert.rejects(add(env, { url: 'https://shop.example/private/prices', kind: 'change' }), (error: any) => {
    assert.equal(error.code, 'ROBOTS_REFUSED');
    assert.equal(error.message, 'This site asks robots not to read that page.');
    return true;
  });
  await assert.rejects(add(env, { url: 'https://shop.example/menu', kind: 'change' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(add(env, { url: 'https://shop.example/menu', kind: 'contains' }), code('INVALID_VENTURE_REQUEST'), 'a text to look for');
  await assert.rejects(add(env, { url: 'https://shop.example/menu', kind: 'price-below', belowRupees: '500' }), code('INVALID_VENTURE_REQUEST'), 'the element the owner picked');
  const hosted = { ...env, deps: { ...env.deps, host: 'hosted-web' as const } };
  await assert.rejects(add(hosted, { url: 'https://shop.example/menu', kind: 'change' }), code('TIER_UNAVAILABLE'));
  assert.equal(monitors(env).length, 0);
});

test('the first check keeps a seed and alerts nothing; the next change alerts once; the same page again alerts nothing', async () => {
  const env = await setup();
  const net = web(env, { 'https://shop.example/menu': { status: 200, body: '<html><body><h1>Menu</h1><p>Tea 20</p></body></html>' } });
  const view = await add(env, { url: 'https://shop.example/menu', kind: 'change' });
  assert.equal(view.kind, 'change');
  assert.equal(view.removed, false);
  await checkMonitorsDue(env.deps, owner);
  let [record] = monitors(env);
  assert.equal(record.seeded, true);
  assert.deepEqual(record.alerts, []);
  assert.equal(record.line, MONITOR_WORDS.seeded);
  assert.ok(net.sent.every(target => target.headers['user-agent'] === CHAUSAR_USER_AGENT), 'every read as Chausar');
  // Before the hour is up nothing is read again.
  const reads = net.sent.length;
  env.advance(10 * 60_000);
  await checkMonitorsDue(env.deps, owner);
  assert.equal(net.sent.length, reads);
  env.advance(HOUR);
  net.pages['https://shop.example/menu'] = { status: 200, body: '<html><body><h1>Menu</h1><p>Tea 25</p></body></html>' };
  await checkMonitorsDue(env.deps, owner);
  [record] = monitors(env);
  assert.equal(record.alerts.length, 1);
  assert.match(record.alerts[0].line, /shop\.example changed/);
  env.advance(HOUR + 1);
  await checkMonitorsDue(env.deps, owner);
  assert.equal(monitors(env)[0].alerts.length, 1, 'no change, no second alert');
  // The alert is a notice row on Today, Open and Later only.
  const rows = monitorRows(env.store.read(), env.venture);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'notice');
  assert.deepEqual(rows[0].actions.map(action => action.id), ['later', 'open']);
  // Keeper's run says what it did.
  const run = listRecords(env.store.read(), 'venture-keeper-run').find(item => item.job === 'monitors');
  assert.equal(run?.outcome, 'ok');
});

test('a contains monitor alerts once when the text appears', async () => {
  const env = await setup();
  const net = web(env, { 'https://jobs.example/openings': { status: 200, body: '<p>No openings now.</p>' } });
  await add(env, { url: 'https://jobs.example/openings', kind: 'contains', text: 'Barista' });
  await checkMonitorsDue(env.deps, owner);
  env.advance(HOUR);
  await checkMonitorsDue(env.deps, owner);
  assert.equal(monitors(env)[0].alerts.length, 0);
  net.pages['https://jobs.example/openings'] = { status: 200, body: '<p>We are hiring a <b>barista</b>.</p>' };
  env.advance(HOUR);
  await checkMonitorsDue(env.deps, owner);
  env.advance(HOUR);
  await checkMonitorsDue(env.deps, owner);
  const [record] = monitors(env);
  assert.equal(record.alerts.length, 1);
  assert.equal(record.lastValue, 'yes');
});

test('a price is read only from the picked element, in paise by code, and alerts once when it falls below the owner\'s figure', async () => {
  assert.equal(parsePricePaise('₹1,299.00'), '129900');
  assert.equal(parsePricePaise('Rs. 1,29,999.5'), '12999950');
  assert.equal(parsePricePaise('INR 499'), '49900');
  assert.equal(parsePricePaise('Price on request'), null);
  const html = '<div class="price old">₹999</div><span id="price" class="price now">₹1,450.00</span><meta itemprop="price" content="1450.00">';
  assert.equal(selectText(html, '#price'), '₹1,450.00');
  assert.equal(selectText(html, 'span.price.now'), '₹1,450.00');
  assert.equal(selectText(html, 'meta[itemprop=price]'), '1450.00');
  assert.equal(selectText(html, '.missing'), null);

  const env = await setup();
  const net = web(env, { 'https://shop.example/tea': { status: 200, body: html } });
  await add(env, { url: 'https://shop.example/tea', kind: 'price-below', selector: '#price', belowRupees: '1200' });
  await checkMonitorsDue(env.deps, owner);
  assert.equal(monitors(env)[0].lastValue, '145000', 'the picked element, not the old price beside it');
  net.pages['https://shop.example/tea'] = { status: 200, body: html.replace('₹1,450.00', '₹1,150.00') };
  env.advance(HOUR);
  await checkMonitorsDue(env.deps, owner);
  net.pages['https://shop.example/tea'] = { status: 200, body: html.replace('₹1,450.00', '₹1,100.00') };
  env.advance(HOUR);
  await checkMonitorsDue(env.deps, owner);
  const [record] = monitors(env);
  assert.equal(record.alerts.length, 1, 'once below, it does not alert again while it stays below');
  assert.equal(record.lastValue, '110000');
});

test('a price threshold is read from the owner\'s rupee text by the engine, with no competing amount', async () => {
  const env = await setup();
  web(env, {});
  await add(env, { url: 'https://shop.example/tea', kind: 'price-below', selector: '#price', belowRupees: '1,200.50' });
  assert.equal(monitors(env)[0].belowMinor, '120050');
  for (const belowRupees of ['0', '-1', '1.505', 'one thousand']) {
    await assert.rejects(add(env, { url: 'https://shop.example/tea', kind: 'price-below', selector: '#price', belowRupees }), code('INVALID_AMOUNT'));
  }
  await assert.rejects(add(env, { url: 'https://shop.example/tea', kind: 'price-below', selector: '#price', belowRupees: '1200', belowMinor: '120000' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(add(env, { url: 'https://shop.example/tea', kind: 'price-below', selector: '#price', belowMinor: '120000' }), code('INVALID_VENTURE_REQUEST'), 'obsolete UI-computed paise input is not an alternate public path');
});

test('errors back off 1, 2, 4, 8 hours up to 24, and two monitors on one site read it at most once an hour', async () => {
  const env = await setup();
  const net = web(env, { 'https://down.example/a': { status: 503 } });
  await add(env, { url: 'https://down.example/a', kind: 'change' });
  const gaps: number[] = [];
  for (let i = 0; i < 7; i += 1) {
    await checkMonitorsDue(env.deps, owner);
    const [record] = monitors(env);
    gaps.push((Date.parse(record.nextCheckAt) - Date.parse(env.now())) / HOUR);
    env.advance(Date.parse(record.nextCheckAt) - Date.parse(env.now()));
  }
  assert.deepEqual(gaps, [1, 2, 4, 8, 16, 24, 24]);
  assert.equal(monitors(env)[0].failures, 7);
  assert.equal(monitors(env)[0].alerts.length, 0, 'an error never alerts');

  const two = await setup();
  const site = web(two, { 'https://one.example/a': { status: 200, body: 'A' }, 'https://one.example/b': { status: 200, body: 'B' } });
  await add(two, { url: 'https://one.example/a', kind: 'change' });
  await add(two, { url: 'https://one.example/b', kind: 'change' });
  await checkMonitorsDue(two.deps, owner);
  const pages = () => site.sent.filter(target => !target.url.pathname.endsWith('robots.txt')).map(target => target.url.pathname);
  assert.equal(pages().length, 1, 'one page of the site this hour');
  two.advance(HOUR);
  await checkMonitorsDue(two.deps, owner);
  assert.deepEqual([...pages()].sort(), ['/a', '/b'], 'the page not yet read goes next');
  void net;
});

test('list and remove: removed monitors are never read again', async () => {
  const env = await setup();
  const net = web(env, { 'https://shop.example/menu': { status: 200, body: 'Menu' } });
  const view = await add(env, { url: 'https://shop.example/menu', kind: 'change' });
  const list = await call<any>(env, 'venture.monitors.list', {});
  assert.equal(list.monitors.length, 1);
  assert.equal(list.hosted, false);
  await assert.rejects(call(env, 'venture.monitors.remove', { id: view.id }, phone), code('APP_APPROVAL_REQUIRED'));
  const removed = await call<any>(env, 'venture.monitors.remove', { id: view.id });
  assert.equal(removed.removed, true);
  await assert.rejects(call(env, 'venture.monitors.remove', { id: 'monitor_nope' }), code('MONITOR_NOT_FOUND'));
  const before = net.sent.length;
  env.advance(2 * HOUR);
  await checkMonitorsDue(env.deps, owner);
  assert.equal(net.sent.length, before);
  assert.equal((await call<any>(env, 'venture.monitors.list', {})).monitors.length, 0);
});

test('one tick has a budget: at most MONITOR_TICK_LOOKS pages, and none once its time is spent; the rest wait for the next tick', async () => {
  const { MONITOR_TICK_LOOKS } = await import('../runtime/venture/build/monitors.ts');
  const env = await setup();
  const table: Record<string, Page> = {};
  for (let i = 0; i < MONITOR_TICK_LOOKS + 3; i += 1) table[`https://site${i}.example/p`] = { status: 200, body: `page ${i}` };
  const net = web(env, table);
  for (let i = 0; i < MONITOR_TICK_LOOKS + 3; i += 1) await add(env, { url: `https://site${i}.example/p`, kind: 'change' });
  const pagesRead = () => net.sent.filter(target => !target.url.pathname.endsWith('robots.txt')).length;
  await checkMonitorsDue(env.deps, owner);
  assert.equal(pagesRead(), MONITOR_TICK_LOOKS);
  await checkMonitorsDue(env.deps, owner);
  assert.equal(pagesRead(), MONITOR_TICK_LOOKS + 3, 'the rest on the next tick');
  // A spent time budget looks at nothing, and nothing is pushed back.
  env.advance(HOUR);
  const before = pagesRead();
  await checkMonitorsDue(env.deps, owner, { budgetMs: 0 });
  assert.equal(pagesRead(), before);
  assert.ok(monitors(env).every(record => Date.parse(record.nextCheckAt) <= Date.parse(env.now())), 'still due');
});


test('a monitor refuses a redirect into a path robots.txt disallows, without reading that path', async () => {
  const env = await setup();
  const site = web(env, {
    'https://shop.example/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /private' },
    'https://shop.example/menu': { status: 302, headers: { location: '/private/menu' } },
    'https://shop.example/private/menu': { status: 200, body: 'Private menu' },
  });
  await add(env, { url: 'https://shop.example/menu', kind: 'change' });
  await checkMonitorsDue(env.deps, owner);
  assert.ok(!site.sent.some(target => target.url.pathname === '/private/menu'));
  assert.equal(monitors(env)[0].failures, 1);
  assert.equal(monitors(env)[0].seeded, false);
  assert.equal(monitors(env)[0].lastError, 'This site asks robots not to read that page.');
});
