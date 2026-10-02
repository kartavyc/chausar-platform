import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile, link, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EncryptedFilePhoneCustodyStorage, PhoneRequestCustody } from '../runtime/phone/request-custody.ts';
import { PhoneError } from '../runtime/phone/contracts.ts';
import type { PhoneCustodyRecord, PhoneRequestIdentity } from '../runtime/phone/host-contracts.ts';
import type { RemoteRequest, RequestResult, SessionAuthority } from '../runtime/phone/contracts.ts';

const KEY = new Uint8Array(32).fill(19);
const FORMAT = 'chausar-phone-custody-v1';
const CUSTODY = 'synthetic_host';
const START = '2026-10-02T00:00:00.000Z', END = '2026-10-03T00:00:00.000Z';
const binding = { workspaceId: 'workspace', memberId: 'owner', deviceId: 'device', epoch: 1 };
const owner: SessionAuthority = { binding, sessionId: 'session', expiresAt: END, validatedAt: START, capabilities: ['chat', 'approval.simple'] };
const errorCode = (code: string) => (error: unknown) => error instanceof PhoneError && error.code === code && error.message === code && error.cause === undefined;
const unknown = (requestId: string): RemoteRequest<RequestResult> => ({ status: 'unknown', requestId });
function record(id = 'request1', identity: Partial<PhoneRequestIdentity> = {}, sessionId = owner.sessionId): PhoneCustodyRecord {
  return {
    identity: { requestId: id, kind: 'chat', ...identity } as PhoneRequestIdentity,
    binding: { ...binding }, sessionId, operationId: `op_${sessionId}_${id}`, inputDigest: 'a'.repeat(64),
    scope: { revision: 'permission:1', operationVersion: 'conversation:1', sourceIds: ['source'] },
    createdAt: START, expiresAt: END, state: unknown(id),
  };
}
const success = (id = 'request1', text = 'Synthetic private receipt backed answer'): RemoteRequest<RequestResult> => ({
  status: 'succeeded', requestId: id, result: { conversationId: 'conversation', text, receiptIds: ['receipt'] },
});
function filePath(directory: string, custodyId = CUSTODY): string {
  return join(directory, `${createHash('sha256').update(JSON.stringify([FORMAT, custodyId])).digest('hex')}.custody`);
}
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const temporaryRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'chausar-phone-custody-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storage = new EncryptedFilePhoneCustodyStorage({ directory, custodyId: CUSTODY, key: KEY });
  return { directory, storage, custody: new PhoneRequestCustody(storage), path: filePath(directory),
    reopen: () => new PhoneRequestCustody(new EncryptedFilePhoneCustodyStorage({ directory, custodyId: CUSTODY, key: KEY })) };
}

test('admission is durable before dispatch, reopen never dispatches the same request again, and no replay body is retained', async t => {
  const f = await fixture(t), input = record();
  const reserved = await f.custody.reserve(input);
  assert.equal(reserved.dispatch, true); assert.deepEqual(reserved.record.state, unknown('request1'));
  const stored = await readFile(f.path);
  assert.deepEqual((await f.reopen().get(owner, 'request1'))?.state, unknown('request1'));
  const duplicate = await f.reopen().reserve({ ...record(), operationId: 'new_attempt', createdAt: '2026-10-02T01:00:00.000Z' });
  assert.equal(duplicate.dispatch, false); assert.equal(duplicate.record.operationId, input.operationId);
  assert.deepEqual(await readFile(f.path), stored);
  const names = await readdir(f.directory);
  assert.deepEqual(names, [f.path.slice(f.directory.length + 1)]);
  const persistedText = stored.toString('utf8');
  for (const privateText of ['workspace', 'owner', 'device', 'session', 'request1', input.operationId, START, 'permission:1']) {
    assert.equal(persistedText.includes(privateText), false); assert.equal(names.some(name => name.includes(privateText)), false);
  }
  const decipher = createDecipheriv('aes-256-gcm', KEY, stored.subarray(16, 28));
  decipher.setAAD(Buffer.from(JSON.stringify([FORMAT, CUSTODY, Number(stored.readBigUInt64BE(8))])));
  decipher.setAuthTag(stored.subarray(28, 44));
  const snapshot = JSON.parse(Buffer.concat([decipher.update(stored.subarray(44)), decipher.final()]).toString('utf8'));
  assert.deepEqual(snapshot.records, [input]);
  assert.equal(JSON.stringify(snapshot).includes('question'), false);
  assert.equal(JSON.stringify(snapshot).includes('token'), false);
  assert.equal(JSON.stringify(snapshot).includes('credential'), false);
});

test('terminal outcomes and receipt identities survive process-independent storage reopen with defensive copies', async t => {
  const f = await fixture(t), input = record(); await f.custody.reserve(input);
  input.scope.sourceIds.push('mutated'); input.binding.memberId = 'mutated';
  const outcome = success();
  const settled = await f.custody.settle(owner, 'request1', outcome);
  assert.equal(settled.state.status, 'succeeded');
  if (outcome.status === 'succeeded' && 'text' in outcome.result) outcome.result.text = 'mutated';
  settled.scope.sourceIds.push('local_change');
  const reopened = f.reopen();
  assert.deepEqual((await reopened.get(owner, 'request1'))?.state, success());
  assert.deepEqual((await reopened.get(owner, 'request1'))?.scope.sourceIds, ['source']);
  const listed = await reopened.list(owner); listed[0].identity.requestId = 'client_mutation'; listed.length = 0;
  assert.equal((await reopened.list(owner))[0].identity.requestId, 'request1');
  const bytes = await readFile(f.path);
  assert.equal(bytes.includes(Buffer.from('Synthetic private receipt backed answer')), false);
  assert.equal(bytes.includes(Buffer.from('receipt')), false);
});

test('all workspace, member, device, epoch and session identity components isolate reads and settlements', async t => {
  const f = await fixture(t); await f.custody.reserve(record());
  for (const other of [
    { ...owner, binding: { ...binding, workspaceId: 'elsewhere' } },
    { ...owner, binding: { ...binding, memberId: 'elsewhere' } },
    { ...owner, binding: { ...binding, deviceId: 'elsewhere' } },
    { ...owner, binding: { ...binding, epoch: 2 } }, { ...owner, sessionId: 'elsewhere' },
  ]) {
    assert.equal(await f.custody.get(other, 'request1'), undefined);
    assert.deepEqual(await f.custody.list(other), []);
    await assert.rejects(f.custody.settle(other, 'request1', success()), errorCode('INVALID_REQUEST'));
    const isolated = { ...record(), binding: { ...other.binding }, sessionId: other.sessionId, operationId: `isolated_${other.binding.workspaceId}_${other.binding.memberId}_${other.binding.deviceId}_${other.binding.epoch}_${other.sessionId}` };
    assert.equal((await f.custody.reserve(isolated)).dispatch, true);
  }
  assert.deepEqual((await f.custody.get(owner, 'request1'))?.state, unknown('request1'));
  assert.equal((await f.custody.list(owner)).length, 1);
});

test('changed request kind, target, digest and trusted scope refuse reuse and preserve the original identity', async t => {
  const f = await fixture(t); await f.custody.reserve(record());
  for (const changed of [
    record('request1', { kind: 'approval', target: 'approval' }), { ...record(), inputDigest: 'b'.repeat(64) },
    { ...record(), scope: { ...record().scope, revision: 'permission:2' } },
    { ...record(), scope: { ...record().scope, operationVersion: 'conversation:2' } },
    { ...record(), scope: { ...record().scope, sourceIds: ['other_source'] } },
  ]) await assert.rejects(f.custody.reserve(changed), errorCode('REQUEST_EXISTS'));
  const approval = record('approval_request', { kind: 'approval', target: 'approval' });
  await f.custody.reserve(approval);
  for (const changed of [ { ...approval, inputDigest: 'b'.repeat(64) }, { ...approval, identity: { ...approval.identity, target: 'other_approval' } } ]) {
    await assert.rejects(f.custody.reserve(changed), errorCode('PREVIEW_CHANGED'));
  }
  await assert.rejects(f.custody.reserve({ ...record('different'), operationId: record().operationId }), errorCode('REQUEST_EXISTS'));
  assert.equal((await f.custody.list(owner)).length, 2);
});

test('result validation binds kind, target and request identity, rejecting extra fields and credentials', async t => {
  const f = await fixture(t); await f.custody.reserve(record());
  const invalid = [
    { ...success(), requestId: 'other' }, { ...success(), credential: 'secret' },
    { status: 'succeeded', requestId: 'request1', result: { conversationId: 'conversation', text: 'text', receiptIds: ['receipt'], token: 'secret' } },
    { status: 'succeeded', requestId: 'request1', result: { approvalId: 'approval', actionId: 'action', decision: 'approved', decidedAt: START } },
    { status: 'pending', requestId: 'request1', token: 'secret' }, { status: 'failed', requestId: 'request1', code: 'sensitive_backend_details' },
    { status: 'succeeded', requestId: 'request1', result: { conversationId: 'bad/id', text: 'text', receiptIds: [] } },
  ];
  for (const response of invalid) await assert.rejects(f.custody.settle(owner, 'request1', response as RemoteRequest<RequestResult>), errorCode('INVALID_RESPONSE'));
  const approval = record('approve', { kind: 'approval', target: 'approval' }); await f.custody.reserve(approval);
  await assert.rejects(f.custody.settle(owner, 'approve', { status: 'succeeded', requestId: 'approve', result: { approvalId: 'elsewhere', actionId: 'action', decision: 'approved', decidedAt: START } }), errorCode('INVALID_RESPONSE'));
  await f.custody.settle(owner, 'approve', { status: 'succeeded', requestId: 'approve', result: { approvalId: 'approval', actionId: 'action', decision: 'approved', decidedAt: START } });
  const upload = record('upload_request', { kind: 'upload', target: 'upload' }); await f.custody.reserve(upload);
  await assert.rejects(f.custody.settle(owner, 'upload_request', { status: 'succeeded', requestId: 'upload_request', result: { uploadId: 'elsewhere', sourceId: 'source', status: 'awaiting-confirmation', sourceTainted: true } }), errorCode('INVALID_RESPONSE'));
  await f.custody.settle(owner, 'upload_request', { status: 'succeeded', requestId: 'upload_request', result: { uploadId: 'upload', sourceId: 'source', status: 'awaiting-confirmation', sourceTainted: true } });
});

test('terminal states cannot regress or accept conflicting later success, failure or cancellation', async t => {
  const f = await fixture(t);
  for (const outcome of [success(), { status: 'cancelled', requestId: 'request1' }, { status: 'failed', requestId: 'request1', code: 'ACCESS_REVOKED' }] as RemoteRequest<RequestResult>[]) {
    const id = `terminal_${outcome.status}`, value = { ...outcome, requestId: id } as RemoteRequest<RequestResult>;
    await f.custody.reserve(record(id)); await f.custody.settle(owner, id, { status: 'pending', requestId: id });
    await f.custody.settle(owner, id, value);
    assert.deepEqual((await f.custody.settle(owner, id, { status: 'unknown', requestId: id })).state, value);
    assert.deepEqual((await f.custody.settle(owner, id, { status: 'pending', requestId: id })).state, value);
    assert.deepEqual((await f.custody.settle(owner, id, structuredClone(value))).state, value);
    const conflicting = value.status === 'cancelled' ? { status: 'failed', requestId: id, code: 'ACCESS_REVOKED' } : { status: 'cancelled', requestId: id };
    await assert.rejects(f.custody.settle(owner, id, conflicting as RemoteRequest<RequestResult>), errorCode('INVALID_RESPONSE'));
    if (value.status === 'succeeded') await assert.rejects(f.custody.settle(owner, id, success(id, 'different')), errorCode('INVALID_RESPONSE'));
    assert.deepEqual((await f.reopen().get(owner, id))?.state, value);
  }
});

test('separate storage instances serialize reservation and terminal races for the same path', async t => {
  const f = await fixture(t), instances = Array.from({ length: 12 }, f.reopen);
  const results = await Promise.all(instances.map(instance => instance.reserve(record())));
  assert.equal(results.filter(value => value.dispatch).length, 1);
  assert.equal((await f.custody.list(owner)).length, 1);
  await Promise.all(instances.map(instance => instance.settle(owner, 'request1', success())));
  assert.deepEqual((await f.custody.get(owner, 'request1'))?.state, success());
  const races = await Promise.allSettled([f.reopen().settle(owner, 'request1', { status: 'cancelled', requestId: 'request1' }), f.reopen().settle(owner, 'request1', success())]);
  assert.equal(races[0].status, 'rejected'); assert.equal(races[1].status, 'fulfilled');
});

test('all encrypted envelope components, wrong key and transplanted custody identity fail closed without erasure', async t => {
  const f = await fixture(t); await f.custody.reserve(record()); const original = await readFile(f.path);
  for (const offset of [0, 15, 16, 28, original.length - 1]) {
    const tampered = Buffer.from(original); tampered[offset] ^= 1; await writeFile(f.path, tampered);
    await assert.rejects(f.reopen().list(owner), errorCode('CACHE_INVALID'));
    assert.deepEqual(await readFile(f.path), tampered);
    await assert.rejects(f.reopen().reserve(record('new')), errorCode('CACHE_INVALID'));
    assert.deepEqual(await readFile(f.path), tampered);
  }
  await writeFile(f.path, original);
  const wrongKey = new PhoneRequestCustody(new EncryptedFilePhoneCustodyStorage({ directory: f.directory, custodyId: CUSTODY, key: new Uint8Array(32).fill(20) }));
  await assert.rejects(wrongKey.list(owner), errorCode('CACHE_INVALID'));
  assert.deepEqual(await readFile(f.path), original);
  const otherId = 'other_host', otherPath = filePath(f.directory, otherId); await writeFile(otherPath, original);
  const other = new PhoneRequestCustody(new EncryptedFilePhoneCustodyStorage({ directory: f.directory, custodyId: otherId, key: KEY }));
  await assert.rejects(other.list(owner), errorCode('CACHE_INVALID'));
  assert.deepEqual(await readFile(otherPath), original);
  assert.equal((await f.reopen().list(owner)).length, 1);
});

test('transaction errors, asynchronous callbacks and invalid records roll back without leaking adapter details', async t => {
  const f = await fixture(t); await f.custody.reserve(record()); const original = await readFile(f.path);
  await assert.rejects(f.storage.transaction(records => { records.push(record('new')); throw new Error('PRIVATE_BACKEND_PATH'); }), errorCode('CACHE_INVALID'));
  await assert.rejects(f.storage.transaction(records => { records.push({ ...record('new'), credential: 'PRIVATE_TOKEN' } as PhoneCustodyRecord); }), errorCode('CACHE_INVALID'));
  await assert.rejects(f.storage.transaction((async (records: PhoneCustodyRecord[]) => { records.push(record('new')); }) as any), errorCode('CACHE_INVALID'));
  assert.deepEqual(await readFile(f.path), original);
  for (const input of [
    { ...record('new'), question: 'DO_NOT_PERSIST' }, { ...record('new'), binding: { ...binding, credential: 'DO_NOT_PERSIST' } },
    { ...record('new'), scope: { ...record().scope, token: 'DO_NOT_PERSIST' } },
    { ...record('new'), state: success('new') }, { ...record('new'), inputDigest: 'not_a_digest' },
    { ...record('new'), expiresAt: START }, { ...record('new'), scope: { ...record().scope, sourceIds: ['source', 'source'] } },
  ]) await assert.rejects(f.custody.reserve(input as PhoneCustodyRecord), errorCode('INVALID_REQUEST'));
  assert.deepEqual(await readFile(f.path), original);
});

test('retention bounds retain all identities, refuse new work, and allow exact duplicates and settlements at capacity', async t => {
  const f = await fixture(t);
  await f.storage.transaction(records => {
    for (let s = 0; s < 10; s++) for (let i = 0; i < 100; i++) records.push(record(`request_${i}`, {}, `session_${s}`));
  });
  const full = { ...owner, sessionId: 'session_0' };
  assert.equal((await f.custody.list(full)).length, 100);
  await assert.rejects(f.custody.reserve(record('new', {}, full.sessionId)), errorCode('REQUEST_EXISTS'));
  await assert.rejects(f.custody.reserve(record('new', {}, 'new_session')), errorCode('REQUEST_EXISTS'));
  assert.equal((await f.custody.reserve(record('request_0', {}, full.sessionId))).dispatch, false);
  await f.custody.settle(full, 'request_0', { status: 'cancelled', requestId: 'request_0' });
  assert.equal((await f.reopen().list(full)).length, 100);
  await assert.rejects(f.custody.reserve(record('request_0', {}, 'new_session')), errorCode('REQUEST_EXISTS'));
  assert.equal((await f.reopen().get(full, 'request_0'))?.state.status, 'cancelled');
});

test('snapshot and UTF-8 record byte budgets fail closed without publishing oversized replacement', async t => {
  const f = await fixture(t); await f.custody.reserve(record()); const original = await readFile(f.path);
  await assert.rejects(f.custody.settle(owner, 'request1', success('request1', '\u4e00'.repeat(64000))), errorCode('INVALID_RESPONSE'));
  await assert.rejects(f.storage.transaction(records => {
    records.length = 0;
    for (let i = 0; i < 140; i++) { const value = record(`large_${i}`, {}, `session_${Math.floor(i / 100)}`); value.state = success(value.identity.requestId, 'x'.repeat(64000)); records.push(value); }
  }), errorCode('CACHE_INVALID'));
  assert.deepEqual(await readFile(f.path), original);
});

test('configuration, nonexistent directories, nonregular files and hard links refuse with opaque public errors', async t => {
  const f = await fixture(t);
  for (const config of [
    { directory: 'relative', custodyId: CUSTODY, key: KEY }, { directory: f.directory, custodyId: '../outside', key: KEY },
    { directory: f.directory, custodyId: CUSTODY, key: new Uint8Array(31) },
  ]) assert.throws(() => new EncryptedFilePhoneCustodyStorage(config), errorCode('CACHE_INVALID'));
  const missing = new EncryptedFilePhoneCustodyStorage({ directory: join(f.directory, 'missing'), custodyId: CUSTODY, key: KEY });
  await assert.rejects(missing.transaction(() => undefined), errorCode('CACHE_INVALID'));
  await mkdir(f.path); await assert.rejects(f.custody.list(owner), errorCode('CACHE_INVALID')); await rm(f.path, { recursive: true });
  await f.custody.reserve(record());
  await link(f.path, join(f.directory, 'unexpected_hard_link'));
  await assert.rejects(f.custody.list(owner), errorCode('CACHE_INVALID'));
});

test('a directory symlink or Windows junction cannot redirect custody into another directory', async t => {
  const f = await fixture(t), target = join(f.directory, 'real'), redirected = join(f.directory, 'redirected');
  await mkdir(target); await symlink(target, redirected, process.platform === 'win32' ? 'junction' : 'dir');
  const storage = new EncryptedFilePhoneCustodyStorage({ directory: redirected, custodyId: CUSTODY, key: KEY });
  await assert.rejects(new PhoneRequestCustody(storage).reserve(record()), errorCode('CACHE_INVALID'));
  assert.deepEqual(await readdir(target), []);
});

test('a newly started process recovers an admitted terminal result and reserves the exact identity without dispatch', async t => {
  const f = await fixture(t); await f.custody.reserve(record()); await f.custody.settle(owner, 'request1', success());
  const moduleUrl = new URL('../runtime/phone/request-custody.ts', import.meta.url).href;
  const script = `import { EncryptedFilePhoneCustodyStorage, PhoneRequestCustody } from ${JSON.stringify(moduleUrl)};
    const custody = new PhoneRequestCustody(new EncryptedFilePhoneCustodyStorage({directory:${JSON.stringify(f.directory)},custodyId:${JSON.stringify(CUSTODY)},key:Uint8Array.from(${JSON.stringify([...KEY])})}));
    const original = await custody.get(${JSON.stringify(owner)}, 'request1');
    const duplicate = await custody.reserve(${JSON.stringify(record())});
    process.stdout.write(JSON.stringify({original,duplicate}));`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = ''; child.stdout.on('data', bytes => { output += bytes.toString(); });
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, 0);
  const recovered = JSON.parse(output);
  assert.deepEqual(recovered.original.state, success()); assert.equal(recovered.duplicate.dispatch, false);
  assert.deepEqual(recovered.duplicate.record, recovered.original);
});

test('a rejected async transaction callback stays opaque and cannot crash a newly started process', async t => {
  const f = await fixture(t); await f.custody.reserve(record()); const original = await readFile(f.path);
  const moduleUrl = new URL('../runtime/phone/request-custody.ts', import.meta.url).href;
  const script = `import { EncryptedFilePhoneCustodyStorage } from ${JSON.stringify(moduleUrl)};
    const storage = new EncryptedFilePhoneCustodyStorage({directory:${JSON.stringify(f.directory)},custodyId:${JSON.stringify(CUSTODY)},key:Uint8Array.from(${JSON.stringify([...KEY])})});
    try { await storage.transaction(async () => { throw new Error('PRIVATE_BACKEND_PATH'); }); }
    catch(error) { process.stdout.write(error.message); }
    await new Promise(resolve => setImmediate(resolve));`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '', diagnostic = '';
  child.stdout.on('data', bytes => { output += bytes.toString(); }); child.stderr.on('data', bytes => { diagnostic += bytes.toString(); });
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, 0); assert.equal(output, 'CACHE_INVALID'); assert.equal(diagnostic, '');
  assert.deepEqual(await readFile(f.path), original);
});

test('a separate process holding the conservative writer lock blocks mutation without replay or plaintext errors', async t => {
  const f = await fixture(t); await f.custody.reserve(record()); const original = await readFile(f.path);
  const lockUrl = new URL('../runtime/process-lock.ts', import.meta.url).href;
  const script = `import { acquireProcessLock } from ${JSON.stringify(lockUrl)}; const lock = await acquireProcessLock(${JSON.stringify(`${f.path}.lock`)}); process.stdout.write('LOCKED\\n'); process.stdin.once('data', async () => { await lock.release(); process.exit(0); });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const exited = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await exited; } });
  await new Promise<void>((resolve, reject) => {
    child.stdout.once('data', bytes => bytes.toString().includes('LOCKED') ? resolve() : reject(new Error('Unexpected child protocol')));
    child.once('error', reject); child.once('exit', code => reject(new Error(`Lock child exited before ready: ${code}`)));
  });
  await assert.rejects(f.custody.reserve(record('new')), errorCode('CACHE_INVALID'));
  assert.deepEqual(await readFile(f.path), original);
  child.stdin.write('RELEASE\n'); assert.equal(await exited, 0);
  assert.equal((await f.custody.reserve(record())).dispatch, false);
  assert.equal((await f.custody.reserve(record('new'))).dispatch, true);
});
