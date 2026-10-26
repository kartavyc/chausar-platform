// Chausar venture launcher, network (Ink v2 wave 4): the network's engine methods. Package 4D1: the people list with
// "Same person?" suggestions, one person's sheet, the source cards, and the owner's merge, split and hide. The import
// and its undo live in import.ts, Forget in forget.ts. Later packages add their own methods here (4D2 recompute, know
// and link, at the end, and the bands on the source cards; 4D3 search).
import { check, type Context } from '../../contracts.ts';
import { NETWORK_IMPORT_KINDS } from '../contracts.ts';
import type {
  IsoDate, NetworkImportKind, NetworkRecompute, NetworkSourceCard, NetworkSourcesView, PeopleView, PersonFact, PersonRecord, PersonSplit, PersonSummary,
  PersonView, VentureDeps,
} from '../contracts.ts';
import { exactPayload, formatVentureDate, identifier, listRecords, readVenture, requireAppChannel, singleLine, ventureAction } from '../records.ts';
import { localDayAt, ownerToday } from '../local-day.ts';
import { listPeople, personById } from './store.ts';
import {
  absorb, byName, clientsByEmail, derive, hasIdentity, linkClient, mergeSuggestions, personView, repoint, sourceKey, summaries, writePeople,
} from './people.ts';
import { fold, plural } from './text.ts';
import { bandsNow, dropOlderBandCounts } from './bands.ts';
import { ownerFactId, recomputeTies, writeTies } from './strength.ts';
import { sumReceipt } from '../money/sums.ts';
import { redactSecrets } from '../core/secrets.ts';
import { personCardView } from './pipeline-methods.ts';
import { outreachView } from './outreach.ts';
import { mailboxOf, mailboxView } from './mailbox.ts';
import { calendarFeedOf, calendarView } from './calendar-feed.ts';
import { chatConsentState } from '../agents/consent.ts';

/** The most people one list answers with; total says how many matched. */
const LIST_LIMIT = 500;

/**
 * venture.network.people { query?, hidden?, suggestions?, limit? } (read): the people of the open business by name. Hidden
 * people only when hidden is true. query matches name, company, title and email. suggestions: the "Same person?"
 * pairs, which never come from a name alone. limit (4D4): at most this many summaries, 0 for the count alone.
 */
export async function networkPeople(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PeopleView> {
  const body = exactPayload(payload ?? {}, ['query', 'hidden', 'suggestions', 'limit']);
  check(body.limit === undefined || (Number.isSafeInteger(body.limit) && (body.limit as number) >= 0 && (body.limit as number) <= LIST_LIMIT),
    'INVALID_VENTURE_REQUEST', `limit is a whole number from 0 to ${LIST_LIMIT}.`);
  const limit = body.limit === undefined ? LIST_LIMIT : (body.limit as number);
  check(body.hidden === undefined || typeof body.hidden === 'boolean', 'INVALID_VENTURE_REQUEST', 'hidden is true or false.');
  check(body.suggestions === undefined || typeof body.suggestions === 'boolean', 'INVALID_VENTURE_REQUEST', 'suggestions is true or false.');
  const query = body.query === undefined || body.query === '' ? null : singleLine(body.query, 'The search', { min: 1, max: 200 });
  const { state, venture } = readVenture(deps, ctx);
  const everyone = listPeople(state, venture.id);
  const wanted = fold(query), lower = query?.toLowerCase() ?? '';
  const matched = byName(everyone.filter(person => person.hidden === (body.hidden === true)).filter(person => !query
    || fold(person.name).includes(wanted) || fold(person.role?.company).includes(wanted) || fold(person.role?.title).includes(wanted)
    || person.handles.emails.some(email => email.includes(lower))));
  // 4D4: the chat consent a search needs, when it is needed, so the Network tab can ask for it before the first search.
  const consent = chatConsentState(deps, ctx, state, venture).view;
  return {
    people: summaries(state, venture, matched.slice(0, limit)),
    suggestions: body.suggestions === true ? mergeSuggestions(everyone) : [],
    total: matched.length,
    consent: consent.state === 'needed' || consent.state === 'stale' ? consent : null,
  };
}

/** venture.network.person { id } (read): the person sheet, with every field Chausar keeps and its source row. */
export async function networkPerson(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PersonView> {
  const body = exactPayload(payload, ['id'], ['id']);
  const id = identifier(body.id, 'id');
  const { state, venture } = readVenture(deps, ctx);
  const person = personById(state, id);
  check(person && person.ventureId === venture.id, 'INVALID_VENTURE_REQUEST', 'This person is not in your network.');
  // card: 4E1. drafts (4E4): every draft to them or on their cards, newest first, so the screens open one after a reload.
  const cards = new Set(listRecords(state, 'venture-opportunity', venture.id).filter(item => item.personId === person.id).map(item => item.id));
  const drafts = listRecords(state, 'venture-outreach', venture.id)
    .filter(item => item.personId === person.id || (item.opportunityId !== null && cards.has(item.opportunityId)))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .map(item => outreachView(state, venture, item));
  return { ...personView(state, venture, person), card: personCardView(deps, state, venture, person.id), drafts };
}

const REFRESH: Readonly<Record<NetworkImportKind, string>> = Object.freeze({
  'linkedin-connections': 'Download a new copy to catch new connections.', 'linkedin-messages': 'Download a new copy to catch new messages.',
  'contacts-csv': 'Export a new copy to catch new contacts.', vcard: 'Export a new copy to catch new contacts.',
  'calendar-ics': 'Export a new copy to catch new meetings.', 'mail-headers': 'Export a new copy to catch new mail.',
});
/** A source card says its file is old once its newest copy is older than this many days. */
export const STALE_AFTER_DAYS = 60;

/** Whole calendar days from one day to another. */
const daysBetween = (from: IsoDate, to: IsoDate) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * venture.network.sources {} (read): one card per kind of file, from its newest import not undone: the file, the day,
 * how many people in the network have a fact from that kind, how much the newest copy dropped, and an age line once
 * that copy is older than 60 days. bands: how many people sit in each band, with the count receipt listing each tie
 * counted (4D2); null before any tie is worked out.
 */
export async function networkSources(deps: VentureDeps, ctx: Context, payload: unknown): Promise<NetworkSourcesView> {
  exactPayload(payload ?? {}, []);
  const { state, venture } = readVenture(deps, ctx);
  const imports = listRecords(state, 'venture-network-import', venture.id).filter(record => !record.undoneAt);
  const people = listPeople(state, venture.id);
  const today = ownerToday(deps.clock, venture.country);
  const sources: NetworkSourceCard[] = [];
  for (const kind of NETWORK_IMPORT_KINDS) {
    const ofKind = imports.filter(record => record.importKind === kind);
    if (!ofKind.length) continue;
    const newest = ofKind[ofKind.length - 1];
    const ids = new Set(ofKind.map(record => record.id));
    const kept = people.filter(person => person.facts.some(fact => fact.source.importId && ids.has(fact.source.importId))).length;
    const day = localDayAt(newest.at, venture.country);
    const age = daysBetween(day, today);
    sources.push({
      kind, fileName: newest.fileName, at: newest.at, kept, dropped: newest.dropped.reduce((sum, item) => sum + item.count, 0),
      line: `${plural(kept, 'person', 'people')}, imported ${formatVentureDate(day, venture.country.dateOrder)}.`, // 4D4: the card names the kind
      stale: age > STALE_AFTER_DAYS ? `Imported ${Math.floor(age / 30)} months ago. ${REFRESH[kind]}` : null,
    });
  }
  const bands = bandsNow(state, venture);
  const webSearch = deps.webSearch ? 'set-up' as const : 'not-set-up' as const; // 4D4
  // 4E4: the mailbox's and the calendar address's state, as their own methods answer it; the hosted app reads neither.
  const hosted = deps.host === 'hosted-web';
  const reads = {
    mailbox: hosted ? null : mailboxView(deps, venture, mailboxOf(state, venture.id)),
    calendar: hosted ? null : calendarView(deps, venture, calendarFeedOf(state, venture.id)),
  };
  if (!bands) return { sources, bands: null, webSearch, ...reads };
  const receipt = await sumReceipt(deps, ctx, venture.id, bands.plan);
  // Only the newest count is kept: a count written now replaces the one before.
  const older = listRecords(deps.store.read(), 'venture-sum-receipt', venture.id).some(item => item.id !== receipt.id && item.subject.type === 'count' && item.subject.what === 'bands');
  if (older) await ventureAction(deps, ctx, 'read', 'network.bands', tx => { dropOlderBandCounts(tx, receipt.id); });
  return { sources, bands: { ...bands.counts, receiptId: receipt.id }, webSearch, ...reads };
}

function findPerson(people: PersonRecord[], id: string): PersonRecord {
  const person = people.find(item => item.id === id);
  check(person, 'INVALID_VENTURE_REQUEST', 'This person is not in your network.');
  return person;
}

/**
 * venture.network.merge { a, b } (approve, inside the app): b joins a. Every fact of b moves to a with its source row;
 * a is hidden when either was; a's history records the merge and carries b's split history (people b was split from
 * now name a, so a later import never merges them back); the records that named b (cards, drafts, evidence, search
 * results) name a.
 */
export async function networkMerge(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PersonView> {
  requireAppChannel(ctx, 'venture.network.merge');
  const body = exactPayload(payload, ['a', 'b'], ['a', 'b']);
  const a = identifier(body.a, 'a'), b = identifier(body.b, 'b');
  check(a !== b, 'INVALID_VENTURE_REQUEST', 'Choose two different people.');
  return ventureAction(deps, ctx, 'approve', 'network.merge', tx => {
    const people = tx.list('venture-person');
    const keep = findPerson(people, a), join = findPerson(people, b);
    const joined = absorb(keep, join, people, { at: tx.now, by: ctx.memberId, extra: [] });
    const merged = derive(joined.target);
    writePeople(tx, { replace: [merged, ...joined.remapped], remove: new Set([join.id]) });
    repoint(tx, join.id, keep.id);
    writeTies(tx, new Set([keep.id])); // 4D2: the tie of the person kept, worked out again with what joined them
    return personView(tx.state, tx.venture!, merged);
  });
}

/**
 * venture.network.split { personId, sourceIds } (approve, inside the app): two people merged wrongly come apart. The
 * facts from the named source rows ('netimport_x:12', or a whole import's id) move to a new person; both keep the
 * split in their history, and a later import never merges them back.
 */
export async function networkSplit(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PersonSplit> {
  requireAppChannel(ctx, 'venture.network.split');
  const body = exactPayload(payload, ['personId', 'sourceIds'], ['personId', 'sourceIds']);
  const personId = identifier(body.personId, 'personId');
  check(Array.isArray(body.sourceIds) && body.sourceIds.length >= 1 && body.sourceIds.length <= 200, 'INVALID_VENTURE_REQUEST', 'Choose the sources to move, from 1 to 200.');
  const ids = new Set(body.sourceIds.map((item, i) => identifier(item, `sourceIds[${i}]`)));
  return ventureAction(deps, ctx, 'approve', 'network.split', tx => {
    const person = findPerson(tx.list('venture-person'), personId);
    const moves = (fact: PersonRecord['facts'][number]) => ids.has(sourceKey(fact.source)) || (!!fact.source.importId && ids.has(fact.source.importId));
    for (const id of ids) {
      check(person.facts.some(fact => sourceKey(fact.source) === id || fact.source.importId === id), 'INVALID_VENTURE_REQUEST', 'One of those sources is not this person\'s.');
    }
    const moving = person.facts.filter(moves), staying = person.facts.filter(fact => !moves(fact));
    const base = tx.base('venture-person');
    const kept = derive({ ...person, facts: staying, history: [...person.history, { op: 'split', from: [base.id], at: tx.now, by: ctx.memberId }] });
    const clients = clientsByEmail(tx.list('venture-client'));
    const moved = linkClient(derive({
      ...base, name: '', handles: { emails: [], phones: [], linkedinUrl: null }, role: null, roles: [], facts: moving, hidden: person.hidden, clientId: null,
      history: [{ op: 'split', from: [person.id], at: tx.now, by: ctx.memberId }],
    }), clients);
    check(moving.length > 0 && hasIdentity(kept) && hasIdentity(moved), 'INVALID_VENTURE_REQUEST', 'Choose some of this person\'s sources, not all of them.');
    writePeople(tx, { replace: [kept], put: [moved] });
    writeTies(tx, new Set([kept.id, moved.id])); // 4D2: both ties worked out again, so neither claims the other's facts
    return { person: personView(tx.state, tx.venture!, kept), split: personView(tx.state, tx.venture!, moved) };
  });
}

/** venture.network.hide { personId, hidden } (prepare, inside the app): keeps a person out of search and lists, or back in. */
export async function networkHide(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ person: PersonSummary }> {
  requireAppChannel(ctx, 'venture.network.hide');
  const body = exactPayload(payload, ['personId', 'hidden'], ['personId', 'hidden']);
  const personId = identifier(body.personId, 'personId');
  check(typeof body.hidden === 'boolean', 'INVALID_VENTURE_REQUEST', 'hidden is true or false.');
  const hidden = body.hidden;
  return ventureAction(deps, ctx, 'prepare', 'network.hide', tx => {
    const person = findPerson(tx.list('venture-person'), personId);
    const next = person.hidden === hidden ? person
      : tx.replace<PersonRecord>({ ...person, hidden, history: [...person.history, { op: hidden ? 'hide' : 'show', from: [], at: tx.now, by: ctx.memberId }] });
    return { person: summaries(tx.state, tx.venture!, [next])[0] };
  });
}

// ---------------------------------------------------------------------------
// Package 4D2: strength and warm paths. The ties are worked out in strength.ts, the paths in paths.ts.
// ---------------------------------------------------------------------------

/** The owner as the source of a fact: no file, no row. */
const OWNER_SOURCE = { connector: 'owner' as const, importId: null, row: null };

/** The owner's note: one line, at most 200 characters, with any key or token in it replaced (the secret screen). */
function ownerNote(value: unknown): string {
  return redactSecrets(singleLine(value, 'The note', { min: 1, max: 200 }));
}

/**
 * venture.network.recompute {} (prepare): works out how well the owner knows every person of the open business, writes
 * Keeper's network-strength run, and answers how many ties it worked out.
 */
export async function networkRecompute(deps: VentureDeps, ctx: Context, payload: unknown): Promise<NetworkRecompute> {
  exactPayload(payload ?? {}, []);
  return ventureAction(deps, ctx, 'prepare', 'network.recompute', tx => recomputeTies(tx));
}

/**
 * venture.network.know { personId, how: 'well' | 'met', note? } (prepare, inside the app): the owner says how they know
 * someone. It is one "you said" signal with the owner as its source, and the newest word replaces the earlier one; the
 * note stays on the person (What Chausar keeps), not in the tie. That person's tie is worked out again at once.
 */
export async function networkKnow(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PersonView> {
  requireAppChannel(ctx, 'venture.network.know');
  const body = exactPayload(payload, ['personId', 'how', 'note'], ['personId', 'how']);
  const personId = identifier(body.personId, 'personId');
  check(body.how === 'well' || body.how === 'met', 'INVALID_VENTURE_REQUEST', 'Say how you know them: well, or met.');
  const how = body.how;
  const note = body.note === undefined || body.note === null || body.note === '' ? null : ownerNote(body.note);
  return ventureAction(deps, ctx, 'prepare', 'network.know', tx => {
    const person = findPerson(tx.list('venture-person'), personId);
    const words = how === 'well' ? 'You know them well' : 'You have met them';
    const fact: PersonFact = {
      id: ownerFactId(), kind: 'you-said', value: note ? `${words}. ${note}` : words, date: localDayAt(tx.now, tx.venture!.country),
      detail: { how, note }, source: OWNER_SOURCE,
    };
    const next = tx.replace<PersonRecord>({
      ...person, facts: [...person.facts.filter(item => item.kind !== 'you-said'), fact],
      history: [...person.history, { op: 'know', from: [], at: tx.now, by: ctx.memberId }],
    });
    writeTies(tx, new Set([next.id]));
    return personView(tx.state, tx.venture!, next);
  });
}

/**
 * venture.network.link { a, b, note } (prepare, inside the app): the owner says two people in the network know each
 * other, with a note. Each keeps the link as a fact with the owner as its source (the newest note for the pair replaces
 * the last) and a history entry; a warm path through either to the other then counts as confirmed, on the owner's word.
 */
export async function networkLink(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ line: string }> {
  requireAppChannel(ctx, 'venture.network.link');
  const body = exactPayload(payload, ['a', 'b', 'note'], ['a', 'b', 'note']);
  const a = identifier(body.a, 'a'), b = identifier(body.b, 'b');
  check(a !== b, 'INVALID_VENTURE_REQUEST', 'Choose two different people.');
  const note = ownerNote(body.note);
  return ventureAction(deps, ctx, 'prepare', 'network.link', tx => {
    const people = tx.list('venture-person');
    const first = findPerson(people, a), second = findPerson(people, b);
    const day = localDayAt(tx.now, tx.venture!.country);
    const linked = (person: PersonRecord, other: PersonRecord): PersonRecord => ({
      ...person,
      facts: [
        ...person.facts.filter(fact => !(fact.kind === 'link' && (fact.detail as { personId?: string } | null)?.personId === other.id)),
        { id: ownerFactId(), kind: 'link', value: `${other.name}, you said: ${note}`, date: day, detail: { personId: other.id, note }, source: OWNER_SOURCE },
      ],
      history: [...person.history, { op: 'link', from: [other.id], at: tx.now, by: ctx.memberId }],
    });
    tx.replace<PersonRecord>(linked(first, second));
    tx.replace<PersonRecord>(linked(second, first));
    return { line: `Saved: you said ${first.name} and ${second.name} know each other. A path through either of them to the other now counts as confirmed, on your word.` };
  });
}
