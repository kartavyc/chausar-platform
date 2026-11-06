// Chausar venture launcher, network (Ink v2 wave 4, package 4D1): the engine's second guard on what the extractor sends.
// The desktop sends a projection of the owner's file (extract.ts); a raw file sent to the engine is projected here with
// the same extractor. Either way the projection is read again field by field: unknown fields are dropped and counted,
// text is cleaned, handles are put in one spelling (phones in the business's country), counts and days are checked, and
// a field that is wrong refuses the whole file, naming the line of the source file it came from.
import { ChausarError } from '../../contracts.ts';
import type { CountryProfile, IsoDate, NetworkImportKind, PersonFactKind } from '../contracts.ts';
import { ventureTimeZone } from '../local-day.ts';
import { extractText, PROJECTION_FORMAT, type Projection } from './extract.ts';
import { isoDay, MAX_TITLES, MAX_WITH } from './extract-core.ts';
import { cleanText, count, Drops, DROPPED, MAX_COMPANY, MAX_NAME, MAX_SUMMARY, MAX_TITLE, normalEmail, normalLinkedIn, normalPhone, type ParsedEntry } from './text.ts';

/** The most people a projection may list before the merge counts them (the merge then caps a file at 20,000). */
const MAX_LISTED = 100_000;
const MAX_COUNT = 10_000_000;
const PERSON_KEYS = new Set(['line', 'rows', 'name', 'emails', 'phones', 'linkedin', 'title', 'company', 'connected', 'contact', 'mail', 'messages', 'meetings']);

/** A projection read again, ready for the merge. */
export type ReadProjection = { rows: number; entries: ParsedEntry[]; dropped: { what: string; count: number }[] };

class Refusal extends Error {
  readonly line: number;
  readonly why: string;
  constructor(line: number, why: string) { super(why); this.line = line; this.why = why; }
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const whole = (value: unknown, line: number, field: string, max = MAX_COUNT): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) throw new Refusal(line, `${field} is not a count Chausar can read`);
  return value as number;
};
const day = (value: unknown, line: number, field: string): IsoDate => {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  const ok = match ? isoDay(+match[1], +match[2], +match[3]) : null;
  if (!ok) throw new Refusal(line, `${field} is not a date`);
  return ok;
};
const months = (value: unknown, line: number, width: 2 | 3): Record<string, number[]> => {
  if (!isRecord(value) || Object.keys(value).length > 1200) throw new Refusal(line, 'the months are not readable');
  const out: Record<string, number[]> = {};
  for (const key of Object.keys(value).sort()) {
    const row = value[key];
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key) || !Array.isArray(row) || row.length !== width) throw new Refusal(line, 'the months are not readable');
    out[key] = row.map((item, i) => whole(item, line, `month ${key} item ${i + 1}`));
  }
  return out;
};
const emailList = (value: unknown, line: number, max: number): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw new Refusal(line, 'a list of addresses is not readable');
  return [...new Set(value.map(item => (typeof item === 'string' ? normalEmail(item) : null)).filter((item): item is string => !!item))];
};

/** A tally (mail or messages) read again, its totals checked against its months. */
function tally(value: unknown, line: number, extra: 'with' | 'conversations', rows: number) {
  if (!isRecord(value)) throw new Refusal(line, 'a total is not readable');
  const sent = whole(value.sent, line, 'sent'), received = whole(value.received, line, 'received'), copied = whole(value.copied, line, 'copied');
  const first = day(value.first, line, 'the first day'), last = day(value.last, line, 'the last day');
  if (first > last) throw new Refusal(line, 'the first day is after the last');
  const byMonth = months(value.months, line, 3);
  const sums = [0, 1, 2].map(i => Object.values(byMonth).reduce((sum, row) => sum + row[i], 0));
  if (sums[0] !== sent || sums[1] !== received || sums[2] !== copied) throw new Refusal(line, 'the totals do not add up by month');
  const detail: Record<string, unknown> = { sent, received, copied, first, last, months: byMonth };
  if (extra === 'conversations') detail.conversations = whole(value.conversations, line, 'conversations');
  else {
    const together = emailList(value.with, line, MAX_WITH); if (together.length) detail.with = together;
    // 4D2: who they exchanged a mail with, one of the two its sender (a warm path's second leg).
    const between = emailList(value.between, line, MAX_WITH); if (between.length) detail.between = between;
  }
  detail.rows = rows;
  return { detail, last };
}

/**
 * Meetings read again, their totals checked against their months. today (4D2): a file read on a computer whose clock
 * ran ahead may list meetings after today; who came to them is dropped and counted, so no path comes from one.
 */
function meetings(value: unknown, line: number, rows: number, drops: Drops, today: IsoDate | null) {
  if (!isRecord(value)) throw new Refusal(line, 'the meetings are not readable');
  const total = whole(value.count, line, 'count'), small = whole(value.small, line, 'small');
  const first = day(value.first, line, 'the first day'), last = day(value.last, line, 'the last day');
  if (small > total || first > last) throw new Refusal(line, 'the meetings do not add up');
  const byMonth = months(value.months, line, 2);
  if (Object.values(byMonth).reduce((sum, row) => sum + row[0], 0) !== total || Object.values(byMonth).reduce((sum, row) => sum + row[1], 0) !== small) {
    throw new Refusal(line, 'the meetings do not add up by month');
  }
  if (!Array.isArray(value.titles) || value.titles.length > MAX_TITLES) throw new Refusal(line, 'the meeting titles are not readable');
  const titles = value.titles.map(title => (typeof title === 'string' ? cleanText(title, MAX_SUMMARY, drops) : null)).filter((title): title is string => !!title);
  const detail: Record<string, unknown> = { count: total, small, first, last, months: byMonth, titles };
  const together = emailList(value.with, line, MAX_WITH);
  if (together.length && today && last > today) drops.add(DROPPED.futureWith);
  else if (together.length) detail.with = together;
  detail.rows = rows;
  return { detail, last, title: titles[0] ?? 'Meeting' };
}

/** One projected person as an entry, or null when they have no handle left. */
function entryOf(value: unknown, country: Pick<CountryProfile, 'code'>, drops: Drops, today: IsoDate | null = null): ParsedEntry | null {
  if (!isRecord(value)) throw new Refusal(1, 'a person in the file is not readable');
  const line = whole(value.line, 1, 'the line', 100_000_000) || 1;
  for (const key of Object.keys(value)) if (!PERSON_KEYS.has(key)) drops.add(DROPPED.unknownFields);
  const rows = value.rows === undefined ? 1 : whole(value.rows, line, 'rows');
  const name = value.name === undefined ? null : typeof value.name === 'string' ? cleanText(value.name, MAX_NAME, drops) : null;
  const emails: string[] = [];
  if (value.emails !== undefined) {
    if (!Array.isArray(value.emails) || value.emails.length > 20) throw new Refusal(line, 'the emails are not readable');
    for (const item of value.emails) {
      const email = typeof item === 'string' ? normalEmail(item) : null;
      if (!email) drops.add(DROPPED.badEmail); else if (!emails.includes(email)) emails.push(email);
    }
  }
  const phones: string[] = [];
  if (value.phones !== undefined) {
    if (!Array.isArray(value.phones) || value.phones.length > 20) throw new Refusal(line, 'the phones are not readable');
    for (const item of value.phones) {
      const phone = typeof item === 'string' ? normalPhone(item, country.code) : null;
      if (!phone) drops.add(DROPPED.badPhone); else if (!phones.includes(phone)) phones.push(phone);
    }
  }
  let linkedinUrl: string | null = null;
  if (value.linkedin !== undefined) {
    linkedinUrl = typeof value.linkedin === 'string' ? normalLinkedIn(value.linkedin) : null;
    if (!linkedinUrl) drops.add(DROPPED.badProfile);
  }
  const title = typeof value.title === 'string' ? cleanText(value.title, MAX_TITLE, drops) : null;
  const company = typeof value.company === 'string' ? cleanText(value.company, MAX_COMPANY, drops) : null;
  const facts: ParsedEntry['facts'] = [];
  const add = (kind: PersonFactKind, factValue: string, date: IsoDate | null, detail: Record<string, unknown> | null) => facts.push({ kind, value: factValue, date, detail: detail as never });
  if (value.connected !== undefined) add('connection', 'LinkedIn connection', day(value.connected, line, 'the Connected On date'), null);
  if (value.contact !== undefined) {
    if (value.contact !== true) throw new Refusal(line, 'contact is not readable');
    add('contact', 'Saved contact', null, null);
  }
  if (value.messages !== undefined) { const read = tally(value.messages, line, 'conversations', rows); add('message', 'messages', read.last, read.detail); }
  // Meeting and mail totals are per address; for: which one, so one mail to two of a person's addresses counts once.
  if (value.meetings !== undefined) { const read = meetings(value.meetings, line, rows, drops, today); add('meeting', read.title, read.last, { ...read.detail, ...(emails[0] ? { for: emails[0] } : {}) }); }
  if (value.mail !== undefined) { const read = tally(value.mail, line, 'with', rows); add('mail', 'mail', read.last, { ...read.detail, ...(emails[0] ? { for: emails[0] } : {}) }); }
  if (!emails.length && !phones.length && !linkedinUrl) { drops.add(DROPPED.noHandle); return null; }
  return { line, name, emails, phones, linkedinUrl, role: title || company ? { title, company } : null, facts };
}

/** The projection's own counts of what it dropped, read again. */
function droppedOf(value: unknown, drops: Drops): void {
  if (!Array.isArray(value) || value.length > 60) throw new Refusal(1, 'the list of what was dropped is not readable');
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string' || item[0].length > 80) throw new Refusal(1, 'the list of what was dropped is not readable');
    const what = cleanText(item[0], 80, new Drops());
    if (what) drops.add(what, whole(item[1], 1, 'a dropped count'));
  }
}

/**
 * The entries of an import: a projection the desktop sent (JSON with the projection format), or a raw file projected
 * here with the same extractor in the business's time zone. Mail comes only as a projection: the engine has no list of
 * the owner's own addresses to read a raw mail export with. today: the owner's day, so a raw file's meetings after it
 * are dropped and a projection's meetings dated after it bring no one with them (4D2).
 */
export function readImportText(kind: NetworkImportKind, text: string, country: CountryProfile, today: IsoDate | null = null): ReadProjection {
  let projection: unknown;
  if (text.trimStart().startsWith('{')) {
    try { projection = JSON.parse(text); } catch { throw new ChausarError('NETWORK_FILE_INVALID', 'Line 1: this is not a file Chausar\'s desktop app read, nor one Chausar reads directly. Nothing was imported.'); }
  } else {
    if (kind === 'mail-headers') {
      throw new ChausarError('NETWORK_FILE_INVALID', 'Line 1: mail comes in only through the desktop app, which reads your mail export on your computer and keeps who wrote to whom and when. Nothing was imported.');
    }
    try { projection = extractText(kind, text, { timeZone: ventureTimeZone(country), ...(today ? { today } : {}) }); }
    catch (error) {
      const coded = error as { code?: unknown; message?: unknown };
      throw new ChausarError(typeof coded.code === 'string' ? coded.code : 'NETWORK_FILE_INVALID', typeof coded.message === 'string' ? coded.message : 'This file could not be read. Nothing was imported.');
    }
  }
  if (!isRecord(projection) || projection.format !== PROJECTION_FORMAT) throw new ChausarError('NETWORK_FILE_INVALID', 'Line 1: this is not a file Chausar\'s desktop app read. Nothing was imported.');
  if (projection.kind !== kind) throw new ChausarError('INVALID_VENTURE_REQUEST', 'This file was read as another kind of file. Choose the same kind again and import it.');
  const drops = new Drops();
  try {
    const rows = whole((projection as Projection).rows, 1, 'rows');
    droppedOf(projection.dropped, drops);
    if (!Array.isArray(projection.people) || projection.people.length > MAX_LISTED) throw new Refusal(1, `the file lists more than ${count(MAX_LISTED)} people`);
    const entries = projection.people.map(person => entryOf(person, country, drops, today)).filter((entry): entry is ParsedEntry => !!entry);
    return { rows, entries, dropped: drops.list().map(([what, amount]) => ({ what, count: amount })) };
  } catch (error) {
    if (error instanceof Refusal) throw new ChausarError('NETWORK_FILE_INVALID', `Line ${count(error.line)}: ${error.why}. Nothing was imported.`);
    throw error;
  }
}

