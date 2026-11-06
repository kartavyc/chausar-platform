// Package 4D1 (Ink v2 wave 4), DPDP: Forget really deletes. The person, their ties, evidence, pipeline cards, drafts,
// search mentions, inbound mail, leads, notifications, proposals, Undo copies and their name in other people's meeting
// titles all go; decisions keep the fact of the decision without them. Chausar keeps only a keyed one-way check of their
// handles (HMAC with the network key on the secret shelf, never in a record), so a later import leaves them out and says
// so, and an Undo never brings them back. A client with invoices keeps the records the law needs, and the reply says which.
import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  ClientRecord, DecisionRecord, EvidenceRecord, ForgottenRecord, InboundRecord, InvoiceRecord, LeadRecord, NetworkForgotten, NetworkImportRecord,
  NetworkImportResult, NetworkSearchRecord, NotificationRecord, OpportunityRecord, OutreachRecord, ProposalRecord, TieRecord,
} from '../runtime/venture/contracts.ts';
import { handleHash } from '../runtime/venture/network/text.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { code, owner, phone, setup, type Env } from './venture-views-env.ts';
import { CONNECTIONS, CONTACTS, emptyShelf, MESSAGES, net, people, personNamed } from './venture-network-env.ts';

type Imported = Extract<NetworkImportResult, { mode: 'import' }>;
const imported = (env: Env, kind: string, name: string, text: string) => net<Imported>(env, 'venture.network.import', { kind, name, text });
const stored = (env: Env) => JSON.stringify(env.store.read().conversations);
const forgotten = (env: Env): ForgottenRecord[] => listRecords(env.store.read(), 'venture-forgotten');
const RAHUL_CARD = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Rahul Mehta', 'EMAIL:rahul@ubtan.example', 'URL:https://www.linkedin.com/in/rahulmehta', 'END:VCARD'].join('\n');

/** Records other packages keep about people, each naming Asha one way or another, and some that must stay. */
async function seedAbout(env: Env, personId: string, otherId: string, email: string) {
  return ventureAction(env.deps, owner, 'admin', 'seed.network', tx => {
    tx.put({ ...tx.base('venture-tie'), personId, signals: [], scoreBp: 4000, band: 'know-well', computedAt: tx.now, digest: 'd' } as TieRecord);
    tx.put({ ...tx.base('venture-tie'), personId: otherId, signals: [], scoreBp: 100, band: 'cold', computedAt: tx.now, digest: 'd' } as TieRecord);
    tx.put({
      ...tx.base('venture-evidence'), subject: `person:${personId}`, field: 'tie.mail-both', value: '14', type: 'count', claimedType: 'count', strength: 'verified',
      scoreBp: 0, claim: 'fact', source: 'mail headers', by: 'engine', runId: null, toolCallId: null, flag: null, applied: true, appliedAt: tx.now,
    } as unknown as EvidenceRecord);
    const card = tx.put({
      ...tx.base('venture-opportunity'), personId, stage: 'asked', trigger: { kind: 'owner', ref: null, line: 'You added her' }, history: [], next: null, sequence: null,
      nudges: 0, leadId: null, clientId: null, linkedFrom: null, lostReason: null, askAgainFrom: null, basis: null,
    } as OpportunityRecord);
    const draft = tx.put({
      ...tx.base('venture-outreach'), opportunityId: card.id, invoiceId: null, personId, outreachKind: 'connection-note', channel: 'linkedin', to: null, subject: null,
      text: 'Hi, glad we met at the expo.', blurb: null, footer: null, sourceUrl: null, basis: null, lints: [], by: 'agent', callId: null, digest: 'd', sent: null, acceptedOn: null,
    } as OutreachRecord);
    tx.put({
      ...tx.base('venture-network-search'), text: 'founders in Pune', traits: [], candidates: 2, web: false, callIds: [],
      results: [{ personId, url: null, fitBp: 9000, checks: [] }, { personId: otherId, url: null, fitBp: 5000, checks: [] }], shown: [personId, otherId], saved: null,
    } as NetworkSearchRecord);
    const inbound = { messageId: '<m1@dewdrop.example>', to: ['owner@ledger.example'], date: tx.now, subject: 'Re: gift boxes', references: [], triage: 'talking', line: 'She wrote back.', processed: false, screen: null };
    tx.put({ ...tx.base('venture-inbound'), ...inbound, from: email, matched: null } as InboundRecord);
    tx.put({ ...tx.base('venture-inbound'), ...inbound, messageId: '<m2@other.example>', from: 'assistant@dewdrop-office.example', matched: { opportunityId: card.id, confidenceBp: 7000 } } as InboundRecord);
    tx.put({
      ...tx.base('venture-lead'), name: 'Asha', company: 'Dewdrop', email, emailDomain: 'dewdrop.example', sourceUrl: 'https://dewdrop.example/team',
      emailCheck: { status: 'unverified', at: null, line: 'Not checked yet.' }, status: 'new', drafts: [], sends: [], moves: [], addedBy: 'owner', addedAt: tx.now,
    } as LeadRecord);
    const note = { rowKind: 'followup', readAt: null, alertedAt: null, digestOn: null, expiresAt: null };
    tx.put({ ...tx.base('venture-notification'), ...note, subject: `followup:${card.id}:2026-10-20`, rowId: `followup:${card.id}`, title: 'Follow up due' } as unknown as NotificationRecord);
    tx.put({ ...tx.base('venture-notification'), ...note, subject: 'reply:x', rowId: 'reply:x', title: 'Asha Rao wrote back' } as unknown as NotificationRecord);
    tx.put({ ...tx.base('venture-notification'), ...note, subject: 'invoice:y', rowId: 'invoice:y', title: 'Invoice INV-0004 is due' } as unknown as NotificationRecord);
    tx.put({ ...tx.base('venture-decision'), subject: `followup:${card.id}`, action: 'sent', who: 'owner', ruleId: null, reason: 'Sent the nudge to Asha Rao on WhatsApp', rowId: `followup:${card.id}` } as DecisionRecord);
    const proposal = { source: 'chief', threadId: null, messageId: null, agent: null, spends: false, sends: true, status: 'drafted', digest: 'd', raisedAt: null, decidedAt: null, decidedBy: null, outcome: null };
    tx.put({ ...tx.base('venture-proposal'), ...proposal, proposalKind: 'outreach-draft', title: 'Draft a note', line: 'A connection note', input: { personId } } as ProposalRecord);
    tx.put({ ...tx.base('venture-proposal'), ...proposal, proposalKind: 'brief-agent', title: 'Ask Researcher about Asha Rao', line: 'A brief', input: { agent: 'researcher' } } as ProposalRecord);
    tx.put({ ...tx.base('venture-proposal'), ...proposal, proposalKind: 'quote', title: 'Quote for Acme', line: 'A quote', input: { clientId: 'client_z' } } as ProposalRecord);
    return { card, draft };
  });
}

test('venture.network.forget deletes the person and everything kept about them, in every kind of record, and keeps only a keyed check', async () => {
  const env = await setup();
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  await imported(env, 'contacts-csv', 'contacts.csv', CONTACTS);
  await imported(env, 'linkedin-messages', 'messages.csv', MESSAGES);
  await imported(env, 'calendar-ics', 'w.ics', ['BEGIN:VCALENDAR', 'X-WR-CALNAME:owner@ledger.example', 'BEGIN:VEVENT', 'DTSTART:20261002T093000Z', 'SUMMARY:Intro Asha Rao to Rahul',
    'ATTENDEE:mailto:asha@dewdrop.example', 'ATTENDEE:mailto:rahul@ubtan.example', 'ATTENDEE:mailto:owner@ledger.example', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART:20261005T093000Z', 'SUMMARY:Stall rent with Rahul', 'ATTENDEE:mailto:rahul@ubtan.example', 'ATTENDEE:mailto:owner@ledger.example', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
  const asha = personNamed(env, 'Asha Rao'), rahul = personNamed(env, 'Rahul Mehta');
  const seeded = await seedAbout(env, asha.id, rahul.id, 'asha@dewdrop.example');
  await assert.rejects(net(env, 'venture.network.forget', { id: asha.id }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(net(env, 'venture.network.forget', { id: 'person_nobody' }), code('INVALID_VENTURE_REQUEST'));

  const reply = await net<NetworkForgotten>(env, 'venture.network.forget', { id: asha.id });
  assert.match(reply.line, /^Chausar forgot Asha\./);
  assert.ok(reply.kept.some(line => /one-way check/.test(line)), 'the reply says what is kept, and why');
  assert.ok(reply.kept.some(line => /Backups/.test(line)), 'the reply is honest about backups made before');
  const state = env.store.read();
  assert.equal(people(env).some(person => person.id === asha.id), false);
  // Every import works out a tie for everyone (4D2): Asha's are gone, everyone else's stay.
  const tiesLeft = listRecords(state, 'venture-tie');
  assert.equal(tiesLeft.some(tie => tie.personId === asha.id), false);
  assert.ok(tiesLeft.some(tie => tie.personId === rahul.id));
  assert.equal(listRecords(state, 'venture-evidence').some(row => row.subject === `person:${asha.id}`), false, 'no evidence row about her');
  assert.ok(listRecords(state, 'venture-evidence').every(row => row.by === 'engine' && row.field.startsWith('tie.')), 'only the tie rows of the others');
  for (const kind of ['venture-opportunity', 'venture-outreach', 'venture-inbound', 'venture-lead'] as const) assert.equal(listRecords(state, kind).length, 0, kind);
  assert.deepEqual(listRecords(state, 'venture-notification').map(item => item.title), ['Invoice INV-0004 is due']);
  assert.deepEqual(listRecords(state, 'venture-proposal').map(item => item.title), ['Quote for Acme']);
  const [decision] = listRecords(state, 'venture-decision');
  assert.deepEqual([decision.action, decision.reason, decision.subject, decision.rowId], ['sent', 'Sent the nudge to someone you asked Chausar to forget on WhatsApp', 'followup:forgotten', 'followup:forgotten']);
  const [search] = listRecords(state, 'venture-network-search');
  assert.deepEqual([search.results.map(result => result.personId), search.shown], [[rahul.id], [rahul.id]]);
  const meeting = people(env).find(person => person.handles.emails.includes('rahul@ubtan.example'))!.facts.find(item => item.kind === 'meeting')!;
  const detail = meeting.detail as { titles: string[]; with?: string[] };
  assert.deepEqual([meeting.value, detail.titles, detail.with], ['Stall rent with Rahul', ['Stall rent with Rahul', 'Meeting'], undefined]);

  const all = stored(env);
  for (const trace of ['Asha', 'asha@dewdrop.example', 'asha-rao-dewdrop', '+919900122334', '99001', asha.id, seeded.card.id, seeded.draft.id]) assert.ok(!all.includes(trace), `${trace} is gone`);
  const [record] = forgotten(env);
  const key = env.deps.secrets.get('network:forget')!;
  assert.deepEqual(record.hashes, [
    { kind: 'email', hash: handleHash(key, 'email', 'asha@dewdrop.example') }, { kind: 'phone', hash: handleHash(key, 'phone', '+919900122334') },
    { kind: 'linkedin', hash: handleHash(key, 'linkedin', 'https://www.linkedin.com/in/asha-rao-dewdrop') },
  ]);
  assert.deepEqual([record.scheme, record.kept, record.by], ['hmac-sha256', [], 'owner']);
  assert.ok(!all.includes(key), 'the key is never in a record');
});

test('a later import leaves a forgotten person out, matched by email, phone or LinkedIn address, and says so', async () => {
  const env = await setup();
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  await imported(env, 'contacts-csv', 'contacts.csv', CONTACTS);
  await net(env, 'venture.network.forget', { id: personNamed(env, 'Asha Rao').id });
  const again = await imported(env, 'linkedin-connections', 'Connections (2).csv', CONNECTIONS + 'Neha,Shah,https://www.linkedin.com/in/neha-shah,,Shah Prints,Owner,10 Oct 2026\r\n');
  assert.match(again.line, /1 person you asked Chausar to forget was left out\./);
  assert.equal(listRecords(env.store.read(), 'venture-network-import').find(item => item.id === again.import.id)!.forgottenSkipped, 1);
  assert.equal(people(env).some(person => /asha/i.test(person.name)), false);
  const byPhone = await imported(env, 'vcard', 'phone.vcf', ['BEGIN:VCARD', 'VERSION:3.0', 'FN:A. Rao', 'TEL:099001 22334', 'END:VCARD'].join('\n'));
  assert.deepEqual([byPhone.import.people, byPhone.import.merged], [0, 0]);
  assert.match(byPhone.line, /1 person you asked Chausar to forget was left out\./);
  const check = await net<Extract<NetworkImportResult, { mode: 'check' }>>(env, 'venture.network.import',
    { kind: 'vcard', name: 'phone2.vcf', text: ['BEGIN:VCARD', 'VERSION:3.0', 'FN:A. Rao', 'URL:https://www.linkedin.com/in/Asha-Rao-Dewdrop', 'END:VCARD'].join('\n'), check: true });
  assert.deepEqual([check.kept, check.people], [0, 0]);
  assert.match(check.line, /1 person you asked Chausar to forget/);
});

test('the check is keyed with the network key on the secret shelf: another business\'s key gives other values, and no key means no check is kept', async () => {
  const env = await setup();
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  await net(env, 'venture.network.forget', { id: personNamed(env, 'Asha Rao').id });
  const other = await setup();
  await imported(other, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  await net(other, 'venture.network.forget', { id: personNamed(other, 'Asha Rao').id });
  assert.notDeepEqual(forgotten(other)[0].hashes, forgotten(env)[0].hashes, 'the same LinkedIn address checks differently in another business');
  assert.ok(!Object.hasOwn(forgotten(env)[0], 'salt'), 'no salt or key is stored');

  const keyless = await setup();
  await net(keyless, 'venture.network.import', { kind: 'linkedin-connections', name: 'Connections.csv', text: CONNECTIONS });
  await net(keyless, 'venture.network.forget', { id: personNamed(keyless, 'Farhan Ali').id });
  const deps = { ...keyless.deps, secrets: emptyShelf() };
  const reply = await net<NetworkForgotten>({ deps, keyless: true }, 'venture.network.forget', { id: personNamed(keyless, 'Asha Rao').id });
  assert.ok(reply.kept.some(line => /could not keep the check/.test(line)), reply.kept.join(' | '));
  assert.deepEqual(forgotten(keyless)[1].hashes, []);
  assert.equal(people(keyless).some(person => person.name === 'Asha Rao'), false, 'Forget still deletes');
  await assert.rejects(net({ deps, keyless: true }, 'venture.network.import', { kind: 'linkedin-connections', name: 'C2.csv', text: CONNECTIONS + 'Neha,Shah,https://www.linkedin.com/in/neha-shah,,,,\r\n' }),
    code('TIER_UNAVAILABLE'), 'with checks it cannot run (no key), nothing is imported');
});

test('a person who is a client with invoices: the client and invoice records stay, and the reply says so', async () => {
  const env = await setup();
  const client = await ventureAction(env.deps, owner, 'prepare', 'seed.client', tx => tx.put<ClientRecord>({
    ...tx.base('venture-client'), name: 'Acme Foods', email: 'priya@acme.example', countryCode: 'IN', taxId: null, stateCode: '27', note: null,
  }));
  const invoice = await ventureAction(env.deps, owner, 'prepare', 'seed.invoice', tx => tx.put({ ...tx.base('venture-invoice'), clientId: client.id, orderId: 'order_x', status: 'issued' } as unknown as InvoiceRecord));
  await imported(env, 'contacts-csv', 'contacts.csv', CONTACTS);
  const priya = personNamed(env, 'Priya Nair');
  assert.equal(priya.clientId, client.id);
  const reply = await net<NetworkForgotten>(env, 'venture.network.forget', { id: priya.id });
  assert.equal(reply.line, 'Priya is your client. Priya\'s invoices stay; everything else Chausar kept about Priya is gone.');
  assert.deepEqual(reply.kept.slice(0, 2), ['The client record, for the invoices', '1 invoice']);
  const state = env.store.read();
  assert.deepEqual(listRecords(state, 'venture-client').map(item => item.id), [client.id]);
  assert.deepEqual(listRecords(state, 'venture-invoice').map(item => item.id), [invoice.id]);
  assert.equal(people(env).some(person => person.id === priya.id), false);
  assert.deepEqual(forgotten(env)[0].kept, ['The client record, for the invoices', '1 invoice']);
});

test('forget clears a person kept inside an import\'s Undo copy, so undo never brings them back', async () => {
  const env = await setup();
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  await imported(env, 'contacts-csv', 'contacts.csv', 'Name,E-mail 1 - Value\nRahul M,rahul@ubtan.example\n');
  const linking = await imported(env, 'vcard', 'link.vcf', RAHUL_CARD);
  const record = (): NetworkImportRecord => listRecords(env.store.read(), 'venture-network-import').find(item => item.id === linking.import.id)!;
  assert.equal(record().absorbed?.length, 1, 'the import kept the person it merged, for undo');
  await net(env, 'venture.network.forget', { id: personNamed(env, 'Rahul Mehta').id });
  assert.deepEqual(record().absorbed, []);
  await net(env, 'venture.network.importUndo', { importId: linking.import.id });
  assert.equal(people(env).some(person => /rahul/i.test(person.name)), false, 'undo brings no forgotten person back');
  assert.ok(!stored(env).includes('rahul@ubtan.example'));
});

test('a person split off after a merge and then forgotten never comes back through Undo: copies that share a handle go too', async () => {
  const env = await setup();
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  const b = await imported(env, 'contacts-csv', 'c.csv', 'Name,E-mail 1 - Value\nRahul M,rahul@ubtan.example\n');
  const link = await imported(env, 'vcard', 'l.vcf', RAHUL_CARD);
  const rahul = personNamed(env, 'Rahul Mehta');
  const split = await net<{ split: { person: { id: string; name: string } } }>(env, 'venture.network.split', { personId: rahul.id, sourceIds: [b.import.id] });
  assert.equal(split.split.person.name, 'Rahul M');
  await assert.rejects(net(env, 'venture.network.forget', { id: split.split.person.id }), (error: any) => {
    assert.match(error.message, /^Rahul Mehta also has rahul@ubtan\.example\. Merge the two first, then forget them\./);
    return true;
  });
  await net(env, 'venture.network.merge', { a: rahul.id, b: split.split.person.id });
  await net(env, 'venture.network.forget', { id: rahul.id });
  assert.equal(people(env).some(person => person.name === 'Rahul M'), false);
  await net(env, 'venture.network.importUndo', { importId: link.import.id });
  assert.equal(people(env).some(person => person.name === 'Rahul M'), false, 'Undo brings no forgotten person back');
  assert.ok(!stored(env).includes('"Rahul M"') && !stored(env).includes('rahul@ubtan.example'));
});

const ics = (summary: string, day: string) => ['BEGIN:VCALENDAR', 'X-WR-CALNAME:owner@ledger.example', 'BEGIN:VEVENT', `DTSTART:${day}T093000Z`, `SUMMARY:${summary}`,
  'ATTENDEE;CN=Asha Rao:mailto:asha@dewdrop.example', 'ATTENDEE:mailto:rahul@ubtan.example', 'ATTENDEE:mailto:owner@ledger.example', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

test('forget scrubs another person\'s Undo copy too, so Undo cannot bring the forgotten person back inside someone else\'s facts', async () => {
  const env = await setup();
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  await imported(env, 'contacts-csv', 'c.csv', 'Name,E-mail 1 - Value\nRahul M,rahul@ubtan.example\n');
  await imported(env, 'calendar-ics', 'cal.ics', ics('Intro Asha Rao to Rahul', '20261002'));
  const link = await imported(env, 'vcard', 'l.vcf', RAHUL_CARD);
  const copy = () => listRecords(env.store.read(), 'venture-network-import').find(item => item.id === link.import.id)!.absorbed![0].person;
  assert.ok(copy().facts.some(item => item.kind === 'meeting'), 'Rahul M\'s copy holds the meeting with Asha');
  await net(env, 'venture.network.forget', { id: personNamed(env, 'Asha Rao').id });
  const meeting = copy().facts.find(item => item.kind === 'meeting')!;
  assert.deepEqual([meeting.value, (meeting.detail as { titles: string[] }).titles, (meeting.detail as { with?: string[] }).with], ['Meeting', ['Meeting'], undefined]);
  assert.ok(!stored(env).includes('asha@dewdrop.example') && !stored(env).includes('Asha'));
  await net(env, 'venture.network.importUndo', { importId: link.import.id });
  assert.ok(!stored(env).includes('asha@dewdrop.example') && !stored(env).includes('Asha'), 'nothing of her comes back with Rahul M');
});

test('a forgotten person stays out of later files: their address leaves others\' "with" lists and titles naming them read "Meeting", by a keyed check of their name words', async () => {
  const env = await setup();
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  const cal = await imported(env, 'calendar-ics', 'cal.ics', ics('Intro Asha Rao to Rahul', '20261002'));
  await net(env, 'venture.network.forget', { id: personNamed(env, 'Asha Rao').id });
  const [record] = forgotten(env);
  const key = env.deps.secrets.get('network:forget')!;
  assert.deepEqual(record.names, [handleHash(key, 'name', 'asha'), handleHash(key, 'name', 'rao')], 'keyed checks of the name words, never the words');
  await net(env, 'venture.network.importUndo', { importId: cal.import.id });
  const again = await imported(env, 'calendar-ics', 'cal.ics', ics('Intro Asha Rao to Rahul', '20261002'));
  assert.match(again.line, /1 person you asked Chausar to forget was left out/);
  await imported(env, 'calendar-ics', 'cal2.ics', ics('Gift boxes with Asha Rao', '20261012'));
  const rahul = people(env).find(person => person.handles.emails.includes('rahul@ubtan.example'))!;
  for (const item of rahul.facts.filter(fact => fact.kind === 'meeting')) {
    assert.deepEqual([item.value, (item.detail as { titles: string[] }).titles, (item.detail as { with?: string[] }).with], ['Meeting', ['Meeting'], undefined]);
  }
  assert.ok(!stored(env).includes('asha@dewdrop.example') && !stored(env).includes('Asha'));
});

test('forgetting a person who shares an address with someone else is refused, naming them, so the other keeps their own imports', async () => {
  const env = await setup();
  const a = await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  await imported(env, 'vcard', 'l.vcf', RAHUL_CARD);
  const split = await net<{ split: { person: { id: string } } }>(env, 'venture.network.split', { personId: personNamed(env, 'Rahul Mehta').id, sourceIds: [a.import.id] });
  const before = stored(env);
  await assert.rejects(net(env, 'venture.network.forget', { id: split.split.person.id }), (error: any) => {
    assert.equal(error.code, 'INVALID_VENTURE_REQUEST');
    assert.match(error.message, /Rahul Mehta also has https:\/\/www\.linkedin\.com\/in\/rahulmehta\. Merge the two first, then forget them\./);
    return true;
  });
  assert.equal(stored(env), before);
});

test('4J22a: forget erases a routine prompt and name that name the person, and switches the routine off', async () => {
  const { ERASED_NAMED } = await import('../runtime/venture/agents/notes.ts');
  const env = await setup();
  await imported(env, 'linkedin-connections', 'Connections.csv', CONNECTIONS);
  const asha = personNamed(env, 'Asha Rao');
  const routine = await ventureAction(env.deps, owner, 'admin', 'seed.routine', tx => tx.put({
    ...tx.base('venture-routine'), name: 'Ask about Asha Rao', agent: null, setBy: 'owner', on: true, removedAt: null,
    prompt: 'Tell me whether Asha Rao has replied to the proposal this week.', schedule: { kind: 'interval', everyMinutes: 60, from: tx.now },
  } as any));
  await net<NetworkForgotten>(env, 'venture.network.forget', { id: asha.id });
  const after = listRecords(env.store.read(), 'venture-routine').find(item => item.id === (routine as { id: string }).id)!;
  assert.equal(after.prompt, ERASED_NAMED);
  assert.equal(after.on, false);
  assert.doesNotMatch(after.name, /Asha/);
});
