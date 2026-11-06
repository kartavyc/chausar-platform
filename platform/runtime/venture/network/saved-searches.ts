// Chausar venture launcher, network (Ink v2 wave 4, package 4D3, catalogue C5 and C18): what code alone does with a
// plain-English search. The fields a search reads about a person, each with its source in words; the exact filters
// (clients, quiet for some months, how well the owner knows them); the check of a quote against a stored field; the
// fit, the rank and the views with their "Why" lines, all written by code. Saved searches: after each import their words
// run again in code only (no AI) over everyone not in them yet; a person who matches at least half of the traits joins
// the search as checked by code, and a notice on Today says how many new people match. A re-import that shows someone
// at a new company adds an evidence row and keeps the earlier role. Undo of an import takes back what it added here;
// Forget takes a person out of every search, saved or not, and erases the stored text of the calls that carried them.
import { check, type Context, type State } from '../../contracts.ts';
import { SEARCH_FIELDS } from '../contracts.ts';
import type {
  EvidenceRecord, IsoDate, NetworkImportKind, NetworkImportRecord, NetworkSearchRecord, NetworkSearchResult, NetworkSearchView, PersonFact, PersonRecord,
  PipelineStage, SavedSearchView, SearchField, SearchFilters, SearchResultView, SourceRef, TieBand, TieRecord, TraitCheck, VentureDeps, VentureRecord,
  WarmPathView,
} from '../contracts.ts';
import { exactPayload, formatVentureDate, identifier, listRecords, requireAppChannel, singleLine, tidyWords, ventureAction, type VentureTx } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { personEvidence } from '../evidence/ledger.ts';
import { redactSecrets } from '../core/secrets.ts';
import type { W4RowItem } from '../views/queue-w4.ts';
import { combinedSignals, KIND_LABEL, removeRecords, roleWords, summaries } from './people.ts';
import { bestPath, pathIndex, type PathIndex } from './paths.ts';
import { cardsOf } from './pipeline.ts';
import { shortDay } from './followups.ts';
import { listPeople } from './store.ts';
import { count, fold, foldCompany, plural } from './text.ts';
import { maskContacts, maskProtected, namesProtectedTrait } from './protected.ts';

/** A page of results shows at most this many people. */
export const PAGE_SIZE = 30;
/** At most this many people are read for one search, or one Find more. */
export const MAX_CANDIDATES = 200;
/** A saved search's re-run in code counts a person as a new match from this fit (half the traits). */
export const MATCH_FROM_BP = 5000;
export const FULL_FIT_BP = 10_000;
/** The evidence field of a job change a re-import showed. */
export const JOB_FIELD = 'job.change';
export const ERASED_SEARCH = 'Erased: this search named someone you asked Chausar to forget.';
export const ERASED_SEARCH_CALL = 'Erased: it carried someone you asked Chausar to forget.';
export const CODE_CHECKED = 'Matched by your saved search\'s words; your AI has not checked it.';

const FIELDS: ReadonlySet<string> = new Set<string>(SEARCH_FIELDS);
const RANK: Readonly<Record<TieBand, number>> = Object.freeze({ close: 4, 'know-well': 3, know: 2, 'met-once': 1, cold: 0 });

// ---------------------------------------------------------------------------
// What a search reads about a person
// ---------------------------------------------------------------------------

/**
 * One stored field a search reads: its text; masked, the text as a search sends and quotes it, once maskFields made it
 * (absent before: nothing unmasked is ever sent or quoted; empty when the field is withheld); where it came from in
 * words; whether someone other than the owner wrote it; and guarded, when it holds a protected trait, so it never
 * supports a quote.
 */
export type FieldValue = { field: SearchField; text: string; masked?: string; source: string; outside: boolean; guarded: boolean };

/** Where a fact came from, in words: 'LinkedIn connections, Connections.csv, line 5', or 'You, in Chausar'. */
function sourceWords(source: SourceRef, imports: ReadonlyMap<string, NetworkImportRecord>, withLine = true): string {
  if (source.connector === 'owner') return 'You, in Chausar';
  if (source.connector === 'web') return source.url ?? 'A public page';
  const record = source.importId ? imports.get(source.importId) : undefined;
  const file = `${KIND_LABEL[source.connector]}, ${redactSecrets(record?.fileName ?? 'a file you imported')}`;
  return withLine && source.row ? `${file}, line ${count(source.row)}` : file;
}

// ---------------------------------------------------------------------------
// The name mask, built once per search
// ---------------------------------------------------------------------------

/** At most this many name words, and this many full names, go into one search's mask; past either, it is incomplete. */
export const MAX_MASK_WORDS = 200_000;
export const MAX_MASK_CLIENTS = 200_000;
/** A full name of more words than this is not kept as a whole. */
const MAX_PHRASE_WORDS = 8;

/**
 * The names a search masks in notes and meeting titles, where other people's names are written, built once per search:
 * phrases, every full name (all its words, and its first and last word side by side) of every person in the network
 * and of every client who is a person; words, each single name part of three letters or more, but never a word that
 * also appears in any company or title in the network (so "Rose Bakery", "Tata Motors", "Art Director" and "Founder"
 * stay as they are). A name is read up to a "|", ",", "(" or " - " (a LinkedIn headline after a name is not a name);
 * a business saved as a contact, whose name is a company in the network, is not a person's name. complete: false when
 * a bound was reached; then notes and meeting titles are withheld. Titles and companies are never masked with it: in
 * them only the person's own name is (maskFields).
 */
export type NameMask = { words: ReadonlySet<string>; phrases: ReadonlySet<string>; longest: number; work: ReadonlySet<string>; complete: boolean };

const TOKEN = /[\p{L}\p{M}\p{N}]+/gu;
const tokenKey = (word: string) => word.normalize('NFKC').toLowerCase();
const letters = (word: string) => (word.match(/\p{L}/gu) ?? []).length;
const notAName = (name: string) => !name || name.includes('@') || name.startsWith('+') || name.startsWith('http');
/** A name up to a headline: "Neha Shah | Founder at Glow" is "Neha Shah". */
/**
 * A name and the headline after it: cut at the first "|", "(", " - " or "," (LinkedIn headline names). A comma
 * followed by a single word is a name written last name first ("Mehta, Rahul"), so it is not cut there.
 */
export function cutHeadline(name: string): { name: string; headline: string } {
  const text = name.trim();
  const at = text.search(/\||,|\(|\s[-\u2013]\s/u);
  if (at <= 0) return { name: text, headline: '' };
  const headline = tidyWords(text.slice(at).replace(/^[\s|,(\-\u2013]+|[)\s]+$/gu, ''));
  if (text[at] === ',' && (headline.match(TOKEN) ?? []).length < 2) return { name: text, headline: '' };
  return { name: text.slice(0, at).trim(), headline };
}
export const bareName = (name: string) => cutHeadline(name).name;

/**
 * One imported entry with its name cut at a headline (network/import.ts): "Neha Shah | Founder at Glow Skincare" is
 * stored as "Neha Shah", and the headline becomes the title when the file gave none and it is two words or more (a
 * single word after a comma or bracket, such as "CA", is no headline). An entry with nothing before the cut keeps its name.
 */
export function headlineEntry<E extends { name: string | null; role: { title: string | null; company: string | null } | null }>(entry: E): E {
  if (!entry.name) return entry;
  const { name, headline } = cutHeadline(entry.name);
  if (!name || name === entry.name.trim()) return entry;
  const title = entry.role?.title || ((headline.match(TOKEN) ?? []).length >= 2 ? headline : null);
  const role = title || entry.role?.company ? { title: title ?? null, company: entry.role?.company ?? null } : null;
  return { ...entry, name, role };
}
/** Words that make a client's name a business's. */
const BUSINESS = new Set(['pvt', 'private', 'ltd', 'limited', 'llp', 'llc', 'inc', 'co', 'company', 'corp', 'corporation', 'group', 'foods', 'food', 'traders',
  'trading', 'enterprises', 'industries', 'solutions', 'services', 'studio', 'studios', 'cafe', 'bakery', 'store', 'stores', 'shop', 'mart', 'lab', 'labs',
  'naturals', 'spices', 'motors', 'associates', 'consultants', 'consulting', 'agency', 'media', 'technologies', 'tech', 'systems', 'hotel', 'restaurant',
  'kitchen', 'clinic', 'hospital', 'school', 'academy', 'trust', 'foundation', 'and', '&']);

/** The name keys of one name: its full name and first-and-last pair (as phrases), and its parts. */
function nameKeys(name: string): { phrases: string[]; parts: string[] } {
  const parts = (bareName(name).match(TOKEN) ?? []).map(tokenKey);
  if (parts.length < 2) return { phrases: [], parts: parts.filter(part => letters(part) >= 3) };
  const phrases = parts.length <= MAX_PHRASE_WORDS ? [parts.join(' ')] : [];
  if (parts.length > 2) phrases.push(`${parts[0]} ${parts[parts.length - 1]}`);
  return { phrases, parts: parts.filter(part => letters(part) >= 3) };
}

/** Every name a person's files gave them, read up to any headline, without addresses and phone numbers. */
function namesOf(person: PersonRecord): string[] {
  return [...new Set([person.name, ...person.facts.filter(fact => fact.kind === 'name').map(fact => fact.value)].map(name => bareName(name.trim())))].filter(name => !notAName(name));
}

export function nameMask(state: State, ventureId: string, bounds: { maxWords?: number; maxClients?: number } = {}): NameMask {
  const maxWords = bounds.maxWords ?? MAX_MASK_WORDS, maxPhrases = bounds.maxClients ?? MAX_MASK_CLIENTS;
  const people = listPeople(state, ventureId);
  const companies = new Set<string>();
  const work = new Set<string>();
  for (const person of people) {
    for (const role of [person.role, ...person.roles]) {
      if (!role) continue;
      const company = foldCompany(role.company);
      if (company) companies.add(company);
      for (const text of [role.title, role.company]) for (const part of text?.match(TOKEN) ?? []) work.add(tokenKey(part));
    }
  }
  const words = new Set<string>(), phrases = new Set<string>();
  let complete = true, longest = 0;
  const add = (name: string) => {
    const keys = nameKeys(name);
    for (const phrase of keys.phrases) {
      if (phrases.size >= maxPhrases) { complete = false; break; }
      phrases.add(phrase);
      longest = Math.max(longest, phrase.split(' ').length);
    }
    for (const part of keys.parts) {
      if (work.has(part)) continue;
      if (words.size >= maxWords) { complete = false; break; }
      words.add(part);
    }
  };
  for (const person of people) for (const name of namesOf(person)) if (!companies.has(foldCompany(name))) add(name);
  const linked = new Set(people.flatMap(person => (person.clientId ? [person.clientId] : [])));
  for (const client of listRecords(state, 'venture-client', ventureId)) {
    const name = typeof client.name === 'string' ? bareName(client.name) : '';
    if (name && clientIsPerson(client.id, client.taxId, name, linked, work)) add(name);
  }
  return { words, phrases, longest, work, complete };
}

/**
 * Whether a client is a person, not a company: someone in the network is that client; or, with no tax id, a name of two
 * to four words, none a business word (Pvt, Foods, Cafe, Studio...) nor a word of any company or title in the network.
 */
function clientIsPerson(id: string, taxId: string | null, name: string, linked: ReadonlySet<string>, work: ReadonlySet<string>): boolean {
  if (linked.has(id)) return true;
  if (taxId) return false;
  const parts = (name.match(TOKEN) ?? []).map(tokenKey);
  return parts.length >= 2 && parts.length <= 4 && !parts.some(part => BUSINESS.has(part) || work.has(part)) && !/&/.test(name);
}

/** Text with every name the mask holds as "[name]": a full name as a whole (the longest first), else a name part. */
export function maskNames(text: string, mask: Pick<NameMask, 'words' | 'phrases' | 'longest'>): string {
  const tokens = [...text.matchAll(TOKEN)];
  if (!tokens.length) return text;
  let out = '', from = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    let span = 0;
    for (let n = Math.min(mask.longest, tokens.length - i); n >= 2 && !span; n -= 1) {
      if (mask.phrases.has(tokens.slice(i, i + n).map(token => tokenKey(token[0])).join(' '))) span = n;
    }
    if (!span && mask.words.has(tokenKey(tokens[i][0]))) span = 1;
    if (!span) continue;
    const last = tokens[i + span - 1];
    out += `${text.slice(from, tokens[i].index)}[name]`;
    from = last.index! + last[0].length;
    i += span - 1;
  }
  return out + text.slice(from);
}

const NO_NAMES: NameMask = { words: new Set(), phrases: new Set(), longest: 0, work: new Set(), complete: true };

/**
 * The fields with masked made, as a search sends and quotes them. In titles, companies and earlier roles only the
 * person's own name is masked (full name and parts). In notes and meeting titles the search's mask is used too: every
 * full name in the network, single name parts that are no company or title word, and the person's own name (its single
 * parts only where they are no company or title word either); withheld when the mask is incomplete. Then emails, phone
 * numbers and protected words, everywhere.
 */
export function maskFields(person: PersonRecord, fields: readonly FieldValue[], names: NameMask = NO_NAMES): FieldValue[] {
  const keys = namesOf(person).map(nameKeys);
  const phrases = new Set(keys.flatMap(key => key.phrases));
  const longest = Math.max(names.longest, ...[...phrases].map(phrase => phrase.split(' ').length), 0);
  const parts = keys.flatMap(key => key.parts);
  const ownWork = { words: new Set(parts), phrases, longest };
  const ownNotes = { words: new Set(parts.filter(part => !names.work.has(part))), phrases, longest };
  const finish = (text: string) => tidyWords(maskProtected(maskContacts(text)));
  return fields.map(item => {
    if (item.field === 'note' || item.field === 'meeting') {
      if (!names.complete) return { ...item, masked: '' };
      return { ...item, masked: finish(maskNames(maskNames(item.text, names), ownNotes)) };
    }
    return { ...item, masked: finish(maskNames(item.text, ownWork)) };
  });
}

/**
 * The fields a search reads about one person, each once: their title and company now, their earlier roles, what the
 * owner said about them (owner's words), and the titles of meetings with them. Titles, companies and meeting titles
 * were written by other people (outside words); web lines from "Before you write" are not read: a search is over the
 * owner's own network. names: when given, the fields come back masked (maskFields); without, unmasked, for code only.
 */
export function searchFields(person: PersonRecord, imports: ReadonlyMap<string, NetworkImportRecord>, names?: NameMask): FieldValue[] {
  const out: FieldValue[] = [];
  const push = (field: SearchField, text: string | null | undefined, source: string, outside: boolean) => {
    const words = tidyWords(text ?? '');
    if (!words || out.some(item => item.field === field && item.text === words)) return;
    out.push({ field, text: words, source, outside, guarded: namesProtectedTrait(words) });
  };
  if (person.role) {
    push('title', person.role.title, sourceWords(person.role.source, imports), true);
    push('company', person.role.company, sourceWords(person.role.source, imports), true);
  }
  for (const role of person.roles) push('earlier-role', roleWords(role.title, role.company), sourceWords(role.source, imports), true);
  for (const fact of person.facts) {
    if (fact.kind === 'you-said') push('note', fact.value, sourceWords(fact.source, imports), false);
    // A link's note without the other person's name in front of it ("Rahul Mehta, you said: ...").
    if (fact.kind === 'link') push('note', (fact.detail as { note?: unknown } | null)?.note as string | undefined, sourceWords(fact.source, imports), false);
    if (fact.kind !== 'meeting') continue;
    const titles = [fact.value, ...((fact.detail as { titles?: unknown } | null)?.titles as string[] | undefined ?? [])];
    for (const title of titles) if (typeof title === 'string' && title !== 'Meeting') push('meeting', title, sourceWords(fact.source, imports, false), true);
  }
  return names ? maskFields(person, out, names) : out;
}

/** A quote as code compares it: one Unicode form, lower case, spaces folded, quote marks at the ends taken off. */
export const quoteKey = (text: string) => text.normalize('NFKC').toLowerCase().replace(/^[\s"'“”‘’«»]+|[\s"'“”‘’«»]+$/gu, '').replace(/\s+/gu, ' ').trim();
/** A quote or field as the word and boundary tests read it: mask placeholders taken out, so "[name]" alone holds nothing. */
const bareKey = (text: string) => quoteKey(text.replace(/\[(?:name|email|phone|left out)\]/giu, ' '));

const EDGE_BEFORE = /[\p{L}\p{M}\p{N}]$/u;
const EDGE_AFTER = /^[\p{L}\p{M}\p{N}]/u;
/** True when a quote holds one whole word of three letters or more (marks do not count as letters). */
const holdsWord = (quote: string) => (quote.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).some(part => (part.match(/\p{L}/gu) ?? []).length >= 3);

/**
 * The field value of that field name whose text holds the quote on word boundaries, or null. Mask placeholders are
 * taken out of both first; a quote that then holds no whole word of three letters or more, or that names a protected
 * trait, holds nothing.
 */
export function holdingField<F extends { field: string; text: string }>(fields: readonly F[], field: string, quote: string): F | null {
  const want = bareKey(quote);
  if (!holdsWord(want) || namesProtectedTrait(want)) return null;
  return fields.find(item => {
    if (item.field !== field) return false;
    const hay = bareKey(item.text);
    for (let at = hay.indexOf(want); at >= 0; at = hay.indexOf(want, at + 1)) {
      if (!EDGE_BEFORE.test(hay.slice(0, at)) && !EDGE_AFTER.test(hay.slice(at + want.length))) return true;
    }
    return false;
  }) ?? null;
}

/** The fields as a search sends and quotes them: masked, and none that holds a protected trait. */
export const quotable = (fields: readonly FieldValue[]) => fields.filter(item => !item.guarded && item.masked).map(item => ({ field: item.field, text: item.masked!, source: item.source }));

// ---------------------------------------------------------------------------
// Filters and code checks
// ---------------------------------------------------------------------------

const pad = (value: number) => String(value).padStart(2, '0');

/** The day so many calendar months before day (the 31st becomes the month's last day). */
export function monthsBefore(day: IsoDate, months: number): IsoDate {
  const [year, month, date] = day.split('-').map(Number);
  const total = year * 12 + (month - 1) - months;
  const y = Math.floor(total / 12), m = (total % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(Math.min(date, last))}`;
}

/** The last day the owner and this person were in touch by mail, a meeting or LinkedIn messages, or null. */
export function lastTouch(person: PersonRecord): IsoDate | null {
  const signals = combinedSignals(person);
  return [signals.mail?.last, signals.messages?.last, signals.meetings?.last].filter((day): day is string => !!day).sort().at(-1) ?? null;
}

const BAND_SAYS: Readonly<Record<Exclude<TieBand, 'cold'>, string>> = Object.freeze({
  close: 'is close to you', 'know-well': 'is someone you know well', know: 'is someone you know', 'met-once': 'is someone you have met',
});
const BAND_LABEL: Readonly<Record<Exclude<TieBand, 'cold'>, string>> = Object.freeze({
  close: 'Close to you', 'know-well': 'You know them well', know: 'You know them', 'met-once': 'You have met them',
});

/** The traits a search's exact filters add, after the AI's traits, so the screens can list what was looked for. */
export function filterTraits(filters: Pick<SearchFilters, 'clients' | 'quietMonths' | 'knownAtLeast'>): { id: string; label: string }[] {
  return [
    ...(filters.clients === 'only' ? [{ id: 'f-client', label: 'Your client' }] : filters.clients === 'none' ? [{ id: 'f-client', label: 'Not your client' }] : []),
    ...(filters.quietMonths ? [{ id: 'f-quiet', label: `Not in touch for ${plural(filters.quietMonths, 'month', 'months')}` }] : []),
    ...(filters.knownAtLeast ? [{ id: 'f-band', label: BAND_LABEL[filters.knownAtLeast] }] : []),
  ];
}

/** The exact filters on one person: their checks when every one holds, else null. The checks' words are code's. */
export function filterChecks(person: PersonRecord, tie: TieRecord | undefined, filters: SearchFilters, today: IsoDate, venture: VentureRecord): TraitCheck[] | null {
  const checks: TraitCheck[] = [];
  if (filters.clients === 'only') {
    if (!person.clientId) return null;
    checks.push({ traitId: 'f-client', check: 'yes', quote: 'is in your clients', field: 'client' });
  } else if (filters.clients === 'none') {
    if (person.clientId) return null;
    checks.push({ traitId: 'f-client', check: 'yes', quote: 'is not one of your clients', field: 'client' });
  }
  if (filters.quietMonths) {
    const last = lastTouch(person);
    if (last && last > monthsBefore(today, filters.quietMonths)) return null;
    const order = venture.country?.dateOrder ?? 'day-month-year';
    checks.push({ traitId: 'f-quiet', check: 'yes', quote: last ? `was last in touch on ${formatVentureDate(last, order)}` : 'has no mail, meeting or message on file', field: 'last-contact' });
  }
  if (filters.knownAtLeast) {
    const band = tie?.band ?? 'cold';
    if (RANK[band] < RANK[filters.knownAtLeast]) return null;
    checks.push({ traitId: 'f-band', check: 'yes', quote: BAND_SAYS[band as Exclude<TieBand, 'cold'>], field: 'tie' });
  }
  return checks;
}

/** How many of a search's traits have one of their words in one of their fields: what gathering ranks candidates by. */
export function termHits(fields: readonly FieldValue[], filters: Pick<SearchFilters, 'terms'>): number {
  return filters.terms.filter(term => fields.some(item => term.fields.includes(item.field) && term.words.some(word => fold(item.text).includes(fold(word))))).length;
}

/**
 * Each trait checked by code alone (a saved search's re-run): yes when one of its words is in one of its fields, read
 * on the unmasked words; the quote is that whole field as masked, and once fields are masked a field whose masked text
 * holds no real word (only "[name]") supports nothing. A field holding a protected trait never counts. Unmasked fields
 * give the fit with no quotes. halves: the score in halves, 2 for each yes.
 */
export function termChecks(fields: readonly FieldValue[], filters: Pick<SearchFilters, 'terms'>): { checks: TraitCheck[]; halves: number } {
  let halves = 0;
  const checks = filters.terms.map((term): TraitCheck => {
    const hit = fields.find(item => !item.guarded && term.fields.includes(item.field) && term.words.some(word => fold(item.text).includes(fold(word)))
      && (item.masked === undefined || !!holdingField([{ field: item.field, text: item.masked }], item.field, item.masked)));
    if (!hit) return { traitId: term.traitId, check: 'not-supported', quote: null, field: null };
    halves += 2;
    return { traitId: term.traitId, check: 'yes', quote: hit.masked ?? null, field: hit.field };
  });
  return { checks, halves };
}

/** Fit in basis points: the checked scores' sum, every trait weighing the same; with no traits, a full fit. Whole numbers only. */
export function fitOf(halves: number, traits: number): number {
  return traits === 0 ? FULL_FIT_BP : Math.floor((halves * FULL_FIT_BP) / (2 * traits));
}

// ---------------------------------------------------------------------------
// Ranks and views
// ---------------------------------------------------------------------------

/** What a search's views read, once: the people here, their ties and paths, the imports, and each person's newest pipeline stage. */
export type ViewContext = {
  state: State; venture: VentureRecord; today: IsoDate; people: ReadonlyMap<string, PersonRecord>; ties: ReadonlyMap<string, TieRecord>;
  paths: PathIndex; imports: ReadonlyMap<string, NetworkImportRecord>; stages: ReadonlyMap<string, PipelineStage>; best: Map<string, WarmPathView | null>;
  /** The search's name mask, built on first use and once only (nameMask). */
  names: () => NameMask;
};

export function viewContext(state: State, venture: VentureRecord, today: IsoDate): ViewContext {
  const ties = new Map<string, TieRecord>();
  for (const tie of listRecords(state, 'venture-tie', venture.id)) ties.set(tie.personId, tie);
  // Paths, pipeline stages and the name mask are worked out on first use only: a saved search's re-run in an import
  // needs none of them unless someone matches.
  let mask: NameMask | undefined, paths: PathIndex | undefined, stages: Map<string, PipelineStage> | undefined;
  return {
    state, venture, today, people: new Map(listPeople(state, venture.id).map(person => [person.id, person])), ties,
    get paths() { return (paths ??= pathIndex(state, venture.id)); },
    imports: new Map(listRecords(state, 'venture-network-import', venture.id).map(record => [record.id, record])),
    get stages() {
      if (!stages) {
        stages = new Map();
        for (const card of cardsOf(state, venture, today)) stages.set(card.person?.id ?? card.personId, card.stage);
      }
      return stages;
    },
    best: new Map(),
    names: () => (mask ??= nameMask(state, venture.id)),
  };
}

/** A person still here and not hidden, or null. */
export function usable(view: ViewContext, personId: string | null): PersonRecord | null {
  const person = personId ? view.people.get(personId) : undefined;
  return person && !person.hidden ? person : null;
}

/** The strongest warm path to a person, worked out once per view. */
export function pathOf(view: ViewContext, personId: string): WarmPathView | null {
  if (!view.best.has(personId)) view.best.set(personId, bestPath(view.paths, personId));
  return view.best.get(personId)!;
}

/** A path as a rank: none 0, a possible path 1, a confirmed one 2 and up by the strength of its weaker leg. */
export function pathScore(path: WarmPathView | null): number {
  if (!path) return 0;
  return path.confirmed ? 2 + RANK[path.strength] : 1;
}

/** Results in their order: the owner's network first, by fit, then path, then name; then web pages, by fit, then address. */
export function rankResults(view: ViewContext, results: readonly NetworkSearchResult[]): NetworkSearchResult[] {
  const keyed = results.map(result => {
    const person = result.personId ? view.people.get(result.personId) : undefined;
    return { result, web: result.personId === null, path: person ? pathScore(pathOf(view, person.id)) : 0, name: fold(person?.name), id: person?.id ?? result.url ?? '' };
  });
  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  keyed.sort((a, b) => Number(a.web) - Number(b.web) || b.result.fitBp - a.result.fitBp || b.path - a.path || order(a.name, b.name) || order(a.id, b.id));
  return keyed.map(item => item.result);
}

/**
 * People in a cheap order for gathering (no warm paths worked out, so a network of 20,000 stays quick): by score, then
 * how well the owner knows them, then name.
 */
export function orderPeople<T>(view: ViewContext, items: readonly T[], score: (item: T) => number, person: (item: T) => PersonRecord): T[] {
  const keyed = items.map(item => ({ item, score: score(item), band: RANK[view.ties.get(person(item).id)?.band ?? 'cold'], name: fold(person(item).name), id: person(item).id }));
  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  keyed.sort((a, b) => b.score - a.score || b.band - a.band || order(a.name, b.name) || order(a.id, b.id));
  return keyed.map(entry => entry.item);
}

/** The network results not shown yet that fit, of people still here and not hidden, in rank order. */
export function unshownFitting(view: ViewContext, search: NetworkSearchRecord): NetworkSearchResult[] {
  const shown = new Set(search.shown);
  return rankResults(view, search.results.filter(result => result.fitBp > 0 && result.personId !== null && !shown.has(result.personId) && usable(view, result.personId)));
}

/** 'Asha' from 'Asha Rao'; an address or a phone stays whole. */
export const firstName = (name: string) => (name.includes('@') || name.startsWith('+') || name.startsWith('http') ? name : name.trim().split(/\s+/)[0] || name);

const FILTER_SOURCE: Readonly<Record<string, string>> = Object.freeze({
  client: 'Your clients in Chausar', 'last-contact': 'Worked out by Chausar from your mail, calendar and messages', tie: 'How well you know them, worked out by Chausar',
});

/** Where a check's quote came from, in words. */
function checkSource(fields: readonly FieldValue[], check: TraitCheck): string | null {
  if (check.check === 'not-supported' || !check.quote || !check.field) return null;
  if (!FIELDS.has(check.field)) return FILTER_SOURCE[check.field] ?? null;
  return holdingField(quotable(fields), check.field, check.quote)?.source ?? 'Your network, when you searched';
}

function clause(field: string, first: string, quote: string, source: string): string {
  switch (field) {
    case 'title': return `${first}'s role reads "${quote}" (${source})`;
    case 'company': return `${first}'s company reads "${quote}" (${source})`;
    case 'earlier-role': return `${first}'s earlier role reads "${quote}" (${source})`;
    case 'note': return `your note on ${first} reads "${quote}" (${source})`;
    default: return `a meeting with ${first} was called "${quote}" (${source})`;
  }
}

/**
 * The "Why" line, written by code from the checked quotes and their sources: up to two quoted fields, in the order of
 * the traits; with none, the filters that hold. A result code alone checked says so.
 */
function whyLine(person: PersonRecord, fields: readonly FieldValue[], result: NetworkSearchResult): string {
  const first = firstName(person.name);
  const clauses: string[] = [];
  const seen = new Set<string>();
  for (const check of result.checks) {
    if (clauses.length >= 2) break;
    if (check.check === 'not-supported' || !check.quote || !check.field || !FIELDS.has(check.field)) continue;
    const key = `${check.field}\n${quoteKey(check.quote)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clauses.push(clause(check.field, first, check.quote, checkSource(fields, check)!));
  }
  if (!clauses.length) {
    for (const check of result.checks) if (check.check !== 'not-supported' && check.quote && check.field && !FIELDS.has(check.field) && clauses.length < 2) clauses.push(`${first} ${check.quote}`);
  }
  const line = clauses.length ? `Why: ${clauses.join('; ')}.` : 'Why: what you asked for, by the filters you set.';
  return result.by === 'code' && result.added ? `${line} ${CODE_CHECKED}` : line;
}

/** A web result's line: always "not confirmed", with its page's title and site, and the words of it that were checked. */
function webWhy(result: NetworkSearchResult): string {
  const page = result.page ?? { title: result.url ?? 'A public page', text: '', host: '' };
  const quote = result.checks.find(check => check.check !== 'not-supported' && check.quote)?.quote;
  return `From a public page, not confirmed: "${page.title}" (${page.host}).${quote ? ` It reads "${quote}".` : ''}`;
}

/** One result as the screens show it, or null when its person is gone or hidden. */
export function resultView(view: ViewContext, search: NetworkSearchRecord, result: NetworkSearchResult): SearchResultView | null {
  const labels = new Map(search.traits.map(item => [item.id, item.label]));
  if (result.personId === null) {
    return {
      person: null, url: result.url, fitBp: result.fitBp, why: webWhy(result),
      checks: result.checks.map(item => ({ trait: labels.get(item.traitId) ?? item.traitId, check: item.check, quote: item.quote, source: item.check === 'not-supported' ? null : result.url })),
      path: null, inPipeline: null, cold: true, receiptId: null, linkedin: null,
    };
  }
  const person = usable(view, result.personId);
  if (!person) return null;
  const fields = searchFields(person, view.imports, view.names());
  return {
    person: summaries(view.state, view.venture, [person])[0], url: null, fitBp: result.fitBp, why: whyLine(person, fields, result),
    checks: result.checks.map(item => ({ trait: labels.get(item.traitId) ?? item.traitId, check: item.check, quote: item.quote, source: checkSource(fields, item) })),
    path: pathOf(view, person.id), inPipeline: view.stages.get(person.id) ?? null, cold: false,
    // 4D4: the tie's receipt and the LinkedIn address, so a result card opens them itself.
    receiptId: view.ties.get(person.id)?.id ?? null, linkedin: person.handles.linkedinUrl,
  };
}

/** A search as the screens show it, with one page of results. */
export function searchView(view: ViewContext, search: NetworkSearchRecord, page: readonly NetworkSearchResult[], extra: Pick<NetworkSearchView, 'summary' | 'more' | 'webLine' | 'web'>): NetworkSearchView {
  return {
    id: search.id, text: search.text, traits: search.traits.map(item => ({ id: item.id, label: item.label })),
    results: page.flatMap(result => { const shown = resultView(view, search, result); return shown ? [shown] : []; }), ...extra,
  };
}

/** How many fitting network results a search holds of people the owner knows well or closer. */
export function knownWell(view: ViewContext, results: readonly NetworkSearchResult[]): number {
  return results.filter(result => result.fitBp > 0 && usable(view, result.personId) && ['close', 'know-well'].includes(view.ties.get(result.personId!)?.band ?? '')).length;
}

// ---------------------------------------------------------------------------
// Saved searches
// ---------------------------------------------------------------------------

/** venture.network.saveSearch { searchId, name } (prepare, inside the app): keeps a search by name; saving again renames it. */
export async function networkSaveSearch(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ search: SavedSearchView }> {
  requireAppChannel(ctx, 'venture.network.saveSearch');
  const body = exactPayload(payload, ['searchId', 'name'], ['searchId', 'name']);
  const searchId = identifier(body.searchId, 'searchId');
  const name = redactSecrets(singleLine(body.name, 'The name', { min: 1, max: 60 }));
  return ventureAction(deps, ctx, 'prepare', 'network.saveSearch', tx => {
    const search = tx.find('venture-network-search', searchId);
    check(search, 'INVALID_VENTURE_REQUEST', 'This search is not in this business.');
    const saved = tx.replace<NetworkSearchRecord>({ ...search, saved: { name, at: tx.now } });
    return { search: { id: saved.id, name, at: tx.now } };
  });
}

/**
 * The people a saved search would take in now, by code alone: everyone here and not hidden, not in the search yet,
 * whom the exact filters let through and whose fields hold the words of at least half the traits (any, with no
 * traits). At most 200, best first.
 */
function codeMatches(view: ViewContext, filters: SearchFilters, exclude: ReadonlySet<string>): Omit<NetworkSearchResult, 'by' | 'added'>[] {
  // Code first on the unmasked words, over everyone; only the best 200 who match are masked, for the quotes they show.
  const first: { person: PersonRecord; fields: FieldValue[]; exact: TraitCheck[]; fitBp: number }[] = [];
  for (const person of view.people.values()) {
    if (person.hidden || exclude.has(person.id)) continue;
    const exact = filterChecks(person, view.ties.get(person.id), filters, view.today, view.venture);
    if (!exact) continue;
    const fields = searchFields(person, view.imports);
    const fitBp = fitOf(termChecks(fields, filters).halves, filters.terms.length);
    if (filters.terms.length && fitBp < MATCH_FROM_BP) continue;
    first.push({ person, fields, exact, fitBp });
  }
  const out: { person: PersonRecord; result: Omit<NetworkSearchResult, 'by' | 'added'> }[] = [];
  for (const item of orderPeople(view, first, entry => entry.fitBp, entry => entry.person).slice(0, MAX_CANDIDATES)) {
    const { checks, halves } = termChecks(maskFields(item.person, item.fields, view.names()), filters);
    const fitBp = fitOf(halves, filters.terms.length);
    if (filters.terms.length && fitBp < MATCH_FROM_BP) continue;
    out.push({ person: item.person, result: { personId: item.person.id, url: null, fitBp, checks: [...checks, ...item.exact], callId: null } });
  }
  return orderPeople(view, out, entry => entry.result.fitBp, entry => entry.person).map(entry => entry.result);
}

/**
 * After an import (network/import.ts, inside its transaction): job changes worked out again, and every saved search run
 * again in code only. Its new matches join the search as checked by code (added: this import), for the notice on Today.
 */
export function afterImportSearches(tx: VentureTx, record: NetworkImportRecord): void {
  writeJobChanges(tx);
  const saved = tx.list('venture-network-search').filter((search): search is NetworkSearchRecord & { filters: SearchFilters } => !!search.saved && !!search.filters);
  if (!saved.length) return;
  const venture = tx.venture!;
  const view = viewContext(tx.state, venture, localDayAt(tx.now, venture.country));
  let added = 0;
  for (const search of saved) {
    const inSearch = new Set(search.results.flatMap(result => (result.personId ? [result.personId] : [])));
    const matches = codeMatches(view, search.filters, inSearch);
    if (!matches.length) continue;
    tx.replace<NetworkSearchRecord>({ ...search, results: [...search.results, ...matches.map(match => ({ ...match, by: 'code' as const, added: record.id }))] });
    added += matches.length;
  }
  if (added) tx.emit('queue.changed', {});
}

/** After an import's Undo (network/import.ts, inside its transaction): the matches it added and the job changes it showed go. */
export function undoImportSearches(tx: VentureTx, importId: string): void {
  writeJobChanges(tx);
  let changed = false;
  for (const search of tx.list('venture-network-search')) {
    const results = search.results.filter(result => !(result.by === 'code' && result.added === importId));
    if (results.length === search.results.length) continue;
    tx.replace<NetworkSearchRecord>({ ...search, results });
    changed = true;
  }
  if (changed) tx.emit('queue.changed', {});
}

/** True when this import brought the person into the network (their first history entry is that import), not a merge into someone already here. */
const broughtIn = (person: PersonRecord, importId: string) => person.history[0]?.op === 'import' && person.history[0].from.includes(importId);

/**
 * Today's notice rows for saved searches (views/probes.ts): one per saved search with new people the owner has not seen,
 * "3 new people match your saved search "Pune skincare founders".", with Open (to the search) and Later. Only people the
 * import brought in count as new; someone already in the network who now matches waits in Find more without a notice.
 * A new import with more matches makes a new version, so a row put off with Later comes back for them. Reads no country,
 * so a business still in its interview has none and no crash.
 */
export function savedSearchRows(_deps: VentureDeps, _ctx: Context, state: State, venture: VentureRecord): W4RowItem[] {
  const people = new Map(listPeople(state, venture.id).map(person => [person.id, person]));
  const imports = new Map(listRecords(state, 'venture-network-import', venture.id).map(record => [record.id, record]));
  const rows: W4RowItem[] = [];
  for (const search of listRecords(state, 'venture-network-search', venture.id)) {
    if (!search.saved) continue;
    const shown = new Set(search.shown);
    const fresh = search.results.filter(result => {
      const person = result.by === 'code' && result.added && result.personId && !shown.has(result.personId) ? people.get(result.personId) : undefined;
      return !!person && !person.hidden && broughtIn(person, result.added!);
    });
    if (!fresh.length) continue;
    const newest = fresh.map(result => imports.get(result.added!)).filter((item): item is NetworkImportRecord => !!item).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
    const name = search.saved.name;
    rows.push({
      kind: 'notice', subject: `saved-search:${search.id}`, version: newest?.id ?? fresh[fresh.length - 1].added!, createdAt: newest?.at ?? search.at,
      title: 'New people for a saved search', line: `${plural(fresh.length, 'new person matches', 'new people match')} your saved search "${name}".`,
      actions: [{ id: 'later', label: 'Later', primary: false }, { id: 'open', label: 'Open the search', primary: true }],
      navigate: `Open your saved search "${name}" in Clients, Network.`,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Job changes a re-import shows
// ---------------------------------------------------------------------------

/** How a re-imported file is named in a job change's line. */
const JOB_SOURCE: Readonly<Partial<Record<NetworkImportKind, string>>> = Object.freeze({ 'linkedin-connections': 'LinkedIn export', 'contacts-csv': 'contacts file', vcard: 'phone contacts' });

/**
 * Every job change the network's files show: for each person, two role facts from two imports of the same kind of file
 * (a LinkedIn export, then a newer one), one after the other, whose companies differ. "Rahul moved from Ubtan Lab to
 * Neem Labs, LinkedIn export of 21 Oct", with the newer file as its source. A generic employer is no company.
 */
function jobChanges(state: State, venture: VentureRecord): { personId: string; value: string; source: string }[] {
  if (!venture.country) return [];
  const imports = new Map(listRecords(state, 'venture-network-import', venture.id).filter(record => !record.undoneAt).map(record => [record.id, record]));
  const out: { personId: string; value: string; source: string }[] = [];
  for (const person of listPeople(state, venture.id)) {
    const roles = person.facts.map((fact, index) => ({ fact, index, record: fact.kind === 'role' && fact.source.importId ? imports.get(fact.source.importId) : undefined }))
      .filter((item): item is { fact: PersonFact; index: number; record: NetworkImportRecord } => !!item.record)
      .sort((a, b) => a.record.at.localeCompare(b.record.at) || a.index - b.index);
    const byKind = new Map<NetworkImportKind, typeof roles>();
    for (const item of roles) byKind.set(item.record.importKind, [...(byKind.get(item.record.importKind) ?? []), item]);
    for (const [kind, list] of byKind) {
      for (let i = 1; i < list.length; i += 1) {
        const before = list[i - 1], after = list[i];
        if (before.record.id === after.record.id) continue;
        const from = (before.fact.detail as { company?: string | null } | null)?.company ?? null;
        const to = (after.fact.detail as { company?: string | null } | null)?.company ?? null;
        if (!foldCompany(from) || !foldCompany(to) || foldCompany(from) === foldCompany(to)) continue;
        const day = shortDay(localDayAt(after.record.at, venture.country), venture.country.dateOrder);
        out.push({
          personId: person.id, value: `${firstName(person.name)} moved from ${from} to ${to}, ${JOB_SOURCE[kind] ?? KIND_LABEL[kind]} of ${day}`,
          source: `${KIND_LABEL[kind]}, ${redactSecrets(after.record.fileName)}`,
        });
      }
    }
  }
  return out;
}

/** The engine's job-change evidence rows made exactly what the files show now: rows that still say the same are kept. */
function writeJobChanges(tx: VentureTx): void {
  const rows = tx.list('venture-evidence').filter(row => row.by === 'engine' && row.field === JOB_FIELD && row.subject.startsWith('person:'));
  const keep = new Set<string>();
  const add: EvidenceRecord[] = [];
  for (const change of jobChanges(tx.state, tx.venture!)) {
    const row = personEvidence(tx, { personId: change.personId, field: JOB_FIELD, value: change.value, source: change.source, ownerSaid: false });
    const same = rows.find(old => !keep.has(old.id) && old.subject === row.subject && old.value === row.value && old.source === row.source);
    if (same) keep.add(same.id);
    else add.push(row);
  }
  const stale = new Set(rows.filter(row => !keep.has(row.id)).map(row => row.id));
  if (stale.size) removeRecords(tx, record => record.kind === 'venture-evidence' && stale.has(record.id as string));
  for (const row of add) tx.put(row);
}

// ---------------------------------------------------------------------------
// Forget and Undo (network/forget.ts removePersonData)
// ---------------------------------------------------------------------------


/**
 * Erases the stored text of model calls (ids, digests, costs and times stay, as 4B2's note erasure does): the calls
 * named in ids, and any call test picks. Every stored text of the call goes: its payload, its error's message and any
 * other field whose name ends in Text (a response text, should one be kept). A call still waiting as a preview is marked
 * expired too, so it can never go. A call on its way out is left to finish, and a call another package already erased
 * (erasedAt set: 4B2's notes, 4E3's general Forget scrub) is left exactly as it is, so no text is erased twice and
 * nothing is written over an earlier erasure. Answers how many it erased.
 */
export function eraseCallText(tx: VentureTx, ids: ReadonlySet<string>, words: string, test: (call: { purpose: string; payloadText: string }) => boolean = () => false): number {
  let erased = 0;
  for (const call of tx.list('venture-model-call')) {
    if (call.erasedAt || call.status === 'dispatching' || !(ids.has(call.id) || test(call))) continue;
    const texts = Object.fromEntries(Object.entries(call).filter(([key, value]) => key.endsWith('Text') && typeof value === 'string').map(([key]) => [key, words]));
    tx.replace({
      ...call, ...texts, payloadText: words, ...(call.error ? { error: { ...call.error, message: words } } : {}), ...(call.status === 'preview' ? { status: 'expired' as const } : {}),
      erasedAt: tx.now,
    });
    erased += 1;
  }
  return erased;
}

/** A result with the checks whose quote names the forgotten taken back: not supported, and its fit worked out again. */
function withoutNamedQuotes(result: NetworkSearchResult, named: (text: unknown) => boolean): NetworkSearchResult {
  if (!result.checks.some(item => named(item.quote))) return result;
  const checks = result.checks.map(item => (named(item.quote) ? { ...item, check: 'not-supported' as const, quote: null, field: null } : item));
  const traits = checks.filter(item => item.traitId.startsWith('t'));
  const halves = traits.reduce((sum, item) => sum + (item.check === 'yes' ? 2 : item.check === 'partly' ? 1 : 0), 0);
  return { ...result, checks, fitBp: traits.length ? fitOf(halves, traits.length) : result.fitBp };
}

/**
 * Before network/forget.ts takes people out of search results and shown lists: the scoring calls that carried their
 * fields lose them from their lists. With Forget (erase) also: those calls' stored text, and that of every other search
 * call whose text names them, becomes ERASED_SEARCH_CALL; a quote anywhere that names them (a meeting title in someone
 * else's result) is taken back; a search whose words named them reads ERASED_SEARCH, the trait labels and words that
 * named them go, and its traits call is erased; web results whose page named them go. people: everyone going, with the
 * ids of anyone merged into them.
 */
export function removeFromSearches(tx: VentureTx, people: readonly PersonRecord[], options: { erase: boolean; mentionsName: (text: unknown) => boolean }): void {
  const ids = new Set(people.flatMap(person => [person.id, ...person.history.filter(entry => entry.op === 'merge' && entry.from[0]?.startsWith('person_')).map(entry => entry.from[0])]));
  if (!ids.size) return;
  const named = (text: unknown) => options.erase && options.mentionsName(text);
  const erase = new Set<string>();
  for (const search of tx.list('venture-network-search')) {
    let next: NetworkSearchRecord = search;
    const batches = (search.batches ?? []).map(batch => {
      if (!batch.people.some(id => ids.has(id))) return batch;
      if (options.erase) erase.add(batch.callId);
      return { ...batch, people: batch.people.filter(id => !ids.has(id)) };
    });
    if (search.batches && batches.some((batch, i) => batch !== search.batches![i])) next = { ...next, batches };
    for (const result of search.results) if (options.erase && result.personId && ids.has(result.personId) && result.callId) erase.add(result.callId);
    if (options.erase) {
      const kept = next.results.filter(result => !(result.personId === null && (named(result.page?.title) || named(result.page?.text) || named(result.url))));
      for (const result of next.results) if (!kept.includes(result) && result.callId) erase.add(result.callId);
      const results = kept.map(result => withoutNamedQuotes(result, named));
      if (results.length !== next.results.length || results.some((result, i) => result !== kept[i])) next = { ...next, results };
      const terms = next.filters?.terms.map(term => ({ ...term, words: term.words.filter(word => !named(word)) })).filter(term => term.words.length > 0);
      const says = named(next.text) || next.traits.some(item => named(item.label)) || (next.filters?.terms ?? []).some(term => term.words.some(named)) || named(next.saved?.name);
      if (says) {
        next = {
          ...next, text: named(next.text) ? ERASED_SEARCH : next.text, traits: next.traits.map(item => (named(item.label) ? { ...item, label: 'Erased' } : item)),
          ...(next.filters && terms ? { filters: { ...next.filters, terms } } : {}), saved: next.saved && named(next.saved.name) ? { ...next.saved, name: 'A saved search' } : next.saved,
        };
        if (next.traitsCallId) erase.add(next.traitsCallId);
      }
    }
    if (next !== search) tx.replace<NetworkSearchRecord>(next);
  }
  if (!options.erase) return;
  eraseCallText(tx, erase, ERASED_SEARCH_CALL, call => call.purpose === 'network-search' && named(call.payloadText));
}
