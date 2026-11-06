// Wave 6 founder follow-up F3 (D32, 2 November 2026): small site crawls use Crawlee, the honest way. crawlSite keeps
// Crawlee's BasicCrawler only as its queue; every page still goes through readPage's polite reader (Chausar's own
// name, robots.txt, pacing, the fetch policy list, the network guard). These tests hold the rules that never bend:
// no got-scraping, header generator or fingerprint generator is loaded or used, no proxy, no session pool, no retry,
// one page at a time, Crawlee's storage stays in memory inside a temporary folder that is gone afterwards, and nothing
// carries over from one crawl to the next.
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { registerHooks } from 'node:module';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PinnedTarget } from '../runtime/venture/core/net-guard.ts';
import * as reader from '../runtime/venture/web/reader.ts';

const { createPageCache, crawlSite, CRAWL_LIMITS } = reader;

// Every module loaded from here on is recorded, so the test can prove what Crawlee never loads. Crawlee itself is
// loaded only inside the tests below (crawlSite loads it when a crawl starts), after this hook is in place.
const loaded: string[] = [];
registerHooks({ resolve(specifier, context, next) { loaded.push(specifier); return next(specifier, context); } });
const BANNED = /^(got-scraping|got|header-generator|fingerprint-generator|fingerprint-injector|generative-bayesian-network|proxy-chain)(\/|$)/;

const resolve = async () => [{ address: '142.250.1.10', family: 4 as const }];
type Row = { status: number; body?: string; headers?: Record<string, string> };
function sender(table: Record<string, Row>) {
  const sent: PinnedTarget[] = [];
  const send = async (target: PinnedTarget) => {
    sent.push(target);
    const answer = table[target.url.href] ?? { status: 404 };
    return { status: answer.status, headers: answer.headers ?? { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(answer.body ?? '') };
  };
  return { sent, send };
}
const page = (title: string, links: string[]) => `<html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>${'This page explains one part of brewing tea at home with care and patience. '.repeat(6)}</p>${links.map(href => `<a href="${href}">${href}</a>`).join(' ')}</article></body></html>`;
const ROBOTS = { status: 200, body: 'User-agent: *\nDisallow: /private\n', headers: { 'content-type': 'text/plain' } };

/** A site whose home page links to fifteen pages, each linking to one page further down. */
function bigSite(host: string) {
  const table: Record<string, Row> = { [`https://${host}/robots.txt`]: ROBOTS };
  const first = Array.from({ length: 15 }, (_, i) => `/p${i}`);
  table[`https://${host}/`] = { status: 200, body: page('Home', first) };
  for (let i = 0; i < 15; i++) table[`https://${host}/p${i}`] = { status: 200, body: page(`P${i}`, [`/p${i}/deep`]) };
  for (let i = 0; i < 15; i++) table[`https://${host}/p${i}/deep`] = { status: 200, body: page(`Deep ${i}`, [`/p${i}/deep/deeper`]) };
  return table;
}

async function crawleeClasses() {
  const crawlee = await import('@crawlee/basic');
  return { BasicCrawler: crawlee.BasicCrawler, GotScrapingHttpClient: crawlee.GotScrapingHttpClient };
}

test('crawlSite runs through Crawlee BasicCrawler: one page at a time, no retry, no session pool, no proxy, no robots fetch of its own', async t => {
  const { BasicCrawler, GotScrapingHttpClient } = await crawleeClasses();
  const run = t.mock.method(BasicCrawler.prototype, 'run');
  // Crawlee measures memory with a process listing unless told the ceiling; a crawl starts no process at all.
  const spawned = (['spawn', 'exec', 'execFile', 'execSync', 'execFileSync', 'spawnSync', 'fork'] as const).map(name => t.mock.method(childProcess, name));
  const { sent, send } = sender(bigSite('leaf.example'));
  const crawl = await crawlSite('https://leaf.example/', { net: { resolve, send }, cache: createPageCache(), maxPages: 3, maxDepth: 1 });
  assert.equal(run.mock.callCount(), 1, 'the crawl ran on BasicCrawler');
  assert.deepEqual(spawned.map(mock => mock.mock.callCount()), [0, 0, 0, 0, 0, 0, 0], 'no process started');
  assert.deepEqual(crawl.pages.map(item => item.url), ['https://leaf.example/', 'https://leaf.example/p0', 'https://leaf.example/p1']);

  const crawler = run.mock.calls[0].this as any;
  assert.equal(crawler instanceof BasicCrawler, true);
  assert.equal(crawler.useSessionPool, false, 'no session pool, so no session rotation');
  assert.equal(crawler.sessionPool, undefined);
  assert.equal(crawler.proxyConfiguration, undefined, 'no proxy');
  assert.equal(crawler.respectRobotsTxtFile, false, "robots.txt is read by Chausar's own reader, not by Crawlee's HTTP client");
  assert.equal(crawler.maxRequestRetries, 0, 'never retried');
  assert.equal(crawler.sameDomainDelayMillis, 0, "the pace is the polite reader's, not a second one");
  assert.equal(crawler.autoscaledPoolOptions.minConcurrency, 1);
  assert.equal(crawler.autoscaledPoolOptions.maxConcurrency, 1, 'one page at a time');
  assert.ok(!(crawler.httpClient instanceof GotScrapingHttpClient), 'Crawlee never gets its got-scraping client');
  await assert.rejects(crawler.httpClient.sendRequest({ url: 'https://leaf.example/' }), (error: any) => error.code === 'FETCH_POLICY_REFUSED');
  await assert.rejects(crawler.httpClient.stream({ url: 'https://leaf.example/' }), (error: any) => error.code === 'FETCH_POLICY_REFUSED');
  assert.deepEqual((reader as Record<string, unknown>).CRAWLER_SETTINGS, { minConcurrency: 1, maxConcurrency: 1, maxRequestRetries: 0, useSessionPool: false, respectRobotsTxtFile: false, sameDomainDelaySecs: 0, requestHandlerTimeoutSecs: 300 });

  // Every request went out as Chausar, through the polite reader, robots.txt first.
  assert.equal(sent[0].url.href, 'https://leaf.example/robots.txt');
  for (const target of sent) assert.match(target.headers['user-agent'], /^Chausar\//);
  for (const target of sent) assert.doesNotMatch(Object.keys(target.headers).join(' '), /sec-ch-ua|sec-fetch|x-forwarded|via/i, 'no generated browser headers');
  assert.deepEqual(loaded.filter(name => BANNED.test(name)), [], 'no got-scraping, header generator or fingerprint generator was loaded');
  assert.ok(loaded.some(name => name === '@crawlee/basic'), 'the record covers the Crawlee load');
});

test('the same limits through Crawlee: at most ten pages, at most two links deep, own site only, a bad request refused before Crawlee starts', async t => {
  const { BasicCrawler } = await crawleeClasses();
  const run = t.mock.method(BasicCrawler.prototype, 'run');
  const site = bigSite('big.example');
  site['https://big.example/'] = { status: 200, body: page('Home', ['https://other.example/x', ...Array.from({ length: 15 }, (_, i) => `/p${i}`)]) };
  const { sent, send } = sender(site);
  const ten = await crawlSite('https://big.example/', { net: { resolve, send }, cache: createPageCache(), maxPages: CRAWL_LIMITS.maxPages, maxDepth: CRAWL_LIMITS.maxDepth });
  assert.equal(ten.pages.length, 10);
  assert.ok(sent.every(target => target.url.hostname === 'big.example'), 'never leaves the site');
  assert.equal(sent.filter(target => target.url.pathname !== '/robots.txt').length, 10, 'stops reading at ten pages');

  // A chain of pages, each one link further down.
  const narrow = sender({
    'https://deep.example/robots.txt': { status: 404 },
    'https://deep.example/': { status: 200, body: page('Home', ['/a']) },
    'https://deep.example/a': { status: 200, body: page('A', ['/a/b']) },
    'https://deep.example/a/b': { status: 200, body: page('B', ['/a/b/c']) },
    'https://deep.example/a/b/c': { status: 200, body: page('C', []) },
  });
  const two = await crawlSite('https://deep.example/', { net: { resolve, send: narrow.send }, cache: createPageCache(), maxPages: 10, maxDepth: 2 });
  assert.deepEqual(two.pages.map(item => item.url), ['https://deep.example/', 'https://deep.example/a', 'https://deep.example/a/b'], 'two links deep and no further');
  const zero = await crawlSite('https://deep.example/', { net: { resolve, send: narrow.send }, cache: createPageCache(), maxPages: 10, maxDepth: 0 });
  assert.deepEqual(zero.pages.map(item => item.url), ['https://deep.example/']);
  // A name that leads inside this computer's network is skipped by the reader's network guard; nothing is sent.
  const inside = sender({});
  const local = await crawlSite('https://inside.example/', { net: { resolve: async () => [{ address: '10.0.0.5', family: 4 as const }], send: inside.send }, cache: createPageCache() });
  assert.deepEqual(local, { pages: [], skipped: [{ url: 'https://inside.example/', code: 'NET_ADDRESS_REFUSED' }], stopped: null });
  assert.equal(inside.sent.length, 0);
  assert.equal(run.mock.callCount(), 4, 'each crawl ran on BasicCrawler');

  const before = run.mock.callCount();
  await assert.rejects(crawlSite('https://deep.example/', { net: { resolve, send: narrow.send }, maxPages: 11 }), (error: any) => error.code === 'INVALID_VENTURE_REQUEST');
  await assert.rejects(crawlSite('https://deep.example/', { net: { resolve, send: narrow.send }, maxDepth: 3 }), (error: any) => error.code === 'INVALID_VENTURE_REQUEST');
  await assert.rejects(crawlSite('https://www.linkedin.com/company/x', { net: { resolve, send: narrow.send } }), (error: any) => error.code === 'FETCH_POLICY_REFUSED');
  await assert.rejects(crawlSite('http://192.168.1.10/', { net: { resolve, send: narrow.send } }), (error: any) => error.code === 'NET_ADDRESS_REFUSED');
  assert.equal(run.mock.callCount(), before, 'refused before Crawlee starts');
});

test("Crawlee's storage stays in memory in a temporary folder that is removed, even when CRAWLEE_ settings ask for disk; nothing carries over", async t => {
  const { BasicCrawler } = await crawleeClasses();
  const run = t.mock.method(BasicCrawler.prototype, 'run');
  const work = await mkdtemp(join(tmpdir(), 'chausar-crawl-test-'));
  const storage = join(work, 'storage');
  await mkdir(join(storage, 'request_queues', 'default'), { recursive: true });
  await mkdir(join(storage, 'key_value_stores', 'default'), { recursive: true });
  await writeFile(join(storage, 'request_queues', 'default', 'keep.json'), '{}');
  await writeFile(join(storage, 'key_value_stores', 'default', 'INPUT.json'), '{}');
  const saved = { cwd: process.cwd(), env: { ...process.env } };
  const tempBefore = (await readdir(tmpdir())).filter(name => name.startsWith('chausar-crawl-') && !name.startsWith('chausar-crawl-test-'));
  const printed: unknown[] = [];
  const quiet = (...args: unknown[]) => { printed.push(args); };
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error, write: process.stdout.write };
  try {
    process.chdir(work);
    process.env.CRAWLEE_PERSIST_STORAGE = 'true';
    process.env.CRAWLEE_PURGE_ON_START = 'true';
    process.env.CRAWLEE_STORAGE_DIR = storage;
    console.log = console.info = console.warn = console.error = quiet;
    const site = {
      'https://leaf.example/robots.txt': ROBOTS,
      'https://leaf.example/': { status: 200, body: page('Home', ['/a', '/b']) },
      'https://leaf.example/a': { status: 200, body: page('A', []) },
      'https://leaf.example/b': { status: 200, body: page('B', []) },
    };
    const first = sender(site);
    const one = await crawlSite('https://leaf.example/', { net: { resolve, send: first.send }, cache: createPageCache(), maxPages: 3, maxDepth: 1 });
    const second = sender(site);
    const two = await crawlSite('https://leaf.example/', { net: { resolve, send: second.send }, cache: createPageCache(), maxPages: 3, maxDepth: 1 });
    assert.deepEqual(two.pages.map(item => item.url), one.pages.map(item => item.url), 'the second crawl starts from nothing');
    assert.equal(two.pages.length, 3);
    assert.equal(second.sent.length, first.sent.length, 'the second crawl read every page again: no queue was kept');
    assert.equal(run.mock.callCount(), 2, 'both crawls ran on BasicCrawler');
  } finally {
    Object.assign(console, { log: original.log, info: original.info, warn: original.warn, error: original.error });
    process.chdir(saved.cwd);
    for (const key of ['CRAWLEE_PERSIST_STORAGE', 'CRAWLEE_PURGE_ON_START', 'CRAWLEE_STORAGE_DIR']) {
      if (saved.env[key] === undefined) delete process.env[key]; else process.env[key] = saved.env[key];
    }
  }
  try {
    assert.deepEqual(printed, [], 'Crawlee printed nothing');
    assert.deepEqual((await readdir(work)).sort(), ['storage'], 'nothing new where the crawl ran');
    assert.deepEqual((await readdir(storage)).sort(), ['key_value_stores', 'request_queues']);
    assert.deepEqual(await readdir(join(storage, 'request_queues', 'default')), ['keep.json'], 'an existing Crawlee folder is never purged or written');
    assert.deepEqual(await readdir(join(storage, 'key_value_stores', 'default')), ['INPUT.json']);
    const tempAfter = (await readdir(tmpdir())).filter(name => name.startsWith('chausar-crawl-') && !name.startsWith('chausar-crawl-test-'));
    assert.deepEqual(tempAfter.sort(), tempBefore.sort(), "the crawl's temporary folder is gone");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('a CAPTCHA or a request to slow down still stops the whole crawl at once through Crawlee', async () => {
  const guarded = sender({
    'https://guard.example/robots.txt': { status: 404 },
    'https://guard.example/': { status: 200, body: page('Home', ['/a', '/b']) },
    'https://guard.example/a': { status: 429, body: 'slow down', headers: { 'content-type': 'text/plain', 'retry-after': '120' } },
    'https://guard.example/b': { status: 200, body: page('B', []) },
  });
  const paused = await crawlSite('https://guard.example/', { net: { resolve, send: guarded.send }, cache: createPageCache(), maxPages: 5 });
  assert.equal(paused.stopped, 'SITE_PAUSED');
  assert.deepEqual(paused.pages.map(item => item.url), ['https://guard.example/']);
  assert.ok(!guarded.sent.some(target => target.url.pathname === '/b'), 'nothing more after the site asked to slow down');
});
