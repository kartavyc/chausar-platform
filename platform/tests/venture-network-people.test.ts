// Package 4D1 (Ink v2 wave 4): one person per real person. The same email, phone (E.164 with the business country) or
// LinkedIn address merges by itself; the same name and company only makes a "Same person?" suggestion; a name alone
// never merges. Each merge is kept in the person's history; Split moves source rows to a new person; Hide keeps a
// person out of lists; the person view lists every field Chausar keeps with its source row.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClientRecord, NetworkImportResult, PeopleView, PersonRecord, PersonSplit, PersonSummary, PersonView } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { code, owner, phone, setup, START, type Env } from './venture-views-env.ts';
import { CONNECTIONS, CONTACTS, MESSAGES, net, people, personNamed } from './venture-network-env.ts';

type Imported = Extract<NetworkImportResult, { mode: 'import' }>;
const imported = (env: Env, kind: string, name: string, text: string) => net<Imported>(env, 'venture.network.import', { kind, name, text });
const named = (env: Env, name: string): PersonRecord[] => people(env).filter(person => person.name === name);

test('the same email, phone or LinkedIn address merges into one person, whatever its spelling, and each merge is in its history', async () => {
  const env = await setup();
  const a = await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  const b = await imported(env, 'contacts-csv', 'contacts.csv', CONTACTS);
  assert.equal(named(env, 'Asha Rao').length, 1, 'the email merged');
  const c = await imported(env, 'vcard', 'priya.vcf', ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Priya N', 'TEL:+91-98765-43210', 'EMAIL:priya.nair@mail.example', 'END:VCARD'].join('\n'));
  assert.deepEqual([c.import.people, c.import.merged], [0, 1], 'the phone, in another spelling, merged');
  const priya = personNamed(env, 'Priya Nair');
  assert.deepEqual(priya.handles.emails, ['priya@acme.example', 'priya.nair@mail.example']);
  const d = await imported(env, 'linkedin-connections', 'Connections (1).csv',
    'First Name,Last Name,URL,Email Address,Company,Position,Connected On\nAsha,R.,linkedin.com/in/ASHA-RAO-DEWDROP/,,Dewdrop Naturals,Founder,02 Oct 2026\n');
  assert.deepEqual([d.import.people, d.import.merged], [0, 1], 'the LinkedIn address, without its scheme and in capitals, merged');
  const asha = personNamed(env, 'Asha Rao');
  assert.deepEqual(asha.history, [
    { op: 'import', from: [a.import.id], at: START, by: 'owner' },
    { op: 'merge', from: [b.import.id], at: START, by: 'owner' },
    { op: 'merge', from: [d.import.id], at: START, by: 'owner' },
  ]);
  assert.deepEqual([asha.role?.title, asha.roles.map(role => role.title)], ['Founder', ['Co-founder']], 'the newest role leads; the earlier one is kept');
});

test('the same name and company is a "Same person?" suggestion; the same name alone never merges or suggests', async () => {
  const env = await setup();
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  await imported(env, 'contacts-csv', 'personal.csv', [
    'Name,E-mail 1 - Value,Organization 1 - Name',
    'asha  RAO,asha.personal@mail.example,Dewdrop Naturals Pvt. Ltd.',
    'Farhan Ali,farhan@other.example,',
  ].join('\n'));
  assert.equal(people(env).length, 5, 'nothing merged on a name');
  const plain = await net<PeopleView>(env, 'venture.network.people', {});
  assert.deepEqual(plain.suggestions, [], 'suggestions only when asked');
  const view = await net<PeopleView>(env, 'venture.network.people', { suggestions: true }, phone);
  const ashas = people(env).filter(person => /^asha/i.test(person.name)).map(person => person.id);
  assert.equal(view.suggestions.length, 1);
  assert.deepEqual([view.suggestions[0].a, view.suggestions[0].b], ashas);
  assert.match(view.suggestions[0].line, /Same person\?/);
  assert.equal(view.total, 5);
  assert.deepEqual(view.people.map(person => person.name), ['Asha Rao', 'asha RAO', 'Farhan Ali', 'Farhan Ali', 'Rahul Mehta']);
  const asha: PersonSummary = view.people[0];
  // band and dots come from the tie 4D2 works out after every import (venture-network-strength.test.ts holds them).
  const tie = listRecords(env.store.read(), 'venture-tie').find(item => item.personId === asha.id)!;
  const dots = { close: 5, 'know-well': 4, know: 3, 'met-once': 2, cold: 1 }[tie.band];
  assert.deepEqual({ ...asha, id: '' }, { id: '', name: 'Asha Rao', initials: 'AR', title: 'Co-founder', company: 'Dewdrop Naturals', band: tie.band, dots, hidden: false, degree: '1st' });
  const filtered = await net<PeopleView>(env, 'venture.network.people', { query: 'ubtan' });
  assert.deepEqual(filtered.people.map(person => person.name), ['Rahul Mehta']);
  // 4D4: limit, so a count needs no summaries (0) and a list can page; total still counts everyone matched.
  const counted = await net<PeopleView>(env, 'venture.network.people', { limit: 0 });
  assert.deepEqual([counted.people, counted.total], [[], 5]);
  assert.deepEqual((await net<PeopleView>(env, 'venture.network.people', { limit: 2 })).people.map(person => person.name), ['Asha Rao', 'asha RAO']);
  await assert.rejects(net(env, 'venture.network.people', { limit: 501 }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(net(env, 'venture.network.people', { limit: 1.5 }), code('INVALID_VENTURE_REQUEST'));
});

test('venture.network.merge joins two people and journals it; venture.network.split moves source rows to a new person', async () => {
  const env = await setup();
  const a = await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  const b = await imported(env, 'contacts-csv', 'personal.csv', 'Name,E-mail 1 - Value,Organization 1 - Name\nAsha Rao,asha.personal@mail.example,Dewdrop Naturals\n');
  const [first, second] = named(env, 'Asha Rao');
  await assert.rejects(net(env, 'venture.network.merge', { a: first.id, b: second.id }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(net(env, 'venture.network.merge', { a: first.id, b: first.id }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(net(env, 'venture.network.merge', { a: first.id, b: 'person_nobody' }), code('INVALID_VENTURE_REQUEST'));

  const merged = await net<PersonView>(env, 'venture.network.merge', { a: first.id, b: second.id });
  assert.equal(merged.person.id, first.id);
  assert.equal(merged.merged, true);
  assert.equal(named(env, 'Asha Rao').length, 1);
  const asha = personNamed(env, 'Asha Rao');
  assert.deepEqual(asha.handles.emails, ['asha@dewdrop.example', 'asha.personal@mail.example']);
  assert.deepEqual(asha.history.at(-1), { op: 'merge', from: [second.id], at: START, by: 'owner' });

  await assert.rejects(net(env, 'venture.network.split', { personId: asha.id, sourceIds: [`${a.import.id}:5`, `${b.import.id}:2`] }), code('INVALID_VENTURE_REQUEST'), 'not every source');
  await assert.rejects(net(env, 'venture.network.split', { personId: asha.id, sourceIds: ['netimport_nothing:9'] }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(net(env, 'venture.network.split', { personId: asha.id, sourceIds: [`${b.import.id}:2`] }, phone), code('APP_APPROVAL_REQUIRED'));
  const split = await net<PersonSplit>(env, 'venture.network.split', { personId: asha.id, sourceIds: [`${b.import.id}:2`] });
  assert.equal(split.person.person.id, asha.id);
  assert.notEqual(split.split.person.id, asha.id);
  const [kept, moved] = [people(env).find(person => person.id === asha.id)!, people(env).find(person => person.id === split.split.person.id)!];
  assert.deepEqual(kept.handles.emails, ['asha@dewdrop.example']);
  assert.deepEqual(moved.handles.emails, ['asha.personal@mail.example']);
  assert.deepEqual(kept.history.at(-1), { op: 'split', from: [moved.id], at: START, by: 'owner' });
  assert.deepEqual(moved.history, [{ op: 'split', from: [kept.id], at: START, by: 'owner' }]);

  // The split stays: a later file naming both addresses joins the older one and does not merge them back.
  await imported(env, 'contacts-csv', 'both.csv', 'Name,E-mail 1 - Value,E-mail 2 - Value\nAsha Rao,asha@dewdrop.example,asha.personal@mail.example\n');
  assert.equal(people(env).filter(person => person.name === 'Asha Rao').length, 2, 'split people are not merged back by an import');
});

test('hide keeps a person out of lists until shown again; the person view still opens', async () => {
  const env = await setup();
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  const farhan = personNamed(env, 'Farhan Ali');
  await assert.rejects(net(env, 'venture.network.hide', { personId: farhan.id, hidden: true }, phone), code('APP_APPROVAL_REQUIRED'));
  const hidden = await net<{ person: PersonSummary }>(env, 'venture.network.hide', { personId: farhan.id, hidden: true });
  assert.equal(hidden.person.hidden, true);
  assert.deepEqual((await net<PeopleView>(env, 'venture.network.people', {})).people.map(person => person.name), ['Asha Rao', 'Rahul Mehta']);
  assert.deepEqual((await net<PeopleView>(env, 'venture.network.people', { hidden: true })).people.map(person => person.name), ['Farhan Ali']);
  assert.equal((await net<PersonView>(env, 'venture.network.person', { id: farhan.id })).person.hidden, true);
  assert.deepEqual(personNamed(env, 'Farhan Ali').history.at(-1), { op: 'hide', from: [], at: START, by: 'owner' });
  await net(env, 'venture.network.hide', { personId: farhan.id, hidden: false });
  assert.equal((await net<PeopleView>(env, 'venture.network.people', {})).people.length, 3);
  assert.deepEqual(personNamed(env, 'Farhan Ali').history.at(-1), { op: 'show', from: [], at: START, by: 'owner' });
});

test('venture.network.person lists every field Chausar keeps with its source row: the "What Chausar keeps about this person" record', async () => {
  const env = await setup();
  const a = await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  const m = await imported(env, 'linkedin-messages', 'messages.csv', MESSAGES);
  const asha = personNamed(env, 'Asha Rao');
  const view = await net<PersonView>(env, 'venture.network.person', { id: asha.id }, phone);
  assert.deepEqual(view.person.name, 'Asha Rao');
  const line5 = 'LinkedIn connections, Connections.csv, line 5';
  const fromConnections = view.fields.filter(field => field.sourceId === `${a.import.id}:5`);
  assert.deepEqual(fromConnections.map(field => [field.field, field.value, field.source]), [
    ['Name', 'Asha Rao', line5],
    ['Email', 'asha@dewdrop.example', line5],
    ['LinkedIn', 'https://www.linkedin.com/in/asha-rao-dewdrop', line5],
    ['Role', 'Co-founder at Dewdrop Naturals', line5],
    ['LinkedIn connection', 'Connected on 02 Oct 2026', line5],
  ]);
  const messages = view.fields.find(field => field.field === 'LinkedIn messages')!;
  assert.deepEqual(messages, { field: 'LinkedIn messages', value: '2 messages (1 you sent, 1 you received), the last on 02 Oct 2026', source: 'LinkedIn messages, messages.csv, 2 rows', sourceId: m.import.id });
  assert.equal(view.merged, true, 'two files make this person');
  assert.deepEqual([view.card, view.drafts, view.web], [null, [], []]);
  // how and paths are 4D2's: the tie's receipt lines and the direct path (venture-network-paths.test.ts holds the rest).
  const tie = listRecords(env.store.read(), 'venture-tie').find(item => item.personId === asha.id)!;
  assert.ok(view.how.length > 0 && view.how.every(item => item.receiptId === tie.id));
  assert.deepEqual(view.paths.map(path => path.kind), ['direct']);
  assert.equal((await net<PersonView>(env, 'venture.network.person', { id: personNamed(env, 'Farhan Ali').id })).merged, false);
  await assert.rejects(net(env, 'venture.network.person', { id: 'person_nobody' }), code('INVALID_VENTURE_REQUEST'));
});

test('a person whose email is a client\'s is linked to that client', async () => {
  const env = await setup();
  const client = await ventureAction(env.deps, owner, 'prepare', 'seed.client', tx => tx.put<ClientRecord>({
    ...tx.base('venture-client'), name: 'Acme Foods', email: 'Priya@Acme.example', countryCode: 'IN', taxId: null, stateCode: '27', note: null,
  }));
  await imported(env, 'contacts-csv', 'contacts.csv', CONTACTS);
  assert.equal(personNamed(env, 'Priya Nair').clientId, client.id);
  assert.equal(personNamed(env, 'Asha Rao').clientId, null);
  assert.equal(listRecords(env.store.read(), 'venture-client').length, 1, 'no client is made');
});

const RAHUL_CARD = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Rahul Mehta', 'EMAIL:rahul@ubtan.example', 'URL:https://www.linkedin.com/in/rahulmehta', 'END:VCARD'].join('\n');

test('a hidden person stays hidden when an import merges them into another, and Undo puts both back as they were', async () => {
  const env = await setup();
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  await imported(env, 'contacts-csv', 'c.csv', 'Name,E-mail 1 - Value\nRahul M,rahul@ubtan.example\n');
  await net(env, 'venture.network.hide', { personId: personNamed(env, 'Rahul M').id, hidden: true });
  const link = await imported(env, 'vcard', 'l.vcf', RAHUL_CARD);
  const visible = await net<PeopleView>(env, 'venture.network.people', {});
  assert.deepEqual(visible.people.map(person => person.name), ['Asha Rao', 'Farhan Ali'], 'hidden = either was hidden');
  assert.equal(personNamed(env, 'Rahul Mehta').hidden, true);
  await net(env, 'venture.network.importUndo', { importId: link.import.id });
  assert.deepEqual([personNamed(env, 'Rahul Mehta').hidden, personNamed(env, 'Rahul M').hidden], [false, true]);
});

test('a merge carries the split history to the person kept, so people the owner split apart are never merged back', async () => {
  const env = await setup();
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  const b = await imported(env, 'contacts-csv', 'p.csv', 'Name,E-mail 1 - Value,Organization 1 - Name\nAsha Rao,asha.personal@mail.example,Dewdrop Naturals\n');
  const [first, second] = named(env, 'Asha Rao');
  await net(env, 'venture.network.merge', { a: first.id, b: second.id });
  const split = await net<PersonSplit>(env, 'venture.network.split', { personId: first.id, sourceIds: [`${b.import.id}:2`] });
  const moved = split.split.person.id;
  const farhan = personNamed(env, 'Farhan Ali');
  await net(env, 'venture.network.merge', { a: farhan.id, b: moved });
  const kept = people(env).find(person => person.id === farhan.id)!;
  assert.ok(kept.history.some(entry => entry.op === 'split' && entry.from[0] === first.id), 'the split from Asha moved with the merge');
  assert.ok(people(env).find(person => person.id === first.id)!.history.some(entry => entry.op === 'split' && entry.from[0] === farhan.id), 'Asha\'s side names the person kept');
  await imported(env, 'contacts-csv', 'both.csv', 'Name,E-mail 1 - Value,E-mail 2 - Value\nAsha Rao,asha@dewdrop.example,asha.personal@mail.example\n');
  assert.equal(people(env).length, 3, 'Asha and Farhan (who holds the split-off address) stay two people');
});

test('an owner merge keeps a person hidden when either was hidden', async () => {
  const env = await setup();
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  await imported(env, 'contacts-csv', 'p.csv', 'Name,E-mail 1 - Value,Organization 1 - Name\nAsha Rao,asha.personal@mail.example,Dewdrop Naturals\n');
  const [first, second] = named(env, 'Asha Rao');
  await net(env, 'venture.network.hide', { personId: second.id, hidden: true });
  const merged = await net<PersonView>(env, 'venture.network.merge', { a: first.id, b: second.id });
  assert.equal(merged.person.hidden, true);
});
