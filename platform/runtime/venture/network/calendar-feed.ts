// Chausar venture launcher, network (Ink v2 wave 4, package 4E3; D-Network "read each morning"): the owner's private
// calendar address. venture.network.calendar { url } (approve, inside the app, desktop only) checks the address, reads
// it once through the network guard with redirects refused, and keeps it on the engine's secret shelf (the address
// itself reads the whole calendar, so only its host goes in the record). A Keeper job reads it again each morning from
// the journal sweep's tick and adds meeting facts the way a calendar file import does (4D1's import: past meetings
// only, cancelled and big ones dropped, nothing of a description or a place kept); each read's facts take the place
// of the last read's, so the network does not fill with copies. It also keeps the calls with people in the network
// that ended lately or end today, with no title or other attendee, so Today can ask for notes after each (C17).
import { createHash } from 'node:crypto';
import { authorize, check, ChausarError, type Context, type State } from '../../contracts.ts';
import type {
  CalendarFeedRecord, CalendarFeedView, IsoTime, KeeperRunRecord, NetworkImportRecord, PersonFact, PersonRecord, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { currentVenture, exactPayload, formatVentureDate, listRecords, requireAppChannel, requireVenture, ventureAction, type VentureTx } from '../records.ts';
import { localDayAt, localTimeAt, ventureTimeZone } from '../local-day.ts';
import { checkUrl, guardedFetch } from '../core/net-guard.ts';
import { extractText } from './extract.ts';
import { MAX_LINE_CHARS, SMALL_GROUP } from './extract-core.ts';
import { readImportText } from './projection.ts';
import { MAX_IMPORT_BYTES, planImport } from './import.ts';
import { forgottenIndex, networkKey } from './forget.ts';
import { clientsByEmail, derive, repoint, writePeople } from './people.ts';
import { recomputeTies } from './strength.ts';
import { decodeBytes } from './mail-text.ts';
import { count, fold, normalEmail, plural } from './text.ts';
import { checkConnectorFields, googleCalendarHost } from '../build/connector-truth.ts';
import { addDays } from './followups.ts';
import { localMidnight } from './pipeline.ts';

const SECRET = 'network:calendar' as const;
/** A feed read's import says where it came from by this start to its file name. */
export const FEED_FILE = 'Calendar feed, ';
/** The calls kept for "Add notes": those that ended in the last 2 days, or end in the next one. */
const KEEP_BEFORE_MS = 48 * 60 * 60_000;
const KEEP_AFTER_MS = 24 * 60 * 60_000;
/** The morning read happens at the first tick from this hour on the owner's clock, once a day. */
export const MORNING_HOUR = 6;
export const HOSTED_CALENDAR = 'Set your calendar address in the desktop app. It reads your calendar on your computer.';
/** Days and times are the owner's local ones, read from the business's country. */
export const NO_COUNTRY = 'Choose the country of your business first, so Chausar reads days and times where you are.';
export const CALENDAR_WORDS = Object.freeze({
  https: 'Use your calendar\'s private address, the one that starts with https:// or webcal:// and ends in .ics.',
  redirect: 'The calendar address sent Chausar somewhere else, and Chausar does not follow that for a calendar. Copy the private address again.',
  status: (status: number) => `The calendar address answered ${status}, so nothing was read. Copy the private address again.`,
  again: 'Chausar keeps your calendar address only while the app is open. Set it again under Connections to read your calendar.',
  removed: 'No calendar address. Chausar reads no calendar.',
  same: 'Nothing changed in your calendar since the last read.',
});

/** The address as the owner pasted it: webcal:// read as https://; only https, through the guard's own check. */
export function calendarUrl(raw: unknown): URL {
  check(typeof raw === 'string' && raw.trim().length > 0 && raw.length <= 2000, 'INVALID_VENTURE_REQUEST', CALENDAR_WORDS.https);
  const text = raw.trim().replace(/^webcals?:\/\//i, 'https://');
  check(/^https:\/\//i.test(text), 'NET_URL_REFUSED', CALENDAR_WORDS.https);
  return checkUrl(text);
}

export function calendarFeedOf(state: State, ventureId: string): CalendarFeedRecord | undefined {
  return listRecords(state, 'venture-calendar-feed', ventureId).at(-1);
}

/** The calendar address as the screens show it, in the engine's words. */
export function calendarView(deps: VentureDeps, venture: VentureRecord, record: CalendarFeedRecord | undefined): CalendarFeedView {
  if (!record || record.status === 'removed') return { set: false, host: null, lastRead: null, line: CALENDAR_WORDS.removed, nextRead: null };
  if (!deps.secrets.has(SECRET)) return { set: true, host: record.host, lastRead: record.lastRead, line: CALENDAR_WORDS.again, nextRead: null };
  return { set: true, host: record.host, lastRead: record.lastRead, line: record.line, nextRead: nextMorningRead(deps, venture, record.lastRead) };
}

/**
 * 4E4: when the morning read comes next (readDue below): six on the owner's clock on the day after the last read, or
 * today's six when nothing was read today yet and it is not six yet; past six with no read today, the next tick.
 */
function nextMorningRead(deps: VentureDeps, venture: VentureRecord, lastRead: IsoTime | null): IsoTime | null {
  if (!venture.country) return null;
  const now = deps.clock();
  const today = localDayAt(now, venture.country);
  const day = lastRead && localDayAt(lastRead, venture.country) >= today ? addDays(today, 1) : today;
  const at = new Date(Date.parse(localMidnight(day, venture)) + MORNING_HOUR * 3_600_000);
  return (at.getTime() < now.getTime() ? now : at).toISOString();
}

/** Reads the address once: GET through the guard, no redirect, at most 4 MB. */
async function fetchFeed(deps: VentureDeps, url: URL): Promise<string> {
  let answer;
  try {
    answer = await guardedFetch({ url: url.href, method: 'GET', maxRedirects: 0, maxBytes: MAX_IMPORT_BYTES, timeoutMs: 20_000, headers: { accept: 'text/calendar' } }, deps.net ?? {});
  } catch (error) {
    if ((error as { code?: string }).code === 'NET_TOO_MANY_REDIRECTS' || (error as { code?: string }).code === 'NET_REDIRECT_REFUSED') {
      throw new ChausarError('NET_REDIRECT_REFUSED', CALENDAR_WORDS.redirect);
    }
    throw error;
  }
  check(answer.status === 200, 'NET_FAILED', CALENDAR_WORDS.status(answer.status));
  return decodeBytes(answer.body, 'utf-8');
}

// ---------------------------------------------------------------------------
// The calls that ended lately, for "Add notes"
// ---------------------------------------------------------------------------

type Prop = { name: string; params: Map<string, string>; value: string };

/** Where a content line's name and parameters end: its first colon outside double quotes, by one pass; -1 when none. */
function colonOutsideQuotes(line: string): number {
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ':' && !quoted) return i;
  }
  return -1;
}

/** The content lines of an ICS file, unfolded, as name, parameters and value. */
function propsOf(text: string): Prop[] {
  const lines: string[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    // An unfolded line stops growing at MAX_LINE_CHARS: what is past it is never read.
    if (/^[ \t]/.test(raw) && lines.length) { if (lines[lines.length - 1].length < MAX_LINE_CHARS) lines[lines.length - 1] = (lines[lines.length - 1] + raw.slice(1)).slice(0, MAX_LINE_CHARS); }
    else lines.push(raw.slice(0, MAX_LINE_CHARS));
  }
  return lines.flatMap(line => {
    const colon = colonOutsideQuotes(line);
    if (colon <= 0) return [];
    const [name, ...params] = line.slice(0, colon).split(';');
    const map = new Map<string, string>();
    for (const param of params) {
      const eq = param.indexOf('=');
      if (eq > 0) map.set(param.slice(0, eq).toUpperCase(), param.slice(eq + 1).replace(/^"|"$/g, ''));
    }
    return [{ name: name.toUpperCase(), params: map, value: line.slice(colon + 1) }];
  });
}

/** The offset of a zone from UTC at an instant, in minutes, from the platform's own zone rules. */
function zoneOffset(ms: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).reduce<Record<string, number>>((out, part) => (part.type === 'literal' ? out : { ...out, [part.type]: Number(part.value) }), {});
  return Math.round((Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second) - ms) / 60_000);
}

/** A DATE-TIME value as an instant: a UTC time as it is, a time in a zone (or floating, in the business's zone) converted. Null for a day alone. */
function instantOf(prop: Prop | undefined, fallbackZone: string): number | null {
  if (!prop || prop.params.get('VALUE') === 'DATE') return null;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(prop.value.trim());
  if (!match) return null;
  const wall = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +(match[6] ?? 0));
  if (match[7] === 'Z') return wall;
  let zone = prop.params.get('TZID') ?? fallbackZone;
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); } catch { zone = fallbackZone; }
  const first = wall - zoneOffset(wall, zone) * 60_000;
  return wall - zoneOffset(first, zone) * 60_000;
}

/** An ICS duration (PT1H30M, P1D) in milliseconds, or null. */
function durationOf(value: string | undefined): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec((value ?? '').trim());
  if (!match) return null;
  return (((+(match[1] ?? 0) * 24 + +(match[2] ?? 0)) * 60 + +(match[3] ?? 0)) * 60 + +(match[4] ?? 0)) * 1000;
}

/**
 * The calls with people in the network that ended in the last 2 days or end in the next one: timed, not cancelled, of
 * ten people or fewer. Each is kept by an id made from its UID and start, with only its end and who of the network
 * came (by person id). Calls already kept keep whether the owner added notes or said no.
 */
export function recentCalls(text: string, people: readonly PersonRecord[], venture: VentureRecord, nowMs: number, before: CalendarFeedRecord['events'] = []): CalendarFeedRecord['events'] {
  const zone = ventureTimeZone(venture.country);
  const byEmail = new Map<string, string>();
  for (const person of people) for (const email of person.handles.emails) if (!byEmail.has(email)) byEmail.set(email, person.id);
  const out: CalendarFeedRecord['events'] = [];
  let event: Prop[] | null = null;
  for (const prop of propsOf(text)) {
    if (prop.name === 'BEGIN' && prop.value.toUpperCase() === 'VEVENT') { event = []; continue; }
    if (prop.name === 'END' && prop.value.toUpperCase() === 'VEVENT' && event) {
      const get = (name: string) => event!.find(item => item.name === name);
      const start = instantOf(get('DTSTART'), zone);
      const end = instantOf(get('DTEND'), zone) ?? (start !== null ? start + (durationOf(get('DURATION')?.value) ?? 60 * 60_000) : null);
      const people = event.filter(item => item.name === 'ATTENDEE' || item.name === 'ORGANIZER').map(item => normalEmail(item.value.replace(/^mailto:/i, ''))).filter((email): email is string => !!email);
      const cancelled = /^cancel+ed$/i.test(get('STATUS')?.value.trim() ?? '');
      const ids = [...new Set(people.map(email => byEmail.get(email)).filter((id): id is string => !!id))];
      if (start !== null && end !== null && !cancelled && new Set(people).size <= SMALL_GROUP && ids.length && end >= nowMs - KEEP_BEFORE_MS && end <= nowMs + KEEP_AFTER_MS) {
        const id = `ev_${createHash('sha256').update(`${get('UID')?.value ?? ''}\n${start}`).digest('hex').slice(0, 20)}`;
        const old = before.find(item => item.id === id);
        if (!out.some(item => item.id === id)) out.push({ id, endAt: new Date(end).toISOString(), personIds: ids, notesAt: old?.notesAt ?? null, declined: old?.declined ?? false });
      }
      event = null;
      continue;
    }
    if (event) event.push(prop);
  }
  return out.sort((a, b) => (a.endAt < b.endAt ? -1 : a.endAt > b.endAt ? 1 : 0));
}

// ---------------------------------------------------------------------------
// One read: meeting facts like a calendar file import, and the calls for "Add notes"
// ---------------------------------------------------------------------------

/** The earlier feed reads' imports of this business, not undone. */
const feedImports = (tx: VentureTx, except: string) => tx.list('venture-network-import').filter(record => record.importKind === 'calendar-ics' && record.fileName.startsWith(FEED_FILE) && !record.undoneAt && record.id !== except);

/**
 * Takes the earlier feed reads' facts off the people this read touched where this read says the same again (a meeting
 * total, which the new read counts whole, or the same name or address), and drops an earlier feed import that is left
 * owning nothing. So each person keeps one meeting total from the feed, the newest.
 */
function supersede(tx: VentureTx, importId: string, touched: readonly string[]): void {
  const earlier = new Set(feedImports(tx, importId).map(record => record.id));
  if (!earlier.size) return;
  const replace: PersonRecord[] = [];
  for (const id of touched) {
    const person = tx.find('venture-person', id);
    if (!person) continue;
    const fresh = new Set(person.facts.filter(fact => fact.source.importId === importId).map(fact => `${fact.kind}\n${fold(fact.value)}`));
    const said = (fact: PersonFact) => fact.kind === 'meeting' ? person.facts.some(other => other.source.importId === importId && other.kind === 'meeting') : fresh.has(`${fact.kind}\n${fold(fact.value)}`);
    const facts = person.facts.filter(fact => !(fact.source.importId && earlier.has(fact.source.importId) && said(fact)));
    if (facts.length !== person.facts.length) replace.push(derive({ ...person, facts }));
  }
  if (replace.length) writePeople(tx, { replace });
  const owning = new Set(tx.list('venture-person').flatMap(person => person.facts.map(fact => fact.source.importId)));
  const empty = new Set(feedImports(tx, importId).filter(record => !owning.has(record.id) && !(record.absorbed?.length) && !(record.before?.length)).map(record => record.id));
  if (empty.size) tx.state.conversations = tx.state.conversations.filter(record => !(record?.kind === 'venture-network-import' && empty.has(record.id)));
}

/** Writes Keeper's calendar-feed run in place of its last one, and says so. */
function keeperRun(tx: VentureTx, outcome: KeeperRunRecord['outcome'], line: string): void {
  const old = tx.list('venture-keeper-run').find(record => record.job === 'calendar-feed');
  const run: KeeperRunRecord = { ...tx.base('venture-keeper-run'), job: 'calendar-feed', outcome, line };
  if (old) tx.replace<KeeperRunRecord>({ ...run, id: old.id }); else tx.put<KeeperRunRecord>(run);
  tx.emit('keeper.ran', { jobs: ['calendar-feed'] });
}

/**
 * One read of the calendar, in the caller's transaction: the meeting facts as an import (the same file again adds
 * nothing), the earlier read's facts replaced, the ties worked out again, the calls for "Add notes" kept, the feed's
 * record and Keeper's run written. owners: the owner's own addresses, so they are never a person.
 */
export function readIntoNetwork(deps: VentureDeps, tx: VentureTx, input: { text: string; host: string; owners: string[] }): CalendarFeedRecord {
  const venture = tx.venture!;
  const today = localDayAt(tx.now, venture.country);
  const digest = createHash('sha256').update(`calendar-ics\n${input.text}`).digest('hex');
  const old = calendarFeedOf(tx.state, venture.id);
  let line: string;
  if (old && old.status === 'set' && old.digest === digest) {
    line = CALENDAR_WORDS.same;
  } else {
    let projection;
    try {
      projection = extractText('calendar-ics', input.text, { timeZone: ventureTimeZone(venture.country), today, ownerAddresses: input.owners });
    } catch (error) {
      const coded = error as { code?: string; message?: string };
      throw new ChausarError(coded.code ?? 'NETWORK_FILE_INVALID', coded.message ?? 'This is not a calendar Chausar can read. Nothing was imported.');
    }
    const parsed = readImportText('calendar-ics', JSON.stringify(projection), venture.country, today);
    const base = tx.base('venture-network-import');
    const plan = planImport({
      existing: listRecords(tx.state, 'venture-person', venture.id), entries: parsed.entries, kind: 'calendar-ics', importId: base.id, at: tx.now, today, by: tx.ctx.memberId,
      forgotten: forgottenIndex(listRecords(tx.state, 'venture-forgotten', venture.id), networkKey(deps)), clients: clientsByEmail(listRecords(tx.state, 'venture-client', venture.id)),
      newBase: () => tx.base('venture-person'),
    });
    writePeople(tx, { put: plan.put, replace: plan.replace, remove: plan.remove });
    for (const item of plan.absorbed) Object.assign(item.repointed, repoint(tx, item.person.id, item.into));
    tx.put<NetworkImportRecord>({
      ...base, importKind: 'calendar-ics', fileName: `${FEED_FILE}${input.host}`.slice(0, 200), digest, rows: parsed.rows, people: plan.people, merged: plan.merged,
      dropped: parsed.dropped, forgottenSkipped: plan.forgottenSkipped, undoneAt: null,
      ...(plan.absorbed.length ? { absorbed: plan.absorbed } : {}), ...(plan.before.length ? { before: plan.before } : {}),
    });
    supersede(tx, base.id, [...plan.put, ...plan.replace].map(person => person.id));
    recomputeTies(tx);
    line = `Read your calendar on ${formatVentureDate(today, venture.country.dateOrder)}: ${count(plan.people)} new, ${count(plan.merged)} already in your network.`;
  }
  const events = recentCalls(input.text, listRecords(tx.state, 'venture-person', venture.id), venture, Date.parse(tx.now), old?.events ?? []);
  // 4J7 (K6): the read answered; the connector truth reads this outcome, never the words.
  const fields = { host: input.host, status: 'set' as const, lastRead: tx.now, lastOutcome: 'answered' as const, digest, line, events };
  const record = old ? tx.replace<CalendarFeedRecord>({ ...old, ...fields }) : tx.put<CalendarFeedRecord>({ ...tx.base('venture-calendar-feed'), ...fields });
  keeperRun(tx, 'ok', `${line} ${events.length ? `${plural(events.length, 'call', 'calls')} with people you know lately or today.` : 'No calls with people you know lately.'}`);
  tx.emit('queue.changed', {});
  return record;
}

/** The owner's own addresses: the mailbox's, so a calendar names them as the owner, never as a person. */
function ownerAddresses(state: State, ventureId: string): string[] {
  const mailbox = listRecords(state, 'venture-mailbox', ventureId).at(-1);
  const email = normalEmail(mailbox?.user ?? null);
  return email ? [email] : [];
}

/**
 * venture.network.calendar { url } (approve, inside the app, desktop only): checks the private address, reads it once
 * through the guard (no redirect), then keeps it on the secret shelf and its host in the record, with the first read's
 * meeting facts. An empty url removes it: the address leaves the shelf and the calls go. Refusals keep nothing.
 */
export async function networkCalendar(deps: VentureDeps, ctx: Context, payload: unknown): Promise<CalendarFeedView> {
  requireAppChannel(ctx, 'venture.network.calendar');
  const body = exactPayload(payload, ['url'], ['url']);
  check(deps.host !== 'hosted-web', 'TIER_UNAVAILABLE', HOSTED_CALENDAR);
  authorize(deps.store, ctx, 'approve');
  check(requireVenture(deps.store.read()).country, 'INVALID_VENTURE_REQUEST', NO_COUNTRY);
  if (body.url === '') {
    return ventureAction(deps, ctx, 'approve', 'network.calendar', tx => {
      deps.secrets.delete(SECRET);
      const old = calendarFeedOf(tx.state, tx.venture!.id);
      if (old) tx.replace<CalendarFeedRecord>({ ...old, status: 'removed', digest: null, events: [], line: CALENDAR_WORDS.removed });
      tx.emit('queue.changed', {});
      return calendarView(deps, tx.venture!, undefined);
    });
  }
  const url = calendarUrl(body.url);
  // 4J7 (K6): Google Calendar's capability set names every field a feed read takes.
  if (googleCalendarHost(url.hostname)) checkConnectorFields('google-calendar', 'read-feed', Object.keys(body));
  requireVenture(deps.store.read());
  const text = await fetchFeed(deps, url);
  const view = await ventureAction(deps, ctx, 'approve', 'network.calendar', tx => {
    const record = readIntoNetwork(deps, tx, { text, host: url.hostname, owners: ownerAddresses(tx.state, tx.venture!.id) });
    return { record, venture: tx.venture! };
  });
  deps.secrets.set(SECRET, url.href);
  return calendarView(deps, view.venture, view.record);
}

/** Whether the morning read is due: a feed set, its last read on an earlier day, and the owner's clock past six. */
function readDue(state: State, venture: VentureRecord | null, now: Date): venture is VentureRecord {
  // The owner's morning is a local one: a business with no country yet (still in its interview) has none.
  if (!venture || !venture.country) return false;
  const feed = calendarFeedOf(state, venture.id);
  if (!feed || feed.status !== 'set') return false;
  const hour = Number(localTimeAt(now, venture.country).slice(11, 13));
  return hour >= MORNING_HOUR && (!feed.lastRead || localDayAt(feed.lastRead, venture.country) < localDayAt(now, venture.country));
}

/**
 * The morning read, from the journal sweep's tick (build/journal-sweep.ts), as a Keeper job: once a day from six on
 * the owner's clock, the calendar is read again into the network. With no address on the shelf (the app was opened
 * again since) the run says to set it again; a failed read is a failed run with its reason. Never throws.
 */
export async function readCalendarFeedDaily(deps: VentureDeps, ctx: Context): Promise<void> {
  try {
    const state = deps.store.read();
    const venture = currentVenture(state);
    const now = deps.clock();
    if (!readDue(state, venture, now) || deps.host === 'hosted-web') return;
    const address = deps.secrets.get(SECRET);
    if (!address) {
      const last = listRecords(state, 'venture-keeper-run', venture.id).find(record => record.job === 'calendar-feed');
      if (last?.line === CALENDAR_WORDS.again) return;
      await ventureAction(deps, ctx, 'prepare', 'keeper.calendar-feed', tx => keeperRun(tx, 'warn', CALENDAR_WORDS.again));
      return;
    }
    const url = calendarUrl(address);
    const text = await fetchFeed(deps, url);
    await ventureAction(deps, ctx, 'prepare', 'keeper.calendar-feed', tx => {
      if (readDue(tx.state, tx.venture, new Date(tx.now))) readIntoNetwork(deps, tx, { text, host: url.hostname, owners: ownerAddresses(tx.state, tx.venture!.id) });
    });
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message.replace(/\s+/g, ' ').slice(0, 200) : 'an unknown error';
    await ventureAction(deps, ctx, 'prepare', 'keeper.failed', tx => {
      keeperRun(tx, 'failed', `Chausar could not read your calendar today: ${reason}`);
      const feed = calendarFeedOf(tx.state, tx.venture!.id);
      if (feed) tx.replace<CalendarFeedRecord>({ ...feed, lastRead: tx.now, lastOutcome: 'failed', line: `The last read did not work: ${reason}` });
    }).catch(() => { /* Nothing more can be written now; the next tick tries again. */ });
  }
}
