import assert from 'node:assert/strict';
import test from 'node:test';
import { preloadBridge } from './fixtures/preload-bridge.ts';

// The desktop preload and strict IPC with authored temporary replies; no provider, worker or user vault. What a window
// does with a refused historical read (cancel the fresh question, drop saved bodies) is the window's own logic. This
// keeps the preload facts that logic relies on: a fresh exact preview is admitted unchanged after a missing receipt,
// and every historical read refusal reaches the window with its code and words intact.
const question = 'An independently new synthetic business question';
const fresh = { question, routeId: 'synthetic-new-route', purpose: 'conversation', questionDisclosure: 'verbatim' };
async function fixture(readReceipt: () => Promise<unknown>) {
  return preloadBridge({ dispatch: async (method, payload) => {
    if (method === 'receipts.get') return readReceipt();
    if (method === 'models.preview') return { id: 'synthetic-fresh-preview', routeId: 'synthetic-new-route',
      purpose: 'conversation', naturalQuestion: payload.question, approvalRequired: true, digest: 'a'.repeat(64),
      endpoint: 'http://127.0.0.1:11434/api/chat', payload: JSON.stringify({ question: payload.question }), send: 'shape' };
    assert.fail(`Unexpected historical refresh fixture request: ${method}`);
  } });
}
function refusal(code: string) { return Object.assign(new Error('Synthetic historical read refusal.'), { code }); }

test('missing old receipt still lets the strict contract admit a fresh exact preview unchanged, with no provider dispatch', async () => {
  const h = await fixture(async () => { throw refusal('RECEIPT_NOT_FOUND'); });
  await assert.rejects(h.request('receipts.get', { id: 'synthetic-old-receipt' }), { code: 'RECEIPT_NOT_FOUND' });
  const preview = await h.request('models.preview', fresh);
  assert.deepEqual(h.calls.filter(call => call.method === 'models.preview').map(call => call.payload), [fresh]);
  assert.equal(preview.id, 'synthetic-fresh-preview'); assert.equal(preview.naturalQuestion, question);
  assert.equal(h.calls.some(call => ['models.approve', 'conversation.ask'].includes(call.method)), false);
});

for (const code of ['ACCESS_REVOKED', 'VAULT_LOCKED', 'UNAUTHENTICATED', 'SOURCE_REVOKED', 'EVIDENCE_CHANGED']) {
  test(`historical read ${code} reaches the window through the preload with its code unchanged`, async () => {
    const h = await fixture(async () => { throw refusal(code); });
    await assert.rejects(h.request('receipts.get', { id: 'synthetic-old-receipt' }), { code, message: 'Synthetic historical read refusal.' });
    assert.deepEqual(h.rejected.map(item => item.error), [{ code, message: 'Synthetic historical read refusal.' }]);
  });
}
