// Ink v2 wave 4, package 4E2: the send governor for owner-account outreach (catalogue C14). Daily caps per channel the
// owner may lower but never raise (LinkedIn notes 10 a day and 50 a week, LinkedIn messages 20, WhatsApp 20, email 30); a
// warm-up from the first recorded send (25, 40, 60, 80, then 100 percent over five weeks); the owner's sending days; and a
// restricted account, which pauses its channel for 72 hours with a Today notice. Every recorded "I sent it" counts, so
// the owner is warned before sending more by hand. Chausar sends nothing; it only opens the owner's own app, or refuses to.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { OutreachRecord, OutreachView, PipelineSettingsView } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { channelHold } from '../runtime/venture/build/posting.ts';
import { HOUSE_CAPS, WARMUP_PERCENT, laneLimits, laneOf, laneSends, warmupPercent } from '../runtime/venture/network/governor.ts';
import { net, personNamed } from './venture-network-env.ts';
import { add, pipe, queue, withPeople } from './venture-pipeline-env.ts';
import { code, owner, phone, setup, type Env } from './venture-views-env.ts';

type Drafted = { draft: OutreachView; line: string };
const draft = (env: Env, payload: Record<string, unknown>) => net<Drafted>(env, 'venture.outreach.draft', payload);
const open = (env: Env, draftId: string) => net<any>(env, 'venture.outreach.open', { draftId });
const sent = (env: Env, draftId: string, channel: string) => net<{ line: string }>(env, 'venture.outreach.sent', { draftId, at: env.now(), channel });
const know = (env: Env, personId: string) => net(env, 'venture.network.know', { personId, how: 'well' });

/** n sends the owner recorded on one day, on LinkedIn as connection notes or on another channel, as 4E2 stores them. */
async function seedSends(env: Env, day: string, n: number, kind: OutreachRecord['outreachKind'] = 'connection-note', channel: OutreachRecord['channel'] = 'linkedin'): Promise<void> {
  const sentChannel = channel === 'email' ? 'own-mailbox' : channel;
  await ventureAction(env.deps, owner, 'prepare', 'test.sends', tx => {
    for (let i = 0; i < n; i += 1) {
      tx.put<OutreachRecord>({
        ...tx.base('venture-outreach'), opportunityId: null, invoiceId: null, personId: null, outreachKind: kind, channel, to: null, subject: null, text: 'A note.',
        blurb: null, footer: null, sourceUrl: null, basis: null, lints: [], by: 'agent', callId: null, digest: 'd'.repeat(64), acceptedOn: null,
        sent: { at: `${day}T06:00:00.000Z`, channel: sentChannel, recordedAt: `${day}T06:00:00.000Z`, recordedBy: 'owner' },
      });
    }
  });
}

test('the warm-up rises 25, 40, 60, 80, then 100 percent of each cap over five weeks from the first recorded send', () => {
  assert.deepEqual([...WARMUP_PERCENT], [25, 40, 60, 80, 100]);
  assert.deepEqual(HOUSE_CAPS, { 'linkedin-note': { day: 10, week: 50 }, 'linkedin-message': { day: 20, week: null }, whatsapp: { day: 20, week: null }, email: { day: 30, week: null } });
  assert.equal(warmupPercent(null, '2026-10-15'), 25, 'before any send');
  const percents = [0, 6, 7, 13, 14, 21, 27, 28, 400].map(n => warmupPercent('2026-10-01', new Date(Date.parse('2026-10-01') + n * 86_400_000).toISOString().slice(0, 10)));
  assert.deepEqual(percents, [25, 25, 40, 40, 60, 80, 80, 100, 100]);
  assert.equal(laneOf('connection-note', 'linkedin'), 'linkedin-note');
  assert.equal(laneOf('follow-up', 'linkedin'), 'linkedin-message');
  assert.equal(laneOf(null, 'own-mailbox'), 'email');
  assert.equal(laneOf('reply', 'whatsapp'), 'whatsapp');
  assert.equal(laneOf('follow-up', 'phone'), null, 'a call is not governed');
});

test('opening past the day cap is refused in plain words; during the warm-up the cap is its share', async () => {
  const env = await setup();
  await withPeople(env);
  const people = ['Asha Rao', 'Rahul Mehta', 'Farhan Ali'].map(name => personNamed(env, name));
  const drafts: string[] = [];
  for (const person of people) {
    const card = (await add(env, person)).card;
    drafts.push((await draft(env, { opportunityId: card.id, kind: 'connection-note', channel: 'linkedin' })).draft.id);
  }
  const limits = laneLimits(env.store.read(), env.venture, 'linkedin-note', '2026-10-15');
  assert.deepEqual(limits, { day: 2, week: 12, percent: 25, house: { day: 10, week: 50 }, owner: null });
  for (const id of drafts.slice(0, 2)) {
    assert.equal((await open(env, id)).action, 'linkedin');
    await sent(env, id, 'linkedin');
  }
  await assert.rejects(open(env, drafts[2]), (error: any) => {
    assert.equal(error.code, 'OUTREACH_DAILY_CAP');
    assert.equal(error.message, "You've sent 2 LinkedIn notes today, your limit while this account warms up (25 percent of 10 a day in its first week). Chausar opens LinkedIn again tomorrow.");
    return true;
  });
  env.advance(86_400_000);
  assert.equal((await open(env, drafts[2])).action, 'linkedin', 'a new day');
});

test('after the warm-up the full caps hold: 10 LinkedIn notes a day and 50 a week', async () => {
  const env = await setup();
  await withPeople(env);
  const card = (await add(env, personNamed(env, 'Asha Rao'))).card;
  const note = (await draft(env, { opportunityId: card.id, kind: 'connection-note', channel: 'linkedin' })).draft.id;
  await seedSends(env, '2026-09-01', 1);
  await seedSends(env, '2026-10-15', 10);
  await assert.rejects(open(env, note), (error: any) =>
    error.code === 'OUTREACH_DAILY_CAP' && error.message === "You've sent 10 LinkedIn notes today, your limit. Chausar opens LinkedIn again tomorrow.");
  env.advance(86_400_000); // Friday 16 Oct: 10 on Thursday, and 40 more seeded on Monday to Wednesday make 50 this week
  await seedSends(env, '2026-10-12', 14);
  await seedSends(env, '2026-10-13', 13);
  await seedSends(env, '2026-10-14', 13);
  await assert.rejects(open(env, note), (error: any) =>
    error.code === 'OUTREACH_DAILY_CAP' && error.message === "You've sent 50 LinkedIn notes this week, your limit. Chausar opens LinkedIn again on Monday.");
  // A LinkedIn message is its own cap: 20 a day.
  assert.equal(laneLimits(env.store.read(), env.venture, 'linkedin-message', '2026-10-16').day, 5, 'no LinkedIn message was sent yet, so it starts warming up');
});

test('you may lower a channel cap, never raise it; the lower cap warms up too', async () => {
  const env = await setup();
  await withPeople(env);
  const asha = personNamed(env, 'Asha Rao');
  await know(env, asha.id);
  const settings = await pipe<PipelineSettingsView>(env, 'venture.pipeline.settings', { caps: { channels: { email: 4 } } });
  assert.deepEqual(settings.caps.channels, { email: 4 });
  await assert.rejects(pipe(env, 'venture.pipeline.settings', { caps: { channels: { email: 31 } } }), (error: any) =>
    error.code === 'INVALID_VENTURE_REQUEST' && error.message === "Chausar's own limit for emails is 30 a day. You can only make it lower.");
  await assert.rejects(pipe(env, 'venture.pipeline.settings', { caps: { channels: { fax: 3 } } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(pipe(env, 'venture.pipeline.settings', { caps: { channels: { email: 0 } } }), code('INVALID_VENTURE_REQUEST'));
  assert.deepEqual(laneLimits(env.store.read(), env.venture, 'email', '2026-10-15'), { day: 1, week: null, percent: 25, house: { day: 30, week: null }, owner: 4 });
  const card = (await add(env, asha)).card;
  const first = (await draft(env, { opportunityId: card.id, kind: 'follow-up', channel: 'email' })).draft.id;
  const second = (await draft(env, { opportunityId: card.id, kind: 'follow-up', channel: 'email' })).draft.id;
  await open(env, first);
  await sent(env, first, 'own-mailbox');
  await assert.rejects(open(env, second), (error: any) => error.code === 'OUTREACH_DAILY_CAP' && /^You've sent 1 email today, your limit while this account warms up/.test(error.message));
  // The pipeline's other settings are kept when only the channel caps change.
  assert.deepEqual((await pipe<PipelineSettingsView>(env, 'venture.pipeline.settings', {})).caps, { newPerDay: 10, perWeek: 40, channels: { email: 4 } });
});

test('a send past the cap is still recorded, because you sent it, and the line says so', async () => {
  const env = await setup();
  await withPeople(env);
  const ids: string[] = [];
  for (const name of ['Asha Rao', 'Rahul Mehta', 'Farhan Ali']) {
    const card = (await add(env, personNamed(env, name))).card;
    ids.push((await draft(env, { opportunityId: card.id, kind: 'connection-note', channel: 'linkedin' })).draft.id);
  }
  assert.equal((await sent(env, ids[0], 'linkedin')).line, 'Recorded. Next follow-up 19 Oct.');
  assert.equal((await sent(env, ids[1], 'linkedin')).line, 'Recorded. Next follow-up 19 Oct. That reaches your limit of 2 LinkedIn notes for today.');
  assert.equal((await sent(env, ids[2], 'linkedin')).line, 'Recorded. Next follow-up 19 Oct. That makes 3 LinkedIn notes today, over your limit of 2.');
});

test('your sending days: first notes and follow-ups open on them only; a reply opens any day', async () => {
  const env = await setup();
  await withPeople(env);
  const asha = personNamed(env, 'Asha Rao');
  await know(env, asha.id);
  const card = (await add(env, asha)).card;
  const nudge = (await draft(env, { opportunityId: card.id, kind: 'follow-up', channel: 'linkedin' })).draft.id;
  const reply = (await draft(env, { opportunityId: card.id, kind: 'reply', channel: 'linkedin', basis: 'they-wrote-first' })).draft.id;
  env.advance(2 * 86_400_000); // Saturday 17 Oct
  await assert.rejects(open(env, nudge), (error: any) =>
    error.code === 'OUTREACH_DAILY_CAP' && error.message === 'Today is not one of your sending days. Chausar opens LinkedIn for this again on 19 Oct.');
  assert.equal((await open(env, reply)).action, 'linkedin');
});

test('"I sent it" takes the draft\'s own channel or a call, and a call still counts in the draft\'s lane', async () => {
  const env = await setup();
  await withPeople(env);
  const asha = personNamed(env, 'Asha Rao');
  await know(env, asha.id);
  const card = (await add(env, asha)).card;
  const first = (await draft(env, { opportunityId: card.id, kind: 'follow-up', channel: 'email' })).draft.id;
  await assert.rejects(sent(env, first, 'linkedin'), (error: any) =>
    error.code === 'INVALID_VENTURE_REQUEST' && error.message === 'This draft goes from your own mailbox. Mark it sent from there, or by phone if you called instead.');
  await sent(env, first, 'phone');
  assert.deepEqual(laneSends(env.store.read(), env.venture, '2026-10-15').map(send => send.lane), ['email'], 'a call marked on an email draft counts as an email');
  // Someone you are not connected with on LinkedIn: any LinkedIn draft to them counts as a connection note.
  const notConnected = await ventureAction(env.deps, owner, 'prepare', 'test.sends', tx => tx.put<OutreachRecord>({
    ...tx.base('venture-outreach'), opportunityId: null, invoiceId: null, personId: 'person_not_connected', outreachKind: 'follow-up', channel: 'linkedin', to: null, subject: null,
    text: 'A note.', blurb: null, footer: null, sourceUrl: null, basis: null, lints: [], by: 'agent', callId: null, digest: 'd'.repeat(64), acceptedOn: null,
    sent: { at: '2026-10-15T06:00:00.000Z', channel: 'linkedin', recordedAt: '2026-10-15T06:00:00.000Z', recordedBy: 'owner' },
  }));
  assert.equal(laneSends(env.store.read(), env.venture, '2026-10-15').find(send => send.id === notConnected.id)?.lane, 'linkedin-note');
});

test('reminders open past the caps and on any day, and still count toward the caps of other mail', async () => {
  const env = await setup();
  await withPeople(env);
  const asha = personNamed(env, 'Asha Rao');
  await know(env, asha.id);
  const card = (await add(env, asha)).card;
  const followUp = (await draft(env, { opportunityId: card.id, kind: 'follow-up', channel: 'email' })).draft.id;
  const reminder = async () => ventureAction(env.deps, owner, 'prepare', 'test.reminder', tx => tx.put<OutreachRecord>({
    ...tx.base('venture-outreach'), opportunityId: null, invoiceId: 'invoice_seed', personId: null, outreachKind: 'reminder', channel: 'email', to: 'owner@aroma.example',
    subject: 'Payment reminder: INV-0001', text: 'Hello, a reminder.', blurb: null, footer: null, sourceUrl: null, basis: 'existing-contact', lints: [], by: 'owner',
    callId: null, digest: 'e'.repeat(64), sent: null, acceptedOn: null,
  }));
  await seedSends(env, '2026-10-15', 6, 'follow-up', 'email');
  const one = await reminder();
  await sent(env, one.id, 'own-mailbox'); // the seventh mail today: the warm-up cap of 7
  await assert.rejects(open(env, followUp), code('OUTREACH_DAILY_CAP'), 'the reminder counted');
  const two = await reminder();
  assert.equal((await open(env, two.id)).action, 'mailto', 'a reminder is not held by the cap');
  assert.equal((await sent(env, two.id, 'own-mailbox')).line, 'Recorded.', 'and gets no limit line');
});

test('mail to an address a delivery report held (4E3) waits until the hold ends', async () => {
  const env = await setup();
  await withPeople(env);
  const asha = personNamed(env, 'Asha Rao');
  await know(env, asha.id);
  const card = (await add(env, asha)).card;
  const mail = (await draft(env, { opportunityId: card.id, kind: 'follow-up', channel: 'email' })).draft.id;
  await ventureAction(env.deps, owner, 'admin', 'test.bounce', tx => tx.put({
    ...tx.base('venture-inbound'), messageId: '<b1@mx>', from: 'mailer-daemon@dewdrop.example', to: ['owner@ledger.example'], date: env.now(), subject: 'Delayed',
    references: [], matched: null, triage: 'bounce', line: 'Delivery delayed.', processed: true, screen: null,
    bounces: [{ address: 'asha@dewdrop.example', status: '4.2.2', scope: 'suppress', until: '2027-01-13' }],
  } as any));
  await assert.rejects(open(env, mail), (error: any) =>
    error.code === 'OUTREACH_BLOCKED' && error.message === 'Mail to asha@dewdrop.example came back undelivered, so Chausar holds mail to it until 13 Jan 2027.');
});

test('a restricted account pauses that channel for 72 hours with a Today notice; LinkedIn posting holds too', async () => {
  const env = await setup();
  await withPeople(env);
  const asha = personNamed(env, 'Asha Rao');
  const card = (await add(env, asha)).card;
  const note = (await draft(env, { opportunityId: card.id, kind: 'connection-note', channel: 'linkedin' })).draft.id;
  await assert.rejects(net(env, 'venture.outreach.restricted', { channel: 'linkedin' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(net(env, 'venture.outreach.restricted', { channel: 'fax' }), code('INVALID_VENTURE_REQUEST'));
  const paused = await net<{ channel: string; until: string; line: string }>(env, 'venture.outreach.restricted', { channel: 'linkedin' });
  assert.equal(paused.channel, 'linkedin');
  assert.equal(paused.until, new Date(Date.parse(env.now()) + 72 * 3_600_000).toISOString());
  assert.equal(paused.line, "You said LinkedIn restricted your account. Don't reconnect for 3 days. Chausar opens LinkedIn again on 18 Oct 2026.");
  await assert.rejects(open(env, note), (error: any) => error.code === 'CHANNEL_FROZEN' && error.message === paused.line);
  const notice = (await queue(env)).rows.find(row => row.kind === 'notice')!;
  assert.equal(notice.title, 'LinkedIn is paused');
  assert.match(notice.line!, /Don't reconnect for 3 days\./);
  assert.deepEqual(notice.actions.map(item => item.id), ['open', 'later']);
  assert.equal(channelHold(env.store.read(), 'linkedin', env.now())?.cause, 'blocked', 'LinkedIn posting is held as well');
  env.advance(4 * 86_400_000); // Monday 19 Oct, past the 72 hours and a sending day
  assert.equal((await open(env, note)).action, 'linkedin');
  assert.equal((await queue(env)).rows.filter(row => row.kind === 'notice').length, 0);
  assert.equal(listRecords(env.store.read(), 'venture-channel-hold').length, 1);
});
