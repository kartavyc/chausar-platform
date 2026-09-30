import test from 'node:test';
import assert from 'node:assert/strict';
import { PhoneClient } from '../runtime/phone/client.ts';
import { PhoneError } from '../runtime/phone/contracts.ts';
import type { ApprovalChallenge, Brief, BriefCache, CachedBrief, DeviceBinding, PhoneCredentialStore, PhoneMethods, PhoneTransport, SessionGrant } from '../runtime/phone/contracts.ts';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
class Credentials implements PhoneCredentialStore {
  value?: SessionGrant; clears = 0;
  async load() { return structuredClone(this.value); }
  async save(grant: SessionGrant) { this.value = structuredClone(grant); }
  async clear() { this.value = undefined; this.clears += 1; }
}
class Cache implements BriefCache {
  values = new Map<string, CachedBrief>(); clears = 0;
  async put(_binding: DeviceBinding, brief: Brief) { this.values.set(brief.id, { ...brief, cachedAt: brief.generatedAt, expiresAt: '2099-01-01T00:00:00Z' }); }
  async read(_binding: DeviceBinding, id: string) { return this.values.get(id); }
  async clear() { this.values.clear(); this.clears += 1; }
}
type Method = keyof PhoneMethods;
type Handler = (method: Method, input: any, options: { credential?: string; signal: AbortSignal }) => unknown | Promise<unknown>;
class Transport implements PhoneTransport {
  methods: Method[] = []; handler!: Handler;
  async request<M extends Method>(method: M, input: PhoneMethods[M]['input'], options: { credential?: string; signal: AbortSignal }): Promise<PhoneMethods[M]['output']> {
    this.methods.push(method); return await this.handler(method, input, options) as PhoneMethods[M]['output'];
  }
}
function fixture() {
  let time = Date.parse('2026-10-01T00:00:00Z');
  const binding = { workspaceId: 'shop', memberId: 'owner', deviceId: 'phone1', epoch: 1 };
  const authority = () => ({ binding: { ...binding }, sessionId: 'session1', expiresAt: new Date(time + 86400000).toISOString(), validatedAt: new Date(time).toISOString(), capabilities: ['brief.read', 'chat', 'upload', 'approval.simple'] as const });
  const grant = (): SessionGrant => ({ authority: { ...authority(), capabilities: [...authority().capabilities] }, credential: 'fixture-credential-never-print-000000000000' });
  const brief: Brief = { id: 'brief1', workspaceId: 'shop', version: 'v1', generatedAt: new Date(time).toISOString(), title: 'Monday brief', summary: 'Synthetic summary', receiptIds: ['receipt1'] };
  const challenge = (): ApprovalChallenge => ({ preview: { approvalId: 'approval1', actionId: 'action1', binding: { ...binding }, actionRevision: 1, operationVersion: 'draft:1.0', digest: 'a'.repeat(64), expiresAt: new Date(time + 300000).toISOString(), title: 'Update internal draft', summary: 'One reversible working row', eligibility: 'simple-reversible' }, token: 'b'.repeat(64) });
  const credentials = new Credentials(); credentials.value = grant(); const cache = new Cache(); const transport = new Transport();
  transport.handler = (method, input) => {
    if (method === 'session.validate') return { status: 'current', authority: authority() };
    if (method === 'pairing.accept') return grant();
    if (method === 'session.revoke') return { status: 'revoked', deviceId: input.deviceId };
    if (method === 'brief.read') return brief;
    if (method === 'brief.list') return [brief];
    if (method === 'chat.start') return { status: 'pending', requestId: input.requestId };
    if (method === 'approval.inspect') return challenge();
    if (method === 'approval.submit') return { status: 'pending', requestId: input.requestId };
    if (method === 'upload.begin') return { uploadId: 'upload1', maxChunkBytes: 2, expiresAt: new Date(time + 300000).toISOString() };
    if (method === 'upload.chunk') return { nextOffset: input.offset + input.bytes.length };
    if (method === 'upload.finish') return { status: 'succeeded', requestId: input.requestId, result: { uploadId: input.uploadId, sourceId: 'source1', status: 'awaiting-confirmation', sourceTainted: true } };
    if (method === 'request.status') return { status: 'pending', requestId: input.requestId };
    if (method === 'request.cancel') return { status: 'cancelled', requestId: input.requestId };
    throw new Error('Unhandled fixture method');
  };
  const client = new PhoneClient({ channel: 'ios', transport, credentials, cache, clock: () => time });
  return { client, credentials, cache, transport, authority, grant, brief, challenge, advance: (ms: number) => { time += ms; }, clock: () => time };
}
async function connected() { const f = fixture(); await f.client.restore(); await f.client.reconnect(); return f; }
const pairInput = { inviteCode: 'invite-code', deviceId: 'phone1', channel: 'ios' as const, devicePublicKey: 'public-fixture-key', proof: 'fixture-signature' };

test('restored credentials provide cached reading only; all authority requires online validation', async () => {
  const f = fixture(); await f.cache.put(f.grant().authority.binding, f.brief); await f.client.restore();
  assert.equal(f.client.snapshot().pairing.status, 'validation-required');
  assert.equal((await f.client.readBrief('brief1')).freshness, 'cached');
  await assert.rejects(f.client.chat('chat1', 'What changed?'), { code: 'OFFLINE' }); assert.deepEqual(f.transport.methods, []);
  await f.client.reconnect(); await f.client.chat('chat1', 'What changed?');
  assert.deepEqual(f.transport.methods, ['session.validate', 'session.validate', 'chat.start']);
  assert.equal(f.client.snapshot().requests[0].status, 'pending');
});
test('pairing stores an opaque grant, then validates; diagnostic state omits credentials', async () => {
  const f = fixture(); f.credentials.value = undefined; await f.client.reconnect(); await f.client.pair(pairInput);
  assert.equal(f.client.snapshot().pairing.status, 'paired'); assert.equal(f.credentials.value?.credential, f.grant().credential);
  assert.equal(JSON.stringify(f.client.snapshot()).includes(f.grant().credential), false);
  assert.deepEqual(f.transport.methods, ['pairing.accept', 'session.validate']);
});
test('pairing failure and wrong device response cannot create authority', async () => {
  const f = fixture(); f.credentials.value = undefined; await f.client.reconnect();
  f.transport.handler = () => ({ ...f.grant(), authority: { ...f.grant().authority, binding: { ...f.grant().authority.binding, deviceId: 'other-phone' } } });
  await assert.rejects(f.client.pair(pairInput), { code: 'INVALID_RESPONSE' }); assert.equal(f.credentials.value, undefined); assert.equal(f.client.snapshot().pairing.status, 'unpaired');
});
test('a revoked online validation erases credentials, challenges and cached briefs', async () => {
  const f = await connected(); await f.client.readBrief('brief1'); await f.client.inspectApproval('approval1');
  f.transport.handler = () => ({ status: 'revoked' });
  await assert.rejects(f.client.decideApproval('decide1', 'approval1', 'approve'), { code: 'ACCESS_REVOKED' });
  assert.equal(f.client.snapshot().pairing.status, 'revoked'); assert.equal(f.credentials.value, undefined); assert.equal(f.cache.values.size, 0);
  assert.equal(f.transport.methods.includes('approval.submit'), false);
});
test('expired restored grants erase offline cache rather than claiming current access', async () => {
  const f = fixture(); await f.cache.put(f.grant().authority.binding, f.brief); f.advance(86400001); await f.client.restore();
  assert.equal(f.client.snapshot().pairing.status, 'expired'); assert.equal(f.cache.values.size, 0); assert.equal(f.credentials.value, undefined);
});
test('a validation response cannot change a binding, session or reuse an old validation timestamp', async () => {
  for (const variant of ['epoch', 'session', 'old']) {
    const f = await connected(); const a = f.grant().authority;
    if (variant === 'epoch') a.binding.epoch += 1; if (variant === 'session') a.sessionId = 'session2'; if (variant === 'old') a.validatedAt = new Date(f.clock() - 60000).toISOString();
    f.transport.handler = () => ({ status: 'current', authority: a });
    await assert.rejects(f.client.chat('chat1', 'Question'), { code: 'INVALID_RESPONSE' }); assert.equal(f.transport.methods.includes('chat.start'), false);
    assert.equal(f.client.snapshot().pairing.status, 'validation-required'); assert.equal(f.client.snapshot().connection, 'offline');
  }
});
test('lost chat response becomes unknown and reconnect polls without resending', async () => {
  const f = await connected(); const original = f.transport.handler;
  f.transport.handler = (method, input, options) => method === 'chat.start' ? Promise.reject(new Error(`raw credential ${f.grant().credential}`)) : original(method, input, options);
  await assert.rejects(f.client.chat('chat1', 'Question'), { message: 'TRANSPORT_UNKNOWN' });
  assert.equal(f.client.snapshot().requests[0].status, 'unknown');
  f.transport.handler = (method, input, options) => method === 'request.status' ? { status: 'succeeded', requestId: input.requestId, result: { conversationId: 'conversation1', text: 'Answer with proof', receiptIds: ['receipt1'], credential: 'must-be-discarded' } } : original(method, input, options);
  await f.client.reconnect(); assert.equal(f.transport.methods.filter(m => m === 'chat.start').length, 1);
  assert.equal(f.client.snapshot().requests[0].status, 'succeeded'); assert.equal(JSON.stringify(f.client.snapshot()).includes('must-be-discarded'), false);
  await assert.rejects(f.client.chat('chat1', 'Retry'), { code: 'REQUEST_EXISTS' });
});
test('approval tokens are memory only; offline taps and reconnect never enqueue or replay approval', async () => {
  const f = await connected(); const preview = await f.client.inspectApproval('approval1'); assert.equal(Object.hasOwn(preview, 'token'), false);
  assert.equal(JSON.stringify(f.client.snapshot()).includes('b'.repeat(64)), false);
  f.client.disconnect(); await assert.rejects(f.client.decideApproval('decide1', 'approval1', 'approve'), { code: 'OFFLINE' });
  await f.client.reconnect(); await assert.rejects(f.client.decideApproval('decide1', 'approval1', 'approve'), { code: 'VALIDATION_REQUIRED' });
  assert.equal(f.transport.methods.includes('approval.submit'), false);
});
test('lost approval acknowledgment can only be reconciled by request ID', async () => {
  const f = await connected(); await f.client.inspectApproval('approval1'); const original = f.transport.handler;
  f.transport.handler = (method, input, options) => method === 'approval.submit' ? Promise.reject(new Error('connection lost after receipt')) : original(method, input, options);
  await assert.rejects(f.client.decideApproval('decide1', 'approval1', 'approve'), { code: 'TRANSPORT_UNKNOWN' });
  f.transport.handler = (method, input, options) => method === 'request.status' ? { status: 'succeeded', requestId: input.requestId, result: { approvalId: 'approval1', actionId: 'action1', decision: 'approved', decidedAt: new Date(f.clock()).toISOString() } } : original(method, input, options);
  await f.client.reconnect(); assert.equal(f.client.snapshot().requests[0].status, 'succeeded'); assert.equal(f.transport.methods.filter(m => m === 'approval.submit').length, 1);
});
test('expired challenge and desktop-only operations have no approval submission', async () => {
  const f = await connected(); await f.client.inspectApproval('approval1'); f.advance(300001);
  await assert.rejects(f.client.decideApproval('decide1', 'approval1', 'approve'), { code: 'APPROVAL_EXPIRED' });
  const original = f.transport.handler; f.transport.handler = (method, input, options) => method === 'approval.inspect' ? { preview: { ...f.challenge().preview, eligibility: 'open-desktop' } } : original(method, input, options);
  assert.equal((await f.client.inspectApproval('approval1')).eligibility, 'open-desktop'); await assert.rejects(f.client.decideApproval('decide1', 'approval1', 'approve'), { code: 'OPEN_DESKTOP' });
  assert.equal(f.transport.methods.includes('approval.submit'), false);
});
test('uploads are chunked with exact offsets and finish as outside data awaiting confirmation', async () => {
  const f = await connected(); const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const result = await f.client.upload('upload-request1', { name: 'bill.pdf', mediaType: 'application/pdf', sizeBytes: 5, sha256 }, bytes);
  assert.equal(result.status, 'succeeded'); if (result.status === 'succeeded') assert.deepEqual(result.result, { uploadId: 'upload1', sourceId: 'source1', status: 'awaiting-confirmation', sourceTainted: true });
  assert.equal(f.transport.methods.filter(m => m === 'upload.chunk').length, 3);
  await assert.rejects(f.client.upload('upload-request2', { name: 'bill.pdf', mediaType: 'application/pdf', sizeBytes: 5, sha256: '0'.repeat(64) }, bytes), { code: 'INVALID_REQUEST' });
});
test('cancel aborts an active upload and waits for a remote acknowledgement', async () => {
  const f = await connected(); const chunk = deferred<{ nextOffset: number }>(); const entered = deferred<void>(); const original = f.transport.handler;
  f.transport.handler = (method, input, options) => { if (method === 'upload.chunk') { entered.resolve(); return chunk.promise; } return original(method, input, options); };
  const bytes = new Uint8Array([1, 2, 3]); const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const uploading = f.client.upload('upload-request1', { name: 'bill.pdf', mediaType: 'application/pdf', sizeBytes: 3, sha256 }, bytes);
  const rejected = assert.rejects(uploading, { code: 'VALIDATION_REQUIRED' }); await entered.promise;
  assert.equal((await f.client.cancel('upload-request1')).status, 'cancelled'); chunk.resolve({ nextOffset: 2 }); await rejected;
  assert.equal(f.client.snapshot().requests[0].status, 'cancelled'); assert.equal(f.transport.methods.includes('upload.finish'), false);
});
test('unacknowledged cancellation remains unknown and is settled after reconnect', async () => {
  const f = await connected(); await f.client.chat('chat1', 'Question'); const original = f.transport.handler;
  f.transport.handler = (method, input, options) => method === 'request.cancel' ? Promise.reject(new Error('lost acknowledgement')) : original(method, input, options);
  await assert.rejects(f.client.cancel('chat1'), { code: 'TRANSPORT_UNKNOWN' }); assert.equal(f.client.snapshot().requests[0].status, 'unknown');
  f.transport.handler = (method, input, options) => method === 'request.status' ? { status: 'cancelled', requestId: input.requestId } : original(method, input, options);
  await f.client.reconnect(); assert.equal(f.client.snapshot().requests[0].status, 'cancelled');
});
test('late brief responses after disconnect cannot reach cache or UI', async () => {
  const f = await connected(); const output = deferred<Brief>(); const entered = deferred<void>(); const original = f.transport.handler;
  f.transport.handler = (method, input, options) => { if (method === 'brief.read') { entered.resolve(); return output.promise; } return original(method, input, options); };
  const read = f.client.readBrief('brief1'); const rejected = assert.rejects(read, { code: 'VALIDATION_REQUIRED' }); await entered.promise; f.client.disconnect(); output.resolve(f.brief); await rejected;
  assert.equal(f.cache.values.size, 0);
});
test('fresh revocation acknowledged by the server erases the local grant and briefs', async () => {
  const f = await connected(); await f.client.readBrief('brief1'); await f.client.revoke();
  assert.equal(f.client.snapshot().pairing.status, 'revoked'); assert.equal(f.credentials.value, undefined); assert.equal(f.cache.values.size, 0);
});
test('chat is unavailable without a current grant or capability, and messaging channels cannot be app clients', async () => {
  const f = await connected(); f.transport.handler = () => ({ status: 'current', authority: { ...f.authority(), capabilities: ['brief.read'] } });
  await assert.rejects(f.client.chat('chat1', 'Question'), { code: 'CAPABILITY_FORBIDDEN' });
  assert.throws(() => new PhoneClient({ channel: 'whatsapp' as any, transport: f.transport, credentials: f.credentials, cache: f.cache }), PhoneError);
});
test('an offline cached read is discarded when the device is forgotten during storage IO', async () => {
  const f = fixture(); await f.client.restore(); const output = deferred<CachedBrief | undefined>();
  f.cache.read = () => output.promise;
  const read = f.client.readBrief('brief1'); const rejected = assert.rejects(read, { code: 'VALIDATION_REQUIRED' });
  await f.client.forgetDevice(); output.resolve({ ...f.brief, cachedAt: f.brief.generatedAt, expiresAt: '2099-01-01T00:00:00Z' }); await rejected;
  assert.equal(f.client.snapshot().pairing.status, 'unpaired');
});
test('a status response started before cancellation cannot undo acknowledged cancellation', async () => {
  const f = await connected(); await f.client.chat('chat1', 'Question'); const status = deferred<any>(); const entered = deferred<void>(); const original = f.transport.handler;
  f.transport.handler = (method, input, options) => { if (method === 'request.status') { entered.resolve(); return status.promise; } return original(method, input, options); };
  const refresh = f.client.refreshRequest('chat1'); const rejected = assert.rejects(refresh, { code: 'VALIDATION_REQUIRED' }); await entered.promise;
  await f.client.cancel('chat1'); status.resolve({ status: 'pending', requestId: 'chat1' }); await rejected;
  assert.equal(f.client.snapshot().requests[0].status, 'cancelled');
  const before = f.transport.methods.length; assert.equal((await f.client.refreshRequest('chat1')).status, 'cancelled'); assert.equal(f.transport.methods.length, before);
});
test('concurrent status responses preserve the newest request outcome', async () => {
  const f = await connected(); await f.client.chat('chat1', 'Question'); const first = deferred<any>(); const entered = deferred<void>(); let calls = 0; const original = f.transport.handler;
  f.transport.handler = (method, input, options) => { if (method === 'request.status') { calls += 1; if (calls === 1) { entered.resolve(); return first.promise; } return { status: 'succeeded', requestId: 'chat1', result: { conversationId: 'conversation1', text: 'Final answer', receiptIds: ['receipt1'] } }; } return original(method, input, options); };
  const older = f.client.refreshRequest('chat1'); const rejected = assert.rejects(older, { code: 'VALIDATION_REQUIRED' }); await entered.promise;
  assert.equal((await f.client.refreshRequest('chat1')).status, 'succeeded'); first.resolve({ status: 'pending', requestId: 'chat1' }); await rejected;
  assert.equal(f.client.snapshot().requests[0].status, 'succeeded');
});
test('forgetting a device clears old workspace request data and prevents late results from restoring it', async () => {
  const f = await connected(); await f.client.chat('chat1', 'Question'); await f.client.forgetDevice();
  assert.deepEqual(f.client.snapshot().requests, []); const grant = f.grant(); grant.authority.binding.workspaceId = 'shop2'; grant.authority.sessionId = 'session2';
  const original = f.transport.handler; f.transport.handler = (method, input, options) => method === 'pairing.accept' ? grant : method === 'session.validate' ? { status: 'current', authority: grant.authority } : original(method, input, options);
  await f.client.reconnect(); await f.client.pair(pairInput); await f.client.reconnect();
  assert.equal(f.transport.methods.includes('request.status'), false); assert.deepEqual(f.client.snapshot().requests, []);
});
test('upload content and metadata are snapshotted before hashing and asynchronous transport', async () => {
  const f = await connected(); const original = f.transport.handler; const slot = deferred<any>(); const entered = deferred<void>(); const chunks: number[] = []; let sentName = '';
  f.transport.handler = (method, input, options) => { if (method === 'upload.begin') { sentName = input.metadata.name; entered.resolve(); return slot.promise; } if (method === 'upload.chunk') chunks.push(...input.bytes); return original(method, input, options); };
  const bytes = new Uint8Array([1, 2, 3]); const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex'); const metadata = { name: 'bill.pdf', mediaType: 'application/pdf' as const, sizeBytes: 3, sha256 };
  const upload = f.client.upload('upload-request1', metadata, bytes); await entered.promise; metadata.name = 'changed.pdf'; bytes[0] = 255;
  slot.resolve({ uploadId: 'upload1', maxChunkBytes: 2, expiresAt: new Date(f.clock() + 300000).toISOString() }); await upload;
  assert.equal(sentName, 'bill.pdf'); assert.deepEqual(chunks, [1, 2, 3]);
});
test('approval preview returned to UI cannot mutate the private challenge', async () => {
  const f = await connected(); const preview = await f.client.inspectApproval('approval1'); preview.digest = '0'.repeat(64); preview.binding.epoch = 42;
  const original = f.transport.handler; let digest = ''; f.transport.handler = (method, input, options) => { if (method === 'approval.submit') digest = input.expectedDigest; return original(method, input, options); };
  await f.client.decideApproval('decide1', 'approval1', 'approve'); assert.equal(digest, 'a'.repeat(64));
});
test('only one pairing request may be in flight and caller mutations cannot change its request', async () => {
  const f = fixture(); f.credentials.value = undefined; await f.client.reconnect(); const grant = deferred<SessionGrant>(); const entered = deferred<void>(); const original = f.transport.handler; let sent: any;
  f.transport.handler = (method, input, options) => { if (method === 'pairing.accept') { sent = input; entered.resolve(); return grant.promise; } return original(method, input, options); };
  const input = { ...pairInput }; const pair = f.client.pair(input); await entered.promise; input.deviceId = 'changed-device';
  await assert.rejects(f.client.pair(pairInput), { code: 'REQUEST_EXISTS' }); assert.equal(sent.deviceId, 'phone1'); grant.resolve(f.grant()); await pair;
  assert.equal(f.transport.methods.filter(method => method === 'pairing.accept').length, 1);
});
test('upload cancellation during checksum preparation confirms no remote upload was sent', async () => {
  const f = fixture(); const hashed = deferred<ArrayBuffer>(); const entered = deferred<void>();
  const cryptoAdapter = { subtle: { digest: async () => { entered.resolve(); return hashed.promise; } } } as unknown as Crypto;
  const client = new PhoneClient({ channel: 'ios', transport: f.transport, credentials: f.credentials, cache: f.cache, clock: f.clock, crypto: cryptoAdapter }); await client.restore(); await client.reconnect();
  const bytes = new Uint8Array([1, 2]); const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const upload = client.upload('upload-request1', { name: 'bill.pdf', mediaType: 'application/pdf', sizeBytes: 2, sha256 }, bytes); const rejected = assert.rejects(upload, { code: 'VALIDATION_REQUIRED' }); await entered.promise;
  assert.equal((await client.cancel('upload-request1')).status, 'cancelled'); hashed.resolve(await crypto.subtle.digest('SHA-256', bytes)); await rejected;
  assert.equal(f.transport.methods.includes('upload.begin'), false); assert.equal(f.transport.methods.includes('request.cancel'), false); assert.equal(client.snapshot().requests[0].status, 'cancelled');
});
test('an old upload checksum cannot dispatch into a newly paired workspace or alter a reused request ID', async () => {
  const f = fixture(); const hashed = deferred<ArrayBuffer>(); const entered = deferred<void>();
  const cryptoAdapter = { subtle: { digest: async () => { entered.resolve(); return hashed.promise; } } } as unknown as Crypto;
  const client = new PhoneClient({ channel: 'ios', transport: f.transport, credentials: f.credentials, cache: f.cache, clock: f.clock, crypto: cryptoAdapter }); await client.restore(); await client.reconnect();
  const bytes = new Uint8Array([1, 2]); const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const upload = client.upload('request1', { name: 'bill.pdf', mediaType: 'application/pdf', sizeBytes: 2, sha256 }, bytes); const rejected = assert.rejects(upload, { code: 'VALIDATION_REQUIRED' }); await entered.promise;
  await client.forgetDevice(); const grant = f.grant(); grant.authority.binding.workspaceId = 'shop2'; grant.authority.sessionId = 'session2';
  const original = f.transport.handler; f.transport.handler = (method, input, options) => method === 'pairing.accept' ? grant : method === 'session.validate' ? { status: 'current', authority: grant.authority } : original(method, input, options);
  await client.reconnect(); await client.pair(pairInput); await client.chat('request1', 'New workspace question');
  hashed.resolve(await crypto.subtle.digest('SHA-256', bytes)); await rejected;
  assert.equal(f.transport.methods.includes('upload.begin'), false); assert.equal(f.transport.methods.includes('upload.chunk'), false); assert.equal(client.snapshot().requests[0].status, 'pending');
});
test('an old aborted pairing cannot overwrite the state of a newer pairing attempt', async () => {
  const f = fixture(); f.credentials.value = undefined; await f.client.reconnect(); const first = deferred<SessionGrant>(); const second = deferred<SessionGrant>(); let calls = 0; const original = f.transport.handler;
  f.transport.handler = (method, input, options) => { if (method === 'pairing.accept') return ++calls === 1 ? first.promise : second.promise; return original(method, input, options); };
  const older = f.client.pair(pairInput); const rejected = assert.rejects(older, { code: 'VALIDATION_REQUIRED' }); f.client.disconnect(); await f.client.reconnect();
  const newer = f.client.pair(pairInput); first.resolve(f.grant()); await rejected; assert.equal(f.client.snapshot().pairing.status, 'pairing');
  await assert.rejects(f.client.pair(pairInput), { code: 'REQUEST_EXISTS' }); second.resolve(f.grant()); await newer;
  assert.equal(f.client.snapshot().pairing.status, 'paired');
});
