// Shared fixtures for the network tests (venture-network-*.test.ts, package 4D1): the owner's own files as text, built
// at runtime, and a direct call into the network package's handlers, as the host would after its channel check.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Context } from '../runtime/contracts.ts';
import type { NetworkImportKind, PersonRecord, SecretShelf, VentureDeps, VentureMethod } from '../runtime/venture/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { handlers } from '../runtime/venture/network/index.ts';
import { extractText, type ExtractOptions } from '../runtime/venture/network/extract.ts';
import type { Env } from './venture-views-env.ts';

type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;

/**
 * The network key the host puts on the secret shelf when the vault opens (derived from the vault's key there). Tests
 * give each business a random one, unless the shelf is one a test made without it.
 */
export function withNetworkKey(secrets: SecretShelf): SecretShelf {
  if (!secrets.has('network:forget')) secrets.set('network:forget', randomBytes(32).toString('hex'));
  return secrets;
}

/** A shelf with nothing on it: the case of a host that could not derive the network key. */
export function emptyShelf(): SecretShelf {
  const values = new Map<string, string>();
  return { get: name => values.get(name) ?? null, set: (name, value) => { values.set(name, value); }, delete: name => { values.delete(name); }, has: name => values.has(name), clear: () => values.clear() };
}

/** Calls one network handler directly. */
export function net<T>(env: Env | { deps: VentureDeps; keyless?: true }, method: VentureMethod, payload: unknown = {}, ctx: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' }): Promise<T> {
  const handler = (handlers as Record<string, Handler>)[method];
  assert.ok(handler, `no network handler for ${method}`);
  if (!('keyless' in env && env.keyless)) withNetworkKey(env.deps.secrets);
  return handler(env.deps, ctx, payload) as Promise<T>;
}

/** What the desktop's extractor sends for a file: the projection as JSON text, read in Kolkata's time. */
export function projected(kind: NetworkImportKind, text: string, options: ExtractOptions = {}): string {
  return JSON.stringify(extractText(kind, text, { timeZone: 'Asia/Kolkata', ...options }));
}

/** Every person of the business, as stored. */
export const people = (env: Env): PersonRecord[] => listRecords(env.store.read(), 'venture-person');
export const personNamed = (env: Env, name: string): PersonRecord => {
  const found = people(env).filter(person => person.name === name);
  assert.equal(found.length, 1, `exactly one person named ${name}`);
  return found[0];
};

const LINKEDIN_NOTE = '"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed their connections to see or download their email address using this setting https://www.linkedin.com/psettings/privacy/email. You can learn more here https://www.linkedin.com/help/linkedin/answer/261"';
const CONNECTIONS_HEADER = 'First Name,Last Name,URL,Email Address,Company,Position,Connected On';

/** LinkedIn's Connections.csv: the Notes lines, a blank line, then the header on line 4 and rows from line 5. */
export function connectionsCsv(rows: string[]): string {
  return ['Notes:', LINKEDIN_NOTE, '', CONNECTIONS_HEADER, ...rows].join('\r\n') + '\r\n';
}

export const CONNECTIONS = connectionsCsv([
  'Asha,Rao,https://www.linkedin.com/in/asha-rao-dewdrop,asha@dewdrop.example,Dewdrop Naturals,Co-founder,02 Oct 2026',
  'Rahul,Mehta,https://in.linkedin.com/in/RahulMehta/,,Ubtan Lab,Head of Growth,15 Mar 2024',
  'Farhan,Ali,https://www.linkedin.com/in/farhan-ali?trk=public_profile,,Ali Spices,Owner,"01 Jan 2023"',
]);

/** LinkedIn's Messages.csv. The owner (Kartavy) is in both conversations; every CONTENT cell must be dropped. */
export const MESSAGES = [
  'CONVERSATION ID,CONVERSATION TITLE,FROM,SENDER PROFILE URL,TO,RECIPIENT PROFILE URLS,DATE,SUBJECT,CONTENT,FOLDER',
  '2-abc,,Kartavy Owner,https://www.linkedin.com/in/kartavy-owner,Asha Rao,https://www.linkedin.com/in/asha-rao-dewdrop,2026-10-01 09:31:12 UTC,,"Hi Asha, can we talk about the Diwali gift boxes?",INBOX',
  '2-abc,,Asha Rao,https://www.linkedin.com/in/asha-rao-dewdrop,Kartavy Owner,https://www.linkedin.com/in/kartavy-owner,2026-10-02 10:00:00 UTC,,"Sure, call me on Friday after the stall closes.",INBOX',
  '2-def,Intro chat,Kartavy Owner,https://www.linkedin.com/in/kartavy-owner,Rahul Mehta,https://www.linkedin.com/in/rahulmehta,2026-09-20 08:00:00 UTC,Quick intro,"Rahul, meet Asha from the spice market.",INBOX',
].join('\n') + '\n';

/** A Google Contacts CSV (the older column names), with a note, a birthday and a formula planted in a name cell. */
export const CONTACTS = [
  'Name,Given Name,Family Name,Notes,Birthday,E-mail 1 - Type,E-mail 1 - Value,Phone 1 - Type,Phone 1 - Value,Organization 1 - Name,Organization 1 - Title',
  'Priya Nair,Priya,Nair,Met at the Pune expo stall,1990-01-01,* Home,priya@acme.example,Mobile,098765 43210,Acme Foods,Buyer',
  '"=HYPERLINK(""http://evil.example"",""Click"")",,,,,* Work,eve@evil.example,,,,',
  'Asha Rao,Asha,Rao,,,* Work,ASHA@Dewdrop.example ,Mobile,+91 99001 22334,Dewdrop Naturals,Co-founder',
].join('\n') + '\n';

/** A phone's contacts: one vCard 3.0 card with a photo, a note and a birthday, and one vCard 2.1 card in Hindi. */
export const VCARD = [
  'BEGIN:VCARD', 'VERSION:3.0', 'FN:Sameer Kulkarni', 'N:Kulkarni;Sameer;;;', 'EMAIL;TYPE=INTERNET:sameer@neem.example',
  'TEL;TYPE=CELL:+91 99887 76655', 'ORG:Neem Labs;Sales', 'TITLE:Partner', 'NOTE:Owes me a call about the stall rent',
  'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQ', ' AAAQABAAD', 'BDAY:1985-02-03', 'URL:https://www.linkedin.com/in/sameer-k', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:2.1', 'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E0=A4=85=E0=A4=AE=E0=A4=BF=E0=A4=A4;;;;',
  'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E0=A4=85=E0=A4=AE=E0=A4=BF=E0=A4=A4', 'TEL;CELL:9812345678', 'END:VCARD',
].join('\r\n') + '\r\n';

/** A calendar export whose X-WR-CALNAME names the owner. The DESCRIPTION must be dropped. */
export const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:owner@ledger.example',
  'BEGIN:VTIMEZONE', 'TZID:Asia/Kolkata', 'END:VTIMEZONE',
  'BEGIN:VEVENT', 'DTSTART:20261002T093000Z', 'SUMMARY:Dewdrop gift boxes', 'DESCRIPTION:Bring the price list and the forty percent sheet',
  'ORGANIZER;CN=Owner:mailto:owner@ledger.example', 'ATTENDEE;CN=Asha Rao;PARTSTAT=ACCEPTED:mailto:asha@dewdrop.example',
  'ATTENDEE;CN="Mehta, Rahul":MAILTO:Rahul@Ubtan.example', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20260915', 'SUMMARY:Lunch\\, then the market', 'ATTENDEE:mailto:asha@dewdrop.example',
  'ATTENDEE:mailto:owner@ledger.example', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n') + '\r\n';

/** A mail export (mbox) with a body line that looks like a header; the owner is owner@ledger.example. */
export const MBOX = [
  'From 1801234567890@xxx Thu Oct 02 04:00:00 +0000 2026', 'Date: Thu, 2 Oct 2026 04:00:00 +0000', 'From: Owner <owner@ledger.example>',
  'To: Asha Rao <asha@dewdrop.example>', 'Cc: Rahul Mehta <rahul@ubtan.example>', 'Subject: The gift box quote', '', 'The account number is 12345678901.',
  'To: secret@body.example', '',
  'From 1801234567891@xxx Fri Oct 03 05:00:00 +0000 2026', 'Date: Fri, 3 Oct 2026 05:00:00 +0000', 'From: Asha Rao <asha@dewdrop.example>',
  'To: owner@ledger.example', '', 'Thanks, I will look.', '',
].join('\n');
export const OWNER_MAIL = { ownerAddresses: ['owner@ledger.example'] };

/** The desktop's projection of MBOX: what the engine receives for mail. */
export const MAIL = projected('mail-headers', MBOX, OWNER_MAIL);

/** A sentence from every piece of message text, description and note in the fixtures: none may be stored. */
export const NEVER_STORED = [
  'Diwali gift boxes', 'call me on Friday', 'meet Asha from the spice market', 'Quick intro', 'Intro chat',
  'forty percent sheet', 'Met at the Pune expo stall', 'stall rent', '/9j/4AAQSkZJRgABAQ', '1990-01-01', '1985-02-03',
  'gift box quote', '12345678901', 'secret@body.example', 'I will look',
];
