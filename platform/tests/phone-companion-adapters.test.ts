import test from 'node:test';
import assert from 'node:assert/strict';
import { PhoneError } from '../runtime/phone/contracts.ts';
import type { PhoneMethods, SessionAuthority, SessionGrant } from '../runtime/phone/contracts.ts';
import type { PhoneHostMethods } from '../runtime/phone/host-contracts.ts';
import { createHttpPhoneTransport, createLiveCompanionController } from '../../app/companion/shared/adapters.ts';
import type { DeviceRequestProof, DeviceRequestSigner, LiveCompanionAdapters } from '../../app/companion/shared/adapters.ts';

const origin = 'https://relay.chausar.test';
const credential = 'synthetic-credential-for-local-fixtures-only';
const sensitive = 'synthetic-sensitive-token-do-not-expose';
const code = (expected: string) => (error: unknown) => error instanceof PhoneError && error.code === expected;
const sanitised = (error: unknown) => error instanceof PhoneError && error.message === error.code && !String(error).includes(sensitive);
const proof = (): DeviceRequestProof => ({ deviceId: 'phone_1', keyId: 'key_1', timestamp: '2026-10-01T12:00:00.000Z', nonce: 'nonce_12345678901234567890', signature: 's'.repeat(86) });
const signer: DeviceRequestSigner = { sign: async () => proof() };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const signed: Parameters<DeviceRequestSigner['sign']>[0][] = [];
  const fetcher: typeof fetch = async (url, init) => { calls.push({ url: String(url), init }); return json({ result: { nextOffset: 4 } }); };
  const deviceSigner: DeviceRequestSigner = { sign: async input => { signed.push(input); return proof(); } };
  return { calls, signed, fetcher, signer: deviceSigner, transport: createHttpPhoneTransport({ origin, fetcher, signer: deviceSigner }) };
}

test('HTTP adapter accepts only an HTTPS origin without credentials, path, query or fragment', () => {
  const fetcher: typeof fetch = async () => json({ result: [] });
  for (const value of [
    'http://relay.chausar.test', 'file:///tmp/rpc', 'not-a-url',
    'https://user:synthetic-password@relay.chausar.test', 'https://user@relay.chausar.test',
    `${origin}/rpc`, `${origin}/api/`, `${origin}?token=synthetic`, `${origin}#fragment`,
  ]) assert.throws(() => createHttpPhoneTransport({ origin: value, fetcher, signer }), code('INVALID_REQUEST'));
  assert.doesNotThrow(() => createHttpPhoneTransport({ origin, fetcher, signer }));
  assert.doesNotThrow(() => createHttpPhoneTransport({ origin: `${origin}:443/`, fetcher, signer }));
});

test('HTTP factory requires explicit callable fetch and device signer adapters', () => {
  const valid = { origin, fetcher: (async () => json({ result: [] })) as typeof fetch, signer };
  for (const change of [
    { fetcher: undefined }, { fetcher: {} }, { signer: undefined }, { signer: {} }, { signer: { sign: 'not-a-function' } },
  ]) assert.throws(() => createHttpPhoneTransport({ ...valid, ...change } as unknown as Parameters<typeof createHttpPhoneTransport>[0]), code('INVALID_REQUEST'));
});

test('HTTP requests sign the exact POST body and keep credentials and proof out of the URL', async () => {
  const f = fixture(); const controller = new AbortController();
  const question = 'Which row contains "quoted text"?\nCafé ₹';
  const result = await f.transport.request('chat.start', { requestId: 'request_1', question }, { credential, signal: controller.signal });
  assert.deepEqual(result, { nextOffset: 4 });
  assert.equal(f.calls.length, 1); assert.equal(f.signed.length, 1);
  const call = f.calls[0]; const signed = f.signed[0];
  assert.equal(call.url, `${origin}/api/companion/rpc`);
  assert.equal(new URL(call.url).search, ''); assert.equal(new URL(call.url).hash, '');
  assert.equal(call.url.includes(credential), false); assert.equal(call.url.includes(proof().signature), false);
  assert.equal(call.init?.method, 'POST'); assert.equal(call.init?.body, signed.body);
  assert.equal(signed.method, 'chat.start'); assert.equal(signed.path, '/api/companion/rpc');
  assert.equal(signed.credential, credential);
  assert.equal(signed.signal, controller.signal); assert.equal(call.init?.signal, controller.signal);
  assert.deepEqual(JSON.parse(signed.body), { protocolVersion: 1, method: 'chat.start', payload: { requestId: 'request_1', question } });
  assert.equal(signed.body.includes(credential), false);
  assert.equal(call.init?.credentials, 'omit'); assert.equal(call.init?.cache, 'no-store'); assert.equal(call.init?.redirect, 'error');
  const headers = new Headers(call.init?.headers);
  assert.equal(headers.get('content-type'), 'application/json'); assert.equal(headers.get('authorization'), `Bearer ${credential}`);
  for (const [header, value] of Object.entries({ 'x-chausar-device': proof().deviceId, 'x-chausar-key': proof().keyId,
    'x-chausar-time': proof().timestamp, 'x-chausar-nonce': proof().nonce, 'x-chausar-proof': proof().signature })) assert.equal(headers.get(header), value);
});

test('pairing can send a device-signed request without a bearer credential', async () => {
  const f = fixture();
  await f.transport.request('pairing.accept', { inviteCode: 'synthetic-invite', deviceId: 'phone_1', channel: 'ios', devicePublicKey: 'synthetic-public-key', proof: 'synthetic-pairing-proof' }, { signal: new AbortController().signal });
  assert.equal(new Headers(f.calls[0].init?.headers).has('authorization'), false);
  assert.equal(Object.hasOwn(f.signed[0], 'credential'), false);
  assert.equal(f.signed[0].body, f.calls[0].init?.body);
});

test('the bearer header stays bound to the credential supplied for signing', async () => {
  const auth = { credential, signal: new AbortController().signal };
  const calls: RequestInit[] = [];
  const transport = createHttpPhoneTransport({ origin, signer: { sign: async input => {
    assert.equal(input.credential, credential); auth.credential = 'synthetic-replacement-not-signed'; return proof();
  } }, fetcher: async (_url, init) => { calls.push(init!); return json({ result: [] }); } });
  await transport.request('brief.list', {}, auth);
  assert.equal(new Headers(calls[0].headers).get('authorization'), `Bearer ${credential}`);
});

test('invalid bearer values are refused before signing or fetch', async () => {
  for (const invalid of ['', 'credential\r\nInjected: header', 'x'.repeat(4097), 123, null]) {
    const f = fixture();
    await assert.rejects(f.transport.request('brief.list', {}, { credential: invalid as string, signal: new AbortController().signal }), code('INVALID_REQUEST'));
    assert.equal(f.calls.length, 0);
    assert.equal(f.signed.length, 0);
  }
});

test('authenticated host helpers sign only the fixed request list and receipt inputs', async () => {
  const f = fixture(); const signal = new AbortController().signal;
  const authority: SessionAuthority = { binding: { workspaceId: 'workspace_1', memberId: 'owner_1', deviceId: 'phone_1', epoch: 1 }, sessionId: 'session_1', expiresAt: '2026-10-02T12:00:00.000Z', validatedAt: '2026-10-01T12:00:00.000Z', capabilities: ['brief.read', 'chat'] };
  const identities: PhoneHostMethods['request.list']['output'] = [{ requestId: 'request_1', kind: 'chat' }];
  const receipt: PhoneHostMethods['receipt.read']['output'] = { id: 'receipt_1', workspaceId: authority.binding.workspaceId, text: 'Exact host receipt text\nNo additional provenance.' };
  const fetcher: typeof fetch = async (url, init) => { f.calls.push({ url: String(url), init }); return json({ result: JSON.parse(String(init?.body)).method === 'request.list' ? identities : receipt }); };
  const transport = createHttpPhoneTransport({ origin, fetcher, signer: f.signer });
  assert.deepEqual(await transport.list(authority, credential, signal), identities);
  assert.deepEqual(await transport.read(authority, credential, receipt.id, signal), receipt);
  assert.deepEqual(f.signed.map(input => JSON.parse(input.body)), [
    { protocolVersion: 1, method: 'request.list', payload: {} },
    { protocolVersion: 1, method: 'receipt.read', payload: { receiptId: receipt.id } },
  ]);
  for (let index = 0; index < f.calls.length; index++) {
    assert.equal(f.signed[index].credential, credential); assert.equal(f.signed[index].signal, signal);
    assert.equal(f.calls[index].init?.signal, signal); assert.equal(f.calls[index].init?.body, f.signed[index].body);
    assert.equal(f.calls[index].url, `${origin}/api/companion/rpc`);
    assert.equal(new Headers(f.calls[index].init?.headers).get('authorization'), `Bearer ${credential}`);
    assert.equal(f.signed[index].body.includes(credential), false); assert.equal(f.signed[index].body.includes(authority.sessionId), false);
  }
});

test('host helper denials keep fixed codes and cancellation reaches the original signal', async () => {
  const authority = liveFixture().grant.authority;
  for (const method of ['request.list', 'receipt.read'] as const) {
    for (const remoteCode of ['ACCESS_REVOKED', 'SESSION_EXPIRED', 'OPEN_DESKTOP'] as const) {
      const transport = createHttpPhoneTransport({ origin, signer, fetcher: async () => json({ error: { code: remoteCode, message: sensitive } }, 403) });
      const call = method === 'request.list' ? transport.list(authority, credential, new AbortController().signal) : transport.read(authority, credential, 'receipt_1', new AbortController().signal);
      await assert.rejects(call, (error: unknown) => sanitised(error) && code(remoteCode)(error));
    }
    const entered = deferred<void>(); const controller = new AbortController();
    const transport = createHttpPhoneTransport({ origin, signer, fetcher: async (_url, init) => {
      assert.equal(init?.signal, controller.signal); entered.resolve();
      return new Promise<Response>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error(sensitive)), { once: true }));
    } });
    const call = method === 'request.list' ? transport.list(authority, credential, controller.signal) : transport.read(authority, credential, 'receipt_1', controller.signal);
    await entered.promise; controller.abort(); await assert.rejects(call, (error: unknown) => sanitised(error) && code('VALIDATION_REQUIRED')(error));
  }
});

test('upload chunks use numeric JSON byte arrays and the signature covers that encoding', async () => {
  const f = fixture(); const bytes = Uint8Array.from([0, 1, 128, 255]);
  const result = await f.transport.request('upload.chunk', { uploadId: 'upload_1', offset: 0, bytes }, { credential, signal: new AbortController().signal });
  assert.deepEqual(result, { nextOffset: 4 });
  assert.deepEqual(JSON.parse(f.signed[0].body), { protocolVersion: 1, method: 'upload.chunk', payload: { uploadId: 'upload_1', offset: 0, bytes: [0, 1, 128, 255] } });
  assert.equal(f.signed[0].body, f.calls[0].init?.body);
  assert.deepEqual([...bytes], [0, 1, 128, 255]);
});

test('missing or malformed required device proof fields stop the request before fetch', async () => {
  const malformed: unknown[] = [{}, undefined, null];
  for (const key of ['deviceId', 'keyId', 'timestamp', 'nonce', 'signature'] as const) {
    const omitted: Partial<DeviceRequestProof> = proof(); delete omitted[key]; malformed.push(omitted);
    for (const value of ['', undefined, 123, 'x'.repeat(4097), 'value\r\nInjected: header']) malformed.push({ ...proof(), [key]: value });
  }
  for (const invalid of malformed) {
    let fetches = 0;
    const fetcher: typeof fetch = async () => { fetches++; return json({ result: [] }); };
    const transport = createHttpPhoneTransport({ origin, fetcher, signer: { sign: async () => invalid as DeviceRequestProof } });
    await assert.rejects(transport.request('brief.list', {}, { credential, signal: new AbortController().signal }), code('INVALID_RESPONSE'));
    assert.equal(fetches, 0);
  }
});

test('unknown methods and already-aborted requests never call signer or fetch', async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(f.transport.request('brief.list', {}, { credential, signal: controller.signal }), code('INVALID_REQUEST'));
  await assert.rejects(f.transport.request('action.execute' as keyof PhoneMethods, {}, { credential, signal: new AbortController().signal }), code('INVALID_REQUEST'));
  assert.equal(f.signed.length, 0); assert.equal(f.calls.length, 0);
});

test('aborting while the exact body is being signed prevents a later fetch', async () => {
  const signed = deferred<DeviceRequestProof>(); let fetches = 0;
  const fetcher: typeof fetch = async () => { fetches++; return json({ result: [] }); };
  const controller = new AbortController();
  const transport = createHttpPhoneTransport({ origin, fetcher, signer: { sign: async input => { assert.equal(input.signal, controller.signal); return signed.promise; } } });
  const pending = transport.request('brief.list', {}, { credential, signal: controller.signal });
  controller.abort(); signed.resolve(proof());
  await assert.rejects(pending, (error: unknown) => sanitised(error) && ['INVALID_REQUEST', 'VALIDATION_REQUIRED', 'TRANSPORT_UNKNOWN'].includes((error as PhoneError).code));
  assert.equal(fetches, 0);
});

test('fetch receives the original abort signal and dependency failures expose only fixed error codes', async () => {
  for (const failure of ['signer', 'fetcher', 'body-reader'] as const) {
    const deviceSigner: DeviceRequestSigner = { sign: async () => { if (failure === 'signer') throw new Error(sensitive); return proof(); } };
    const fetcher: typeof fetch = async () => {
      if (failure === 'fetcher') throw new Error(sensitive);
      const response = json({ result: [] }); response.text = async () => { throw new Error(sensitive); }; return response;
    };
    const transport = createHttpPhoneTransport({ origin, fetcher, signer: deviceSigner });
    await assert.rejects(transport.request('brief.list', {}, { credential, signal: new AbortController().signal }), sanitised);
  }
  const entered = deferred<void>(); const controller = new AbortController();
  const fetcher: typeof fetch = async (_url, init) => {
    assert.equal(init?.signal, controller.signal); entered.resolve();
    return new Promise<Response>((_resolve, reject) => { controller.signal.addEventListener('abort', () => reject(new Error(sensitive)), { once: true }); });
  };
  const transport = createHttpPhoneTransport({ origin, fetcher, signer });
  const pending = transport.request('brief.list', {}, { credential, signal: controller.signal });
  await entered.promise; controller.abort(); await assert.rejects(pending, sanitised);
});

test('abort during response reading cannot return a late result or reveal a reader error', async () => {
  for (const rejectReader of [false, true]) {
    const entered = deferred<void>(); let release!: () => void;
    const controller = new AbortController();
    const response = json({ result: ['synthetic-late-result'] });
    response.text = async () => {
      const waiting = new Promise<string>((resolve, reject) => {
        release = () => rejectReader ? reject(new Error(sensitive)) : resolve(JSON.stringify({ result: ['synthetic-late-result'] }));
      });
      entered.resolve(); return waiting;
    };
    const transport = createHttpPhoneTransport({ origin, fetcher: async () => response, signer });
    const pending = transport.request('brief.list', {}, { credential, signal: controller.signal });
    await entered.promise; controller.abort(); release();
    await assert.rejects(pending, (error: unknown) => sanitised(error) && code('VALIDATION_REQUIRED')(error));
  }
});

test('remote errors preserve known codes and never expose provider messages or arbitrary codes', async () => {
  for (const [status, remoteCode, expected] of [
    [403, 'SESSION_EXPIRED', 'SESSION_EXPIRED'], [200, 'PREVIEW_CHANGED', 'PREVIEW_CHANGED'],
    [401, sensitive, 'ACCESS_REVOKED'], [403, undefined, 'ACCESS_REVOKED'],
    [500, sensitive, 'TRANSPORT_UNKNOWN'], [200, sensitive, 'TRANSPORT_UNKNOWN'],
  ] as const) {
    const fetcher: typeof fetch = async () => json({ error: { code: remoteCode, message: sensitive, token: sensitive } }, status);
    const transport = createHttpPhoneTransport({ origin, fetcher, signer });
    await assert.rejects(transport.request('brief.list', {}, { credential, signal: new AbortController().signal }), (error: unknown) => sanitised(error) && code(expected)(error));
  }
});

test('non-JSON, malformed, oversized and result-less responses fail with a fixed code', async () => {
  const responses = [
    () => new Response(sensitive, { headers: { 'Content-Type': 'text/plain' } }),
    () => new Response(`{${sensitive}`, { headers: { 'Content-Type': 'application/json' } }),
    () => new Response(' '.repeat(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }),
    () => json({ message: sensitive }), () => json(null),
  ];
  for (const response of responses) {
    const transport = createHttpPhoneTransport({ origin, fetcher: async () => response(), signer });
    await assert.rejects(transport.request('brief.list', {}, { credential, signal: new AbortController().signal }), code('INVALID_RESPONSE'));
  }
});

function liveFixture() {
  const now = Date.now();
  const grant: SessionGrant = { authority: { binding: { workspaceId: 'live_workspace', memberId: 'live_owner', deviceId: 'live_phone', epoch: 1 },
    sessionId: 'live_session', expiresAt: new Date(now + 3_600_000).toISOString(), validatedAt: new Date(now).toISOString(), capabilities: ['brief.read', 'chat', 'upload', 'approval.simple'] }, credential };
  const calls: (keyof PhoneMethods)[] = [];
  let errorOnLoad = false;
  const adapters: LiveCompanionAdapters = { channel: 'ios',
    transport: { async request<M extends keyof PhoneMethods>(method: M): Promise<PhoneMethods[M]['output']> { calls.push(method); throw new Error(sensitive); } },
    credentials: { load: async () => { if (errorOnLoad) throw new Error(sensitive); return structuredClone(grant); }, save: async () => {}, clear: async () => {} },
    cache: { put: async () => {}, read: async () => undefined, list: async () => [], clear: async () => {} },
    identity: { preparePairing: async () => ({ deviceId: 'live_phone', devicePublicKey: 'synthetic-public-key', proof: 'synthetic-identity-proof' }) },
    picker: { pick: async () => undefined },
    requestRestoration: { list: async () => [] },
    receipts: { read: async () => { throw new Error(sensitive); } },
    crypto: globalThis.crypto, requestId: () => 'live_request',
  };
  return { adapters, calls, grant, failLoad: () => { errorOnLoad = true; } };
}

test('live factory rejects missing host adapters instead of filling them with previews', () => {
  const { adapters } = liveFixture();
  assert.throws(() => createLiveCompanionController(undefined as unknown as LiveCompanionAdapters), code('INVALID_REQUEST'));
  for (const key of ['transport', 'credentials', 'cache', 'identity', 'picker', 'requestRestoration', 'receipts', 'crypto', 'requestId'] as const) {
    assert.throws(() => createLiveCompanionController({ ...adapters, [key]: undefined } as unknown as LiveCompanionAdapters), code('INVALID_REQUEST'));
  }
  for (const change of [
    { channel: 'whatsapp' }, { transport: {} }, { credentials: { load: async () => undefined } },
    { cache: {} }, { identity: {} }, { picker: {} }, { requestRestoration: {} }, { requestRestoration: { list: 'not-callable' } }, { receipts: {} }, { crypto: { subtle: {} } }, { requestId: 'demo_request' },
  ]) assert.throws(() => createLiveCompanionController({ ...adapters, ...change } as unknown as LiveCompanionAdapters), code('INVALID_REQUEST'));
});

test('live factory ignores unexpected client or mode fields and uses the declared adapters', async () => {
  const f = liveFixture();
  const extra = { ...f.adapters, mode: 'demo', client: { snapshot: () => { throw new Error('Unexpected client override'); } } };
  const controller = createLiveCompanionController(extra as LiveCompanionAdapters);
  assert.equal(controller.getState().mode, 'live');
  await controller.start();
  assert.deepEqual(f.calls, ['session.validate']);
  assert.equal(controller.getState().mode, 'live');
});

test('live connection and protected-storage failures keep empty live state with sanitised notices', async () => {
  for (const failStorage of [false, true]) {
    const f = liveFixture(); if (failStorage) f.failLoad();
    const controller = createLiveCompanionController(f.adapters); await controller.start();
    const state = controller.getState();
    assert.equal(state.mode, 'live'); assert.equal(state.notice?.tone, 'error');
    assert.deepEqual(state.briefs, []); assert.deepEqual(state.messages, []); assert.deepEqual(state.approvalInbox, []); assert.deepEqual(state.uploads, []);
    assert.equal(state.client.pairing.status, failStorage ? 'unpaired' : 'validation-required');
    assert.equal(JSON.stringify(state).includes(sensitive), false); assert.equal(JSON.stringify(state).includes(credential), false);
    assert.equal(JSON.stringify(state).includes('Preview workspace'), false);
    assert.deepEqual(f.calls, failStorage ? [] : ['session.validate']);
  }
});
