// Chausar venture launcher, network (Ink v2 wave 4, package 4D1): the pure core of the extractor that reads the owner's
// own files where they are: in the desktop's worker process, in the engine as a second guard, and later in the hosted
// app's browser (4D4). No Node or browser API is used here beyond Intl, so the same code runs in all three. It splits
// text into lines with a length cap, reads CSV rows with the line each starts on, cleans cells (hidden characters,
// formula signs, text that could not be read), and puts handles in one spelling. Nothing here fetches or stores.
import type { IsoDate, NetworkImportKind } from '../contracts.ts';
import { redactUrl } from '../core/secrets.ts';

export const PROJECTION_FORMAT = 'chausar-network/1';
/** The longest line read; a CSV row longer is refused, a longer vCard, calendar or mail line is cut. */
export const MAX_LINE_CHARS = 65_536;
/** The most cells one CSV row may have (contacts exports run to about 90). */
export const MAX_CELLS = 1_000;
/** The most people one file may name once read; past it the read stops (the engine then takes at most 20,000). */
export const MAX_PEOPLE = 50_000;
/** A meeting, mail or message with more people than this adds nobody: it is a list, not people the owner knows. */
export const MAX_GROUP = 25;
/** A meeting or mail with this many people or fewer counts as small: its people met or wrote together. */
export const SMALL_GROUP = 10;
/** How many people one person's "with" list keeps, most often first. */
export const MAX_WITH = 20;
/** How many meeting titles one person keeps, newest first. */
export const MAX_TITLES = 5;
export const MAX_NAME = 120;
export const MAX_COMPANY = 120;
export const MAX_TITLE = 160;
export const MAX_SUMMARY = 200;

/** Mail or LinkedIn messages with one person: by direction (sent, received, copied), first and last day, and by month. */
export type Tally = { sent: number; received: number; copied: number; first: IsoDate; last: IsoDate; months: Record<string, [number, number, number]> };
/** with: who else was on the small mails; between (4D2): who this person exchanged a mail with, one of the two its sender. */
export type MailTally = Tally & { with?: string[]; between?: string[] };
export type MessageTally = Tally & { conversations: number };
/** Meetings with one person: how many, how many of SMALL_GROUP people or fewer, by month, the newest titles, who else came. */
export type MeetingTally = { count: number; small: number; first: IsoDate; last: IsoDate; months: Record<string, [number, number]>; titles: string[]; with?: string[] };
/**
 * What a file says about one person, as the extractor sends it: who they are, and the totals for mail, meetings and
 * messages. line: the source line of the first row about them; rows: how many rows mention them. Empty fields are left out.
 */
export type ProjectedPerson = {
  line: number;
  rows?: number;
  name?: string;
  emails?: string[];
  phones?: string[];
  linkedin?: string;
  title?: string;
  company?: string;
  connected?: IsoDate;
  contact?: true;
  mail?: MailTally;
  messages?: MessageTally;
  meetings?: MeetingTally;
};
/** What the extractor sends: what Chausar keeps from one file, and what it dropped, counted. */
export type Projection = { format: typeof PROJECTION_FORMAT; kind: NetworkImportKind; rows: number; dropped: [string, number][]; people: ProjectedPerson[] };
/**
 * ownerAddresses: the owner's own email addresses (mail needs them; a calendar uses them). ownerProfile: the owner's
 * LinkedIn address, when the messages export alone cannot tell who the owner is. timeZone: the owner's zone, for the day
 * of a time written in UTC. maxMessages: the mail cap (tests lower it). today: the day the file is read, in that zone
 * (by this computer's clock when absent); a meeting after it is dropped and counted (4D2).
 */
export type ExtractOptions = { ownerAddresses?: readonly string[]; ownerProfile?: string | null; timeZone?: string; maxMessages?: number; maxPeople?: number; today?: IsoDate };

/** Stops the read once a file names more people than the cap. */
export function checkPeople(size: number, max: number): void {
  if (size > max) throw extractError('NETWORK_FILE_TOO_LARGE', `This file names more than ${count(max)} people; Chausar reads at most that many from one file. Export a smaller part and import each one.`);
}

/** An error the engine and the desktop both pass on: a code and plain words. */
export function extractError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/** A whole number with thousands commas. */
export const count = (value: number) => value.toLocaleString('en-US');
/** '1 line', '3 lines'. */
export const plural = (value: number, one: string, many: string) => `${count(value)} ${value === 1 ? one : many}`;

export const DROPPED = {
  formula: 'Formula signs at the start of a cell',
  unreadable: 'Text that could not be read',
  noHandle: 'Rows with no email, phone or profile link',
  badEmail: 'Email addresses that could not be read',
  badPhone: 'Phone numbers that could not be read',
  badProfile: 'Profile links that are not LinkedIn profiles',
  notes: 'Notes',
  photos: 'Photos',
  personal: 'Birthdays and addresses',
  messageText: 'Message text',
  messageSubjects: 'Message subjects and titles',
  descriptions: 'Event descriptions',
  places: 'Event places',
  cancelled: 'Cancelled events',
  bigEvents: `Events with more than ${MAX_GROUP} people`,
  bigMails: `Mails to more than ${MAX_GROUP} people`,
  bigMessages: `Group messages with more than ${MAX_GROUP} people`,
  mailBodies: 'Mail bodies and subjects',
  undated: 'Mails with no date Chausar could read',
  selfOnly: 'Mails only to yourself',
  unknownFields: 'Fields Chausar does not keep',
  future: 'Meetings after the day the file was read',
  futureWith: 'Who came to meetings dated after today',
} as const;

/** What a file had that Chausar left out, counted by kind, in the order first seen. */
export class Drops {
  readonly #counts = new Map<string, number>();
  add(what: string, amount = 1): void { if (amount > 0) this.#counts.set(what, (this.#counts.get(what) ?? 0) + amount); }
  list(): [string, number][] { return [...this.#counts]; }
}

/** Lines that could not be read; the first one and how many more make the refusal. */
export class Problems {
  readonly list: { line: number; why: string }[] = [];
  add(line: number, why: string): void { if (this.list.length < 1000) this.list.push({ line, why }); }
  /** Throws NETWORK_FILE_INVALID naming the first line, when there is one. */
  throwIfAny(): void {
    if (!this.list.length) return;
    const [first] = this.list, more = this.list.length - 1;
    throw extractError('NETWORK_FILE_INVALID',
      `Line ${count(first.line)}: ${first.why}.${more ? ` ${plural(more, 'more line', 'more lines')} could not be read.` : ''} Nothing was imported.`);
  }
}

/**
 * Text in chunks of any size to lines, with the line number each has in the file. A byte-order mark is taken off; CR,
 * LF and CRLF end a line, a CRLF split across chunks included. A line longer than max keeps its first max characters and
 * is marked long.
 */
export class LineSplitter {
  #buffer = '';
  #long = false;
  #line = 0;
  #skipLf = false;
  #started = false;
  private readonly max: number;
  private readonly onLine: (text: string, line: number, long: boolean) => void;
  constructor(max: number, onLine: (text: string, line: number, long: boolean) => void) { this.max = max; this.onLine = onLine; }
  push(chunk: string): void {
    let text = chunk;
    if (!this.#started && text.length) { this.#started = true; if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); }
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
      const c = text.charCodeAt(i);
      if (this.#skipLf) {
        this.#skipLf = false;
        if (c === 10) { start = i + 1; continue; }
      }
      if (c === 10 || c === 13) {
        this.#append(text, start, i);
        this.#flush();
        if (c === 13) this.#skipLf = true;
        start = i + 1;
      }
    }
    this.#append(text, start, text.length);
  }
  end(): void { if (this.#buffer.length || this.#long) this.#flush(); }
  #append(text: string, from: number, to: number): void {
    if (to <= from) return;
    const room = this.max - this.#buffer.length;
    if (to - from > room) { this.#buffer += text.slice(from, from + Math.max(0, room)); this.#long = true; }
    else this.#buffer += text.slice(from, to);
  }
  #flush(): void {
    this.#line += 1;
    const [text, long] = [this.#buffer, this.#long];
    this.#buffer = ''; this.#long = false;
    this.onLine(text, this.#line, long);
  }
}

/** One CSV row and the file line it starts on. */
export type CsvRow = { line: number; cells: string[] };

/** A refusal that stops the read at once: the file is malformed in a way that would only grow what is held. */
function stopAt(line: number, why: string): never {
  throw extractError('NETWORK_FILE_INVALID', `Line ${count(line)}: ${why}. Nothing was imported.`);
}

/**
 * RFC 4180 rows fed line by line (quotes, doubled quotes, new lines inside quotes). Blank rows are skipped. A line past
 * the cap, text after a closing quote, and a quote never closed are problems on their line; reading goes on. A cell
 * longer than MAX_LINE_CHARS (a quote left open across lines) or a row of more than MAX_CELLS cells stops the read at
 * once, so a broken or hostile file never makes the reader hold more than that.
 */
export class CsvReader {
  #row: string[] = [];
  #cell = '';
  #quoted = false;
  #start = 0;
  #quoteLine = 0;
  private readonly onRow: (row: CsvRow) => void;
  private readonly problems: Problems;
  constructor(onRow: (row: CsvRow) => void, problems: Problems) { this.onRow = onRow; this.problems = problems; }
  line(text: string, line: number, long: boolean): void {
    if (long) { this.problems.add(line, 'the line is longer than Chausar reads'); this.#reset(); return; }
    if (this.#quoted) this.#cell += '\n';
    else this.#start = line;
    let afterQuote = false;
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if (this.#quoted) {
        if (c === '"') { if (text[i + 1] === '"') { this.#cell += '"'; i += 1; } else { this.#quoted = false; afterQuote = true; } }
        else this.#cell += c;
        continue;
      }
      if (afterQuote && c !== ',') {
        if (c === ' ' || c === '\t') continue;
        this.problems.add(line, 'a quoted cell has text after its closing quote');
        this.#reset();
        return;
      }
      afterQuote = false;
      if (c === '"' && this.#cell.length === 0) { this.#quoted = true; this.#quoteLine = line; }
      else if (c === ',') {
        this.#row.push(this.#cell); this.#cell = '';
        if (this.#row.length >= MAX_CELLS) stopAt(this.#start, 'the row has more cells than Chausar reads');
      } else this.#cell += c;
    }
    if (this.#cell.length > MAX_LINE_CHARS) stopAt(this.#quoted ? this.#quoteLine : this.#start, 'a cell is longer than Chausar reads');
    if (this.#quoted) return;
    this.#row.push(this.#cell);
    const row = this.#row;
    this.#row = []; this.#cell = '';
    if (row.some(cell => cell.trim().length)) this.onRow({ line: this.#start, cells: row });
  }
  end(): void { if (this.#quoted) this.problems.add(this.#quoteLine, 'a quoted cell is never closed'); this.#reset(); }
  #reset(): void { this.#row = []; this.#cell = ''; this.#quoted = false; }
}

/** Lower case, spaces collapsed: how a header cell is matched. */
export const headerKey = (value: string) => value.replace(/^﻿/, '').trim().replace(/\s+/g, ' ').toLowerCase();

const HIDDEN = /[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;
const FORMULA = /^[=+\-@]/;

/**
 * One text cell as Chausar keeps it: hidden characters removed, spaces collapsed, formula signs at the start (= + - @,
 * the CSV injection marks) taken off and counted, cut to max characters. A cell with text that could not be read (the
 * replacement character a wrong encoding leaves) is dropped and counted; the rest of the row stays.
 */
export function cleanText(raw: string | undefined | null, max: number, drops: Drops): string | null {
  if (raw === undefined || raw === null) return null;
  let text = raw.replace(HIDDEN, '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.includes('�')) { drops.add(DROPPED.unreadable); return null; }
  if (FORMULA.test(text)) { text = text.replace(/^[=+\-@\s]+/, '').trim(); drops.add(DROPPED.formula); }
  if (!text) return null;
  const points = [...text];
  return points.length > max ? points.slice(0, max).join('').trim() : text;
}

const EMAIL = /^[^\s@<>()",;:]{1,64}@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/;

/**
 * An email address in one spelling (trimmed, lower case, mailto: taken off), or null when it is not one. One starting
 * with a formula sign (= + -) is refused too: it would run as a formula in a spreadsheet the owner opens later.
 */
export function normalEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.replace(HIDDEN, '').trim().replace(/^mailto:/i, '').toLowerCase();
  return text.length <= 254 && !FORMULA.test(text) && EMAIL.test(text) ? text : null;
}

/**
 * A LinkedIn profile address in one spelling: 'https://www.linkedin.com/in/<slug>', the slug in lower case, without the
 * country host, query, fragment or trailing parts. A scheme may be missing. Null for anything else, and for a slug the
 * secret screen would cut (it is not a person's address, and two of them must never merge).
 */
export function normalLinkedIn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let text = raw.replace(HIDDEN, '').trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try { url = new URL(text); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;
  const match = /^\/in\/([^/]+)\/?/i.exec(url.pathname);
  if (!match) return null;
  let slug: string;
  try { slug = decodeURIComponent(match[1]).toLowerCase(); } catch { return null; }
  if (!/^[\p{L}\p{N}_-]{2,100}$/u.test(slug)) return null;
  const canonical = `https://www.linkedin.com/in/${encodeURIComponent(slug)}`;
  return redactUrl(canonical) === canonical ? canonical : null;
}

/** Calling code, trunk prefix and national number length for each country in the table. */
const DIALING: Readonly<Record<string, { code: string; trunk: string; length: [number, number] }>> = Object.freeze({
  IN: { code: '91', trunk: '0', length: [10, 10] }, US: { code: '1', trunk: '1', length: [10, 10] }, CA: { code: '1', trunk: '1', length: [10, 10] },
  GB: { code: '44', trunk: '0', length: [9, 10] }, AU: { code: '61', trunk: '0', length: [9, 9] }, NZ: { code: '64', trunk: '0', length: [8, 10] },
  SG: { code: '65', trunk: '', length: [8, 8] }, AE: { code: '971', trunk: '0', length: [8, 9] }, DE: { code: '49', trunk: '0', length: [6, 13] },
  FR: { code: '33', trunk: '0', length: [9, 9] }, NL: { code: '31', trunk: '0', length: [9, 9] }, IE: { code: '353', trunk: '0', length: [7, 9] },
  ZA: { code: '27', trunk: '0', length: [9, 9] }, JP: { code: '81', trunk: '0', length: [9, 10] },
});

/**
 * A phone number in E.164 ('+919876543210'). A number with + or 00 keeps its own country; any other is read as a number
 * of the business's country (its trunk 0 taken off). Extensions are cut. Null when it cannot be read exactly.
 */
export function normalPhone(raw: string | null | undefined, countryCode: string): string | null {
  if (!raw) return null;
  let text = raw.replace(HIDDEN, '').trim().toLowerCase().split(/(?:x|ext\.?|#|;|,)/)[0];
  text = text.replace(/[\s().\-/ ]/g, '');
  if (text.startsWith('00')) text = `+${text.slice(2)}`;
  if (text.startsWith('+')) {
    let digits = text.slice(1);
    if (!/^[1-9]\d{6,14}$/.test(digits)) return null;
    // +91 0 98765 43210: a trunk 0 written after the country code.
    const known = Object.values(DIALING).find(item => digits.startsWith(item.code) && digits[item.code.length] === '0' && item.trunk === '0');
    if (known && digits.length - known.code.length - 1 >= known.length[0]) digits = known.code + digits.slice(known.code.length + 1);
    return `+${digits}`;
  }
  if (!/^\d+$/.test(text)) return null;
  const plan = DIALING[countryCode];
  if (!plan) return null;
  let national = text;
  if (national.length === plan.code.length + plan.length[1] && national.startsWith(plan.code) && plan.code !== plan.trunk) return `+${national}`;
  if (plan.trunk && national.startsWith(plan.trunk) && national.length > plan.length[1]) national = national.slice(plan.trunk.length);
  if (national.length < plan.length[0] || national.length > plan.length[1] || national.startsWith('0')) return null;
  const full = plan.code + national;
  return full.length <= 15 ? `+${full}` : null;
}

/** A phone as the file wrote it, cleaned for the engine to read in the business's country; null without enough digits. */
export function rawPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.replace(HIDDEN, '').replace(/\s+/g, ' ').trim().replace(/^tel:/i, '');
  return (text.match(/\d/g) ?? []).length >= 6 && text.length <= 40 ? text : null;
}

/** A name or company folded for comparing: accents, case, punctuation and spacing ignored. */
export function fold(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const COMPANY_SUFFIX = /\s+(?:pvt|private|ltd|limited|llp|llc|inc|incorporated|co|company|corp|corporation|opc|plc|gmbh)$/;

/** Words people write where an employer goes that name no company: no one is a colleague, or the same person, by them. */
const NO_COMPANY: ReadonlySet<string> = new Set([
  'self employed', 'selfemployed', 'self', 'freelance', 'freelancer', 'freelancing', 'independent', 'independent consultant', 'consultant', 'student',
  'unemployed', 'retired', 'homemaker', 'housewife', 'home maker', 'none', 'n a', 'na', 'nil', 'not applicable', 'own business', 'my own business',
  'business owner', 'entrepreneur', 'stealth', 'stealth startup', 'confidential', 'private', 'personal', 'various', 'looking for opportunities', 'open to work',
]);

/**
 * A company folded for "Same person?" and for colleagues: also without the legal suffixes (Pvt Ltd, LLP, Inc). A generic
 * employer (Self-employed, Freelance, Student, Unemployed, Retired and the like) folds to nothing.
 */
export function foldCompany(value: string | null | undefined): string {
  let folded = fold(value);
  for (let i = 0; i < 4; i += 1) {
    const next = folded.replace(COMPANY_SUFFIX, '');
    if (next === folded) break;
    folded = next;
  }
  return NO_COMPANY.has(folded) ? '' : folded;
}

const MONTHS: Readonly<Record<string, number>> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** A real calendar day 'YYYY-MM-DD', or null. */
export function isoDay(year: number, month: number, day: number): IsoDate | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= last ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
}

/**
 * A cell as a calendar day: 2026-09-14, 14/09/2026 (in the given order), 14 Sep 2026 and Sep 14, 2026. A two-digit year
 * is refused, never guessed.
 */
export function parseDay(raw: string, order: 'day-month-year' | 'month-day-year' | 'year-month-day'): IsoDate | null {
  const text = raw.trim();
  const int = (value: string | undefined) => parseInt(value ?? '', 10);
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) return isoDay(int(match[1]), int(match[2]), int(match[3]));
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (match) return order === 'month-day-year' ? isoDay(int(match[3]), int(match[1]), int(match[2])) : isoDay(int(match[3]), int(match[2]), int(match[1]));
  match = /^(\d{1,2})[\s-]([A-Za-z]{3,4})[a-z]*[\s-,]+(\d{4})$/.exec(text);
  if (match && MONTHS[match[2].toLowerCase()]) return isoDay(int(match[3]), MONTHS[match[2].toLowerCase()], int(match[1]));
  match = /^([A-Za-z]{3,4})[a-z]*\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (match && MONTHS[match[1].toLowerCase()]) return isoDay(int(match[3]), MONTHS[match[1].toLowerCase()], int(match[2]));
  return null;
}

const ZONES = new Map<string, Intl.DateTimeFormat>();

/** Checks an IANA time zone name; the extractor refuses one Intl does not know. */
export function checkTimeZone(zone: string): string {
  try { zoneFormat(zone); return zone; } catch { throw extractError('INVALID_VENTURE_REQUEST', 'That time zone is not one Chausar knows.'); }
}

function zoneFormat(zone: string): Intl.DateTimeFormat {
  let format = ZONES.get(zone);
  if (!format) { format = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }); ZONES.set(zone, format); }
  return format;
}

/** The owner's day at an instant (milliseconds since 1970), in their time zone. */
export function dayInZone(ms: number, zone: string): IsoDate | null {
  if (!Number.isFinite(ms)) return null;
  const parts = zoneFormat(zone).formatToParts(new Date(ms));
  const get = (type: string) => parseInt(parts.find(part => part.type === type)?.value ?? '', 10);
  return isoDay(get('year'), get('month'), get('day'));
}

/** Adds one item on a day to a tally by direction (0 sent, 1 received, 2 copied). */
export function tallyAdd(tally: Tally | null, day: IsoDate, direction: 0 | 1 | 2): Tally {
  const next: Tally = tally ?? { sent: 0, received: 0, copied: 0, first: day, last: day, months: {} };
  if (direction === 0) next.sent += 1; else if (direction === 1) next.received += 1; else next.copied += 1;
  if (day < next.first) next.first = day;
  if (day > next.last) next.last = day;
  const month = day.slice(0, 7);
  const row = next.months[month] ?? [0, 0, 0];
  row[direction] += 1;
  next.months[month] = row;
  return next;
}

/** Months in order, so the same file always gives the same text. */
export function sortedMonths<T>(months: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.keys(months).sort().map(key => [key, months[key]]));
}

/** The most frequent of a count map, most often first, then by name; at most MAX_WITH. */
export function topWith(counts: Map<string, number>): string[] | undefined {
  if (!counts.size) return undefined;
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, MAX_WITH).map(([key]) => key);
}

/** Leaves out empty fields so the projection stays small and the same file always reads the same. */
export function compact(person: ProjectedPerson): ProjectedPerson {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(person)) {
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) continue;
    out[key] = value;
  }
  return out as ProjectedPerson;
}
