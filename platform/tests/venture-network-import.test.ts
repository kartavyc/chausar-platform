// Package 4D1 (Ink v2 wave 4): the owner's network from the owner's own files. LinkedIn's Connections and Messages
// exports, a contacts CSV, a phone's vCard, a calendar's ICS and the mail the desktop reads; message text, descriptions,
// notes and photos dropped and counted; mail, meetings and messages kept as per-person totals; the desktop's projection
// read again as a second guard; Check stores nothing; refusals keep the store as it was; Undo removes exactly what one
// import made and says first what owner-made work goes with it; one source card per kind with its age.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import { APP_ONLY_METHODS, METHOD_OWNERS, NETWORK_IMPORT_KINDS, W4_METHOD_LEVELS } from '../runtime/venture/contracts.ts';
import type { ClientRecord, NetworkImportRecord, NetworkImportResult, NetworkImportUndo, NetworkSourcesView, OpportunityRecord, PersonRecord } from '../runtime/venture/contracts.ts';
import { combinedSignals } from '../runtime/venture/network/people.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { code, owner, phone, setup, START, type Env } from './venture-views-env.ts';
import { CONNECTIONS, CONTACTS, connectionsCsv, ICS, MAIL, MBOX, MESSAGES, NEVER_STORED, net, people, personNamed, projected, VCARD } from './venture-network-env.ts';

const DAY = 86_400_000;
type Imported = Extract<NetworkImportResult, { mode: 'import' }>;
type Checked = Extract<NetworkImportResult, { mode: 'check' }>;
const imported = (env: Env, kind: string, name: string, text: string, ctx: Context = owner) =>
  net<Imported>(env, 'venture.network.import', { kind, name, text }, ctx);
const imports = (env: Env): NetworkImportRecord[] => listRecords(env.store.read(), 'venture-network-import');
const sorted = (list: PersonRecord[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
const stored = (env: Env) => JSON.stringify(env.store.read().conversations);
const fact = (person: PersonRecord, kind: string) => person.facts.filter(item => item.kind === kind);

test('the 4D1 methods belong to the network package, with their levels and app-only flags', () => {
  const approve = ['venture.network.import', 'venture.network.importUndo', 'venture.network.merge', 'venture.network.split', 'venture.network.forget'] as const;
  for (const method of approve) {
    assert.equal(METHOD_OWNERS[method], 'network');
    assert.equal(W4_METHOD_LEVELS[method], 'approve');
    assert.ok(APP_ONLY_METHODS.includes(method), `${method} is app only`);
  }
  assert.equal(W4_METHOD_LEVELS['venture.network.hide'], 'prepare');
  assert.ok(APP_ONLY_METHODS.includes('venture.network.hide'));
  for (const method of ['venture.network.people', 'venture.network.person', 'venture.network.sources'] as const) {
    assert.equal(W4_METHOD_LEVELS[method], 'read');
    assert.ok(!APP_ONLY_METHODS.includes(method));
  }
  assert.deepEqual([...NETWORK_IMPORT_KINDS], ['linkedin-connections', 'linkedin-messages', 'contacts-csv', 'vcard', 'calendar-ics', 'mail-headers']);
});

test('linkedin-connections: the Notes lines are skipped and each row is one person with handles, a role and a source for every fact', async () => {
  const env = await setup();
  const result = await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  assert.equal(result.mode, 'import');
  const importId = result.import.id;
  assert.match(importId, /^netimport_/);
  assert.deepEqual({ ...result.import, line: '' }, {
    id: importId, kind: 'linkedin-connections', fileName: 'Connections.csv', at: START, rows: 3, people: 3, merged: 0, dropped: [], undone: false, line: '',
  });
  assert.match(result.line, /3 people from Connections\.csv/);

  const asha = personNamed(env, 'Asha Rao');
  assert.deepEqual(asha.handles, { emails: ['asha@dewdrop.example'], phones: [], linkedinUrl: 'https://www.linkedin.com/in/asha-rao-dewdrop' });
  const source = { connector: 'linkedin-connections', importId, row: 5 };
  assert.deepEqual(asha.role, { title: 'Co-founder', company: 'Dewdrop Naturals', asOf: '2026-10-15', source });
  assert.ok(asha.facts.length >= 5);
  for (const item of asha.facts) assert.deepEqual(item.source, source, `${item.kind} has its source row`);
  assert.deepEqual(fact(asha, 'connection')[0].date, '2026-10-02');
  assert.deepEqual([asha.hidden, asha.clientId], [false, null]);
  assert.deepEqual(asha.history, [{ op: 'import', from: [importId], at: START, by: 'owner' }]);
  assert.equal(personNamed(env, 'Rahul Mehta').handles.linkedinUrl, 'https://www.linkedin.com/in/rahulmehta', 'host, case, slash and query normalised');
  const farhan = personNamed(env, 'Farhan Ali');
  assert.equal(farhan.handles.linkedinUrl, 'https://www.linkedin.com/in/farhan-ali');
  assert.equal(fact(farhan, 'connection')[0].source.row, 7);

  const [record] = imports(env);
  assert.deepEqual({ ...record, digest: '' }, {
    id: importId, kind: 'venture-network-import', ventureId: env.venture.id, memberId: 'owner', epoch: 1, at: START,
    importKind: 'linkedin-connections', fileName: 'Connections.csv', digest: '', rows: 3, people: 3, merged: 0, dropped: [], forgottenSkipped: 0, undoneAt: null,
  });
  assert.match(record.digest, /^[0-9a-f]{64}$/);
});

test('linkedin-messages: per person, how many went each way, by month, in how many conversations; message text dropped, counted and stored nowhere', async () => {
  const env = await setup();
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  const result = await imported(env, 'linkedin-messages', 'messages.csv', MESSAGES);
  assert.deepEqual([result.import.rows, result.import.people, result.import.merged], [3, 0, 2], 'Asha and Rahul join the people the export made');
  assert.deepEqual(result.import.dropped, [{ what: 'Message text', count: 3 }, { what: 'Message subjects and titles', count: 1 }]);
  assert.match(result.line, /Dropped message text, 3 lines/);
  const [messages] = fact(personNamed(env, 'Asha Rao'), 'message');
  assert.deepEqual([messages.value, messages.date, messages.source.row], ['messages', '2026-10-02', 2]);
  assert.deepEqual(messages.detail, { sent: 1, received: 1, copied: 0, first: '2026-10-01', last: '2026-10-02', months: { '2026-10': [1, 1, 0] }, conversations: 1, rows: 2 });
  assert.equal(fact(personNamed(env, 'Asha Rao'), 'message').length, 1, 'one total per import, not one fact per message');
  assert.deepEqual((fact(personNamed(env, 'Rahul Mehta'), 'message')[0].detail as { sent: number }).sent, 1);
  assert.ok(!people(env).some(person => person.name === 'Kartavy Owner'), 'the owner, in every conversation, is not a person in their own network');
  const all = stored(env);
  for (const sentence of NEVER_STORED) assert.ok(!all.includes(sentence), `"${sentence}" is stored nowhere`);
});

test('contacts-csv and vcard: names, emails, phones in E.164, roles; notes, photos and birthdays dropped; formula signs taken off', async () => {
  const env = await setup();
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  const csv = await imported(env, 'contacts-csv', 'contacts.csv', CONTACTS);
  assert.deepEqual([csv.import.rows, csv.import.people, csv.import.merged], [3, 2, 1]);
  assert.deepEqual(csv.import.dropped, [{ what: 'Notes', count: 1 }, { what: 'Birthdays and addresses', count: 1 }, { what: 'Formula signs at the start of a cell', count: 1 }]);
  const priya = personNamed(env, 'Priya Nair');
  assert.deepEqual(priya.handles, { emails: ['priya@acme.example'], phones: ['+919876543210'], linkedinUrl: null });
  assert.deepEqual([priya.role?.title, priya.role?.company], ['Buyer', 'Acme Foods']);
  assert.ok(priya.facts.some(item => item.kind === 'contact' && item.source.connector === 'contacts-csv'), 'a saved contact');
  assert.deepEqual(personNamed(env, 'Asha Rao').handles.phones, ['+919900122334'], 'the same email, in other case and spacing, merged');
  assert.ok(!people(env).some(person => /^[=+@-]/.test(person.name)), 'no stored name starts a formula');
  const formula = await imported(env, 'contacts-csv', 'formula.csv', 'Name,E-mail 1 - Value,Phone 1 - Value\nMallory,=cmd@evil.example,98000 00001\n');
  assert.deepEqual(formula.import.dropped, [{ what: 'Email addresses that could not be read', count: 1 }]);
  assert.ok(!people(env).some(person => person.handles.emails.some(email => /^[=+-]/.test(email))), 'no stored email starts a formula');

  const card = await imported(env, 'vcard', 'contacts.vcf', VCARD);
  assert.deepEqual([card.import.rows, card.import.people], [2, 2]);
  assert.deepEqual(card.import.dropped, [{ what: 'Notes', count: 1 }, { what: 'Photos', count: 1 }, { what: 'Birthdays and addresses', count: 1 }]);
  const sameer = personNamed(env, 'Sameer Kulkarni');
  assert.deepEqual(sameer.handles, { emails: ['sameer@neem.example'], phones: ['+919988776655'], linkedinUrl: 'https://www.linkedin.com/in/sameer-k' });
  assert.deepEqual([sameer.role?.title, sameer.role?.company], ['Partner', 'Neem Labs']);
  assert.deepEqual(personNamed(env, 'अमित').handles.phones, ['+919812345678'], 'a vCard 2.1 name in quoted-printable UTF-8');
  const all = stored(env);
  for (const sentence of NEVER_STORED) assert.ok(!all.includes(sentence), `"${sentence}" is stored nowhere`);
});

test('calendar-ics: a meeting total on every attendee but the owner: how many, how many small, by month, the newest titles, who else came', async () => {
  const env = await setup();
  const result = await imported(env, 'calendar-ics', 'work.ics', ICS);
  assert.deepEqual([result.import.rows, result.import.people, result.import.merged], [2, 2, 0]);
  assert.deepEqual(result.import.dropped, [{ what: 'Event descriptions', count: 1 }]);
  const asha = personNamed(env, 'Asha Rao');
  assert.deepEqual(asha.handles.emails, ['asha@dewdrop.example']);
  const [meetings] = fact(asha, 'meeting');
  assert.deepEqual([meetings.value, meetings.date, meetings.source.row], ['Dewdrop gift boxes', '2026-10-02', 7]);
  assert.deepEqual(meetings.detail, {
    count: 2, small: 2, first: '2026-09-15', last: '2026-10-02', months: { '2026-09': [1, 1], '2026-10': [1, 1] },
    titles: ['Dewdrop gift boxes', 'Lunch, then the market'], with: ['rahul@ubtan.example'], rows: 2, for: 'asha@dewdrop.example',
  });
  assert.deepEqual(personNamed(env, 'Mehta, Rahul').handles.emails, ['rahul@ubtan.example']);
  assert.ok(!people(env).some(person => person.handles.emails.includes('owner@ledger.example')), 'the calendar owner is not a person');
  assert.ok(!stored(env).includes('forty percent sheet'));
});

test('mail-headers: the desktop\'s per-person totals become one mail fact a person; a raw mail export sent to the engine is refused', async () => {
  const env = await setup();
  const result = await imported(env, 'mail-headers', 'takeout.mbox', MAIL);
  assert.deepEqual([result.import.rows, result.import.people], [2, 2]);
  assert.deepEqual(result.import.dropped, [{ what: 'Mail bodies and subjects', count: 2 }]);
  const [mail] = fact(personNamed(env, 'Asha Rao'), 'mail');
  assert.deepEqual(mail.detail, { sent: 1, received: 1, copied: 0, first: '2026-10-02', last: '2026-10-03', months: { '2026-10': [1, 1, 0] }, with: ['rahul@ubtan.example'], rows: 2, for: 'asha@dewdrop.example' });
  assert.deepEqual((fact(personNamed(env, 'Rahul Mehta'), 'mail')[0].detail as { sent: number }).sent, 1);
  for (const sentence of NEVER_STORED) assert.ok(!stored(env).includes(sentence), `"${sentence}" is stored nowhere`);
  const before = stored(env);
  await assert.rejects(imported(env, 'mail-headers', 'raw.mbox', MBOX), (error: any) => {
    assert.equal(error.code, 'NETWORK_FILE_INVALID');
    assert.match(error.message, /desktop app/);
    return true;
  });
  assert.equal(stored(env), before);
});

test('the desktop\'s projection is read again as a second guard: unknown fields dropped and counted, handles normalised, a bad field named by its source line', async () => {
  const env = await setup();
  const text = JSON.stringify({
    format: 'chausar-network/1', kind: 'contacts-csv', rows: 2, dropped: [['Notes', 1]],
    people: [
      { line: 2, name: '=Priya Nair', emails: ['PRIYA@Acme.example'], phones: ['098765 43210'], title: 'Buyer', company: 'Acme Foods', contact: true, content: 'Hi Priya, the rate is lower.' },
      { line: 3, name: 'No Handle', contact: true },
    ],
  });
  const result = await imported(env, 'contacts-csv', 'contacts.csv', text);
  assert.deepEqual(result.import.dropped, [{ what: 'Notes', count: 1 }, { what: 'Fields Chausar does not keep', count: 1 }, { what: 'Formula signs at the start of a cell', count: 1 }, { what: 'Rows with no email, phone or profile link', count: 1 }]);
  const priya = personNamed(env, 'Priya Nair');
  assert.deepEqual(priya.handles, { emails: ['priya@acme.example'], phones: ['+919876543210'], linkedinUrl: null });
  assert.ok(!stored(env).includes('the rate is lower'));
  const bad = JSON.stringify({ format: 'chausar-network/1', kind: 'linkedin-messages', rows: 1, dropped: [], people: [{ line: 41, linkedin: 'https://www.linkedin.com/in/x-y', messages: { sent: -1, received: 0, copied: 0, first: '2026-10-01', last: '2026-10-01', months: {}, conversations: 1 } }] });
  await assert.rejects(imported(env, 'linkedin-messages', 'm.csv', bad), (error: any) => { assert.equal(error.code, 'NETWORK_FILE_INVALID'); assert.match(error.message, /^Line 41: /); return true; });
  await assert.rejects(imported(env, 'linkedin-messages', 'm.csv', text), (error: any) => { assert.equal(error.code, 'INVALID_VENTURE_REQUEST'); return true; }, 'a projection of another kind');
  await assert.rejects(imported(env, 'contacts-csv', 'x.csv', '{"format":"chausar-network/1",'), code('NETWORK_FILE_INVALID'));
});

test('re-importing a newer export never double-counts: per month and direction the larger count wins across live imports', async () => {
  const env = await setup();
  await imported(env, 'linkedin-messages', 'messages.csv', MESSAGES);
  const newer = MESSAGES + '2-abc,,Asha Rao,https://www.linkedin.com/in/asha-rao-dewdrop,Kartavy Owner,https://www.linkedin.com/in/kartavy-owner,2026-11-04 10:00:00 UTC,,"Any news?",INBOX\n';
  await imported(env, 'linkedin-messages', 'messages (2).csv', newer);
  const asha = personNamed(env, 'Asha Rao');
  assert.equal(fact(asha, 'message').length, 2, 'each import keeps its own total, so Undo stays exact');
  assert.deepEqual(combinedSignals(asha).messages, { sent: 1, received: 2, copied: 0, first: '2026-10-01', last: '2026-11-04', months: { '2026-10': [1, 1, 0], '2026-11': [0, 1, 0] } });
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  await imported(env, 'linkedin-connections', 'Connections (2).csv', CONNECTIONS + 'Neha,Shah,https://www.linkedin.com/in/neha-shah,,,,\r\n');
  assert.equal(combinedSignals(personNamed(env, 'Asha Rao')).connected, '2026-10-02');
  assert.equal(fact(personNamed(env, 'Asha Rao'), 'connection').length, 2);
});

test('a cell with text that could not be read is dropped and the row kept; a file that is not text is refused', async () => {
  const env = await setup();
  const result = await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS.replace('Ubtan Lab', 'Ubtan � Lab'));
  assert.deepEqual(result.import.dropped, [{ what: 'Text that could not be read', count: 1 }]);
  assert.deepEqual([personNamed(env, 'Rahul Mehta').role?.company, personNamed(env, 'Rahul Mehta').role?.title], [null, 'Head of Growth']);
  await assert.rejects(imported(env, 'contacts-csv', 'utf16.csv', 'N\u0000a\u0000m\u0000e\u0000\n'), (error: any) => { assert.equal(error.code, 'NETWORK_FILE_INVALID'); assert.match(error.message, /^Line 1: the file is not plain text/); return true; });
});

test('check: true answers what an import would keep and drop, with three samples, and stores nothing', async () => {
  const env = await setup();
  const before = stored(env);
  const check = await net<Checked>(env, 'venture.network.import', { kind: 'linkedin-connections', name: 'Connections.csv', text: CONNECTIONS, check: true });
  assert.equal(check.mode, 'check');
  assert.deepEqual([check.kept, check.people, check.merged, check.dropped], [3, 3, 0, []]);
  assert.deepEqual(check.samples, [
    { name: 'Asha Rao', line: 'Co-founder at Dewdrop Naturals' }, { name: 'Rahul Mehta', line: 'Head of Growth at Ubtan Lab' }, { name: 'Farhan Ali', line: 'Owner at Ali Spices' },
  ]);
  assert.match(check.line, /Nothing is saved/);
  assert.equal(stored(env), before, 'Check stores nothing');
  const messages = await net<Checked>(env, 'venture.network.import', { kind: 'linkedin-messages', name: 'messages.csv', text: MESSAGES, check: true });
  assert.deepEqual(messages.dropped, [{ what: 'Message text', count: 3 }, { what: 'Message subjects and titles', count: 1 }]);
  assert.equal(stored(env), before);
});

test('refusals keep the store as it was: size, a line that cannot be read, too many people, the same file, an unknown kind, the hosted app, the phone', async () => {
  const env = await setup();
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  const before = stored(env);
  const refused = async (payload: Record<string, unknown>, expected: string, message: RegExp | null = null, ctx: Context = owner, deps = env.deps) => {
    await assert.rejects(net({ deps }, 'venture.network.import', payload, ctx), (error: any) => {
      assert.equal(error.code, expected, error.message);
      if (message) assert.match(error.message, message);
      return true;
    });
    assert.equal(stored(env), before, `nothing half-imported after ${expected}`);
  };
  await refused({ kind: 'linkedin-connections', name: 'big.csv', text: 'x'.repeat(6_500_000) }, 'NETWORK_FILE_TOO_LARGE', /^This file is 6\.2 MB; Chausar reads at most 4 MB at once\./);
  const rows = Array.from({ length: 807 }, (_, i) => `Person,Number${i},https://www.linkedin.com/in/person-${i},,Co,Role,02 Oct 2026`);
  await refused({ kind: 'linkedin-connections', name: 'bad.csv', text: connectionsCsv([...rows, 'Bad,Date,https://www.linkedin.com/in/bad-date,,Co,Role,32 Foo 2026', 'Also,Bad,https://www.linkedin.com/in/also-bad,,Co,Role,yesterday']) },
    'NETWORK_FILE_INVALID', /^Line 812: the Connected On date could not be read\. 1 more line could not be read\./);
  const many = Array.from({ length: 20_001 }, (_, i) => `P,N${i},https://www.linkedin.com/in/p-${i},,,,`);
  await refused({ kind: 'linkedin-connections', name: 'many.csv', text: connectionsCsv(many) }, 'NETWORK_FILE_TOO_LARGE', /20,001 people.*20,000/);
  await refused({ kind: 'linkedin-connections', name: 'Connections again.csv', text: CONNECTIONS }, 'NETWORK_ALREADY_IMPORTED', /already imported/i);
  await refused({ kind: 'linkedin-connections', name: 'again.csv', text: CONNECTIONS, check: true }, 'NETWORK_ALREADY_IMPORTED');
  await refused({ kind: 'x-archive', name: 'x.zip', text: 'a' }, 'INVALID_VENTURE_REQUEST');
  await refused({ kind: 'linkedin-connections', name: 'nul.csv', text: CONNECTIONS.replace('Ubtan Lab', 'Ubtan\u0000Lab') }, 'NETWORK_FILE_INVALID', /^Line 6: /);
  await refused({ kind: 'linkedin-connections', name: 'cut.csv', text: connectionsCsv(['Asha,Rao,"https://www.linkedin.com/in/cut']) }, 'NETWORK_FILE_INVALID', /^Line 5: /);
  await refused({ kind: 'contacts-csv', name: 'wrong.csv', text: 'Colour,Size\nRed,Large\n' }, 'NETWORK_FILE_INVALID', /^Line 1: /);
  await refused({ kind: 'linkedin-connections', name: 'C.csv', text: CONNECTIONS + 'X,Y,https://www.linkedin.com/in/x,,,,\n' }, 'TIER_UNAVAILABLE',
    /^Import your network in the desktop app\. It reads the file on your computer\.$/, owner, { ...env.deps, host: 'hosted-web' });
  await refused({ kind: 'linkedin-connections', name: 'C.csv', text: CONNECTIONS + 'X,Y,https://www.linkedin.com/in/x,,,,\n' }, 'APP_APPROVAL_REQUIRED', null, phone);
});

test('venture.network.importUndo removes exactly what one import made, people it joined included, and the file may come in again', async () => {
  const env = await setup();
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  await imported(env, 'contacts-csv', 'contacts.csv', 'Name,E-mail 1 - Value,Organization 1 - Name\nRahul M,rahul@ubtan.example,Ubtan Lab\nPriya Nair,priya@acme.example,Acme Foods\n');
  const before = sorted(people(env));
  assert.equal(before.length, 5);

  // One card names Rahul's LinkedIn page and the email the contacts file knew, so the two Rahuls become one; Neha is new.
  const linking = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Rahul Mehta', 'EMAIL:rahul@ubtan.example', 'URL:https://linkedin.com/in/rahulmehta', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:3.0', 'FN:Neha Shah', 'TEL:+91 90000 11111', 'END:VCARD'].join('\n');
  const made = await imported(env, 'vcard', 'phone.vcf', linking);
  assert.deepEqual([made.import.people, made.import.merged], [1, 1]);
  assert.equal(people(env).length, 5, 'the two Rahuls are one person; Neha is new');
  const rahul = personNamed(env, 'Rahul Mehta');
  assert.deepEqual(rahul.handles, { emails: ['rahul@ubtan.example'], phones: [], linkedinUrl: 'https://www.linkedin.com/in/rahulmehta' });
  assert.ok(rahul.history.some(entry => entry.op === 'merge' && entry.from.includes(made.import.id)));

  await assert.rejects(net(env, 'venture.network.importUndo', { importId: made.import.id }, phone), code('APP_APPROVAL_REQUIRED'));
  env.advance(DAY);
  const undone = await net<NetworkImportUndo>(env, 'venture.network.importUndo', { importId: made.import.id });
  assert.deepEqual([undone.removed, undone.preview, undone.goes], [1, false, []]);
  assert.equal(undone.import.undone, true);
  assert.match(undone.line, /1 person/);
  assert.deepEqual(sorted(people(env)), before, 'every person is exactly as before the import');
  assert.equal(imports(env).find(record => record.id === made.import.id)!.undoneAt, new Date(Date.parse(START) + DAY).toISOString());
  await assert.rejects(net(env, 'venture.network.importUndo', { importId: made.import.id }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(net(env, 'venture.network.importUndo', { importId: 'netimport_nothing' }), code('INVALID_VENTURE_REQUEST'));

  const again = await imported(env, 'vcard', 'phone.vcf', linking);
  assert.equal(again.import.people, 1, 'an undone file may be imported again');
});

test('Undo after a merge is exact: a pipeline card goes back to the person it named, and a client link the import made comes off', async () => {
  const env = await setup();
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  await imported(env, 'contacts-csv', 'c.csv', 'Name,E-mail 1 - Value\nRahul M,rahul@ubtan.example\n');
  await ventureAction(env.deps, owner, 'prepare', 'seed.client', tx => tx.put<ClientRecord>({ ...tx.base('venture-client'), name: 'Ubtan', email: 'rahul@ubtan.example', countryCode: 'IN', taxId: null, stateCode: '27', note: null }));
  const rahulM = personNamed(env, 'Rahul M');
  const card = await ventureAction(env.deps, owner, 'admin', 'seed.card', tx => tx.put({
    ...tx.base('venture-opportunity'), personId: rahulM.id, stage: 'asked', trigger: { kind: 'owner', ref: null, line: 'You added him' }, history: [], next: null, sequence: null,
    nudges: 0, leadId: null, clientId: null, linkedFrom: null, lostReason: null, askAgainFrom: null, basis: null,
  } as OpportunityRecord));
  await ventureAction(env.deps, owner, 'admin', 'seed.evidence', tx => tx.put({ ...tx.base('venture-evidence'), subject: `person:${rahulM.id}`, field: 'tie.note', value: 'x' } as never));
  const before = sorted(people(env));
  const link = await imported(env, 'vcard', 'l.vcf', ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Rahul Mehta', 'EMAIL:rahul@ubtan.example', 'URL:https://www.linkedin.com/in/rahulmehta', 'END:VCARD'].join('\n'));
  const merged = personNamed(env, 'Rahul Mehta');
  assert.equal(listRecords(env.store.read(), 'venture-opportunity')[0].personId, merged.id, 'the card follows the merge');
  assert.ok(merged.clientId, 'the merged person has the client\'s email, so the link is made');
  await net(env, 'venture.network.importUndo', { importId: link.import.id });
  assert.deepEqual(sorted(people(env)), before, 'both Rahuls exactly as before, the client link included');
  const state = env.store.read();
  assert.equal(listRecords(state, 'venture-opportunity').find(item => item.id === card.id)!.personId, rahulM.id);
  // The seeded row, not one of the tie rows 4D2 keeps for every person (those are worked out again after each change).
  assert.equal(listRecords(state, 'venture-evidence').find(row => row.field === 'tie.note')!.subject, `person:${rahulM.id}`);
});

test('Undo says first what owner-made work goes with the people it removes: preview: true names the cards and drafts and changes nothing', async () => {
  const env = await setup();
  const made = await imported(env, 'vcard', 'neha.vcf', ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Neha Shah', 'TEL:+91 90000 11111', 'END:VCARD'].join('\n'));
  const neha = personNamed(env, 'Neha Shah');
  await ventureAction(env.deps, owner, 'admin', 'seed.card', tx => {
    const card = tx.put({
      ...tx.base('venture-opportunity'), personId: neha.id, stage: 'found', trigger: { kind: 'owner', ref: null, line: 'You added her' }, history: [], next: null, sequence: null,
      nudges: 0, leadId: null, clientId: null, linkedFrom: null, lostReason: null, askAgainFrom: null, basis: null,
    } as OpportunityRecord);
    tx.put({ ...tx.base('venture-outreach'), opportunityId: card.id, personId: neha.id, outreachKind: 'connection-note', channel: 'linkedin', text: 'Hi Neha', digest: 'd', sent: null } as never);
  });
  const before = stored(env);
  const preview = await net<NetworkImportUndo>(env, 'venture.network.importUndo', { importId: made.import.id, preview: true });
  assert.equal(preview.preview, true);
  assert.deepEqual(preview.goes, ['Neha Shah: a pipeline card and 1 draft']);
  assert.match(preview.line, /would remove 1 person/);
  assert.equal(stored(env), before, 'a preview changes nothing');
  const done = await net<NetworkImportUndo>(env, 'venture.network.importUndo', { importId: made.import.id });
  assert.deepEqual([done.preview, done.goes], [false, ['Neha Shah: a pipeline card and 1 draft']]);
  assert.equal(listRecords(env.store.read(), 'venture-opportunity').length, 0);
});

test('venture.network.sources: one card per kind with the file, date and counts, and an age line once the newest copy is older than 60 days', async () => {
  const env = await setup();
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  await imported(env, 'linkedin-messages', 'messages.csv', MESSAGES);
  await imported(env, 'calendar-ics', 'work.ics', ICS);
  const fresh = await net<NetworkSourcesView>(env, 'venture.network.sources', {}, phone);
  // 4D2 works the ties out after every import, so the bands count everyone (venture-network-strength.test.ts holds the rest).
  const { receiptId, permille: _permille, ...bands } = fresh.bands!;
  assert.equal(Object.values(bands).reduce((sum, value) => sum + value, 0), people(env).length);
  assert.match(receiptId, /^sum_/);
  assert.deepEqual(fresh.sources.map(card => [card.kind, card.fileName, card.at, card.kept, card.dropped, card.stale]), [
    ['linkedin-connections', 'Connections.csv', START, 3, 0, null],
    ['linkedin-messages', 'messages.csv', START, 2, 4, null],
    ['calendar-ics', 'work.ics', START, 2, 1, null],
  ]);
  // 4D4: the line no longer repeats the kind, which the card already names.
  assert.equal(fresh.sources[0].line, '3 people, imported 15 Oct 2026.');
  // 4D4: whether a web search is set up here, for the screens to say so in place of the web choice.
  assert.equal(fresh.webSearch, 'not-set-up');
  env.deps.webSearch = { search: async () => [] };
  assert.equal((await net<NetworkSourcesView>(env, 'venture.network.sources')).webSearch, 'set-up');
  delete env.deps.webSearch;

  env.advance(30 * DAY);
  assert.equal((await net<NetworkSourcesView>(env, 'venture.network.sources')).sources[0].stale, null);
  env.advance(31 * DAY);
  const old = await net<NetworkSourcesView>(env, 'venture.network.sources');
  assert.deepEqual(old.sources.map(card => card.stale), [
    'Imported 2 months ago. Download a new copy to catch new connections.',
    'Imported 2 months ago. Download a new copy to catch new messages.',
    'Imported 2 months ago. Export a new copy to catch new meetings.',
  ]);
  env.advance(34 * DAY);
  assert.equal((await net<NetworkSourcesView>(env, 'venture.network.sources')).sources[0].stale, 'Imported 3 months ago. Download a new copy to catch new connections.');
});

test('the desktop and the engine read a file the same way: the projection of a raw file imports exactly as the raw file does', async () => {
  const [raw, viaDesktop] = [await setup(), await setup()];
  for (const [kind, text] of [['linkedin-connections', CONNECTIONS], ['linkedin-messages', MESSAGES], ['contacts-csv', CONTACTS], ['vcard', VCARD], ['calendar-ics', ICS]] as const) {
    await imported(raw, kind, `${kind}.txt`, text);
    await imported(viaDesktop, kind, `${kind}.txt`, projected(kind, text));
  }
  const shape = (env: Env) => people(env).map(person => ({ name: person.name, handles: person.handles, role: person.role?.title ?? null, facts: person.facts.map(item => [item.kind, item.value, item.date, item.detail, item.source.row]) }));
  assert.deepEqual(shape(viaDesktop), shape(raw));
});

const vcard = (fn: string, emails: string[]) => ['BEGIN:VCARD', 'VERSION:3.0', `FN:${fn}`, ...emails.map(email => `EMAIL:${email}`), 'END:VCARD'].join('\n');

test('Undo goes newest first among imports that merged the same people: an older one is refused, naming the import to undo first', async () => {
  const env = await setup();
  await imported(env, 'contacts-csv', 'z.csv', 'Name,E-mail 1 - Value\nRahul Old,r0@x.example\n');
  await imported(env, 'contacts-csv', 'a.csv', 'Name,E-mail 1 - Value\nRahul Mehta,r1@x.example\n');
  await imported(env, 'contacts-csv', 'b.csv', 'Name,E-mail 1 - Value\nR M,r2@x.example\n');
  const before = sorted(people(env));
  const x = await imported(env, 'vcard', 'x.vcf', vcard('Rahul Mehta', ['r1@x.example', 'r2@x.example']));
  const y = await imported(env, 'vcard', 'y.vcf', vcard('Rahul Old', ['r0@x.example', 'r1@x.example']));
  const state = stored(env);
  await assert.rejects(net(env, 'venture.network.importUndo', { importId: x.import.id }), (error: any) => {
    assert.equal(error.code, 'INVALID_VENTURE_REQUEST');
    assert.match(error.message, /^Undo y\.vcf first: it merged people this import also changed\./);
    return true;
  });
  await assert.rejects(net(env, 'venture.network.importUndo', { importId: x.import.id, preview: true }), code('INVALID_VENTURE_REQUEST'));
  assert.equal(stored(env), state);
  await net(env, 'venture.network.importUndo', { importId: y.import.id });
  await net(env, 'venture.network.importUndo', { importId: x.import.id });
  assert.deepEqual(sorted(people(env)), before, 'newest first, both undone exactly');
});

test('Undo puts search entries back by the person they named, even after another entry was removed in between', async () => {
  const env = await setup();
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  await imported(env, 'contacts-csv', 'c.csv', 'Name,E-mail 1 - Value\nRahul M,rahul@ubtan.example\n');
  const p1 = personNamed(env, 'Rahul Mehta'), p2 = personNamed(env, 'Rahul M'), farhan = personNamed(env, 'Farhan Ali');
  await ventureAction(env.deps, owner, 'admin', 'seed.search', tx => tx.put({
    ...tx.base('venture-network-search'), text: 'q', traits: [], candidates: 3, web: false, callIds: [],
    results: [{ personId: farhan.id, url: null, fitBp: 1, checks: [] }, { personId: p2.id, url: null, fitBp: 2222, checks: [] }, { personId: p1.id, url: null, fitBp: 1111, checks: [] }],
    shown: [farhan.id, p2.id, p1.id], saved: null,
  } as never));
  const link = await imported(env, 'vcard', 'l.vcf', ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Rahul Mehta', 'EMAIL:rahul@ubtan.example', 'URL:https://www.linkedin.com/in/rahulmehta', 'END:VCARD'].join('\n'));
  await net(env, 'venture.network.forget', { id: farhan.id });
  await net(env, 'venture.network.importUndo', { importId: link.import.id });
  const [search] = listRecords(env.store.read(), 'venture-network-search');
  assert.deepEqual(search.results.map(result => [result.personId, result.fitBp]), [[p2.id, 2222], [p1.id, 1111]]);
  assert.deepEqual([...search.shown].sort(), [p1.id, p2.id].sort());
});

const OWNER_O = { ownerAddresses: ['o@o.example'] };
const mail = (id: number, day: number, to: string) => [`From ${id}@x Thu Oct 0${day} 04:00:00 +0000 2026`, `Date: Thu, ${day} Oct 2026 04:00:00 +0000`, 'From: O <o@o.example>', `To: ${to}`, '', 'b', ''].join('\n');

test('one mail to two addresses of the same person counts once within an import', async () => {
  const env = await setup();
  await imported(env, 'contacts-csv', 'c.csv', 'Name,E-mail 1 - Value,E-mail 2 - Value\nAsha Rao,a1@x.example,a2@x.example\n');
  await imported(env, 'mail-headers', 'm.mbox', projected('mail-headers', [mail(1, 2, 'Asha <a1@x.example>, Asha <a2@x.example>'), mail(2, 3, 'a1@x.example')].join('\n'), OWNER_O));
  const signals = combinedSignals(people(env)[0]);
  assert.equal(signals.mail?.sent, 2, 'two mails: the first went to both of her addresses');
});

test('exports whose days do not overlap add up; overlapping exports never count a mail twice', async () => {
  const overlap = await setup();
  await imported(overlap, 'mail-headers', 'm1.mbox', projected('mail-headers', [mail(1, 2, 'a1@x.example'), mail(2, 3, 'a1@x.example')].join('\n'), OWNER_O));
  await imported(overlap, 'mail-headers', 'm2.mbox', projected('mail-headers', [mail(1, 2, 'a1@x.example'), mail(2, 3, 'a1@x.example'), mail(3, 4, 'a1@x.example')].join('\n'), OWNER_O));
  assert.equal(combinedSignals(people(overlap)[0]).mail?.sent, 3);
  const parts = await setup();
  await imported(parts, 'mail-headers', 'p1.mbox', projected('mail-headers', [mail(1, 2, 'a1@x.example'), mail(2, 3, 'a1@x.example')].join('\n'), OWNER_O));
  await imported(parts, 'mail-headers', 'p2.mbox', projected('mail-headers', [mail(3, 4, 'a1@x.example'), mail(4, 5, 'a1@x.example')].join('\n'), OWNER_O));
  const signals = combinedSignals(people(parts)[0]);
  assert.deepEqual([signals.mail?.sent, signals.mail?.first, signals.mail?.last, signals.mail?.months], [4, '2026-10-02', '2026-10-05', { '2026-10': [4, 0, 0] }]);
});
