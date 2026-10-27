// Voice consent (Ink v2 wave 5, package 5A4; catalogue P9) and transcribe-back. venture.voiceConsent.record stores a
// versioned consent: the reference recording (an order's audio file), what it says, the statement, the scope and until
// when. Any call that sends a voice to a cloning or synthesis provider without a current consent refuses
// CONSENT_REQUIRED; revoking really stops later use and marks the files made with it "consent withdrawn"; a step that
// names voice A cannot use voice B (VOICE_MISMATCH, no silent substitution); a real person who appears in client work
// needs a consent record named at intake. scoreBack scores a synthesized sentence against its text by code, in whole
// points: 92 and up approved, 85 to 91 review, below that retry (house rules).
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import { currentVenture, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as playbookHandlers } from '../runtime/venture/playbooks/index.ts';
import { checkVoiceUse, requirePeopleConsent, requireVoiceConsent, voiceForCall } from '../runtime/venture/playbooks/kit/voice-consent.ts';
import { mediaAcceptBlock, storeRunAssets } from '../runtime/venture/playbooks/kit/assets.ts';
import { BACK_RULES, scoreBack } from '../runtime/venture/playbooks/kit/transcribe-back.ts';
import { KIT_TOOLS } from '../runtime/venture/delivery/harness/tools-kit.ts';
import { TEST_CARD } from './venture-agent-helpers.ts';
import { kitFixture } from './fixtures/venture/kit-fixture.ts';
import { approveWaiting, deliver, draft, installKitFixture, kitBusiness } from './fixtures/venture/kit-business.ts';
import { business, code, owner, phone, PLAIN_IDEA, NOW } from './venture-judge-helpers.ts';

type Env = Awaited<ReturnType<typeof business>>;
const kit = (env: Env, method: string, payload: unknown = {}, ctx: Context = owner): Promise<any> =>
  (playbookHandlers as Record<string, (deps: Env['deps'], ctx: Context, payload: unknown) => Promise<any>>)[method](env.deps, ctx, payload);
const le32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
const WAV = Buffer.from([...Buffer.from('RIFF'), ...le32(36), ...Buffer.from('WAVEfmt '), ...le32(16), 1, 0, 1, 0, ...le32(8000), ...le32(8000), 1, 0, 8, 0, ...Buffer.from('data'), ...le32(0)]);
const TODAY = NOW.slice(0, 10);

async function withRecording(env: Env) {
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id, request: 'Narrate my course in my own voice.' });
  const recording = await env.call('venture.files.add', { orderId: order.id, name: 'asha-consent.wav', contentBase64: WAV.toString('base64') });
  return { order, recording };
}
const consentFor = (recordingFileId: string, extra: Record<string, unknown> = {}) => ({
  speaker: 'Asha Rao', recordingFileId, transcript: 'I am Asha Rao and I agree that Chausar may use my voice for my course narration.',
  statement: 'I agree my voice may be cloned to narrate my own course, and nothing else.', scope: 'Narration of Asha\'s own course', until: '2027-10-21', ...extra,
});

test('voice consent: the owner records a versioned consent inside the app, with the recording\'s digest; every version kept', async () => {
  const env = await business(PLAIN_IDEA);
  const { recording } = await withRecording(env);
  await assert.rejects(kit(env, 'venture.voiceConsent.record', consentFor(recording.id), phone), code('APP_APPROVAL_REQUIRED'));
  const first = await kit(env, 'venture.voiceConsent.record', consentFor(recording.id));
  assert.equal(first.consent.version, 1);
  assert.equal(first.consent.state, 'current');
  assert.equal(first.consent.recordingDigest, recording.digest);
  const second = await kit(env, 'venture.voiceConsent.record', consentFor(recording.id, { speaker: 'asha  rao', scope: 'Narration and course ads' }));
  assert.equal(second.consent.version, 2, 'the same person, however their name is spaced or cased');
  assert.match(second.line, /Version 1 is kept/);
  const list = await kit(env, 'venture.voiceConsent.list', {}, phone);
  assert.deepEqual(list.consents.map((item: any) => [item.version, item.state]), [[2, 'current'], [1, 'replaced']]);
  // Refused: a file that is not a recording, an end date in the past, an unknown file, a card number in the words.
  const csv = await env.call('venture.files.add', { orderId: (await withRecording(env)).order.id, name: 'list.csv', contentBase64: Buffer.from('a,b\n1,2\n').toString('base64') });
  await assert.rejects(kit(env, 'venture.voiceConsent.record', consentFor(csv.id)), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(kit(env, 'venture.voiceConsent.record', consentFor(recording.id, { until: '2026-10-01' })), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(kit(env, 'venture.voiceConsent.record', consentFor('upload_missing')), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(kit(env, 'venture.voiceConsent.record', consentFor(recording.id, { transcript: `My card is ${TEST_CARD}` })), code('CHAT_KEY_REFUSED'));
  await assert.rejects(kit(env, 'venture.voiceConsent.record', { ...consentFor(recording.id), extra: true }), code('INVALID_VENTURE_REQUEST'));
  assert.equal(listRecords(env.store.read(), 'venture-voice-consent').length, 2);
});

test('voice consent: a voice call needs a current consent, and a step that names one voice never uses another', async () => {
  const env = await business(PLAIN_IDEA);
  const { recording } = await withRecording(env);
  const venture = () => currentVenture(env.store.read())!;
  assert.throws(() => requireVoiceConsent(env.store.read(), venture(), null, TODAY), code('CONSENT_REQUIRED'));
  const recorded = await kit(env, 'venture.voiceConsent.record', consentFor(recording.id, { until: '2026-10-25' }));
  assert.equal(requireVoiceConsent(env.store.read(), venture(), recorded.consent.id, TODAY).speaker, 'Asha Rao');
  assert.throws(() => requireVoiceConsent(env.store.read(), venture(), recorded.consent.id, '2026-10-26'), (error: any) => error.code === 'CONSENT_REQUIRED' && /ended on 2026-10-25/.test(error.message));
  assert.throws(() => checkVoiceUse('Asha Rao', 'Ravi Shah'), (error: any) => error.code === 'VOICE_MISMATCH' && /never swaps/.test(error.message));
  checkVoiceUse('Asha Rao', 'asha rao');
  assert.throws(() => voiceForCall(env.store.read(), venture(), { stepVoice: 'Ravi Shah', consentId: recorded.consent.id, today: TODAY }), code('VOICE_MISMATCH'));
  assert.equal(voiceForCall(env.store.read(), venture(), { stepVoice: 'Asha Rao', consentId: recorded.consent.id, today: TODAY }).id, recorded.consent.id);
  // A newer version replaces the old: naming the old one refuses, so a changed scope is never skipped.
  const newer = await kit(env, 'venture.voiceConsent.record', consentFor(recording.id));
  assert.throws(() => requireVoiceConsent(env.store.read(), venture(), recorded.consent.id, TODAY), (error: any) => error.code === 'CONSENT_REQUIRED' && /newer version/.test(error.message));
  // A real person named in client work needs their own current consent at intake.
  requirePeopleConsent(env.store.read(), venture(), [{ name: 'Asha Rao', consentId: newer.consent.id }], TODAY);
  assert.throws(() => requirePeopleConsent(env.store.read(), venture(), [{ name: 'Ravi Shah', consentId: null }], TODAY), (error: any) => error.code === 'CONSENT_REQUIRED' && /Ravi Shah appears/.test(error.message));
  assert.throws(() => requirePeopleConsent(env.store.read(), venture(), [{ name: 'Ravi Shah', consentId: newer.consent.id }], TODAY), code('CONSENT_REQUIRED'), 'another person\'s consent does not count');
});

test('voice consent: revoking really stops later use, and every file made with it is marked consent withdrawn', async () => {
  const env = await business(PLAIN_IDEA);
  const { order, recording } = await withRecording(env);
  const v1 = await kit(env, 'venture.voiceConsent.record', consentFor(recording.id));
  const v2 = await kit(env, 'venture.voiceConsent.record', consentFor(recording.id, { scope: 'Narration and ads' }));
  // A narration file made with the voice, recorded by the run with its consent.
  const runEnv = { runRef: { kind: 'delivery', runId: 'delivery_v' }, files: [], tables: [], receipts: [], intake: null, deps: env.deps, now: () => NOW } as any;
  const made = await KIT_TOOLS['assets.record'].run(runEnv, { file: 'chapter-1.mp3', source: 'generated', model: 'voice-provider', prompt: 'Chapter one', licence: 'Asha\'s voice, with her consent', voice: v2.consent.id });
  assert.equal((made.result as any).asset.consentId, v2.consent.id);
  await assert.rejects(KIT_TOOLS['assets.record'].run(runEnv, { file: 'x.mp3', source: 'generated', model: 'm', prompt: 'p', licence: 'l', voice: v1.consent.id }), code('CONSENT_REQUIRED'), 'only the current version may be used');
  await ventureAction(env.deps, owner, 'prepare', 'test.assets', tx => storeRunAssets(tx, [{ id: 'call_v', tool: 'assets.record', outcome: 'succeeded', envelope: { ok: true, result: made.result } } as any], { runId: 'delivery_v', orderId: order.id, clientId: env.client.id }));
  assert.equal(mediaAcceptBlock(env.store.read(), currentVenture(env.store.read())!, { id: 'delivery_v', orderId: order.id }), null);
  await assert.rejects(kit(env, 'venture.voiceConsent.revoke', { id: v2.consent.id }, phone), code('APP_APPROVAL_REQUIRED'));
  const revoked = await kit(env, 'venture.voiceConsent.revoke', { id: v1.consent.id });
  assert.equal(revoked.consent.state, 'revoked');
  assert.match(revoked.line, /Nothing uses their voice from now on\. 1 file made with it is marked consent withdrawn\./);
  const list = await kit(env, 'venture.voiceConsent.list');
  assert.deepEqual(list.consents.map((item: any) => item.state), ['revoked', 'revoked'], 'every version of the speaker\'s consent is withdrawn');
  assert.throws(() => requireVoiceConsent(env.store.read(), currentVenture(env.store.read())!, v2.consent.id, TODAY), (error: any) => error.code === 'CONSENT_REQUIRED' && /withdrew/.test(error.message));
  const asset = listRecords(env.store.read(), 'venture-asset')[0];
  assert.equal(asset.state, 'consent-withdrawn');
  assert.equal(mediaAcceptBlock(env.store.read(), currentVenture(env.store.read())!, { id: 'delivery_v', orderId: order.id })!.code, 'CONSENT_WITHDRAWN');
  await assert.rejects(kit(env, 'venture.assets.rerun', { id: asset.id }), code('ASSET_REFUSED'));
  const other = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id, request: 'Another chapter.' });
  await assert.rejects(kit(env, 'venture.assets.reuse', { id: asset.id, orderId: other.id }), code('CONSENT_WITHDRAWN'));
  await assert.rejects(kit(env, 'venture.voiceConsent.revoke', { id: v1.consent.id }), code('INVALID_VENTURE_REQUEST'), 'already withdrawn');
  await assert.rejects(kit(env, 'venture.voiceConsent.revoke', { id: 'voiceconsent_missing' }), code('CONSENT_NOT_FOUND'));
  // Recording a new consent after a withdrawal is the person agreeing again, as a new version.
  const again = await kit(env, 'venture.voiceConsent.record', consentFor(recording.id));
  assert.equal(again.consent.version, 3);
  assert.equal(again.consent.state, 'current');
});

test('transcribe-back: a synthesized sentence is scored against its text by code, in whole points, with house-rule thresholds', () => {
  assert.deepEqual(scoreBack('Save a little every week.', 'save a little every week'), { score: 100, verdict: 'approved' });
  // One word of thirteen wrong: 92 points (12 of 13, rounded down).
  const text = 'An emergency fund grows from small steps that you repeat every single week';
  assert.deepEqual(scoreBack(text, text.replace('repeat', 'repeated')), { score: 92, verdict: 'approved' });
  assert.deepEqual(scoreBack('one two three four five six seven eight nine ten', 'one two three four five six seven eight nine'), { score: 90, verdict: 'review' });
  assert.deepEqual(scoreBack('one two three four five six seven eight nine ten', 'one two three four five six seven eight'), { score: 80, verdict: 'retry' });
  assert.deepEqual(scoreBack('बजट छोटे कदमों से शुरू होता है', 'बजट छोटे कदमों से शुरू होता है।'), { score: 100, verdict: 'approved' });
  assert.deepEqual(scoreBack('Hello there', ''), { score: 0, verdict: 'retry' });
  assert.equal(BACK_RULES.length, 2);
  for (const rule of BACK_RULES) assert.equal(rule.read, 'house');
  assert.deepEqual(BACK_RULES.map(rule => rule.value), ['92', '85']);
});

test('voice consent: revoking deletes the reference recording\'s sound and keeps its digest and the statement as evidence', async () => {
  const env = await business(PLAIN_IDEA);
  const { recording } = await withRecording(env);
  const recorded = await kit(env, 'venture.voiceConsent.record', consentFor(recording.id));
  const upload = () => listRecords(env.store.read(), 'venture-upload').find(item => item.id === recording.id)!;
  assert.ok(upload().contentBase64.length > 0);
  await kit(env, 'venture.voiceConsent.revoke', { id: recorded.consent.id });
  assert.equal(upload().contentBase64, '', 'the voice itself is gone');
  assert.equal(upload().digest, recording.digest);
  const kept = listRecords(env.store.read(), 'venture-voice-consent')[0];
  assert.equal(kept.recordingDigest, recording.digest);
  assert.match(kept.statement, /I agree my voice may be cloned/);
});

test('voice consent: a file recorded before a revoke but stored after it is withdrawn, and an ended consent blocks Accept too', async () => {
  const env = await business(PLAIN_IDEA);
  const { order, recording } = await withRecording(env);
  const consent = await kit(env, 'venture.voiceConsent.record', consentFor(recording.id, { until: '2026-10-25' }));
  const runEnv = { runRef: { kind: 'delivery', runId: 'delivery_v' }, files: [], tables: [], receipts: [], intake: null, deps: env.deps, now: () => NOW } as any;
  const made = await KIT_TOOLS['assets.record'].run(runEnv, { file: 'chapter-1.mp3', source: 'generated', model: 'voice-provider', prompt: 'Chapter one', licence: 'With consent', voice: consent.consent.id });
  const store = (id: string) => ventureAction(env.deps, owner, 'prepare', 'test.assets', tx => storeRunAssets(tx, [{ id, tool: 'assets.record', outcome: 'succeeded', envelope: { ok: true, result: made.result } } as any], { runId: 'delivery_v', orderId: order.id, clientId: env.client.id }));
  const venture = () => currentVenture(env.store.read())!;
  // Ended: on 26 October the consent that ran to the 25th no longer covers the file.
  await store('call_a');
  assert.equal(mediaAcceptBlock(env.store.read(), venture(), { id: 'delivery_v', orderId: order.id }, NOW), null);
  assert.deepEqual(mediaAcceptBlock(env.store.read(), venture(), { id: 'delivery_v', orderId: order.id }, '2026-10-26T10:00:00.000Z')?.code, 'CONSENT_REQUIRED');
  // Withdrawn while the call's answer waited: stored afterwards, it is withdrawn too, and blocks.
  await kit(env, 'venture.voiceConsent.revoke', { id: consent.consent.id });
  await ventureAction(env.deps, owner, 'prepare', 'test.clear', tx => { for (const asset of tx.list('venture-asset')) tx.replace({ ...asset, supersededBy: 'gone' }); });
  await store('call_b');
  const late = listRecords(env.store.read(), 'venture-asset').find(asset => asset.toolCallId === 'call_b')!;
  assert.equal(late.state, 'consent-withdrawn');
  assert.equal(mediaAcceptBlock(env.store.read(), venture(), { id: 'delivery_v', orderId: order.id }, NOW)!.code, 'CONSENT_WITHDRAWN');
});

test('voice consent: someone who withdraws between two stages of a chain stops the work: no next run starts, nothing is accepted', async t => {
  const base = kitFixture();
  t.after(installKitFixture(kitFixture({
    intakeFields: [...base.intakeFields, { id: 'people', label: 'People in the posts', help: 'Each person seen or heard, with their recorded consent.', kind: 'people', required: false }],
    offers: base.offers.map(offer => (offer.id === 'voice-pack' ? { ...offer, intake: [...offer.intake, 'people'] } : offer)),
  })));
  const env = await kitBusiness();
  const call = (method: string, payload: unknown) => (playbookHandlers as any)[method](env.deps, owner, payload);
  const consent = await ventureAction(env.deps, owner, 'approve', 'test.consent', tx => tx.put({
    ...tx.base('venture-voice-consent'), speaker: 'Meera Shah', recordingFileId: 'upload_consent', recordingDigest: 'a'.repeat(64), transcript: 'I agree to appear.',
    statement: 'Meera Shah agrees to appear in the posts.', scope: 'Sunrise Bakery posts', until: null, version: 1, revokedAt: null,
  } as never) as { id: string });
  const order = await env.call('venture.order.create', {
    clientId: env.client.id, offerId: env.offers[0].id, request: 'A voice sheet, a calendar and posts for Sunrise Bakery.',
    intake: { fields: { 'brand-name': 'Sunrise Bakery', 'consent-data': true, people: [{ name: 'Meera Shah', consentId: consent.id }] } },
  });
  const voice = await deliver(env, order.id, draft('Voice sheet', { 'Voice sheet': ['A warm, plain voice for Sunrise Bakery.'] }));
  await env.call('venture.delivery.review', { runId: voice.id, verdict: 'accepted' });
  const calendarRun = listRecords(env.store.read(), 'venture-delivery-run').find(run => run.orderId === order.id && run.id !== voice.id)!;
  assert.ok(calendarRun, 'stage two started while Meera\'s consent was current');
  // Meera withdraws between the stages.
  await call('venture.voiceConsent.revoke', { id: consent.id });
  const calendar = await approveWaiting(env, calendarRun as any, draft('Calendar', { Calendar: ['Posts for Sunrise Bakery on the days you pick.'] }));
  assert.equal(calendar.status, 'ready-for-review');
  assert.equal(calendar.canAccept, false);
  assert.match(calendar.acceptBlocked ?? '', /Meera Shah appears in this work/);
  await assert.rejects(env.call('venture.delivery.review', { runId: calendar.id, verdict: 'accepted' }), code('CONSENT_REQUIRED'));
  await assert.rejects(env.call('venture.delivery.run', { orderId: order.id }), code('CONSENT_REQUIRED'), 'no next run starts');
});
