// Chausar venture launcher, network (Ink v2 wave 4, package 4D1): a mail export (mbox, as Google Takeout, Thunderbird
// and Apple Mail write it), read by the pure extractor header block by header block. Only From, To, Cc and Date are read;
// body lines, subjects and every other header are passed over and never kept. Per person it keeps a mail total: how
// many mails the owner sent them, received from them, or was copied on with them, by month, first and last day, who
// else was on the small ones, and (4D2) who they exchanged a small mail with where one of the two wrote it. The owner's
// own addresses come with the request; at most maxMessages messages are read.
import type { IsoDate } from '../contracts.ts';
import {
  checkPeople, checkTimeZone, cleanText, compact, dayInZone, DROPPED, Drops, extractError, MAX_GROUP, MAX_NAME, MAX_PEOPLE, normalEmail, plural, Problems, SMALL_GROUP,
  sortedMonths, tallyAdd, topWith, type ExtractOptions, type MailTally, type ProjectedPerson, type Tally,
} from './extract-core.ts';
import type { KindReader } from './extract-linkedin.ts';

export const MAX_MESSAGES = 200_000;
const MAX_HEADER_CHARS = 65_536;
const MAX_ADDRESSES = 200;
const KEPT = new Set(['from', 'to', 'cc', 'date']);
// An mbox separator: 'From <sender> <weekday> <month> <day> ...', after a blank line or at the start of the file.
const SEPARATOR = /^From \S+ +(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) +(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +\d{1,2} /;
const MONTH_INDEX: Readonly<Record<string, number>> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** RFC 2047 encoded words in a display name ('=?UTF-8?B?...?=', '=?ISO-8859-1?Q?...?='); an unknown charset reads as nothing. */
export function decodeWords(text: string): string {
  return text.replace(/=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=(?:\s+(?==\?))?/g, (_match, charset: string, encoding: string, data: string) => {
    try {
      let bytes: Uint8Array;
      if (encoding.toUpperCase() === 'B') {
        const binary = atob(data.replace(/[^A-Za-z0-9+/=]/g, ''));
        bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      } else {
        const latin = data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
        bytes = Uint8Array.from(latin, c => c.charCodeAt(0) & 0xff);
      }
      return new TextDecoder(charset.split('*')[0].toLowerCase()).decode(bytes);
    } catch { return ''; }
  });
}

type Address = { email: string; name: string | null };

/** One address of a list, or null. */
function oneAddress(part: string, drops: Drops): Address | null {
  let text = part.trim();
  const group = /^[^"<@:]*:\s*/.exec(text);
  if (group) text = text.slice(group[0].length);
  text = text.replace(/;\s*$/, '').trim();
  if (!text) return null;
  const angled = /^(.*)<([^<>]*)>\s*(?:\([^)]*\))?$/.exec(text);
  let email: string, name: string;
  if (angled) { email = angled[2]; name = angled[1]; }
  else { const comment = /\(([^)]*)\)/.exec(text); email = text.replace(/\([^)]*\)/g, ''); name = comment ? comment[1] : ''; }
  const normal = normalEmail(email);
  if (!normal) return null;
  const decoded = decodeWords(name.trim().replace(/^"([\s\S]*)"$/, '$1').replace(/\\(.)/g, '$1')).replace(/[";<>]/g, ' ');
  return { email: normal, name: cleanText(decoded, MAX_NAME, drops) };
}

/** An address list header (From, To, Cc): commas and semicolons outside quotes, angle brackets and comments split it. */
export function parseAddresses(value: string | undefined, drops: Drops): Address[] {
  if (!value) return [];
  const parts: string[] = [];
  let current = '', quoted = false, angle = 0, paren = 0, escaped = false;
  for (const c of value) {
    if (escaped) { current += c; escaped = false; continue; }
    if (c === '\\' && quoted) { current += c; escaped = true; continue; }
    if (c === '"' && !paren) quoted = !quoted;
    else if (!quoted) {
      if (c === '<') angle += 1;
      else if (c === '>') angle = Math.max(0, angle - 1);
      else if (c === '(') paren += 1;
      else if (c === ')') paren = Math.max(0, paren - 1);
      else if ((c === ',' || c === ';') && !angle && !paren) { parts.push(current); current = ''; continue; }
    }
    current += c;
  }
  parts.push(current);
  const out: Address[] = [];
  for (const part of parts) {
    const found = oneAddress(part, drops);
    if (found && !out.some(item => item.email === found.email)) out.push(found);
    if (out.length >= MAX_ADDRESSES) break;
  }
  return out;
}

/** An RFC 5322 Date header as milliseconds, without Date.parse's guessing: 'Thu, 2 Oct 2026 09:31:12 +0000'. */
function parseDate(value: string | undefined): number | null {
  if (!value) return null;
  const match = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|UT|UTC|GMT|Z)?/.exec(value.replace(/\([^)]*\)/g, ' '));
  if (!match) return null;
  const month = MONTH_INDEX[match[2].toLowerCase()];
  if (month === undefined) return null;
  let ms = Date.UTC(+match[3], month, +match[1], +match[4], +match[5], +(match[6] ?? 0));
  const zone = match[7];
  if (zone && /^[+-]\d{4}$/.test(zone)) ms -= (zone[0] === '-' ? -1 : 1) * (parseInt(zone.slice(1, 3), 10) * 60 + parseInt(zone.slice(3), 10)) * 60_000;
  const year = new Date(ms).getUTCFullYear();
  return Number.isFinite(ms) && year >= 1990 && year <= 2100 ? ms : null;
}

/** An mbox file read header block by header block. */
export function mailReader(drops: Drops, problems: Problems, options: ExtractOptions): KindReader {
  const zone = checkTimeZone(options.timeZone ?? 'UTC');
  const owners = new Set((options.ownerAddresses ?? []).map(address => normalEmail(address)).filter((address): address is string => !!address));
  if (!owners.size) throw extractError('INVALID_VENTURE_REQUEST', 'Name the email addresses you send from, so Chausar can tell the mail you sent.');
  const max = options.maxMessages ?? MAX_MESSAGES;
  type Entry = { person: ProjectedPerson; tally: Tally | null; with: Map<string, number>; between: Map<string, number> };
  const byEmail = new Map<string, Entry>();
  let messages = 0, state: 'start' | 'headers' | 'body' = 'start', previousBlank = true;
  let current: { line: number; headers: Map<string, string>; last: string | null } | null = null;

  // between (4D2): only pairs where one of the two wrote the mail, so a mail the owner sent to both confirms nothing.
  const add = (who: Address, line: number, day: IsoDate, direction: 0 | 1 | 2, together: Address[], between: Address[] = []) => {
    const entry = byEmail.get(who.email) ?? { person: { line, rows: 0, emails: [who.email] }, tally: null, with: new Map<string, number>(), between: new Map<string, number>() };
    entry.person.rows = (entry.person.rows ?? 0) + 1;
    if (!entry.person.name && who.name) entry.person.name = who.name;
    entry.tally = tallyAdd(entry.tally, day, direction);
    for (const other of together) if (other.email !== who.email) entry.with.set(other.email, (entry.with.get(other.email) ?? 0) + 1);
    for (const other of between) if (other.email !== who.email) entry.between.set(other.email, (entry.between.get(other.email) ?? 0) + 1);
    byEmail.set(who.email, entry);
    checkPeople(byEmail.size, options.maxPeople ?? MAX_PEOPLE);
  };

  const finish = () => {
    if (!current) return;
    const { headers, line } = current;
    current = null;
    const ms = parseDate(headers.get('date'));
    const day = ms === null ? null : dayInZone(ms, zone);
    if (!day) { drops.add(DROPPED.undated); return; }
    const from = parseAddresses(headers.get('from'), drops)[0] ?? null;
    const own = (address: Address) => owners.has(address.email);
    const to = parseAddresses(headers.get('to'), drops).filter(address => !own(address) && address.email !== from?.email);
    const cc = parseAddresses(headers.get('cc'), drops).filter(address => !own(address) && address.email !== from?.email && !to.some(item => item.email === address.email));
    const others = [...to, ...cc];
    if (from && own(from)) {
      if (!others.length) { drops.add(DROPPED.selfOnly); return; }
      if (others.length > MAX_GROUP) { drops.add(DROPPED.bigMails); return; }
      const small = others.length <= SMALL_GROUP;
      for (const who of others) add(who, line, day, 0, small ? others : []);
    } else if (from) {
      const everyone = [from, ...others];
      const small = everyone.length <= SMALL_GROUP;
      add(from, line, day, 1, small ? everyone : [], small ? others : []);
      if (others.length > MAX_GROUP) drops.add(DROPPED.bigMails);
      else for (const who of others) add(who, line, day, 2, small ? everyone : [], small ? [from] : []);
    }
  };

  return {
    line(text, line) {
      if (state !== 'headers' && previousBlank && SEPARATOR.test(text)) {
        finish();
        messages += 1;
        if (messages > max) {
          throw extractError('NETWORK_FILE_TOO_LARGE', `This export holds more than ${plural(max, 'message', 'messages')}. Export a shorter date range and import each part.`);
        }
        current = { line, headers: new Map(), last: null };
        state = 'headers'; previousBlank = false;
        return;
      }
      if (state === 'start') {
        if (text.trim() !== '') throw extractError('NETWORK_FILE_INVALID', `Line ${line}: this is not a mail export (mbox) file. Export your mail from Google Takeout or your mail app as mbox. Nothing was imported.`);
        return;
      }
      if (state === 'headers' && current) {
        if (text.trim() === '') { state = 'body'; previousBlank = true; return; }
        if (/^[ \t]/.test(text)) {
          if (current.last) current.headers.set(current.last, `${current.headers.get(current.last)} ${text.trim()}`.slice(0, MAX_HEADER_CHARS));
          return;
        }
        const colon = text.indexOf(':');
        const name = colon > 0 ? text.slice(0, colon).trim().toLowerCase() : '';
        if (KEPT.has(name) && !current.headers.has(name)) { current.headers.set(name, text.slice(colon + 1).trim().slice(0, MAX_HEADER_CHARS)); current.last = name; }
        else current.last = null;
        return;
      }
      // A body line: passed over, never kept.
      previousBlank = text.trim() === '';
    },
    end() {
      if (state === 'start') { problems.add(1, 'this mail export is empty'); return { rows: 0, people: [] }; }
      finish();
      drops.add(DROPPED.mailBodies, messages);
      const people = [...byEmail.values()].map(({ person, tally, with: together, between }) => {
        const mail: MailTally = { ...tally!, months: sortedMonths(tally!.months) };
        const others = topWith(together);
        if (others) mail.with = others;
        const wrote = topWith(between);
        if (wrote) mail.between = wrote;
        return compact({ ...person, mail });
      });
      return { rows: messages, people };
    },
  };
}
