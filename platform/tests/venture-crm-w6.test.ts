// Wave 6 package 6G3 (D44): CRM upgrades. Every client, company and person field remembers who changed it and when,
// beside the record (a client kept before wave 6 is never rewritten); pipelines as lists, each with its own stages; a
// Company record with two-way links; and each client's timeline (what the owner logged, the sends and replies on the
// client's pipeline cards, and invoices). Forget of a person erases the history and timeline kept about them.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BlueprintRecord, ClientRecord, DeliveryRunRecord, InvoiceRecord, OpportunityRecord, OrderRecord } from '../runtime/venture/contracts.ts';
import type { ClientCrmView, CompanyRow, CompanyView, CrmListRow, CrmListView } from '../runtime/venture/crm/crm-data.ts';
import { addClient, listClients } from '../runtime/venture/money/clients.ts';
import { evidenceApply, recordEvidence } from '../runtime/venture/evidence/ledger.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { code, owner, phone, setup, type Env } from './venture-views-env.ts';
import { CONTACTS, net, personNamed } from './venture-network-env.ts';

const client = (env: Env, name: string, email?: string) => addClient(env.deps, owner, { name, ...(email ? { email } : {}) });
const view = (env: Env, clientId: string) => net<ClientCrmView>(env, 'venture.crm.client', { clientId });

test('a client edit is one change row with who and when; the record keeps its shape and old clients only read as added', async () => {
  const env = await setup();
  const old = await client(env, 'Cafe Aroma Demo', 'hello@aroma.example');
  const before = listRecords(env.store.read(), 'venture-client').find(item => item.id === old.id)!;
  const fresh = await view(env, old.id);
  assert.deepEqual(fresh.history.map(row => row.line), ['Added to Clients'], 'a client with no rows reads as added, nothing rewritten');
  assert.equal(fresh.company, null);
  assert.deepEqual(fresh.timeline, []);

  await assert.rejects(net(env, 'venture.crm.client.edit', { clientId: old.id, field: 'email', value: 'team@aroma.example' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(net(env, 'venture.crm.client.edit', { clientId: old.id, field: 'taxId', value: 'x' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(net(env, 'venture.crm.client.edit', { clientId: old.id, field: 'email', value: 'not an email' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(net(env, 'venture.crm.client.edit', { clientId: 'client_nobody', field: 'note', value: 'Hi' }), code('CLIENT_NOT_FOUND'));
  await assert.rejects(net(env, 'venture.crm.client.edit', { clientId: old.id, field: 'email', value: 'hello@aroma.example' }), code('INVALID_VENTURE_REQUEST'));

  env.advance(60_000);
  const edited = await net<ClientCrmView>(env, 'venture.crm.client.edit', { clientId: old.id, field: 'email', value: 'team@aroma.example' });
  const row = edited.history[0];
  assert.deepEqual([row.field, row.label, row.who, row.line, row.before, row.after, row.at], ['email', 'Email', 'You', 'You changed Email', 'hello@aroma.example', 'team@aroma.example', env.now()]);
  const after = listRecords(env.store.read(), 'venture-client').find(item => item.id === old.id)!;
  assert.equal(after.email, 'team@aroma.example');
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), 'the client record gains no history fields');
  assert.equal(after.id, before.id);
  const evidence = listRecords(env.store.read(), 'venture-evidence').filter(item => item.subject === `client:${old.id}` && item.field === 'email' && item.applied);
  assert.deepEqual(evidence.map(item => [item.value, item.type]), [['team@aroma.example', 'owner-entered']], 'the edit is owner-entered evidence too');

  const noted = await net<ClientCrmView>(env, 'venture.crm.client.edit', { clientId: old.id, field: 'note', value: 'Prefers calls after 4 pm.' });
  assert.deepEqual(noted.history.map(item => item.line), ['You set Note', 'You changed Email', 'Added to Clients']);
});

test('a value applied from the evidence ledger is a change row too: the owner applying a suggestion an agent made', async () => {
  const env = await setup();
  const one = await client(env, 'Dewdrop Naturals');
  const suggestion = await ventureAction(env.deps, owner, 'prepare', 'seed.evidence', tx => recordEvidence(tx, { subject: `client:${one.id}`, field: 'note', value: 'Wants invoices monthly.', type: 'model-inferred', by: 'agent' }));
  assert.equal(suggestion.applied, false, 'a weak suggestion waits');
  assert.deepEqual((await view(env, one.id)).history.map(row => row.line), ['Added to Clients']);
  await evidenceApply(env.deps, owner, { id: suggestion.id });
  const rows = (await view(env, one.id)).history;
  assert.deepEqual([rows[0].line, rows[0].who, rows[0].before, rows[0].after], ['You set Note', 'You', null, 'Wants invoices monthly.']);
});

test('a company links clients and people both ways, and every company field and link is in its history', async () => {
  const env = await setup();
  const aroma = await client(env, 'Cafe Aroma Demo');
  await net(env, 'venture.network.import', { kind: 'contacts-csv', name: 'contacts.csv', text: CONTACTS });
  const asha = personNamed(env, 'Asha Rao');
  await assert.rejects(net(env, 'venture.crm.company.save', { name: 'Aroma Group' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(net(env, 'venture.crm.company.save', { domain: 'aroma.example' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(net(env, 'venture.crm.company.save', { name: 'Aroma Group', domain: 'not a site' }), code('INVALID_VENTURE_REQUEST'));
  const made = await net<CompanyView>(env, 'venture.crm.company.save', { name: 'Aroma Group', domain: 'https://www.Aroma.example/about' });
  assert.deepEqual([made.company.name, made.company.domain, made.company.clients, made.company.people], ['Aroma Group', 'aroma.example', 0, 0]);
  await assert.rejects(net(env, 'venture.crm.company.save', { name: 'aroma  GROUP' }), code('INVALID_VENTURE_REQUEST'), 'a company is named once');

  const linked = await net<ClientCrmView>(env, 'venture.crm.link', { companyId: made.company.id, member: `client:${aroma.id}` });
  assert.deepEqual(linked.company, { id: made.company.id, name: 'Aroma Group' });
  assert.deepEqual([linked.history[0].line, linked.history[0].after], ['You set Company', 'Aroma Group']);
  await net(env, 'venture.crm.link', { companyId: made.company.id, member: `person:${asha.id}` });
  const both = await net<CompanyView>(env, 'venture.crm.company', { companyId: made.company.id });
  assert.deepEqual(both.clients, [{ id: aroma.id, name: 'Cafe Aroma Demo' }]);
  assert.deepEqual(both.people, [{ id: asha.id, name: 'Asha Rao' }]);
  assert.deepEqual(both.history.map(row => [row.line, row.after]), [['You added a member', 'Asha Rao'], ['You added a member', 'Cafe Aroma Demo'], ['Added to Companies', null]]);

  const renamed = await net<CompanyView>(env, 'venture.crm.company.save', { companyId: made.company.id, name: 'Aroma Cafes', note: 'Three outlets in Pune.' });
  assert.deepEqual(renamed.history.slice(0, 2).map(row => [row.line, row.before, row.after]).sort(), [['You changed Name', 'Aroma Group', 'Aroma Cafes'], ['You set Note', null, 'Three outlets in Pune.']]);
  assert.deepEqual((await view(env, aroma.id)).history[0].after, 'Aroma Cafes', 'a reference is named at read time');

  const rows = await net<CompanyRow[]>(env, 'venture.crm.companies', {});
  assert.deepEqual(rows.map(row => [row.name, row.clients, row.people]), [['Aroma Cafes', 1, 1]]);
  const out = await net<ClientCrmView>(env, 'venture.crm.link', { companyId: null, member: `client:${aroma.id}` });
  assert.equal(out.company, null);
  assert.deepEqual([out.history[0].line, out.history[0].before], ['You cleared Company', 'Aroma Cafes']);
  await assert.rejects(net(env, 'venture.crm.link', { companyId: 'company_nobody', member: `client:${aroma.id}` }), code('COMPANY_NOT_FOUND'));
  await assert.rejects(net(env, 'venture.crm.link', { companyId: made.company.id, member: 'client:client_nobody' }), code('CLIENT_NOT_FOUND'));
});

test('the timeline holds what the owner logged, the sends and replies on the client\'s cards, and issued invoices, newest first', async () => {
  const env = await setup();
  const aroma = await client(env, 'Cafe Aroma Demo');
  const other = await client(env, 'Someone Else');
  await assert.rejects(net(env, 'venture.crm.log', { clientId: aroma.id, kind: 'call', on: '2026-10-14', text: 'Talked about the menu.' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(net(env, 'venture.crm.log', { clientId: aroma.id, kind: 'fax', on: '2026-10-14', text: 'x y' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(net(env, 'venture.crm.log', { clientId: aroma.id, kind: 'call', on: '2026-12-01', text: 'Later call.' }), code('INVALID_VENTURE_REQUEST'), 'never a day after today');
  await net(env, 'venture.crm.log', { clientId: aroma.id, kind: 'call', on: '2026-10-12', text: 'Talked about the menu.' });
  await net(env, 'venture.crm.log', { clientId: aroma.id, kind: 'whatsapp', on: '2026-10-14', text: 'Sent the price list on WhatsApp.' });
  await net(env, 'venture.crm.log', { clientId: other.id, kind: 'note', on: '2026-10-14', text: 'Not about Aroma.' });
  await ventureAction(env.deps, owner, 'admin', 'seed.timeline', tx => {
    tx.put({
      ...tx.base('venture-opportunity'), personId: 'person_x', stage: 'won', trigger: { kind: 'owner', ref: null, line: 'You added them' }, history: [], next: null, sequence: null,
      nudges: 0, leadId: null, clientId: aroma.id, linkedFrom: null, lostReason: null, askAgainFrom: null, basis: null,
      touches: [
        { what: 'sent', on: '2026-10-10', at: '2026-10-10T05:00:00.000Z', kind: 'first', channel: 'phone', ref: 'draft_1', by: 'owner' },
        { what: 'reply', on: '2026-10-11', at: '2026-10-11T05:00:00.000Z', kind: null, channel: null, ref: 'inbound_1', by: 'mail' },
      ],
    } as OpportunityRecord);
    const invoice = { orderId: 'order_x', clientId: aroma.id, currency: 'INR', dueDate: null, dueInDays: 7, lines: [], subtotalMinor: '0', discountMinor: '0', taxMinor: '0', totalMinor: '0' } as unknown as InvoiceRecord;
    tx.put({ ...tx.base('venture-invoice'), ...invoice, number: 'INV-0001', issueDate: '2026-10-13', status: 'paid' } as InvoiceRecord);
    tx.put({ ...tx.base('venture-invoice'), ...invoice, number: null, issueDate: null, status: 'draft' } as InvoiceRecord);
  });
  const timeline = (await view(env, aroma.id)).timeline;
  assert.deepEqual(timeline.map(entry => [entry.kind, entry.on, entry.line, entry.text]), [
    ['whatsapp', '2026-10-14', 'You logged a WhatsApp message', 'Sent the price list on WhatsApp.'],
    ['invoice', '2026-10-13', 'Invoice INV-0001 paid', null],
    ['call', '2026-10-12', 'You logged a call', 'Talked about the menu.'],
    ['reply', '2026-10-11', 'They replied', null],
    ['sent', '2026-10-10', 'You called', null],
  ]);
});

test('pipelines as lists: each list has its own stages, and every move is a change row on the member', async () => {
  const env = await setup();
  const aroma = await client(env, 'Cafe Aroma Demo');
  await assert.rejects(net(env, 'venture.crm.list.save', { name: 'Workshops', stages: ['Only one'] }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(net(env, 'venture.crm.list.save', { name: 'Workshops', stages: ['Asked', 'asked '] }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(net(env, 'venture.crm.list.save', { name: 'Workshops', stages: ['Asked', 'Booked'] }, phone), code('APP_APPROVAL_REQUIRED'));
  const made = await net<CrmListView>(env, 'venture.crm.list.save', { name: 'Workshops', stages: ['To ask', 'Asked', 'Booked'] });
  assert.deepEqual([made.list.name, made.list.stages, made.list.count], ['Workshops', ['To ask', 'Asked', 'Booked'], 0]);
  await assert.rejects(net(env, 'venture.crm.list.save', { name: 'workshops', stages: ['A', 'B'] }), code('INVALID_VENTURE_REQUEST'), 'a list is named once');

  await assert.rejects(net(env, 'venture.crm.list.place', { listId: made.list.id, member: `client:${aroma.id}`, stage: 'Paid' }), code('INVALID_VENTURE_REQUEST'));
  await net(env, 'venture.crm.list.place', { listId: made.list.id, member: `client:${aroma.id}`, stage: 'To ask' });
  env.advance(1000);
  const moved = await net<CrmListView>(env, 'venture.crm.list.place', { listId: made.list.id, member: `client:${aroma.id}`, stage: 'Asked' });
  assert.deepEqual(moved.groups.map(group => [group.stage, group.entries.map(entry => entry.name)]), [['To ask', []], ['Asked', ['Cafe Aroma Demo']], ['Booked', []]]);
  const crm = await view(env, aroma.id);
  assert.deepEqual(crm.lists, [{ listId: made.list.id, name: 'Workshops', stage: 'Asked' }]);
  assert.deepEqual(crm.history.slice(0, 2).map(row => [row.line, row.before, row.after]), [['You changed Workshops', 'To ask', 'Asked'], ['You set Workshops', null, 'To ask']]);

  await assert.rejects(net(env, 'venture.crm.list.save', { listId: made.list.id, name: 'Workshops', stages: ['To ask', 'Booked'] }), code('INVALID_VENTURE_REQUEST'), 'a stage with members stays');
  const renamed = await net<CrmListView>(env, 'venture.crm.list.save', { listId: made.list.id, name: 'Workshop leads', stages: ['To ask', 'Asked', 'Booked', 'Paid'] });
  assert.deepEqual(renamed.history.slice(0, 2).map(row => row.line).sort(), ['You changed Name', 'You changed Stages']);
  const lists = await net<CrmListRow[]>(env, 'venture.crm.lists', {});
  assert.deepEqual(lists.map(row => [row.name, row.count]), [['Workshop leads', 1]]);
  const out = await net<CrmListView>(env, 'venture.crm.list.place', { listId: made.list.id, member: `client:${aroma.id}`, stage: null });
  assert.equal(out.list.count, 0);
  assert.equal((await view(env, aroma.id)).history[0].line, 'You took this out of Workshop leads');
});

// One-shot C4 task 18: the timeline holds the client's orders and drafts too, and what they owe keeps its receipt.
test('C4: orders and drafts join a client\'s timeline in order, only that client\'s; what they owe is the invoices\' balance with a receipt', async () => {
  const env = await setup();
  const aroma = await client(env, 'Cafe Aroma Demo');
  const other = await client(env, 'Someone Else');
  await ventureAction(env.deps, owner, 'admin', 'seed.orders', tx => {
    tx.put({ ...tx.base('venture-blueprint'), version: 1, status: 'accepted', offers: [{ id: 'offer_1', name: { value: 'Monthly visits' } }] } as unknown as BlueprintRecord);
    const order = { offerId: 'offer_1', quantity: '1', request: 'Visits for the cafe', priceReceiptId: 'r_1', saleFactId: null };
    const mine = tx.put({ ...tx.base('venture-order'), ...order, clientId: aroma.id, status: 'delivered', deliveredOn: '2026-10-20', at: '2026-10-10T05:00:00.000Z' } as OrderRecord);
    const theirs = tx.put({ ...tx.base('venture-order'), ...order, clientId: other.id, status: 'open', deliveredOn: null, at: '2026-10-11T05:00:00.000Z' } as OrderRecord);
    tx.put({ ...tx.base('venture-order'), ...order, internal: true, clientId: aroma.id, status: 'open', deliveredOn: null } as OrderRecord);
    const run = { practice: false, deliverable: null };
    tx.put({ ...tx.base('venture-delivery-run'), ...run, orderId: mine.id, status: 'accepted', verdict: { choice: 'accepted', reason: null, at: '2026-10-15T05:00:00.000Z' } } as unknown as DeliveryRunRecord);
    tx.put({ ...tx.base('venture-delivery-run'), ...run, orderId: mine.id, status: 'rejected', verdict: { choice: 'rejected', reason: null, at: '2026-10-14T05:00:00.000Z' } } as unknown as DeliveryRunRecord);
    tx.put({ ...tx.base('venture-delivery-run'), ...run, orderId: mine.id, status: 'ready-for-review', verdict: null } as unknown as DeliveryRunRecord);
    tx.put({ ...tx.base('venture-delivery-run'), ...run, practice: true, orderId: mine.id, status: 'accepted', verdict: { choice: 'accepted', reason: null, at: '2026-10-16T05:00:00.000Z' } } as unknown as DeliveryRunRecord);
    tx.put({ ...tx.base('venture-delivery-run'), ...run, orderId: theirs.id, status: 'accepted', verdict: { choice: 'accepted', reason: null, at: '2026-10-17T05:00:00.000Z' } } as unknown as DeliveryRunRecord);
    const invoice = { orderId: mine.id, clientId: aroma.id, currency: 'INR', dueDate: null, dueInDays: 7, lines: [], subtotalMinor: '200000', discountMinor: '0', taxMinor: '0', totalMinor: '200000', balanceMinor: '200000' } as unknown as InvoiceRecord;
    tx.put({ ...tx.base('venture-invoice'), ...invoice, number: 'INV-0001', issueDate: '2026-10-18', status: 'issued' } as InvoiceRecord);
  });
  const timeline = (await view(env, aroma.id)).timeline;
  assert.deepEqual(timeline.map(entry => [entry.kind, entry.on, entry.line]), [
    ['order', '2026-10-20', 'Order for Monthly visits delivered'],
    ['invoice', '2026-10-18', 'Invoice INV-0001 issued'],
    ['draft', '2026-10-15', 'Draft approved'],
    ['draft', '2026-10-14', 'Draft rejected'],
    ['order', '2026-10-10', 'Order for Monthly visits added'],
  ]);
  assert.deepEqual((await view(env, other.id)).timeline.map(entry => entry.line), ['Draft approved', 'Order for Monthly visits added']);
  const row = (await listClients(env.deps, owner, {})).find(item => item.id === aroma.id)!;
  assert.equal(row.owed!.display, '₹2,000');
  assert.ok(listRecords(env.store.read(), 'venture-sum-receipt').some((item: { id: string }) => item.id === row.owed!.receiptId), 'with its receipt');
});

test('Forget of a person erases the history, timeline, company link and list places kept about them and their client', async () => {
  const env = await setup();
  const aroma = await client(env, 'Asha Rao', 'asha@dewdrop.example');
  await net(env, 'venture.network.import', { kind: 'contacts-csv', name: 'contacts.csv', text: CONTACTS });
  const asha = personNamed(env, 'Asha Rao');
  assert.equal(asha.clientId, aroma.id, 'the import linked her client by email');
  const company = await net<CompanyView>(env, 'venture.crm.company.save', { name: 'Dewdrop Naturals' });
  await net(env, 'venture.crm.link', { companyId: company.company.id, member: `person:${asha.id}` });
  await net(env, 'venture.crm.link', { companyId: company.company.id, member: `client:${aroma.id}` });
  await net(env, 'venture.crm.client.edit', { clientId: aroma.id, field: 'note', value: 'Asha likes mornings.' });
  await net(env, 'venture.crm.log', { clientId: aroma.id, kind: 'call', on: '2026-10-14', text: 'Asha asked for samples.' });
  const list = await net<CrmListView>(env, 'venture.crm.list.save', { name: 'Gifting', stages: ['Asked', 'Said yes'] });
  await net(env, 'venture.crm.list.place', { listId: list.list.id, member: `person:${asha.id}`, stage: 'Asked' });
  await net(env, 'venture.crm.company.save', { companyId: company.company.id, note: 'Asha Rao runs it.' });
  // C4 task 18: her client's orders and drafts stay in the books, and leave the timeline with the rest.
  await ventureAction(env.deps, owner, 'admin', 'seed.order', tx => {
    const order = tx.put({ ...tx.base('venture-order'), offerId: 'offer_1', quantity: '1', request: 'Samples', priceReceiptId: 'r_1', saleFactId: null, clientId: aroma.id, status: 'open', deliveredOn: null } as OrderRecord);
    tx.put({ ...tx.base('venture-delivery-run'), practice: false, deliverable: null, orderId: order.id, status: 'accepted', verdict: { choice: 'accepted', reason: null, at: tx.now } } as unknown as DeliveryRunRecord);
  });
  assert.ok((await view(env, aroma.id)).timeline.some(entry => entry.kind === 'order'));

  await net(env, 'venture.network.forget', { id: asha.id });
  const state = env.store.read();
  const kept = JSON.stringify([
    ...listRecords(state, 'venture-crm-change'), ...listRecords(state, 'venture-crm-entry'), ...listRecords(state, 'venture-crm-link'),
    ...listRecords(state, 'venture-crm-list-item'), ...listRecords(state, 'venture-company'),
  ]);
  assert.ok(!kept.includes(asha.id) && !kept.includes(aroma.id), 'no row names them or their client');
  assert.ok(!/asha/i.test(kept), 'no row keeps her name');
  assert.equal(listRecords(state, 'venture-company').length, 1, 'the company stays, without her');
  assert.equal(listRecords(state, 'venture-crm-list').length, 1, 'the list stays');
  const after = await view(env, aroma.id);
  assert.deepEqual([after.company, after.timeline, after.lists, after.history.map(row => row.line)], [null, [], [], ['Added to Clients']]);
  assert.ok(listRecords(state, 'venture-client').some((item: ClientRecord) => item.id === aroma.id), 'the client record stays in Clients');
});
