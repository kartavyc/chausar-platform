// Chausar venture launcher, network (Ink v2 wave 4, package 4D1): a calendar file (.ics) the owner exported, read by the
// pure extractor. Per attendee (but the owner) it keeps a meeting total: how many, how many small (SMALL_GROUP people or
// fewer), by month, first and last day, the newest few titles, and who else came to the small ones. DESCRIPTION and
// LOCATION are dropped and counted; cancelled events, events with more than MAX_GROUP people and events after the day
// the file is read (4D2) add nobody.
import type { IsoDate } from '../contracts.ts';
import {
  checkPeople, checkTimeZone, cleanText, compact, dayInZone, DROPPED, Drops, isoDay, MAX_GROUP, MAX_NAME, MAX_SUMMARY, MAX_PEOPLE, MAX_TITLES, normalEmail, Problems,
  SMALL_GROUP, sortedMonths, topWith, type ExtractOptions, type MeetingTally, type ProjectedPerson,
} from './extract-core.ts';
import { property, textValue, Unfolder } from './extract-contacts.ts';
import type { KindReader } from './extract-linkedin.ts';

type Attendee = { email: string; name: string | null };
type Event = { line: number; day: IsoDate | null; summary: string | null; people: Attendee[]; cancelled: boolean; started: boolean };

/** A DTSTART value as the owner's day: a UTC time ('Z') read in their zone, a floating or zoned time as written. */
function startDay(value: string, zone: string): IsoDate | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!match) return null;
  const day = isoDay(+match[1], +match[2], +match[3]);
  if (!day) return null;
  if (match[7] === 'Z') return dayInZone(Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +(match[6] ?? 0)), zone);
  return day;
}

/**
 * The calendar's owner: the addresses the owner gave, the X-WR-CALNAME address (Google names a primary calendar by its
 * owner's address), else the one address on more than half the events that list anyone (and on at least two).
 */
function ownersOf(given: readonly string[], calName: string | null, events: Event[]): Set<string> {
  const owners = new Set(given.map(address => normalEmail(address)).filter((address): address is string => !!address));
  const named = normalEmail(calName);
  if (named) owners.add(named);
  if (owners.size) return owners;
  const counts = new Map<string, number>();
  const listed = events.filter(event => event.people.length > 0);
  for (const event of listed) for (const person of event.people) counts.set(person.email, (counts.get(person.email) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const [top, next] = ranked;
  if (top && top[1] >= 2 && top[1] * 2 > listed.length && (!next || next[1] < top[1])) owners.add(top[0]);
  return owners;
}

/** A calendar file: meeting totals on every attendee but the owner. */
export function calendarReader(drops: Drops, problems: Problems, options: ExtractOptions, max: number): KindReader {
  const zone = checkTimeZone(options.timeZone ?? 'UTC');
  const today = options.today ?? dayInZone(Date.now(), zone) ?? '9999-12-31';
  const events: Event[] = [];
  let calName: string | null = null, current: Event | null = null, nested = 0, seenCalendar = false;
  const unfolder = new Unfolder((text, line) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (/^BEGIN:VCALENDAR$/i.test(trimmed)) { seenCalendar = true; return; }
    if (/^BEGIN:VEVENT$/i.test(trimmed)) { current = { line, day: null, summary: null, people: [], cancelled: false, started: false }; nested = 0; return; }
    if (/^END:VEVENT$/i.test(trimmed)) {
      const done = current as Event | null;
      if (done) {
        if (!done.started) problems.add(done.line, 'an event has no start date');
        else events.push(done);
      }
      current = null; return;
    }
    const prop = property(text, line);
    if (!prop) return;
    const event = current as Event | null;
    if (!event) { if (prop.name === 'X-WR-CALNAME') calName = textValue(prop); return; }
    // An alarm inside the event (BEGIN:VALARM) has its own DESCRIPTION, which is not the event's.
    if (prop.name === 'BEGIN') { nested += 1; return; }
    if (prop.name === 'END') { nested = Math.max(0, nested - 1); return; }
    if (nested > 0) return;
    switch (prop.name) {
      case 'DTSTART':
        event.started = true;
        event.day = startDay(prop.value, zone);
        if (!event.day) problems.add(prop.line, 'the event start date could not be read');
        break;
      case 'SUMMARY': event.summary = cleanText(textValue(prop), MAX_SUMMARY, drops); break;
      case 'DESCRIPTION': if (prop.value.trim()) drops.add(DROPPED.descriptions); break;
      case 'LOCATION': if (prop.value.trim()) drops.add(DROPPED.places); break;
      case 'STATUS': event.cancelled = /^cancel+ed$/i.test(prop.value.trim()); break;
      case 'ATTENDEE': case 'ORGANIZER': {
        const email = normalEmail(prop.value.replace(/^mailto:/i, ''));
        if (!email) break;
        const name = cleanText(prop.params.get('CN')?.join(', ') ?? null, MAX_NAME, drops);
        const known = event.people.find(person => person.email === email);
        if (known) known.name ??= name;
        else event.people.push({ email, name });
        break;
      }
      default: break;
    }
  }, max);
  return {
    line: (text, line) => unfolder.line(text, line),
    end() {
      unfolder.end();
      if (current) problems.add((current as Event).line, 'an event is never closed');
      if (!seenCalendar) { problems.add(1, 'this is not a calendar file (.ics): it has no BEGIN:VCALENDAR line'); return { rows: 0, people: [] }; }
      const owners = ownersOf(options.ownerAddresses ?? [], calName, events);
      type Entry = { person: ProjectedPerson; tally: MeetingTally | null; titles: { day: IsoDate; title: string }[]; with: Map<string, number> };
      const byEmail = new Map<string, Entry>();
      for (const event of events) {
        if (!event.day) continue;
        // A meeting still to come is no meeting yet (4D2): no tie, line or path comes from it.
        if (event.day > today) { drops.add(DROPPED.future); continue; }
        if (event.cancelled) { drops.add(DROPPED.cancelled); continue; }
        if (event.people.length > MAX_GROUP) { drops.add(DROPPED.bigEvents); continue; }
        const others = event.people.filter(person => !owners.has(person.email));
        const small = event.people.length <= SMALL_GROUP;
        for (const person of others) {
          const entry = byEmail.get(person.email) ?? { person: { line: event.line, rows: 0, emails: [person.email] }, tally: null, titles: [], with: new Map<string, number>() };
          entry.person.rows = (entry.person.rows ?? 0) + 1;
          if (!entry.person.name && person.name) entry.person.name = person.name;
          const tally: MeetingTally = entry.tally ?? { count: 0, small: 0, first: event.day, last: event.day, months: {}, titles: [] };
          tally.count += 1;
          if (small) tally.small += 1;
          if (event.day < tally.first) tally.first = event.day;
          if (event.day > tally.last) tally.last = event.day;
          const month = tally.months[event.day.slice(0, 7)] ?? [0, 0];
          month[0] += 1;
          if (small) month[1] += 1;
          tally.months[event.day.slice(0, 7)] = month;
          entry.tally = tally;
          if (event.summary) entry.titles.push({ day: event.day, title: event.summary });
          if (small) for (const other of others) if (other.email !== person.email) entry.with.set(other.email, (entry.with.get(other.email) ?? 0) + 1);
          byEmail.set(person.email, entry);
          checkPeople(byEmail.size, options.maxPeople ?? MAX_PEOPLE);
        }
      }
      const people = [...byEmail.values()].map(({ person, tally, titles, with: together }) => {
        const newest = [...titles].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)).map(item => item.title);
        const meetings: MeetingTally = { ...tally!, months: sortedMonths(tally!.months), titles: [...new Set(newest)].slice(0, MAX_TITLES) };
        const others = topWith(together);
        if (others) meetings.with = others;
        return compact({ ...person, meetings });
      });
      return { rows: events.length, people };
    },
  };
}
