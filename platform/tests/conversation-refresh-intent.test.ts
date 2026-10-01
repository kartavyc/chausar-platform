import assert from 'node:assert/strict';
import test from 'node:test';
import { find, harness } from './fixtures/conversation-acceptance-renderer.ts';

// Actual renderer/preload/strict IPC with authored temporary replies; no provider or user vault.
const question = 'An independently new synthetic business question';
async function fixture(readReceipt: () => Promise<unknown>, readContinuation?: () => Promise<unknown>) {
  const h = await harness({ mount: true, dispatch: async (method, payload) => {
    if (method === 'dashboard.get') return { factCount: 0, sourceCount: 0, policy: { send: 'shape' } };
    if (method === 'models.list') return [{ id: 'synthetic-new-route', kind: 'ollama', model: 'synthetic-only' }];
    if (method === 'receipts.get') return readReceipt();
    if (method === 'conversation.get' && readContinuation) return { id: payload.id, question: 'Synthetic pending objective',
      at: '2026-10-01T00:00:00.000Z', answer: { clarification: 'Synthetic pending clarification', modelReceiptId: 'synthetic-pending-model' } };
    if (method === 'conversation.continuation' && readContinuation) return readContinuation();
    if (method === 'trust.update') return {};
    if (method === 'models.preview') return { id: 'synthetic-fresh-preview', routeId: 'synthetic-new-route',
      purpose: 'conversation', naturalQuestion: payload.question, approvalRequired: true, digest: 'a'.repeat(64),
      endpoint: 'http://127.0.0.1:11434/api/chat', payload: JSON.stringify({ question: payload.question }), send: 'shape' };
    assert.fail(`Unexpected historical refresh fixture request: ${method}`);
  } });
  h.renderer.state.messages = [{ role: 'assistant', data: { id: 'synthetic-old-receipt', figures: [] } }];
  find(h.app, node => node.tagName === 'select' && node.attributes['aria-label'] === 'Model route').value = 'synthetic-new-route';
  return h;
}
function refusal(code: string) { return Object.assign(new Error('Synthetic historical read refusal.'), { code }); }

test('missing old receipt permits a fresh exact preview after cleanup, with no provider dispatch or carried continuation', async () => {
  const h = await fixture(async () => { throw refusal('RECEIPT_NOT_FOUND'); });
  await h.ask(question);
  assert.deepEqual(h.calls.filter(call => call.method === 'models.preview').map(call => call.payload),
    [{ question, routeId: 'synthetic-new-route', purpose: 'conversation', questionDisclosure: 'verbatim' }]);
  assert.equal(h.renderer.state.messages.length, 2); assert.equal(h.renderer.state.messages[0].text, question);
  assert.equal(h.renderer.state.messages[1].data.preview.id, 'synthetic-fresh-preview');
  assert.equal(h.renderer.state.continuation, null); assert.equal(h.calls.some(call => call.method === 'conversation.ask'), false);
});

for (const code of ['ACCESS_REVOKED', 'VAULT_LOCKED', 'UNAUTHENTICATED', 'SOURCE_REVOKED', 'EVIDENCE_CHANGED']) {
  test(`historical refresh ${code} cancels the fresh question before preview and removes saved bodies`, async () => {
    const h = await fixture(async () => { throw refusal(code); });
    await h.ask(question);
    assert.equal(h.renderer.state.messages.length, 0); assert.equal(h.renderer.state.continuation, null);
    assert.equal(h.calls.some(call => ['models.preview', 'models.approve', 'conversation.ask'].includes(call.method)), false);
  });
}

test('a concurrent trust change cannot be mistaken for the refresh own stale-receipt cleanup', async () => {
  let entered!: () => void, reject!: (error: Error) => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<unknown>((_resolve, refuse) => { reject = refuse; });
  const h = await fixture(() => { entered(); return held; });
  const pending = h.ask(question); await started;
  await h.renderer.request('trust.update', { send: 'nothing' });
  reject(refusal('RECEIPT_NOT_FOUND')); await pending;
  assert.equal(h.renderer.state.messages.length, 0);
  assert.equal(h.calls.some(call => ['models.preview', 'models.approve', 'conversation.ask'].includes(call.method)), false);
});

test('a later saved-open authority probe cancels an earlier fresh submission even before it selects its pending objective', async () => {
  let receiptEntered!: () => void, rejectReceipt!: (error: Error) => void, probeEntered!: () => void, resolveProbe!: (value: unknown) => void;
  const receiptStarted = new Promise<void>(resolve => { receiptEntered = resolve; });
  const heldReceipt = new Promise<unknown>((_resolve, reject) => { rejectReceipt = reject; });
  const probeStarted = new Promise<void>(resolve => { probeEntered = resolve; });
  const heldProbe = new Promise<unknown>(resolve => { resolveProbe = resolve; });
  const h = await fixture(() => { receiptEntered(); return heldReceipt; }, () => { probeEntered(); return heldProbe; });
  const submission = h.ask(question); await receiptStarted;
  const savedOpen = h.renderer.showSavedConversation('synthetic-pending'); await probeStarted;
  rejectReceipt(refusal('RECEIPT_NOT_FOUND')); await submission;
  resolveProbe({ schemaVersion: 1, turnId: 'synthetic-pending', originalQuestion: 'Synthetic pending objective', clarification: 'Synthetic pending clarification' });
  await savedOpen;
  assert.equal(h.renderer.state.messages.length, 0); assert.equal(h.renderer.state.continuation, null);
  assert.equal(h.calls.some(call => ['models.preview', 'models.approve', 'conversation.ask'].includes(call.method)), false);
});
