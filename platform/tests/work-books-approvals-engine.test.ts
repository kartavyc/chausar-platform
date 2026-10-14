import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { mailSeed } from '../fakes/mail/index.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };
const mailAccount = () => {
  const user = mailSeed.users[0], smtp = mailSeed.smtp[0];
  return { smtpHost: smtp.host, smtpPort: String(smtp.port), smtpSecurity: smtp.security, from: user.address, imapHost: mailSeed.imap.host, imapPort: String(mailSeed.imap.port), sentFolder: 'Sent' };
};
async function demoEngine(t: { after(fn: () => Promise<void>): void }, demoWorkspace: boolean) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-work-books-approvals-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', demoWorkspace
    ? { name: 'Synthetic Approvals Shop', passphrase: 'Synthetic approvals passphrase 2026', demo: true }
    : { name: 'Synthetic Approvals Shop', passphrase: 'Synthetic approvals passphrase 2026', demo: false, pack: 'ecommerce', folder: 'main' });
  return { engine, directory };
}

test('the real engine routes approvals.* over a prepared local reminder draft, end to end', async t => {
  const { engine } = await demoEngine(t, false);
  const prepared = await engine.request('actions.prepare', { connector: 'local', operation: 'reminder-draft', payload: { invoiceId: 'invoice-a', text: 'Your invoice is due on Friday.' }, idempotencyKey: 'reminder-invoice-a-2026-10' });
  const id = `action:${prepared.id}`;

  const list = await engine.request('approvals.list', {});
  assert.deepEqual(list.items.map((i: any) => i.id), [id]);
  assert.equal(list.items[0].tier, 'tier-1'); assert.equal(list.items[0].kind, 'record-change'); assert.equal(list.items[0].title, 'Create a payment reminder draft');
  assert.equal(list.items[0].touches, 'Chausar local workspace: invoice-a');
  assert.deepEqual(list.counts, { tier2: 0, tier1: 1, prepareOnly: 0 }); assert.deepEqual(list.expired, []);

  const sheet = await engine.request('approvals.get', { id });
  assert.equal(sheet.digest, prepared.digest); assert.equal(sheet.reason, 'autonomy-off'); assert.equal(sheet.needsSecondAsk, false);
  assert.deepEqual(sheet.can, ['approve', 'notNow', 'change', 'drop']); assert.equal(sheet.steps.length, 5);
  // The write catalogue joins the core rows with its real fields.
  const cat = await engine.request('approvals.catalogue', {});
  assert.equal(cat.writeback.available, true);
  const mailRow = cat.rows.find((r: any) => r.system === 'mail' && r.action === 'smtp.send');
  assert.equal(mailRow.source, 'writeback'); assert.equal(mailRow.kind, 'seen-outside'); assert.equal(mailRow.waits, true); assert.ok(['live', 'experimental'].includes(mailRow.status));
  const gst = await engine.request('approvals.catalogueEntry', { system: 'gst-portal', action: 'return.file' });
  assert.equal(gst.status, 'prepare-only'); assert.equal(gst.systemTitle, 'GST portal'); assert.equal(gst.retryWindow, null); assert.match(gst.expires, /^\d{4}-\d\d-\d\d$/);
  assert.equal(typeof gst.businessReference, 'string'); assert.equal(typeof gst.approvalLifetime, 'string'); assert.ok(Array.isArray(gst.connections));

  await assert.rejects(engine.request('approvals.approve', { id, digest: '0'.repeat(64) }), code('PREVIEW_CHANGED'));
  const approved = await engine.request('approvals.approve', { id, digest: sheet.digest });
  assert.equal(approved.state, 'approved');
  const done = await engine.request('approvals.execute', { id });
  assert.equal(done.state, 'verified'); assert.deepEqual(done.steps.map((s: any) => s.state), ['done', 'done', 'done', 'done', 'done']);
  assert.ok(done.readBack.every((r: any) => r.same)); assert.equal(done.channel, 'desktop');
  await assert.rejects(engine.request('approvals.execute', { id }), code('ACTION_ALREADY_ATTEMPTED'));

  const ledger = await engine.request('approvals.ledger', {});
  assert.deepEqual(ledger.items.map((i: any) => [i.id, i.state]), [[id, 'verified']]);
  assert.equal((await engine.request('approvals.list', {})).items.length, 0);
  assert.equal((await engine.request('approvals.afterRestore', {})).sendingClosed, false);
  assert.equal((await engine.request('approvals.practice', { id })).code, 'PRACTICE_NOT_AVAILABLE', 'write-back practises only its own actions');
  assert.equal(typeof (await engine.request('approvals.jobs', {})).proposals.available, 'boolean');
});

test('a write-back mail against a practice connection runs list → get → practice → approve → execute → ledger', async t => {
  const { engine } = await demoEngine(t, true);
  const mail = await engine.request('writeback.connect', { system: 'mail', label: 'Practice mail', environment: 'practice', account: mailAccount() });
  await engine.request('writeback.grant', { connectionId: mail.id, write: ['smtp.send'] });
  const prepared = await engine.request('writeback.prepare', { connectionId: mail.id, action: 'smtp.send', intentId: 'work-books-mail-1', payload: { to: ['accounts@cust.example'], subject: 'Statement', body: 'Your statement is attached.' } });
  const id = `writeback:${prepared.id}`;

  const list = await engine.request('approvals.list', {});
  const row = list.items.find((i: any) => i.id === id);
  assert.equal(row.source, 'writeback'); assert.equal(row.tier, 'tier-2'); assert.equal(row.kind, 'message'); assert.equal(row.practice, true);
  assert.match(row.touches, /^Your own mail server: /); assert.equal(list.counts.tier2, 1);

  const sheet = await engine.request('approvals.get', { id });
  assert.equal(sheet.digest, prepared.digest); assert.equal(sheet.reason, 'always-waits:message'); assert.match(sheet.change.asWritten, /Your statement is attached\./);
  assert.deepEqual(sheet.can, ['approve', 'notNow', 'change', 'drop']); assert.equal(sheet.needsSecondAsk, false);
  assert.equal(sheet.writeback.system, 'mail'); assert.equal(sheet.writeback.connection.environment, 'practice'); assert.ok(sheet.writeback.waitsBecause.length > 0);
  assert.deepEqual(sheet.steps.map((s: any) => s.state), ['done', 'waiting-for-you', 'not-reached', 'not-reached', 'not-reached']);
  assert.equal(sheet.reminder, undefined, 'a plain mail is not a customer reminder');

  const tried = await engine.request('approvals.practice', { id });
  assert.equal(tried.available, true); assert.equal(tried.outcome, 'would-be-done'); assert.match(tried.wouldSend, /Your statement is attached\./);

  // Change rewrites the body: a new exact change, so the old digest is refused.
  const changed = await engine.request('approvals.change', { id, payload: { asWritten: 'Your statement for September is attached.' } });
  assert.equal(changed.revision, 2); assert.notEqual(changed.digest, sheet.digest); assert.deepEqual(changed.blocked, { kind: 'changed', code: 'PREPARED_AGAIN' });
  await assert.rejects(engine.request('approvals.approve', { id, digest: sheet.digest }), code('PREVIEW_CHANGED'));
  await assert.rejects(engine.request('approvals.approve', { id, digest: changed.digest, reauth: 'not asked' }), code('INVALID_APPROVAL'));
  const approved = await engine.request('approvals.approve', { id, digest: changed.digest });
  assert.equal(approved.state, 'approved'); assert.deepEqual(approved.can, ['drop']);
  await assert.rejects(engine.request('approvals.reverse', { id }), code('REVERSAL_NOT_AVAILABLE'));

  const done = await engine.request('approvals.execute', { id });
  assert.equal(done.state, 'verified'); assert.deepEqual(done.steps.map((s: any) => s.state), ['done', 'done', 'done', 'done', 'done']);
  assert.ok(done.readBack.length > 0 && done.readBack.every((r: any) => r.same)); assert.equal(done.channel, 'desktop'); assert.equal(done.approvedBy, 'Workspace owner');
  assert.equal(done.writeback.settledBy, 'system');
  await assert.rejects(engine.request('approvals.execute', { id }), code('ACTION_ALREADY_ATTEMPTED'));

  const ledger = await engine.request('approvals.ledger', {});
  const entry = ledger.items.find((i: any) => i.id === id);
  assert.equal(entry.state, 'verified'); assert.equal(entry.request.subject, 'Statement'); assert.equal(entry.rule, 'always-waits:message');
  assert.equal((await engine.request('approvals.action', { id })).state, 'verified');
  assert.equal((await engine.request('approvals.list', {})).items.some((i: any) => i.id === id), false);

  // Drop goes through write-back too.
  const other = await engine.request('writeback.prepare', { connectionId: mail.id, action: 'smtp.send', intentId: 'work-books-mail-2', payload: { to: ['accounts@cust.example'], subject: 'Hello', body: 'A second note.' } });
  assert.deepEqual(await engine.request('approvals.drop', { id: `writeback:${other.id}` }), { id: `writeback:${other.id}`, state: 'cancelled' });
  assert.equal((await engine.request('writeback.get', { id: other.id })).status, 'cancelled');
  // A wanted action for a system write-back knows is counted on write-back's own list.
  const wanted = await engine.request('approvals.wanted', { system: 'Shopify', text: 'Publish a theme' });
  assert.equal(wanted.writeback, 'counted');
  assert.ok((await engine.request('writeback.wanted', {})).some((w: any) => w.system === 'shopify'));
});

test('a customer reminder shows its agreement, limits and the owner-only payment notes; blocked at prepare says why', async t => {
  const { engine } = await demoEngine(t, true);
  const mail = await engine.request('writeback.connect', { system: 'mail', label: 'Practice mail', environment: 'practice', account: mailAccount() });
  await engine.request('writeback.grant', { connectionId: mail.id, write: ['smtp.send'] });
  const blocked = await engine.request('approvals.prepareReminder', { connectionId: mail.id, customerId: 'cust-1', invoiceId: 'inv-1' });
  assert.deepEqual(blocked, { id: null, blocked: { code: 'FOLLOW_UP_NO_CONSENT', reason: 'No reminder: this customer has not agreed to reminders.' } });
  await engine.request('writeback.followUp.consent', { requestId: 'consent-1', customerId: 'cust-1', channel: 'email', destination: 'accounts@cust.example', answer: 'yes', observedOn: '2026-10-01', sourceId: 'signed-form-7' });
  const made = await engine.request('approvals.prepareReminder', { connectionId: mail.id, customerId: 'cust-1', invoiceId: 'inv-1' });
  assert.match(made.id, /^writeback:/); assert.equal(made.blocked, null);

  const sheet = await engine.request('approvals.get', { id: made.id });
  assert.equal(sheet.preparedBy.kind, 'job'); assert.deepEqual(sheet.amount, { minor: '30000' });
  const r = sheet.reminder;
  assert.equal(r.customerId, 'cust-1'); assert.equal(r.invoiceId, 'inv-1'); assert.equal(r.channel, 'email'); assert.match(r.asWritten, /Invoice inv-1 has ₹300\.00 due/);
  assert.deepEqual(r.agreement, [{ channel: 'email', answer: 'yes', source: 'signed-form-7', on: '2026-10-01' }, { channel: 'whatsapp', answer: 'not-asked', source: null, on: null }]);
  assert.equal(r.stoppedOn, null); assert.equal(r.blocked, null);
  assert.deepEqual(r.notes.map((n: any) => [n.id, n.checkedOn, n.notLegalAdvice]), [['msmed-45-days', '2026-10-14', true], ['it-43b-h', '2026-10-14', true]]);
  assert.match(r.notes[0].source, /Micro, Small and Medium Enterprises Development Act, 2006/); assert.match(r.notes[1].source, /43B\(h\)/);
  assert.equal(r.caps.perDay, 20); assert.equal(r.caps.perCustomer, 1); assert.equal(r.caps.preparedOnDay, 1); assert.equal(r.caps.reached, false); assert.equal(r.caps.customerReached, true);
  assert.equal((await engine.request('approvals.prepareReminder', { connectionId: mail.id, customerId: 'cust-1', invoiceId: 'inv-1', language: 'hi' })).blocked.code, 'FOLLOW_UP_DAILY_CAP');

  await engine.request('writeback.configure', { reminderCapPerDay: 1 });
  assert.equal((await engine.request('approvals.get', { id: made.id })).reminder.caps.reached, true);

  // The customer says stop: the flag shows, and the sheet is blocked before anyone approves.
  await engine.request('writeback.followUp.consent', { requestId: 'consent-2', customerId: 'cust-1', channel: 'email', destination: 'accounts@cust.example', answer: 'stopped', observedOn: '2026-10-02' });
  const stopped = await engine.request('approvals.get', { id: made.id });
  assert.equal(stopped.reminder.stoppedOn, '2026-10-02'); assert.equal(stopped.reminder.blocked.code, 'FOLLOW_UP_STOPPED');
  assert.deepEqual(stopped.blocked, { kind: 'prepare-blocked', code: 'FOLLOW_UP_STOPPED' }); assert.equal(stopped.can.includes('approve'), false);
  await assert.rejects(engine.request('approvals.approve', { id: made.id, digest: stopped.digest }), code('INVALID_APPROVAL_STATE'));
});

test('a prepare-only GST return downloads as the prepared file and a checklist into the exports folder', async t => {
  const { engine, directory } = await demoEngine(t, true);
  const gst = await engine.request('writeback.connect', { system: 'gst-portal', label: 'Practice GST', environment: 'practice', account: { gstin: '27ABCDE1234F1Z5' } });
  const prepared = await engine.request('writeback.prepare', { connectionId: gst.id, action: 'return.file', intentId: 'gst-2026-09', payload: { gstin: '27ABCDE1234F1Z5', period: '2026-09', form: 'GSTR-3B' } });
  const id = `writeback:${prepared.id}`;
  const sheet = await engine.request('approvals.get', { id });
  assert.equal(sheet.tier, 'prepare-only'); assert.equal(sheet.prepareOnly, true); assert.equal(sheet.can.includes('approve'), false);
  assert.equal((await engine.request('approvals.list', {})).counts.prepareOnly, 1);
  await assert.rejects(engine.request('approvals.approve', { id, digest: sheet.digest }), code('PREPARE_ONLY'));

  const out = await engine.request('approvals.exportPrepared', { id });
  assert.equal(out.files.length, 2);
  for (const file of out.files) {
    assert.match(file.name, /^chausar-prepared-\d{8}-\d{6}Z-[A-Za-z0-9]{1,12}-(prepared\.json|checklist\.txt)$/);
    assert.equal(dirname(file.path), join(directory, 'exports'));
    assert.equal((await readFile(file.path)).byteLength, file.bytes);
  }
  const json = JSON.parse(await readFile(out.files[0].path, 'utf8'));
  assert.deepEqual([json.form, json.gstin, json.period], ['GSTR-3B', '27ABCDE1234F1Z5', '2026-09']);
  const checklist = await readFile(out.files[1].path, 'utf8');
  assert.match(checklist, /Chausar never files a return\./); assert.match(checklist, new RegExp(sheet.digest));
  const again = await engine.request('approvals.exportPrepared', { id });
  assert.notEqual(again.files[0].name, out.files[0].name, 'an earlier file is never replaced');

  const local = await engine.request('actions.prepare', { connector: 'local', operation: 'reminder-draft', payload: { invoiceId: 'invoice-a', text: 'Due Friday.' }, idempotencyKey: 'reminder-invoice-a-export' });
  await assert.rejects(engine.request('approvals.exportPrepared', { id: `action:${local.id}` }), code('NOT_PREPARE_ONLY'));
});
