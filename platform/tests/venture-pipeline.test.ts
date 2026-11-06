// Package 4E1 (Ink v2 wave 4): the pipeline. Cards run Found, Asked, Talking, Proposal, Won, Lost, Not now, forward
// only; won, lost and not-now are terminal, and asking again makes a new card linked to the old one. Each move needs its
// evidence; Won makes or links a client in the same move; a person on the blocklist is refused; every card names what
// made it (no source, no card); existing leads map in honestly and keep working; the board has seven columns with their
// sub lines, four tiles counted from records with receipts, and each card's timeline. Every change emits
// pipeline.changed with ids only.
import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  ClientRecord, InboundRecord, LeadRecord, LeadView, OutreachDraftView, PipelineCardResult, PriceReceiptRecord, SumReceiptRecord,
} from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { moveLead } from '../runtime/venture/customers/leads.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import type { Context } from '../runtime/contracts.ts';
import type { VentureDeps } from '../runtime/venture/contracts.ts';
import { code, owner, phone, seedBlueprint, setup, type Env } from './venture-views-env.ts';
import {
  add, allCards, board, cardById, cards, days, leadCall, leadDeps, leads, manyPeople, pipe, recordSent, seedDraft, withPeople,
} from './venture-pipeline-env.ts';

const move = (env: Env, id: string, stage: string, extra: Record<string, unknown> = {}, ctx: Context = owner) =>
  pipe<PipelineCardResult>(env, 'venture.pipeline.move', { id, stage, ...extra }, ctx);
const note = (on: string, text?: string) => ({ kind: 'note', on, ...(text ? { text } : {}) });
const BLOCKED_WORDS = 'This person asked not to be contacted, or is on your blocklist.';
const moneyCall = <T>(env: Env, method: string, payload: unknown) =>
  ((money as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>>)[method])(env.deps, owner, payload) as Promise<T>;
const pipelineEvents = (env: Env) => env.published.flat().filter(event => event.name === 'pipeline.changed');

test('venture.pipeline.add: no source, no card; every card names what made it; only the owner adds, inside the app', async () => {
  const env = await setup();
  const { asha, rahul, farhan } = await withPeople(env);
  await assert.rejects(pipe(env, 'venture.pipeline.add', { personId: asha.id }), code('PIPELINE_TRIGGER_REQUIRED'));
  await assert.rejects(add(env, asha, { kind: 'search' }), code('PIPELINE_TRIGGER_REQUIRED'));
  await assert.rejects(add(env, asha, { kind: 'search', ref: 'netsearch_nothing' }), code('PIPELINE_TRIGGER_REQUIRED'));
  await assert.rejects(add(env, asha, { kind: 'lead', ref: 'lead_nothing' }), code('PIPELINE_TRIGGER_REQUIRED'));
  await assert.rejects(add(env, asha, { kind: 'import', ref: 'netimport_nothing:5' }), code('PIPELINE_TRIGGER_REQUIRED'));
  await assert.rejects(add(env, asha, { kind: 'telepathy' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(pipe(env, 'venture.pipeline.add', { personId: asha.id, trigger: { kind: 'owner' } }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(pipe(env, 'venture.pipeline.add', { personId: 'person_nobody', trigger: { kind: 'owner' } }), code('INVALID_VENTURE_REQUEST'));
  assert.equal(cards(env).length, 0, 'nothing half-made');

  const mine = await add(env, asha);
  assert.equal(mine.line, 'Added to Found.');
  assert.deepEqual([mine.card.stage, mine.card.trigger, mine.card.name, mine.card.company, mine.card.initials, mine.card.personId],
    ['found', 'You added them.', 'Asha Rao', 'Dewdrop Naturals', 'AR', asha.id]);
  const [file] = listRecords(env.store.read(), 'venture-network-import');
  const rahulRow = rahul.facts.find(fact => fact.source.importId === file.id)!.source.row!;
  const fromFile = await add(env, rahul, { kind: 'import' });
  assert.equal(fromFile.card.trigger, `LinkedIn connections, Connections.csv, line ${rahulRow}`);
  assert.deepEqual(cardById(env, fromFile.card.id).trigger, { kind: 'import', ref: `${file.id}:${rahulRow}`, line: fromFile.card.trigger });
  await assert.rejects(add(env, farhan, { kind: 'import', ref: `${file.id}:${rahulRow}` }), code('PIPELINE_TRIGGER_REQUIRED'), 'not this person\'s row');
  const farhanRow = farhan.facts.find(fact => fact.source.importId === file.id)!.source.row!;
  const named = await add(env, farhan, { kind: 'import', ref: `${file.id}:${farhanRow}` });
  assert.equal(named.card.trigger, `LinkedIn connections, Connections.csv, line ${farhanRow}`);

  const again = await add(env, asha);
  assert.deepEqual([again.card.id, again.line], [mine.card.id, 'Already in your pipeline, at Found.']);
  assert.equal(cards(env).length, 3);
  const stored = cardById(env, mine.card.id);
  assert.deepEqual(stored.history, [{ from: null, to: 'found', at: env.now(), by: 'owner', evidence: { kind: 'owner', id: null, line: 'You added them.' } }]);
  assert.deepEqual(pipelineEvents(env).map(event => event.data), [{ id: mine.card.id }, { id: fromFile.card.id }, { id: named.card.id }], 'ids only, and none for the repeat');
});

test('venture.pipeline.add from a search names it, and a lead names the page it was found on', async () => {
  const env = await setup();
  const { asha, rahul } = await withPeople(env);
  const search = await ventureAction(env.deps, owner, 'prepare', 'seed.search', tx => tx.put({
    ...tx.base('venture-network-search'), text: 'founders who sell skincare online', traits: [], candidates: 2, web: false, callIds: [],
    results: [{ personId: asha.id, url: null, fitBp: 9000, checks: [] }], shown: [asha.id], saved: { name: 'Skincare founders', at: env.now() },
  }));
  await assert.rejects(add(env, rahul, { kind: 'search', ref: search.id }), code('PIPELINE_TRIGGER_REQUIRED'), 'he was not in that search');
  const fromSearch = await add(env, asha, { kind: 'saved-search', ref: search.id });
  assert.equal(fromSearch.card.trigger, 'From your saved search "Skincare founders"');
  const deps = leadDeps(env);
  const lead = await leadCall<LeadView>(deps, 'venture.leads.add', { name: 'Rahul M', email: 'rahul@ubtan.example', sourceUrl: 'https://ubtan.example/team?ref=x' });
  const fromLead = await add(env, rahul, { kind: 'lead', ref: lead.id });
  assert.equal(fromLead.card.trigger, 'Found on ubtan.example/team');
  assert.equal(cardById(env, fromLead.card.id).leadId, lead.id);
  assert.equal(allCards(await board(env)).filter(card => card.name === 'Rahul Mehta' || card.name === 'Rahul M').length, 1, 'the lead now shows as his card, once');
});

test('venture.pipeline.move goes forward only; won, lost and not-now are terminal; the owner moves inside the app', async () => {
  const env = await setup();
  const { asha, rahul } = await withPeople(env);
  const { card } = await add(env, asha);
  await assert.rejects(move(env, card.id, 'talking', { evidence: note('2026-10-14') }, phone), code('APP_APPROVAL_REQUIRED'));
  const talking = await move(env, card.id, 'talking', { evidence: note('2026-10-14', 'She called back') });
  assert.deepEqual([talking.card.stage, talking.line], ['talking', 'Moved to Talking.']);
  await assert.rejects(move(env, card.id, 'asked', { evidence: note('2026-10-14') }), code('PIPELINE_STAGE_BACKWARD'));
  await assert.rejects(move(env, card.id, 'talking', { evidence: note('2026-10-14') }), code('PIPELINE_STAGE_BACKWARD'));
  await assert.rejects(move(env, card.id, 'found'), code('PIPELINE_STAGE_BACKWARD'));
  await assert.rejects(move(env, card.id, 'later'), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(move(env, 'opp_nothing', 'lost', { reason: 'other' }), code('INVALID_VENTURE_REQUEST'));
  const lost = await move(env, card.id, 'lost', { reason: 'no-budget' });
  assert.deepEqual([lost.card.stage, lost.line], ['lost', 'Moved to Lost: no budget.']);
  await assert.rejects(move(env, card.id, 'won'), code('PIPELINE_STAGE_CLOSED'));
  await assert.rejects(move(env, card.id, 'not-now'), code('PIPELINE_STAGE_CLOSED'));
  const stored = cardById(env, card.id);
  assert.equal(stored.lostReason, 'no-budget');
  assert.deepEqual(stored.history.map(item => [item.from, item.to, item.by, item.evidence.kind, item.evidence.line]), [
    [null, 'found', 'owner', 'owner', 'You added them.'],
    ['found', 'talking', 'owner', 'reply', 'You said they wrote back on 14 Oct 2026: She called back'],
    ['talking', 'lost', 'owner', 'reason', 'Lost: no budget.'],
  ]);

  const second = await add(env, rahul);
  const parked = await move(env, second.card.id, 'not-now');
  assert.deepEqual([parked.card.stage, parked.line], ['not-now', 'Moved to Not now. Ask again from 14 Nov 2026.']);
  assert.equal(cardById(env, second.card.id).askAgainFrom, '2026-11-14');
  await assert.rejects(move(env, second.card.id, 'talking', { evidence: note('2026-10-14') }), (error: any) => {
    assert.equal(error.code, 'PIPELINE_STAGE_CLOSED');
    assert.equal(error.message, 'This card is Not now. Ask again from 14 Nov 2026 to start a new card.');
    return true;
  });
});

test('each move needs its evidence: a send for Asked, a reply for Talking, a quote or a note for Proposal, a reason for Lost', async () => {
  const env = await setup();
  const { asha, rahul } = await withPeople(env);
  const { card } = await add(env, asha);
  await assert.rejects(move(env, card.id, 'asked'), code('PIPELINE_EVIDENCE_REQUIRED'));
  await assert.rejects(move(env, card.id, 'asked', { evidence: { kind: 'reply', id: 'inbound_x' } }), code('PIPELINE_EVIDENCE_REQUIRED'));
  await assert.rejects(move(env, card.id, 'asked', { evidence: { kind: 'note' } }), code('PIPELINE_EVIDENCE_REQUIRED'));
  await assert.rejects(move(env, card.id, 'asked', { evidence: note('2026-10-16') }), code('INVALID_VENTURE_REQUEST'), 'not a day in the future');
  await assert.rejects(move(env, card.id, 'asked', { evidence: note('2026-10-15'), reason: 'timing' }), code('INVALID_VENTURE_REQUEST'), 'a reason is for Lost');
  const asked = await move(env, card.id, 'asked', { evidence: note('2026-10-15') });
  assert.deepEqual([asked.card.stage, asked.line], ['asked', 'Moved to Asked. Follow up 20 Oct.']);
  assert.deepEqual(cardById(env, card.id).touches, [{ what: 'sent', on: '2026-10-15', at: env.now(), kind: 'first', channel: null, ref: null, by: 'owner' }]);

  await assert.rejects(move(env, card.id, 'talking'), code('PIPELINE_EVIDENCE_REQUIRED'));
  await assert.rejects(move(env, card.id, 'talking', { evidence: { kind: 'reply', id: 'inbound_nothing' } }), code('PIPELINE_EVIDENCE_REQUIRED'));
  const inbound = await ventureAction(env.deps, owner, 'prepare', 'seed.inbound', tx => tx.put<InboundRecord>({
    ...tx.base('venture-inbound'), messageId: '<m1@dewdrop.example>', from: 'asha@dewdrop.example', to: ['owner@ledger.example'], date: '2026-10-15T04:00:00.000Z',
    subject: 'Re: gift boxes', references: [], matched: null, triage: 'talking', line: 'She wrote back.', processed: false, screen: null,
  }));
  const other = await ventureAction(env.deps, owner, 'prepare', 'seed.inbound', tx => tx.put<InboundRecord>({
    ...tx.base('venture-inbound'), messageId: '<m2@else.example>', from: 'someone@else.example', to: ['owner@ledger.example'], date: '2026-10-15T04:00:00.000Z',
    subject: 'Hello', references: [], matched: null, triage: 'talking', line: 'Someone wrote.', processed: false, screen: null,
  }));
  await assert.rejects(move(env, card.id, 'talking', { evidence: { kind: 'reply', id: other.id } }), code('PIPELINE_EVIDENCE_REQUIRED'), 'not her message');
  const talking = await move(env, card.id, 'talking', { evidence: { kind: 'reply', id: inbound.id } });
  assert.deepEqual([talking.card.stage, talking.line], ['talking', 'Moved to Talking. Follow-ups stopped.']);
  assert.deepEqual(cardById(env, card.id).touches!.at(-1), { what: 'reply', on: '2026-10-15', at: env.now(), kind: null, channel: null, ref: inbound.id, by: 'owner' });

  await assert.rejects(move(env, card.id, 'proposal'), code('PIPELINE_EVIDENCE_REQUIRED'));
  await assert.rejects(move(env, card.id, 'proposal', { evidence: { kind: 'note' } }), code('PIPELINE_EVIDENCE_REQUIRED'));
  await assert.rejects(move(env, card.id, 'proposal', { evidence: { kind: 'quote', id: 'price_nothing' } }), code('PIPELINE_EVIDENCE_REQUIRED'));
  await seedBlueprint(env);
  const quote = await moneyCall<PriceReceiptRecord>(env, 'venture.price.quote', { offerId: 'offer_1' });
  const proposal = await move(env, card.id, 'proposal', { evidence: { kind: 'quote', id: quote.id } });
  assert.deepEqual([proposal.card.stage, proposal.line], ['proposal', 'Moved to Proposal.']);
  assert.deepEqual(cardById(env, card.id).history.at(-1)!.evidence, { kind: 'quote', id: quote.id, line: 'A quote of INR 2,499.00 before tax.' });

  const second = await add(env, rahul);
  const byNote = await move(env, second.card.id, 'proposal', { evidence: { kind: 'note', text: 'Sent the price list on WhatsApp' } });
  assert.deepEqual(cardById(env, byNote.card.id).history.at(-1)!.evidence, { kind: 'owner', id: null, line: 'You noted: Sent the price list on WhatsApp' });
  await assert.rejects(move(env, second.card.id, 'lost'), code('PIPELINE_EVIDENCE_REQUIRED'));
  await assert.rejects(move(env, second.card.id, 'lost', { reason: 'opted-out' }), code('INVALID_VENTURE_REQUEST'), 'opted out comes only from their own words');
  await assert.rejects(move(env, second.card.id, 'lost', { reason: 'bored' }), code('INVALID_VENTURE_REQUEST'));
  for (const [reason, words] of [['no-reply', 'no reply']] as const) {
    const lost = await move(env, second.card.id, 'lost', { reason });
    assert.equal(lost.line, `Moved to Lost: ${words}.`);
  }
});

test('Won makes the client in the same move, or links one you have; the person is linked to the client', async () => {
  const env = await setup();
  const { asha, rahul } = await withPeople(env);
  const first = await add(env, asha);
  await move(env, first.card.id, 'talking', { evidence: note('2026-10-14') });
  const won = await move(env, first.card.id, 'won');
  assert.deepEqual([won.card.stage, won.line], ['won', 'Won. Asha is now your client.']);
  const [client] = listRecords(env.store.read(), 'venture-client');
  assert.deepEqual([client.name, client.email], ['Asha Rao', 'asha@dewdrop.example']);
  const stored = cardById(env, first.card.id);
  assert.equal(stored.clientId, client.id);
  assert.deepEqual(stored.history.at(-1)!.evidence, { kind: 'client', id: client.id, line: 'Asha Rao became your client.' });
  assert.equal(listRecords(env.store.read(), 'venture-person').find(person => person.id === asha.id)!.clientId, client.id);
  assert.ok(env.published.flat().some(event => event.name === 'client-added'), 'the client is announced as any new client is');

  const existing = await moneyCall<ClientRecord>(env, 'venture.client.add', { name: 'Ubtan Lab' });
  const second = await add(env, rahul);
  await assert.rejects(move(env, second.card.id, 'won', { evidence: { kind: 'client', id: 'client_nothing' } }), code('PIPELINE_EVIDENCE_REQUIRED'));
  const linked = await move(env, second.card.id, 'won', { evidence: { kind: 'client', id: existing.id } });
  assert.equal(linked.line, 'Won, linked to your client Ubtan Lab.');
  assert.equal(listRecords(env.store.read(), 'venture-client').length, 2, 'no second client made');
  assert.equal(cardById(env, second.card.id).clientId, existing.id);
});

test('Not now parks until "Ask again from"; asking again then makes a new card linked to the old one, whose history stays', async () => {
  const env = await setup();
  const { farhan, rahul } = await withPeople(env);
  const { card } = await add(env, farhan);
  await move(env, card.id, 'not-now');
  await assert.rejects(add(env, farhan), (error: any) => {
    assert.equal(error.code, 'PIPELINE_STAGE_CLOSED');
    assert.equal(error.message, 'Farhan Ali is Not now until 14 Nov 2026. Ask again from then.');
    return true;
  });
  const parked = (await board(env)).columns.find(column => column.stage === 'not-now')!.cards[0];
  assert.deepEqual(parked.next, { text: 'Ask again', due: '2026-11-14', line: 'Ask again from 14 Nov', late: false });
  days(env, 30);
  const again = await add(env, farhan);
  assert.notEqual(again.card.id, card.id);
  assert.deepEqual([again.card.stage, again.line], ['found', 'Added to Found again, linked to the earlier card.']);
  assert.equal(cardById(env, again.card.id).linkedFrom, card.id);
  assert.equal(cardById(env, card.id).history.length, 2, 'the old card keeps its history');
  assert.equal(cardById(env, card.id).stage, 'not-now');

  const lost = await add(env, rahul);
  await move(env, lost.card.id, 'lost', { reason: 'timing' });
  assert.equal(cardById(env, lost.card.id).askAgainFrom, '2026-12-14');
  await assert.rejects(add(env, rahul), (error: any) => {
    assert.equal(error.code, 'PIPELINE_STAGE_CLOSED');
    assert.equal(error.message, 'Rahul Mehta is Lost until 14 Dec 2026. Ask again from then.');
    return true;
  });
  days(env, 30);
  const back = await add(env, rahul);
  assert.equal(cardById(env, back.card.id).linkedFrom, lost.card.id, 'Lost waits as long as Not now, then a new card links to it');
});

test('a person on the blocklist is PIPELINE_BLOCKED; the card keeps its stage with the blocked flag and may still close', async () => {
  const env = await setup();
  const { asha } = await withPeople(env);
  const deps = leadDeps(env);
  const { card } = await add(env, asha);
  await leadCall(deps, 'venture.leads.block', { value: 'dewdrop.example' });
  await assert.rejects(move(env, card.id, 'talking', { evidence: note('2026-10-14') }), code('PIPELINE_BLOCKED'));
  await assert.rejects(pipe(env, 'venture.pipeline.setNext', { id: card.id, text: 'Call her', due: '2026-10-16' }), code('PIPELINE_BLOCKED'));
  const shown = allCards(await board(env)).find(item => item.id === card.id)!;
  assert.deepEqual([shown.stage, shown.blocked], ['found', BLOCKED_WORDS]);
  const closed = await move(env, card.id, 'lost', { reason: 'other' });
  assert.equal(closed.card.stage, 'lost');
  await assert.rejects(add(env, asha), code('PIPELINE_BLOCKED'));
});

/** A lead at a stage, through the lead methods where they reach it and the lead rules where only an outcome does. */
async function leadAt(env: Env, deps: VentureDeps, name: string, stage: LeadRecord['status']): Promise<LeadView> {
  const email = `${name.toLowerCase()}@${name.toLowerCase()}.example`;
  const lead = await leadCall<LeadView>(deps, 'venture.leads.add', { name, company: `${name} Cafe`, email, sourceUrl: 'https://directory.example/pune/cafes' });
  if (stage === 'new') return lead;
  const { draft } = await leadCall<{ draft: OutreachDraftView }>(deps, 'venture.leads.draft', { leadId: lead.id, subject: 'Books', body: 'A short note.', postalAddress: '12 FC Road, Pune 411004' });
  if (stage === 'drafted') return lead;
  await leadCall(deps, 'venture.leads.recordSend', { leadId: lead.id, draftId: draft.id, sentAt: env.now() });
  if (stage === 'blocked') await leadCall(deps, 'venture.leads.block', { value: email });
  if (stage === 'contacted' || stage === 'blocked') return lead;
  await ventureAction(env.deps, owner, 'approve', 'seed.lead', tx => {
    const stored = tx.find('venture-lead', lead.id)!;
    const replied = moveLead({ ...stored, id: stored.id }, 'replied', { evidence: { kind: 'reply', id: 'mail-1' }, by: 'owner', at: tx.now });
    const next = stage === 'replied' ? replied : moveLead(replied, stage, { evidence: { kind: 'outcome', id: 'note-1' }, by: 'owner', at: tx.now });
    const { id: _id, ...fields } = next;
    tx.replace<LeadRecord>({ ...stored, ...fields });
  });
  return lead;
}

test('existing leads map in: new to Found, drafted and contacted to Asked, replied to Talking, won and lost as they are; blocked is a flag', async () => {
  const env = await setup();
  const deps = leadDeps(env);
  const ids: Record<string, string> = {};
  for (const [name, stage] of [['Nia', 'new'], ['Dev', 'drafted'], ['Kiran', 'contacted'], ['Meera', 'replied'], ['Wasim', 'won'], ['Lata', 'lost'], ['Om', 'blocked']] as const) {
    ids[name] = (await leadAt(env, deps, name, stage)).id;
  }
  const view = await board(env);
  const byName = new Map(allCards(view).map(card => [card.name, card]));
  assert.deepEqual([...byName.values()].map(card => [card.name, card.stage]).sort(), [
    ['Dev', 'asked'], ['Kiran', 'asked'], ['Lata', 'lost'], ['Meera', 'talking'], ['Nia', 'found'], ['Om', 'asked'], ['Wasim', 'won'],
  ]);
  assert.equal(byName.get('Om')!.blocked, BLOCKED_WORDS, 'blocked stays a flag');
  assert.equal(byName.get('Kiran')!.blocked, undefined);
  // A lead with a recorded send has its card stored (so its follow-ups keep that day's sequence); the others read as cards.
  const storedFor = (leadId: string) => cards(env).find(card => card.leadId === leadId);
  for (const [name, id] of Object.entries(ids)) {
    assert.deepEqual([byName.get(name)!.id, byName.get(name)!.personId], [storedFor(id)?.id ?? id, id], name);
    assert.equal(!!storedFor(id), !['Nia', 'Dev'].includes(name), `${name}: stored only once sent`);
  }
  assert.deepEqual([byName.get('Nia')!.trigger, byName.get('Nia')!.company], ['Found on directory.example/pune/cafes', 'Nia Cafe']);
  assert.equal(byName.get('Dev')!.draft, 'Cold email drafted, for Mail');
  assert.equal(byName.get('Kiran')!.draft, null, 'the one draft went out');
  assert.ok(byName.get('Kiran')!.timeline.some(item => item.what === 'sent' && item.at === '2026-10-15'), 'the lead\'s send is on the timeline');
  const before = cards(env).length;
  await board(env);
  assert.equal(cards(env).length, before, 'reading the board stores no card');

  // A replied lead that gets one more recorded send stays Talking (the W1 fix holds).
  const meera = leads(env).find(lead => lead.id === ids.Meera)!;
  const { draft } = await leadCall<{ draft: OutreachDraftView }>(deps, 'venture.leads.draft', { leadId: meera.id, subject: 'Again', body: 'One more note.' });
  env.advance(60_000);
  await leadCall(deps, 'venture.leads.recordSend', { leadId: meera.id, draftId: draft.id, sentAt: env.now() });
  const after = allCards(await board(env)).find(card => card.name === 'Meera')!;
  assert.equal(after.stage, 'talking');
  assert.equal(after.timeline.filter(item => item.what === 'sent').length, 2);
});

test('a lead\'s history maps in honestly: what each move rests on, and a stage stored before moves were kept says so', async () => {
  const env = await setup();
  const deps = leadDeps(env);
  const kiran = await leadAt(env, deps, 'Kiran', 'contacted');
  const old = await leadAt(env, deps, 'Ravi', 'new');
  await ventureAction(env.deps, owner, 'admin', 'seed.old', tx => {
    const stored = tx.find('venture-lead', old.id)!;
    const { moves: _moves, ...rest } = stored as LeadRecord & { moves?: unknown };
    tx.replace({ ...rest, status: 'replied' } as LeadRecord);
  });
  const { asha } = await withPeople(env);
  const matched = await leadCall<LeadView>(deps, 'venture.leads.add', { name: 'A. Rao', email: 'asha@dewdrop.example', sourceUrl: 'https://dewdrop.example/about' });
  const view = await board(env);
  const card = (id: string) => allCards(view).find(item => item.id === id)!;
  assert.deepEqual(card(matched.id).personId, asha.id, 'a lead whose email is someone in your network is their card');
  assert.equal(card(matched.id).name, 'Asha Rao');
  // The full history is kept once the card is stored: move Kiran on in the pipeline and read the record.
  await move(env, kiran.id, 'talking', { evidence: note('2026-10-15') });
  const stored = cards(env).find(item => item.leadId === kiran.id)!;
  assert.deepEqual(stored.history.map(item => [item.from, item.to, item.evidence.kind, item.evidence.line]), [
    [null, 'found', 'lead', 'Found on directory.example/pune/cafes'],
    ['found', 'asked', 'lead', 'An email was drafted in your lead list.'],
    ['asked', 'talking', 'reply', 'You said they wrote back on 15 Oct 2026.'],
  ]);
  assert.deepEqual(stored.touches!.map(item => [item.what, item.on, item.kind, item.channel]), [['sent', '2026-10-15', 'first', 'own-mailbox'], ['reply', '2026-10-15', null, null]]);
  assert.equal(leads(env).find(lead => lead.id === kiran.id)!.status, 'replied', 'the lead follows the card');
  assert.deepEqual(leads(env).find(lead => lead.id === kiran.id)!.moves.at(-1)!.evidence, { kind: 'reply', id: stored.id });
  const shown = allCards(await board(env)).filter(item => item.name === 'Kiran');
  assert.deepEqual(shown.map(item => [item.id, item.stage]), [[stored.id, 'talking']], 'one card for the lead, the stored one');
  const byLeadId = await move(env, kiran.id, 'proposal', { evidence: { kind: 'note', text: 'Sent the price' } });
  assert.equal(byLeadId.card.id, stored.id, 'the lead\'s id still finds its card');
  await move(env, old.id, 'proposal', { evidence: { kind: 'note', text: 'Sent the price' } });
  const ravi = cards(env).find(item => item.leadId === old.id)!;
  assert.deepEqual(ravi.history.map(item => [item.from, item.to, item.evidence.kind, item.evidence.line]), [
    [null, 'found', 'lead', 'Found on directory.example/pune/cafes'],
    ['found', 'talking', 'lead', 'Stage from your lead list; when it changed was not kept.'],
    ['talking', 'proposal', 'owner', 'You noted: Sent the price'],
  ]);
});

test('the board: seven columns with their sub lines, Lost and Not now folded, filters for due and drafts, readable away from the app', async () => {
  const env = await setup();
  const { asha, rahul, farhan } = await withPeople(env);
  const a = await add(env, asha);
  const r = await add(env, rahul);
  const f = await add(env, farhan);
  await recordSent(env, a.card.id, { on: '2026-10-08', channel: 'whatsapp', kind: 'intro-request' });
  await move(env, r.card.id, 'talking', { evidence: note('2026-10-14') });
  await move(env, f.card.id, 'not-now');
  await seedDraft(env, r.card, 'reply', 'email');
  const view = await pipe<Awaited<ReturnType<typeof board>>>(env, 'venture.pipeline.list', {}, phone);
  assert.deepEqual(view.columns.map(column => [column.stage, column.label, column.sub, column.count, column.folded]), [
    ['found', 'Found', 'Not asked yet', 0, false],
    ['asked', 'Asked', 'You sent the first note', 1, false],
    ['talking', 'Talking', 'They wrote back', 1, false],
    ['proposal', 'Proposal', 'A price is with them', 0, false],
    ['won', 'Won', 'Now your clients', 0, false],
    ['lost', 'Lost', 'It did not go ahead', 0, true],
    ['not-now', 'Not now', 'Ask again later', 1, true],
  ]);
  const asked = view.columns[1].cards[0];
  assert.deepEqual([asked.name, asked.business, asked.next], ['Asha Rao', 'Ledgerline', { text: 'Follow up', due: '2026-10-15', line: 'Follow up today', late: false }]);
  assert.equal(view.columns[2].cards[0].draft, 'Reply drafted, for Mail');
  const due = await board(env, { filter: 'due' });
  assert.deepEqual(allCards(due).map(card => card.name), ['Asha Rao']);
  const drafts = await board(env, { filter: 'draft' });
  assert.deepEqual(allCards(drafts).map(card => card.name), ['Rahul Mehta']);
  await assert.rejects(board(env, { filter: 'soon' }), code('INVALID_VENTURE_REQUEST'));
});

test('the four tiles are counted from records, each with its receipt', async () => {
  const env = await setup();
  const { asha, rahul, farhan } = await withPeople(env);
  const [person] = await manyPeople(env, 1);
  const a = await add(env, asha);
  const r = await add(env, rahul);
  const f = await add(env, farhan);
  const p = await add(env, person);
  await recordSent(env, a.card.id, { on: '2026-10-08', channel: 'whatsapp', kind: 'intro-request' }); // due today
  await recordSent(env, r.card.id, { on: '2026-10-06', channel: 'own-mailbox', kind: 'cold-email' }); // due 12 Oct, late
  await pipe(env, 'venture.pipeline.setNext', { id: f.card.id, text: 'Call about the stall', due: '2026-10-16' });
  await move(env, p.card.id, 'won');
  await seedDraft(env, a.card, 'follow-up', 'whatsapp');
  await seedDraft(env, r.card, 'follow-up', 'email');
  const view = await board(env);
  assert.deepEqual(view.tiles.map(tile => [tile.id, tile.label, tile.value, tile.line]), [
    ['next-steps', 'Next steps this week', '3', '1 late, 1 today, 1 later'],
    ['drafts', 'Drafts to send', '2', '1 for Mail, 1 for WhatsApp'],
    ['moved', 'Moved forward this week', '3', '2 to Asked, 1 to Won'],
    ['won', 'Won this month', '1', 'Person 1'],
  ]);
  for (const tile of view.tiles) {
    assert.ok(tile.receiptId, `${tile.id} has a receipt`);
    const receipt = await moneyCall<SumReceiptRecord>(env, 'venture.receipt.get', { id: tile.receiptId });
    assert.deepEqual([receipt.unit, receipt.totalMinor, receipt.stale], ['count', tile.value, false], tile.id);
  }
});

test('each card\'s timeline: what was sent, what is scheduled, what is projected (estimated), and where a reply came', async () => {
  const env = await setup();
  const { asha } = await withPeople(env);
  const { card } = await add(env, asha);
  await recordSent(env, card.id, { on: '2026-10-15', channel: 'own-mailbox', kind: 'cold-email' });
  const before = allCards(await board(env)).find(item => item.id === card.id)!;
  assert.deepEqual(before.timeline, [
    { what: 'sent', at: '2026-10-15', line: 'First note sent by email, 15 Oct. Chausar doesn\'t track opens.', estimated: false },
    { what: 'scheduled', at: '2026-10-20', line: 'Follow up 20 Oct', estimated: false },
    { what: 'projected', at: '2026-10-27', line: 'Second follow-up about 27 Oct, estimated', estimated: true },
    { what: 'projected', at: '2026-11-03', line: 'Parks as Not now about 3 Nov if there is no reply, estimated', estimated: true },
  ]);
  days(env, 1);
  await move(env, card.id, 'talking', { evidence: note('2026-10-16') });
  const after = allCards(await board(env)).find(item => item.id === card.id)!;
  assert.deepEqual(after.timeline, [
    { what: 'sent', at: '2026-10-15', line: 'First note sent by email, 15 Oct. Chausar doesn\'t track opens.', estimated: false },
    { what: 'reply', at: '2026-10-16', line: 'They wrote back, 16 Oct.', estimated: false },
  ]);
  assert.deepEqual(after.thread, { age: 'alive', days: 0, line: 'Alive: they wrote today.' });
});

test('setNext: the owner\'s own next step with its due day, on open cards only', async () => {
  const env = await setup();
  const { asha } = await withPeople(env);
  const { card } = await add(env, asha);
  await assert.rejects(pipe(env, 'venture.pipeline.setNext', { id: card.id, text: 'Call her', due: '2026-10-14' }), code('INVALID_VENTURE_REQUEST'), 'not a day gone');
  await assert.rejects(pipe(env, 'venture.pipeline.setNext', { id: card.id, text: 'Call her', due: '2026-10-16' }, phone), code('APP_APPROVAL_REQUIRED'));
  const set = await pipe<PipelineCardResult>(env, 'venture.pipeline.setNext', { id: card.id, text: 'Call her about the stall', due: '2026-10-16' });
  assert.deepEqual([set.card.next, set.line], [{ text: 'Call her about the stall', due: '2026-10-16', line: 'Call her about the stall, due 16 Oct', late: false }, 'Next step set for 16 Oct 2026.']);
  assert.deepEqual(cardById(env, card.id).next, { text: 'Call her about the stall', due: '2026-10-16' });
  days(env, 2);
  const late = allCards(await board(env)).find(item => item.id === card.id)!;
  assert.deepEqual(late.next, { text: 'Call her about the stall', due: '2026-10-16', line: 'Call her about the stall, due 16 Oct, 1 day late', late: true });
  await move(env, card.id, 'lost', { reason: 'other' });
  await assert.rejects(pipe(env, 'venture.pipeline.setNext', { id: card.id, text: 'Call her', due: '2026-10-20' }), code('PIPELINE_STAGE_CLOSED'));
  assert.deepEqual(pipelineEvents(env).map(event => Object.keys(event.data as object)), [['id'], ['id'], ['id']], 'every change: ids only');
});

test('the person sheet shows their pipeline card (venture.network.person)', async () => {
  const env = await setup();
  const { asha, rahul } = await withPeople(env);
  const { card } = await add(env, asha);
  const sheet = await pipe<{ card: { id: string; stage: string } | null }>(env, 'venture.network.person', { id: asha.id });
  assert.deepEqual([sheet.card?.id, sheet.card?.stage], [card.id, 'found']);
  assert.equal((await pipe<{ card: unknown }>(env, 'venture.network.person', { id: rahul.id })).card, null);
});

test('Forget takes the cards a lead made too: a card stored before the person was imported names the lead, not the person', async () => {
  const env = await setup();
  const deps = leadDeps(env);
  const lead = await leadCall<LeadView>(deps, 'venture.leads.add', { name: 'Asha', email: 'asha@dewdrop.example', sourceUrl: 'https://dewdrop.example/team' });
  const { card } = await pipe<PipelineCardResult>(env, 'venture.pipeline.setNext', { id: lead.id, text: 'Asha said her GST is overdue', due: '2026-10-16' });
  assert.equal(cardById(env, card.id).personId, lead.id);
  const { asha } = await withPeople(env);
  await pipe(env, 'venture.network.forget', { id: asha.id });
  assert.equal(cards(env).length, 0);
  assert.equal(leads(env).length, 0);
  assert.ok(!JSON.stringify(env.store.read()).includes('GST is overdue'), 'the owner\'s note about her is gone');
});

test('Forget leaves no receipt that names or counts them, the pipeline\'s or the network\'s', async () => {
  const env = await setup();
  const { asha, rahul } = await withPeople(env);
  const a = await add(env, asha);
  await add(env, rahul);
  await recordSent(env, a.card.id, { on: '2026-10-08', channel: 'whatsapp', kind: 'intro-request' });
  await seedDraft(env, a.card, 'follow-up', 'whatsapp');
  await pipe(env, 'venture.network.recompute', {});
  await pipe(env, 'venture.network.sources', {});
  await board(env);
  const sums = () => listRecords(env.store.read(), 'venture-sum-receipt');
  assert.ok(sums().some(receipt => receipt.addends.some(addend => addend.recordId === a.card.id)), 'the board counted her card');
  for (const receipt of sums().filter(item => item.subject.type === 'count' && item.subject.what === 'funnel')) {
    assert.ok(!JSON.stringify(receipt.addends).includes('Asha') && !JSON.stringify(receipt.addends).includes('Rahul'), 'pipeline receipts name no one');
  }
  const tieIds = listRecords(env.store.read(), 'venture-tie').filter(tie => tie.personId === asha.id).map(tie => tie.id);
  await pipe(env, 'venture.network.forget', { id: asha.id });
  for (const receipt of sums()) {
    assert.ok(!receipt.addends.some(addend => addend.recordId === a.card.id || tieIds.includes(addend.recordId)), `receipt ${receipt.id} still counts her`);
    assert.ok(!JSON.stringify(receipt).includes('Asha'), `receipt ${receipt.id} still names her`);
  }
});

test('per-factor votes are kept on the card, each with its page or "guess", and count in its score', async () => {
  const env = await setup();
  const { asha } = await withPeople(env);
  const addWith = (votes: unknown) => pipe<PipelineCardResult>(env, 'venture.pipeline.add', { personId: asha.id, trigger: { kind: 'owner' }, votes });
  await assert.rejects(addWith([{ factor: 'Big spender', points: 10, evidence: 'my hunch' }]), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(addWith([{ factor: 'Is a Muslim', points: 10, evidence: 'guess' }]), code('NETWORK_TRAIT_PROTECTED'));
  await assert.rejects(addWith(Array.from({ length: 11 }, () => ({ factor: 'x', points: 1, evidence: 'guess' }))), code('INVALID_VENTURE_REQUEST'));
  assert.equal(cards(env).length, 0);
  const votes = [{ factor: 'Sells online', points: 30, evidence: 'https://dewdrop.example/shop' }, { factor: 'Has budget', points: 20, evidence: 'guess' }];
  const made = await addWith(votes);
  assert.deepEqual(made.card.score, { bucket: 'hot', reasons: ['Sells online: +30 (https://dewdrop.example/shop)', 'Has budget: +20 (a guess)'] });
  assert.deepEqual(cardById(env, made.card.id).votes, votes);
  const again = await addWith([{ factor: 'Has budget', points: 5, evidence: 'guess' }]);
  assert.deepEqual([again.card.id, again.card.score], [made.card.id, { bucket: 'cold', reasons: ['Has budget: +5 (a guess)'] }], 'new votes replace the old');
});

test('Won links a client you already have, by email (any case) and then by name, before making one; a new client gets its evidence rows', async () => {
  const env = await setup();
  const { asha, rahul, farhan } = await withPeople(env);
  const dewdrop = await moneyCall<ClientRecord>(env, 'venture.client.add', { name: 'Dewdrop Naturals', email: 'ASHA@Dewdrop.example' });
  const named = await moneyCall<ClientRecord>(env, 'venture.client.add', { name: 'rahul mehta' });
  const a = await add(env, asha), r = await add(env, rahul), f = await add(env, farhan);
  assert.equal((await move(env, a.card.id, 'won')).line, 'Won, linked to your client Dewdrop Naturals.');
  assert.equal((await move(env, r.card.id, 'won')).line, 'Won, linked to your client rahul mehta.', 'a name match ignores case');
  assert.deepEqual([cardById(env, a.card.id).clientId, cardById(env, r.card.id).clientId], [dewdrop.id, named.id]);
  assert.equal((await move(env, f.card.id, 'won')).line, 'Won. Farhan is now your client.');
  const made = listRecords(env.store.read(), 'venture-client').find(client => client.name === 'Farhan Ali')!;
  assert.equal(listRecords(env.store.read(), 'venture-client').length, 3);
  assert.deepEqual(listRecords(env.store.read(), 'venture-evidence').filter(row => row.subject === `client:${made.id}`).map(row => [row.field, row.value]), [['name', 'Farhan Ali']]);
});

test('adding a person from a lead whose card is closed starts a fresh Found card linked to it; a lead that is someone else\'s is refused', async () => {
  const env = await setup();
  const deps = leadDeps(env);
  const { asha, rahul } = await withPeople(env);
  const lead = await leadCall<LeadView>(deps, 'venture.leads.add', { name: 'A Rao', email: 'asha@dewdrop.example', sourceUrl: 'https://dewdrop.example/team' });
  await assert.rejects(add(env, rahul, { kind: 'lead', ref: lead.id }), code('PIPELINE_TRIGGER_REQUIRED'), 'her lead, not his');
  const lost = await move(env, lead.id, 'lost', { reason: 'timing' });
  assert.equal(cardById(env, lost.card.id).personId, asha.id, 'the lead\'s email is hers');
  days(env, 30);
  const fresh = await add(env, asha, { kind: 'lead', ref: lead.id });
  assert.notEqual(fresh.card.id, lost.card.id);
  assert.deepEqual([fresh.card.stage, fresh.card.trigger], ['found', 'Found on dewdrop.example/team']);
  assert.equal(cardById(env, fresh.card.id).linkedFrom, lost.card.id);
  assert.equal(cardById(env, lost.card.id).stage, 'lost');
});

test('a lead whose email is someone who already has a card joins that card; the board shows them once', async () => {
  const env = await setup();
  const deps = leadDeps(env);
  const { asha } = await withPeople(env);
  const { card } = await add(env, asha);
  await leadCall<LeadView>(deps, 'venture.leads.add', { name: 'A Rao', email: 'asha@dewdrop.example', sourceUrl: 'https://dewdrop.example/team' });
  const shown = allCards(await board(env));
  assert.deepEqual(shown.map(item => [item.id, item.name]), [[card.id, 'Asha Rao']]);
});
