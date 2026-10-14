import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { mailSeed } from '../fakes/mail/index.ts';

test('writeback over the engine in demo mode: practice connections, a consented reminder end to end, Practice, and the refusals', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-writeback-engine-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Writeback', passphrase: 'correct horse battery staple 42', demo: true });

  const rows = await engine.request('writeback.catalogue');
  assert.ok(rows.length >= 20 && rows.every((r: any) => r.idempotency && r.readBack));
  await assert.rejects(engine.request('writeback.request', { system: 'shopify', action: 'theme.publish' }), { code: 'NOT_IN_CATALOGUE' });
  assert.equal((await engine.request('writeback.wanted')).length, 1);
  await assert.rejects(engine.request('writeback.connect', { system: 'mail', label: 'Real mail', environment: 'live', account: {} }), { code: 'DEMO_EXTERNAL_DISABLED' });

  const user = mailSeed.users[0], smtp = mailSeed.smtp[0];
  const mail = await engine.request('writeback.connect', { system: 'mail', label: 'Practice mail', environment: 'practice',
    account: { smtpHost: smtp.host, smtpPort: String(smtp.port), smtpSecurity: smtp.security, from: user.address, imapHost: mailSeed.imap.host, imapPort: String(mailSeed.imap.port), sentFolder: 'Sent' } });
  await assert.rejects(engine.request('writeback.followUp.prepare', { connectionId: mail.id, customerId: 'cust-1', invoiceId: 'inv-1' }), { code: 'FOLLOW_UP_NO_CONSENT' });
  await engine.request('writeback.followUp.consent', { requestId: 'consent-1', customerId: 'cust-1', channel: 'email', destination: 'accounts@cust.example', answer: 'yes', observedOn: '2026-10-01' });
  await assert.rejects(engine.request('writeback.followUp.prepare', { connectionId: mail.id, customerId: 'cust-1', invoiceId: 'inv-1' }), { code: 'WRITE_NOT_GRANTED' });
  await engine.request('writeback.grant', { connectionId: mail.id, write: ['smtp.send'] });
  const prepared = await engine.request('writeback.followUp.prepare', { connectionId: mail.id, customerId: 'cust-1', invoiceId: 'inv-1' });
  assert.equal(prepared.practice, true); assert.match(prepared.preview.asWritten, /₹300\.00/);
  await engine.request('writeback.approve', { id: prepared.id, digest: prepared.digest });
  const done = await engine.request('writeback.execute', { id: prepared.id });
  assert.equal(done.status, 'verified'); assert.equal(done.word, 'done');
  assert.deepEqual((await engine.request('writeback.followUp.journal')).map((j: any) => j.kind), ['sent']);
  assert.equal((await engine.request('writeback.ledger')).length, 1);
  assert.equal((await engine.request('writeback.get', { id: prepared.id })).readBack.settledBy, 'system');

  const practice = await engine.request('writeback.practice', { steps: [{ system: 'zoho-books', action: 'invoice.createDraft', payload: { customerId: '460000000001001', date: '2026-10-14', lines: [{ name: 'Boxes', quantity: 1, rateMinor: '10000' }] } }] });
  assert.equal(practice.sent, 0); assert.equal(practice.steps[0].outcome, 'would-be-done');
  const qualified = await engine.request('writeback.qualify');
  assert.ok(qualified.rows.every((r: any) => r.score === '3/3'));
  const settings = await engine.request('writeback.configure', { approvalHours: { 'seen-outside': 12 } });
  assert.equal(settings.approvalHours['seen-outside'], 12);
  assert.ok(engine.vault!.read().actions.every((a: any) => a.connector !== 'wb-zoho-books'), 'Practice leaves no action behind');
});
