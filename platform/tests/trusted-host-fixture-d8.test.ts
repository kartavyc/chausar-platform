import test from 'node:test';
import assert from 'node:assert/strict';
import { trustedHostBridge } from './fixtures/trusted-host-bridge.ts';

test('trusted host fixture proves real renderer refusal before recording exactly one validated engine request', async () => {
  const dispatches: unknown[] = [];
  const bridge = await trustedHostBridge({ dispatch: async (method, payload) => { dispatches.push({ method, payload }); return { copied: payload }; } });
  const payload = { id: 'synthetic-receipt' }, result = await bridge.request('receipts.get', payload);
  assert.deepEqual(bridge.calls, [{ method: 'receipts.get', payload }]);
  assert.deepEqual(dispatches, bridge.calls);
  assert.notEqual(result.copied, payload);
  assert.equal(bridge.renderer.rejected.length, 1);
  assert.deepEqual(bridge.renderer.calls, []);
  assert.equal(bridge.rendererDispatches(), 0);
  await assert.rejects(bridge.request('receipts.invented', {}), { code: 'INVALID_REQUEST' });
  assert.equal(dispatches.length, 1);
  assert.equal(bridge.calls.length, 1);
});

test('trusted host fixture preserves exact request fields and bounded public refusal without leaking engine errors', async () => {
  const bridge = await trustedHostBridge({ dispatch: async () => { throw Object.assign(new Error('Synthetic current authority refusal.'), { code: 'ACCESS_REVOKED' }); } });
  const payload = { id: 'synthetic-receipt' };
  await assert.rejects(bridge.request('receipts.get', payload), { code: 'ACCESS_REVOKED', message: 'Synthetic current authority refusal.' });

  assert.deepEqual(bridge.rejected.map(item => item.error), [{ code: 'ACCESS_REVOKED', message: 'Synthetic current authority refusal.' }]);
  await assert.rejects(bridge.request('receipts.get', { ...payload, optional: undefined }), { code: 'INVALID_REQUEST' });
  assert.ok(Object.hasOwn(bridge.wires[1].payload, 'optional'));
  assert.equal(bridge.calls.length, 1, 'Non-JSON fields never reach engine dispatch.');
  assert.equal(bridge.rendererDispatches(), 0);
});
