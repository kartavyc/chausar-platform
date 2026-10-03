import test from 'node:test';
import assert from 'node:assert/strict';
import { PhoneClient } from '../runtime/phone/client.ts';
import type { PhoneReceiptReader } from '../runtime/phone/client.ts';
import { PhoneError } from '../runtime/phone/contracts.ts';
import type { PhoneReceipt } from '../runtime/phone/host-contracts.ts';
import type { PhoneMethods, SessionGrant } from '../runtime/phone/contracts.ts';

function fixture() {
  let time = Date.parse('2026-10-03T00:00:00Z');
  const authority = () => ({ binding: { workspaceId: 'shop', memberId: 'owner', deviceId: 'phone', epoch: 1 }, sessionId: 'session', expiresAt: new Date(time + 60000).toISOString(), validatedAt: new Date(time).toISOString(), capabilities: ['brief.read'] as const });
  const grant = (): SessionGrant => ({ credential: 'synthetic-receipt-credential-never-print', authority: { ...authority(), capabilities: [...authority().capabilities] } });
  const calls: string[] = [];
  const receiptCalls: Parameters<PhoneReceiptReader['read']>[] = [];
  const receipt = { id: 'receipt', workspaceId: 'shop', text: 'Source observations and qualification as supplied by the host.\n₹ 10' };
  let clearedCredentials = 0; let clearedCache = 0;
  let read: PhoneReceiptReader['read'] = async (...input) => { receiptCalls.push(input); return { ...receipt, token: 'discard-extra-fields' }; };
  const client = new PhoneClient({ channel: 'ios', clock: () => time,
    transport: { async request<M extends keyof PhoneMethods>(method: M): Promise<PhoneMethods[M]['output']> { calls.push(method); assert.equal(method, 'session.validate'); return { status: 'current', authority: authority() } as PhoneMethods[M]['output']; } },
    credentials: { load: async () => grant(), save: async () => {}, clear: async () => { clearedCredentials += 1; } },
    cache: { read: async () => undefined, put: async () => {}, clear: async () => { clearedCache += 1; } },
    receiptReader: { read: (...input) => read(...input) },
  });
  return { client, grant, calls, receiptCalls, receipt, cleared: () => ({ credentials: clearedCredentials, cache: clearedCache }), setRead: (handler: PhoneReceiptReader['read']) => { read = handler; }, advance: (ms: number) => { time += ms; } };
}

test('receipt reads freshly validate and return only scoped host text without fabricated metadata', async () => {
  const f = fixture(); await f.client.restore();
  await assert.rejects(f.client.readReceipt('receipt'), { code: 'OFFLINE' }); assert.equal(f.receiptCalls.length, 0);
  await f.client.reconnect();
  const result = await f.client.readReceipt('receipt');
  assert.deepEqual(result, f.receipt); assert.deepEqual(f.calls, ['session.validate', 'session.validate']);
  assert.equal(f.receiptCalls.length, 1);
  assert.deepEqual(f.receiptCalls[0].slice(0, 3), [f.grant().authority, f.grant().credential, 'receipt']);
  assert.equal(f.receiptCalls[0][3].aborted, false);
  assert.equal(JSON.stringify(f.client.snapshot()).includes(f.grant().credential), false);
  assert.equal(JSON.stringify(f.client.snapshot()).includes(f.receipt.text), false);
});

test('receipt read refuses other IDs/workspaces, non-text and oversized host output', async () => {
  const f = fixture(); await f.client.restore(); await f.client.reconnect();
  for (const invalid of [null, { ...f.receipt, id: 'other' }, { ...f.receipt, workspaceId: 'other' }, { ...f.receipt, text: 7 }, { ...f.receipt, text: 'x'.repeat(64001) }]) {
    f.setRead(async () => invalid as PhoneReceipt);
    await assert.rejects(f.client.readReceipt('receipt'), { code: 'INVALID_RESPONSE' });
  }
  f.setRead(async () => ({ ...f.receipt, text: 'x'.repeat(64000) }));
  assert.equal((await f.client.readReceipt('receipt')).text.length, 64000);
  const count = f.calls.length;
  await assert.rejects(f.client.readReceipt('../other'), { code: 'INVALID_REQUEST' });
  assert.equal(f.calls.length, count);
});

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test('disconnect, forget and newer reconnect abort receipt reads and reject late protected text', async () => {
  for (const transition of ['disconnect', 'forget', 'reconnect'] as const) {
    const f = fixture(); await f.client.restore(); await f.client.reconnect();
    const entered = deferred<AbortSignal>(); const released = deferred<PhoneReceipt>();
    f.setRead(async (_authority, _credential, _id, signal) => { entered.resolve(signal); return released.promise; });
    const reading = f.client.readReceipt('receipt'); const rejected = assert.rejects(reading, { code: 'VALIDATION_REQUIRED' });
    const signal = await entered.promise;
    if (transition === 'disconnect') f.client.disconnect();
    else if (transition === 'forget') await f.client.forgetDevice();
    else await f.client.reconnect();
    assert.equal(signal.aborted, true); released.resolve(f.receipt); await rejected;
    assert.equal(JSON.stringify(f.client.snapshot()).includes(f.receipt.text), false);
    assert.deepEqual(f.cleared(), transition === 'forget' ? { credentials: 1, cache: 1 } : { credentials: 0, cache: 0 });
  }
});

test('revoked or expired receipt release clears protected local state with fixed public errors', async () => {
  for (const [code, status] of [['ACCESS_REVOKED', 'revoked'], ['SESSION_EXPIRED', 'expired']] as const) {
    const f = fixture(); await f.client.restore(); await f.client.reconnect();
    f.setRead(async () => { throw { code, message: 'raw-sensitive-host-error' }; });
    await assert.rejects(f.client.readReceipt('receipt'), error => error instanceof PhoneError && error.code === code && error.message === code);
    assert.equal(f.client.snapshot().pairing.status, status); assert.deepEqual(f.cleared(), { credentials: 1, cache: 1 });
  }
});

test('expiry during a paused receipt read erases credentials and refuses the late text', async () => {
  const f = fixture(); await f.client.restore(); await f.client.reconnect();
  const entered = deferred<void>(); const released = deferred<PhoneReceipt>();
  f.setRead(async () => { entered.resolve(); return released.promise; });
  const reading = f.client.readReceipt('receipt'); const rejected = assert.rejects(reading, { code: 'SESSION_EXPIRED' });
  await entered.promise; f.advance(60001); released.resolve(f.receipt); await rejected;
  assert.equal(f.client.snapshot().pairing.status, 'expired'); assert.deepEqual(f.cleared(), { credentials: 1, cache: 1 });
});

test('unknown receipt adapter errors disconnect and never expose raw adapter text', async () => {
  for (const error of [new Error('raw-sensitive-receipt-text'), new PhoneError('TRANSPORT_UNKNOWN')]) {
    const f = fixture(); await f.client.restore(); await f.client.reconnect();
    f.setRead(async () => { throw error; });
    await assert.rejects(f.client.readReceipt('receipt'), { code: 'TRANSPORT_UNKNOWN', message: 'TRANSPORT_UNKNOWN' });
    assert.equal(f.client.snapshot().connection, 'offline');
  }
});
