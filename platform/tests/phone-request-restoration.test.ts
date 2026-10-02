import test from 'node:test';
import assert from 'node:assert/strict';
import { PhoneClient } from '../runtime/phone/client.ts';
import type { PhoneRequestIdentity, PhoneRequestRestoration } from '../runtime/phone/client.ts';
import type { BriefCache, PhoneCredentialStore, PhoneMethods, PhoneTransport, RemoteRequest, RequestResult, SessionAuthority, SessionGrant } from '../runtime/phone/contracts.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
type Method = keyof PhoneMethods;
type Handler = (method: Method, input: any, signal: AbortSignal) => unknown | Promise<unknown>;
type Durable = { identity: PhoneRequestIdentity; result: RemoteRequest<RequestResult> };

/** Synthetic custody survives new clients; no file, native SDK or provider is involved. */
function fixture() {
  let time = Date.parse('2026-10-02T00:00:00Z');
  let authority: SessionAuthority = {
    binding: { workspaceId: 'synthetic_shop', memberId: 'synthetic_owner', deviceId: 'synthetic_phone', epoch: 1 },
    sessionId: 'synthetic_session', validatedAt: new Date(time).toISOString(), expiresAt: new Date(time + 86400000).toISOString(),
    capabilities: ['chat', 'upload', 'approval.simple', 'brief.read'],
  };
  let saved: SessionGrant | undefined = { authority: structuredClone(authority), credential: 'synthetic-local-credential-000000000000' };
  let credentialClears = 0; let cacheClears = 0; let starts = 0;
  const credentials: PhoneCredentialStore = {
    load: async () => structuredClone(saved), save: async grant => { saved = structuredClone(grant); },
    clear: async () => { saved = undefined; credentialClears += 1; },
  };
  const cache: BriefCache = { put: async () => {}, read: async () => undefined, clear: async () => { cacheClears += 1; } };
  const custody = new Map<string, Durable>();
  const calls: { method: Method; input: unknown }[] = [];
  const listCalls: { authority: SessionAuthority; signal: AbortSignal }[] = [];
  let loseChatAcknowledgment = false;
  const defaultHandler: Handler = (method, input) => {
    if (method === 'session.validate') return { status: 'current', authority: structuredClone(authority) };
    if (method === 'session.revoke') return { status: 'revoked', deviceId: input.deviceId };
    if (method === 'chat.start') {
      assert.equal(custody.has(input.requestId), false, 'synthetic effect must be admitted once'); starts += 1;
      const result: RemoteRequest<RequestResult> = { status: 'succeeded', requestId: input.requestId, result: { conversationId: 'synthetic_conversation', text: 'Receipt-backed synthetic answer', receiptIds: ['synthetic_receipt'] } };
      custody.set(input.requestId, { identity: { requestId: input.requestId, kind: 'chat' }, result });
      if (loseChatAcknowledgment) throw new Error('Synthetic response lost after admission');
      return result;
    }
    if (method === 'request.status') return structuredClone(custody.get(input.requestId)?.result ?? { status: 'unknown', requestId: input.requestId });
    if (method === 'request.cancel') {
      const record = custody.get(input.requestId); assert.ok(record, 'recovered cancellation must reach custody');
      record.result = { status: 'cancelled', requestId: input.requestId }; return structuredClone(record.result);
    }
    throw new Error('Unexpected synthetic method');
  };
  let handler = defaultHandler;
  const transport: PhoneTransport = {
    request: async (method, input, options) => {
      calls.push({ method, input: structuredClone(input) });
      return await handler(method, input, options.signal) as PhoneMethods[typeof method]['output'];
    },
  };
  let list: PhoneRequestRestoration['list'] = async () => [...custody.values()].map(record => structuredClone(record.identity));
  const restoration: PhoneRequestRestoration = {
    list: async (current, credential, signal) => {
      assert.equal(credential, saved?.credential);
      assert.deepEqual(current, authority);
      listCalls.push({ authority: structuredClone(current), signal });
      return await list(current, credential, signal);
    },
  };
  const client = (withRestoration = true) => new PhoneClient({ channel: 'web', transport, credentials, cache, clock: () => time, ...(withRestoration ? { requestRestoration: restoration } : {}) });
  const seed = (identity: PhoneRequestIdentity, result: RemoteRequest<RequestResult> = { status: 'pending', requestId: identity.requestId }) => { custody.set(identity.requestId, { identity, result }); };
  return {
    client, custody, seed, calls, listCalls, credentials, cache, transport, restoration, time, defaultHandler,
    setHandler: (next: Handler) => { handler = next; }, setList: (next: PhoneRequestRestoration['list']) => { list = next; },
    loseAcknowledgment: () => { loseChatAcknowledgment = true; },
    replaceGrant: (change: (grant: SessionGrant) => void) => { assert.ok(saved); change(saved); authority = structuredClone(saved.authority); },
    authority: () => structuredClone(authority), counts: () => ({ credentialClears, cacheClears, starts }),
    advance: (ms: number) => { time += ms; },
  };
}
async function connected(f = fixture()) { const client = f.client(); await client.restore(); await client.reconnect(); return { f, client }; }

test('restore loads only credentials; a new validated client discovers and reads all result kinds by ID', async () => {
  const f = fixture();
  f.seed({ requestId: 'chat_done', kind: 'chat' }, { status: 'succeeded', requestId: 'chat_done', result: { conversationId: 'conversation_1', text: 'Synthetic retained answer', receiptIds: ['receipt_1'] } });
  f.seed({ requestId: 'upload_done', kind: 'upload' }, { status: 'succeeded', requestId: 'upload_done', result: { uploadId: 'upload_1', sourceId: 'source_1', status: 'awaiting-confirmation', sourceTainted: true } });
  f.seed({ requestId: 'approval_done', kind: 'approval', target: 'approval_1' }, { status: 'succeeded', requestId: 'approval_done', result: { approvalId: 'approval_1', actionId: 'action_1', decision: 'approved', decidedAt: new Date(f.time).toISOString() } });
  const client = f.client(); await client.restore();
  assert.equal(client.snapshot().pairing.status, 'validation-required'); assert.deepEqual(client.snapshot().requests, []);
  assert.equal(f.calls.length, 0); assert.equal(f.listCalls.length, 0);
  const observed: string[][] = []; client.subscribe(() => observed.push(client.snapshot().requests.map(state => state.status)));
  await client.reconnect();
  assert.ok(observed.some(states => states.length === 3 && states.every(status => status === 'unknown')));
  assert.deepEqual(client.snapshot().requests, [...f.custody.values()].map(record => record.result));
  assert.deepEqual(f.calls.filter(call => call.method !== 'session.validate'), [
    { method: 'request.status', input: { requestId: 'chat_done' } }, { method: 'request.status', input: { requestId: 'upload_done' } }, { method: 'request.status', input: { requestId: 'approval_done' } },
  ]);
  assert.equal(JSON.stringify(client.snapshot()).includes('synthetic-local-credential'), false);
});

test('lost acknowledgment and process restart recover the same admitted effect without replaying its question', async () => {
  const { f, client } = await connected(); f.loseAcknowledgment();
  await assert.rejects(client.chat('chat_lost', 'Synthetic question that is sent once'), { code: 'TRANSPORT_UNKNOWN' });
  assert.equal(client.snapshot().requests[0].status, 'unknown');
  const reopened = f.client(); await reopened.restore(); await reopened.reconnect();
  assert.equal(reopened.snapshot().requests[0].status, 'succeeded'); assert.equal(f.counts().starts, 1);
  assert.equal(f.calls.filter(call => call.method === 'chat.start').length, 1);
  await assert.rejects(reopened.chat('chat_lost', 'A retry must be refused'), { code: 'REQUEST_EXISTS' });
  assert.equal(f.counts().starts, 1);
});

test('a recovered pending request cancels remotely and its cancellation survives another restart', async () => {
  const f = fixture(); f.seed({ requestId: 'pending_upload', kind: 'upload' });
  const { client } = await connected(f); assert.equal(client.snapshot().requests[0].status, 'pending');
  assert.equal((await client.cancel('pending_upload')).status, 'cancelled');
  assert.equal(f.calls.filter(call => call.method === 'request.cancel').length, 1);
  const reopened = f.client(); await reopened.restore(); await reopened.reconnect();
  assert.deepEqual(reopened.snapshot().requests, [{ status: 'cancelled', requestId: 'pending_upload' }]);
  assert.equal(f.calls.some(call => call.method.startsWith('upload.')), false);
});

test('a host-listed identity already reserved locally still requires remote cancellation', async () => {
  const f = fixture(); const enteredList = deferred<void>(); const listed = deferred<readonly PhoneRequestIdentity[]>();
  f.setList(async () => { enteredList.resolve(); return listed.promise; });
  const enteredHash = deferred<void>(); const hashed = deferred<ArrayBuffer>();
  const cryptoAdapter = { subtle: { digest: async () => { enteredHash.resolve(); return hashed.promise; } } } as unknown as Crypto;
  const client = new PhoneClient({ channel: 'web', transport: f.transport, credentials: f.credentials, cache: f.cache, clock: () => f.time, crypto: cryptoAdapter, requestRestoration: f.restoration });
  await client.restore(); const reconnect = client.reconnect(); await enteredList.promise;
  const bytes = new Uint8Array([1, 2]); const digest = await crypto.subtle.digest('SHA-256', bytes); const sha256 = Buffer.from(digest).toString('hex');
  const upload = client.upload('already_remote', { name: 'synthetic.pdf', mediaType: 'application/pdf', sizeBytes: bytes.length, sha256 }, bytes);
  const rejected = assert.rejects(upload, { code: 'VALIDATION_REQUIRED' }); await enteredHash.promise;
  f.seed({ requestId: 'already_remote', kind: 'upload' }); listed.resolve([{ requestId: 'already_remote', kind: 'upload' }]); await reconnect;
  assert.equal((await client.cancel('already_remote')).status, 'cancelled'); hashed.resolve(digest); await rejected;
  assert.equal(f.calls.filter(call => call.method === 'request.cancel').length, 1);
  assert.equal(f.calls.some(call => call.method.startsWith('upload.')), false);
});

test('same-session terminal results remain terminal and unresolved local identities survive optional-port omission', async () => {
  const { f, client } = await connected(); await client.chat('chat_done', 'Synthetic question');
  const before = f.calls.filter(call => call.method === 'request.status').length;
  await client.reconnect(); assert.equal(client.snapshot().requests[0].status, 'succeeded');
  assert.equal(f.calls.filter(call => call.method === 'request.status').length, before);
  const legacy = f.client(false); await legacy.restore(); await legacy.reconnect();
  f.setHandler((method, input, signal) => { if (method === 'chat.start') { f.seed({ requestId: input.requestId, kind: 'chat' }); return { status: 'pending', requestId: input.requestId }; } return f.defaultHandler(method, input, signal); });
  await legacy.chat('legacy_pending', 'Synthetic question'); legacy.disconnect(); await legacy.reconnect();
  assert.equal(legacy.snapshot().requests[0].status, 'pending');
  assert.equal((await legacy.cancel('legacy_pending')).status, 'cancelled');
});

test('malformed, duplicate, oversize or content-bearing descriptor lists refuse the entire import', async () => {
  const valid: PhoneRequestIdentity = { requestId: 'valid_first', kind: 'chat' };
  const invalidLists: unknown[] = [
    {}, [valid, valid], Array.from({ length: 101 }, (_, i) => ({ requestId: `request_${i}`, kind: 'chat' })),
    [valid, { requestId: 'bad', kind: 'execute' }], [valid, { requestId: '../bad', kind: 'chat' }],
    [valid, { requestId: 'bad', kind: 'approval' }], [valid, { requestId: 'bad', kind: 'upload', target: '../bad' }],
    [valid, { requestId: 'bad', kind: 'chat', question: 'Bodies must never be restored' }],
    [valid, { requestId: 'bad', kind: 'approval', target: 'approval_1', token: 'a'.repeat(64) }],
  ];
  for (const invalid of invalidLists) {
    const f = fixture(); f.setList(async () => invalid as PhoneRequestIdentity[]); const client = f.client(); await client.restore();
    await assert.rejects(client.reconnect(), { code: 'INVALID_RESPONSE' });
    assert.deepEqual(client.snapshot().requests, []); assert.equal(f.calls.some(call => call.method === 'request.status'), false);
  }
});

test('an existing request identity cannot be changed by a descriptor list', async () => {
  const { f, client } = await connected(); await client.chat('retained', 'Synthetic question');
  f.setList(async () => [{ requestId: 'new_first', kind: 'chat' }, { requestId: 'retained', kind: 'upload' }]);
  await assert.rejects(client.reconnect(), { code: 'INVALID_RESPONSE' });
  assert.equal(client.snapshot().requests.length, 1); assert.equal(client.snapshot().requests[0].requestId, 'retained');
});

test('recovered approval results must match the retained target and do not restore a challenge', async () => {
  const f = fixture(); f.seed({ requestId: 'approval_pending', kind: 'approval', target: 'approval_1' }, { status: 'succeeded', requestId: 'approval_pending', result: { approvalId: 'different_approval', actionId: 'action_1', decision: 'approved', decidedAt: new Date(f.time).toISOString() } });
  const client = f.client(); await client.restore(); await assert.rejects(client.reconnect(), { code: 'INVALID_RESPONSE' });
  assert.equal(client.snapshot().requests[0].status, 'unknown');
  await assert.rejects(client.decideApproval('new_decision', 'approval_1', 'approve'), { code: 'VALIDATION_REQUIRED' });
  assert.equal(f.calls.some(call => call.method === 'approval.submit'), false);
});

test('restoration failures use fixed revocation and expiry codes and erase local custody', async () => {
  for (const [code, expected, status] of [['ACCESS_REVOKED', 'ACCESS_REVOKED', 'revoked'], ['UNAUTHENTICATED', 'ACCESS_REVOKED', 'revoked'], ['SESSION_EXPIRED', 'SESSION_EXPIRED', 'expired']] as const) {
    const { f, client } = await connected(); await client.chat('retained', 'Synthetic question');
    f.setList(async () => { throw { code, message: 'Raw synthetic credential must never escape' }; });
    await assert.rejects(client.reconnect(), { code: expected, message: expected });
    assert.equal(client.snapshot().pairing.status, status); assert.deepEqual(client.snapshot().requests, []);
    assert.deepEqual(f.counts(), { credentialClears: 1, cacheClears: 1, starts: 1 });
  }
});

test('unknown restoration failures disconnect with a fixed public error and do not poll', async () => {
  const f = fixture(); f.setList(async () => { throw new Error('Raw synthetic adapter message'); });
  const client = f.client(); await client.restore(); await assert.rejects(client.reconnect(), { code: 'TRANSPORT_UNKNOWN', message: 'TRANSPORT_UNKNOWN' });
  assert.equal(client.snapshot().connection, 'offline'); assert.deepEqual(client.snapshot().requests, []);
  assert.equal(f.calls.some(call => call.method === 'request.status'), false);
});

test('expiry while discovery is pending clears the grant before any identities or results are imported', async () => {
  const f = fixture(); const entered = deferred<void>(); const listed = deferred<readonly PhoneRequestIdentity[]>();
  f.setList(async () => { entered.resolve(); return listed.promise; });
  const client = f.client(); await client.restore(); const reconnect = client.reconnect(); const rejected = assert.rejects(reconnect, { code: 'SESSION_EXPIRED' });
  await entered.promise; f.advance(86400001); listed.resolve([{ requestId: 'expired_identity', kind: 'chat' }]); await rejected;
  assert.equal(client.snapshot().pairing.status, 'expired'); assert.deepEqual(client.snapshot().requests, []);
  assert.deepEqual(f.counts(), { credentialClears: 1, cacheClears: 1, starts: 0 });
  assert.equal(f.calls.some(call => call.method === 'request.status'), false);
});

test('changed session or epoch from validation cannot import identities for an old grant', async () => {
  for (const change of ['session', 'epoch']) {
    const f = fixture(); f.seed({ requestId: 'old_identity', kind: 'chat' }); const client = f.client(); await client.restore();
    const next = f.authority(); if (change === 'session') next.sessionId = 'other_session'; else next.binding.epoch += 1;
    f.setHandler(method => { assert.equal(method, 'session.validate'); return { status: 'current', authority: next }; });
    await assert.rejects(client.reconnect(), { code: 'INVALID_RESPONSE' });
    assert.deepEqual(f.listCalls, []); assert.deepEqual(client.snapshot().requests, []);
  }
});

test('replacement restored session or epoch discards old terminal results before listing the new scope', async () => {
  for (const change of ['session', 'epoch']) {
    const { f, client } = await connected(); await client.chat('old_identity', 'Synthetic question');
    f.replaceGrant(grant => { if (change === 'session') grant.authority.sessionId = 'other_session'; else grant.authority.binding.epoch += 1; });
    f.custody.clear(); await client.restore(); assert.deepEqual(client.snapshot().requests, []); assert.equal(client.snapshot().pairing.status, 'validation-required');
    await client.reconnect(); assert.deepEqual(client.snapshot().requests, []);
    assert.equal(f.calls.some(call => call.method === 'request.status'), false);
  }
});

test('replacement restored session or epoch aborts an old pending list before the new scope reconnects', async () => {
  for (const change of ['session', 'epoch']) {
    const f = fixture(); const entered = deferred<void>(); const first = deferred<readonly PhoneRequestIdentity[]>();
    f.setList(async () => { entered.resolve(); return first.promise; });
    const client = f.client(); await client.restore(); const older = client.reconnect(); const rejected = assert.rejects(older, { code: 'VALIDATION_REQUIRED' });
    await entered.promise; f.replaceGrant(grant => { if (change === 'session') grant.authority.sessionId = 'new_session'; else grant.authority.binding.epoch += 1; });
    await client.restore(); assert.equal(f.listCalls[0].signal.aborted, true); f.setList(async () => []); await client.reconnect();
    first.resolve([{ requestId: 'old_identity', kind: 'chat' }]); await rejected;
    assert.deepEqual(client.snapshot().requests, []); assert.equal(f.calls.some(call => call.method === 'request.status'), false);
  }
});

test('late lists after disconnect, forgetting or revocation cannot repopulate requests or poll', async () => {
  for (const action of ['disconnect', 'forget', 'revoke']) {
    const f = fixture(); const entered = deferred<void>(); const listed = deferred<readonly PhoneRequestIdentity[]>();
    f.setList(async () => { entered.resolve(); return listed.promise; });
    const client = f.client(); await client.restore(); const reconnect = client.reconnect();
    const rejected = assert.rejects(reconnect, { code: 'VALIDATION_REQUIRED' }); await entered.promise;
    if (action === 'disconnect') client.disconnect(); else if (action === 'forget') await client.forgetDevice(); else await client.revoke();
    assert.equal(f.listCalls[0].signal.aborted, true); listed.resolve([{ requestId: 'late_identity', kind: 'chat' }]); await rejected;
    assert.deepEqual(client.snapshot().requests, []); assert.equal(f.calls.some(call => call.method === 'request.status'), false);
  }
});

test('a superseded reconnect cannot import its late descriptors over a newer reconnect', async () => {
  const f = fixture(); const entered = deferred<void>(); const first = deferred<readonly PhoneRequestIdentity[]>(); let lists = 0;
  f.seed({ requestId: 'new_identity', kind: 'chat' });
  f.setList(async () => { if (++lists === 1) { entered.resolve(); return first.promise; } return [{ requestId: 'new_identity', kind: 'chat' }]; });
  const client = f.client(); await client.restore(); const older = client.reconnect(); const rejected = assert.rejects(older, { code: 'VALIDATION_REQUIRED' });
  await entered.promise; await client.reconnect(); first.resolve([{ requestId: 'old_identity', kind: 'chat' }]); await rejected;
  assert.deepEqual(client.snapshot().requests, [{ status: 'pending', requestId: 'new_identity' }]);
  assert.deepEqual(f.calls.filter(call => call.method === 'request.status').map(call => call.input), [{ requestId: 'new_identity' }]);
});

test('a reconnect interrupted while polling stops before the next identity and cannot accept the late result', async () => {
  const f = fixture(); f.seed({ requestId: 'first_identity', kind: 'chat' }); f.seed({ requestId: 'second_identity', kind: 'chat' });
  const entered = deferred<void>(); const status = deferred<RemoteRequest<RequestResult>>();
  f.setHandler((method, input, signal) => { if (method === 'request.status') { entered.resolve(); return status.promise; } return f.defaultHandler(method, input, signal); });
  const client = f.client(); await client.restore(); const reconnect = client.reconnect(); const rejected = assert.rejects(reconnect, { code: 'VALIDATION_REQUIRED' });
  await entered.promise; client.disconnect(); status.resolve({ status: 'succeeded', requestId: 'first_identity', result: { conversationId: 'late', text: 'Late answer', receiptIds: [] } }); await rejected;
  assert.ok(client.snapshot().requests.every(state => state.status === 'unknown'));
  assert.deepEqual(f.calls.filter(call => call.method === 'request.status').map(call => call.input), [{ requestId: 'first_identity' }]);
});
