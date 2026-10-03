import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { Vault } from '../runtime/vault.ts';
import { captureInvoiceCustody, prepareInvoiceRestoredState, type InvoiceCustodyArtifact } from '../runtime/vault-invoice-custody.ts';
import { rememberInvoiceOperation, rememberInvoiceDelivery, prepareInvoicePurge, invoiceDeliveryTombstone } from '../runtime/invoice-follow-up-lineage.ts';
import { digest } from '../runtime/actions.ts';
import type { State } from '../runtime/contracts.ts';

// Actual encrypted Vault fixtures, with labelled synthetic journals/time/costs.
// No native database, provider, transport, or real customer data is exercised.
const passphrase = 'synthetic invoice vault test passphrase';
const at = '2026-10-01T12:00:00.000Z', later = '2026-10-02T12:00:00.000Z';
const sourceId = 'synthetic-books', jobId = 'synthetic-mandate', deliveryKey = 'synthetic-delivery';
const options = (directory: string) => ({ directory, storage: 'experimental-file' as const, passphrase });
const errorCode = (code: string) => (error: any) => error.code === code;
function payload(state: State) {
  state.jobs.push({ id: jobId, type: 'invoice-follow-up', sourceIds: [sourceId], createdAt: at,
    budgetMinor: '500', spentMinor: '2', reservedMinor: '20', status: 'awaiting-acceptance', ownerId: 'owner', ownerEpoch: 1 });
  state.answers.push({ kind: 'invoice-balance-proof-v1', id: 'synthetic-proof', jobId, sourceIds: [sourceId], factIds: [], at });
  const settlement = { spentMinor: '1', modelUnits: 0, durationMs: 0, actionExposureMinor: '0',
    result: { value: { proofId: 'synthetic-proof' }, informationClass: 'computation' as const,
      evidenceIds: ['synthetic-proof'], sourceTainted: false } };
  const requestDigest = digest({ synthetic: 'operation request' });
  state.answers.push({ kind: 'invoice-job-operation-v1', id: 'synthetic-operation', key: 'synthetic-operation', requestDigest,
    settlement, sourceIds: [sourceId], factIds: [], at });
  rememberInvoiceOperation(state, 'synthetic-operation', requestDigest, settlement, at);
  state.actions.push({ id: 'synthetic-action', connector: 'simulated-invoice-reminder', operation: 'send', status: 'approved',
    idempotencyKey: deliveryKey, sourceIds: [sourceId], attempts: [], payload: { jobId, proofId: 'synthetic-proof', text: 'Synthetic private preview' } });
  state.answers.push({ kind: 'invoice-reminder-approval-v1', actionId: 'synthetic-action', sourceIds: [sourceId], approvedAt: at, at });
  const delivery = { kind: 'invoice-simulated-delivery-v1', id: 'synthetic-delivery-record', key: deliveryKey,
    actionId: 'synthetic-action', payloadDigest: digest({ synthetic: 'delivery payload' }), jobId,
    customerId: 'synthetic-customer', costMinor: '20', status: 'reserved', sourceIds: [sourceId], factIds: [], at };
  state.answers.push(delivery); rememberInvoiceDelivery(state, delivery);
  state.activity.push({ message: 'Synthetic unrelated retained activity' });
}
async function fixture(t: any) {
  const scratch = resolve(tmpdir()); if (process.platform === 'win32') assert.match(scratch, /^C:\\/i);
  const directory = await mkdtemp(join(scratch, 'chausar-invoice-custody-'));
  const opened = new Set<Vault>();
  t.after(async () => { for (const vault of opened) await vault.close(); const child = relative(scratch, directory); assert.ok(child && !child.startsWith('..') && !isAbsolute(child)); await rm(directory, { recursive: true, force: true }); });
  const hold = (vault: Vault) => { opened.add(vault); return vault; };
  const { vault } = await Vault.create({ ...options(join(directory, 'source')), name: 'Synthetic encrypted invoice custody', demo: true });
  hold(vault); await vault.update(payload);
  const backupFile = join(directory, 'older.encrypted.json'); await vault.backup(backupFile);
  const vaultId = JSON.parse(await readFile(join(vault.directory, 'authority.encrypted.json'), 'utf8')).id as string;
  const restore = async (name: string, artifact?: InvoiceCustodyArtifact) => hold(await Vault.restore({ ...options(join(directory, name)), backupFile,
    prepareRestoredState: (state, descriptor) => prepareInvoiceRestoredState(state, artifact, descriptor) }));
  return { directory, vault, vaultId, backupFile, hold, restore };
}

test('encrypted close/reopen and same-history restore retain normal operation and delivery journals', async t => {
  const f = await fixture(t), expected = f.vault.read(), custody = captureInvoiceCustody(expected, f.vaultId);
  assert.deepEqual(custody.erasedOperationIdentities, []); assert.deepEqual(custody.erasedDeliveryIdentities, []);
  assert.deepEqual(custody.liveMandateAccounting.map(a => [a.budgetMinor, a.spentMinor, a.reservedMinor, a.status]),
    [['500', '2', '20', 'awaiting-acceptance']]);
  assert.ok(!JSON.stringify(custody).includes('Synthetic private preview'));
  assert.ok(!JSON.stringify(custody).includes('synthetic-customer'));
  await f.vault.close();
  const reopened = f.hold(await Vault.open(options(join(f.directory, 'source'))));
  assert.deepEqual(reopened.read().tombstones, expected.tombstones); await reopened.close();
  const restored = await f.restore('same-history', custody);
  assert.deepEqual(restored.read(), expected);
  const raw = await readFile(join(restored.directory, 'authority.encrypted.json'), 'utf8');
  assert.ok(!raw.includes('Synthetic private preview') && !raw.includes('synthetic-customer'));
});

test('older encrypted backup cannot resurrect invoice payload fenced by latest mandate erasure', async t => {
  const f = await fixture(t);
  await f.vault.update(state => { prepareInvoicePurge(state, { sourceId }, later); });
  const current = f.vault.read(), custody = captureInvoiceCustody(current, f.vaultId);
  assert.equal(custody.erasedOperationIdentities.length, 1); assert.equal(custody.erasedDeliveryIdentities.length, 1);
  const accounting = current.tombstones.find(m => m.kind === 'invoice-mandate-accounting-v1');
  assert.equal(accounting.spentMinor, '2'); assert.equal(accounting.reservedMinor, '20');
  await f.vault.close();
  const restored = await f.restore('purged-history', custody), result = restored.read();
  assert.deepEqual(result.jobs, []); assert.deepEqual(result.actions, []); assert.deepEqual(result.answers, []);
  assert.deepEqual(result.tombstones, current.tombstones); assert.deepEqual(result.activity, current.activity);
  await restored.close();
  const reopened = f.hold(await Vault.open(options(join(f.directory, 'purged-history'))));
  assert.deepEqual(reopened.read().tombstones, current.tombstones);
  assert.ok(!JSON.stringify(reopened.read()).includes('Synthetic private preview'));
});

test('current terminal custody refuses older reserved accounting before publication or recovery', async t => {
  const f = await fixture(t);
  await f.vault.update(state => {
    const delivery = state.answers.find(a => a.kind === 'invoice-simulated-delivery-v1');
    delivery.status = 'sent'; delivery.sentAt = later; rememberInvoiceDelivery(state, delivery);
    state.jobs[0].spentMinor = '22'; state.jobs[0].reservedMinor = '0';
  });
  const custody = captureInvoiceCustody(f.vault.read(), f.vaultId); await f.vault.close();
  assert.equal(custody.markers.find(m => m.kind === 'invoice-delivery-no-resend-v1')!.outcome, 'sent');
  await assert.rejects(f.restore('terminal-history', custody), errorCode('INVOICE_RESTORE_ACCOUNTING_CHANGED'));
  await assert.rejects(access(join(f.directory, 'terminal-history', 'authority.encrypted.json')), (e: any) => e.code === 'ENOENT');
});

test('encrypted pre-delivery backup with no reservation cannot roll back established spend or admit another occurrence', async t => {
  const f = await fixture(t), delivery = structuredClone(f.vault.read().answers.find(a => a.kind === 'invoice-simulated-delivery-v1'));
  // Stage the labelled synthetic history after preparation, before admission.
  await f.vault.update(state => {
    state.answers = state.answers.filter(a => !['invoice-simulated-delivery-v1', 'invoice-reminder-approval-v1'].includes(a.kind));
    state.tombstones = state.tombstones.filter(m => m.kind !== 'invoice-delivery-no-resend-v1');
    state.jobs[0].reservedMinor = '0'; state.actions[0].status = 'prepared';
  });
  const backupFile = join(f.directory, 'pre-delivery.encrypted.json'); await f.vault.backup(backupFile);
  assert.equal(f.vault.read().jobs[0].spentMinor, '2'); assert.equal(f.vault.read().jobs[0].reservedMinor, '0');
  await f.vault.update(state => {
    delivery.status = 'sent'; delivery.sentAt = later;
    state.answers.push(delivery); rememberInvoiceDelivery(state, delivery);
    state.jobs[0].spentMinor = '22'; state.jobs[0].reservedMinor = '0';
  });
  const custody = captureInvoiceCustody(f.vault.read(), f.vaultId);
  assert.equal(custody.liveMandateAccounting[0].spentMinor, '22');
  assert.equal(invoiceDeliveryTombstone(f.vault.read(), deliveryKey).outcome, 'sent');
  await f.vault.close();
  const directory = join(f.directory, 'pre-delivery-restore');
  await assert.rejects(Vault.restore({ ...options(directory), backupFile,
    prepareRestoredState: (state, descriptor) => prepareInvoiceRestoredState(state, custody, descriptor) }), errorCode('INVOICE_RESTORE_ACCOUNTING_CHANGED'));
  await assert.rejects(access(join(directory, 'authority.encrypted.json')), (e: any) => e.code === 'ENOENT');
});

test('older running encrypted backup cannot replay a dispatched attempt even when aggregate accounting is unchanged', async t => {
  const f = await fixture(t);
  await f.vault.update(state => { state.jobs[0].status = 'running'; });
  const backupFile = join(f.directory, 'running-before-dispatch.encrypted.json'); await f.vault.backup(backupFile);
  const beforeDispatch = f.vault.read().jobs[0];
  await f.vault.update(state => {
    state.jobs[0].execution = { attempts: [{ stepId: 'synthetic-step', key: 'synthetic-dispatched-attempt',
      status: 'dispatched', reservedMinor: '20', startedAt: later }] };
  });
  const custody = captureInvoiceCustody(f.vault.read(), f.vaultId);
  assert.deepEqual(custody.liveMandateAccounting.map(a => [a.budgetMinor, a.spentMinor, a.reservedMinor, a.status]),
    [[beforeDispatch.budgetMinor, beforeDispatch.spentMinor, beforeDispatch.reservedMinor, beforeDispatch.status]]);
  await f.vault.close();
  const directory = join(f.directory, 'running-after-dispatch-restore');
  await assert.rejects(Vault.restore({ ...options(directory), backupFile,
    prepareRestoredState: (state, descriptor) => prepareInvoiceRestoredState(state, custody, descriptor) }), errorCode('INVOICE_RESTORE_ACCOUNTING_CHANGED'));
  await assert.rejects(access(join(directory, 'authority.encrypted.json')), (e: any) => e.code === 'ENOENT');
});

test('invoice restore refuses absent, unrelated or older trusted custody and occupied targets precede callbacks', async t => {
  const f = await fixture(t), custody = captureInvoiceCustody(f.vault.read(), f.vaultId);
  await assert.rejects(Vault.restore({ ...options(join(f.directory, 'missing-hook')), backupFile: f.backupFile }), errorCode('INVOICE_RESTORE_CUSTODY_REQUIRED'));
  await assert.rejects(f.restore('missing-custody'), errorCode('INVOICE_RESTORE_CUSTODY_REQUIRED'));
  await assert.rejects(f.restore('wrong-vault', { ...custody, vaultId: 'unrelated-vault' }), errorCode('INVOICE_RESTORE_CUSTODY_MISMATCH'));
  await assert.rejects(f.restore('older-custody', { ...custody, revision: custody.revision - 1 }), errorCode('INVOICE_RESTORE_CUSTODY_MISMATCH'));
  await assert.rejects(f.restore('missing-live-accounting', { ...custody, liveMandateAccounting: [] }), errorCode('INVOICE_RESTORE_ACCOUNTING_CHANGED'));
  const statusChanged = structuredClone(custody); statusChanged.liveMandateAccounting[0].status = 'cancelled';
  await assert.rejects(f.restore('changed-live-status', statusChanged), errorCode('INVOICE_RESTORE_ACCOUNTING_CHANGED'));
  let called = false;
  await f.vault.close();
  await assert.rejects(Vault.restore({ ...options(join(f.directory, 'source')), backupFile: f.backupFile,
    prepareRestoredState: () => { called = true; } }), errorCode('VAULT_EXISTS'));
  assert.equal(called, false);
  for (const name of ['missing-hook', 'missing-custody', 'wrong-vault', 'older-custody', 'missing-live-accounting', 'changed-live-status'])
    await assert.rejects(access(join(f.directory, name, 'authority.encrypted.json')), (e: any) => e.code === 'ENOENT');
});

test('invalid trusted preparation and conflicting terminal custody publish nothing and release target locks', async t => {
  const f = await fixture(t), custody = captureInvoiceCustody(f.vault.read(), f.vaultId), target = join(f.directory, 'failed-prepare');
  await assert.rejects(Vault.restore({ ...options(target), backupFile: f.backupFile,
    prepareRestoredState: state => { state.workspace.id = 'different-workspace'; } }), errorCode('RESTORE_STATE_IDENTITY_CHANGED'));
  await assert.rejects(access(join(target, 'authority.encrypted.json')), (e: any) => e.code === 'ENOENT');
  const invalid = structuredClone(custody); invalid.markers.find(m => m.kind === 'invoice-delivery-no-resend-v1')!.costMinor = '21';
  await assert.rejects(f.restore('conflicting-custody', invalid), errorCode('INVOICE_CUSTODY_CONFLICT'));
  const duplicate = structuredClone(custody); duplicate.liveMandateAccounting.push(structuredClone(duplicate.liveMandateAccounting[0]));
  await assert.rejects(f.restore('duplicate-accounting', duplicate), errorCode('INVOICE_CUSTODY_CONFLICT'));
  const extra = structuredClone(custody); Object.assign(extra.liveMandateAccounting[0], { rawCustomer: 'synthetic-private-customer' });
  await assert.rejects(f.restore('unreviewed-accounting-field', extra), errorCode('INVOICE_CUSTODY_INVALID'));
  const restored = f.hold(await Vault.restore({ ...options(target), backupFile: f.backupFile,
    prepareRestoredState: (state, descriptor) => prepareInvoiceRestoredState(state, custody, descriptor) }));
  assert.deepEqual(restored.read().answers, f.vault.read().answers);
});
