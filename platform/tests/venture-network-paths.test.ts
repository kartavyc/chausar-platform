// Package 4D2 (Ink v2 wave 4): warm paths, honest about what Chausar can and cannot see. Up to three per person,
// strongest first: direct; through a connector whose second leg a fact backs (both in one small meeting, both on one
// mail's headers, or the owner's own word from venture.network.link), confirmed with that fact's line; through someone
// at the same company the owner knows at Know or better with no such fact, "possible path, not confirmed" (spec 8). The
// weaker leg ranks a path and an unknown leg ranks below every confirmed one; a company name alone never confirms
// anything. Forget takes a person out of every path, and a forgotten person never comes back as an intermediary.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { WarmPathView } from '../runtime/venture/contracts.ts';
import { bestPath, pathIndex, warmPaths } from '../runtime/venture/network/paths.ts';
import { foldCompany } from '../runtime/venture/network/text.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { code, owner, phone, setup, type Env } from './venture-views-env.ts';
import { connectionsCsv, net, people, personNamed } from './venture-network-env.ts';
import { bothWays, ics, imported, mailFile, OWNER, person, tieOf, toOct23, type Mail } from './venture-network-ties-env.ts';

const RAHUL = 'Rahul Mehta <rahul@ubtan.example>';
const KAVYA = 'Kavya Iyer <kavya@dewdrop.example>';
const VIKRAM = 'Vikram Rao <vikram@neem.example>';
const SAMEER = 'Sameer Kulkarni <sameer@neem.example>';

const CONNECTIONS = connectionsCsv([
  'Asha,Rao,https://www.linkedin.com/in/asha-rao,asha@dewdrop.example,Dewdrop Naturals,Co-founder,02 Oct 2026',
  'Rahul,Mehta,https://www.linkedin.com/in/rahulmehta,rahul@ubtan.example,Ubtan Lab,Head of Growth,15 Mar 2024',
  'Meera,Das,https://www.linkedin.com/in/meera-das,meera@dewdrop.example,Dewdrop Naturals,Designer,10 Jan 2025',
  'Farhan,Ali,https://www.linkedin.com/in/farhan-ali,farhan@alispices.example,Ali Spices,Owner,20 Oct 2026',
]);
const CONTACTS = 'Name,E-mail 1 - Value,Organization 1 - Name,Organization 1 - Title\nKavya Iyer,kavya@dewdrop.example,Dewdrop Naturals,Designer\n';
/** Rahul: both ways June to October (Know well). Kavya: both ways August to October (Know, with her saved contact). */
const MAIL: Mail[] = [
  ...bothWays(RAHUL, ['2026-06', '2026-07', '2026-08', '2026-09']), { day: '2026-10-18', from: OWNER, to: [RAHUL] }, { day: '2026-10-20', from: RAHUL, to: [OWNER] },
  ...bothWays(KAVYA, ['2026-08', '2026-09']), { day: '2026-10-18', from: OWNER, to: [KAVYA] }, { day: '2026-10-20', from: KAVYA, to: [OWNER] },
];
/** Asha and Rahul in one small meeting with the owner. */
const MEETING = ics([{ day: '2026-10-12', title: 'Gift box samples', people: ['asha@dewdrop.example', 'rahul@ubtan.example'] }]);

/** The owner's network on 23 Oct 2026: Asha the target, Rahul who met her, Kavya and Meera at her company, Farhan. */
async function network(env: Env) {
  toOct23(env);
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  await imported(env, 'contacts-csv', 'contacts.csv', CONTACTS);
  await imported(env, 'mail-headers', 'takeout.mbox', mailFile(MAIL));
  await imported(env, 'calendar-ics', 'work.ics', MEETING);
  const id = (name: string) => personNamed(env, name).id;
  return { asha: id('Asha Rao'), rahul: id('Rahul Mehta'), kavya: id('Kavya Iyer'), meera: id('Meera Das'), farhan: id('Farhan Ali') };
}

const shape = (paths: WarmPathView[]) => paths.map(path => [path.kind, path.via?.name ?? null, path.confirmed, path.strength]);

test('direct, a connector a meeting confirms, and a colleague no fact backs: strongest first, the unknown leg last and dashed in words', async () => {
  const env = await setup();
  const ids = await network(env);
  assert.deepEqual([ids.asha, ids.rahul, ids.kavya, ids.meera].map(id => tieOf(env, id).band), ['met-once', 'know-well', 'know', 'cold']);
  const view = await person(env, ids.asha, phone);
  assert.deepEqual(shape(view.paths), [
    ['connector', 'Rahul Mehta', true, 'met-once'],
    ['direct', null, true, 'met-once'],
    ['same-company', 'Kavya Iyer', false, 'cold'],
  ]);
  assert.deepEqual(view.paths.map(path => path.line), [
    'Through Rahul Mehta: you know Rahul well, and Rahul and Asha were in a small meeting together (Calendar, work.ics).',
    'You have met Asha.',
    'Possible path, not confirmed: Kavya Iyer also works at Dewdrop Naturals, and you know Kavya. Chausar sees nothing that shows Kavya knows Asha.',
  ]);
  assert.deepEqual(view.paths[0].via, { id: ids.rahul, name: 'Rahul Mehta' });
  assert.ok(!view.paths.some(path => path.via?.id === ids.meera), 'a colleague the owner barely knows is no path at all');
  assert.equal(bestPath(pathIndex(env.store.read(), env.venture.id), ids.asha)?.via?.id, ids.rahul);
});

test('how you know them: the receipt lines of the tie, each opening the tie receipt', async () => {
  const env = await setup();
  const ids = await network(env);
  const view = await person(env, ids.rahul);
  const tie = tieOf(env, ids.rahul);
  assert.deepEqual(view.how.map(item => item.receiptId), tie.signals.map(() => tie.id));
  assert.deepEqual(view.how.map(item => item.line).slice(0, 2), [
    'Mail both ways in 5 months, the last on 20 Oct 2026 (Mail headers, takeout.mbox)',
    '1 small meeting, the last on 12 Oct 2026 (Calendar, work.ics)',
  ]);
  assert.equal(view.person.band, 'know-well');
  assert.equal(view.person.dots, 4);
});

test('one mail\'s headers and the owner\'s own word confirm a second leg; the weaker leg ranks; a direct cold tie ranks last', async () => {
  const env = await setup();
  toOct23(env);
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  // A mail the owner sent to both says nothing about whether they know each other.
  await imported(env, 'mail-headers', 'sent.mbox', mailFile([
    { day: '2026-09-10', from: OWNER, to: [VIKRAM] }, { day: '2026-09-12', from: VIKRAM, to: [OWNER] }, { day: '2026-10-05', from: OWNER, to: [VIKRAM, SAMEER] },
  ]));
  const sameer = personNamed(env, 'Sameer Kulkarni').id, vikram = personNamed(env, 'Vikram Rao').id, farhan = personNamed(env, 'Farhan Ali').id;
  assert.ok(!(await person(env, sameer)).paths.some(path => path.via?.id === vikram), 'the owner writing to both confirms nothing');
  // A mail Vikram wrote with Sameer on it does.
  await imported(env, 'mail-headers', 'team.mbox', mailFile([{ day: '2026-10-14', from: VIKRAM, to: [OWNER], cc: [SAMEER] }]));
  await net(env, 'venture.network.know', { personId: farhan, how: 'met' });
  await assert.rejects(net(env, 'venture.network.link', { a: farhan, b: sameer, note: 'They studied together' }, phone), code('APP_APPROVAL_REQUIRED'));
  const linked = await net<{ line: string }>(env, 'venture.network.link', { a: farhan, b: sameer, note: 'They studied together' });
  assert.equal(linked.line, 'Saved: you said Farhan Ali and Sameer Kulkarni know each other. A path through either of them to the other now counts as confirmed, on your word.');
  const view = await person(env, sameer);
  assert.deepEqual(shape(view.paths), [
    ['connector', 'Farhan Ali', true, 'met-once'],
    ['connector', 'Vikram Rao', true, 'met-once'],
    ['direct', null, true, 'cold'],
  ]);
  assert.deepEqual(view.paths.map(path => path.line), [
    'Through Farhan Ali: you have met Farhan, and you said Farhan knows Sameer: They studied together.',
    'Through Vikram Rao: you have met Vikram, and Vikram and Sameer were on a mail one of them wrote (Mail headers, team.mbox).',
    'Sameer is in your network, but Chausar sees little between you.',
  ]);
  // The link goes both ways: Sameer is a confirmed path to Farhan too, when the owner knows Sameer well enough.
  const farhanPaths = warmPaths(pathIndex(env.store.read(), env.venture.id), farhan);
  assert.ok(!farhanPaths.some(path => path.via?.id === sameer), 'Sameer is cold to the owner, so no path runs through him');
  assert.ok(!view.paths.some(path => path.via?.id === vikram && !path.confirmed));
});

test('at most three paths: a fourth, unconfirmed, is left out', async () => {
  const env = await setup();
  const ids = await network(env);
  await net(env, 'venture.network.know', { personId: ids.farhan, how: 'met' });
  await net(env, 'venture.network.link', { a: ids.asha, b: ids.farhan, note: 'Farhan sells at her market' });
  const view = await person(env, ids.asha);
  assert.equal(view.paths.length, 3);
  assert.deepEqual(shape(view.paths), [
    ['connector', 'Rahul Mehta', true, 'met-once'],
    ['connector', 'Farhan Ali', true, 'met-once'],
    ['direct', null, true, 'met-once'],
  ]);
  assert.ok(!view.paths.some(path => !path.confirmed), 'every confirmed path ranks above an unconfirmed one');
});

test('venture.network.link: two different people of this business, a note on one line; the newest note replaces the last; both keep it in their history', async () => {
  const env = await setup();
  const ids = await network(env);
  await assert.rejects(net(env, 'venture.network.link', { a: ids.asha, b: ids.asha, note: 'x' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(net(env, 'venture.network.link', { a: ids.asha, b: ids.rahul }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(net(env, 'venture.network.link', { a: ids.asha, b: ids.rahul, note: '' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(net(env, 'venture.network.link', { a: ids.asha, b: 'person_nobody', note: 'x' }), code('INVALID_VENTURE_REQUEST'));
  await net(env, 'venture.network.link', { a: ids.asha, b: ids.kavya, note: 'Same studio' });
  await net(env, 'venture.network.link', { a: ids.kavya, b: ids.asha, note: 'They share the studio on Fridays' });
  for (const [id, other] of [[ids.asha, ids.kavya], [ids.kavya, ids.asha]]) {
    const stored = people(env).find(item => item.id === id)!;
    const links = stored.facts.filter(fact => fact.kind === 'link');
    assert.equal(links.length, 1);
    assert.deepEqual([links[0].source, (links[0].detail as { personId: string; note: string }).note], [{ connector: 'owner', importId: null, row: null }, 'They share the studio on Fridays']);
    assert.equal((links[0].detail as { personId: string }).personId, other);
    assert.deepEqual(stored.history.filter(entry => entry.op === 'link').map(entry => entry.from), [[other], [other]]);
  }
  const view = await person(env, ids.asha);
  const kavya = view.paths.find(path => path.via?.id === ids.kavya)!;
  assert.deepEqual([kavya.kind, kavya.confirmed, kavya.strength], ['same-company', true, 'know']);
  assert.equal(kavya.line, 'Through Kavya Iyer, also at Dewdrop Naturals: you know Kavya, and you said Kavya knows Asha: They share the studio on Fridays.');
  assert.ok(view.fields.some(field => field.field === 'Knows' && field.value === 'Kavya Iyer, you said: They share the studio on Fridays' && field.source === 'You, in Chausar'));
});

test('a hidden person is never offered as a connector', async () => {
  const env = await setup();
  const ids = await network(env);
  await net(env, 'venture.network.hide', { personId: ids.rahul, hidden: true });
  const view = await person(env, ids.asha);
  assert.ok(!view.paths.some(path => path.via?.id === ids.rahul));
});

test('Forget takes a person out of every path, link and note, and a forgotten person never comes back as an intermediary', async () => {
  const env = await setup();
  const ids = await network(env);
  await net(env, 'venture.network.know', { personId: ids.asha, how: 'met', note: 'Met through Rahul Mehta at the expo' });
  await net(env, 'venture.network.know', { personId: ids.farhan, how: 'met' });
  await net(env, 'venture.network.link', { a: ids.farhan, b: ids.asha, note: 'Farhan sells at her market' });
  await net(env, 'venture.network.link', { a: ids.rahul, b: ids.kavya, note: 'Rahul hired Kavya once' });
  assert.ok((await person(env, ids.asha)).paths.some(path => path.via?.id === ids.rahul));

  await net(env, 'venture.network.forget', { id: ids.rahul });
  const asha = await person(env, ids.asha);
  assert.ok(!asha.paths.some(path => path.via?.id === ids.rahul));
  assert.doesNotMatch(JSON.stringify(asha), /Rahul/);
  const kavya = people(env).find(item => item.id === ids.kavya)!;
  assert.equal(kavya.facts.filter(fact => fact.kind === 'link').length, 0, 'the link to Rahul went with him');
  assert.ok(!kavya.history.some(entry => entry.op === 'link'), 'and so did its history entry');
  const note = people(env).find(item => item.id === ids.asha)!.facts.find(fact => fact.kind === 'you-said')!;
  assert.deepEqual([note.value, (note.detail as { note: string }).note], ['You have met them. Met through someone you asked Chausar to forget at the expo', 'Met through someone you asked Chausar to forget at the expo']);

  // A newer calendar with Rahul and Asha in another meeting: Rahul is left out, and no path runs through him.
  const again = await imported(env, 'calendar-ics', 'work-2.ics', ics([{ day: '2026-10-21', title: 'Second samples', people: ['asha@dewdrop.example', 'rahul@ubtan.example'] }]));
  assert.match(again.line, /1 person you asked Chausar to forget was left out/);
  assert.equal(people(env).some(item => item.handles.emails.includes('rahul@ubtan.example')), false);
  assert.ok(!(await person(env, ids.asha)).paths.some(path => /Rahul/.test(path.line)));

  await net(env, 'venture.network.forget', { id: ids.farhan });
  const after = people(env).find(item => item.id === ids.asha)!;
  assert.equal(after.facts.filter(fact => fact.kind === 'link').length, 0);
  assert.ok(!after.history.some(entry => entry.from.includes(ids.farhan)));
  const stored = JSON.stringify(env.store.read().conversations);
  for (const gone of ['Farhan sells at her market', 'Rahul hired Kavya once', ids.farhan, ids.rahul]) assert.ok(!stored.includes(gone), `${gone} is stored nowhere`);
  assert.equal(listRecords(env.store.read(), 'venture-tie').some(tie => tie.personId === ids.farhan || tie.personId === ids.rahul), false);
});

test('the owner\'s word about someone later merged away follows the merge, and goes back with them when the merge is undone', async () => {
  const env = await setup();
  const ids = await network(env);
  await net(env, 'venture.network.know', { personId: ids.farhan, how: 'met' });
  // A second Farhan from a phone file, linked to Asha, then merged into the first by a file that has both addresses.
  await imported(env, 'vcard', 'phone.vcf', ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Farhan A', 'EMAIL:farhan.home@mail.example', 'END:VCARD'].join('\n'));
  const second = personNamed(env, 'Farhan A').id;
  await net(env, 'venture.network.link', { a: second, b: ids.asha, note: 'Neighbours' });
  const joining = await imported(env, 'contacts-csv', 'both.csv', 'Name,E-mail 1 - Value\nFarhan Ali,farhan@alispices.example ::: farhan.home@mail.example\n');
  assert.equal(people(env).some(item => item.id === second), false, 'merged into the first Farhan');
  const through = (await person(env, ids.asha)).paths.find(path => path.via?.id === ids.farhan);
  assert.deepEqual([through?.kind, through?.confirmed], ['connector', true]);
  assert.match(through!.line, /you said Farhan knows Asha: Neighbours\.$/);

  await net(env, 'venture.network.importUndo', { importId: joining.import.id });
  const paths = (await person(env, ids.asha)).paths;
  assert.ok(!paths.some(path => path.via?.id === ids.farhan), 'the first Farhan never had the owner\'s word about Asha');
  const back = paths.find(path => path.via?.id === second);
  assert.deepEqual([back?.confirmed, back?.via?.name], [true, 'Farhan A']);
});

test('a company name alone never confirms a path, and a colleague the owner knows below Know is no path at all', async () => {
  const env = await setup();
  toOct23(env);
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  await imported(env, 'contacts-csv', 'contacts.csv', CONTACTS);
  await imported(env, 'mail-headers', 'takeout.mbox', mailFile(MAIL));
  const asha = personNamed(env, 'Asha Rao').id;
  const view = await person(env, asha);
  assert.deepEqual(shape(view.paths), [['direct', null, true, 'cold'], ['same-company', 'Kavya Iyer', false, 'cold']]);
  assert.equal(view.paths[0].line, 'Asha is in your network, but Chausar sees little between you.');
  assert.match(view.paths[1].line, /^Possible path, not confirmed: /);
  assert.ok(!JSON.stringify(view.paths).includes('owner@ledger.example'), 'the owner is never a connector');
  // The same person on two lists of one company is still one candidate, never two paths.
  assert.equal(new Set(view.paths.map(path => path.via?.id ?? 'direct')).size, view.paths.length);
});

test('link, merge, merge, forget: the owner\'s word follows the whole chain of merges, and Forget takes it out with every name the chain had', async () => {
  const env = await setup();
  const ids = await network(env);
  await net(env, 'venture.network.know', { personId: ids.farhan, how: 'met' });
  await imported(env, 'vcard', 'phone.vcf', ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Farhan A', 'EMAIL:farhan.home@mail.example', 'END:VCARD'].join('\n'));
  await imported(env, 'vcard', 'old-phone.vcf', ['BEGIN:VCARD', 'VERSION:3.0', 'FN:F Ali', 'EMAIL:f.ali@mail.example', 'END:VCARD'].join('\n'));
  const farhanA = personNamed(env, 'Farhan A').id, fAli = personNamed(env, 'F Ali').id;
  await net(env, 'venture.network.link', { a: ids.asha, b: farhanA, note: 'Farhan A sells at her market' });
  await net(env, 'venture.network.know', { personId: ids.asha, how: 'met', note: 'Met through Farhan A. at the expo' });
  await net(env, 'venture.network.merge', { a: fAli, b: farhanA });
  await net(env, 'venture.network.merge', { a: ids.farhan, b: fAli });
  const kept = people(env).find(item => item.id === ids.farhan)!;
  assert.deepEqual(kept.history.filter(entry => entry.op === 'merge').map(entry => entry.from[0]).sort(), [fAli, farhanA].sort(), 'the first merge travels with the second');
  const through = (await person(env, ids.asha)).paths.find(path => path.via?.id === ids.farhan);
  assert.deepEqual([through?.confirmed, through?.kind], [true, 'connector'], 'the word given about Farhan A reaches the person he became part of');

  await net(env, 'venture.network.forget', { id: ids.farhan });
  const asha = people(env).find(item => item.id === ids.asha)!;
  assert.equal(asha.facts.filter(fact => fact.kind === 'link').length, 0);
  assert.ok(!asha.history.some(entry => entry.op === 'link'));
  const note = asha.facts.find(fact => fact.kind === 'you-said')!;
  assert.equal((note.detail as { note: string }).note, 'Met through someone you asked Chausar to forget at the expo', 'the short initial goes with the name');
  const stored = JSON.stringify(env.store.read().conversations);
  for (const gone of ['Farhan A', 'F Ali', 'Farhan', farhanA, fAli, ids.farhan, 'sells at her market']) assert.ok(!stored.includes(gone), `${gone} is stored nowhere`);
});

test('Forget drops a link that no longer leads to anyone, even one whose merge left no trail', async () => {
  const env = await setup();
  const ids = await network(env);
  await ventureAction(env.deps, owner, 'admin', 'seed.dangling', tx => {
    const asha = tx.find('venture-person', ids.asha)!;
    tx.replace({ ...asha, facts: [...asha.facts, { id: 'owner.x', kind: 'link', value: 'Someone, you said: an old word', date: '2026-10-01', detail: { personId: 'person_gone', note: 'an old word' }, source: { connector: 'owner', importId: null, row: null } }] });
  });
  await net(env, 'venture.network.forget', { id: ids.meera });
  assert.equal(people(env).find(item => item.id === ids.asha)!.facts.some(fact => fact.kind === 'link'), false);
});

test('generic employers are no company: two self-employed people are never colleagues, and never "Same person?" by that alone', async () => {
  for (const generic of ['Self-employed', 'Self Employed', 'Freelance', 'Freelancer', 'Student', 'Unemployed', 'Retired', 'Homemaker', 'Independent', 'N/A', 'None']) {
    assert.equal(foldCompany(generic), '', generic);
  }
  assert.equal(foldCompany('Dewdrop Naturals Pvt Ltd'), 'dewdrop naturals');
  const env = await setup();
  toOct23(env);
  await imported(env, 'linkedin-connections', 'Connections.csv', connectionsCsv([
    'Asha,Rao,https://www.linkedin.com/in/asha-rao,asha@self.example,Self-employed,Designer,02 Oct 2026',
    'Kavya,Iyer,https://www.linkedin.com/in/kavya-iyer,kavya@dewdrop.example,Self Employed,Designer,02 Oct 2026',
  ]));
  await imported(env, 'mail-headers', 'k.mbox', mailFile(bothWays(KAVYA, ['2026-07', '2026-08', '2026-09', '2026-10'])));
  assert.equal(tieOf(env, personNamed(env, 'Kavya Iyer').id).band, 'know');
  const view = await person(env, personNamed(env, 'Asha Rao').id);
  assert.ok(!view.paths.some(path => path.kind === 'same-company'));
});
