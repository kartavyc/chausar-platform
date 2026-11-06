// Wave 6 (6F8): the data of people search, pure (no Node imports), so the Ink app's fake engine answers from this same
// file: the services and their honest labels, the plain words, the view, and the exact lookup the owner approves.
import { ChausarError, check, digest } from '../../portable.ts';
import { digitCopy, screenReadback } from '../core/secrets.ts';
import type { KeyedPeopleServiceId, PeopleServiceId, PeopleSearchView, SavedPeopleKeys } from './people-types.ts';

export type PeopleService = { id: PeopleServiceId; name: string; covers: string; docs: string; planned: { waitsOn: string; meanwhile: string } | null };
export const PEOPLE_SERVICES: readonly PeopleService[] = Object.freeze([
  { id: 'happenstance', name: 'Happenstance', covers: 'People in your own network and your friends\' networks who could become clients.', docs: 'https://developer.happenstance.ai/', planned: null },
  { id: 'probe42', name: 'Probe42', covers: 'Indian company records from the MCA: name, CIN, status and when it was formed.', docs: 'https://apiportal.probe42.in/v1/', planned: null },
  { id: 'tofler', name: 'Tofler', covers: 'Indian company records and filings.', docs: 'https://www.tofler.in/',
    planned: { waitsOn: 'Waits on Tofler publishing API documentation Chausar can read.', meanwhile: 'Look the company up on the MCA website or tofler.in yourself.' } },
].map(item => Object.freeze(item as PeopleService)));

export const KEYED_PEOPLE: readonly KeyedPeopleServiceId[] = ['happenstance', 'probe42'];
export const isKeyedPeople = (id: unknown): id is KeyedPeopleServiceId => KEYED_PEOPLE.includes(id as KeyedPeopleServiceId);
export const PEOPLE_KEY = /^[\x21-\x7e]{8,512}$/;
export const PEOPLE_LINKEDIN = /linkedin\.|lnkd\.in/i;
export const PEOPLE_CIN = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
export const PEOPLE_LLPIN = /^[A-Z]{3}-\d{4}$/;
/** The lead desk's dated Happenstance price (playbooks/lead-generation/happenstance.ts happenstanceQuote; a test keeps them equal). */
export const HAPPENSTANCE_PRICE = Object.freeze({ credits: '2', checkedOn: '2026-10-27' });

export const PEOPLE_WORDS = Object.freeze({
  needs: 'fixture-tested, needs your key',
  line: 'Each service uses your own account and key. Nothing comes from LinkedIn.',
  linkedin: 'Chausar never looks anyone up through LinkedIn. Type a name or a company instead.',
  missing: 'Add your own key for this service first, under Connections.',
  happenstance: 'From Happenstance, your own network, not confirmed',
  probe42: 'From Probe42 (MCA records), not confirmed',
  quoteLine: 'Read the exact lookup before approving it.',
});

export function peopleViewOf(saved: SavedPeopleKeys | undefined): PeopleSearchView {
  const keys = saved ?? {};
  return {
    services: PEOPLE_SERVICES.map(item => ({
      id: item.id, name: item.name, covers: item.covers, docs: item.docs,
      label: item.planned ? 'planned' as const : 'fixture-tested' as const, needs: item.planned ? item.planned.waitsOn : PEOPLE_WORDS.needs,
      saved: isKeyedPeople(item.id) ? keys[item.id] ?? null : null, planned: item.planned,
    })),
    line: PEOPLE_WORDS.line,
  };
}

export type PeopleQuote = { line: string; digest: string };
/**
 * The exact lookup the owner approves, and its digest, bound to the client's permission when it is about a client and
 * to the owner's local day, so the same lookup runs at most once a day (the journal refuses an exact repeat).
 */
export function peopleQuoteOf(service: KeyedPeopleServiceId, query: string, clientId: string | null, consent: { consentId: string; consentRevision: number } | null, day: string, price: { credits: string; checkedOn: string } = HAPPENSTANCE_PRICE): PeopleQuote {
  const about = `${clientId ? ' It is about one of your clients, who allowed their data to be used.' : ''} The same lookup runs at most once a day.`;
  const line = service === 'happenstance'
    ? `Search Happenstance for "${query}" in your network and your friends' networks: ${price.credits} credits on your account, price checked ${price.checkedOn}.${about}`
    : `Look up "${query}" in Probe42's company records: one lookup on your Probe42 plan.${about}`;
  const extra = service === 'happenstance' ? { credits: price.credits, checkedOn: price.checkedOn } : {};
  return { line, digest: digest({ service, query, clientId, consent, day, line, ...extra }) };
}

// ---------------------------------------------------------------------------
// The request checks, shared by the engine (people/services.ts) and the fake, in the same order and words.
// ---------------------------------------------------------------------------

const fail = (code: string, message: string): never => { throw new ChausarError(code, message); };
function exactBody(value: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'INVALID_VENTURE_REQUEST', 'Send one request object.');
  const record = value as Record<string, unknown>;
  check(Object.keys(record).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(record, key)), 'INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  return record;
}
const LABELLED_ACCOUNT = /(?:\ba\/c|\bacc(?:oun)?t|\baccount|खाता)\s*(?:no\.?|number|num|#|संख्या|नंबर|नं\.?)?\s*[:-]?\s*\d(?:[\s./-]{0,2}\d){8,17}(?!\d)/iu;
/** The same test as agents/answer.ts holdsIdNumber: a card, bank account, Aadhaar or one-time code number. */
export function peopleIdNumber(text: string): boolean {
  return screenReadback(text).found.some(kind => kind === 'card' || kind === 'bank-account' || kind === 'aadhaar' || kind === 'otp') || LABELLED_ACCOUNT.test(digitCopy(text));
}

export type PeopleKeyChange = { kind: 'read' } | { kind: 'save'; service: KeyedPeopleServiceId; key: string | null };
/** venture.people.services: {} reads; { service, key } saves (key null removes). */
export function peopleKeyChange(payload: unknown): PeopleKeyChange {
  const body = exactBody(payload, ['service', 'key']);
  if (!Object.hasOwn(body, 'service')) { check(Object.keys(body).length === 0, 'INVALID_VENTURE_REQUEST', 'Choose a service first.'); return { kind: 'read' }; }
  check(isKeyedPeople(body.service), 'INVALID_VENTURE_REQUEST', 'Choose Happenstance or Probe42.');
  check(Object.hasOwn(body, 'key'), 'INVALID_VENTURE_REQUEST', 'Paste your key, or remove the saved one.');
  const name = body.service === 'happenstance' ? 'Happenstance' : 'Probe42';
  check(body.key === null || typeof body.key === 'string' && PEOPLE_KEY.test(body.key.trim()), 'INVALID_VENTURE_REQUEST', `Paste your ${name} API key.`);
  return { kind: 'save', service: body.service, key: body.key === null ? null : (body.key as string).trim() };
}

export const PEOPLE_SEARCH_ID = /^[\w-]{1,100}$/;
export type PeopleLookupAsk =
  | { kind: 'results'; service: 'happenstance'; searchId: string }
  | { kind: 'lookup'; service: KeyedPeopleServiceId; query: string; clientId: string | null; digest: string | null };
/** venture.people.lookup: a Happenstance search's results by id, or a lookup (quote without digest, run with it). */
export function peopleLookupAsk(payload: unknown): PeopleLookupAsk {
  const body = exactBody(payload, ['service', 'query', 'clientId', 'digest', 'searchId'], ['service']);
  check(isKeyedPeople(body.service), 'INVALID_VENTURE_REQUEST', 'Choose Happenstance or Probe42.');
  if (Object.hasOwn(body, 'searchId')) {
    check(body.service === 'happenstance' && !Object.hasOwn(body, 'query') && !Object.hasOwn(body, 'digest'), 'INVALID_VENTURE_REQUEST', 'Ask for one Happenstance search by its id.');
    check(typeof body.searchId === 'string' && PEOPLE_SEARCH_ID.test(body.searchId), 'INVALID_VENTURE_REQUEST', 'Ask for one Happenstance search by its id.');
    return { kind: 'results', service: 'happenstance', searchId: body.searchId };
  }
  check(typeof body.query === 'string' && body.query.trim().length >= 2 && body.query.length <= 300 && !/[\x00-\x1f]/.test(body.query), 'INVALID_VENTURE_REQUEST', 'Type the name or company to look up.');
  const query = body.query.replace(/\s*\u2014\s*/g, ', ').replace(/\s+/g, ' ').trim();
  if (PEOPLE_LINKEDIN.test(query)) fail('PEOPLE_LINKEDIN_REFUSED', PEOPLE_WORDS.linkedin);
  check(!/^https?:\/\//i.test(query), 'INVALID_VENTURE_REQUEST', 'Type a name or a company, not a web address.');
  check(!peopleIdNumber(query), 'INVALID_VENTURE_REQUEST', 'Leave card, bank account, Aadhaar and one-time code numbers out of a lookup.');
  check(body.clientId === undefined || typeof body.clientId === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(body.clientId), 'INVALID_VENTURE_REQUEST', 'Client must be a known identifier.');
  check(body.digest === undefined || typeof body.digest === 'string', 'INVALID_VENTURE_REQUEST', 'Approve the exact lookup shown.');
  return { kind: 'lookup', service: body.service, query, clientId: (body.clientId as string | undefined) ?? null, digest: (body.digest as string | undefined) ?? null };
}
