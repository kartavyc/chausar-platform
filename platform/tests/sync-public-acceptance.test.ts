import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, PASSWORD, PRIVATE_MARKER, readInFreshProcess, SOURCE } from './fixtures/sync-public-acceptance.ts';
function expectation(input: any) { return { recordHash: input.recordHash, workspaceId: input.snapshot.workspaceId, vaultId: input.snapshot.vaultId,
  revision: input.snapshot.revision, sequence: input.snapshot.sequence, fence: input.snapshot.fence, expectedHeadHash: input.expectedHeadHash }; }

test('public sync uses real reconciled calculation evidence, separate approval and a verified encrypted staged restore', async t => {
  const f = await fixture(t), preview = await f.request('sync.preview');
  await assert.rejects(f.request('sync.push', { previewId: preview.id, approvalId: 'no-such-reviewed-approval' }));
  assert.equal(f.control.puts.length, 0); assert.equal(await f.transport.getHead(), null);
  const approval = await f.request('sync.approve', { id: preview.id }), pushed = await f.request('sync.push', { previewId: preview.id, approvalId: approval.id });
  assert.equal(pushed.receipt.status, 'completed'); assert.equal(pushed.receipt.payloadBase64, undefined); assert.equal(f.control.puts.length, 1);
  assert.equal((await f.transport.getHead())!.recordHash, pushed.head.recordHash);
  const record = (await f.transport.get(pushed.head.recordHash))!, encodedBackup = Buffer.from(record.ciphertextBase64, 'base64').toString('utf8');
  assert.equal(JSON.parse(encodedBackup).backupFormat, 'chausar.backup.v1');
  for (const plaintext of [SOURCE, PRIVATE_MARKER, PASSWORD, f.calculation.id, '30000']) assert.equal(encodedBackup.includes(plaintext), false);
  assert.equal(record.ciphertextDigest, preview.digest);
  const receiver = await f.receiver(), before = await receiver.request('workspace.status');
  const staged = await receiver.request('sync.pull', { folder: 'reviewed-stage', passphrase: PASSWORD, expectedWorkspaceId: f.created.workspace.id });
  assert.equal(staged.liveAuthorityChanged, false); assert.equal((await receiver.request('workspace.status')).workspace.id, before.workspace.id);
  assert.deepEqual(await receiver.request('sources.list'), [], 'Pull does not implicitly replace live receiver authority.');
  await receiver.openStageReadOnly('reviewed-stage');
  const restored = await receiver.request('receipts.get', { id: f.calculation.id });
  assert.equal((restored.receipt ?? restored).totalMinor, '30000');
  const memory = await receiver.request('memory.list');
  assert.ok(memory.facts.some((item: any) => item.fields.description === PRIVATE_MARKER));
  await assert.rejects(f.request('sync.push', { previewId: preview.id, approvalId: approval.id })); assert.equal(f.control.puts.length, 1);
});

test('sender encrypted restart preserves identity and advances publication fencing without losing imported receipts', async t => {
  const f = await fixture(t), identity = await f.request('sync.identity'), first = await f.prepare();
  const published = await f.request('sync.push', first.payload), writer = await f.request('sync.writer.status'); await f.restart();
  assert.deepEqual(await f.request('sync.identity'), identity);
  const reopenedWriter = await f.request('sync.writer.status');
  assert.equal(reopenedWriter.readonly, false); assert.equal(reopenedWriter.fence, writer.fence); assert.deepEqual(reopenedWriter.grant, writer.grant);
  assert.equal((await f.request('receipts.get', { id: f.calculation.id })).totalMinor, '30000');
  const next = await f.prepare(), second = await f.request('sync.push', next.payload);
  assert.equal(second.head.sequence, published.head.sequence + 1); assert.ok(second.head.fence > published.head.fence);
  assert.ok(second.head.revision > published.head.revision);
  const observed = await readInFreshProcess(t, f, 'head'); assert.equal(observed.ok, true); assert.deepEqual(observed.result, second.head);
  assert.equal(f.control.puts.length, 2);
});

test('lease expiry just before publication leaves an orphan but no committed head or reusable approval', async t => {
  const f = await fixture(t), prepared = await f.prepare();
  f.control.fault = point => { if (point === 'before-state-commit') f.setTime(f.clock().getTime() + 1001); };
  await assert.rejects(f.request('sync.push', prepared.payload), { code: 'FENCE_REJECTED' });
  assert.equal(f.control.puts.length, 1); assert.equal(await f.transport.getHead(), null);
  f.control.fault = undefined; await f.restart();
  const result = await f.request('sync.reconcile', { previewId: prepared.preview.id });
  assert.equal(result.status, 'unknown'); assert.equal(result.reason, 'ORPHAN_RECORD'); assert.equal(result.automaticResubmission, false);
  assert.equal(result.readOnly, true); assert.equal(result.receiptUpdated, false); assert.equal(result.signerVerification, 'not-performed-no-restore');
  await assert.rejects(f.request('sync.push', prepared.payload)); assert.equal(f.control.puts.length, 1);
  assert.equal((await readInFreshProcess(t, f, 'head')).result, null);
});

test('lost publication acknowledgement remains reconcilable after encrypted restart without automatic resubmission', async t => {
  const f = await fixture(t), prepared = await f.prepare();
  f.control.fault = point => { if (point === 'after-state-commit') throw new Error('Authored lost publication acknowledgement.'); };
  await assert.rejects(f.request('sync.push', prepared.payload), { code: 'SYNC_FAILED' });
  f.control.fault = undefined;
  const activity = await f.request('activity.list'), failed = activity.modelReceipts.find((item: any) => item.id === prepared.preview.id);
  const approval = activity.modelReceipts.find((item: any) => item.id === prepared.approval.id);
  assert.equal(failed.status, 'failed'); assert.equal(failed.remoteOutcome, 'unknown-until-head-reconciliation');
  assert.equal(failed.payloadBase64, undefined); assert.equal(approval.used, true);
  const expected = { recordHash: failed.recordHash, workspaceId: failed.workspaceId, vaultId: failed.vaultId,
    revision: failed.revision, sequence: failed.sequence, fence: failed.fence, expectedHeadHash: failed.expectedHeadHash };
  assert.deepEqual(expected, expectation(f.control.puts[0]), 'Reconciliation inputs come from the retained public receipt.');
  assert.equal((await f.transport.getHead())!.recordHash, expected.recordHash); await f.restart();
  const puts = f.control.puts.length, leases = f.control.leases.length;
  await assert.rejects(f.request('sync.reconcile', { previewId: failed.id, recordHash: expected.recordHash }), { code: 'INVALID_SYNC_REQUEST' });
  const result = await f.request('sync.reconcile', { previewId: failed.id });
  assert.equal(result.status, 'published'); assert.equal(result.reason, 'HEAD_MATCH'); assert.equal(result.automaticResubmission, false);
  assert.equal(result.previewId, failed.id); assert.equal(result.readOnly, true); assert.equal(result.receiptUpdated, false);
  assert.equal(result.signerVerification, 'not-performed-no-restore');
  assert.equal(f.control.puts.length, puts); assert.equal(f.control.leases.length, leases);
  const after = (await f.request('activity.list')).modelReceipts;
  assert.deepEqual(after.find((item: any) => item.id === failed.id), failed, 'Read-only reconciliation cannot rewrite a failed receipt.');
  assert.deepEqual(after.find((item: any) => item.id === approval.id), approval, 'Read-only reconciliation cannot reset approval.');
  await assert.rejects(f.request('sync.push', prepared.payload)); assert.equal(f.control.puts.length, 1);
  const observer = await readInFreshProcess(t, f, 'head'); assert.equal(observer.ok, true); assert.equal(observer.result.recordHash, expected.recordHash);
  assert.equal((await readdir(join(f.storeDirectory, 'blobs'))).filter(name => name.endsWith('.json')).length, 1);
});

test('a fresh process grants a later fence and rejects the old real signed encrypted publication', async t => {
  const f = await fixture(t), prepared = await f.prepare(), first = await f.request('sync.push', prepared.payload);
  const old = structuredClone(f.control.puts[0]); f.setTime(f.clock().getTime() + 1001);
  const later = await readInFreshProcess(t, f, 'lease', { deviceId: 'reviewed-other-fixture-device', memberId: old.lease.memberId,
    epoch: old.lease.epoch, now: f.clock().toISOString(), ttlMs: 1000 });
  assert.equal(later.ok, true); assert.ok(later.result.fence > old.lease.fence); assert.notEqual(later.result.token, old.lease.token);
  const rejected = await readInFreshProcess(t, f, 'put', { ...old, now: f.clock().toISOString() });
  assert.equal(rejected.ok, false); assert.equal(rejected.code, 'FENCE_REJECTED');
  assert.equal((await f.transport.getHead())!.recordHash, first.head.recordHash);
  const next = await f.prepare(); await assert.rejects(f.request('sync.push', next.payload), { code: 'WRITER_LEASE_DENIED' });
  assert.equal(f.control.puts.length, 1);
});

test('current source authority loss after exact approval refuses publication without changing picked-store head', async t => {
  const f = await fixture(t), prepared = await f.prepare();
  await f.request('trust.update', { allowedSources: [] });
  await assert.rejects(f.request('sync.push', prepared.payload), { code: 'SOURCE_REVOKED' });
  assert.equal(f.control.puts.length, 0); assert.equal(await f.transport.getHead(), null);
  const bytes = await readFile(join(f.directory, 'sender/main/authority.encrypted.json'), 'utf8'); assert.equal(bytes.includes(PRIVATE_MARKER), false);
});

test('expired reviewed writer refuses a valid imported invoice correction and preserves its encrypted evidence', async t => {
  const f = await fixture(t), writer = await f.request('sync.writer.status');
  assert.equal(writer.readonly, false); assert.equal(writer.grant.deviceId, 'independent-sender');
  const beforeMemory = await f.request('memory.list'), invoice = beforeMemory.facts.find((item: any) => item.entityId === 'invoice-a');
  assert.ok(invoice); assert.equal(invoice.fields.amountMinor, '10000');
  const beforeReceipt = await f.request('receipts.get', { id: f.calculation.id });
  const beforeBackup = await f.request('workspace.backup'), encrypted = await readFile(beforeBackup.path, 'utf8');
  const puts = f.control.puts.length, leases = f.control.leases.length;
  f.setTime(Date.parse(writer.grant.expiresAt) + 1);
  const expired = await f.request('sync.writer.status');
  assert.equal(expired.readonly, true); assert.equal(expired.reason, 'SYNC_WRITER_EXPIRED');
  assert.equal(expired.fence, writer.fence); assert.equal(expired.stateDigest, writer.stateDigest); assert.deepEqual(expired.grant, writer.grant);
  await assert.rejects(f.request('memory.correct', { id: invoice.id, fields: { amountMinor: '10100' } }), { code: 'SYNC_WRITER_EXPIRED' });
  assert.deepEqual(await f.request('memory.list', { asOf: beforeMemory.asOf }), beforeMemory);
  assert.deepEqual(await f.request('receipts.get', { id: f.calculation.id }), beforeReceipt);
  const afterBackup = await f.request('workspace.backup'); assert.equal(await readFile(afterBackup.path, 'utf8'), encrypted);
  assert.equal(f.control.puts.length, puts); assert.equal(f.control.leases.length, leases);
  await f.restart();
  assert.equal((await f.request('sync.writer.status')).reason, 'SYNC_WRITER_EXPIRED', 'Reopen does not renew writer authority.');
  await f.reviewWriter();
  const corrected = await f.request('memory.correct', { id: invoice.id, fields: { amountMinor: '10100' } });
  assert.ok(corrected);
  assert.ok((await f.request('memory.list')).facts.some((item: any) => item.entityId === 'invoice-a' && item.fields.amountMinor === '10100'));
});
