import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { tallySeed } from '../fakes/tally/index.ts';
import { zohoSeed } from '../fakes/zoho-books/index.ts';

/**
 * Small apps over the installed writeback module, through the real engine. Practice connections
 * (`environment: 'practice'`) serve the systems from the writeback fakes, so nothing leaves the
 * machine; the demo workspace keeps every live system refused.
 */
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };
async function demoShop(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-mx-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', modules: { 'models-ext': { clock: () => '2026-10-14T09:00:00.000Z' } } });
  t.after(async () => { try { await engine.request('workspace.lock'); } catch { /* already locked */ } await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Demo Shop', passphrase: 'correct horse battery staple 42', demo: true, pack: 'ecommerce' });
  return engine;
}
const stored = (engine: Engine, id: string) => (engine.vault!.read().actions as any[]).find(a => a.id === id);
const voucher = (voucherNumber: string, extra: Record<string, unknown> = {}) => ({ company: tallySeed.company, voucherType: 'Sales', voucherNumber, date: '2026-10-14', party: 'Kiran Stores (synthetic)',
  lines: [{ ledger: 'Kiran Stores (synthetic)', amountMinor: '250050', side: 'debit' }, { ledger: 'Sales', amountMinor: '250050', side: 'credit' }], ...extra });

test('end to end: a Tally voucher card is a real writeback row; a press prepares through writeback.prepare and stops at approval', async t => {
  const engine = await demoShop(t);
  const proposed = await engine.request('smallapps.propose', { line: 'sales this month with a tally voucher button' });
  assert.equal(proposed.catalogue.writeback, 'used'); assert.equal(proposed.catalogue.notCounted, 0);
  assert.deepEqual(proposed.descriptor.uses.actions, ['tally/voucher.create']);
  assert.deepEqual(proposed.actions.map((a: any) => [a.action, a.alwaysWaits, a.tier]), [['tally/voucher.create', false, 1]]);
  const app = await engine.request('smallapps.create', { descriptor: proposed.descriptor });
  const card = app.descriptor.cards.find((c: any) => c.kind === 'action');
  assert.deepEqual([card.connector, card.operation], ['tally', 'voucher.create']);
  const press = (payload: unknown, more: Record<string, unknown> = {}) => engine.request('smallapps.pressAction', { id: app.id, cardId: card.id, payload, ...more });

  // No connection allowed to write vouchers yet: the card says so and a press prepares nothing.
  let opened = await engine.request('smallapps.open', { id: app.id });
  assert.equal(opened.cards.find((c: any) => c.kind === 'action').press, 'needs-connection');
  await assert.rejects(press(voucher('S-201')), code('SMALLAPP_CONNECTION_NOT_GRANTED'));
  const tally = await engine.request('writeback.connect', { system: 'tally', label: 'Practice Tally', environment: 'practice', account: { host: '127.0.0.1', port: '9000', company: tallySeed.company } });
  await assert.rejects(press(voucher('S-201')), code('SMALLAPP_CONNECTION_NOT_GRANTED')); // reading never grants writing
  await engine.request('writeback.grant', { connectionId: tally.id, write: ['voucher.create'] });
  opened = await engine.request('smallapps.open', { id: app.id });
  const shown = opened.cards.find((c: any) => c.kind === 'action');
  assert.equal(shown.press, 'prepares-for-approval'); assert.equal(shown.alwaysWaits, false); assert.equal(shown.tier, 1);
  assert.deepEqual(shown.connections, [{ id: tally.id, label: 'Practice Tally', environment: 'practice', practice: true }]);

  // The payload is checked against the real schema: required fields here, the Tally adapter's strict validation in writeback.prepare.
  const { lines: _lines, ...noLines } = voucher('S-201');
  await assert.rejects(press(noLines), code('SMALLAPP_PAYLOAD_INVALID'));
  await assert.rejects(press(voucher('S-201', { lines: [{ ledger: 'Kiran Stores (synthetic)', amountMinor: '250050', side: 'debit' }, { ledger: 'Sales', amountMinor: '100', side: 'credit' }] })), code('INVALID_VOUCHER_UNBALANCED'));
  await assert.rejects(press(voucher('S-201', { approved: true })), code('INVALID_WRITE_PAYLOAD'));
  await assert.rejects(press(voucher('S-201', { lines: [{ ledger: 'Kiran Stores (synthetic)', amountMinor: '2500.50', side: 'debit' }, { ledger: 'Sales', amountMinor: '2500.50', side: 'credit' }] })), code('INVALID_AMOUNT'));
  await assert.rejects(press(voucher('S-201', { voucherType: 'Memo' })), code('INVALID_WRITE_PAYLOAD'));
  assert.equal((await engine.request('writeback.ledger')).length, 0);

  const pressed = await press(voucher('S-201'), { idempotencyKey: 'voucher-S-201' });
  assert.equal(pressed.action.status, 'prepared'); assert.equal(pressed.action.through, 'writeback'); assert.equal(pressed.action.practice, true);
  assert.equal(pressed.action.connectionId, tally.id); assert.equal(pressed.action.impact, 'reversible');
  assert.deepEqual({ ...pressed.approval, id: null, digest: null }, { waits: true, alwaysWaits: false, tier: 1, kind: 'action', id: null, digest: null, secondAsk: false, approveWith: 'writeback.approve' });
  assert.match(pressed.words, /^Practice: nothing goes to a real system\. Prepared only/);
  // It is a writeback action waiting for a person: nothing approved, nothing attempted.
  const got = await engine.request('writeback.get', { id: pressed.action.id });
  assert.equal(got.status, 'prepared'); assert.equal(got.word, 'waiting-for-you'); assert.equal(got.digest, pressed.action.digest);
  assert.deepEqual([got.system, got.action, got.practice], ['tally', 'voucher.create', true]);
  assert.deepEqual(got.approval.can, ['approve', 'notNow', 'change', 'drop']);
  const action = stored(engine, pressed.action.id);
  assert.equal(action.connector, 'wb-tally'); assert.equal(action.approval, undefined); assert.deepEqual(action.attempts, []);
  // Idempotency is writeback's: the same intent and payload is the same action; another payload under it is refused.
  assert.equal((await press(voucher('S-201'), { idempotencyKey: 'voucher-S-201' })).action.id, pressed.action.id);
  await assert.rejects(press(voucher('S-202'), { idempotencyKey: 'voucher-S-201' }), code('IDEMPOTENCY_CONFLICT'));
  assert.equal((await engine.request('writeback.ledger')).length, 1);
  assert.deepEqual((await engine.request('smallapps.get', { id: app.id })).uses.actions, ['tally/voucher.create']);
});

test('end to end: an always-waits refund card is marked, its press needs the second ask to approve, and nothing is approved or done', async t => {
  const engine = await demoShop(t);
  const razorpay = await engine.request('writeback.connect', { system: 'razorpay', label: 'Practice Razorpay', environment: 'practice', account: {} });
  await engine.request('writeback.grant', { connectionId: razorpay.id, write: ['refund.create'] });
  const proposed = await engine.request('smallapps.propose', { line: 'sales this month with a refund button' });
  assert.deepEqual(proposed.descriptor.uses.actions, ['razorpay/refund.create']);
  assert.match(proposed.message, /always waits for a person/);
  const app = await engine.request('smallapps.create', { descriptor: proposed.descriptor });
  const card = app.descriptor.cards.find((c: any) => c.kind === 'action');
  const shown = (await engine.request('smallapps.open', { id: app.id })).cards.find((c: any) => c.kind === 'action');
  assert.equal(shown.alwaysWaits, true); assert.equal(shown.tier, 2); assert.match(shown.words, /Always waits for a person/);
  const pressed = await engine.request('smallapps.pressAction', { id: app.id, cardId: card.id, payload: { paymentId: 'pay_SYNTH00000001A', amountMinor: '50000' } });
  assert.equal(pressed.action.impact, 'money');
  assert.equal(pressed.approval.alwaysWaits, true); assert.equal(pressed.approval.secondAsk, true); assert.equal(pressed.approval.reauthWith, 'writeback.reauth');
  assert.match(pressed.words, /waits for a person/); assert.match(pressed.words, /passphrase again/);
  // The press is exactly what writeback.approve takes, and without the second ask it approves nothing.
  await assert.rejects(engine.request('writeback.approve', { id: pressed.action.id, digest: pressed.action.digest }), code('REAUTH_REQUIRED'));
  const action = stored(engine, pressed.action.id);
  assert.equal(action.status, 'prepared'); assert.equal(action.approval, undefined); assert.deepEqual(action.attempts, []);
});

test('end to end: with two connections a Zoho invoice press names one; a viewer only reads', async t => {
  const engine = await demoShop(t);
  const account = { organizationId: zohoSeed.organizationId, dataCenter: 'in' };
  const first = await engine.request('writeback.connect', { system: 'zoho-books', label: 'Practice Zoho one', environment: 'practice', account });
  const second = await engine.request('writeback.connect', { system: 'zoho-books', label: 'Practice Zoho two', environment: 'practice', account });
  for (const c of [first, second]) await engine.request('writeback.grant', { connectionId: c.id, write: ['invoice.createDraft'] });
  const proposed = await engine.request('smallapps.propose', { line: 'sales this month with a draft invoice button' });
  assert.deepEqual(proposed.descriptor.uses.actions, ['zoho-books/invoice.createDraft']);
  const app = await engine.request('smallapps.create', { descriptor: proposed.descriptor });
  const card = app.descriptor.cards.find((c: any) => c.kind === 'action');
  const payload = { customerId: '460000000001001', date: '2026-10-14', lines: [{ name: 'Boxes', quantity: 1, rateMinor: '10000' }] };
  await assert.rejects(engine.request('smallapps.pressAction', { id: app.id, cardId: card.id, payload }), code('SMALLAPP_CONNECTION_REQUIRED'));
  await assert.rejects(engine.request('smallapps.pressAction', { id: app.id, cardId: card.id, payload, connectionId: 'connection_unknown' }), code('SMALLAPP_CONNECTION_NOT_GRANTED'));
  const pressed = await engine.request('smallapps.pressAction', { id: app.id, cardId: card.id, payload, connectionId: second.id });
  assert.equal(pressed.action.connectionId, second.id); assert.equal(pressed.action.status, 'prepared');
  assert.equal((await engine.request('writeback.get', { id: pressed.action.id })).connection.id, second.id);
  // A viewer sees the card as read-only and cannot press.
  const member = await engine.request('members.add', { name: 'Viewer', role: 'viewer', branches: ['*'] });
  const viewer = { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' as const };
  assert.equal((await engine.requestAs(viewer, 'smallapps.open', { id: app.id })).cards.find((c: any) => c.kind === 'action').press, 'read-only');
  await assert.rejects(engine.requestAs(viewer, 'smallapps.pressAction', { id: app.id, cardId: card.id, payload, connectionId: second.id }), code('FORBIDDEN'));
  assert.equal((await engine.request('writeback.ledger')).length, 1);
});
