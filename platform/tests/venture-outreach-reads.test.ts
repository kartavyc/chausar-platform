// Ink v2 wave 4, package 4E4 (integrator's follow-up): what the screens read again after a reload. A pipeline card
// names its waiting draft by id and channel, the person sheet lists the drafts to them or on their cards, and the
// network's sources carry the read-only mailbox's and the calendar address's state, never the app password or the
// address itself (the engine keeps both in memory only). The hosted app reads neither.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarFeedRecord, MailboxRecord, NetworkSourcesView, OpportunityRecord, OutreachRecord, PersonView, PipelineCardView, PriceReceiptRecord, VentureDeps } from '../runtime/venture/contracts.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { net, personNamed } from './venture-network-env.ts';
import { add, allCards, board, leadCall, leadDeps, seedDraft, withPeople } from './venture-pipeline-env.ts';
import { owner, seedBlueprint, seedOrder, setup, type Env } from './venture-views-env.ts';

const PASSWORD = 'abcd efgh ijkl mnop';
const ADDRESS = 'https://calendar.google.com/calendar/ical/owner/private-abc123/basic.ics';

test('a card names its waiting draft by id and channel, and the person sheet lists their drafts, newest first', async () => {
  const env = await setup();
  const { asha } = await withPeople(env);
  const card = (await add(env, asha)).card;
  assert.equal(card.draftId, null);
  assert.equal(card.draftChannel, null);
  const first = await seedDraft(env, { id: card.id, personId: asha.id }, 'follow-up', 'email');
  env.advance(60_000);
  const second = await seedDraft(env, { id: card.id, personId: asha.id }, 'follow-up', 'whatsapp');

  const listed = allCards(await board(env)).find(item => item.id === card.id)!;
  assert.equal(listed.draftId, second.id, 'the newest waiting draft, the one the draft line names');
  assert.equal(listed.draftChannel, 'whatsapp');
  assert.equal(listed.draft, 'Follow-up drafted, for WhatsApp');

  const sheet = await net<PersonView>(env, 'venture.network.person', { id: asha.id });
  assert.deepEqual(sheet.drafts.map(item => item.id), [second.id, first.id]);
  assert.equal(sheet.drafts[0].channel, 'whatsapp');
  assert.equal(sheet.card?.draftId, second.id);
});

test('the sources carry the mailbox and the calendar address state, never the password or the address', async () => {
  const env = await setup();
  const empty = await net<NetworkSourcesView>(env, 'venture.network.sources');
  assert.deepEqual(empty.mailbox, { connected: false, host: null, user: null, lastSync: null, line: 'Not connected. Chausar reads no mail.', needsPassword: false });
  assert.equal(empty.calendar?.set, false);
  assert.equal(empty.calendar?.line, 'No calendar address. Chausar reads no calendar.');

  // A mailbox and a calendar address as their methods keep them: the record, and the secret on the in-memory shelf.
  const synced = new Date(Date.parse(env.deps.clock().toISOString()) - 3_600_000).toISOString();
  await ventureAction(env.deps, owner, 'approve', 'test.reads', tx => {
    tx.put<MailboxRecord>({ ...tx.base('venture-mailbox'), host: 'imap.zoho.in', port: 993, user: 'owner@lumen.example', status: 'connected', uidValidity: null, cursor: null, lastSync: synced, line: 'Read.' });
    tx.put<CalendarFeedRecord>({ ...tx.base('venture-calendar-feed'), host: 'calendar.google.com', status: 'set', lastRead: synced, digest: null, line: 'Read this morning: 1 call with people you know lately or today.', events: [] });
  });
  env.deps.secrets.set('mailbox:password', PASSWORD);
  env.deps.secrets.set('network:calendar', ADDRESS);
  const view = await net<NetworkSourcesView>(env, 'venture.network.sources');
  assert.equal(view.mailbox?.connected, true);
  assert.equal(view.mailbox?.lastSync, synced);
  assert.match(view.mailbox!.line, /^Reading owner@lumen\.example on imap\.zoho\.in, read-only\. Last read /);
  assert.equal(view.calendar?.set, true);
  assert.equal(view.calendar?.lastRead, synced);
  assert.ok(view.calendar?.nextRead && Date.parse(view.calendar.nextRead) >= Date.parse(env.deps.clock().toISOString()), 'the next morning read is still to come');
  const text = JSON.stringify(view);
  assert.ok(!text.includes(PASSWORD), 'the app password never leaves the shelf');
  assert.ok(!text.includes('private-abc123'), 'the calendar address never leaves the shelf');

  // After a restart the shelf is empty: the views say to type the password and paste the address again.
  env.deps.secrets.delete('mailbox:password');
  env.deps.secrets.delete('network:calendar');
  const again = await net<NetworkSourcesView>(env, 'venture.network.sources');
  assert.equal(again.mailbox?.line, 'Chausar keeps your app password only while the app is open. Type it again under Connections to read new mail.');
  assert.equal(again.calendar?.nextRead, null);
  assert.match(again.calendar!.line, /Set it again under Connections/);
});

test('the hosted app reads no mailbox and no calendar, so the sources carry neither', async () => {
  const env = await setup();
  env.deps.host = 'hosted-web';
  const view = await net<NetworkSourcesView>(env, 'venture.network.sources');
  assert.equal(view.mailbox, null);
  assert.equal(view.calendar, null);
});

// --- The 4E4 review: what the board, the draft form and the mailbox card read from the engine ---

const pipelineMove = (env: Env, id: string, stage: string, extra: Record<string, unknown> = {}) =>
  net<{ card: PipelineCardView; line: string }>(env, 'venture.pipeline.move', { id, stage, ...extra });
const moneyCall = <T>(env: Env, method: string, payload: unknown) =>
  ((money as Record<string, (deps: VentureDeps, ctx: typeof owner, payload: unknown) => Promise<unknown>>)[method])(env.deps, owner, payload) as Promise<T>;
const choice = (card: PipelineCardView, kind: string, channel: string) => card.outreach!.find(item => item.kind === kind && item.channel === channel)!;

test('a card says, per kind and channel, whether a draft is cold and still needs its lawful basis', async () => {
  const env = await setup();
  const { asha, rahul } = await withPeople(env);
  const card = (await add(env, rahul)).card;
  assert.equal(card.basis, null);
  assert.ok(card.outreach!.every(item => (item.kind !== 'connection-note' || item.channel === 'linkedin') && (item.kind !== 'cold-email' || item.channel === 'email')));
  // Rahul is someone the owner does not know well: an email to him is cold and needs its basis; WhatsApp and LinkedIn are not email.
  assert.deepEqual(choice(card, 'follow-up', 'email'), { kind: 'follow-up', channel: 'email', cold: true, needsBasis: true });
  assert.equal(choice(card, 'follow-up', 'whatsapp').cold, false);
  assert.equal(choice(card, 'cold-email', 'email').needsBasis, true);

  // A basis kept on the card answers for its own person.
  await ventureAction(env.deps, owner, 'prepare', 'test.basis', tx => {
    const stored = tx.find('venture-opportunity', card.id)!;
    tx.replace<OpportunityRecord>({ ...stored, basis: 'existing-contact' });
  });
  const kept = allCards(await board(env)).find(item => item.id === card.id)!;
  assert.equal(kept.basis, 'existing-contact');
  assert.deepEqual(choice(kept, 'follow-up', 'email'), { kind: 'follow-up', channel: 'email', cold: true, needsBasis: false });

  // Known well, a note to her by email is warm: no footer, no basis.
  await net(env, 'venture.network.know', { personId: asha.id, how: 'well' });
  const warm = (await add(env, asha)).card;
  assert.deepEqual(choice(warm, 'follow-up', 'email'), { kind: 'follow-up', channel: 'email', cold: false, needsBasis: false });
  assert.equal(choice(warm, 'cold-email', 'email').cold, true, 'a cold email is cold whoever it goes to');
});

test('an intro request takes its tie from the connector, and a blocked connector is skipped as the draft skips it', async () => {
  const env = await setup();
  const { asha, rahul } = await withPeople(env);
  await net(env, 'venture.network.link', { a: asha.id, b: rahul.id, note: 'They met at the spice market' });
  await net(env, 'venture.network.know', { personId: asha.id, how: 'well' });
  const card = (await add(env, rahul)).card;
  // Rahul is cold to the owner, but an intro goes to Asha, whom the owner knows well: warm by mail. A follow-up goes to Rahul: cold.
  assert.deepEqual(choice(card, 'intro-request', 'email'), { kind: 'intro-request', channel: 'email', cold: false, needsBasis: false });
  assert.deepEqual(choice(card, 'follow-up', 'email'), { kind: 'follow-up', channel: 'email', cold: true, needsBasis: true });

  // Asha's domain on the blocklist: the draft would not go through her, so the choice no longer leans on her tie.
  await leadCall(leadDeps(env), 'venture.leads.block', { value: 'dewdrop.example' });
  const after = allCards(await board(env)).find(item => item.id === card.id)!;
  assert.deepEqual(choice(after, 'intro-request', 'email'), { kind: 'intro-request', channel: 'email', cold: true, needsBasis: true });
});

test('a Proposal card shows the quote it rests on with its receipt; a Won card names its client', async () => {
  const env = await setup();
  const { asha, rahul } = await withPeople(env);
  const { card } = await add(env, asha);
  await seedBlueprint(env);
  const quote = await moneyCall<PriceReceiptRecord>(env, 'venture.price.quote', { offerId: 'offer_1' });
  const proposal = await pipelineMove(env, card.id, 'proposal', { evidence: { kind: 'quote', id: quote.id } });
  assert.deepEqual(proposal.card.quote, { value: 'INR 2,499.00', receiptId: quote.id });
  assert.equal(proposal.card.client, null);
  const byNote = await pipelineMove(env, (await add(env, rahul)).card.id, 'proposal', { evidence: { kind: 'note', text: 'Sent the price list' } });
  assert.equal(byNote.card.quote, null, 'a note carries no amount');
  const won = await pipelineMove(env, card.id, 'won');
  assert.equal(won.card.quote, null);
  assert.equal(won.card.client?.name, 'Asha Rao');
  assert.match(won.card.client!.line, /^Now a client since \d+ [A-Z][a-z]{2}\.$/);
});

test('the board lists the quotes the business made, newest first, for a Proposal move to rest on', async () => {
  const env = await setup();
  await withPeople(env);
  assert.deepEqual((await board(env)).quotes, [], 'no quote yet');
  await seedBlueprint(env);
  const one = await moneyCall<PriceReceiptRecord>(env, 'venture.price.quote', { offerId: 'offer_1' });
  env.advance(60_000);
  const two = await moneyCall<PriceReceiptRecord>(env, 'venture.price.quote', { offerId: 'offer_1', quantity: '2' });
  const quotes = (await board(env)).quotes;
  assert.deepEqual(quotes.map(item => [item.receiptId, item.offer, item.quantity, item.value]), [
    [two.id, 'Monthly books', '2', 'INR 4,998.00'],
    [one.id, 'Monthly books', '1', 'INR 2,499.00'],
  ]);
  assert.equal(quotes[0].at, two.at);
  // Each one is evidence a Proposal move takes as it is.
  const { card } = await add(env, personNamed(env, 'Asha Rao'));
  const moved = await pipelineMove(env, card.id, 'proposal', { evidence: { kind: 'quote', id: quotes[0].receiptId } });
  assert.deepEqual(moved.card.quote, { value: 'INR 4,998.00', receiptId: two.id });
});

test('a Proposal move takes only a quote: an order\'s or an invoice\'s price receipt is refused', async () => {
  const env = await setup();
  await withPeople(env);
  const blueprint = await seedBlueprint(env);
  const { receipt } = await seedOrder(env, blueprint);
  assert.equal(receipt.subject.type, 'order');
  const { card } = await add(env, personNamed(env, 'Asha Rao'));
  await assert.rejects(pipelineMove(env, card.id, 'proposal', { evidence: { kind: 'quote', id: receipt.id } }), (error: any) => {
    assert.equal(error.code, 'PIPELINE_NOT_A_QUOTE');
    assert.equal(error.message, 'That receipt is for an order or an invoice, not a quote. Choose a quote you made, or note what you offered.');
    return true;
  });
  assert.equal(allCards(await board(env)).find(item => item.id === card.id)!.stage, 'found', 'the card stays where it was');
});

test('How people moved gives each stage its bar against the largest, and the share that moved on in words', async () => {
  const env = await setup();
  const { asha, rahul } = await withPeople(env);
  await add(env, asha);
  const second = await add(env, rahul);
  await pipelineMove(env, second.card.id, 'asked', { evidence: { kind: 'note', on: env.now().slice(0, 10) } });
  const funnel = (await board(env)).funnel;
  const found = funnel.find(item => item.stage === 'found')!;
  const asked = funnel.find(item => item.stage === 'asked')!;
  assert.equal(found.reached, 2);
  assert.equal(found.reachedPermille, 1000);
  assert.equal(found.movedOnPermille, 500);
  assert.equal(found.share, '50%');
  assert.equal(asked.reachedPermille, 500);
  assert.equal(funnel.find(item => item.stage === 'won')!.share, null);
});

test('a draft says how many sentences its forwardable note has', async () => {
  const env = await setup();
  const { asha } = await withPeople(env);
  const { card } = await add(env, asha);
  const draft = await seedDraft(env, { id: card.id, personId: asha.id }, 'intro-request', 'email');
  await ventureAction(env.deps, owner, 'prepare', 'test.blurb', tx => { tx.replace<OutreachRecord>({ ...tx.find('venture-outreach', draft.id)!, blurb: 'She runs a studio. She would like to talk! Is that fine?' }); });
  const sheet = await net<PersonView>(env, 'venture.network.person', { id: asha.id });
  assert.equal(sheet.drafts.find(item => item.id === draft.id)!.blurbSentences, 3);
  const other = await seedDraft(env, { id: card.id, personId: asha.id }, 'follow-up', 'email');
  assert.equal((await net<PersonView>(env, 'venture.network.person', { id: asha.id })).drafts.find(item => item.id === other.id)!.blurbSentences, null);
});

test('a connected mailbox whose password left the shelf says it needs the password again', async () => {
  const env = await setup();
  await ventureAction(env.deps, owner, 'approve', 'test.mailbox', tx => {
    tx.put<MailboxRecord>({ ...tx.base('venture-mailbox'), host: 'imap.zoho.in', port: 993, user: 'owner@lumen.example', status: 'connected', uidValidity: null, cursor: null, lastSync: null, line: 'Read.' });
  });
  assert.equal((await net<NetworkSourcesView>(env, 'venture.network.sources')).mailbox?.needsPassword, true);
  env.deps.secrets.set('mailbox:password', PASSWORD);
  assert.equal((await net<NetworkSourcesView>(env, 'venture.network.sources')).mailbox?.needsPassword, false);
  await ventureAction(env.deps, owner, 'approve', 'test.mailbox', tx => { tx.replace<MailboxRecord>({ ...tx.list('venture-mailbox')[0]!, status: 'disconnected' }); });
  assert.equal((await net<NetworkSourcesView>(env, 'venture.network.sources')).mailbox?.needsPassword, false);
});
