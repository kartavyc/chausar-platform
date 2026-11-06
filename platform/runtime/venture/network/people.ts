// Chausar venture launcher, network (Ink v2 wave 4, package 4D1): one person per real person. A person is a list of
// facts, each with the source row it came from; the name, handles (emails, phones, LinkedIn address) and role are
// derived from the facts, so taking an import's facts away (Undo) or moving source rows to another person (Split)
// leaves every person exactly right. Mail, meetings and messages are one total per import and person; combinedSignals
// reads them together without counting a re-imported month twice. A merge keeps the hidden flag and the split history;
// what it moves is recorded so an import's Undo can put it back. The views are what the screens read: a summary per
// person, and "What Chausar keeps about this person" with every field and its source row (the DPDP notice record).
import type { State } from '../../contracts.ts';
import type {
  ClientRecord, DateOrder, IsoDate, MergeSuggestion, NetworkAbsorbed, NetworkImportKind, NetworkImportRecord, PersonFact, PersonFactKind, PersonFieldView,
  PersonRecord, PersonRole, PersonSummary, PersonView, SourceRef, TieRecord, VentureRecord,
} from '../contracts.ts';
import { TIE_BANDS } from '../contracts.ts';
import { formatVentureDate, listRecords, type VentureTx } from '../records.ts';
import { count, fold, foldCompany, plural } from './text.ts';
import { pathIndex, warmPaths } from './paths.ts';
import { howLines } from './strength.ts';

/** The facts a person is known and merged by, in the order a row adds them. */
export const IDENTITY_KINDS: ReadonlySet<PersonFactKind> = new Set<PersonFactKind>(['name', 'email', 'phone', 'linkedin', 'role']);
/** Totals shown one line per import in the person view. */
const GROUPED_KINDS: ReadonlySet<PersonFactKind> = new Set<PersonFactKind>(['meeting', 'mail', 'message']);

/** How each file kind is named to the owner. */
export const KIND_LABEL: Readonly<Record<NetworkImportKind, string>> = Object.freeze({
  'linkedin-connections': 'LinkedIn connections', 'linkedin-messages': 'LinkedIn messages', 'contacts-csv': 'Contacts file', vcard: 'Phone contacts',
  'calendar-ics': 'Calendar', 'mail-headers': 'Mail headers',
});

/** The key of a fact's source row: 'netimport_x:12' for a file row, else 'owner' or the page address. */
export function sourceKey(source: SourceRef): string {
  if (source.importId) return `${source.importId}:${source.row ?? 0}`;
  return source.connector === 'web' && source.url ? source.url : source.connector;
}

/** A role fact as the role it records. */
function roleOf(fact: PersonFact): PersonRole {
  const detail = (fact.detail ?? {}) as { title?: string | null; company?: string | null };
  return { title: detail.title ?? null, company: detail.company ?? null, asOf: fact.date, source: fact.source };
}

/** 'Co-founder at Dewdrop Naturals', 'Co-founder' or 'Dewdrop Naturals'. */
export function roleWords(title: string | null, company: string | null): string {
  return title && company ? `${title} at ${company}` : title ?? company ?? '';
}

const unique = (values: string[]) => [...new Set(values)];

/** The person with name, handles, role and earlier roles worked out again from their facts. */
export function derive(person: PersonRecord): PersonRecord {
  const values = (kind: PersonFactKind) => person.facts.filter(fact => fact.kind === kind).map(fact => fact.value);
  const emails = unique(values('email')), phones = unique(values('phone'));
  const linkedinUrl = values('linkedin')[0] ?? null;
  const roleFacts = person.facts.filter(fact => fact.kind === 'role');
  const role = roleFacts.length ? roleOf(roleFacts[roleFacts.length - 1]) : null;
  const sameRole = (a: PersonRole, b: PersonRole) => fold(a.title) === fold(b.title) && fold(a.company) === fold(b.company);
  const roles: PersonRole[] = [];
  for (const fact of roleFacts.slice(0, -1)) {
    const earlier = roleOf(fact);
    if ((role && sameRole(earlier, role)) || roles.some(item => sameRole(item, earlier))) continue;
    roles.push(earlier);
  }
  const slug = linkedinUrl ? decodeURIComponent(linkedinUrl.split('/in/')[1] ?? '') : null;
  const name = values('name')[0] ?? emails[0] ?? slug ?? phones[0] ?? 'Someone in your network';
  return { ...person, name, handles: { emails, phones, linkedinUrl }, role, roles };
}

/** The handle keys a person is merged by: 'e:<email>', 'p:<phone>', 'l:<LinkedIn address>'. */
export function handleKeys(handles: { emails: string[]; phones: string[]; linkedinUrl: string | null }): string[] {
  return [...handles.emails.map(email => `e:${email}`), ...handles.phones.map(phone => `p:${phone}`), ...(handles.linkedinUrl ? [`l:${handles.linkedinUrl}`] : [])];
}

/** Pairs of people the owner split apart: an import never merges them back. */
export function splitPairs(people: PersonRecord[]): Set<string> {
  const pairs = new Set<string>();
  for (const person of people) {
    for (const entry of person.history) if (entry.op === 'split' && entry.from[0]) pairs.add(pairKey(person.id, entry.from[0]));
  }
  return pairs;
}
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** The client whose email this person has, when they have none linked yet. */
export function linkClient(person: PersonRecord, clients: ReadonlyMap<string, string>): PersonRecord {
  if (person.clientId) return person;
  const clientId = person.handles.emails.map(email => clients.get(email)).find(Boolean) ?? null;
  return clientId ? { ...person, clientId } : person;
}

/** Every client of the business by lower-case email. */
export function clientsByEmail(clients: ClientRecord[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const client of clients) {
    const email = client.email?.trim().toLowerCase();
    if (email && !map.has(email)) map.set(email, client.id);
  }
  return map;
}

/** True when a person still has a name or a handle of their own. */
export const hasIdentity = (person: PersonRecord) => person.facts.some(fact => IDENTITY_KINDS.has(fact.kind) && fact.kind !== 'role');

/**
 * other joins target: its facts, the client link when target has none, hidden when either was hidden, a merge entry,
 * and other's split history (so people the owner split apart stay apart). Third people whose split history named other
 * now name target; they come back in remapped. A split between target and other themselves no longer applies. other's
 * own merges of people travel too (4D2), so a link the owner made to anyone in the chain still finds who they became,
 * and Forget finds every id they had. extra: ids added to every new history entry (an import's id, so its Undo takes
 * them off).
 */
export function absorb(target: PersonRecord, other: PersonRecord, everyone: PersonRecord[], meta: { at: string; by: string; extra: string[] }): { target: PersonRecord; remapped: PersonRecord[] } {
  const carried = other.history
    .filter(entry => (entry.op === 'split' || (entry.op === 'merge' && entry.from[0]?.startsWith('person_'))) && entry.from[0] && entry.from[0] !== target.id)
    .map(entry => ({ op: entry.op as 'split' | 'merge', from: [entry.from[0], ...meta.extra], at: meta.at, by: meta.by }));
  const history = [...target.history.filter(entry => !(entry.op === 'split' && entry.from[0] === other.id)), { op: 'merge' as const, from: [other.id, ...meta.extra], at: meta.at, by: meta.by }, ...carried];
  const remapped = everyone
    .filter(person => person.id !== target.id && person.id !== other.id && person.history.some(entry => entry.op === 'split' && entry.from[0] === other.id))
    .map(person => ({ ...person, history: person.history.map(entry => (entry.op === 'split' && entry.from[0] === other.id ? { ...entry, from: [target.id, ...entry.from.slice(1)] } : entry)) }));
  return {
    target: { ...target, facts: [...target.facts, ...other.facts], clientId: target.clientId ?? other.clientId, hidden: target.hidden || other.hidden, history },
    remapped,
  };
}

/**
 * People written in one pass over the draft state: replaced in place, removed, then added. tx.put and tx.replace look
 * the whole state through for each record, which is too slow for an import of 20,000 people.
 */
export function writePeople(tx: VentureTx, change: { put?: PersonRecord[]; replace?: PersonRecord[]; remove?: ReadonlySet<string> }): void {
  const ventureId = tx.venture!.id;
  const replacing = new Map((change.replace ?? []).map(person => [person.id, person]));
  const remove = change.remove ?? new Set<string>();
  const kept: unknown[] = [];
  for (const record of tx.state.conversations) {
    if (record?.kind === 'venture-person' && record.ventureId === ventureId) {
      if (remove.has(record.id)) continue;
      const next = replacing.get(record.id);
      kept.push(next ? structuredClone(next) : record);
    } else kept.push(record);
  }
  const ids = new Set(kept.map(record => (record as { id?: string })?.id));
  for (const person of change.put ?? []) {
    if (person.kind !== 'venture-person' || person.ventureId !== ventureId || ids.has(person.id)) throw new Error('A new person must be new.');
    kept.push(structuredClone(person));
  }
  tx.state.conversations = kept;
}

/** Records of the open business that a test says go, removed in one pass. Answers how many went. */
export function removeRecords(tx: VentureTx, drop: (record: { kind?: string; [key: string]: unknown }) => boolean): number {
  const ventureId = tx.venture!.id;
  const before = tx.state.conversations.length;
  tx.state.conversations = tx.state.conversations.filter(record => !(record?.ventureId === ventureId && drop(record)));
  return before - tx.state.conversations.length;
}

/**
 * After a merge, the records that named the person merged away name the one they joined: pipeline cards, drafts, the
 * evidence rows about them and plain-English search results (by index, so Undo can put each back). Older imports' Undo
 * copies follow too. Their tie is dropped (4D2 works it out again). Answers what moved.
 */
export function repoint(tx: VentureTx, from: string, to: string): Omit<NetworkAbsorbed['repointed'], 'splits'> {
  const moved: Omit<NetworkAbsorbed['repointed'], 'splits'> = { cards: [], drafts: [], evidence: [], searches: [] };
  for (const card of tx.list('venture-opportunity')) if (card.personId === from) { tx.replace({ ...card, personId: to }); moved.cards.push(card.id); }
  for (const draft of tx.list('venture-outreach')) if (draft.personId === from) { tx.replace({ ...draft, personId: to }); moved.drafts.push(draft.id); }
  for (const row of tx.list('venture-evidence')) if (row.subject === `person:${from}`) { tx.replace({ ...row, subject: `person:${to}` }); moved.evidence.push(row.id); }
  for (const search of tx.list('venture-network-search')) {
    const results = search.results.filter(result => result.personId === from).map(result => ({ fitBp: result.fitBp, url: result.url, checks: JSON.stringify(result.checks) }));
    const shown = search.shown.filter(id => id === from).length;
    if (!results.length && !shown) continue;
    tx.replace({
      ...search,
      results: search.results.map(result => (result.personId === from ? { ...result, personId: to } : result)),
      shown: search.shown.map(id => (id === from ? to : id)),
    });
    moved.searches.push({ id: search.id, results, shown });
  }
  for (const record of tx.list('venture-network-import')) {
    const persons = (record.absorbed ?? []).filter(item => item.into === from).map(item => item.person.id);
    if (!persons.length) continue;
    tx.replace<NetworkImportRecord>({ ...record, absorbed: record.absorbed!.map(item => (item.into === from ? { ...item, into: to } : item)) });
    (moved.copies ??= []).push({ importId: record.id, persons });
  }
  removeRecords(tx, record => record.kind === 'venture-tie' && record.personId === from);
  return moved;
}

/** An import's Undo: the records a merge moved to into go back to the person merged away, where they still name into. */
export function unrepoint(tx: VentureTx, item: NetworkAbsorbed): void {
  const back = item.person.id, into = item.into;
  for (const id of item.repointed.cards) { const card = tx.find('venture-opportunity', id); if (card?.personId === into) tx.replace({ ...card, personId: back }); }
  for (const id of item.repointed.drafts) { const draft = tx.find('venture-outreach', id); if (draft?.personId === into) tx.replace({ ...draft, personId: back }); }
  for (const id of item.repointed.evidence) { const row = tx.find('venture-evidence', id); if (row?.subject === `person:${into}`) tx.replace({ ...row, subject: `person:${back}` }); }
  // Search entries by the person they name and what they hold, never by place: other entries may have gone since.
  for (const moved of item.repointed.searches) {
    const search = tx.find('venture-network-search', moved.id);
    if (!search) continue;
    const wanted = [...moved.results];
    const results = search.results.map(result => {
      if (result.personId !== into) return result;
      const at = wanted.findIndex(entry => entry.fitBp === result.fitBp && entry.url === result.url && entry.checks === JSON.stringify(result.checks));
      if (at < 0) return result;
      wanted.splice(at, 1);
      return { ...result, personId: back };
    });
    let flip = moved.shown;
    const shown = [...search.shown].reverse().map(id => (id === into && flip > 0 ? (flip -= 1, back) : id)).reverse();
    tx.replace({ ...search, results, shown });
  }
  // Older imports' Undo copies that this merge pointed at into point back at the person it merged away.
  for (const copy of item.repointed.copies ?? []) {
    const record = tx.find('venture-network-import', copy.importId);
    if (!record?.absorbed) continue;
    tx.replace<NetworkImportRecord>({ ...record, absorbed: record.absorbed.map(entry => (entry.into === into && copy.persons.includes(entry.person.id) ? { ...entry, into: back } : entry)) });
  }
}

/** Initials from a name: the first letter of the first and last words ('AR'), or one letter. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word));
  const first = (word: string | undefined) => (word ? [...word.replace(/^[^\p{L}\p{N}]+/u, '')][0] ?? '' : '');
  const letters = words.length > 1 ? first(words[0]) + first(words[words.length - 1]) : first(words[0]);
  return letters.toUpperCase() || '?';
}

/** The newest tie of each person (4D2 writes them). */
function tiesOf(state: State, ventureId: string): Map<string, TieRecord> {
  const ties = new Map<string, TieRecord>();
  for (const tie of listRecords(state, 'venture-tie', ventureId)) ties.set(tie.personId, tie);
  return ties;
}

/** One person in a list. band and dots come from their tie once 4D2 has worked it out. */
export function personSummary(person: PersonRecord, tie: TieRecord | undefined): PersonSummary {
  const band = tie?.band ?? null;
  return {
    id: person.id, name: person.name, initials: initials(person.name), title: person.role?.title ?? null, company: person.role?.company ?? null,
    band, dots: band ? TIE_BANDS.length - TIE_BANDS.indexOf(band) : 0, hidden: person.hidden, degree: '1st',
  };
}

/** Summaries for many people, reading the ties once. */
export function summaries(state: State, venture: VentureRecord, people: PersonRecord[]): PersonSummary[] {
  const ties = tiesOf(state, venture.id);
  return people.map(person => personSummary(person, ties.get(person.id)));
}

/** People sorted for a list: by folded name, then oldest first. */
export function byName(people: PersonRecord[]): PersonRecord[] {
  return people.map((person, index) => ({ person, index, key: fold(person.name) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index)).map(item => item.person);
}

/**
 * "Same person?": two visible people with the same folded name and the same company (legal suffixes ignored), never
 * a pair the owner split apart. A name alone never makes a suggestion.
 */
export function mergeSuggestions(people: PersonRecord[], limit = 50): MergeSuggestion[] {
  const apart = splitPairs(people);
  const groups = new Map<string, PersonRecord[]>();
  for (const person of people) {
    if (person.hidden) continue;
    const name = fold(person.name), company = foldCompany(person.role?.company);
    if (!name || !company) continue;
    const key = `${name}|${company}`;
    groups.set(key, [...(groups.get(key) ?? []), person]);
  }
  const out: MergeSuggestion[] = [];
  for (const group of groups.values()) {
    for (const other of group.slice(1)) {
      if (apart.has(pairKey(group[0].id, other.id))) continue;
      out.push({ a: group[0].id, b: other.id, line: `${group[0].name} at ${group[0].role?.company ?? ''} appears twice. Same person?` });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

type TallyDetail = { sent: number; received: number; copied: number; first: IsoDate; last: IsoDate; months: Record<string, number[]>; with?: string[]; rows?: number };
type MeetingDetail = { count: number; small: number; first: IsoDate; last: IsoDate; months: Record<string, number[]>; titles: string[]; with?: string[]; rows?: number };
export type CombinedTally = { sent: number; received: number; copied: number; first: IsoDate; last: IsoDate; months: Record<string, [number, number, number]> };
export type CombinedMeetings = { count: number; small: number; first: IsoDate; last: IsoDate; months: Record<string, [number, number]>; titles: string[]; with?: string[] };
/** What a person's facts say, read together across imports: what 4D2's strength and the screens count. */
export type PersonSignals = { connected: IsoDate | null; contact: boolean; mail: (CombinedTally & { with?: string[] }) | null; messages: CombinedTally | null; meetings: CombinedMeetings | null };

type Rows = Record<string, number[]>;
const monthsOf = (fact: PersonFact) => (fact.detail as { months?: Rows } | null)?.months ?? {};
const addRows = (a: Rows, b: Rows, width: number): Rows => {
  const out: Rows = { ...a };
  for (const [month, row] of Object.entries(b)) out[month] = (out[month] ?? new Array(width).fill(0)).map((value, i) => value + row[i]);
  return out;
};
const maxRows = (a: Rows, b: Rows, width: number): Rows => {
  const out: Rows = { ...a };
  for (const [month, row] of Object.entries(b)) out[month] = (out[month] ?? new Array(width).fill(0)).map((value, i) => Math.max(value, row[i]));
  return out;
};

/** Groups of items that touch each other (union-find over a pair test). */
function groupsOf<T>(items: T[], touch: (a: T, b: T) => boolean): T[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i += 1) for (let j = i + 1; j < items.length; j += 1) if (touch(items[i], items[j])) parent[find(j)] = find(i);
  const groups = new Map<number, T[]>();
  items.forEach((item, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), item]));
  return [...groups.values()];
}

/**
 * Month rows of one kind across a person's facts without counting one item twice. Within one import, two addresses of
 * the person that shared an item (one is in the other's "with" list) take the larger count per month and direction;
 * addresses that never did add up. Across imports, exports whose day ranges overlap take the larger count (a newer
 * export repeats the older); exports of separate date ranges add up.
 */
function combineMonths(facts: PersonFact[], width: number): { months: Rows; first: IsoDate; last: IsoDate } {
  type Span = { months: Rows; first: IsoDate; last: IsoDate };
  const byImport = new Map<string, PersonFact[]>();
  for (const fact of facts) {
    const key = fact.source.importId ?? sourceKey(fact.source);
    byImport.set(key, [...(byImport.get(key) ?? []), fact]);
  }
  const spans: Span[] = [...byImport.values()].map(list => {
    const together = (a: PersonFact, b: PersonFact) => {
      const da = a.detail as { for?: string; with?: string[] }, db = b.detail as { for?: string; with?: string[] };
      return (!!db.for && (da.with ?? []).includes(db.for)) || (!!da.for && (db.with ?? []).includes(da.for));
    };
    const months = groupsOf(list, together)
      .map(group => group.reduce((rows, fact) => maxRows(rows, monthsOf(fact), width), {} as Rows))
      .reduce((rows, group) => addRows(rows, group, width), {} as Rows);
    const details = list.map(fact => fact.detail as { first: IsoDate; last: IsoDate });
    return { months, first: details.map(detail => detail.first).sort()[0], last: details.map(detail => detail.last).sort().reverse()[0] };
  });
  const overlap = (a: Span, b: Span) => a.first <= b.last && b.first <= a.last;
  const months = groupsOf(spans, overlap)
    .map(group => group.reduce((rows, span) => maxRows(rows, span.months, width), {} as Rows))
    .reduce((rows, group) => addRows(rows, group, width), {} as Rows);
  return {
    months: Object.fromEntries(Object.keys(months).sort().map(month => [month, months[month]])),
    first: spans.map(span => span.first).sort()[0], last: spans.map(span => span.last).sort().reverse()[0],
  };
}

function combineTally(facts: PersonFact[]): CombinedTally | null {
  if (!facts.length) return null;
  const combined = combineMonths(facts, 3);
  const months = combined.months as Record<string, [number, number, number]>;
  const total = (i: number) => Object.values(months).reduce((sum, row) => sum + row[i], 0);
  return { sent: total(0), received: total(1), copied: total(2), first: combined.first, last: combined.last, months };
}

/** A person's signals read together across imports, never counting a re-imported month twice. */
export function combinedSignals(person: PersonRecord): PersonSignals {
  const of = (kind: PersonFactKind) => person.facts.filter(fact => fact.kind === kind);
  const connected = of('connection').map(fact => fact.date).filter((date): date is string => !!date).sort()[0] ?? null;
  const mailFacts = of('mail'), mail = combineTally(mailFacts);
  const mailWith = unique(mailFacts.flatMap(fact => (fact.detail as TallyDetail).with ?? []));
  const meetingFacts = of('meeting');
  let meetings: CombinedMeetings | null = null;
  if (meetingFacts.length) {
    const details = meetingFacts.map(fact => fact.detail as MeetingDetail);
    const combined = combineMonths(meetingFacts, 2);
    const months = combined.months as Record<string, [number, number]>;
    const newest = [...meetingFacts].sort((a, b) => ((a.date ?? '') < (b.date ?? '') ? 1 : -1)).flatMap(fact => (fact.detail as MeetingDetail).titles);
    const together = unique(details.flatMap(detail => detail.with ?? []));
    meetings = {
      count: Object.values(months).reduce((sum, row) => sum + row[0], 0), small: Object.values(months).reduce((sum, row) => sum + row[1], 0),
      first: combined.first, last: combined.last, months,
      titles: unique(newest).slice(0, 5), ...(together.length ? { with: together } : {}),
    };
  }
  return {
    connected, contact: of('contact').length > 0,
    mail: mail ? { ...mail, ...(mailWith.length ? { with: mailWith } : {}) } : null,
    messages: combineTally(of('message')), meetings,
  };
}

/** Where a fact came from, in words: 'LinkedIn connections, Connections.csv, line 5'. */
function sourceWords(source: SourceRef, imports: ReadonlyMap<string, NetworkImportRecord>): string {
  if (source.connector === 'owner') return 'You, in Chausar';
  if (source.connector === 'web') return source.url ?? 'A public page';
  const record = source.importId ? imports.get(source.importId) : undefined;
  return `${KIND_LABEL[source.connector]}, ${record?.fileName ?? 'a file you imported'}, line ${count(source.row ?? 0)}`;
}

const FIELD: Readonly<Record<PersonFactKind, string>> = Object.freeze({
  name: 'Name', email: 'Email', phone: 'Phone', linkedin: 'LinkedIn', role: 'Role', connection: 'LinkedIn connection', contact: 'Saved contact',
  meeting: 'Meetings', mail: 'Mail', message: 'LinkedIn messages', client: 'Client', 'you-said': 'You said', web: 'From a public page', link: 'Knows',
});

/** One fact's value in words. */
function factWords(fact: PersonFact, order: DateOrder): string {
  switch (fact.kind) {
    case 'connection': return fact.date ? `Connected on ${formatVentureDate(fact.date, order)}` : 'Connected';
    case 'contact': return 'Saved in your contacts';
    default: return fact.value;
  }
}

/** Meetings, mail or messages from one import, in one line. */
function groupWords(kind: PersonFactKind, facts: PersonFact[], order: DateOrder): string {
  const lastDay = facts.map(fact => fact.date).filter((date): date is string => !!date).sort().reverse()[0];
  const last = lastDay ? `, the last on ${formatVentureDate(lastDay, order)}` : '';
  if (kind === 'meeting') return `${plural(facts.reduce((sum, fact) => sum + (fact.detail as MeetingDetail).count, 0), 'meeting', 'meetings')}${last}`;
  const sum = (key: 'sent' | 'received' | 'copied') => facts.reduce((total, fact) => total + (fact.detail as TallyDetail)[key], 0);
  const parts = ([['sent', 'you sent'], ['received', 'you received'], ['copied', 'you were copied on']] as const)
    .filter(([key]) => sum(key) > 0).map(([key, words]) => `${count(sum(key))} ${words}`);
  const total = sum('sent') + sum('received') + sum('copied');
  const noun = kind === 'message' ? plural(total, 'message', 'messages') : plural(total, 'mail', 'mails');
  return `${noun}${parts.length ? ` (${parts.join(', ')})` : ''}${last}`;
}

/** Every field Chausar keeps about a person with its source row; meetings, mail and messages one line per import. */
export function personFields(person: PersonRecord, imports: ReadonlyMap<string, NetworkImportRecord>, order: DateOrder): PersonFieldView[] {
  const fields: PersonFieldView[] = [];
  const grouped = new Map<string, PersonFact[]>();
  for (const fact of person.facts) {
    if (GROUPED_KINDS.has(fact.kind) && fact.source.importId) {
      const key = `${fact.kind}|${fact.source.importId}`;
      if (!grouped.has(key)) fields.push({ field: key, value: '', source: '', sourceId: fact.source.importId });
      grouped.set(key, [...(grouped.get(key) ?? []), fact]);
      continue;
    }
    fields.push({ field: FIELD[fact.kind], value: factWords(fact, order), source: sourceWords(fact.source, imports), sourceId: sourceKey(fact.source) });
  }
  return fields.map(field => {
    const facts = grouped.get(field.field);
    if (!facts) return field;
    const kind = facts[0].kind, record = imports.get(field.sourceId);
    const rows = facts.reduce((sum, fact) => sum + ((fact.detail as { rows?: number } | null)?.rows ?? 1), 0);
    return { field: FIELD[kind], value: groupWords(kind, facts, order), source: `${KIND_LABEL[facts[0].source.connector as NetworkImportKind]}, ${record?.fileName ?? 'a file you imported'}, ${plural(rows, 'row', 'rows')}`, sourceId: field.sourceId };
  });
}

/**
 * The person sheet. how (the tie's receipt lines) and paths (up to three warm paths, 4D2); card (4E1) and drafts (4E2)
 * are filled by their packages.
 */
export function personView(state: State, venture: VentureRecord, person: PersonRecord): PersonView {
  const imports = new Map(listRecords(state, 'venture-network-import', venture.id).map(record => [record.id, record]));
  const identitySources = new Set(person.facts.filter(fact => IDENTITY_KINDS.has(fact.kind)).map(fact => sourceKey(fact.source)));
  return {
    person: summaries(state, venture, [person])[0],
    fields: personFields(person, imports, venture.country.dateOrder),
    how: howLines(person, tiesOf(state, venture.id).get(person.id)), paths: warmPaths(pathIndex(state, venture.id), person.id), card: null, drafts: [],
    merged: identitySources.size > 1,
    web: person.facts.filter(fact => fact.kind === 'web' && fact.source.url).map(fact => ({ text: fact.value, url: fact.source.url! })),
    linkedin: person.handles.linkedinUrl, // 4D4
  };
}
