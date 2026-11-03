// Wave 6 package 6F3 (D32): web search. The AI tool's own web search comes first (Codex web search, Claude Code's
// WebSearch and WebFetch), on for research playbooks in the saved AI settings, with nothing to set up. An owner on a plain
// AI key may add their own Brave, Exa or Tavily key: saved in the computer's protected key storage (the same port as
// model keys), never in the business file, after a consent that names the provider and what is sent to it. The key then
// gives Chausar's own lookups (a network search's outside pages, Before you write) their web search. The requests follow
// each provider's public API docs; no key exists here, so every provider is fixture-tested and labelled so.
// No DuckDuckGo scraping: only the three keyed APIs.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PinnedTarget } from '../runtime/venture/core/net-guard.ts';
import { SEARCH_PROVIDERS, searchPort, webSearchHandler, savedWebSearch, type WebSearchView } from '../runtime/venture/web/search.ts';
import { goalBusiness } from './venture-goals-helpers.ts';
import { code, owner, phone } from './venture-views-env.ts';

const resolve = async () => [{ address: '142.250.1.10', family: 4 as const }];
const KEY = ['synthetic', 'search', 'key', 'value', '0042'].join('-');

function api(status: number, body: unknown) {
  const sent: PinnedTarget[] = [];
  const send = async (target: PinnedTarget) => { sent.push(target); return { status, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(body)) }; };
  return { sent, send };
}
const bodyOf = (target: PinnedTarget) => JSON.parse(Buffer.from(target.body as Uint8Array | string).toString('utf8'));

function memoryCredentials() {
  const saved = new Map<string, string>();
  return { saved, port: { async get(scope: string, name: string) { return saved.get(`${scope}/${name}`) ?? null; }, async set(scope: string, name: string, value: string) { saved.set(`${scope}/${name}`, value); }, async delete(scope: string, name: string) { saved.delete(`${scope}/${name}`); } } };
}

test('only Brave, Exa and Tavily, each fixture-tested on the owner\'s own key; no scraped search engine', () => {
  assert.deepEqual(SEARCH_PROVIDERS.map(item => item.id), ['brave', 'exa', 'tavily']);
  for (const provider of SEARCH_PROVIDERS) {
    assert.equal(provider.label, 'fixture-tested');
    assert.match(provider.keyPage, /^https:\/\//);
    assert.match(provider.docs, /^https:\/\//);
  }
  assert.ok(!SEARCH_PROVIDERS.some(item => /duckduckgo|google|bing/i.test(item.id + item.name)));
});

test('Brave: GET web/search with the subscription token header, results from web.results', async () => {
  const { sent, send } = api(200, { web: { results: [
    { title: 'Leaf Co tea guide', url: 'https://leaf.example/tea', description: 'How to brew green tea.' },
    { title: 'Bad', url: 'javascript:alert(1)', description: 'x' },
    { title: 'Leaf Co tea guide again', url: 'https://leaf.example/tea', description: 'dup' },
    { title: 'Inside', url: 'http://127.0.0.1/admin', description: 'private' },
  ] } });
  const found = await searchPort('brave', KEY, { resolve, send }).search('green tea guide', { limit: 5 });
  assert.equal(sent.length, 1);
  const target = sent[0]!;
  assert.equal(target.method, 'GET');
  assert.equal(target.url.origin + target.url.pathname, 'https://api.search.brave.com/res/v1/web/search');
  assert.equal(target.url.searchParams.get('q'), 'green tea guide');
  assert.equal(target.url.searchParams.get('count'), '5');
  assert.equal(target.headers['x-subscription-token'], KEY);
  assert.match(target.headers['user-agent'], /^Chausar\//);
  assert.deepEqual(found, [{ url: 'https://leaf.example/tea', title: 'Leaf Co tea guide', snippet: 'How to brew green tea.' }]);
});

test('Exa: POST search with x-api-key and highlights, snippet from the first highlight', async () => {
  const { sent, send } = api(200, { requestId: 'r1', results: [{ title: 'Tea notes', url: 'https://notes.example/tea', highlights: ['Brew at eighty degrees.'], id: 'x' }] });
  const found = await searchPort('exa', KEY, { resolve, send }).search('tea', { limit: 3 });
  const target = sent[0]!;
  assert.equal(target.method, 'POST');
  assert.equal(target.url.href, 'https://api.exa.ai/search');
  assert.equal(target.headers['x-api-key'], KEY);
  assert.deepEqual(bodyOf(target), { query: 'tea', type: 'auto', numResults: 3, contents: { highlights: true } });
  assert.deepEqual(found, [{ url: 'https://notes.example/tea', title: 'Tea notes', snippet: 'Brew at eighty degrees.' }]);
});

test('Tavily: POST search with a bearer key and basic depth, snippet from content', async () => {
  const { sent, send } = api(200, { query: 'tea', results: [{ title: 'Tea', url: 'https://t.example/', content: 'All about tea.', score: 0.9 }] });
  const found = await searchPort('tavily', KEY, { resolve, send }).search('tea', { limit: 25 });
  const target = sent[0]!;
  assert.equal(target.url.href, 'https://api.tavily.com/search');
  assert.equal(target.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(bodyOf(target), { query: 'tea', search_depth: 'basic', max_results: 20, include_answer: false });
  assert.deepEqual(found, [{ url: 'https://t.example/', title: 'Tea', snippet: 'All about tea.' }]);
});

test('a provider that refuses says so in plain words without the key, and never retries', async () => {
  const { sent, send } = api(401, { error: `bad key ${KEY}` });
  await assert.rejects(searchPort('brave', KEY, { resolve, send }).search('tea', { limit: 3 }), (error: any) => {
    assert.equal(error.code, 'WEB_SEARCH_FAILED');
    assert.ok(!error.message.includes(KEY));
    assert.match(error.message, /Brave/);
    return true;
  });
  assert.equal(sent.length, 1);
});

test('the view: the AI tool\'s own search first, no key yet, and each provider with its consent', async () => {
  const env = await goalBusiness();
  const view = await webSearchHandler(env.deps, owner, {}) as WebSearchView;
  assert.equal(view.builtIn.codex, 'research');
  assert.equal(view.builtIn.claude, 'research');
  assert.match(view.builtIn.line, /own web search/);
  assert.equal(view.key, null);
  assert.equal(view.providers.length, 3);
  for (const provider of view.providers) {
    assert.match(provider.consent, new RegExp(provider.name));
    assert.match(provider.consentDigest, /^[0-9a-f]{64}$/);
  }
  assert.equal(await savedWebSearch(env.deps), null);
});

test('saving a key needs the app, the consent shown and protected storage; the key never reaches the business file', async () => {
  const env = await goalBusiness();
  const view = await webSearchHandler(env.deps, owner, {}) as WebSearchView;
  const brave = view.providers.find(item => item.id === 'brave')!;
  await assert.rejects(webSearchHandler(env.deps, owner, { provider: 'brave', key: KEY, consentDigest: brave.consentDigest }), code('CREDENTIAL_UNAVAILABLE'));
  const keys = memoryCredentials();
  env.deps.credentials = keys.port;
  await assert.rejects(webSearchHandler(env.deps, phone, { provider: 'brave', key: KEY, consentDigest: brave.consentDigest }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(webSearchHandler(env.deps, owner, { provider: 'brave', key: KEY, consentDigest: 'stale' }), code('CONSENT_CHANGED'));
  await assert.rejects(webSearchHandler(env.deps, owner, { provider: 'duckduckgo', key: KEY, consentDigest: brave.consentDigest }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(webSearchHandler(env.deps, owner, { provider: 'brave', key: 'short', consentDigest: brave.consentDigest }), code('INVALID_VENTURE_REQUEST'));
  const saved = await webSearchHandler(env.deps, owner, { provider: 'brave', key: KEY, consentDigest: brave.consentDigest }) as WebSearchView;
  assert.deepEqual({ provider: saved.key?.provider, keyHint: saved.key?.keyHint }, { provider: 'brave', keyHint: '0042' });
  assert.equal(keys.saved.size, 1);
  assert.ok([...keys.saved.keys()][0]!.endsWith('/search:brave'));
  assert.ok(!JSON.stringify(env.store.read()).includes(KEY));

  // The saved key gives Chausar's own lookups their search, on the guarded network.
  const { sent, send } = api(200, { web: { results: [{ title: 'Tea', url: 'https://t.example/', description: 'Tea.' }] } });
  env.deps.net = { resolve, send };
  const port = await savedWebSearch(env.deps);
  assert.ok(port);
  assert.equal((await port.search('tea', { limit: 2 })).length, 1);
  assert.equal(sent[0]!.headers['x-subscription-token'], KEY);

  // A host-composed search stays first.
  const host = { search: async () => [] };
  env.deps.webSearch = host;
  assert.equal(await savedWebSearch(env.deps), host);
  delete env.deps.webSearch;

  const forgot = await webSearchHandler(env.deps, owner, { provider: null }) as WebSearchView;
  assert.equal(forgot.key, null);
  assert.equal(keys.saved.size, 0);
  assert.equal(await savedWebSearch(env.deps), null);
});

test('venture.web.read shows the owner what Chausar can read from one page; the JavaScript window is used on the desktop only', async () => {
  const { webRead, readerOptionsOf, READ_SHOWN } = await import('../runtime/venture/web/methods.ts');
  const env = await goalBusiness();
  const words = 'Green tea is best brewed at about eighty degrees, never boiling, for two or three minutes. ';
  const html = `<html><head><title>Tea</title></head><body><article><h1>Tea</h1><p>${words.repeat(80)}</p></article></body></html>`;
  const sent: PinnedTarget[] = [];
  env.deps.net = { resolve, send: async (target: PinnedTarget) => { sent.push(target); return target.url.pathname === '/robots.txt' ? { status: 404, headers: {} as Record<string, string>, body: Buffer.from('') } : { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(html) }; } };
  await assert.rejects(webRead(env.deps, phone, { url: 'https://leaf.example/tea' }), code('APP_APPROVAL_REQUIRED'));
  const view = await webRead(env.deps, owner, { url: 'https://leaf.example/tea' });
  assert.equal(view.title, 'Tea');
  assert.equal(view.text.length, READ_SHOWN);
  assert.equal(view.more, true);
  assert.equal(view.label, 'From a public page, not confirmed');
  assert.match(view.line, /^Read \d+ words\.$/);
  assert.equal(sent.length, 2);
  await assert.rejects(webRead(env.deps, owner, { url: 'https://www.linkedin.com/in/x' }), code('FETCH_POLICY_REFUSED'));
  const render = { render: async () => ({ ok: false as const, reason: 'failed' as const }) };
  assert.equal(readerOptionsOf({ ...env.deps, host: 'test', webRender: render }).render, undefined);
  assert.equal(readerOptionsOf({ ...env.deps, host: 'desktop', webRender: render }).render, render);
});

test('the desktop key contract accepts the three search key names and nothing like them', async () => {
  const { createRequire } = await import('node:module');
  const { validate } = createRequire(import.meta.url)('../runtime/venture/models/credential-contract.cjs');
  for (const name of ['search:brave', 'search:exa', 'search:tavily']) assert.doesNotThrow(() => validate('workspace_1', name, KEY, true), name);
  assert.throws(() => validate('workspace_1', 'search:duckduckgo', KEY, true));
});
