// Package 4E1 (Ink v2 wave 4): follow-ups by date arithmetic in code (catalogue C7). An intro request is due 7 days
// after the recorded send, with one follow-up only; a first email 5 days, then 7; a WhatsApp or LinkedIn message 4 days,
// then 10; each wait counts from the touch before it, and a due day the owner does not send on moves to the next one
// they do. Two follow-ups, then the card parks as Not now with "Ask again from" 30 days on. A recorded reply stops the
// sequence; threads age Alive, Cooling, Presumed dead. The sequence is copied onto the card when it starts. One daily
// and weekly ceiling covers first notes and follow-ups together. Due follow-ups are Today rows with the handoff as the
// primary and "I sent it", once per card and due date. The owner's settings are approve-level and app only.
import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  CardTouch, FollowupsView, InboundRecord, LeadRecord, LeadView, OpportunityRecord, OutreachDraftView, PipelineSettingsView, QueueDecision, QueueRow,
} from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import {
  addDays, followupPlan, isoWeekday, MIN_TOUCH_GAP_DAYS, nextAllowedDay, SEQUENCE_STEPS, settledPark, threadAge,
} from '../runtime/venture/network/followups.ts';
import { call, code, owner, phone, setup, type Env } from './venture-views-env.ts';
import {
  add, allCards, board, cardById, cards, days, followupRowsOf, leadCall, leadDeps, manyPeople, pipe, recordSent, seedDraft, withPeople,
} from './venture-pipeline-env.ts';

const decide = (env: Env, row: QueueRow, action: string) => call<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action });
const followups = (env: Env) => pipe<FollowupsView>(env, 'venture.pipeline.followups', {});
const settings = (env: Env, payload: Record<string, unknown>, ctx = owner) => pipe<PipelineSettingsView>(env, 'venture.pipeline.settings', payload, ctx);
const WEEK = [1, 2, 3, 4, 5];

test('the date arithmetic: weekdays, the next sending day, and the fixed waits', () => {
  assert.equal(isoWeekday('2026-10-15'), 4, 'a Thursday');
  assert.equal(isoWeekday('2026-10-18'), 7, 'a Sunday');
  assert.equal(addDays('2026-10-29', 4), '2026-11-02');
  assert.equal(nextAllowedDay('2026-10-17', WEEK), '2026-10-19', 'Saturday moves to Monday');
  assert.equal(nextAllowedDay('2026-10-20', [1, 3, 5]), '2026-10-21', 'Tuesday moves to Wednesday');
  assert.equal(nextAllowedDay('2026-10-21', [1, 3, 5]), '2026-10-21');
  assert.deepEqual(SEQUENCE_STEPS, { 'intro-request': [7], 'first-email': [5, 7], message: [4, 10] });
  // At least 7 days between touches to one person, after the first follow-up: every later wait keeps it.
  for (const steps of Object.values(SEQUENCE_STEPS)) for (const wait of steps.slice(1)) assert.ok(wait >= MIN_TOUCH_GAP_DAYS);
});

const sequence = (kind: 'intro-request' | 'first-email' | 'message', weekdays = WEEK) => ({
  kind, steps: SEQUENCE_STEPS[kind].map(afterDays => ({ afterDays, channel: kind === 'message' ? 'whatsapp' as const : 'email' as const })),
  weekdays, sendTime: '09:30', copiedAt: '2026-10-01T00:00:00.000Z',
});
const sent = (on: string, kind: 'first' | 'nudge' = 'first'): CardTouch => ({ what: 'sent', on, at: `${on}T05:00:00.000Z`, kind, channel: null, ref: null, by: 'owner' });

test('followupPlan: an intro request once after 7 days, then "Try another path"; an email after 5 then 7; a message after 4 then 10; then it parks', () => {
  const plan = (kind: 'intro-request' | 'first-email' | 'message', touches: CardTouch[], weekdays = WEEK) =>
    followupPlan({ stage: 'asked', sequence: sequence(kind, weekdays), touches, blocked: false });
  assert.deepEqual(plan('intro-request', [sent('2026-10-15')]), { kind: 'nudge', step: 0, due: '2026-10-22', channel: 'email' });
  assert.deepEqual(plan('intro-request', [sent('2026-10-15'), sent('2026-10-22', 'nudge')]), { kind: 'other-path', due: '2026-10-29' });
  assert.deepEqual(plan('first-email', [sent('2026-10-15')]), { kind: 'nudge', step: 0, due: '2026-10-20', channel: 'email' });
  assert.deepEqual(plan('first-email', [sent('2026-10-15')], [1, 3, 5]), { kind: 'nudge', step: 0, due: '2026-10-21', channel: 'email' }, 'Tuesday is not a sending day');
  assert.deepEqual(plan('first-email', [sent('2026-10-15'), sent('2026-10-20', 'nudge')]), { kind: 'nudge', step: 1, due: '2026-10-27', channel: 'email' });
  assert.deepEqual(plan('first-email', [sent('2026-10-15'), sent('2026-10-20', 'nudge'), sent('2026-10-27', 'nudge')]), { kind: 'park', on: '2026-11-03', askAgainFrom: '2026-12-03' });
  assert.deepEqual(plan('message', [sent('2026-10-13')]), { kind: 'nudge', step: 0, due: '2026-10-19', channel: 'whatsapp' }, 'Saturday moves to Monday');
  assert.deepEqual(plan('message', [sent('2026-10-13'), sent('2026-10-21', 'nudge')]), { kind: 'nudge', step: 1, due: '2026-11-02', channel: 'whatsapp' });
  // A reply after the first send stops it; so do a later stage, the blocklist and a card with no send yet.
  const replied: CardTouch[] = [sent('2026-10-15'), { ...sent('2026-10-16'), what: 'reply', kind: null }];
  assert.equal(plan('first-email', replied), null);
  assert.equal(followupPlan({ stage: 'talking', sequence: sequence('first-email'), touches: [sent('2026-10-15')], blocked: false }), null);
  assert.equal(followupPlan({ stage: 'asked', sequence: sequence('first-email'), touches: [sent('2026-10-15')], blocked: true }), null);
  assert.equal(followupPlan({ stage: 'asked', sequence: null, touches: [], blocked: false }), null);
});

test('threads age by days since they last wrote: Alive under 7, Cooling 7 to 21, Presumed dead after 21', () => {
  assert.deepEqual(threadAge('2026-10-15', '2026-10-15'), { age: 'alive', days: 0, line: 'Alive: they wrote today.' });
  assert.deepEqual(threadAge('2026-10-14', '2026-10-15'), { age: 'alive', days: 1, line: 'Alive: they wrote yesterday.' });
  assert.deepEqual(threadAge('2026-10-08', '2026-10-15'), { age: 'cooling', days: 7, line: 'Cooling: they wrote 7 days ago.' });
  assert.deepEqual(threadAge('2026-09-24', '2026-10-15'), { age: 'cooling', days: 21, line: 'Cooling: they wrote 21 days ago.' });
  assert.deepEqual(threadAge('2026-09-23', '2026-10-15'), { age: 'presumed-dead', days: 22, line: 'Presumed dead: they wrote 22 days ago.' });
});

test('Today: a late follow-up is a followup row with the handoff as the primary and "I sent it"; I sent it records the nudge', async () => {
  const env = await setup();
  const { farhan } = await withPeople(env);
  const { card } = await add(env, farhan);
  await recordSent(env, card.id, { on: '2026-10-13', channel: 'whatsapp' });
  assert.deepEqual(await followupRowsOf(env), [], 'due on Monday 19 Oct, not yet');
  days(env, 6); // Wednesday 21 Oct
  const draft = await seedDraft(env, card, 'follow-up', 'whatsapp');
  const [row] = await followupRowsOf(env);
  assert.equal(row.id, `followup:${card.id}:2026-10-19`);
  assert.deepEqual([row.title, row.line], ['Follow up with Farhan Ali', 'Farhan Ali, Ali Spices: follow-up is 2 days late. Nudge drafted for WhatsApp.']);
  assert.deepEqual(row.actions.map(item => [item.id, item.label, item.primary]), [['sent', 'I sent it', false], ['open', 'Open WhatsApp', true]]);
  const open = await decide(env, row, 'open');
  assert.deepEqual([open.outcome, open.line], ['refused', 'Open the nudge from Farhan Ali\'s card in Clients, Pipeline.']);
  const done = await decide(env, row, 'sent');
  assert.deepEqual([done.outcome, done.line], ['done', 'Recorded. Next follow-up 2 Nov.']);
  const stored = cardById(env, card.id);
  assert.deepEqual(stored.touches!.map(item => [item.what, item.on, item.kind, item.channel, item.ref]), [
    ['sent', '2026-10-13', 'first', 'whatsapp', null], ['sent', '2026-10-21', 'nudge', 'whatsapp', draft.id],
  ]);
  assert.equal(stored.nudges, 1);
  const [after] = listRecords(env.store.read(), 'venture-outreach');
  assert.deepEqual(after.sent, { at: env.now(), channel: 'whatsapp', recordedAt: env.now(), recordedBy: 'owner' }, 'the draft is marked sent; Chausar sent nothing');
  assert.deepEqual(await followupRowsOf(env), []);
});

test('a follow-up row comes once per card and due date; Later hides that one only; nothing shows on a day you do not send', async () => {
  const env = await setup();
  const { farhan } = await withPeople(env);
  const { card } = await add(env, farhan);
  await recordSent(env, card.id, { on: '2026-10-13', channel: 'whatsapp' });
  days(env, 6);
  const [row] = await followupRowsOf(env);
  assert.equal(row.line, 'Farhan Ali, Ali Spices: follow-up is 2 days late. No nudge drafted yet.');
  assert.deepEqual(row.actions.map(item => [item.id, item.label, item.primary]), [['sent', 'I sent it', false], ['open', 'Open the card', true]]);
  assert.equal((await decide(env, row, 'later')).outcome, 'done');
  days(env, 1);
  assert.deepEqual(await followupRowsOf(env), [], 'this due date was put off');
  days(env, 2); // Saturday 24 Oct
  assert.deepEqual(await followupRowsOf(env), []);
  const view = await followups(env);
  assert.deepEqual(view.due, []);
  assert.deepEqual(view.later.map(item => [item.cardId, item.due, item.late, item.line, item.channel]), [
    [card.id, '2026-10-19', true, 'Follow up 19 Oct, 5 days late. Today is not one of your sending days.', 'whatsapp'],
  ]);
  await recordSent(env, card.id, { on: '2026-10-24', channel: 'whatsapp' });
  days(env, 9); // Monday 2 Nov; the next follow-up is 10 days after the 24th, Tuesday 3 Nov
  assert.deepEqual(await followupRowsOf(env), []);
  days(env, 1);
  const [next] = await followupRowsOf(env);
  assert.equal(next.id, `followup:${card.id}:2026-11-03`, 'a new due date is a new row');
});

test('an intro request gets one follow-up, then the card says "Try another path, or Not now"; two nudges park an email as Not now', async () => {
  const env = await setup();
  const { asha, rahul } = await withPeople(env);
  const intro = await add(env, asha);
  await recordSent(env, intro.card.id, { on: '2026-10-08', channel: 'whatsapp', kind: 'intro-request' });
  const [row] = await followupRowsOf(env);
  const done = await decide(env, row, 'sent');
  assert.equal(done.line, 'Recorded. If there is no reply by 22 Oct, try another path, or Not now.');
  const card = allCards(await board(env)).find(item => item.id === intro.card.id)!;
  assert.deepEqual(card.next, { text: 'Try another path, or Not now', due: '2026-10-22', line: 'Try another path, or Not now, from 22 Oct', late: false });

  const email = await add(env, rahul);
  await recordSent(env, email.card.id, { on: '2026-10-01', channel: 'own-mailbox', kind: 'cold-email' });
  await recordSent(env, email.card.id, { on: '2026-10-06', channel: 'own-mailbox', kind: 'follow-up' });
  await recordSent(env, email.card.id, { on: '2026-10-13', channel: 'own-mailbox', kind: 'follow-up' });
  const waiting = allCards(await board(env)).find(item => item.id === email.card.id)!;
  assert.deepEqual([waiting.stage, waiting.next], ['asked', { text: 'Parks as Not now if there is no reply', due: '2026-10-20', line: 'Parks as Not now on 20 Oct if there is no reply', late: false }]);
  days(env, 5); // Tuesday 20 Oct
  assert.deepEqual(await followupRowsOf(env), [], 'no third nudge, and the intro request asks nothing more');
  const parked = allCards(await board(env)).find(item => item.id === email.card.id)!;
  assert.deepEqual([parked.stage, parked.next], ['not-now', { text: 'Ask again', due: '2026-11-19', line: 'Ask again from 19 Nov', late: false }]);
  await assert.rejects(add(env, rahul), code('PIPELINE_STAGE_CLOSED'));
  assert.equal(cardById(env, email.card.id).stage, 'asked', 'parking is worked out from the dates; the record changes on the next write');
});

test('a recorded reply stops the sequence, from the owner or from mail matched to the card', async () => {
  const env = await setup();
  const { asha, rahul } = await withPeople(env);
  const a = await add(env, asha);
  const r = await add(env, rahul);
  await recordSent(env, a.card.id, { on: '2026-10-08', channel: 'whatsapp', kind: 'intro-request' });
  await recordSent(env, r.card.id, { on: '2026-10-08', channel: 'whatsapp', kind: 'intro-request' });
  assert.equal((await followupRowsOf(env)).length, 2);
  await pipe(env, 'venture.pipeline.move', { id: a.card.id, stage: 'talking', evidence: { kind: 'note', on: '2026-10-14' } });
  await ventureAction(env.deps, owner, 'prepare', 'seed.inbound', tx => tx.put<InboundRecord>({
    ...tx.base('venture-inbound'), messageId: '<m1@ubtan.example>', from: 'rahul@ubtan.example', to: ['owner@ledger.example'], date: '2026-10-14T06:00:00.000Z',
    subject: 'Re: intro', references: [], matched: { opportunityId: r.card.id, confidenceBp: 9000 }, triage: 'talking', line: 'He wrote back.', processed: false, screen: null,
  }));
  assert.deepEqual(await followupRowsOf(env), []);
  const view = allCards(await board(env));
  const rahulCard = view.find(item => item.id === r.card.id)!;
  assert.equal(rahulCard.stage, 'asked', 'the move to Talking waits for the owner (4E3 asks on Today)');
  assert.ok(rahulCard.timeline.some(item => item.what === 'reply' && item.at === '2026-10-14'));
  assert.deepEqual(view.find(item => item.id === a.card.id)!.thread, { age: 'alive', days: 1, line: 'Alive: they wrote yesterday.' });
  days(env, 10);
  assert.equal(allCards(await board(env)).find(item => item.id === a.card.id)!.thread!.age, 'cooling');
});

test('the sequence is copied onto the card when it starts: a later change to the sending days never rewrites it', async () => {
  const env = await setup();
  const { asha, rahul } = await withPeople(env);
  const a = await add(env, asha);
  await recordSent(env, a.card.id, { on: '2026-10-15', channel: 'own-mailbox', kind: 'cold-email' });
  assert.deepEqual(cardById(env, a.card.id).sequence, {
    kind: 'first-email', steps: [{ afterDays: 5, channel: 'email' }, { afterDays: 7, channel: 'email' }], weekdays: WEEK, sendTime: '09:30', copiedAt: env.now(),
  });
  await settings(env, { weekdays: [1, 3, 5], sendTime: '10:00' });
  const r = await add(env, rahul);
  await recordSent(env, r.card.id, { on: '2026-10-15', channel: 'own-mailbox', kind: 'cold-email' });
  const view = allCards(await board(env));
  assert.equal(view.find(item => item.id === a.card.id)!.next!.due, '2026-10-20', 'Tuesday, as when it started');
  assert.equal(view.find(item => item.id === r.card.id)!.next!.due, '2026-10-21', 'the new days apply to the new card');
  assert.deepEqual(cardById(env, r.card.id).sequence!.weekdays, [1, 3, 5]);
});

test('one ceiling a day and a week covers first notes and follow-ups; what does not fit waits for the next sending day', async () => {
  const env = await setup();
  const { asha, rahul, farhan } = await withPeople(env);
  const [p1, p2] = await manyPeople(env, 2);
  await settings(env, { caps: { newPerDay: 3, perWeek: 40 } });
  const ids: string[] = [];
  for (const person of [asha, rahul, farhan, p1]) {
    const { card } = await add(env, person);
    await recordSent(env, card.id, { on: '2026-10-08', channel: 'whatsapp', kind: 'intro-request' });
    ids.push(card.id);
  }
  const fresh = await add(env, p2);
  await recordSent(env, fresh.card.id, { on: '2026-10-15', channel: 'whatsapp' });
  const rows = await followupRowsOf(env);
  assert.deepEqual(rows.map(row => row.id), [`followup:${ids[0]}:2026-10-15`, `followup:${ids[1]}:2026-10-15`], '3 a day, 1 used by a first note');
  const view = await followups(env);
  assert.deepEqual(view.due.map(item => item.cardId), ids.slice(0, 2));
  assert.deepEqual(view.later.filter(item => item.due === '2026-10-15').map(item => [item.cardId, item.line]), [
    [ids[2], 'Follow up today. Today\'s limit of 3 is used, so this waits for 16 Oct.'],
    [ids[3], 'Follow up today. Today\'s limit of 3 is used, so this waits for 16 Oct.'],
  ]);
  await settings(env, { caps: { newPerDay: 3, perWeek: 2 } });
  assert.equal((await followupRowsOf(env)).length, 1, 'the week has room for one more');
});

test('venture.pipeline.settings: approve-level, inside the app; checked; with no fields it only reads', async () => {
  const env = await setup();
  await assert.rejects(settings(env, { weekdays: [1] }, phone), code('APP_APPROVAL_REQUIRED'));
  const read = await settings(env, {});
  assert.deepEqual(read, { weekdays: WEEK, sendTime: '09:30', caps: { newPerDay: 10, perWeek: 40 }, scoreRules: [], line: 'Your pipeline settings.' });
  assert.equal(listRecords(env.store.read(), 'venture-pipeline-settings').length, 0, 'reading writes nothing');
  for (const bad of [{ weekdays: [] }, { weekdays: [0] }, { weekdays: [8] }, { weekdays: [1, 1] }, { sendTime: '25:00' }, { sendTime: '9.30' },
    { caps: { newPerDay: 0 } }, { caps: { perWeek: 1001 } }, { caps: { other: 2 } }, { colour: 'green' }]) {
    await assert.rejects(settings(env, bad), code('INVALID_VENTURE_REQUEST'), JSON.stringify(bad));
  }
  const saved = await settings(env, { weekdays: [5, 1, 3], sendTime: '10:00', caps: { perWeek: 30 } });
  assert.deepEqual(saved, {
    weekdays: [1, 3, 5], sendTime: '10:00', caps: { newPerDay: 10, perWeek: 30 }, scoreRules: [],
    line: 'Saved. Cards already following up keep the days they started with.',
  });
  assert.equal(listRecords(env.store.read(), 'venture-pipeline-settings').length, 1);
  await settings(env, { sendTime: '11:15' });
  assert.equal(listRecords(env.store.read(), 'venture-pipeline-settings').length, 1, 'one settings record, replaced');
  assert.deepEqual(env.published.flat().filter(event => event.name === 'pipeline.changed').map(event => Object.keys(event.data as object)), [['id'], ['id']]);
});

test('after the first follow-up, 7 days between touches to one person count across all their cards', async () => {
  const base = { stage: 'asked' as const, sequence: sequence('first-email'), touches: [sent('2026-10-01'), sent('2026-10-06', 'nudge')], blocked: false };
  assert.deepEqual(followupPlan(base), { kind: 'nudge', step: 1, due: '2026-10-13', channel: 'email' });
  assert.deepEqual(followupPlan({ ...base, lastToPerson: '2026-10-12' }), { kind: 'nudge', step: 1, due: '2026-10-19', channel: 'email' }, '12 Oct plus 7 is Monday 19 Oct');
  assert.deepEqual(followupPlan({ ...base, touches: [sent('2026-10-01')], lastToPerson: '2026-10-12' }), { kind: 'nudge', step: 0, due: '2026-10-06', channel: 'email' },
    'the first follow-up keeps its own wait');
  const env = await setup();
  const { rahul } = await withPeople(env);
  const old = await add(env, rahul);
  await recordSent(env, old.card.id, { on: '2026-10-12', channel: 'own-mailbox', kind: 'cold-email' });
  await pipe(env, 'venture.pipeline.move', { id: old.card.id, stage: 'won' });
  const next = await add(env, rahul);
  await recordSent(env, next.card.id, { on: '2026-10-01', channel: 'own-mailbox', kind: 'cold-email' });
  await recordSent(env, next.card.id, { on: '2026-10-06', channel: 'own-mailbox', kind: 'follow-up' });
  assert.equal(allCards(await board(env)).find(item => item.id === next.card.id)!.next!.due, '2026-10-19');
});

test('a follow-up due today shows on Today from the owner\'s send time', async () => {
  const env = await setup();
  const { asha } = await withPeople(env);
  const { card } = await add(env, asha);
  await recordSent(env, card.id, { on: '2026-10-09', channel: 'whatsapp', kind: 'intro-request' }); // due Friday 16 Oct
  env.advance(14 * 3_600_000); // 16 Oct 00:00 UTC, 05:30 in Kolkata
  assert.deepEqual(await followupRowsOf(env), []);
  assert.deepEqual((await followups(env)).later.map(item => item.line), ['Follow up today. It shows on Today from 09:30.']);
  env.advance(4 * 3_600_000); // 09:30 in Kolkata
  const [row] = await followupRowsOf(env);
  assert.equal(row.id, `followup:${card.id}:2026-10-16`);
});

test('a follow-up row carries its parts for the screen; two taps of I sent it record one nudge', async () => {
  const env = await setup();
  const { farhan } = await withPeople(env);
  const { card } = await add(env, farhan);
  await recordSent(env, card.id, { on: '2026-10-13', channel: 'whatsapp' });
  days(env, 6);
  const draft = await seedDraft(env, card, 'follow-up', 'whatsapp');
  const [row] = await followupRowsOf(env);
  assert.deepEqual(row.followup, { cardId: card.id, name: 'Farhan Ali', company: 'Ali Spices', due: '2026-10-19', daysLate: 2, channel: 'whatsapp', draftId: draft.id });
  const outcomes = await Promise.all([decide(env, row, 'sent'), decide(env, row, 'sent')]);
  assert.equal(outcomes.filter(item => item.outcome === 'done').length, 1, JSON.stringify(outcomes));
  assert.equal(cardById(env, card.id).touches!.filter(item => item.what === 'sent').length, 2, 'the first note and one nudge');
});

test('a card parks on its day from the touches up to then; a later send does not move it, and asking again stores the park', async () => {
  const email = sequence('first-email');
  const parkInput = (touches: CardTouch[]) => settledPark({ stage: 'asked', sequence: email, touches, blocked: false });
  const sends = [sent('2026-10-01'), sent('2026-10-06', 'nudge'), sent('2026-10-13', 'nudge')];
  assert.deepEqual(parkInput(sends), { on: '2026-10-20', askAgainFrom: '2026-11-19' });
  assert.deepEqual(parkInput([...sends, sent('2026-10-22', 'nudge')]), { on: '2026-10-20', askAgainFrom: '2026-11-19' }, 'a send after the park day');
  assert.equal(parkInput([...sends, { ...sent('2026-10-18'), what: 'reply', kind: null }]), null, 'a reply before the park day');
  assert.deepEqual(parkInput([...sends, { ...sent('2026-10-21'), what: 'reply', kind: null }]), { on: '2026-10-20', askAgainFrom: '2026-11-19' }, 'a reply after it');
  assert.equal(parkInput(sends.slice(0, 2)), null, 'not parked while a follow-up is still to come');

  const env = await setup();
  const { rahul } = await withPeople(env);
  const old = await add(env, rahul);
  for (const touch of sends) await recordSent(env, old.card.id, { on: touch.on, channel: 'own-mailbox', kind: touch.kind === 'first' ? 'cold-email' : 'follow-up' });
  days(env, 35); // 19 Nov
  const again = await add(env, rahul);
  assert.equal(cardById(env, again.card.id).linkedFrom, old.card.id);
  const stored = cardById(env, old.card.id);
  assert.deepEqual([stored.stage, stored.askAgainFrom], ['not-now', '2026-11-19']);
  assert.deepEqual(stored.history.at(-1), {
    from: 'asked', to: 'not-now', at: '2026-10-19T18:30:00.000Z', by: 'chausar',
    evidence: { kind: 'reason', id: null, line: 'No reply after the last follow-up. Ask again from 19 Nov 2026.' },
  }, 'stamped at the business\'s local midnight');
});

test('a lead\'s first recorded send stores its card with the sending days of that day', async () => {
  const env = await setup();
  const deps = leadDeps(env);
  const lead = await leadCall<LeadView>(deps, 'venture.leads.add', { name: 'Nia', email: 'nia@nia.example', sourceUrl: 'https://directory.example/pune/cafes' });
  const { draft } = await leadCall<{ draft: OutreachDraftView }>(deps, 'venture.leads.draft', { leadId: lead.id, subject: 'Books', body: 'A short note.', postalAddress: '12 FC Road, Pune 411004' });
  assert.equal(cards(env).length, 0, 'a draft alone stores nothing');
  await leadCall(deps, 'venture.leads.recordSend', { leadId: lead.id, draftId: draft.id, sentAt: env.now() });
  const [stored] = cards(env);
  assert.deepEqual([stored.leadId, stored.stage, stored.sequence?.weekdays], [lead.id, 'asked', WEEK]);
  await settings(env, { weekdays: [1, 3, 5] });
  assert.equal(allCards(await board(env))[0].next!.due, '2026-10-20', 'Tuesday, as on the day it was sent');
});

test('an older lead\'s follow-up keeps its row, its Later and its replies when its card is stored', async () => {
  const env = await setup();
  const deps = leadDeps(env);
  const lead = await leadCall<LeadView>(deps, 'venture.leads.add', { name: 'Om', email: 'om@om.example', sourceUrl: 'https://directory.example/pune/cafes' });
  const { draft } = await leadCall<{ draft: OutreachDraftView }>(deps, 'venture.leads.draft', { leadId: lead.id, subject: 'Books', body: 'A short note.', postalAddress: '12 FC Road, Pune 411004' });
  // A send the lead list recorded before cards were stored when a lead was sent to.
  await ventureAction(env.deps, owner, 'admin', 'seed.old-send', tx => {
    const stored = tx.find('venture-lead', lead.id)!;
    tx.replace<LeadRecord>({ ...stored, status: 'contacted', sends: [{ draftId: draft.id, sentAt: '2026-10-08T05:00:00.000Z', recordedBy: 'owner', recordedAt: '2026-10-08T05:00:00.000Z', channel: 'own-mailbox' }] });
  });
  assert.equal(cards(env).length, 0);
  const [row] = await followupRowsOf(env);
  assert.equal(row.id, `followup:${lead.id}:2026-10-13`);
  assert.equal((await decide(env, row, 'later')).outcome, 'done');
  await pipe(env, 'venture.pipeline.setNext', { id: lead.id, text: 'Call Om', due: '2026-10-16' });
  const [stored] = cards(env) as OpportunityRecord[];
  assert.equal(stored.leadId, lead.id);
  assert.deepEqual(await followupRowsOf(env), [], 'the Later still holds for this due date');
  await ventureAction(env.deps, owner, 'prepare', 'seed.inbound', tx => tx.put<InboundRecord>({
    ...tx.base('venture-inbound'), messageId: '<m1@om.example>', from: 'om@om.example', to: ['owner@ledger.example'], date: '2026-10-14T06:00:00.000Z',
    subject: 'Re: Books', references: [], matched: { opportunityId: lead.id, confidenceBp: 9000 }, triage: 'talking', line: 'He wrote back.', processed: false, screen: null,
  }));
  assert.ok(allCards(await board(env)).find(item => item.id === stored.id)!.timeline.some(item => item.what === 'reply' && item.at === '2026-10-14'),
    'a reply matched to the lead\'s card reaches the stored card');
});
