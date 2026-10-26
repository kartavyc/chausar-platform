// Package 4D1, review round (Ink v2 wave 4): the pure extractor the desktop runs on the owner's computer (and the hosted
// app can run in the browser later). It streams the owner's file in any chunk sizes, caps line length, keeps only what
// Chausar keeps, and sends per-person totals for mail, meetings and messages, never one row per message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtractor, extractText, MAX_CELLS, MAX_LINE_CHARS, MAX_PEOPLE, PROJECTION_FORMAT, type ExtractOptions, type Projection } from '../runtime/venture/network/extract.ts';
import { normalLinkedIn } from '../runtime/venture/network/text.ts';
import { CONNECTIONS, CONTACTS, ICS, MESSAGES, NEVER_STORED, VCARD } from './venture-network-env.ts';

const KOLKATA = { timeZone: 'Asia/Kolkata' };
const MBOX = [
  'From 1801234567890@xxx Thu Oct 02 09:31:12 +0000 2026', 'Date: Thu, 2 Oct 2026 21:31:12 +0000', 'From: Owner <owner@ledger.example>',
  'To: "Rao, Asha" <asha@dewdrop.example>, rahul@ubtan.example', 'Subject: Diwali gift boxes', '', 'Hi Asha, call me on Friday.', 'To: secret@body.example', '',
  'From 1801234567891@xxx Fri Oct 03 05:00:00 +0000 2026', 'Date: Fri, 3 Oct 2026 05:00:00 +0000', 'From: Asha Rao <asha@dewdrop.example>',
  'To: owner@ledger.example', '', 'Sure.', '',
].join('\n');

/** The same text fed in pieces of the given size, \r\n pairs split across pieces included. */
function inPieces(kind: Parameters<typeof createExtractor>[0], text: string, size: number, options: ExtractOptions = KOLKATA): Projection {
  const extractor = createExtractor(kind, options);
  for (let i = 0; i < text.length; i += size) extractor.push(text.slice(i, i + size));
  return extractor.end();
}

test('the projection is the same whatever the chunk sizes, and keeps nothing it should not', () => {
  for (const [kind, text, options] of [
    ['linkedin-connections', CONNECTIONS, KOLKATA], ['linkedin-messages', MESSAGES, KOLKATA], ['contacts-csv', CONTACTS, KOLKATA],
    ['vcard', VCARD, KOLKATA], ['calendar-ics', ICS, KOLKATA], ['mail-headers', MBOX, { ...KOLKATA, ownerAddresses: ['owner@ledger.example'] }],
  ] as const) {
    const whole = extractText(kind, text, options);
    assert.equal(whole.format, PROJECTION_FORMAT);
    assert.equal(whole.kind, kind);
    for (const size of [1, 2, 7, 64]) assert.deepEqual(inPieces(kind, text, size, options), whole, `${kind} in pieces of ${size}`);
    const json = JSON.stringify(whole);
    for (const sentence of [...NEVER_STORED, 'secret@body.example', 'Diwali', 'call me on Friday']) assert.ok(!json.includes(sentence), `${kind}: "${sentence}" is not in the projection`);
  }
});

test('messages, meetings and mail are per-person totals by direction and month, in the owner\'s time zone, never one row per item', () => {
  const messages = extractText('linkedin-messages', MESSAGES, KOLKATA);
  assert.equal(messages.rows, 3);
  const asha = messages.people.find(person => person.name === 'Asha Rao')!;
  assert.deepEqual(asha.messages, { sent: 1, received: 1, copied: 0, first: '2026-10-01', last: '2026-10-02', months: { '2026-10': [1, 1, 0] }, conversations: 1 });
  assert.equal(asha.rows, 2);
  assert.ok(!messages.people.some(person => person.name === 'Kartavy Owner'));
  assert.deepEqual(messages.dropped, [['Message text', 3], ['Message subjects and titles', 1]]);

  // 21:31 UTC on 2 October is 3 October in Kolkata.
  const mail = extractText('mail-headers', MBOX, { ...KOLKATA, ownerAddresses: ['owner@ledger.example'] });
  const ashaMail = mail.people.find(person => person.emails?.[0] === 'asha@dewdrop.example')!;
  assert.deepEqual(ashaMail.mail, { sent: 1, received: 1, copied: 0, first: '2026-10-03', last: '2026-10-03', months: { '2026-10': [1, 1, 0] }, with: ['rahul@ubtan.example'] });
  assert.equal(ashaMail.name, 'Rao, Asha');
  assert.deepEqual(mail.dropped, [['Mail bodies and subjects', 2]]);

  const calendar = extractText('calendar-ics', ICS, KOLKATA);
  const ashaMeets = calendar.people.find(person => person.emails?.[0] === 'asha@dewdrop.example')!;
  assert.deepEqual(ashaMeets.meetings, {
    count: 2, small: 2, first: '2026-09-15', last: '2026-10-02', months: { '2026-09': [1, 1], '2026-10': [1, 1] },
    titles: ['Dewdrop gift boxes', 'Lunch, then the market'], with: ['rahul@ubtan.example'],
  });
});

test('a one-conversation LinkedIn export does not guess the owner; the owner\'s own profile settles it', () => {
  const one = [
    'CONVERSATION ID,FROM,SENDER PROFILE URL,TO,RECIPIENT PROFILE URLS,DATE,CONTENT',
    'c1,Asha Rao,https://www.linkedin.com/in/asha-rao-dewdrop,Kartavy Owner,https://www.linkedin.com/in/kartavy-owner,2026-10-01 09:00:00 UTC,Hello',
    'c1,Kartavy Owner,https://www.linkedin.com/in/kartavy-owner,Asha Rao,https://www.linkedin.com/in/asha-rao-dewdrop,2026-10-01 10:00:00 UTC,Hi',
  ].join('\n');
  assert.throws(() => extractText('linkedin-messages', one, KOLKATA), (error: any) => {
    assert.equal(error.code, 'NETWORK_FILE_INVALID');
    assert.match(error.message, /can't tell which person in this export is you/);
    return true;
  });
  const told = extractText('linkedin-messages', one, { ...KOLKATA, ownerProfile: 'linkedin.com/in/Kartavy-Owner' });
  assert.deepEqual(told.people.map(person => [person.name, person.messages?.received, person.messages?.sent]), [['Asha Rao', 1, 1]]);
});

test('lines are capped: a CSV row past the cap is refused with its line; a long vCard photo line is cut and dropped', () => {
  const long = 'x'.repeat(MAX_LINE_CHARS + 10);
  assert.throws(() => extractText('contacts-csv', `Name,E-mail 1 - Value\nAsha,a@b.example\n${long},c@d.example\n`, KOLKATA), (error: any) => {
    assert.equal(error.code, 'NETWORK_FILE_INVALID');
    assert.match(error.message, /^Line 3: the line is longer than Chausar reads/);
    return true;
  });
  const card = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Neha Shah', 'TEL:+91 90000 11111', `PHOTO;ENCODING=b:${long}`, 'END:VCARD'].join('\n');
  const projection = extractText('vcard', card, KOLKATA);
  assert.deepEqual(projection.people.map(person => person.name), ['Neha Shah']);
  assert.deepEqual(projection.dropped, [['Photos', 1]]);
});

test('text that could not be read is dropped, the address kept; a file that is not text is refused', () => {
  const mbox = ['From x@y Thu Oct 02 09:31:12 +0000 2026', 'Date: Thu, 2 Oct 2026 09:31:12 +0000', 'From: Jos� <jose@x.example>', 'To: owner@o.example', '', 'body', ''].join('\n');
  const mail = extractText('mail-headers', mbox, { ...KOLKATA, ownerAddresses: ['owner@o.example'] });
  assert.deepEqual(mail.people.map(person => [person.name ?? null, person.emails]), [[null, ['jose@x.example']]]);
  assert.deepEqual(mail.dropped, [['Text that could not be read', 1], ['Mail bodies and subjects', 1]]);
  assert.throws(() => extractText('contacts-csv', 'N\u0000a\u0000m\u0000e\u0000\n', KOLKATA), (error: any) => { assert.equal(error.code, 'NETWORK_FILE_INVALID'); assert.match(error.message, /^Line 1: the file is not plain text/); return true; });
});

test('mail needs the owner\'s addresses and stops at the message cap', () => {
  assert.throws(() => extractText('mail-headers', MBOX, KOLKATA), (error: any) => { assert.equal(error.code, 'INVALID_VENTURE_REQUEST'); return true; });
  assert.throws(() => extractText('mail-headers', MBOX, { ...KOLKATA, ownerAddresses: ['owner@ledger.example'], maxMessages: 1 }), (error: any) => {
    assert.equal(error.code, 'NETWORK_FILE_TOO_LARGE');
    assert.match(error.message, /more than 1 message/);
    return true;
  });
  assert.throws(() => extractText('mail-headers', 'Name,Email\nA,a@b.example\n', { ...KOLKATA, ownerAddresses: ['owner@ledger.example'] }), (error: any) => {
    assert.equal(error.code, 'NETWORK_FILE_INVALID');
    assert.match(error.message, /^Line 1: this is not a mail export/);
    return true;
  });
});

test('a LinkedIn address whose slug the secret screen flags is not a handle; ordinary and member slugs stay', () => {
  const flagged = 'https://www.linkedin.com/in/' + 'gh' + 'p_' + 'abcdefghijklmnopqrstuvwxyz0123456789';
  assert.equal(normalLinkedIn(flagged), null);
  assert.equal(normalLinkedIn('https://www.linkedin.com/in/ACoAABcdEf1234567890abcdefGHIJKLmnopQRS'), 'https://www.linkedin.com/in/acoaabcdef1234567890abcdefghijklmnopqrs');
  assert.equal(normalLinkedIn('https://in.linkedin.com/in/Rahul-Mehta-4b3a2c1d/'), 'https://www.linkedin.com/in/rahul-mehta-4b3a2c1d');
});

test('the extractor caps what it holds: a cell past the line cap or a row with too many cells stops the read at once, and so do too many people', () => {
  const opened = 'Name,E-mail 1 - Value\nx,"\n' + ('y'.repeat(1000) + '\n').repeat(80);
  assert.throws(() => extractText('contacts-csv', opened, KOLKATA), (error: any) => {
    assert.equal(error.code, 'NETWORK_FILE_INVALID');
    assert.match(error.message, /^Line 2: a cell is longer than Chausar reads/);
    return true;
  });
  const wide = 'Name,E-mail 1 - Value\n' + 'a,'.repeat(MAX_CELLS + 1) + '\n';
  assert.throws(() => extractText('contacts-csv', wide, KOLKATA), (error: any) => {
    assert.equal(error.code, 'NETWORK_FILE_INVALID');
    assert.match(error.message, /^Line 2: the row has more cells than Chausar reads/);
    return true;
  });
  const rows = Array.from({ length: 30 }, (_, i) => `P,N${i},https://www.linkedin.com/in/p-${i},,,,`).join('\n');
  assert.throws(() => extractText('linkedin-connections', `First Name,Last Name,URL,Email Address,Company,Position,Connected On\n${rows}\n`, { ...KOLKATA, maxPeople: 25 }), (error: any) => {
    assert.equal(error.code, 'NETWORK_FILE_TOO_LARGE');
    assert.match(error.message, /more than 25 people/);
    return true;
  });
  assert.equal(MAX_PEOPLE, 50_000);
});
