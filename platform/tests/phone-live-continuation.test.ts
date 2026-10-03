import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpPhoneTransport, createLiveCompanionController } from '../../app/companion/shared/adapters.ts';
import type { DeviceRequestSigner, LiveCompanionAdapters } from '../../app/companion/shared/adapters.ts';
import type { Brief, BriefCache, CachedBrief, PhoneCredentialStore, RemoteRequest, RequestResult, SessionAuthority, SessionGrant } from '../runtime/phone/contracts.ts';
import type { PhoneHostMethod, PhoneRequestIdentity } from '../runtime/phone/host-contracts.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const refused = (code: string) => json({ error: { code, message: 'Raw synthetic host message must remain private.' } }, 403);
type Retained = { identity: PhoneRequestIdentity; state: RemoteRequest<RequestResult> };
type Call = { method: PhoneHostMethod; payload: any; signal: AbortSignal };
type Handler = (call: Call, original: () => unknown) => unknown | Promise<unknown>;

/** Only synthetic RPC fetch/proof and retained public results; no listener or live host. */
function fixture(options: { simpleApproval?: boolean } = {}) {
  const time = Date.now();
  const authority: SessionAuthority = {
    binding: { workspaceId: 'synthetic_workspace', memberId: 'synthetic_owner', deviceId: 'synthetic_phone', epoch: 1 },
    sessionId: 'synthetic_session', validatedAt: new Date(time).toISOString(), expiresAt: new Date(time + 86400000).toISOString(),
    capabilities: ['brief.read', 'chat', 'upload', 'approval.simple'],
  };
  const credential = 'synthetic-phone-credential-000000000000';
  let saved: SessionGrant | undefined = { authority: structuredClone(authority), credential };
  let credentialClears = 0; let cacheClears = 0; let starts = 0; let sequence = 0; let proofSequence = 0;
  const credentials: PhoneCredentialStore = {
    load: async () => structuredClone(saved), save: async grant => { saved = structuredClone(grant); },
    clear: async () => { saved = undefined; credentialClears += 1; },
  };
  const brief: Brief = {
    id: 'synthetic_brief', workspaceId: authority.binding.workspaceId, version: 'revision_1', generatedAt: new Date(time).toISOString(),
    title: 'Synthetic saved brief', summary: 'Receipt-backed synthetic summary.', receiptIds: ['synthetic_receipt'],
  };
  const cached = new Map<string, CachedBrief>();
  const cache: BriefCache = {
    put: async (binding, value) => {
      assert.deepEqual(binding, authority.binding);
      cached.set(value.id, { ...structuredClone(value), cachedAt: new Date(time).toISOString(), expiresAt: new Date(time + 86400000).toISOString() });
    },
    read: async (binding, id) => { assert.deepEqual(binding, authority.binding); return structuredClone(cached.get(id)); },
    list: async binding => { assert.deepEqual(binding, authority.binding); return structuredClone([...cached.values()]); },
    clear: async () => { cached.clear(); cacheClears += 1; },
  };
  const custody = new Map<string, Retained>();
  const calls: Call[] = [];
  const signed: Parameters<DeviceRequestSigner['sign']>[0][] = [];
  const proofs = new Map<string, Parameters<DeviceRequestSigner['sign']>[0]>();
  const signer: DeviceRequestSigner = {
    sign: async input => {
      signed.push(input);
      const nonce = `synthetic_nonce_${++proofSequence}`;
      proofs.set(nonce, input);
      return { deviceId: authority.binding.deviceId, keyId: 'synthetic_key', timestamp: new Date(time).toISOString(), nonce, signature: `synthetic_signature_${proofSequence}` };
    },
  };
  const answer = (requestId: string): RemoteRequest<RequestResult> => ({
    status: 'succeeded', requestId,
    result: { conversationId: 'synthetic_retained_conversation', text: 'Synthetic retained answer.', receiptIds: ['synthetic_receipt'] },
  });
  const defaultResult = (call: Call): unknown => {
    const { method, payload } = call;
    if (method === 'session.validate') return { status: 'current', authority: { ...structuredClone(authority), validatedAt: new Date(Date.now()).toISOString() } };
    if (method === 'request.list') return [...custody.values()].map(record => structuredClone(record.identity));
    if (method === 'request.status') return structuredClone(custody.get(payload.requestId)?.state ?? { status: 'unknown', requestId: payload.requestId });
    if (method === 'chat.start') {
      assert.equal(custody.has(payload.requestId), false, 'a business start must be admitted once');
      starts += 1;
      const state = answer(payload.requestId);
      custody.set(payload.requestId, { identity: { requestId: payload.requestId, kind: 'chat' }, state });
      return structuredClone(state);
    }
    if (method === 'request.cancel') {
      const record = custody.get(payload.requestId);
      assert.ok(record, 'remote cancellation must address retained custody');
      if (record.state.status !== 'succeeded') record.state = { status: 'cancelled', requestId: payload.requestId };
      return structuredClone(record.state);
    }
    if (method === 'brief.list') return [structuredClone(brief)];
    if (method === 'brief.read') { assert.equal(payload.briefId, brief.id); return structuredClone(brief); }
    if (method === 'receipt.read') {
      assert.equal(payload.receiptId, 'synthetic_receipt');
      return { id: 'synthetic_receipt', workspaceId: authority.binding.workspaceId, text: 'Authoritative synthetic receipt text.\nNo extra provenance was projected.' };
    }
    if (method === 'approval.list') return [{ approvalId: 'synthetic_action', title: 'Synthetic internal change' }];
    if (method === 'approval.inspect' && options.simpleApproval) return {
      preview: {
        approvalId: 'synthetic_action', actionId: 'synthetic_action_id', binding: structuredClone(authority.binding), actionRevision: 1,
        operationVersion: 'synthetic:1', digest: 'd'.repeat(64), expiresAt: new Date(Date.now() + 240000).toISOString(),
        title: 'Synthetic protocol offer', summary: 'Only exercises offline tap behavior.', eligibility: 'simple-reversible',
      }, token: 'a'.repeat(64),
    };
    if (method.startsWith('approval.') || method.startsWith('upload.')) return refused('OPEN_DESKTOP');
    throw new Error(`Unexpected synthetic method ${method}`);
  };
  let handler: Handler = (_call, original) => original();
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(String(url), 'https://synthetic-phone.invalid/api/companion/rpc');
    assert.equal(init?.method, 'POST'); assert.equal(init?.credentials, 'omit'); assert.equal(init?.cache, 'no-store'); assert.equal(init?.redirect, 'error');
    const headers = new Headers(init?.headers);
    const proof = proofs.get(headers.get('x-chausar-nonce')!); assert.ok(proof);
    assert.equal(init?.body, proof.body); assert.equal(init?.signal, proof.signal);
    assert.equal(proof.path, '/api/companion/rpc'); assert.equal(proof.credential, credential);
    assert.equal(headers.get('authorization'), `Bearer ${proof.credential}`);
    assert.equal(String(url).includes(credential), false); assert.equal(proof.body.includes(credential), false);
    const envelope = JSON.parse(String(init?.body));
    assert.equal(envelope.protocolVersion, 1); assert.equal(envelope.method, proof.method);
    assert.deepEqual(Object.keys(envelope).sort(), ['method', 'payload', 'protocolVersion']);
    const call: Call = { method: envelope.method, payload: envelope.payload, signal: init!.signal as AbortSignal };
    calls.push(call);
    const result = await handler(call, () => defaultResult(call));
    return result instanceof Response ? result : json({ result });
  };
  const transport = createHttpPhoneTransport({ origin: 'https://synthetic-phone.invalid', fetcher, signer });
  const adapters: LiveCompanionAdapters = {
    channel: 'web', transport, credentials, cache, requestRestoration: transport, receipts: transport,
    identity: { preparePairing: async () => { throw new Error('Synthetic restored grant requires no pairing.'); } },
    picker: { pick: async () => undefined }, crypto: globalThis.crypto, requestId: () => `synthetic_request_${++sequence}`,
  };
  return {
    controller: () => createLiveCompanionController(adapters), transport, calls, signed, custody, answer, brief, cached, credential,
    seedBrief: async () => cache.put(authority.binding, brief),
    seed: (requestId: string, state = answer(requestId)) => custody.set(requestId, { identity: { requestId, kind: 'chat' }, state }),
    handle: (next: Handler) => { handler = next; },
    counts: () => ({ starts, credentialClears, cacheClears }),
  };
}

test('live restored grant shows cached briefs before validation, then discovers retained results through signed read-only RPCs', async () => {
  const f = fixture(); await f.seedBrief(); f.seed('synthetic_recovered');
  const entered = deferred<void>(); const validation = deferred<void>();
  f.handle(async (call, original) => { if (call.method === 'session.validate') { entered.resolve(); await validation.promise; } return original(); });
  const controller = f.controller(); const starting = controller.start(); await entered.promise;
  assert.equal(controller.getState().mode, 'live'); assert.equal(controller.getState().client.pairing.status, 'validation-required');
  assert.equal(controller.getState().briefs[0].freshness, 'cached'); assert.deepEqual(controller.getState().client.requests, []);
  assert.deepEqual(f.calls.map(call => call.method), ['session.validate']);
  validation.resolve(); await starting;
  assert.equal(controller.getState().client.pairing.status, 'paired');
  assert.deepEqual(f.calls.map(call => call.method), ['session.validate', 'request.list', 'session.validate', 'request.status']);
  assert.deepEqual(f.calls.filter(call => call.method === 'request.list').map(call => call.payload), [{}]);
  assert.deepEqual(f.calls.filter(call => call.method === 'request.status').map(call => call.payload), [{ requestId: 'synthetic_recovered' }]);
  assert.equal(controller.getState().messages[0].conversationId, 'synthetic_retained_conversation');
  assert.deepEqual(controller.getState().messages[0].receiptIds, ['synthetic_receipt']);
  assert.equal(JSON.stringify(controller.getState()).includes(f.credential), false);
});

test('live brief cache remains read-only offline and reconnect obtains fresh authority without replay', async () => {
  const f = fixture(); const controller = f.controller(); await controller.start(); await controller.openBrief(f.brief.id);
  controller.disconnect(); const before = f.calls.length;
  await controller.loadBriefs(); await controller.openBrief(f.brief.id);
  assert.equal(controller.getState().brief?.freshness, 'cached');
  assert.equal(controller.getState().brief && 'readOnly' in controller.getState().brief!, true);
  assert.equal(f.calls.length, before);
  await controller.sendChat('Synthetic offline question'); await controller.reconnect();
  assert.equal(f.calls.some(call => call.method === 'chat.start'), false);
  assert.deepEqual(f.calls.slice(before).map(call => call.method), ['session.validate', 'request.list']);
  await controller.loadBriefs(); assert.equal(controller.getState().briefs[0].freshness, 'current');
});

test('lost chat response and reopened live controller recover answer, conversation reference and exact host receipt text without replay', async () => {
  const f = fixture(); const first = f.controller(); await first.start();
  f.handle((call, original) => { const result = original(); if (call.method === 'chat.start') throw new Error('Synthetic acknowledgment lost after commit.'); return result; });
  await first.sendChat('Synthetic question sent exactly once');
  assert.equal(first.getState().client.requests[0].status, 'unknown'); assert.equal(first.getState().client.connection, 'offline');
  const beforeReopen = f.calls.length; f.handle((_call, original) => original());
  const reopened = f.controller(); await reopened.start();
  const message = reopened.getState().messages[0];
  assert.equal(message.text, 'Synthetic retained answer.'); assert.equal(message.conversationId, 'synthetic_retained_conversation');
  assert.equal(message.requestId, first.getState().client.requests[0].requestId); assert.deepEqual(message.receiptIds, ['synthetic_receipt']);
  assert.equal(f.calls.slice(beforeReopen).some(call => Object.hasOwn(call.payload, 'question')), false);
  assert.equal(f.counts().starts, 1);
  await reopened.openReceipt(message.receiptIds[0]);
  assert.equal(reopened.getState().screen, 'receipt');
  assert.deepEqual(reopened.getState().receipt, { id: 'synthetic_receipt', workspaceId: f.brief.workspaceId, text: 'Authoritative synthetic receipt text.\nNo extra provenance was projected.' });
  assert.deepEqual(f.calls.slice(-2).map(call => [call.method, call.payload]), [['session.validate', {}], ['receipt.read', { receiptId: 'synthetic_receipt' }]]);
  const statuses = f.calls.filter(call => call.method === 'request.status').length;
  await reopened.reconnect(); await reopened.reconnect();
  assert.equal(f.calls.filter(call => call.method === 'request.status').length, statuses);
  assert.equal(f.calls.filter(call => call.method === 'chat.start').length, 1); assert.equal(reopened.getState().messages.length, 1);
});

test('simultaneous repeated live chat taps reserve and start one request', async () => {
  const f = fixture(); const controller = f.controller(); await controller.start();
  const entered = deferred<void>(); const reply = deferred<unknown>();
  f.handle(async (call, original) => { if (call.method !== 'chat.start') return original(); original(); entered.resolve(); return reply.promise; });
  const sending = controller.sendChat('First synthetic tap'); await entered.promise;
  await Promise.all([controller.sendChat('Second synthetic tap'), controller.sendChat('Third synthetic tap')]);
  assert.equal(f.counts().starts, 1); assert.equal(controller.getState().client.requests.length, 1); assert.equal(controller.getState().messages.length, 1);
  reply.resolve(f.answer(controller.getState().client.requests[0].requestId)); await sending;
  assert.equal(controller.getState().client.requests[0].status, 'succeeded'); assert.equal(controller.getState().messages.length, 2);
});

test('live cancellation before host completion survives a late response and reopen', async () => {
  const f = fixture(); const controller = f.controller(); await controller.start();
  const entered = deferred<void>(); const reply = deferred<unknown>();
  f.handle(async (call, original) => {
    if (call.method !== 'chat.start') return original();
    original(); const record = f.custody.get(call.payload.requestId)!; record.state = { status: 'pending', requestId: call.payload.requestId };
    entered.resolve(); return reply.promise;
  });
  const sending = controller.sendChat('Synthetic work to cancel'); await entered.promise;
  const id = controller.getState().client.requests[0].requestId;
  await controller.cancelRequest(id); assert.equal(controller.getState().client.requests[0].status, 'cancelled');
  assert.equal(f.calls.find(call => call.method === 'chat.start')?.signal.aborted, true);
  reply.resolve({ status: 'pending', requestId: id }); await sending;
  assert.equal(controller.getState().client.requests[0].status, 'cancelled'); assert.equal(controller.getState().messages.length, 1);
  f.handle((_call, original) => original()); const reopened = f.controller(); await reopened.start();
  assert.deepEqual(reopened.getState().client.requests, [{ status: 'cancelled', requestId: id }]); assert.deepEqual(reopened.getState().messages, []);
  assert.equal(f.calls.filter(call => call.method === 'chat.start').length, 1);
});

test('live cancellation after a lost committed response returns the host outcome and retained continuation reference', async () => {
  const f = fixture(); const controller = f.controller(); await controller.start();
  f.handle((call, original) => { const result = original(); if (call.method === 'chat.start') throw new Error('Synthetic committed response lost.'); return result; });
  await controller.sendChat('Synthetic already committed work'); const id = controller.getState().client.requests[0].requestId;
  const entered = deferred<void>(); const release = deferred<void>();
  f.handle(async (call, original) => { if (call.method === 'request.status') { entered.resolve(); await release.promise; } return original(); });
  const reconnecting = controller.reconnect(); await entered.promise;
  assert.equal(controller.getState().client.requests[0].status, 'unknown');
  await controller.cancelRequest(id);
  assert.equal(controller.getState().client.requests[0].status, 'succeeded');
  assert.equal(controller.getState().messages[1].conversationId, 'synthetic_retained_conversation');
  assert.match(controller.getState().notice!.text, /already completed/);
  release.resolve(); await reconnecting;
  assert.equal(controller.getState().client.requests[0].status, 'succeeded'); assert.equal(f.counts().starts, 1);
});

test('live receipt read respects back navigation and never replaces the later screen', async () => {
  const f = fixture(); const controller = f.controller(); await controller.start();
  const entered = deferred<void>(); const release = deferred<void>();
  f.handle(async (call, original) => { if (call.method === 'receipt.read') { entered.resolve(); await release.promise; } return original(); });
  const reading = controller.openReceipt('synthetic_receipt'); await entered.promise; controller.navigate('activity'); release.resolve(); await reading;
  assert.equal(controller.getState().screen, 'activity'); assert.equal(controller.getState().receipt, undefined);
});

test('revoked or expired live discovery and receipt reads erase protected views and saved grant', async () => {
  for (const method of ['request.list', 'receipt.read'] as const) for (const [code, status] of [['ACCESS_REVOKED', 'revoked'], ['SESSION_EXPIRED', 'expired']] as const) {
    const f = fixture(); await f.seedBrief(); f.seed('synthetic_retained'); const controller = f.controller(); await controller.start();
    f.handle((call, original) => call.method === method ? refused(code) : original());
    if (method === 'request.list') await controller.reconnect(); else await controller.openReceipt('synthetic_receipt');
    const state = controller.getState();
    assert.equal(state.client.pairing.status, status); assert.deepEqual(state.client.requests, []);
    assert.deepEqual([state.briefs, state.messages, state.approvalInbox, state.uploads], [[], [], [], []]); assert.equal(state.receipt, undefined);
    assert.deepEqual(f.counts(), { starts: 0, credentialClears: 1, cacheClears: 1 });
    assert.equal(JSON.stringify(state).includes('Raw synthetic host message'), false);
  }
});

test('stale live discovery and receipt errors cannot revoke a newer reconnect or repopulate protected state', async () => {
  for (const method of ['request.list', 'receipt.read'] as const) {
    const f = fixture(); await f.seedBrief(); f.seed('synthetic_retained'); const controller = f.controller(); await controller.start();
    const entered = deferred<void>(); const reply = deferred<Response>();
    f.handle(async (call, original) => { if (call.method === method) { entered.resolve(); return reply.promise; } return original(); });
    const previous = method === 'request.list' ? controller.reconnect() : controller.openReceipt('synthetic_receipt'); await entered.promise;
    const staleSignal = f.calls.at(-1)!.signal; controller.disconnect(); assert.equal(staleSignal.aborted, true);
    f.handle((_call, original) => original()); await controller.reconnect();
    reply.resolve(refused('ACCESS_REVOKED')); await previous;
    const state = controller.getState();
    assert.equal(state.client.pairing.status, 'paired'); assert.equal(state.client.connection, 'online');
    assert.equal(state.messages[0].conversationId, 'synthetic_retained_conversation'); assert.equal(state.receipt, undefined);
    assert.equal(state.briefs.length, 1); assert.deepEqual(f.counts(), { starts: 0, credentialClears: 0, cacheClears: 0 });
  }
});

test('offline approval taps through the live transport are never queued or replayed on reconnect', async () => {
  // This protocol-only offer exercises the client guard; current Engine action offers still require desktop below.
  const f = fixture({ simpleApproval: true }); const controller = f.controller(); await controller.start(); await controller.inspectApproval('synthetic_action');
  assert.ok(controller.getState().approval); assert.equal(JSON.stringify(controller.getState()).includes('a'.repeat(64)), false);
  controller.disconnect(); const before = f.calls.length;
  await Promise.all([controller.decideApproval('approve'), controller.decideApproval('approve')]);
  assert.equal(f.calls.length, before); await controller.reconnect(); await controller.decideApproval('approve');
  assert.equal(controller.getState().approval, undefined); assert.equal(f.calls.some(call => call.method === 'approval.submit'), false);
  assert.equal(f.calls.some(call => call.method === 'chat.start' || call.method.startsWith('upload.')), false);
});

test('live OPEN_DESKTOP approval and upload refusals remain explicit and never claim execution or staged success', async () => {
  const f = fixture(); const controller = f.controller(); await controller.start();
  await controller.loadApprovals(); await controller.inspectApproval('synthetic_action');
  assert.equal(controller.getState().approval, undefined); assert.match(controller.getState().notice!.text, /desktop/);
  await controller.decideApproval('approve'); assert.equal(f.calls.some(call => call.method === 'approval.submit'), false);
  await controller.uploadDocument({ name: 'synthetic.csv', mediaType: 'text/csv', bytes: new TextEncoder().encode('synthetic,value\nitem,1\n') });
  assert.match(controller.getState().notice!.text, /desktop/);
  assert.equal(controller.getState().client.requests.some(request => request.status === 'succeeded'), false);
  assert.equal(controller.getState().uploads.some(upload => upload.status === 'awaiting-confirmation'), false);
  await controller.reconnect();
  assert.equal(f.calls.filter(call => call.method === 'upload.begin').length, 1);
  assert.equal(f.calls.some(call => call.method === 'upload.chunk' || call.method === 'upload.finish' || call.method === 'approval.submit'), false);
  assert.equal(f.counts().starts, 0);
});
