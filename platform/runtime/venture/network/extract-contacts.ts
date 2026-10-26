// Chausar venture launcher, network (Ink v2 wave 4, package 4D1): the owner's saved contacts, read by the pure
// extractor. A contacts CSV (Google Contacts in its older and newer column names, and Outlook's) and a phone's vCard
// file (3.0 and 4.0, and 2.1 with quoted-printable names as Android writes them). Kept: name, emails, phones as written
// (the engine reads them in the business's country), organisation and title, a LinkedIn address. Dropped and counted:
// notes, photos, birthdays and postal addresses.
import {
  checkPeople, cleanText, compact, CsvReader, DROPPED, Drops, headerKey, MAX_COMPANY, MAX_NAME, MAX_PEOPLE, MAX_TITLE, normalEmail, normalLinkedIn, rawPhone,
  type CsvRow, type ExtractOptions, type ProjectedPerson, Problems,
} from './extract-core.ts';
import type { KindReader } from './extract-linkedin.ts';

const NAME_COLUMNS = ['name', 'first name', 'given name', 'last name', 'family name', 'middle name', 'additional name'];
const EMAIL_COLUMN = /^(?:e-?mail(?: \d+)? - value|e-?mail(?: \d+)?(?: address)?|e-?mail address \d+)$/;
const PHONE_COLUMN = /^(?:phone \d+ - value|(?:mobile|business|home|primary|other|car|company main|assistant's|business 2|home 2) phone|phone|mobile|mobile phone \d+)$/;
const WEBSITE_COLUMN = /^(?:website \d+ - value|web page|website|linkedin|linkedin url)$/;
const PERSONAL_COLUMN = /^(?:birthday|anniversary|address \d+ - .*|(?:home|business|other) (?:street|street 2|street 3|city|state|postal code|country\/region|po box)|home address|business address)$/;

function addEmail(person: ProjectedPerson, raw: string, drops: Drops): void {
  if (!raw.trim()) return;
  const email = normalEmail(raw);
  if (!email) { drops.add(DROPPED.badEmail); return; }
  if (!(person.emails ??= []).includes(email)) person.emails.push(email);
}

function addPhone(person: ProjectedPerson, raw: string, drops: Drops): void {
  if (!raw.trim()) return;
  const phone = rawPhone(raw);
  if (!phone) { drops.add(DROPPED.badPhone); return; }
  if (!(person.phones ??= []).includes(phone)) person.phones.push(phone);
}

function finish(person: ProjectedPerson, title: string | null | undefined, company: string | null | undefined, drops: Drops): ProjectedPerson | null {
  const cleanTitle = cleanText(title, MAX_TITLE, drops), cleanCompany = cleanText(company, MAX_COMPANY, drops);
  if (cleanTitle) person.title = cleanTitle;
  if (cleanCompany) person.company = cleanCompany;
  person.contact = true;
  if (!person.emails?.length && !person.phones?.length && !person.linkedin) { drops.add(DROPPED.noHandle); return null; }
  return compact(person);
}

/**
 * A contacts CSV. The first row is the header; it needs a name column and an email or phone column. Google keeps several
 * values in one cell joined by ' ::: '; each is read.
 */
export function contactsCsvReader(drops: Drops, problems: Problems, options: ExtractOptions = {}): KindReader {
  const most = options.maxPeople ?? MAX_PEOPLE;
  let keys: string[] | null = null, rows = 0;
  let columns: { emails: number[]; phones: number[]; websites: number[]; personal: number[]; company: number; title: number; notes: number; photo: number } | null = null;
  const people: ProjectedPerson[] = [];
  const csv = new CsvReader((row: CsvRow) => {
    if (!keys) {
      keys = row.cells.map(headerKey);
      const all = (pattern: RegExp) => keys!.flatMap((key, i) => (pattern.test(key) ? [i] : []));
      const index = (name: string) => keys!.indexOf(name);
      columns = {
        emails: all(EMAIL_COLUMN), phones: all(PHONE_COLUMN), websites: all(WEBSITE_COLUMN), personal: all(PERSONAL_COLUMN),
        company: [index('organization 1 - name'), index('organization name'), index('company')].find(i => i >= 0) ?? -1,
        title: [index('organization 1 - title'), index('organization title'), index('job title')].find(i => i >= 0) ?? -1,
        notes: index('notes'), photo: index('photo'),
      };
      if (!keys.some(key => NAME_COLUMNS.includes(key)) || (!columns.emails.length && !columns.phones.length)) {
        problems.add(row.line, 'this does not look like a contacts file: it needs a Name column and an E-mail or Phone column');
      }
      return;
    }
    rows += 1;
    if (row.cells.slice(keys.length).some(cell => cell.trim() !== '')) { problems.add(row.line, 'the row has more cells than the header'); return; }
    const c = columns!;
    const cell = (i: number) => (i >= 0 ? row.cells[i] ?? '' : '');
    const index = (name: string) => keys!.indexOf(name);
    if (c.notes >= 0 && cell(c.notes).trim()) drops.add(DROPPED.notes);
    if (c.personal.some(i => cell(i).trim())) drops.add(DROPPED.personal);
    if (c.photo >= 0 && cell(c.photo).trim()) drops.add(DROPPED.photos);
    const full = cell(index('name')).trim()
      ? cell(index('name'))
      : ['first name', 'given name', 'middle name', 'additional name', 'last name', 'family name'].map(key => cell(index(key)).trim()).filter(Boolean).join(' ');
    const person: ProjectedPerson = { line: row.line };
    const name = cleanText(full, MAX_NAME, drops);
    if (name) person.name = name;
    for (const i of c.emails) for (const value of cell(i).split(':::')) addEmail(person, value, drops);
    for (const i of c.phones) for (const value of cell(i).split(':::')) addPhone(person, value, drops);
    for (const i of c.websites) for (const value of cell(i).split(':::')) if (!person.linkedin) { const url = normalLinkedIn(value); if (url) person.linkedin = url; }
    const made = finish(person, cell(c.title), cell(c.company), drops);
    if (made) { people.push(made); checkPeople(people.length, most); }
  }, problems);
  return {
    line: (text, line, long) => csv.line(text, line, long),
    end() {
      csv.end();
      if (!keys) problems.add(1, 'the file is empty');
      return { rows, people };
    },
  };
}

type Property = { name: string; params: Map<string, string[]>; value: string; line: number };

function splitParams(text: string): string[] {
  const parts: string[] = [];
  let current = '', quoted = false;
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    if (c === ';' && !quoted) { parts.push(current); current = ''; } else current += c;
  }
  parts.push(current);
  return parts;
}

/** One content line as a property: 'item1.EMAIL;TYPE=INTERNET:a@b.example'. Group prefixes are taken off. */
export function property(text: string, line: number): Property | null {
  let quoted = false, at = -1;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) { at = i; break; }
  }
  if (at < 0) return null;
  const [rawName, ...rawParams] = splitParams(text.slice(0, at));
  const name = rawName.replace(/^[A-Za-z0-9-]+\./, '').toUpperCase();
  const params = new Map<string, string[]>();
  for (const param of rawParams) {
    const eq = param.indexOf('=');
    const key = (eq < 0 ? 'TYPE' : param.slice(0, eq)).toUpperCase();
    const rawValue = eq < 0 ? param : param.slice(eq + 1);
    // A quoted value ("Mehta, Rahul") is one value; otherwise commas separate several.
    const values = /^".*"$/.test(rawValue) ? [rawValue.slice(1, -1)] : rawValue.split(',').map(value => value.replace(/^"|"$/g, ''));
    // vCard 2.1 writes some parameters bare: ;QUOTED-PRINTABLE.
    if (eq < 0 && /^quoted-printable$/i.test(param)) params.set('ENCODING', ['QUOTED-PRINTABLE']);
    else params.set(key, [...(params.get(key) ?? []), ...values]);
  }
  return { name, params, value: text.slice(at + 1), line };
}

const quotedPrintable = (prop: Property) => (prop.params.get('ENCODING') ?? []).some(value => /^quoted-printable$/i.test(value));

/** A quoted-printable value's bytes read in its charset (UTF-8 when none is named or the name is unknown). */
function decodeQuotedPrintable(value: string, charset: string | undefined): string {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(value.slice(i + 1, i + 3))) { bytes.push(parseInt(value.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(...encoder.encode(value[i]));
  }
  try { return new TextDecoder(charset ?? 'utf-8').decode(new Uint8Array(bytes)); } catch { return new TextDecoder('utf-8').decode(new Uint8Array(bytes)); }
}

const unescape = (value: string) => value.replace(/\\([nN,;\\])/g, (_m, c: string) => (c === 'n' || c === 'N' ? ' ' : c));

/** A property value as text: quoted-printable decoded, then the vCard and iCalendar escapes (\n, \, \; \\) read. */
export function textValue(prop: Property): string {
  return unescape(quotedPrintable(prop) ? decodeQuotedPrintable(prop.value, prop.params.get('CHARSET')?.[0]) : prop.value);
}

/** Components of a structured value (N, ORG), split on unescaped semicolons. */
function components(prop: Property): string[] {
  const raw = quotedPrintable(prop) ? decodeQuotedPrintable(prop.value, prop.params.get('CHARSET')?.[0]) : prop.value;
  return raw.split(/(?<!\\);/).map(unescape);
}

/**
 * Logical lines from physical ones: a line starting with a space or tab continues the one before (RFC 6350 and 5545
 * folding), and a vCard 2.1 quoted-printable line ending in '=' carries on with the next. Each logical line keeps the
 * number of its first physical line.
 */
export class Unfolder {
  #held: { text: string; line: number } | null = null;
  private readonly onLine: (text: string, line: number) => void;
  private readonly max: number;
  constructor(onLine: (text: string, line: number) => void, max: number) { this.onLine = onLine; this.max = max; }
  line(text: string, line: number): void {
    const held = this.#held;
    if (held && (text.startsWith(' ') || text.startsWith('\t'))) { held.text = (held.text + text.slice(1)).slice(0, this.max); return; }
    if (held && /ENCODING=QUOTED-PRINTABLE|;QUOTED-PRINTABLE/i.test(held.text.split(':', 1)[0]) && held.text.endsWith('=')) {
      held.text = (held.text.slice(0, -1) + text).slice(0, this.max); return;
    }
    if (held) this.onLine(held.text, held.line);
    this.#held = { text, line };
  }
  end(): void { if (this.#held) this.onLine(this.#held.text, this.#held.line); this.#held = null; }
}

/**
 * A vCard file: one person per card. FN (or N when there is no FN), EMAIL, TEL, ORG, TITLE and a LinkedIn URL are kept;
 * PHOTO and NOTE are dropped and counted, and so are BDAY, ANNIVERSARY, ADR and LABEL.
 */
export function vcardReader(drops: Drops, problems: Problems, max: number, options: ExtractOptions = {}): KindReader {
  const most = options.maxPeople ?? MAX_PEOPLE;
  let card: { start: number; props: Property[] } | null = null, cards = 0, seenBegin = false;
  const people: ProjectedPerson[] = [];
  const unfolder = new Unfolder((text, line) => {
    const trimmed = text.trim();
    if (/^BEGIN:VCARD$/i.test(trimmed)) {
      if (card) problems.add(card.start, 'a contact card is never closed');
      card = { start: line, props: [] }; cards += 1; seenBegin = true; return;
    }
    if (/^END:VCARD$/i.test(trimmed)) {
      if (card) { const made = cardPerson(card, drops); if (made) { people.push(made); checkPeople(people.length, most); } }
      card = null; return;
    }
    if (!card || !trimmed) return;
    const found = property(text, line);
    if (found) card.props.push(found);
  }, max);
  return {
    line: (text, line) => unfolder.line(text, line),
    end() {
      unfolder.end();
      if (card) problems.add((card as { start: number }).start, 'a contact card is never closed');
      if (!seenBegin) problems.add(1, 'this is not a vCard file: it has no BEGIN:VCARD line');
      return { rows: cards, people };
    },
  };
}

function cardPerson(card: { start: number; props: Property[] }, drops: Drops): ProjectedPerson | null {
  const person: ProjectedPerson = { line: card.start };
  let fn: string | null = null, n: string | null = null, org: string | null = null, title: string | null = null;
  for (const prop of card.props) {
    switch (prop.name) {
      case 'FN': fn = textValue(prop); break;
      case 'N': {
        const [family, given, additional] = components(prop);
        n = [given, additional, family].map(part => (part ?? '').trim()).filter(Boolean).join(' ');
        break;
      }
      case 'EMAIL': addEmail(person, textValue(prop), drops); break;
      case 'TEL': addPhone(person, textValue(prop), drops); break;
      case 'ORG': org = components(prop)[0] ?? null; break;
      case 'TITLE': title = textValue(prop); break;
      case 'URL': case 'X-SOCIALPROFILE': if (!person.linkedin) { const url = normalLinkedIn(textValue(prop)); if (url) person.linkedin = url; } break;
      case 'NOTE': drops.add(DROPPED.notes); break;
      case 'PHOTO': drops.add(DROPPED.photos); break;
      case 'BDAY': case 'ANNIVERSARY': case 'ADR': case 'LABEL': drops.add(DROPPED.personal); break;
      default: break;
    }
  }
  const name = cleanText(fn?.trim() ? fn : n, MAX_NAME, drops);
  if (name) person.name = name;
  return finish(person, title, org, drops);
}
