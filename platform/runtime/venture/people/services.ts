// Chausar venture launcher, people (wave 6, package 6F8, DECISIONS D37): people search on the owner's own keys.
// - Happenstance: people in the owner's own network and their friends' networks (its API: POST /v1/search, then GET
//   /v1/search/{id} for the results; two credits a search, as the lead desk's dated quote says).
// - Probe42: Indian company records from the MCA (its API: a company's base details by CIN, or a name search).
// - Tofler: planned. Tofler publishes no API documentation Chausar could read, so it waits on that, with the manual path.
// Keys go to the computer's protected storage (the host's credential port) under people:<service>; the business file
// keeps only the last four characters and when. A ChatGPT or Claude plan does not unlock these services.
// Every paid lookup is shown first, exactly, and runs only on the owner's approval of that exact lookup, through the
// action journal (connector.write); an unknown outcome is never retried. Reading Happenstance's results costs nothing.
// A lookup about a client needs that client's recorded permission (clients/ai-consent.ts), checked again at the send.
// Nothing comes from LinkedIn: a LinkedIn address is refused as a lookup, LinkedIn links in an answer are dropped and
// no answer link is ever opened. Answers are untrusted: a person's line with words aimed at the AI is held. Only the
// fields a pitch needs are kept and nothing is stored: the answer goes to the owner's screen.
// Requests follow the services' public API docs (Happenstance's OpenAPI; Probe42's API portal and its client notes);
// no key exists in this build's checks, so both say "Not tried live yet, needs your key".
import { authorize, check, ChausarError, type Context } from '../../contracts.ts';
import type { VentureDeps, VentureRecord } from '../contracts.ts';
import { guardedFetch, type NetResolver, type PinnedSender } from '../core/net-guard.ts';
import { CHAUSAR_USER_AGENT } from '../build/fetch-policy.ts';
import { digest, isAppChannel, readVenture, requireAppChannel, tidyWords, ventureAction } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { journalled } from '../journal/journal.ts';
import { requireClientAiConsent } from '../clients/ai-consent.ts';
import { screenUntrusted } from '../policy/untrusted.ts';
import { happenstanceQuote } from '../playbooks/lead-generation/happenstance.ts';
import type { CompanyFound, KeyedPeopleServiceId, PeopleLookupView, PeopleSearchView, PersonFound } from './people-types.ts';
import { PEOPLE_CIN, PEOPLE_LINKEDIN, PEOPLE_LLPIN, PEOPLE_WORDS, PEOPLE_SEARCH_ID, peopleKeyChange, peopleLookupAsk, peopleQuoteOf, peopleViewOf } from './people-data.ts';
export type { PeopleLookupView, PeopleSearchView } from './people-types.ts';

export { PEOPLE_SERVICES, PEOPLE_WORDS } from './people-data.ts';
export const PEOPLE_CREDENTIAL = (id: KeyedPeopleServiceId) => `people:${id}`;
const LINKEDIN = PEOPLE_LINKEDIN, CIN = PEOPLE_CIN, LLPIN = PEOPLE_LLPIN;
const SEARCH_ID = PEOPLE_SEARCH_ID;
const HAPPENSTANCE = 'https://api.happenstance.ai';
const PROBE42 = 'https://api.probe42.in/probe_pro';

type Net = { resolve?: NetResolver; send?: PinnedSender };

// ---------------------------------------------------------------------------
// The view and the keys
// ---------------------------------------------------------------------------

const viewOf = (venture: VentureRecord): PeopleSearchView => peopleViewOf(venture.peopleKeys);

/**
 * venture.people.services (approve; a change only inside the app). {} answers the view; { service, key } saves the
 * owner's own key in protected storage; { service, key: null } removes it.
 */
export async function peopleServices(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PeopleSearchView> {
  requireAppChannel(ctx, 'venture.people.services');
  authorize(deps.store, ctx, 'approve');
  const change = peopleKeyChange(payload);
  const { venture } = readVenture(deps, ctx);
  if (change.kind === 'read') return viewOf(venture);
  check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', 'Approve this inside the Chausar app.');
  const { service, key } = change;
  check(deps.credentials, 'CREDENTIAL_UNAVAILABLE', 'Protected key storage is unavailable on this computer.');
  const workspaceId = deps.store.read().workspace.id;
  if (key === null) await deps.credentials.delete(workspaceId, PEOPLE_CREDENTIAL(service));
  else await deps.credentials.set(workspaceId, PEOPLE_CREDENTIAL(service), key);
  return ventureAction(deps, ctx, 'approve', 'people.key', tx => {
    const keys = { ...(tx.venture!.peopleKeys ?? {}) };
    if (key === null) delete keys[service]; else keys[service] = { keyHint: key.slice(-4), savedAt: tx.now };
    tx.touch({ peopleKeys: keys });
    return viewOf({ ...tx.venture!, peopleKeys: keys });
  });
}

async function keyOf(deps: VentureDeps, service: KeyedPeopleServiceId): Promise<string> {
  let key: string | null = null;
  if (deps.credentials) { try { key = await deps.credentials.get(deps.store.read().workspace.id, PEOPLE_CREDENTIAL(service)); } catch { key = null; } }
  if (!key) throw new ChausarError('PEOPLE_KEY_MISSING', PEOPLE_WORDS.missing);
  return key;
}

// ---------------------------------------------------------------------------
// The answers
// ---------------------------------------------------------------------------

const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() ? tidyWords(value).slice(0, max) : null;

/** Happenstance's people, kept to what a pitch needs; LinkedIn links dropped; a line aimed at the AI is held. */
function peopleOf(body: any): { people: PersonFound[]; held: number } {
  const people: PersonFound[] = [];
  let held = 0;
  for (const row of Array.isArray(body?.results) ? body.results.slice(0, 50) : []) {
    const name = text(row?.name, 120);
    let url: URL | null = null;
    try { url = new URL(String(row?.socials?.happenstance_url ?? '')); } catch { url = null; }
    if (!name || !url || url.protocol !== 'https:' || (url.hostname !== 'happenstance.ai' && !url.hostname.endsWith('.happenstance.ai'))) continue;
    const person: PersonFound = { name, title: text(row?.current_title, 120), company: text(row?.current_company, 120), summary: text(row?.summary, 300), mutuals: Array.isArray(row?.mutuals) ? row.mutuals.length : 0, url: url.href };
    const words = [person.name, person.title, person.company, person.summary].filter(Boolean).join('\n');
    if (LINKEDIN.test(words) || screenUntrusted({ source: 'web-page', text: words }, { mode: 'enforce' }).text === null) { held += 1; continue; }
    people.push(person);
  }
  return { people, held };
}

/** Probe42's companies (and LLPs), kept to name, id, status, date formed, kind and state. */
function companiesOf(body: any): CompanyFound[] {
  const data = body?.data;
  const company = data?.company;
  if (company && typeof company === 'object') {
    const name = text(company.legal_name, 200), id = text(company.cin ?? company.llpin, 30);
    return name && id ? [{ name, id, status: text(company.efiling_status ?? company.status, 60), formed: text(company.incorporation_date, 20), kind: text(company.classification, 120), state: text(company.registered_address?.state, 60) }] : [];
  }
  const entities = data?.entities ?? {};
  const rows = [...(Array.isArray(entities.companies) ? entities.companies : []), ...(Array.isArray(entities.llps) ? entities.llps : [])];
  return rows.slice(0, 25).flatMap((row: any) => {
    const name = text(row?.legal_name, 200), id = text(row?.cin ?? row?.llpin, 30);
    return name && id ? [{ name, id, status: text(row?.status, 60), formed: null, kind: null, state: null }] : [];
  });
}

async function call(net: Net, url: string, method: 'GET' | 'POST', headers: Record<string, string>, body?: unknown) {
  return guardedFetch({ url, method, maxRedirects: 0, timeoutMs: 20_000, maxBytes: 1_000_000, headers: { ...headers, accept: 'application/json', 'user-agent': CHAUSAR_USER_AGENT, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, net);
}
const json = (answer: { body: Buffer }) => { try { return JSON.parse(answer.body.toString('utf8')); } catch { return null; } };

// ---------------------------------------------------------------------------
// The lookup
// ---------------------------------------------------------------------------

type Quote = { line: string; digest: string };

function quoteOf(deps: VentureDeps, venture: VentureRecord, service: KeyedPeopleServiceId, query: string, clientId: string | null, consent: { consentId: string; consentRevision: number } | null): Quote {
  // Happenstance's price is the lead desk's dated quote, refused once it is too old to trust (LEAD_RATE_STALE).
  const day = localDayAt(deps.clock(), venture.country);
  const price = service === 'happenstance' ? happenstanceQuote(query, day) : undefined;
  return peopleQuoteOf(service, query, clientId, consent, day, price);
}

/**
 * venture.people.lookup (approve, inside the app). { service, query, clientId? } answers the exact lookup to approve and
 * sends nothing; adding digest (that quote's) runs it once through the action journal. { service: 'happenstance',
 * searchId } reads a search's results, which costs nothing.
 */
export async function peopleLookup(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PeopleLookupView> {
  requireAppChannel(ctx, 'venture.people.lookup');
  authorize(deps.store, ctx, 'approve');
  const ask = peopleLookupAsk(payload);
  const service = ask.service;
  const { venture } = readVenture(deps, ctx);
  const net: Net = deps.net ?? {};
  const label = service === 'happenstance' ? PEOPLE_WORDS.happenstance : PEOPLE_WORDS.probe42;
  const base = { service, quote: null, searchId: null, label };

  if (ask.kind === 'results') {
    const key = await keyOf(deps, service);
    const answer = await call(net, `${HAPPENSTANCE}/v1/search/${encodeURIComponent(ask.searchId)}`, 'GET', { authorization: `Bearer ${key}` });
    const read = json(answer);
    check(answer.status === 200 && read, 'PEOPLE_LOOKUP_FAILED', 'Happenstance did not give this search. Open it on Happenstance.');
    const status = String(read.status ?? '').toUpperCase();
    if (status === 'RUNNING') return { ...base, state: 'running', searchId: ask.searchId, line: 'Happenstance is still searching. Look again in a minute.' };
    if (status !== 'COMPLETED') return { ...base, state: 'refused', searchId: ask.searchId, line: 'Happenstance could not finish this search.' };
    const { people, held } = peopleOf(read);
    return { ...base, state: 'done', searchId: ask.searchId, people, held, line: `${people.length} ${people.length === 1 ? 'person' : 'people'} from your network${held ? `; ${held} held back for words aimed at the AI` : ''}.` };
  }

  const { query, clientId } = ask;
  const consentNow = () => {
    if (!clientId) return null;
    const consent = requireClientAiConsent(deps.store.read(), venture.id, clientId);
    return { consentId: consent.id, consentRevision: consent.revision };
  };
  const consent = consentNow();
  await keyOf(deps, service);
  const quote = quoteOf(deps, venture, service, query, clientId, consent);
  if (ask.digest === null) return { ...base, state: 'quote', quote: { query, line: quote.line, digest: quote.digest }, line: PEOPLE_WORDS.quoteLine };
  check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', 'Approve this inside the Chausar app.');
  check(ask.digest === quote.digest, 'APPROVAL_CHANGED', 'Approve the exact lookup shown.');
  const key = await keyOf(deps, service);
  const done = await journalled<PeopleLookupView>(deps, ctx, {
    action: 'connector.write', operation: service === 'happenstance' ? 'happenstance-search' : 'probe42-lookup', subject: `${service}:${quote.digest}`,
    target: service === 'happenstance' ? 'Happenstance paid search' : 'Probe42 company lookup', actionDigest: quote.digest, line: quote.line, descriptionComplete: true, account: digest(key),
  }, async handle => {
    handle.fence(digest(key));
    // The client's permission again, right before anything leaves this computer.
    const now = consentNow();
    check(JSON.stringify(now) === JSON.stringify(consent), 'CLIENT_AI_CONSENT_CHANGED', 'This client\'s permission changed. Look again.');
    let answer;
    try {
      answer = service === 'happenstance'
        ? await call(net, `${HAPPENSTANCE}/v1/search`, 'POST', { authorization: `Bearer ${key}` }, { text: query, include_my_connections: true, include_friends_connections: true })
        : CIN.test(query.toUpperCase()) || LLPIN.test(query.toUpperCase())
          ? await call(net, `${PROBE42}/${CIN.test(query.toUpperCase()) ? 'companies' : 'llps'}/${encodeURIComponent(query.toUpperCase())}/base-details`, 'GET', { 'x-api-key': key, 'x-api-version': '1.3' })
          : await call(net, `${PROBE42}/entities?filters=${encodeURIComponent(JSON.stringify({ nameStartsWith: query }))}&limit=10`, 'GET', { 'x-api-key': key, 'x-api-version': '1.3' });
    } catch {
      return { outcome: 'unknown', line: `Check ${service === 'happenstance' ? 'Happenstance' : 'Probe42'} before trying again; the lookup may have used your plan.`, value: { ...base, state: 'unknown', line: `Chausar did not hear back. Check ${service === 'happenstance' ? 'Happenstance' : 'Probe42'} before trying again.` } };
    }
    const read = json(answer);
    if (answer.status >= 400 && answer.status < 500 && answer.status !== 408 && answer.status !== 429) {
      const words = answer.status === 404 ? 'Nothing was found for this lookup.' : `${service === 'happenstance' ? 'Happenstance' : 'Probe42'} refused the lookup. Check your key and plan.`;
      return { outcome: 'not-sent', line: words, value: { ...base, state: 'refused', line: words } };
    }
    if (answer.status !== 200 || !read) {
      const words = `Check ${service === 'happenstance' ? 'Happenstance' : 'Probe42'} before trying again; the lookup may have used your plan.`;
      return { outcome: 'unknown', line: words, value: { ...base, state: 'unknown', line: words } };
    }
    if (service === 'happenstance') {
      check(typeof read.id === 'string' && SEARCH_ID.test(read.id), 'PEOPLE_LOOKUP_FAILED', 'Check Happenstance for the search before trying again.');
      return { outcome: 'applied', by: 'platform', line: 'Happenstance started the search.', value: { ...base, state: 'running', searchId: read.id, line: 'Happenstance is searching. Look again in a minute.' } };
    }
    const companies = companiesOf(read);
    return { outcome: 'applied', by: 'platform', line: 'Probe42 answered the lookup.', value: { ...base, state: 'done', companies, line: companies.length ? `${companies.length} ${companies.length === 1 ? 'record' : 'records'} from Probe42.` : 'Nothing was found for this lookup.' } };
  }, { account: digest(key) });
  return done.value ?? { ...base, state: done.entry.state === 'applied' ? 'done' : 'unknown', line: 'Check the service before trying again.' };
}
