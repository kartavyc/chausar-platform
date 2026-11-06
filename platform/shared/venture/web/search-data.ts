// Wave 6 (6F3): the data of web search, pure (no Node imports), so the Ink app's fake engine answers from this same file:
// the three keyed providers, the consent the owner agrees to before a key is saved, and the view.
import { check, digest } from '../../portable.ts';
import type { AiNetworkSetting, SavedSearchKey, SearchProviderId, WebSearchView } from '../../../contract/venture/web/search-types.ts';

export type SearchProvider = { id: SearchProviderId; name: string; label: 'fixture-tested'; keyPage: string; docs: string };
export const SEARCH_PROVIDERS: readonly SearchProvider[] = Object.freeze([
  { id: 'brave', name: 'Brave Search', label: 'fixture-tested', keyPage: 'https://api-dashboard.search.brave.com/', docs: 'https://api-dashboard.search.brave.com/app/documentation/web-search/get-started' },
  { id: 'exa', name: 'Exa', label: 'fixture-tested', keyPage: 'https://dashboard.exa.ai/', docs: 'https://docs.exa.ai/reference/search' },
  { id: 'tavily', name: 'Tavily', label: 'fixture-tested', keyPage: 'https://app.tavily.com/', docs: 'https://docs.tavily.com/documentation/api-reference/endpoint/search' },
].map(item => Object.freeze(item as SearchProvider)));

export const searchProviderOf = (id: unknown): SearchProvider | undefined => SEARCH_PROVIDERS.find(item => item.id === id);

/** What the owner agrees to before a key is saved: who gets the searches and what they hold. */
export function searchConsentOf(provider: SearchProvider): string {
  return `Chausar's own web lookups go to ${provider.name} with your own key: the words of a network search, and for Before you write a person's name and company. ${provider.name} handles them under its own terms. Chausar opens result pages itself, politely, and never LinkedIn. You can remove the key at any time.`;
}
export const searchConsentDigest = (provider: SearchProvider) => digest({ provider: provider.id, consent: searchConsentOf(provider) });

/** The view from the saved AI settings' web search choices and the saved key. */
export function webSearchViewOf(builtIn: { codex: AiNetworkSetting; claude: AiNetworkSetting }, saved: SavedSearchKey | null | undefined): WebSearchView {
  const on = builtIn.codex !== 'off' || builtIn.claude !== 'off';
  const provider = saved ? searchProviderOf(saved.provider) : undefined;
  return {
    builtIn: {
      codex: builtIn.codex, claude: builtIn.claude,
      line: on ? 'Your AI tool uses its own web search for research work. Nothing to set up.' : 'Your AI tool\'s own web search is off. Turn it on in Settings, AI.',
    },
    key: saved && provider ? { provider: saved.provider, name: provider.name, keyHint: saved.keyHint, savedAt: saved.savedAt, label: 'fixture-tested' } : null,
    providers: SEARCH_PROVIDERS.map(item => ({ id: item.id, name: item.name, label: item.label, keyPage: item.keyPage, consent: searchConsentOf(item), consentDigest: searchConsentDigest(item) })),
    line: saved && provider ? `Chausar's own lookups search with your ${provider.name} key.` : 'Chausar\'s own lookups have no web search yet. Add your own key if you want them.',
  };
}

/** The checks on a saved key, shared with the fake: printable, no spaces, 8 to 512 characters. */
export const SEARCH_KEY = /^[\x21-\x7e]{8,512}$/;

export type WebSearchChange = { kind: 'read' } | { kind: 'forget' } | { kind: 'save'; provider: SearchProvider; key: string; consentDigest: string };
/**
 * venture.web.search's request, checked the same way by the engine (web/search.ts) and the fake: {} reads; { provider:
 * null } removes the key; { provider, key, consentDigest } saves it after the consent shown.
 */
export function webSearchChange(payload: unknown): WebSearchChange {
  check(payload !== null && typeof payload === 'object' && !Array.isArray(payload) && [Object.prototype, null].includes(Object.getPrototypeOf(payload)), 'INVALID_VENTURE_REQUEST', 'Send one request object.');
  const body = payload as Record<string, unknown>;
  check(Object.keys(body).every(key => ['provider', 'key', 'consentDigest'].includes(key)), 'INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  if (!Object.hasOwn(body, 'provider')) { check(Object.keys(body).length === 0, 'INVALID_VENTURE_REQUEST', 'Choose a search provider first.'); return { kind: 'read' }; }
  if (body.provider === null) {
    check(!Object.hasOwn(body, 'key') && !Object.hasOwn(body, 'consentDigest'), 'INVALID_VENTURE_REQUEST', 'Remove the key without sending another.');
    return { kind: 'forget' };
  }
  const provider = searchProviderOf(body.provider);
  check(provider, 'INVALID_VENTURE_REQUEST', 'Choose Brave Search, Exa or Tavily.');
  check(typeof body.key === 'string' && SEARCH_KEY.test(body.key.trim()), 'INVALID_VENTURE_REQUEST', `Paste your ${provider.name} API key.`);
  check(body.consentDigest === searchConsentDigest(provider), 'CONSENT_CHANGED', 'Read what goes to the provider and agree again.');
  return { kind: 'save', provider, key: body.key.trim(), consentDigest: body.consentDigest as string };
}

/** The label every page Chausar's reader keeps carries (web/reader.ts READER_WORDS.label), and the read method's words. */
export const PAGE_LABEL = 'From a public page, not confirmed';
export const READ_WORDS = Object.freeze({ url: 'Paste the address of one public page.', hosted: 'Read pages in the desktop app.' });
/** The read method's line, from the reader's own counts. */
export function readLine(words: number, via: 'page' | 'javascript', cached: boolean): string {
  return `Read ${words} words${via === 'javascript' ? ' in the hidden desktop window' : ''}${cached ? ', kept from a read in the last half hour' : ''}.`;
}
