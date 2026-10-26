// Chausar venture launcher, network (Ink v2 wave 4, package 4D1): LinkedIn's "Download your data" files, read by the
// pure extractor. Connections.csv gives one person a row (name, profile address, an email only where the member allowed
// it, company, position, the day they connected). Messages.csv gives, per person, how many messages went each way and
// when, and in how many conversations: CONTENT, SUBJECT and CONVERSATION TITLE are dropped and counted, never kept.
// Nothing here signs in to LinkedIn, reads a profile page or sends anything.
import type { IsoDate } from '../contracts.ts';
import {
  checkPeople, checkTimeZone, cleanText, compact, CsvReader, dayInZone, DROPPED, Drops, extractError, headerKey, MAX_COMPANY, MAX_GROUP, MAX_NAME, MAX_TITLE,
  MAX_PEOPLE, normalEmail, normalLinkedIn, parseDay, Problems, sortedMonths, tallyAdd,
  type CsvRow, type ExtractOptions, type MessageTally, type ProjectedPerson, type Tally,
} from './extract-core.ts';

/** A line handler and what the file came to once read. */
export type KindReader = { line(text: string, line: number, long: boolean): void; end(): { rows: number; people: ProjectedPerson[] } };

/** The header row (the first row naming every required column) and a column lookup; rows before it are skipped. */
function headerOf(row: CsvRow, required: readonly string[]): ((name: string) => number) | null {
  const keys = row.cells.map(headerKey);
  return required.every(name => keys.includes(name)) ? (name: string) => keys.indexOf(name) : null;
}

const cellOf = (row: CsvRow, index: number) => (index >= 0 ? row.cells[index] ?? '' : '');
const tooWide = (row: CsvRow, width: number) => row.cells.slice(width).some(cell => cell.trim() !== '');

/** LinkedIn's Connections.csv: one person a row; a Connected On date there but unreadable is a problem on its line. */
export function connectionsReader(drops: Drops, problems: Problems, options: ExtractOptions = {}): KindReader {
  const most = options.maxPeople ?? MAX_PEOPLE;
  let col: ((name: string) => number) | null = null, width = 0, rows = 0;
  const people: ProjectedPerson[] = [];
  const csv = new CsvReader(row => {
    if (!col) {
      col = headerOf(row, ['first name', 'last name']);
      width = row.cells.length;
      return;
    }
    rows += 1;
    if (tooWide(row, width)) { problems.add(row.line, 'the row has more cells than the header'); return; }
    const name = [cleanText(cellOf(row, col('first name')), MAX_NAME, drops), cleanText(cellOf(row, col('last name')), MAX_NAME, drops)].filter(Boolean).join(' ');
    const person: ProjectedPerson = { line: row.line };
    if (name) person.name = [...name].slice(0, MAX_NAME).join('');
    const url = cellOf(row, col('url')).trim();
    if (url) {
      const linkedin = normalLinkedIn(url);
      if (linkedin) person.linkedin = linkedin; else drops.add(DROPPED.badProfile);
    }
    const emailRaw = cellOf(row, col('email address')).trim();
    if (emailRaw) { const email = normalEmail(emailRaw); if (email) person.emails = [email]; else drops.add(DROPPED.badEmail); }
    const title = cleanText(cellOf(row, col('position')), MAX_TITLE, drops), company = cleanText(cellOf(row, col('company')), MAX_COMPANY, drops);
    if (title) person.title = title;
    if (company) person.company = company;
    const connectedRaw = cellOf(row, col('connected on')).trim();
    if (connectedRaw) {
      const connected = parseDay(connectedRaw, 'day-month-year');
      if (!connected) { problems.add(row.line, 'the Connected On date could not be read'); return; }
      person.connected = connected;
    }
    if (!person.linkedin && !person.emails) { drops.add(DROPPED.noHandle); return; }
    people.push(compact(person));
    checkPeople(people.length, most);
  }, problems);
  return {
    line: (text, line, long) => csv.line(text, line, long),
    end() {
      csv.end();
      if (!col) problems.add(1, 'this is not LinkedIn\'s Connections file: it has no First Name and Last Name columns');
      return { rows, people };
    },
  };
}

type Participant = { name: string | null; url: string | null; key: string };
type Message = { line: number; conversation: string; day: IsoDate; sender: Participant | null; recipients: Participant[] };

function participant(name: string | null, url: string | null): Participant | null {
  const key = url ?? (name ? `name:${name.toLowerCase()}` : null);
  return key ? { name, url, key } : null;
}

/** A DATE cell ('2026-10-01 09:31:12 UTC') as the owner's day; a bare date as written. */
function messageDay(raw: string, zone: string): IsoDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(?:UTC|GMT|Z)?$/i.exec(raw.trim());
  if (match) return dayInZone(Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +(match[6] ?? 0)), zone);
  return parseDay(raw, 'year-month-day');
}

/**
 * LinkedIn's Messages.csv. The owner is the person named by ownerProfile, else the one person in more conversations than
 * anyone else (and in at least two); when the export cannot tell (one conversation, or a tie), it refuses rather than
 * guess. Each other person gets a message tally: sent (the owner wrote), received (they wrote), copied (a group message
 * someone else wrote), by month, and their number of conversations.
 */
export function messagesReader(drops: Drops, problems: Problems, options: ExtractOptions): KindReader {
  const zone = checkTimeZone(options.timeZone ?? 'UTC');
  const most = options.maxPeople ?? MAX_PEOPLE;
  let col: ((name: string) => number) | null = null, width = 0;
  const messages: Message[] = [];
  const csv = new CsvReader(row => {
    if (!col) { col = headerOf(row, ['from', 'to', 'date']); width = row.cells.length; return; }
    if (tooWide(row, width)) { problems.add(row.line, 'the row has more cells than the header'); return; }
    if (cellOf(row, col('content')).trim()) drops.add(DROPPED.messageText);
    if (cellOf(row, col('subject')).trim() || cellOf(row, col('conversation title')).trim()) drops.add(DROPPED.messageSubjects);
    const day = messageDay(cellOf(row, col('date')), zone);
    if (!day) { problems.add(row.line, 'the DATE could not be read'); return; }
    const sender = participant(cleanText(cellOf(row, col('from')), MAX_NAME, drops), normalLinkedIn(cellOf(row, col('sender profile url'))));
    const names = cellOf(row, col('to')).split(',').map(name => cleanText(name, MAX_NAME, drops));
    const urls = cellOf(row, col('recipient profile urls')).split(/[\s,]+/).filter(Boolean).map(url => normalLinkedIn(url));
    const recipients: Participant[] = [];
    const paired = names.length === urls.length;
    const total = Math.max(names.filter(Boolean).length, urls.length);
    for (let i = 0; i < total; i += 1) {
      const found = participant(paired || urls.length === 0 ? names[i] ?? null : null, urls[i] ?? null);
      if (found) recipients.push(found);
    }
    const conversation = cleanText(cellOf(row, col('conversation id')), 120, drops) ?? `line:${row.line}`;
    messages.push({ line: row.line, conversation, day, sender, recipients });
  }, problems);
  return {
    line: (text, line, long) => csv.line(text, line, long),
    end() {
      csv.end();
      if (!col) { problems.add(1, 'this is not LinkedIn\'s Messages file: it has no FROM, TO and DATE columns'); return { rows: 0, people: [] }; }
      if (!messages.length) return { rows: 0, people: [] };
      const owner = ownerOf(messages, options.ownerProfile);
      const tallies = new Map<string, { person: ProjectedPerson; tally: Tally | null; conversations: Set<string> }>();
      for (const message of messages) {
        const others = [message.sender, ...message.recipients].filter((person): person is Participant => !!person && person.key !== owner);
        if (others.length > MAX_GROUP) { drops.add(DROPPED.bigMessages); continue; }
        const fromOwner = message.sender?.key === owner;
        for (const person of others) {
          if (!person.url) { drops.add(DROPPED.noHandle); continue; }
          const entry = tallies.get(person.key) ?? { person: { line: message.line, rows: 0, ...(person.name ? { name: person.name } : {}), linkedin: person.url }, tally: null, conversations: new Set<string>() };
          entry.person.rows = (entry.person.rows ?? 0) + 1;
          if (!entry.person.name && person.name) entry.person.name = person.name;
          entry.tally = tallyAdd(entry.tally, message.day, fromOwner ? 0 : person.key === message.sender?.key ? 1 : 2);
          entry.conversations.add(message.conversation);
          tallies.set(person.key, entry);
          checkPeople(tallies.size, most);
        }
      }
      const people = [...tallies.values()].map(({ person, tally, conversations }) => {
        const messagesTally: MessageTally = { ...tally!, months: sortedMonths(tally!.months), conversations: conversations.size };
        return compact({ ...person, messages: messagesTally });
      });
      return { rows: messages.length, people };
    },
  };
}

/** The owner of a messages export, or a refusal: Chausar never guesses who the owner is. */
function ownerOf(messages: Message[], ownerProfile: string | null | undefined): string {
  const told = normalLinkedIn(ownerProfile ?? null);
  const seen = new Map<string, Set<string>>();
  for (const message of messages) {
    for (const person of [message.sender, ...message.recipients]) {
      if (!person) continue;
      seen.set(person.key, (seen.get(person.key) ?? new Set<string>()).add(message.conversation));
    }
  }
  if (told) {
    if (seen.has(told)) return told;
    throw extractError('NETWORK_FILE_INVALID', 'The LinkedIn address you gave is not in this messages export. Check it, or import the export you downloaded yourself.');
  }
  const ranked = [...seen].map(([key, set]) => [key, set.size] as const).sort((a, b) => b[1] - a[1]);
  const [top, next] = ranked;
  if (top && top[1] >= 2 && (!next || next[1] < top[1])) return top[0];
  throw extractError('NETWORK_FILE_INVALID',
    'Chausar can\'t tell which person in this export is you, so it imports nothing rather than guess. Add your LinkedIn profile address and import it again.');
}
