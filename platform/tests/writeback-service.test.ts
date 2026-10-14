import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { WritebackService, readState } from '../runtime/writeback/service.ts';
import type { WritebackPorts } from '../runtime/writeback/service.ts';
import { installedAdapters } from '../runtime/writeback/systems/index.ts';
import { CATALOGUE } from '../runtime/writeback/catalogue.ts';
import { qualify, runPractice } from '../runtime/writeback/practice.ts';
import { fakeFactory, qualificationCases } from '../fakes/index.ts';
import { ZohoBooksFake, zohoSeed } from '../fakes/zoho-books/index.ts';
import { MailFake, mailSeed } from '../fakes/mail/index.ts';

class Store implements StateStore {
  state: State = initialState('Writeback test'); queue = Promise.resolve();
  read() { return structuredClone(this.state); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> { const run = this.queue.then(async () => { const draft = structuredClone(this.state); const result = await change(draft); draft.revision += 1; this.state = draft; return result; }); this.queue = run.then(() => {}, () => {}); return run; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const accountant: Context = { memberId: 'accountant', role: 'accountant', epoch: 1, channel: 'desktop' };
const customer = '460000000001001', invoice = '460000000002001';

function setup(options: { mailImap?: boolean } = {}) {
  const store = new Store(); store.state.members.push({ id: 'accountant', name: 'Accountant', role: 'accountant', active: true, epoch: 1, branches: ['*'] });
  const zoho = new ZohoBooksFake(); const mail = new MailFake(mailSeed);
  let at = Date.parse('2026-10-14T04:00:00.000Z'); const clock = () => new Date(at).toISOString();
  const user = mailSeed.users[0];
  const ports: WritebackPorts = { http: zoho.transport, dial: mail.dial!, clock, directory: mkdtempSync(join(tmpdir(), 'chausar-writeback-')), demo: false, adapters: installedAdapters(),
    credentials: async (_ctx, scope): Promise<Record<string, string>> => scope.system === 'mail' ? { username: user.username, password: user.password } : { accessToken: zohoSeed.token } };
  const service = new WritebackService(store, ports);
  const connect = async (system: 'zoho-books' | 'mail', write: string[]) => {
    const account = system === 'zoho-books' ? { organizationId: zohoSeed.organizationId, dataCenter: 'in' }
      : { smtpHost: mailSeed.smtp[0].host, smtpPort: String(mailSeed.smtp[0].port), smtpSecurity: mailSeed.smtp[0].security, from: user.address, ...(options.mailImap === false ? {} : { imapHost: mailSeed.imap.host, imapPort: String(mailSeed.imap.port), sentFolder: 'Sent' }) };
    const connection = await service.connect(owner, { system, label: `Sandbox ${system}`, environment: 'sandbox', account });
    if (write.length) await service.grant(owner, { connectionId: connection.id, write });
    return connection;
  };
  return { store, zoho, mail, service, ports, connect, advance: (hours: number) => { at += hours * 3600 * 1000; } };
}
const draft = { customerId: customer, date: '2026-10-14', lines: [{ name: 'Packing boxes', quantity: 3, rateMinor: '25050' }] };
const message = { to: ['accounts@asha.example'], subject: 'Payment reminder: invoice INV-000101', body: 'Hello. Invoice INV-000101 has a balance due.' };

test('every catalogue row states its idempotency, read-back, retry window, tier and waiting rule', () => {
  assert.ok(CATALOGUE.length >= 20);
  for (const row of CATALOGUE) {
    for (const field of ['system', 'action', 'kind', 'idempotency', 'businessReference', 'readBack', 'reviewedOn', 'expiresOn', 'waitsBecause'] as const) assert.ok(row[field], `${row.system}/${row.action} ${field}`);
    assert.ok(row.retryWindowHours === null || row.retryWindowHours > 0); assert.ok(row.approvalLifetimeHours > 0);
    if (row.kind !== 'inside-undoable') assert.equal(row.alwaysWaits, true, `${row.action} must always wait`);
  }
  assert.equal(CATALOGUE.find(r => r.system === 'gst-portal')!.tier, 'prepare-only');
  const { service } = setup();
  assert.ok(service.catalogue(owner).every(row => row.installed), 'every listed row has an installed adapter');
  assert.ok(service.catalogue(owner).every(row => row.status !== 'live'), 'nothing shows live before sandbox evidence');
});

test('a request outside the list is refused and lands on the wanted list', async () => {
  const { service, connect } = setup(); const c = await connect('zoho-books', ['invoice.createDraft']);
  await assert.rejects(service.prepare(owner, { connectionId: c.id, action: 'invoice.delete', payload: {}, intentId: 'x-1' }), { code: 'NOT_IN_CATALOGUE' });
  await assert.rejects(service.refuseUnlisted(owner, 'shopify', 'theme.publish'), { code: 'NOT_IN_CATALOGUE' });
  assert.deepEqual(service.wanted(owner).map(w => `${w.system}/${w.action}`), ['zoho-books/invoice.delete', 'shopify/theme.publish']);
});

test('reading a system never grants writing; an accountant prepares but cannot approve; imported text cannot approve', async () => {
  const { service, connect } = setup(); const c = await connect('zoho-books', []);
  await assert.rejects(service.prepare(owner, { connectionId: c.id, action: 'invoice.createDraft', payload: draft, intentId: 'inv-1' }), { code: 'WRITE_NOT_GRANTED' });
  await service.grant(owner, { connectionId: c.id, write: ['invoice.createDraft'] });
  const prepared: any = await service.prepare(accountant, { connectionId: c.id, action: 'invoice.createDraft', payload: draft, intentId: 'inv-1' });
  await assert.rejects(service.approve(accountant, prepared.id, prepared.digest), { code: 'FORBIDDEN' });
  await assert.rejects(service.approve({ ...owner, sourceTainted: true }, prepared.id, prepared.digest), { code: 'TAINTED_APPROVAL' });
  await assert.rejects(service.grant(accountant, { connectionId: c.id, write: ['payment.record'] }), { code: 'FORBIDDEN' });
});

test('five steps: prepared, approved, done once, read back field by field, recorded', async () => {
  const { service, connect, zoho } = setup(); const c = await connect('zoho-books', ['invoice.createDraft']);
  const prepared: any = await service.prepare(owner, { connectionId: c.id, action: 'invoice.createDraft', payload: draft, intentId: 'inv-1' });
  assert.equal(prepared.word, 'waiting-for-you'); assert.equal(prepared.approval.tier, 1); assert.equal(prepared.approval.kind, 'record-change');
  assert.equal(prepared.expiresAt, '2026-10-21T04:00:00.000Z');
  assert.equal((await service.prepare(owner, { connectionId: c.id, action: 'invoice.createDraft', payload: draft, intentId: 'inv-1' }) as any).id, prepared.id);
  await assert.rejects(service.prepare(owner, { connectionId: c.id, action: 'invoice.createDraft', payload: { ...draft, date: '2026-10-15' }, intentId: 'inv-1' }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(service.execute(owner, prepared.id), { code: 'APPROVAL_REQUIRED' });
  await service.approve(owner, prepared.id, prepared.digest);
  const done: any = await service.execute(owner, prepared.id);
  assert.equal(done.status, 'verified'); assert.equal(done.word, 'done');
  assert.deepEqual(done.steps.map((s: any) => s.state), ['done', 'done', 'done', 'done', 'done']);
  assert.ok(done.readBack.comparison.every((f: any) => f.match)); assert.equal(done.readBack.settledBy, 'system');
  await assert.rejects(service.execute(owner, prepared.id), { code: 'ACTION_ALREADY_ATTEMPTED' });
  assert.equal(zoho.invoices.length, 2); assert.equal(service.ledger(owner).length, 1);
});

test('a lost reply is not sure, is settled by reading back, and never sent again — also after a restart', async () => {
  const { service, connect, zoho, store, ports } = setup(); const c = await connect('zoho-books', ['payment.record']);
  const prepared: any = await service.prepare(owner, { connectionId: c.id, action: 'payment.record', payload: { customerId: customer, invoiceId: invoice, amountMinor: '60000', date: '2026-10-14', mode: 'upi' }, intentId: 'pay-1' });
  await service.approve(owner, prepared.id, prepared.digest);
  zoho.fault('drop-after-commit');
  const unsure: any = await service.execute(owner, prepared.id);
  assert.equal(unsure.status, 'unknown'); assert.equal(unsure.word, 'not-sure'); assert.equal(zoho.payments.length, 1);
  const restarted = new WritebackService(store, ports);
  await assert.rejects(restarted.execute(owner, prepared.id), { code: 'ACTION_ALREADY_ATTEMPTED' });
  const settled: any = await restarted.readBack(owner, prepared.id);
  assert.equal(settled.status, 'verified'); assert.equal(zoho.payments.length, 1);
});

test('a yes covers one exact change for a limited time: expiry drops it and a changed target prepares again', async () => {
  const { service, connect, zoho, advance, mail } = setup(); const m = await connect('mail', ['smtp.send']); const z = await connect('zoho-books', ['contact.update']);
  const reminder: any = await service.prepare(owner, { connectionId: m.id, action: 'smtp.send', payload: message, intentId: 'mail-1' });
  assert.equal(reminder.approval.kind, 'message'); assert.equal(reminder.alwaysWaits, true);
  await service.approve(owner, reminder.id, reminder.digest); advance(25);
  const expired: any = await service.execute(owner, reminder.id);
  assert.equal(expired.notice.kind, 'expired'); assert.equal(expired.status, 'prepared'); assert.equal(mail.outbox.length, 0);
  await assert.rejects(service.approve(owner, reminder.id, reminder.digest), { code: 'PREVIEW_CHANGED' });
  const change: any = await service.prepare(owner, { connectionId: z.id, action: 'contact.update', payload: { contactId: customer, changes: { email: 'new@asha.example' } }, intentId: 'contact-1' });
  await service.approve(owner, change.id, change.digest);
  zoho.contacts[0].email = 'changed-elsewhere@asha.example'; zoho.contacts[0].last_modified_time = '2026-10-15T00:00:00.000Z';
  const again: any = await service.execute(owner, change.id);
  assert.equal(again.notice.kind, 'prepared-again'); assert.equal(again.status, 'prepared'); assert.equal(again.change ?? again.approval.change.fields[0].before, 'changed-elsewhere@asha.example');
  assert.equal(zoho.contacts[0].email, 'changed-elsewhere@asha.example');
});

test('restore drill: an older vault cannot cause a second send; Chausar looks first', async () => {
  const { service, connect, store, mail } = setup({ mailImap: false }); const m = await connect('mail', ['smtp.send']);
  const prepared: any = await service.prepare(owner, { connectionId: m.id, action: 'smtp.send', payload: message, intentId: 'mail-2' });
  const approved: any = await service.approve(owner, prepared.id, prepared.digest);
  const backup = structuredClone(store.state);
  const first: any = await service.execute(owner, approved.id);
  assert.equal(first.status, 'unknown', 'without IMAP the server gives no way to look');
  assert.equal(mail.outbox.length, 1);
  store.state = backup; // restore the older vault: the action is approved and unattempted again
  assert.equal(service.afterRestore(owner).length, 1);
  const second: any = await service.execute(owner, approved.id);
  assert.equal(mail.outbox.length, 1, 'no second mail'); assert.equal(second.status, 'unknown');
  assert.ok(second.notices.some((n: any) => n.kind === 'looked-first'));
  const settled: any = await service.settle(owner, approved.id, 'sent');
  assert.equal(settled.status, 'verified'); assert.equal(settled.readBack.settledBy, 'person');
});

test('a lost mail reply with IMAP is settled by the Sent folder with exactly one mail', async () => {
  const { service, connect, mail } = setup(); const m = await connect('mail', ['smtp.send']);
  const prepared: any = await service.prepare(owner, { connectionId: m.id, action: 'smtp.send', payload: message, intentId: 'mail-3' });
  await service.approve(owner, prepared.id, prepared.digest); mail.fault('drop-after-commit');
  const result: any = await service.execute(owner, prepared.id);
  assert.equal(result.status, 'unknown');
  const back: any = await service.readBack(owner, prepared.id); assert.equal(back.status, 'verified', JSON.stringify(back.readBack)); assert.equal(mail.outbox.length, 1);
});

test('tax filings are prepared only and can never be approved or sent', async () => {
  const { service, store, ports } = setup();
  const c = await service.connect(owner, { system: 'gst-portal', label: 'GST', environment: 'live', account: { gstin: '27ABCDE1234F1Z5' } });
  const prepared: any = await service.prepare(owner, { connectionId: c.id, action: 'return.file', payload: { gstin: '27ABCDE1234F1Z5', period: '2026-09', form: 'GSTR-3B' }, intentId: 'gst-1' });
  assert.equal(prepared.word, 'prepare-only'); assert.match(prepared.preview.asWritten, /You or your CA files it/);
  await assert.rejects(service.approve(owner, prepared.id, prepared.digest), { code: 'PREPARE_ONLY' });
  await assert.rejects(service.grant(owner, { connectionId: c.id, write: ['return.file'] }), { code: 'NOT_IN_CATALOGUE' });
  void store; void ports;
});

test('demo mode refuses live connections; the credential broker boundary is a typed refusal', async () => {
  const demo = setup(); (demo.ports as any).demo = true; const demoService = new WritebackService(demo.store, demo.ports);
  await assert.rejects(demoService.connect(owner, { system: 'zoho-books', label: 'Live', environment: 'live', account: {} }), { code: 'DEMO_EXTERNAL_DISABLED' });
  const plain = setup(); delete (plain.ports as any).credentials; const noBroker = new WritebackService(plain.store, plain.ports);
  const c = await noBroker.connect(owner, { system: 'zoho-books', label: 'Live', environment: 'live', account: { organizationId: zohoSeed.organizationId, dataCenter: 'in' } });
  await noBroker.grant(owner, { connectionId: c.id, write: ['invoice.createDraft'] });
  await assert.rejects(noBroker.prepare(owner, { connectionId: c.id, action: 'invoice.createDraft', payload: draft, intentId: 'inv-9' }), { code: 'WRITE_CREDENTIALS_UNAVAILABLE' });
});

test('Practice runs a whole job against fakes and shows every request, with nothing sent', async () => {
  const { service, store, zoho, mail } = setup();
  const run: any = await runPractice(service, owner, { steps: [
    { system: 'zoho-books', action: 'invoice.createDraft', payload: draft },
    { system: 'mail', action: 'smtp.send', payload: message, fault: 'drop-after-commit' },
    { system: 'shopify', action: 'variant.price', payload: { variantId: '4400000000201', priceMinor: '22950' } },
    { system: 'gst-portal', action: 'return.file', payload: { gstin: '27ABCDE1234F1Z5', period: '2026-09', form: 'GSTR-1' } },
  ] }, fakeFactory);
  assert.equal(run.sent, 0); assert.deepEqual(run.steps.map((s: any) => s.outcome), ['would-be-done', 'would-be-done', 'would-be-done', 'prepare-only']);
  assert.equal(run.steps[1].lostReply, true);
  assert.ok(run.steps[0].requests.some((r: any) => r.method === 'POST'));
  assert.ok(run.steps.every((s: any) => s.requests.every((r: any) => !/practice-zoho-token|shpat_|practice-mail-pass/.test(JSON.stringify(r)))));
  assert.ok(run.steps[2].changes.length > 0);
  assert.equal(store.state.actions.length, 0); assert.equal(zoho.invoices.length, 1); assert.equal(mail.outbox.length, 0);
  assert.equal(readState(store.state).practiceRuns.length, 1);
  await assert.rejects(runPractice(service, owner, { steps: [{ system: 'shopify', action: 'theme.publish', payload: {} }] }, fakeFactory), { code: 'NOT_IN_CATALOGUE' });
});

test('Practice of a prepared action uses its exact payload against a fake', async () => {
  const { service, connect, zoho } = setup(); const c = await connect('zoho-books', ['payment.record']);
  const prepared: any = await service.prepare(owner, { connectionId: c.id, action: 'payment.record', payload: { customerId: customer, invoiceId: invoice, amountMinor: '60000', date: '2026-10-14', mode: 'upi' }, intentId: 'pay-7' });
  const run: any = await runPractice(service, owner, { actionId: prepared.id }, fakeFactory);
  assert.equal(run.steps[0].outcome, 'would-be-done'); assert.equal(zoho.payments.length, 0);
});

test('the write-back recipe test scores every installed row 3/3 against the fakes', async () => {
  const { service } = setup();
  const result = await qualify(service, owner, qualificationCases, fakeFactory);
  const failing = result.rows.filter(r => r.score !== '3/3').map(r => `${r.system}/${r.action} ${JSON.stringify(r.checks)}`);
  assert.deepEqual(failing, []);
  assert.equal(result.rows.length, CATALOGUE.filter(r => r.tier !== 'prepare-only').length);
  assert.ok(service.catalogue(owner).filter(r => r.tier !== 'prepare-only').every(r => r.qualification === 'synthetic-tested' && r.writeScore === '3/3'));
});

// Attack cases for the hands (plan day 7, block 12).
test('attack: the same action twice at once produces one effect', async () => {
  const { service, connect, zoho } = setup(); const c = await connect('zoho-books', ['invoice.createDraft']);
  const prepared: any = await service.prepare(owner, { connectionId: c.id, action: 'invoice.createDraft', payload: draft, intentId: 'dup-1' });
  await service.approve(owner, prepared.id, prepared.digest);
  const results = await Promise.allSettled([service.execute(owner, prepared.id), service.execute(owner, prepared.id)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(zoho.invoices.length, 2);
});
test('attack: a payload changed after approval is refused and nothing is sent', async () => {
  const { service, connect, store, mail } = setup(); const m = await connect('mail', ['smtp.send']);
  const prepared: any = await service.prepare(owner, { connectionId: m.id, action: 'smtp.send', payload: message, intentId: 'tamper-1' });
  await service.approve(owner, prepared.id, prepared.digest);
  store.state.actions[0].payload.payload.to = ['attacker@evil.example'];
  await assert.rejects(service.execute(owner, prepared.id), { code: 'PREVIEW_CHANGED' }); assert.equal(mail.outbox.length, 0);
});
test('attack: a cancel after the action ran is refused instead of only looking complete', async () => {
  const { service, connect } = setup(); const c = await connect('zoho-books', ['invoice.createDraft']);
  const prepared: any = await service.prepare(owner, { connectionId: c.id, action: 'invoice.createDraft', payload: draft, intentId: 'cancel-1' });
  await service.approve(owner, prepared.id, prepared.digest); await service.execute(owner, prepared.id);
  await assert.rejects(service.drop(owner, prepared.id), { code: 'ACTION_ALREADY_ATTEMPTED' });
  const other: any = await service.prepare(owner, { connectionId: c.id, action: 'invoice.createDraft', payload: draft, intentId: 'cancel-2' });
  await service.drop(owner, other.id); await assert.rejects(service.execute(owner, other.id), { code: 'APPROVAL_REQUIRED' });
});
test('attack: work that read outside text may prepare a money action but can never approve or run it', async () => {
  const { service, connect } = setup(); const c = await connect('zoho-books', ['payment.record']);
  const job: Context = { ...owner, sourceTainted: true };
  const prepared: any = await service.prepare(job, { connectionId: c.id, action: 'payment.record', payload: { customerId: customer, invoiceId: invoice, amountMinor: '60000', date: '2026-10-14', mode: 'upi' }, intentId: 'money-1' });
  await assert.rejects(service.approve(job, prepared.id, prepared.digest), { code: 'TAINTED_APPROVAL' });
  await service.approve(owner, prepared.id, prepared.digest);
  await assert.rejects(service.execute(job, prepared.id), { code: 'TAINTED_EXECUTION' });
  await assert.rejects(service.settle(job, prepared.id, 'sent'));
});

test('a sandbox recipe pass promotes a planned-live row to live; a failure records nothing', async () => {
  const { service, connect } = setup(); const c = await connect('zoho-books', ['invoice.createDraft', 'payment.record']);
  const { qualifySandbox } = await import('../runtime/writeback/practice.ts');
  const result = await qualifySandbox(service, owner, { connectionId: c.id, cases: [{ action: 'invoice.createDraft', payload: draft }, { action: 'payment.record', payload: { customerId: customer, invoiceId: invoice, amountMinor: '999999', date: '2026-10-14', mode: 'upi' } }] });
  assert.deepEqual(result.rows.map(r => r.score), ['2/2', '0/2']);
  const rows = service.catalogue(owner);
  assert.equal(rows.find(r => r.action === 'invoice.createDraft')!.status, 'live');
  assert.equal(rows.find(r => r.action === 'payment.record')!.status, 'experimental');
  const practice = await service.connect(owner, { system: 'zoho-books', label: 'p', environment: 'practice', account: {} });
  await assert.rejects(qualifySandbox(service, owner, { connectionId: practice.id, cases: [{ action: 'invoice.createDraft', payload: draft }] }), { code: 'SANDBOX_CONNECTION_REQUIRED' });
});
