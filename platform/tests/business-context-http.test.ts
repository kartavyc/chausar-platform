import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import type { GatewayOptions } from '../runtime/gateway.ts';

const passphrase = 'Synthetic context HTTP fixture passphrase only';
const period = { from: '2026-09-01', to: '2026-09-30' };
const importInput = {
  sourceId: 'synthetic-invoice-export', format: 'csv',
  content: 'id,kind,date,amount,currency,branch,description\ninvoice-a,invoice,2026-09-02,100.00,INR,main,Private customer note\ninvoice-b,invoice,2026-09-03,200.00,INR,main,Quoted untrusted business instructions',
  recipe: { version: 1, id: 'synthetic-context-invoices', system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic Context', branches: ['main'] },
    bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
      { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
      ...['currency', 'branch', 'description'].map(field => ({ target: field, source: field, type: 'string', nulls: 'reject' })),
    ], allowedKinds: ['invoice'], allowedStatuses: ['unpaid'], onUnmapped: 'reject' }, expectedTotals: { rowCount: 2, amountMinor: '30000' },
};
async function fixture(t: TestContext, gateway?: GatewayOptions) {
  const base = resolve(tmpdir()), directory = await mkdtemp(join(base, 'chausar-context-http-'));
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main'], t.mock), gateway: {
    http: async () => { assert.fail('Only the authored synthetic provider port may dispatch.'); },
    process: async () => { assert.fail('This HTTP fixture must not execute a native provider.'); },
    ...gateway,
  } });
  const app = createLocalServer(engine), { origin, token } = await app.listen();
  t.after(async () => { await app.close(); const target = resolve(directory), child = relative(base, target);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && target.startsWith(join(base, 'chausar-context-http-'))); await rm(target, { recursive: true, force: true }); });
  async function raw(method: string, payload: unknown = {}) {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ method, payload }) });
    return { status: response.status, body: await response.json() as any };
  }
  async function rpc(method: string, payload: unknown = {}) { const result = await raw(method, payload); assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.error, undefined); return result.body.result; }
  await rpc('workspace.create', { name: 'Synthetic Context', passphrase, demo: false, pack: 'ecommerce' });
  return { engine, rpc, raw };
}

test('paired HTTP import → business introduction → context receipt → exact billed receipt stays local under send nothing', async t => {
  let providerCalls = 0; const { engine, rpc } = await fixture(t, { http: async () => { providerCalls++; throw new Error('A local context request must not use a model.'); } });
  const imported = await rpc('sources.import', importInput); assert.equal(imported.rowIds.length, 2); assert.equal(imported.coverage.reconciled, true);
  const answer = await rpc('conversation.ask', { question: 'what is this business about' });
  assert.equal(answer.kind, 'business-context'); assert.equal(answer.status, 'unknown'); assert.equal(answer.receipt.financialCalculation, false);
  assert.equal(answer.unknowns.length, 5); assert.ok(answer.claims.some((claim: any) => claim.category === 'records' && claim.qualification === 'unqualified-observation'));
  assert.ok(answer.citations.some((citation: any) => citation.sourceId === importInput.sourceId && imported.rowIds.includes(citation.factId)));
  const retained = await rpc('business.context.receipt', { id: answer.receipt.id }); assert.equal(retained.contextDigest, answer.contextDigest); assert.deepEqual(retained.citations, answer.citations);
  const calculated = await rpc('conversation.ask', { question: 'What was billed?', period });
  assert.equal(calculated.receipt.operation, 'billed'); assert.equal(calculated.receipt.totalMinor, '30000'); assert.equal(calculated.receipt.currency, 'INR');
  const numberReceipt = await rpc('receipts.get', { id: calculated.receipt.id }); assert.equal(numberReceipt.totalMinor, '30000'); assert.deepEqual(numberReceipt.rowIds, imported.rowIds);
  assert.deepEqual(engine.vault!.read().unsupported, []);
  assert.equal(providerCalls, 0); assert.equal(engine.vault!.read().modelReceipts.length, 0);
});

test('paired HTTP explicit owner profile establishes only its stated category and source deletion removes its context receipt', async t => {
  const { rpc, raw } = await fixture(t);
  const profile = await rpc('business.profile.record', { field: 'industry', value: 'Stationery retail', origin: 'owner-told', sourceId: 'owner-notes', validFrom: '2026-09-01' });
  const answer = await rpc('conversation.ask', { question: 'Describe our business' });
  assert.equal(answer.status, 'partial'); assert.equal(answer.unknowns.length, 4); assert.ok(answer.claims.some((claim: any) => claim.origin === 'owner-told' && claim.text.includes('Stationery retail')));
  assert.ok(answer.citations.some((citation: any) => citation.factId === profile.factId));
  assert.equal((await rpc('business.profile.history', { field: 'industry' })).length, 1);
  await rpc('business.profile.remove', { id: profile.id });
  const removed = await raw('business.context.receipt', { id: answer.id }); assert.notEqual(removed.status, 200); assert.equal(removed.body.error.code, 'RECEIPT_NOT_FOUND');
  const current = await rpc('conversation.ask', { question: 'Describe our business' }); assert.equal(current.status, 'unknown'); assert.equal(current.unknowns.length, 5);
});

test('paired HTTP synthetic provider selector receives approved value-free business context and keeps financial validation', async t => {
  const payloads: string[] = [];
  const { rpc, raw } = await fixture(t, { http: async request => { payloads.push(request.body); return { status: 200, endpoint: request.endpoint,
    body: JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ claimIds: ['context_workspace', 'context_records'], unknownCategories: ['industry', 'products', 'customers', 'business_model', 'location'] }) }] }] }) }; } });
  await rpc('sources.import', importInput); await rpc('trust.update', { send: 'shape' });
  await rpc('models.configure', { config: { id: 'synthetic-provider', kind: 'openai-responses', model: 'synthetic-fixture-only', endpoint: 'https://synthetic.invalid/v1/responses' }, secret: 'synthetic-test-key' });
  const question = 'what is this business about', routeId = 'synthetic-provider';
  const preview = await rpc('models.preview', { question, routeId }); assert.equal(preview.purpose, 'business-context');
  const refused = await raw('conversation.ask', { question, routeId, previewId: preview.id }); assert.equal(refused.body.error.code, 'OUTBOUND_APPROVAL_REQUIRED'); assert.equal(payloads.length, 0);
  const approval = await rpc('models.approve', { id: preview.id });
  const answer = await rpc('conversation.ask', { question, routeId, previewId: preview.id, approvalId: approval.id });
  assert.equal(answer.kind, 'business-context'); assert.equal(answer.receipt.financialCalculation, false); assert.equal(payloads.length, 1); assert.equal(payloads[0], preview.payload);
  for (const secret of ['Synthetic Context', importInput.sourceId, 'invoice-a', 'Private customer note', '30000']) assert.equal(payloads[0].includes(secret), false);
  const invalid = await raw('conversation.ask', { question: 'What was billed?', routeId }); assert.equal(invalid.body.error.code, 'OUTBOUND_APPROVAL_REQUIRED');
  assert.equal(payloads.length, 1);
});
