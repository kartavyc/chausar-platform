import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context, State } from '../runtime/contracts.ts';
import { composeReceiptDetail } from '../runtime/frame-today/receipt-detail.ts';
import { isClosingReply, isReceiptDetailReply } from '../../app/ui/src/bridge/todayx-contract.ts';
import { validateUiContext } from '../../app/ui/src/host/contracts.ts';

const passphrase = 'Receipt detail synthetic passphrase 2026';
const period = { from: '2026-09-01', to: '2026-09-30' };
const code = (expected: string) => (error: any) => error?.code === expected;
const csv = `id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch
order-a,sale,2026-09-03,1250.25,INR,customer-a,invoice-a,order-a,,delivered,Delivered goods,main
invoice-a,invoice,2026-09-02,2200.00,INR,customer-a,invoice-a,order-a,2026-09-15,unpaid,Synthetic invoice,main
payment-a,payment,2026-09-06,1100.00,INR,customer-a,invoice-a,order-a,,settled,Settled receipt,main
`;
const recipe = {
  version: 1, id: 'synthetic-shop-recipe-v1', system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic Shop', branches: ['main'] },
  bindings: [
    { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
    { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
    { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' },
    ...['customerId', 'invoiceId', 'orderId', 'status', 'description', 'branch'].map(name => ({ target: name, source: name, type: 'string', nulls: 'omit' })),
    { target: 'dueDate', source: 'dueDate', type: 'date', dateFormat: 'ISO', nulls: 'omit' },
  ],
  allowedKinds: ['invoice', 'payment', 'sale'], allowedStatuses: ['settled', 'delivered', 'unpaid'], onUnmapped: 'reject',
};
const input = { sourceId: 'synthetic-export', format: 'csv', content: csv, recipe, expectedTotals: { rowCount: 3, amountMinor: '455025' } };

async function fixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-receipt-detail-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Shop', passphrase, demo: false, pack: 'ecommerce', folder: 'main' });
  await engine.request('ontology.publish', { pack: 'ecommerce' });
  const imported = await engine.request('sources.import', input);
  assert.equal(imported.coverage.reconciled, true);
  return engine;
}
async function viewerOf(engine: Engine): Promise<Context> {
  const member = await engine.request('members.add', { id: 'detail-viewer', name: 'Synthetic viewer', role: 'viewer', branches: ['*'] });
  return { memberId: member.id, role: 'viewer', epoch: member.epoch, channel: 'desktop' };
}

test('a receipt with nothing linked carries only the always-known small print', async t => {
  const engine = await fixture(t);
  const receipt = await engine.request('calculation.run', { operation: 'billed', period });
  const detail: any = await engine.request('todayx.receiptDetail', { receiptId: receipt.id });
  assert.ok(isReceiptDetailReply(detail), JSON.stringify(detail));
  assert.deepEqual(Object.keys(detail).sort(), ['allowedBy', 'meaning', 'receiptId', 'recipe', 'sources']);
  assert.deepEqual(detail.sources!.names, ['synthetic-export']);
  assert.equal(detail.sources!.wayIn, 'exported-file');
  assert.match(detail.sources!.readAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(detail.recipe, { recipeId: 'synthetic-shop-recipe-v1', state: 'not-yet-tested', acceptedBy: 'Workspace owner', grade: 'reconciled' });
  assert.equal(detail.meaning!.version, String(receipt.ontologyVersion));
  assert.equal(detail.meaning!.publishedBy, 'Workspace owner');
  assert.deepEqual(detail.allowedBy, { kind: 'read-access', person: 'Workspace owner', at: receipt.createdAt });
  for (const absent of ['question', 'rate', 'numberGuard', 'route']) assert.equal(Object.hasOwn(detail, absent), false, absent);
  await assert.rejects(engine.request('todayx.receiptDetail', { receiptId: receipt.id, extra: true }), code('INVALID_TODAYX_REQUEST'));
  await assert.rejects(engine.request('todayx.receiptDetail', { receiptId: 'receipt_missing' }), code('RECEIPT_NOT_FOUND'));
});

test('a question is present only when a conversation record links the receipt', async t => {
  const engine = await fixture(t);
  const earned = await engine.request('conversation.ask', { question: 'What was billed?', period });
  assert.equal(earned.supported, true);
  const detail: any = await engine.request('todayx.receiptDetail', { receiptId: earned.receipt.id });
  assert.ok(isReceiptDetailReply(detail), JSON.stringify(detail));
  assert.equal(detail.question, 'What was billed?');
  // Asked without a model: no route, no number guard and no send approval is claimed.
  assert.equal(detail.route, undefined); assert.equal(detail.numberGuard, undefined); assert.equal(detail.allowedBy.kind, 'read-access');
});

test('a viewer reads only the receipts and questions it may', async t => {
  const engine = await fixture(t);
  const owned = await engine.request('conversation.ask', { question: 'What was billed?', period });
  const viewer = await viewerOf(engine);
  await assert.rejects(engine.requestAs(viewer, 'todayx.receiptDetail', { receiptId: owned.receipt.id }), code('RECEIPT_FORBIDDEN'));
  const mine = await engine.requestAs(viewer, 'calculation.run', { operation: 'billed', period });
  const detail: any = await engine.requestAs(viewer, 'todayx.receiptDetail', { receiptId: mine.id });
  assert.ok(isReceiptDetailReply(detail), JSON.stringify(detail));
  assert.equal(detail.question, undefined, 'The owner question on another receipt never reaches the viewer.');
  assert.deepEqual(detail.allowedBy, { kind: 'read-access', person: 'Synthetic viewer', at: mine.createdAt });
});

test('route, number guard, rate and the send approval appear only from linked model records', () => {
  const ctx: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
  const receipt = { id: 'receipt_a', memberId: 'owner', createdAt: '2026-09-30T06:00:00.000Z', sourceIds: ['s1'], dictionaryHash: 'h', ontologyVersion: 2,
    allowedNumbers: ['1250.25', '125025'], rows: [{ normalization: { sourceCurrency: 'USD', targetCurrency: 'INR', rate: { numerator: '8350', denominator: '100', rounding: 'exact' } } }] };
  const base = {
    members: [{ id: 'owner', name: 'Asha Synthetic', role: 'owner', active: true, epoch: 1, branches: ['*'] }],
    ontology: { history: [{ hash: 'h', version: 2, publishedBy: 'owner' }] }, imports: [], learning: [], routes: [{ id: 'route_a', kind: 'ollama' }],
    conversations: [{ id: 'answer_a', kind: 'calculation-answer', memberId: 'owner', question: 'What was billed?', receiptId: 'receipt_a', answer: { explanation: 'Billed was 1250.25.' } }],
  } as unknown as State;
  const alone = composeReceiptDetail(base, ctx, receipt, [], []);
  assert.ok(isReceiptDetailReply(alone), JSON.stringify(alone));
  assert.equal(alone.route, undefined); assert.equal(alone.numberGuard, undefined);
  assert.deepEqual(alone.rate, { numerator: '8350', denominator: '100', from: 'USD', to: 'INR' });
  assert.equal(alone.sources?.wayIn, undefined, 'A source this seat cannot see gives no way in.');

  const linked = { ...base, conversations: [...base.conversations, { id: 'tools_a', kind: 'conversation-tools-answer', memberId: 'owner', resultRefs: [{ tool: 'calculation.run', answerId: 'answer_a' }], modelReceiptId: 'model_a' }] } as unknown as State;
  const models = [
    { id: 'model_a', kind: 'model-preview', routeId: 'route_a', send: 'shape', costMeasured: true, actualCostMinor: '250' },
    { id: 'approval_a', kind: 'outbound-approval', previewId: 'model_a', approverId: 'owner', createdAt: '2026-09-30T05:59:00.000Z' },
  ];
  const detail = composeReceiptDetail(linked, ctx, receipt, [], models);
  assert.ok(isReceiptDetailReply(detail), JSON.stringify(detail));
  assert.deepEqual(detail.route, { kind: 'ollama', sendLevel: 'shape', costPaise: '250' });
  assert.deepEqual(detail.numberGuard, { passed: true, matched: '1', of: '1' });
  assert.deepEqual(detail.allowedBy, { kind: 'send-approved', person: 'Asha Synthetic', at: '2026-09-30T05:59:00.000Z' });
  // A model receipt this seat may not see (not in the visible list) adds nothing.
  const hidden = composeReceiptDetail(linked, ctx, receipt, [], []);
  assert.equal(hidden.route, undefined); assert.equal(hidden.allowedBy.kind, 'read-access');
});

test('ui.context carries the workspace time zone only when one is recorded', async t => {
  const engine = await fixture(t);
  const initial = await engine.request('ui.context', {});
  assert.equal(initial.timeZone, null);
  assert.equal(validateUiContext(initial).timeZone, null);
  await engine.vault!.update(state => { (state.workspace as any).timeZone = 'Asia/Kolkata'; });
  const zoned = await engine.request('ui.context', {});
  assert.equal(zoned.timeZone, 'Asia/Kolkata');
  assert.equal(validateUiContext(zoned).timeZone, 'Asia/Kolkata');
  assert.notEqual(zoned.contextKey, initial.contextKey, 'A new zone is a new authority context.');
  await engine.vault!.update(state => { (state.workspace as any).timeZone = 'Not/A_Zone'; });
  assert.equal((await engine.request('ui.context', {})).timeZone, null, 'An unknown zone is never passed on.');
  // Older replies without the field stay valid; a bad zone is refused.
  const { timeZone: _dropped, ...older } = initial;
  assert.equal(validateUiContext(older).timeZone, undefined);
  assert.throws(() => validateUiContext({ ...initial, timeZone: 'Not/A_Zone' }));
});

test('daily closing: off by default, admin turns it on, parts from real state', async t => {
  const engine = await fixture(t);
  const first = await engine.request('todayx.closing', {});
  assert.ok(isClosingReply(first), JSON.stringify(first));
  assert.equal(first.on, false);
  assert.deepEqual(first.parts, { cash: 'not-loaded-yet', bank: 'not-loaded-yet', entries: 'done' });
  const viewer = await viewerOf(engine);
  await assert.rejects(engine.requestAs(viewer, 'todayx.closing.set', { on: true }), code('FORBIDDEN'));
  assert.ok(isClosingReply(await engine.requestAs(viewer, 'todayx.closing', {})));
  await assert.rejects(engine.request('todayx.closing.set', { on: 'yes' }), code('INVALID_TODAYX_REQUEST'));
  const on = await engine.request('todayx.closing.set', { on: true });
  assert.equal(on.on, true);
  assert.equal((await engine.request('todayx.closing', {})).on, true);
});
