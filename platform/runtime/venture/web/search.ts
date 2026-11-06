// Chausar venture launcher, web (wave 6, package 6F3, DECISIONS D32): web search.
// - First, the AI tool's own web search: Codex web search, Claude Code's WebSearch and WebFetch. It is part of the
//   owner's plan, needs nothing set up, and is switched on for research playbooks in the saved AI settings
//   (agent-runtime/settings.ts webSearch 'research'; the drivers pass it on). This file only reports that setting.
// - For an owner on a plain AI key, or for Chausar's own lookups (a network search's outside pages, Before you write):
//   the owner's own Brave, Exa or Tavily key. It is saved in the computer's protected key storage (the host's credential
//   port, the same as model keys) under search:<provider>, never in the business file, and only after the owner agrees
//   to a consent that names the provider and what goes to it. The business file keeps which provider, the key's last
//   four characters and when. No DuckDuckGo or other scraped search engine: only these keyed APIs.
// - Each request goes through the network guard as Chausar, once, never retried. Results are only addresses, titles
//   and snippets; Chausar opens a result page only through its polite reader (web/reader.ts). Every provider follows its
//   public API docs; no key exists in this build's checks, so each is labelled fixture-tested.
import { authorize, check, ChausarError, type Context } from '../../contracts.ts';
import type { VentureDeps, VentureRecord, WebSearchPort } from '../contracts.ts';
import { checkUrl, guardedFetch, type NetResolver, type PinnedSender } from '../core/net-guard.ts';
import { CHAUSAR_USER_AGENT } from '../build/fetch-policy.ts';
import { isAppChannel, readVenture, requireAppChannel, tidyWords, ventureAction } from '../records.ts';
import { agentSettingsOf } from '../agent-runtime/settings.ts';
import type { SearchProviderId, WebSearchView } from './search-types.ts';
import { searchProviderOf, webSearchChange, webSearchViewOf } from './search-data.ts';
export type { SearchProviderId, WebSearchView, SavedSearchKey } from './search-types.ts';

export { SEARCH_PROVIDERS } from './search-data.ts';
const providerOf = searchProviderOf;
export const SEARCH_CREDENTIAL = (id: SearchProviderId) => `search:${id}`;
const NAME_OF: Record<SearchProviderId, string> = { brave: 'Brave', exa: 'Exa', tavily: 'Tavily' };

// ---------------------------------------------------------------------------
// The provider requests
// ---------------------------------------------------------------------------

type Net = { resolve?: NetResolver; send?: PinnedSender };
type Hit = { url: string; title: string; snippet: string };
const MAX_LIMIT = 20;

function request(id: SearchProviderId, key: string, query: string, limit: number): { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body?: string } {
  const json = { 'content-type': 'application/json', accept: 'application/json' };
  if (id === 'brave') {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query); url.searchParams.set('count', String(limit));
    return { url: url.href, method: 'GET', headers: { accept: 'application/json', 'x-subscription-token': key } };
  }
  if (id === 'exa') return { url: 'https://api.exa.ai/search', method: 'POST', headers: { ...json, 'x-api-key': key }, body: JSON.stringify({ query, type: 'auto', numResults: limit, contents: { highlights: true } }) };
  return { url: 'https://api.tavily.com/search', method: 'POST', headers: { ...json, authorization: `Bearer ${key}` }, body: JSON.stringify({ query, search_depth: 'basic', max_results: limit, include_answer: false }) };
}

/** The provider's results as address, title and snippet, before shaping. */
function rows(id: SearchProviderId, body: any): { url: unknown; title: unknown; snippet: unknown }[] {
  const list = id === 'brave' ? body?.web?.results : body?.results;
  if (!Array.isArray(list)) return [];
  return list.map((item: any) => ({
    url: item?.url, title: item?.title,
    snippet: id === 'brave' ? item?.description : id === 'exa' ? (Array.isArray(item?.highlights) ? item.highlights[0] : item?.summary ?? '') : item?.content,
  }));
}

/** A web search on the owner's own key for one provider, through the network guard as Chausar. Never retried. */
export function searchPort(id: SearchProviderId, key: string, net: Net = {}): WebSearchPort {
  const provider = providerOf(id);
  check(provider, 'INVALID_VENTURE_REQUEST', 'Choose Brave Search, Exa or Tavily.');
  return {
    async search(query, options) {
      check(typeof query === 'string' && query.trim().length > 0 && query.length <= 400, 'INVALID_VENTURE_REQUEST', 'Write what to search for.');
      const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(Number(options?.limit) || 10)));
      const asked = request(id, key, query.trim(), limit);
      let answer;
      try {
        answer = await guardedFetch({ url: asked.url, method: asked.method, headers: { ...asked.headers, 'user-agent': CHAUSAR_USER_AGENT }, ...(asked.body ? { body: asked.body } : {}), maxRedirects: 0, timeoutMs: 15_000, maxBytes: 2_000_000 }, net);
      } catch { throw new ChausarError('WEB_SEARCH_FAILED', `${NAME_OF[id]} did not answer the search. Try again later.`); }
      if (answer.status !== 200) throw new ChausarError('WEB_SEARCH_FAILED', `${NAME_OF[id]} refused the search. Check your key and plan with ${NAME_OF[id]}.`);
      let body: unknown;
      try { body = JSON.parse(answer.body.toString('utf8')); } catch { throw new ChausarError('WEB_SEARCH_FAILED', `${NAME_OF[id]} sent an answer Chausar could not read.`); }
      const hits: Hit[] = [];
      for (const row of rows(id, body)) {
        if (hits.length >= limit || typeof row.url !== 'string') continue;
        let url: URL;
        try { url = checkUrl(row.url); } catch { continue; }
        url.hash = '';
        if (hits.some(hit => hit.url === url.href)) continue;
        hits.push({ url: url.href, title: tidyWords(String(row.title ?? '')).slice(0, 200), snippet: tidyWords(String(row.snippet ?? '')).slice(0, 400) });
      }
      return hits;
    },
  };
}

// ---------------------------------------------------------------------------
// The saved key and the view
// ---------------------------------------------------------------------------

const ventureOf = (deps: VentureDeps): VentureRecord | undefined => deps.store.read().conversations.find(row => row?.kind === 'venture-record') as VentureRecord | undefined;

/**
 * The web search Chausar's own lookups use: the host's own if it composed one, else the owner's saved key, else null.
 * A key that protected storage no longer holds counts as none.
 */
export async function savedWebSearch(deps: VentureDeps): Promise<WebSearchPort | null> {
  if (deps.webSearch) return deps.webSearch;
  const saved = ventureOf(deps)?.webSearchKey;
  if (!saved || !deps.credentials || !providerOf(saved.provider)) return null;
  let key: string | null = null;
  try { key = await deps.credentials.get(deps.store.read().workspace.id, SEARCH_CREDENTIAL(saved.provider)); } catch { return null; }
  return key ? searchPort(saved.provider, key, deps.net ?? {}) : null;
}

function viewOf(deps: VentureDeps, venture: VentureRecord): WebSearchView {
  const settings = agentSettingsOf(deps.store.read(), venture.id);
  return webSearchViewOf({ codex: settings.codex.webSearch, claude: settings.claude.webSearch }, venture.webSearchKey);
}

/**
 * venture.web.search (approve; a change only inside the app). {} answers the view. { provider, key, consentDigest } saves
 * the owner's own key for that provider in protected storage after the consent shown; { provider: null } removes it.
 */
export async function webSearchHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<WebSearchView> {
  requireAppChannel(ctx, 'venture.web.search');
  authorize(deps.store, ctx, 'approve');
  const change = webSearchChange(payload);
  const { venture } = readVenture(deps, ctx);
  if (change.kind === 'read') return viewOf(deps, venture);
  check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', 'Approve this inside the Chausar app.');
  check(deps.credentials, 'CREDENTIAL_UNAVAILABLE', 'Protected key storage is unavailable on this computer.');
  const workspaceId = deps.store.read().workspace.id;
  const old = venture.webSearchKey?.provider;
  if (change.kind === 'forget') {
    if (old && providerOf(old)) await deps.credentials.delete(workspaceId, SEARCH_CREDENTIAL(old));
    return ventureAction(deps, ctx, 'approve', 'web.search.forget', tx => { tx.touch({ webSearchKey: null }); return viewOf(deps, { ...tx.venture!, webSearchKey: null }); });
  }
  const { provider, key, consentDigest } = change;
  await deps.credentials.set(workspaceId, SEARCH_CREDENTIAL(provider.id), key);
  if (old && old !== provider.id && providerOf(old)) await deps.credentials.delete(workspaceId, SEARCH_CREDENTIAL(old));
  return ventureAction(deps, ctx, 'approve', 'web.search.key', tx => {
    const saved = { provider: provider.id, keyHint: key.slice(-4), savedAt: tx.now, consentDigest };
    tx.touch({ webSearchKey: saved });
    return viewOf(deps, { ...tx.venture!, webSearchKey: saved });
  });
}
