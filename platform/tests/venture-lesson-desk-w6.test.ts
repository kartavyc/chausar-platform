// Wave 6, 6E2: the lesson desk (batches, sessions, attendance, worksheets and quizzes, progress reports, parent updates
// and fees). Every figure is counted by code; a child's lesson records reach the AI only with their parent's recorded
// consent (D21, the child-data hard stop), reusing the client AI permission and the person consent records; parent
// messages go out only through the owner's exact approval, and Chausar sends nothing; fees are the existing orders and
// invoices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kitBusiness, owner } from './fixtures/venture/kit-business.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { formatMinor } from '../runtime/currency.ts';
import { PLAYBOOK_REGISTRY, pickPlaybook } from '../runtime/venture/playbooks/registry.ts';
import { PLAYBOOK_DEFINITIONS } from '../runtime/venture/playbooks/definitions.ts';
import { deskContext } from '../runtime/venture/agent-runtime/desk-context.ts';
import type { VoiceConsentRecord } from '../runtime/venture/contracts.ts';

const base = { playbook: 'lesson-desk', kind: 'batch' };

async function setup() {
  const env = await kitBusiness({ now: new Date('2026-11-01T05:00:00.000Z') });
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0]!.id, request: 'Monthly maths classes for Riya' });
  const made = await env.call('venture.desk.act', { ...base, id: 'new', action: 'create', payload: { name: 'Class 8 maths', subject: 'Maths', days: ['mon', 'wed'], time: '17:00', minutes: 60 } });
  const id = made.id as string;
  const get = () => env.call('venture.desk.get', { ...base, id });
  const act = async (action: string, payload: unknown) => env.call('venture.desk.act', { ...base, id, action, payload, digest: (await get()).digest });
  return { env, order, id, get, act };
}

async function consentFor(env: Awaited<ReturnType<typeof kitBusiness>>, speaker: string): Promise<string> {
  return ventureAction(env.deps, owner, 'approve', 'fixture.parent-consent', tx => tx.put<VoiceConsentRecord>({
    ...tx.base('venture-voice-consent'), speaker, recordingFileId: 'upload_parent', recordingDigest: 'a'.repeat(64),
    transcript: 'I am Asha Rao, Riya\'s mother. I agree.', statement: 'I agree that Riya\'s lesson records may reach the AI for her lessons.',
    scope: 'Lesson records and progress reports', until: null, version: 1, revokedAt: null,
  }).id);
}

test('6E2 the lesson desk is a registered playbook with a kit definition and its own picks', () => {
  const entry = PLAYBOOK_REGISTRY.find(item => item.id === 'lesson-desk');
  assert.ok(entry, 'registered');
  assert.equal(entry.label, 'Lesson desk for tutors and teachers');
  assert.equal(pickPlaybook('I want to run tuition classes for school children')?.id, 'lesson-desk');
  const definition = PLAYBOOK_DEFINITIONS.find(item => item.registration.id === 'lesson-desk');
  assert.ok(definition, 'defined');
  assert.ok(definition.offers.some(offer => offer.pilotable));
  assert.ok(definition.intakeFields.some(field => field.kind === 'people'), 'learners named on an order carry their consent');
  assert.ok(definition.rules.some(rule => rule.id === 'child-data-consent'));
});

test('6E2 a batch keeps learners, sessions and attendance; the counts are code, never typed', async () => {
  const f = await setup();
  await f.act('add-learner', { name: 'Riya Rao', minor: true, guardianClientId: f.env.client.id, orderId: f.order.id });
  await f.act('add-learner', { name: 'Kabir Shah', minor: true, guardianClientId: f.env.client.id });
  await f.act('session', { on: '2026-10-26', topic: 'Fractions' });
  await f.act('session', { on: '2026-10-28', topic: 'Decimals' });
  await f.act('session', { on: '2026-10-30', topic: 'Percentages' });
  const [s1, s2, s3] = (await f.get()).item.sessions.map((session: { id: string }) => session.id);
  await f.act('attendance', { sessionId: s1, marks: { l1: 'present', l2: 'absent' } });
  await f.act('attendance', { sessionId: s2, marks: { l1: 'late', l2: 'present' } });
  await f.act('attendance', { sessionId: s3, marks: { l1: 'absent', l2: 'present' } });
  const view = (await f.get()).item;
  const riya = view.learners.find((row: { id: string }) => row.id === 'l1');
  assert.deepEqual(riya.attendance, { present: 1, late: 1, absent: 1, of: 3, line: 'Attended 2 of 3 classes.' });
  await assert.rejects(f.act('attendance', { sessionId: s1, marks: { l9: 'present' } }), { code: 'LESSON_LEARNER_NOT_FOUND' });
  await assert.rejects(f.act('attendance', { sessionId: s1, marks: { l1: 'sleeping' } }), { code: 'INVALID_VENTURE_REQUEST' });
  await assert.rejects(f.env.call('venture.desk.act', { ...base, id: f.id, action: 'session', payload: { on: '2026-10-31', topic: 'Ratios' }, digest: 'stale' }), { code: 'APPROVAL_CHANGED' });
});

test('6E2 a quiz is scored by code against the owner\'s answer key', async () => {
  const f = await setup();
  await f.act('add-learner', { name: 'Riya Rao', minor: true, guardianClientId: f.env.client.id, orderId: f.order.id });
  await f.act('work', { kind: 'quiz', title: 'Fractions quiz', topic: 'Fractions', items: [{ prompt: 'Half of eight', answer: 'four' }, { prompt: 'A quarter of twelve', answer: 'three' }, { prompt: 'Simplest form of two fourths', answer: 'one half' }] });
  const workId = (await f.get()).item.works[0].id;
  await f.act('scores', { workId, answers: { l1: ['Four', 'two', ' one  half '] } });
  const riya = (await f.get()).item.learners[0];
  assert.deepEqual(riya.scores, [{ workId, title: 'Fractions quiz', right: 2, of: 3, line: '2 of 3 right.' }]);
  await f.act('work', { kind: 'worksheet', title: 'Decimals practice', topic: 'Decimals', items: [{ prompt: 'Write one tenth as a decimal', answer: '' }] });
  const sheet = (await f.get()).item.works[1].id;
  await assert.rejects(f.act('scores', { workId: sheet, answers: { l1: ['x'] } }), { code: 'LESSON_NOT_A_QUIZ' });
  await assert.rejects(f.act('scores', { workId, answers: { l1: ['four'] } }), { code: 'INVALID_VENTURE_REQUEST' }, 'one answer for each question');
});

/** The learners the lesson desk shares with an AI job, as deskContext gives them. */
const shared = (context: { data: unknown }) => (context.data as { lessonLearners: { name: string }[] }).lessonLearners;

test('6E2 a child\'s lesson records reach the AI only with the parent\'s current recorded consent (D21)', async () => {
  const f = await setup();
  await f.act('add-learner', { name: 'Riya Rao', minor: true, guardianClientId: f.env.client.id, orderId: f.order.id });
  const run = { ventureId: f.order.ventureId } as never;
  const state = () => f.env.store.read();
  const order = () => listRecords(state(), 'venture-order').find(row => row.id === f.order.id)!;
  assert.throws(() => deskContext(state(), run, order(), 'lesson-desk'), (error: any) => error.code === 'HARD_STOP' && /Riya Rao/.test(error.message) && /parent/.test(error.message));
  assert.equal((await f.get()).item.learners[0].consent.state, 'needed');
  const other = await consentFor(f.env, 'Kabir Shah');
  await assert.rejects(f.act('link-learner', { learnerId: 'l1', orderId: f.order.id, consentId: other }), { code: 'CONSENT_REQUIRED' }, 'another child\'s consent never counts');
  const consentId = await consentFor(f.env, 'Riya Rao');
  await f.act('link-learner', { learnerId: 'l1', orderId: f.order.id, consentId });
  assert.equal((await f.get()).item.learners[0].consent.state, 'current');
  const context = deskContext(state(), run, order(), 'lesson-desk');
  assert.equal(shared(context)[0]!.name, 'Riya Rao');
  assert.ok(context.binding);
  await f.env.call('venture.voiceConsent.revoke', { id: consentId });
  assert.equal((await f.get()).item.learners[0].consent.state, 'revoked');
  assert.throws(() => deskContext(state(), run, order(), 'lesson-desk'), (error: any) => error.code === 'HARD_STOP');
  // An adult learner needs no parent's consent; the client AI permission still gates the job at dispatch.
  await f.act('remove-learner', { learnerId: 'l1' });
  await f.act('add-learner', { name: 'Meera Iyer', minor: false, guardianClientId: f.env.client.id, orderId: f.order.id });
  assert.equal(shared(deskContext(state(), run, order(), 'lesson-desk'))[0]!.name, 'Meera Iyer');
});

test('6E2 progress reports carry code counts; parent messages are handed to the owner after exact approval, never sent', async () => {
  const f = await setup();
  await f.act('add-learner', { name: 'Riya Rao', minor: true, guardianClientId: f.env.client.id, orderId: f.order.id });
  await f.act('session', { on: '2026-10-26', topic: 'Fractions' });
  const session = (await f.get()).item.sessions[0].id;
  await f.act('attendance', { sessionId: session, marks: { l1: 'present' } });
  await f.act('progress', { learnerId: 'l1', note: 'Riya asks good questions.', channel: 'email' });
  const message = (await f.get()).item.messages[0];
  assert.equal(message.kind, 'progress');
  assert.equal(message.to, 'asha@example.com');
  assert.match(message.text, /Attended 1 of 1 classes\./);
  assert.match(message.text, /Topics covered: Fractions\./);
  assert.match(message.text, /Riya asks good questions\./);
  assert.equal(message.handedOffAt, null);
  await assert.rejects(f.env.call('venture.desk.act', { ...base, id: f.id, action: 'handoff', payload: { messageId: message.id }, digest: 'stale' }), { code: 'APPROVAL_CHANGED' });
  const done = await f.act('handoff', { messageId: message.id });
  assert.equal(done.result.handoff.action, 'mailto');
  assert.match(done.result.handoff.url, /^mailto:asha@example\.com\?subject=/);
  assert.match(done.line, /sends nothing/i);
  const entries = listRecords(f.env.store.read(), 'venture-journal-entry').filter(entry => entry.action === 'owner.handoff');
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.state, 'applied');
  assert.equal(entries[0]!.actionDigest, message.digest);
  assert.ok((await f.get()).item.messages[0].handedOffAt);
  await f.act('update', { learnerId: 'l1', text: 'No class on Friday for the festival.', channel: 'whatsapp', phone: '+919812345678' });
  const update = (await f.get()).item.messages[1];
  const sent = await f.act('handoff', { messageId: update.id });
  assert.match(sent.result.handoff.url, /^https:\/\/wa\.me\/919812345678\?text=/);
});

test('6E2 fees are the existing orders and invoices: a learner\'s fee is an invoice on their order, amounts from code', async () => {
  const f = await setup();
  await f.act('add-learner', { name: 'Riya Rao', minor: true, guardianClientId: f.env.client.id, orderId: f.order.id });
  await f.act('add-learner', { name: 'Kabir Shah', minor: true, guardianClientId: f.env.client.id });
  await assert.rejects(f.act('fee', { learnerId: 'l2' }), { code: 'LESSON_ORDER_REQUIRED' });
  const billed = await f.act('fee', { learnerId: 'l1', part: { kind: 'advance', percent: '50' } });
  const invoice = listRecords(f.env.store.read(), 'venture-invoice').find(row => row.id === billed.result.invoiceId)!;
  assert.equal(invoice.orderId, f.order.id);
  assert.equal(invoice.part?.kind, 'advance');
  const fee = (await f.get()).item.learners[0].fees[0];
  assert.deepEqual([fee.invoiceId, fee.status, fee.total], [invoice.id, 'draft', formatMinor(invoice.totalMinor, invoice.currency)]);
  assert.equal(listRecords(f.env.store.read(), 'venture-journal-entry').some(entry => entry.action === 'invoice.issue'), false, 'issuing still asks in Money');
});

test('6E2 Forget removes the forgotten family\'s learners, marks, scores and messages from every batch', async () => {
  const f = await setup();
  await f.act('add-learner', { name: 'Riya Rao', minor: true, guardianClientId: f.env.client.id, orderId: f.order.id });
  await f.act('session', { on: '2026-10-26', topic: 'Fractions' });
  const session = (await f.get()).item.sessions[0].id;
  await f.act('attendance', { sessionId: session, marks: { l1: 'present' } });
  await f.act('update', { learnerId: 'l1', text: 'See you on Monday.', channel: 'email' });
  const { eraseLessons } = await import('../runtime/venture/playbooks/lesson-desk/privacy.ts');
  await ventureAction(f.env.deps, owner, 'approve', 'fixture.forget', tx => { eraseLessons(tx, new Set([f.env.client.id]), new Set(), () => false); });
  const view = (await f.get()).item;
  assert.deepEqual([view.learners.length, view.messages.length, JSON.stringify(view.sessions).includes('l1')], [0, 0, false]);
});
