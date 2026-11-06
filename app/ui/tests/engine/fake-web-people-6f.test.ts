import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import type { PeopleLookupView, PeopleSearchView, WebReadView, WebSearchView } from '../../src/engine/types';
import { webSearchViewOf } from '../../../../platform/runtime/venture/web/search-data';
import { peopleQuoteOf, peopleViewOf } from '../../../../platform/runtime/venture/people/people-data';

/**
 * The fake engine answers web search (6F3) and people search (6F8) as the engine does: the same request checks, view,
 * consent digest and exact lookup digest, taken from the engine's own pure files; it keeps only a key's last four
 * characters, reads no page and asks no service.
 */
const NOW = '2026-11-01T10:00:00.000Z';
const KEY = ['synthetic', 'fake', 'key', '4242'].join('-');
const ask = <T>(engine: FakeEngine, method: string, params: Record<string, unknown> = {}) => engine.request(method, params) as Promise<T>;

describe('fake engine: web search and the page reader (6F3)', () => {
  it('the view and a saved key match the engine; the checks refuse the same way', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const view = await ask<WebSearchView>(engine, 'venture.web.search');
    expect(view).toEqual(webSearchViewOf({ codex: 'research', claude: 'research' }, null));
    const brave = view.providers.find((item) => item.id === 'brave')!;
    await expect(ask(engine, 'venture.web.search', { provider: 'brave', key: KEY, consentDigest: 'stale' })).rejects.toMatchObject({ code: 'CONSENT_CHANGED' });
    await expect(ask(engine, 'venture.web.search', { provider: 'duckduckgo', key: KEY, consentDigest: brave.consentDigest })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Choose Brave Search, Exa or Tavily.' });
    await expect(ask(engine, 'venture.web.search', { extra: 1 })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Send the required fields and nothing else.' });
    const saved = await ask<WebSearchView>(engine, 'venture.web.search', { provider: 'brave', key: KEY, consentDigest: brave.consentDigest });
    expect(saved.key).toMatchObject({ provider: 'brave', keyHint: '4242', label: 'fixture-tested' });
    expect(JSON.stringify(saved)).not.toContain(KEY);
    expect((await ask<WebSearchView>(engine, 'venture.web.search', { provider: null })).key).toBeNull();
  });

  it('a read checks the address as the engine does and labels the sample page', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await expect(ask(engine, 'venture.web.read', { url: 'https://www.linkedin.com/in/x' })).rejects.toMatchObject({ code: 'FETCH_POLICY_REFUSED' });
    await expect(ask(engine, 'venture.web.read', { url: 'http://127.0.0.1/' })).rejects.toMatchObject({ code: 'NET_ADDRESS_REFUSED' });
    const page = await ask<WebReadView>(engine, 'venture.web.read', { url: 'https://leaf.example/tea#top' });
    expect(page).toMatchObject({ url: 'https://leaf.example/tea', via: 'page', label: 'From a public page, not confirmed', more: false });
    expect(page.line).toMatch(/^Read \d+ words\.$/);
  });
});

describe('fake engine: people search (6F8)', () => {
  it('services, keys, the exact lookup and its approval match the engine', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    expect(await ask<PeopleSearchView>(engine, 'venture.people.services')).toEqual(peopleViewOf({}));
    await expect(ask(engine, 'venture.people.lookup', { service: 'probe42', query: 'Sample Tea' })).rejects.toMatchObject({ code: 'PEOPLE_KEY_MISSING' });
    await expect(ask(engine, 'venture.people.services', { service: 'tofler', key: KEY })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    const saved = await ask<PeopleSearchView>(engine, 'venture.people.services', { service: 'probe42', key: KEY });
    expect(saved.services.find((item) => item.id === 'probe42')!.saved).toEqual({ keyHint: '4242', savedAt: NOW });
    await expect(ask(engine, 'venture.people.lookup', { service: 'probe42', query: 'https://linkedin.com/company/x' })).rejects.toMatchObject({ code: 'PEOPLE_LINKEDIN_REFUSED' });
    const quote = await ask<PeopleLookupView>(engine, 'venture.people.lookup', { service: 'probe42', query: 'Sample Tea' });
    expect(quote.quote).toEqual({ query: 'Sample Tea', ...peopleQuoteOf('probe42', 'Sample Tea', null, null, '2026-11-01') });
    await expect(ask(engine, 'venture.people.lookup', { service: 'probe42', query: 'Sample Tea', digest: 'other' })).rejects.toMatchObject({ code: 'APPROVAL_CHANGED' });
    const done = await ask<PeopleLookupView>(engine, 'venture.people.lookup', { service: 'probe42', query: 'Sample Tea', digest: quote.quote!.digest });
    expect(done).toMatchObject({ state: 'done', label: 'From Probe42 (MCA records), not confirmed' });
    await ask(engine, 'venture.people.services', { service: 'happenstance', key: KEY });
    const search = await ask<PeopleLookupView>(engine, 'venture.people.lookup', { service: 'happenstance', query: 'tea founders in Pune' });
    expect(search.quote!.line).toContain('2 credits');
    const running = await ask<PeopleLookupView>(engine, 'venture.people.lookup', { service: 'happenstance', query: 'tea founders in Pune', digest: search.quote!.digest });
    expect(running.state).toBe('running');
    const results = await ask<PeopleLookupView>(engine, 'venture.people.lookup', { service: 'happenstance', searchId: running.searchId });
    expect(results.state).toBe('done');
    expect(JSON.stringify(results).toLowerCase()).not.toContain('linkedin');
  });
});
