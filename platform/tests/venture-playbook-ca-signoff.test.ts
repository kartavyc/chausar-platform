// P3-ca-firm: the CA of record, recorded CA sign-offs on regulated papers and the CA's confirmation of each rate-table
// version, read by Today's queue as 'signoff' rows: Send to CA, then the CA signs with their ICAI membership number.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { QueueDecision, QueueList, QueueRow } from '../runtime/venture/contracts.ts';
import { digest, listRecords } from '../runtime/venture/records.ts';
import {
  caFirmQueueItems, caOfRecord, rateUseFor, recordCaSignoff, requestCaSignoff, setCaOfRecord, unconfirmedRateTables,
} from '../runtime/venture/playbooks/ca-firm/signoff.ts';
import { computeIncomeTax } from '../runtime/venture/playbooks/ca-firm/income-tax.ts';
import { RATE_TABLES } from '../runtime/venture/playbooks/ca-firm/rates.ts';
import { call, code, owner, phone, setup, type Env } from './venture-views-env.ts';

const list = (env: Env) => call<QueueList>(env, 'venture.queue.list', {});
const decide = (env: Env, row: QueueRow, action: string, extra: Record<string, unknown> = {}) =>
  call<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action, ...extra });
const signoffs = (queue: QueueList) => queue.rows.filter(row => row.kind === 'signoff');
const CA = { name: 'CA Asha Rao', membershipNumber: '123456', firmName: 'Rao and Associates', firmRegistrationNumber: '012345W' };
const request = (title = 'GST working for October 2025') => ({
  subjectKind: 'gst-working', title, clientName: 'Cafe Aroma Demo', workingDigest: digest({ papers: title }), receiptIds: ['ca_0123456789abcdef01234567'],
});

test('signoff: regulated papers wait for a CA of record, and a business without one shows no signoff rows', async () => {
  const env = await setup();
  assert.deepEqual(signoffs(await list(env)), []);
  assert.deepEqual(caFirmQueueItems(env.store.read(), env.venture), []);
  await assert.rejects(requestCaSignoff(env.deps, owner, request()), code('CA_OF_RECORD_REQUIRED'));
  await assert.rejects(setCaOfRecord(env.deps, owner, { ...CA, membershipNumber: '12-3456' }), code('INVALID_VENTURE_REQUEST'));
  await setCaOfRecord(env.deps, owner, CA);
  assert.deepEqual(caOfRecord(env.store.read(), env.venture.id), CA);
});

test('signoff: Send to CA after reading, then the CA signs with their membership number; the record keeps what it covered', async () => {
  const env = await setup();
  await setCaOfRecord(env.deps, owner, CA);
  env.advance(1000);
  const asked = await requestCaSignoff(env.deps, owner, request());

  let rows = signoffs(await list(env)).filter(row => row.id.startsWith('ca-signoff:'));
  assert.equal(rows.length, 1);
  const [send] = rows;
  assert.equal(send.id, `ca-signoff:${asked.id}:send`);
  assert.equal(send.title, "GST working for October 2025 needs your CA's sign-off");
  assert.equal(send.line, 'For Cafe Aroma Demo. Nothing regulated leaves Chausar until CA Asha Rao signs it.');
  assert.deepEqual(send.actions.map(item => [item.id, item.primary, item.requiresView ?? false]), [['read', false, false], ['send-to-ca', true, true]]);
  assert.deepEqual(send.viewRef, { kind: 'file', id: asked.id });

  assert.deepEqual([(await decide(env, send, 'send-to-ca')).reason], ['VIEW_FIRST']);
  await assert.rejects(call(env, 'venture.queue.decide', { id: send.id, digest: send.digest, action: 'send-to-ca', viewed: true }, phone), code('APP_APPROVAL_REQUIRED'));
  const sent = await decide(env, send, 'send-to-ca', { viewed: true });
  assert.deepEqual([sent.outcome, sent.line], ['done', 'Waiting for CA Asha Rao (ICAI 123456) to sign off.']);

  rows = signoffs(await list(env)).filter(row => row.id.startsWith('ca-signoff:'));
  assert.equal(rows.length, 1);
  const [sign] = rows;
  assert.equal(sign.id, `ca-signoff:${asked.id}:sign`);
  assert.equal(sign.title, 'CA Asha Rao to sign off: GST working for October 2025');
  assert.deepEqual(sign.actions.map(item => [item.id, item.primary, item.requiresView ?? false, item.secondAsk ?? false]), [['deny', false, false, false], ['answer', true, true, true]]);

  const wrong = await decide(env, sign, 'answer', { viewed: true, answer: '654321' });
  assert.deepEqual([wrong.outcome, wrong.reason], ['refused', 'CA_MEMBERSHIP_MISMATCH']);
  const signed = await decide(env, sign, 'answer', { viewed: true, answer: '123 456' });
  assert.deepEqual([signed.outcome, signed.line], ['done', 'Signed off by CA Asha Rao (ICAI 123456).']);
  const [record] = listRecords(env.store.read(), 'venture-ca-firm').filter(item => item.entry === 'signoff');
  assert.ok(record && record.entry === 'signoff');
  assert.deepEqual([record.decision, record.caName, record.membershipNumber, record.workingDigest, record.receiptIds, record.recordedBy],
    ['signed', 'CA Asha Rao', '123456', asked.workingDigest, ['ca_0123456789abcdef01234567'], 'owner']);
  assert.deepEqual(signoffs(await list(env)).filter(row => row.id.startsWith('ca-signoff:')), []);
  // Decided once: a second sign-off on the same papers is refused.
  await assert.rejects(recordCaSignoff(env.deps, owner, { requestId: asked.id, decision: 'signed', membershipNumber: '123456' }), code('SIGNOFF_NOT_FOUND'));
});

test('signoff: the CA can return papers with a note, which closes the request', async () => {
  const env = await setup();
  await setCaOfRecord(env.deps, owner, CA);
  const asked = await requestCaSignoff(env.deps, owner, request('TDS working for the September quarter'));
  const send = signoffs(await list(env)).find(row => row.id === `ca-signoff:${asked.id}:send`)!;
  await decide(env, send, 'send-to-ca', { viewed: true });
  const sign = signoffs(await list(env)).find(row => row.id === `ca-signoff:${asked.id}:sign`)!;
  const returned = await decide(env, sign, 'deny', { answer: 'Rent for August is missing.' });
  assert.deepEqual([returned.outcome, returned.line], ['done', 'Returned to the team. The agents prepare the papers again.']);
  const record = listRecords(env.store.read(), 'venture-ca-firm').find(item => item.entry === 'signoff');
  assert.ok(record && record.entry === 'signoff' && record.decision === 'returned' && record.note === 'Rent for August is missing.');
  assert.equal(signoffs(await list(env)).some(row => row.id.startsWith(`ca-signoff:${asked.id}`)), false);
});

test('signoff: each rate-table version goes to the CA, who confirms it, and only then can real client work use it', async () => {
  const env = await setup();
  await setCaOfRecord(env.deps, owner, CA);
  const input = { assessmentYear: '2026-27' as const, regime: 'new' as const, residency: 'resident' as const, ageBand: 'below-60' as const, salaryMinor: '150000000' };
  assert.throws(() => computeIncomeTax(input, rateUseFor(env.store.read(), env.venture.id, 'client')), code('RATE_UNCONFIRMED'));

  const [send] = signoffs(await list(env));
  assert.match(send.id, /^ca-rates:send:v[a-f0-9]{12}$/);
  assert.equal(send.title, `${RATE_TABLES.length} rate tables need your CA's confirmation`);
  assert.match(send.line!, /version 1/);
  assert.equal((await decide(env, send, 'send-to-ca')).outcome, 'done');

  const [sign] = signoffs(await list(env));
  assert.match(sign.id, /^ca-rates:sign:v[a-f0-9]{12}$/);
  assert.equal(sign.title, `CA Asha Rao to confirm ${RATE_TABLES.length} rate tables`);
  assert.equal((await decide(env, sign, 'answer', { answer: '000000' })).reason, 'CA_MEMBERSHIP_MISMATCH');
  const confirmed = await decide(env, sign, 'answer', { answer: '123456' });
  assert.deepEqual([confirmed.outcome, confirmed.line], ['done', `Confirmed by CA Asha Rao (ICAI 123456): ${RATE_TABLES.length} rate tables.`]);

  assert.deepEqual(unconfirmedRateTables(env.store.read(), env.venture.id), []);
  assert.deepEqual(signoffs(await list(env)), []);
  const receipt = computeIncomeTax(input, rateUseFor(env.store.read(), env.venture.id, 'client'));
  assert.equal(receipt.table?.confirmed, true);
  assert.equal(receipt.table?.confirmedBy, 'CA Asha Rao (ICAI 123456)');
});
