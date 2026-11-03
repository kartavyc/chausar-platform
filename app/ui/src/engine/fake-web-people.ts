/**
 * The fake engine's answers for web search, the page reader (wave 6, 6F3) and people search (6F8), in the engine's
 * shapes, codes, order and words. The request checks, the views, the consent and the exact lookup's digest come from
 * the engine's own pure files (web/search-data.ts, people/people-data.ts), so the two cannot drift. The fake keeps no
 * key (only the last four characters, as the business file does), reads no page and asks no service: a read gives a
 * sample page and a lookup sample records, each labelled as the engine labels them.
 */

import { EngineError } from './types';
import type { PeopleLookupView, PeopleSearchView, WebReadView, WebSearchView } from './types';
import type { W4DeskHost } from './fake-w4';
import { fakeCheckedFetchUrl } from './fake-kit-connect';
import { PAGE_LABEL, READ_WORDS, readLine, webSearchChange, webSearchViewOf } from '../../../../platform/runtime/venture/web/search-data';
import type { SavedSearchKey } from '../../../../platform/runtime/venture/web/search-types';
import { HAPPENSTANCE_PRICE, PEOPLE_CIN, PEOPLE_LLPIN, PEOPLE_WORDS, peopleKeyChange, peopleLookupAsk, peopleQuoteOf, peopleViewOf } from '../../../../platform/runtime/venture/people/people-data';
import type { SavedPeopleKeys } from '../../../../platform/runtime/venture/people/people-types';
import { COUNTRY_TIME_ZONES } from '../../../../platform/runtime/venture/local-day-data';

const METHODS = new Set(['venture.web.search', 'venture.web.read', 'venture.people.services', 'venture.people.lookup']);
const SAMPLE_PAGE = 'Sample page text. In this preview Chausar reads no page; the desktop app reads the page itself, politely, and keeps its main text.';

type Book = { webKey: SavedSearchKey | null; peopleKeys: SavedPeopleKeys };

/** A check from the engine's pure files, as the fake's own error. */
function engineChecked<T>(run: () => T): T {
  try { return run(); } catch (error) {
    if (error instanceof EngineError) throw error;
    const known = error as { code?: string; message?: string };
    throw new EngineError(known.code ?? 'INVALID_VENTURE_REQUEST', known.message ?? 'Send the required fields and nothing else.');
  }
}

export class FakeWebPeopleDesk {
  private readonly host: W4DeskHost;
  private readonly books = new Map<string, Book>();

  constructor(host: W4DeskHost) { this.host = host; }

  handles(method: string): boolean { return METHODS.has(method); }

  private book(): Book {
    const id = this.host.current();
    let book = this.books.get(id);
    if (!book) { book = { webKey: null, peopleKeys: {} }; this.books.set(id, book); }
    return book;
  }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'venture.web.search': return this.webSearch(p);
      case 'venture.web.read': return this.webRead(p);
      case 'venture.people.services': return this.peopleServices(p);
      case 'venture.people.lookup': return this.peopleLookup(p);
      default: throw new EngineError('NOT_BUILT_YET', 'This part of Chausar is not built yet.');
    }
  }

  /** The owner's local day, as the engine reads it (local-day.ts): the country's own time zone. */
  private localDay(): string {
    const venture = this.host.ask('venture.get', {}) as { venture?: { country?: { code?: string } | null } } | null;
    const code = venture?.venture?.country?.code ?? 'IN';
    return new Intl.DateTimeFormat('en-CA', { timeZone: COUNTRY_TIME_ZONES[code as keyof typeof COUNTRY_TIME_ZONES] ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(this.host.now()));
  }

  private builtIn(): { codex: 'off' | 'research' | 'on'; claude: 'off' | 'research' | 'on' } {
    try {
      const view = this.host.ask('venture.agentSettings.get', {}) as { settings?: { codex?: { webSearch?: string }; claude?: { webSearch?: string } } } | null;
      const pick = (value: unknown) => (value === 'off' || value === 'on' ? value : 'research');
      return { codex: pick(view?.settings?.codex?.webSearch), claude: pick(view?.settings?.claude?.webSearch) };
    } catch { return { codex: 'research', claude: 'research' }; }
  }

  private webSearch(p: Record<string, unknown>): WebSearchView {
    const change = engineChecked(() => webSearchChange(p));
    const book = this.book();
    if (change.kind === 'forget') book.webKey = null;
    if (change.kind === 'save') book.webKey = { provider: change.provider.id, keyHint: change.key.slice(-4), savedAt: this.host.now(), consentDigest: change.consentDigest };
    return webSearchViewOf(this.builtIn(), book.webKey);
  }

  private webRead(p: Record<string, unknown>): WebReadView {
    const keys = Object.keys(p);
    if (keys.length !== 1 || keys[0] !== 'url') throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
    if (typeof p.url !== 'string' || p.url.length > 2048) throw new EngineError('INVALID_VENTURE_REQUEST', READ_WORDS.url);
    if (this.host.hosted()) throw new EngineError('PRESET_UNAVAILABLE', READ_WORDS.hosted);
    const url = fakeCheckedFetchUrl(p.url.trim());
    url.hash = '';
    const words = (SAMPLE_PAGE.match(/\S+/g) ?? []).length;
    return { url: url.href, title: 'Sample page', siteName: null, text: SAMPLE_PAGE, words, more: false, via: 'page', label: PAGE_LABEL, line: readLine(words, 'page', false) };
  }

  private peopleServices(p: Record<string, unknown>): PeopleSearchView {
    const change = engineChecked(() => peopleKeyChange(p));
    const book = this.book();
    if (change.kind === 'save') {
      const keys = { ...book.peopleKeys };
      if (change.key === null) delete keys[change.service]; else keys[change.service] = { keyHint: change.key.slice(-4), savedAt: this.host.now() };
      book.peopleKeys = keys;
    }
    return peopleViewOf(book.peopleKeys);
  }

  private peopleLookup(p: Record<string, unknown>): PeopleLookupView {
    const ask = engineChecked(() => peopleLookupAsk(p));
    const service = ask.service;
    const label = service === 'happenstance' ? PEOPLE_WORDS.happenstance : PEOPLE_WORDS.probe42;
    const base = { service, quote: null, searchId: null, label };
    const book = this.book();
    if (ask.kind === 'results') {
      if (!book.peopleKeys.happenstance) throw new EngineError('PEOPLE_KEY_MISSING', PEOPLE_WORDS.missing);
      const people = [{ name: 'Sample Person', title: 'Founder', company: 'Sample Tea Co', summary: 'A sample record; the desktop app asks Happenstance with your key.', mutuals: 1, url: 'https://happenstance.ai/p/sample' }];
      return { ...base, state: 'done', searchId: ask.searchId, people, held: 0, line: '1 person from your network.' };
    }
    let consent: { consentId: string; consentRevision: number } | null = null;
    if (ask.clientId) {
      const view = this.host.ask('venture.client.aiConsent.get', { clientId: ask.clientId }) as { status: string; consent: { id: string; revision: number } | null };
      if (view.status !== 'agreed' || !view.consent) throw new EngineError('CLIENT_AI_CONSENT_REQUIRED', 'Allow this client’s data to reach your AI before starting their work.');
      consent = { consentId: view.consent.id, consentRevision: view.consent.revision };
    }
    if (!book.peopleKeys[service]) throw new EngineError('PEOPLE_KEY_MISSING', PEOPLE_WORDS.missing);
    if (service === 'happenstance') {
      const age = (Date.parse(`${this.host.now().slice(0, 10)}T00:00:00Z`) - Date.parse(`${HAPPENSTANCE_PRICE.checkedOn}T00:00:00Z`)) / 86_400_000;
      if (!(age >= 0 && age <= 90)) throw new EngineError('LEAD_RATE_STALE', 'Recheck Happenstance credit pricing before searching.');
    }
    const quote = peopleQuoteOf(service, ask.query, ask.clientId, consent, this.localDay());
    if (ask.digest === null) return { ...base, state: 'quote', quote: { query: ask.query, line: quote.line, digest: quote.digest }, line: PEOPLE_WORDS.quoteLine };
    if (ask.digest !== quote.digest) throw new EngineError('APPROVAL_CHANGED', 'Approve the exact lookup shown.');
    if (service === 'happenstance') return { ...base, state: 'running', searchId: 'srch_sample01', line: 'Happenstance is searching. Look again in a minute.' };
    const id = ask.query.toUpperCase();
    const companies = PEOPLE_CIN.test(id) || PEOPLE_LLPIN.test(id)
      ? [{ name: 'SAMPLE COMPANY PRIVATE LIMITED', id, status: 'Active', formed: '2015-04-01', kind: 'Private Limited Indian Non-Government Company', state: 'Karnataka' }]
      : [{ name: `${ask.query.toUpperCase()} PRIVATE LIMITED`, id: 'U00000KA2015PTC000000', status: 'Active', formed: null, kind: null, state: null }];
    return { ...base, state: 'done', companies, line: `${companies.length} record from Probe42.` };
  }
}
