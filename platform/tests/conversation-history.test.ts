import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ChausarError, hash, initialState, newId, now, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { assertBusinessContextCurrent, buildBusinessContext, renderBusinessAnswer } from '../runtime/conversation-context.ts';
import { ConversationHistoryService, conversationRecordIntegrity, createCalculationAnswerRecord } from '../runtime/conversation-history.ts';
import { MemoryService } from '../runtime/memory.ts';
import { ModelGateway } from '../runtime/gateway.ts';
import { validateConversationPlan } from '../runtime/conversation-planner.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import { Vault } from '../runtime/vault.ts';

// Authored synthetic local fixtures. These tests use no model or network.
const OWNER: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const SOURCE = 'synthetic-history-invoices', BRANCH = 'synthetic-history-branch';
const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
const SECRET = 'SYNTHETIC RAW SOURCE DESCRIPTION MUST NOT ENTER HISTORY';
const code = (expected: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === expected;
class MemoryStore implements StateStore {
  state = initialState('Synthetic history fixture', true);
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const draft = this.read(), result = await change(draft); draft.revision++; this.state = draft; return result;
  }
}
function history(store: StateStore) {
  return new ConversationHistoryService(store, {
    assertBusinessContext: (ctx, manifest, view) => assertBusinessContextCurrent(view, ctx, manifest),
    receipt: (ctx, id, view) => new CalculatorService(view).receipt(ctx, id),
  });
}
async function initialize(store: StateStore = new MemoryStore()) {
  await new OntologyService(store).publish(OWNER, 'ecommerce');
  const memory = new MemoryService(store);
  const facts = await memory.append(OWNER, [
    { entityId: 'synthetic-invoice-one', sourceId: SOURCE, sourceRow: 1, kind: 'invoice', branch: BRANCH,
      validFrom: '2026-09-12', fields: { amountMinor: '10000', currency: 'INR', status: 'issued', description: SECRET } },
    { entityId: 'synthetic-invoice-two', sourceId: SOURCE, sourceRow: 2, kind: 'invoice', branch: BRANCH,
      validFrom: '2026-09-13', fields: { amountMinor: '20000', currency: 'INR', status: 'issued', description: SECRET } },
    { entityId: 'synthetic-cancelled-invoice', sourceId: 'synthetic-history-excluded', sourceRow: 1, kind: 'invoice', branch: BRANCH,
      validFrom: '2026-09-13', fields: { amountMinor: '70000', currency: 'INR', status: 'cancelled', description: SECRET } },
  ]);
  return { store, memory, facts, calculator: new CalculatorService(store), history: history(store), trust: new TrustService(store) };
}
async function saveCalculation(f: Awaited<ReturnType<typeof initialize>>, direct = false) {
  const receipt = await f.calculator.calculate(OWNER, { operation: 'billed', period: PERIOD, branch: BRANCH });
  assert.equal(receipt.valueMinor, '30000');
  const answer = direct ? receipt : { supported: true, message: receipt.explanation, receipt };
  const record = createCalculationAnswerRecord(OWNER, 'What was billed?', answer, receipt);
  await f.store.update(state => { state.conversations.push(record); });
  return { receipt, record, answer };
}
async function saveBusiness(f: Awaited<ReturnType<typeof initialize>>, unsigned = false) {
  const manifest = buildBusinessContext(f.store, OWNER, { branch: BRANCH }), id = newId('business_answer');
  const answer = { ...renderBusinessAnswer(f.store, OWNER, manifest, { claimIds: manifest.claims.map(claim => claim.id), unknownCategories: manifest.unknownCategories }),
    id, receipt: { id, kind: 'business-context-receipt', contextDigest: manifest.digest, financialCalculation: false, sourceIds: manifest.sourceIds, rowIds: manifest.rowIds } };
  const record: any = { id, kind: 'business-context-answer', at: now(), memberId: OWNER.memberId, epoch: OWNER.epoch,
    question: 'What is this business about?', manifest, answer, sourceIds: manifest.sourceIds, rowIds: manifest.rowIds, profileIds: manifest.profileIds };
  if (!unsigned) record.integrity = conversationRecordIntegrity(record);
  await f.store.update(state => { state.conversations.push(record); });
  return { record, answer };
}

async function compositeFixture(store: StateStore = new MemoryStore(), withError = false) {
  const f = await initialize(store);
  await f.trust.updatePolicy(OWNER, { send: 'shape' });
  // Actual preview/approval/current-read guards, with authored completed-model
  // metadata. No execute, model inference, process port or network is invoked.
  const gateway = new ModelGateway(store);
  const route = await gateway.configureRoute(OWNER, { id: 'synthetic-history-route', kind: 'ollama', model: 'synthetic-history-model',
    endpoint: 'http://127.0.0.1:11434/api/chat', budgetMinor: '0', maxCostMinor: '0' });
  const financial = await saveCalculation(f), business = await saveBusiness(f);
  const question = 'Describe this business and what was billed during September?';
  const preview = await gateway.preview(OWNER, { question, purpose: 'conversation', questionDisclosure: 'verbatim', routeId: route.id, branch: BRANCH, period: PERIOD });
  const manifest = preview.businessContext; assert.ok(manifest);
  const approval = await gateway.approveOutbound(OWNER, preview.id);
  const wire = { kind: 'execute', clarification: null, calls: [
    { tool: 'business.describe', args: { claimIds: business.answer.claims.map(claim => claim.id), unknownCategories: manifest.unknownCategories } },
    { tool: 'calculator.calculate', args: { operation: 'billed', period: PERIOD, branch: null, customerId: null } },
    ...(withError ? [{ tool: 'calculator.calculate', args: { operation: 'received', period: PERIOD, branch: null, customerId: null } }] : []),
  ] };
  const plan = validateConversationPlan(wire, { manifest, operations: preview.operations, selectors: preview.selectors });
  await store.update(state => {
    const model = state.modelReceipts.find(item => item.id === preview.id), accepted = state.modelReceipts.find(item => item.id === approval.id);
    Object.assign(model, { status: 'completed', completedAt: now(), plan, conversationPlanWire: wire, conversationPlanDigest: hash(plan), approvalId: approval.id }); accepted.used = true;
  });
  const model = gateway.assertConversationReceipt(OWNER, preview.id), id = newId('conversation_answer');
  const resultRefs = [{ tool: 'business.describe', answerId: business.record.id }, { tool: 'calculator.calculate', answerId: financial.record.id }];
  const answer = { id, kind: 'grounded-conversation', results: [
    { tool: 'business.describe', answer: business.answer }, { tool: 'calculator.calculate', answer: JSON.parse(JSON.stringify(financial.answer)) },
    ...(withError ? [{ tool: 'calculator.calculate', error: { code: 'MISSING_MEASURE_VALUE', message: 'The required measure is unavailable.' } }] : []),
  ], modelReceiptId: model.id, receipt: { id, kind: 'conversation-tool-receipt', modelReceiptId: model.id, resultRefs } };
  const rowIds = [...new Set([...model.factIds, ...model.rowIds, ...business.record.rowIds, ...financial.record.rowIds])];
  const sourceIds = [...new Set([...model.sourceIds, ...business.record.sourceIds, ...financial.record.sourceIds,
    ...store.read().facts.filter(fact => rowIds.includes(fact.id)).map(fact => fact.sourceId)])];
  const body = { id, kind: 'conversation-tools-answer', at: now(), memberId: OWNER.memberId, epoch: OWNER.epoch, question, answer, resultRefs,
    modelReceiptId: model.id, sourceIds, rowIds };
  const record = { ...body, integrity: conversationRecordIntegrity(body) };
  await store.update(state => { state.conversations.push(record); });
  const guarded = new ConversationHistoryService(store, {
    assertBusinessContext: (ctx, manifest, view) => assertBusinessContextCurrent(view, ctx, manifest),
    receipt: (ctx, receiptId, view) => new CalculatorService(view).receipt(ctx, receiptId),
    assertModelReceipt: (ctx, modelId, view) => gateway.assertConversationReceipt(ctx, modelId, view),
  });
  return { ...f, history: guarded, gateway, preview, approval, financial, business, model, record, answer };
}

test('saved direct and wrapped calculator answers retain exact receipts and approved projections', async () => {
  const f = await initialize(), wrapped = await saveCalculation(f), direct = await saveCalculation(f, true);
  const before = f.store.read(), page = f.history.list(OWNER);
  assert.equal(page.items.length, 2);
  assert.deepEqual(f.history.get(OWNER, wrapped.record.id).answer, JSON.parse(JSON.stringify(wrapped.answer)));
  assert.deepEqual(f.history.get(OWNER, direct.record.id).answer, JSON.parse(JSON.stringify(direct.receipt)));
  assert.deepEqual(wrapped.record.rowIds, [...wrapped.receipt.rowIds, f.facts[2].id]);
  assert.equal(page.items.find(item => item.id === wrapped.record.id)!.receiptId, wrapped.receipt.id);
  assert.equal(JSON.stringify(f.history.get(OWNER, wrapped.record.id)).includes(SECRET), false);
  assert.deepEqual(f.store.read(), before, 'history reads must neither recalculate nor save another answer');
});

test('legacy resultId reconstructs from a private current-epoch receipt and excludes unsupported messages', async () => {
  const f = await initialize(), saved = await saveCalculation(f);
  const legacy = { id: newId('message'), at: now(), memberId: OWNER.memberId, question: 'Billed?', resultId: saved.receipt.id, role: 'user' };
  await f.store.update(state => {
    state.conversations = [legacy,
      { id: 'unsupported', at: now(), memberId: OWNER.memberId, question: 'Predict growth', role: 'user' },
      { ...legacy, id: 'foreign-author', memberId: 'foreign' },
      { ...legacy, id: 'old-epoch', epoch: 2 },
      { ...legacy, id: 'missing-receipt', resultId: 'receipt_absent' },
      { ...legacy, id: 'not-user', role: 'assistant' }];
  });
  assert.deepEqual(f.history.list(OWNER).items.map(item => item.id), [legacy.id]);
  assert.deepEqual(f.history.get(OWNER, legacy.id).answer, JSON.parse(JSON.stringify({ supported: true, message: saved.receipt.explanation, receipt: saved.receipt })));
  for (const id of ['unsupported', 'foreign-author', 'old-epoch', 'missing-receipt', 'not-user'])
    assert.throws(() => f.history.get(OWNER, id), code('CONVERSATION_NOT_FOUND'));
});

test('new and legacy business answers keep exact text and citations; changed unsigned text cannot pass', async () => {
  const f = await initialize(), signed = await saveBusiness(f), legacy = await saveBusiness(f, true);
  assert.deepEqual(f.history.get(OWNER, signed.record.id).answer, signed.answer);
  assert.deepEqual(f.history.get(OWNER, legacy.record.id).answer, legacy.answer);
  assert.equal(f.history.list(OWNER).items.every(item => item.kind === 'business-context'), true);
  await f.store.update(state => { state.conversations.find(item => item.id === legacy.record.id).answer.message = 'Invented business narrative'; });
  assert.throws(() => f.history.get(OWNER, legacy.record.id), code('CONVERSATION_NOT_FOUND'));
  assert.deepEqual(f.history.list(OWNER).items.map(item => item.id), [signed.record.id]);
});

test('full record integrity binds question, authority, lineage and exact answer; recomputed mismatched receipts refuse', async () => {
  const f = await initialize(), saved = await saveCalculation(f), original = structuredClone(saved.record);
  const mutations = [
    (record: any) => { record.question = 'Transplanted question'; },
    (record: any) => { record.epoch = 2; },
    (record: any) => { record.sourceIds = []; },
    (record: any) => { record.rowIds = []; },
    (record: any) => { record.answer.receipt.valueMinor = '99999'; record.integrity = conversationRecordIntegrity(record); },
    (record: any) => { record.answer.message = 'Invented financial narrative'; record.integrity = conversationRecordIntegrity(record); },
    (record: any) => { delete record.integrity; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(original); mutate(changed);
    await f.store.update(state => { state.conversations = [changed]; });
    assert.deepEqual(f.history.list(OWNER).items, []);
    assert.throws(() => f.history.get(OWNER, original.id), code('CONVERSATION_NOT_FOUND'));
  }
  assert.throws(() => createCalculationAnswerRecord(OWNER, 'Unsupported?', { supported: false, message: 'No answer', receipt: null }, saved.receipt), code('CONVERSATION_NOT_FOUND'));
});

test('history pagination is bounded, newest first, with exact currently readable message cursors', async () => {
  const f = await initialize(), saved = await saveCalculation(f);
  await f.store.update(state => {
    state.conversations = Array.from({ length: 55 }, (_, index) => createCalculationAnswerRecord(OWNER, `Saved question ${index}`, saved.answer, saved.receipt, new Date(Date.now() - (55 - index) * 1000).toISOString()));
  });
  const first = f.history.list(OWNER);
  assert.equal(first.items.length, 20); assert.equal(first.items[0].question, 'Saved question 54');
  assert.equal(first.nextCursor, first.items[19].id);
  const second = f.history.list(OWNER, { cursor: first.nextCursor });
  assert.equal(second.items[0].question, 'Saved question 34');
  assert.equal(f.history.list(OWNER, { limit: 50 }).items.length, 50);
  const third = f.history.list(OWNER, { cursor: second.nextCursor });
  assert.equal(third.items.length, 15); assert.equal(third.nextCursor, undefined);
  assert.equal(new Set([...first.items, ...second.items, ...third.items].map(item => item.id)).size, 55);
  for (const limit of [0, 51, -1, 1.5]) assert.throws(() => f.history.list(OWNER, { limit }), code('INVALID_HISTORY_REQUEST'));
  assert.throws(() => f.history.list(OWNER, { includeRawState: true } as any), code('INVALID_HISTORY_REQUEST'));
  for (const cursor of ['', 'foreign-message', 'x'.repeat(201)]) assert.throws(() => f.history.list(OWNER, { cursor }), code('INVALID_HISTORY_CURSOR'));
  await f.store.update(state => { state.conversations = state.conversations.filter(item => item.id !== first.nextCursor); });
  assert.throws(() => f.history.list(OWNER, { cursor: first.nextCursor }), code('INVALID_HISTORY_CURSOR'));
});

test('revoked sources, branch access and member epochs hide saved bodies using existing authority guards', async () => {
  const f = await initialize(), saved = await saveCalculation(f), business = await saveBusiness(f);
  await f.trust.grantSource(OWNER, { sourceId: SOURCE, revoked: true });
  assert.deepEqual(f.history.list(OWNER).items, []);
  for (const id of [saved.record.id, business.record.id]) assert.throws(() => f.history.get(OWNER, id), code('CONVERSATION_NOT_FOUND'));
  await f.trust.grantSource(OWNER, { sourceId: SOURCE, allow: true });
  await f.store.update(state => { state.members[0].branches = ['another-branch']; });
  assert.deepEqual(f.history.list(OWNER).items, []);
  await f.store.update(state => { state.members[0].branches = ['*']; state.members[0].epoch++; });
  assert.throws(() => f.history.list(OWNER), code('ACCESS_REVOKED'));
  assert.throws(() => f.history.get(OWNER, saved.record.id), code('ACCESS_REVOKED'));
  const refreshed = { ...OWNER, epoch: 2 };
  assert.deepEqual(f.history.list(refreshed).items, []);
});

test('excluded row source deletion purges new financial records through existing generic cleanup roots', async () => {
  const f = await initialize(), saved = await saveCalculation(f);
  await f.trust.deleteSource(OWNER, 'synthetic-history-excluded');
  assert.equal(f.store.read().conversations.some(item => item.id === saved.record.id), false);
  assert.equal(f.store.read().receipts.some(item => item.id === saved.receipt.id), false);
  assert.deepEqual(f.history.list(OWNER).items, []);
  assert.throws(() => f.history.get(OWNER, saved.record.id), code('CONVERSATION_NOT_FOUND'));
});

test('retention gates conversation time, receipt time and fact lineage before actual cleanup', async () => {
  const f = await initialize(), saved = await saveCalculation(f), original = f.store.read();
  const expired = new Date(Date.now() - 100 * 86400000).toISOString();
  for (const change of [
    (state: State) => { const record = state.conversations[0]; record.at = expired; record.integrity = conversationRecordIntegrity(record); },
    (state: State) => { state.receipts[0].createdAt = expired; },
    (state: State) => { state.facts[2].learnedAt = expired; },
  ]) {
    await f.store.update(state => { Object.assign(state, structuredClone(original)); change(state); });
    assert.deepEqual(f.history.list(OWNER).items, []);
    assert.throws(() => f.history.get(OWNER, saved.record.id), code('CONVERSATION_NOT_FOUND'));
  }
  await f.trust.cleanup(OWNER);
  assert.equal(f.store.read().conversations.some(item => item.id === saved.record.id), false);
});

test('dictionary publication and source corrections refuse stale answers without historical definition re-evaluation', async () => {
  const f = await initialize(), saved = await saveCalculation(f), business = await saveBusiness(f);
  await new OntologyService(f.store).publish(OWNER, 'services');
  assert.deepEqual(f.history.list(OWNER).items, []);
  assert.throws(() => f.history.get(OWNER, saved.record.id), code('CONVERSATION_NOT_FOUND'));
  assert.throws(() => f.history.get(OWNER, business.record.id), code('CONVERSATION_NOT_FOUND'));
  const fresh = await saveCalculation(f);
  await f.memory.correct(OWNER, f.facts[0].id, { amountMinor: '50000' });
  assert.throws(() => f.history.get(OWNER, fresh.record.id), code('CONVERSATION_NOT_FOUND'));
});

test('malformed timestamps, duplicated IDs, foreign private receipts and removed references fail closed', async () => {
  const f = await initialize(), saved = await saveCalculation(f), original = f.store.read();
  const mutations = [
    (state: State) => { state.conversations[0].at = 'not-a-date'; },
    (state: State) => { state.conversations.push(structuredClone(state.conversations[0])); },
    (state: State) => { state.receipts[0].memberId = 'foreign-owner'; },
    (state: State) => { state.receipts = []; },
    (state: State) => { state.facts = state.facts.filter(fact => fact.id !== saved.receipt.rowIds[0]); },
    (state: State) => { state.facts = state.facts.filter(fact => fact.id !== f.facts[2].id); },
  ];
  for (const change of mutations) {
    await f.store.update(state => { Object.assign(state, structuredClone(original)); change(state); });
    assert.deepEqual(f.history.list(OWNER).items, []);
    assert.throws(() => f.history.get(OWNER, saved.record.id), code('CONVERSATION_NOT_FOUND'));
  }
});

test('saved answers reopen from the encrypted file adapter with unchanged IDs, exact values and citations', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-history-test-'));
  const options = { directory, storage: 'experimental-file' as const, passphrase: 'synthetic history fixture passphrase' };
  let vault = (await Vault.create({ ...options, name: 'Synthetic encrypted history fixture', demo: true })).vault;
  t.after(async () => { await vault.close(); await rm(directory, { recursive: true, force: true }); });
  const f = await initialize(vault), financial = await saveCalculation(f), business = await saveBusiness(f);
  const before = [f.history.get(OWNER, financial.record.id), f.history.get(OWNER, business.record.id)];
  await vault.close(); vault = await Vault.open(options);
  const reopened = history(vault);
  assert.deepEqual([reopened.get(OWNER, financial.record.id), reopened.get(OWNER, business.record.id)], before);
  assert.equal(reopened.get(OWNER, financial.record.id).answer.receipt.valueMinor, '30000');
  assert.equal(vault.read().receipts.length, 1, 'reopening never creates a replacement receipt');
  const encrypted = await readFile(join(directory, 'authority.encrypted.json'), 'utf8');
  assert.equal(encrypted.includes(SECRET), false); assert.equal(encrypted.includes('What is this business about?'), false);
});

test('history cannot be installed without both current evidence guard callbacks', () => {
  assert.throws(() => new ConversationHistoryService(new MemoryStore(), {} as any), code('HISTORY_GUARD_REQUIRED'));
});

test('installed readiness hooks reject expired saved receipts and empty managed business scopes without fallback', async () => {
  // This host-hook fixture tests delegation and expiry; it does not qualify a
  // connector, make a source acquisition, or assert vendor/native readiness.
  let clockMs = Date.now(); const expiresAt = clockMs + 1000;
  const ready = () => { if (clockMs >= expiresAt) throw new ChausarError('SOURCE_NOT_READY', 'Synthetic installed readiness expired.'); };
  const f = await initialize(), saved = await saveCalculation(f);
  let receiptChecks = 0;
  const guardedFinancial = new ConversationHistoryService(f.store, {
    assertBusinessContext: (ctx, manifest, view) => assertBusinessContextCurrent(view, ctx, manifest),
    receipt: (ctx, id, view) => new CalculatorService(view, { receiptGuard: () => { receiptChecks++; ready(); } }).receipt(ctx, id),
  });
  assert.equal(guardedFinancial.get(OWNER, saved.record.id).answer.receipt.valueMinor, '30000');
  const empty = new MemoryStore();
  await empty.update(state => { state.imports.push({ id: 'synthetic-empty-capture', type: 'connector-capture-v1', sourceId: SOURCE, domain: { branches: [BRANCH] } }); });
  let businessChecks = 0;
  const hooks = { assertEvidenceReady: (_ctx: Context, refs: { managedSourceIds: string[]; factIds: string[] }) => {
    businessChecks++; ready(); assert.deepEqual(refs.factIds, []); return { qualifiedSourceIds: refs.managedSourceIds };
  } };
  const manifest = buildBusinessContext(empty, OWNER, { branch: BRANCH }, hooks), id = newId('business_answer');
  assert.deepEqual(manifest.rowIds, []); assert.deepEqual(manifest.sourceIds, [SOURCE]);
  const answer = { ...renderBusinessAnswer(empty, OWNER, manifest, { claimIds: manifest.claims.map(claim => claim.id), unknownCategories: manifest.unknownCategories }, hooks),
    id, receipt: { id, kind: 'business-context-receipt', contextDigest: manifest.digest, financialCalculation: false, sourceIds: manifest.sourceIds, rowIds: manifest.rowIds } };
  const record = { id, kind: 'business-context-answer', at: now(), memberId: OWNER.memberId, epoch: OWNER.epoch, question: 'What is this business about?',
    manifest, answer, sourceIds: manifest.sourceIds, rowIds: manifest.rowIds, profileIds: manifest.profileIds };
  await empty.update(state => { state.conversations.push({ ...record, integrity: conversationRecordIntegrity(record) }); });
  const guardedBusiness = new ConversationHistoryService(empty, {
    assertBusinessContext: (ctx, current, view) => assertBusinessContextCurrent(view, ctx, current, hooks),
    receipt: (ctx, currentId, view) => new CalculatorService(view).receipt(ctx, currentId),
  });
  assert.deepEqual(guardedBusiness.get(OWNER, id).answer, answer);
  const readsBeforeExpiry = { receiptChecks, businessChecks }; clockMs = expiresAt;
  assert.deepEqual(guardedFinancial.list(OWNER).items, []); assert.deepEqual(guardedBusiness.list(OWNER).items, []);
  assert.throws(() => guardedFinancial.get(OWNER, saved.record.id), code('CONVERSATION_NOT_FOUND'));
  assert.throws(() => guardedBusiness.get(OWNER, id), code('CONVERSATION_NOT_FOUND'));
  assert.ok(receiptChecks > readsBeforeExpiry.receiptChecks && businessChecks > readsBeforeExpiry.businessChecks);
  assert.equal(f.store.read().receipts.length, 1); assert.equal(empty.read().receipts.length, 0);
});

test('grounded composite reopens exact current child answers and bounded errors without recalculation or model dispatch', async () => {
  const f = await compositeFixture(undefined, true), before = f.store.read();
  assert.deepEqual(f.history.get(OWNER, f.record.id).answer, JSON.parse(JSON.stringify(f.answer)));
  assert.equal(f.history.get(OWNER, f.record.id).kind, 'grounded-conversation');
  assert.equal(f.history.list(OWNER).items.find(item => item.id === f.record.id)!.receiptId, f.record.id);
  assert.equal(f.history.get(OWNER, f.record.id).answer.results[1].answer.receipt.valueMinor, '30000');
  assert.deepEqual(f.store.read(), before);
  assert.equal(JSON.stringify(f.history.get(OWNER, f.record.id)).includes(SECRET), false);
  assert.equal(f.record.rowIds.includes(f.facts[2].id), true, 'excluded rows remain exact lineage roots');
});

test('composite fails closed when any current child is missing, duplicated, stale, changed or recursive', async () => {
  const f = await compositeFixture(), original = f.store.read();
  const changes = [
    (state: State) => { state.conversations = state.conversations.filter(item => item.id !== f.financial.record.id); },
    (state: State) => { state.conversations.push(structuredClone(f.business.record)); },
    (state: State) => { state.receipts[0].stale = true; },
    (state: State) => { const child = state.conversations.find(item => item.id === f.business.record.id); child.answer.message = 'Changed context'; child.integrity = conversationRecordIntegrity(child); },
    (state: State) => { const child = state.conversations.find(item => item.id === f.financial.record.id); child.kind = 'conversation-tools-answer'; child.integrity = conversationRecordIntegrity(child); },
    (state: State) => { delete state.conversations.find(item => item.id === f.business.record.id).integrity; },
  ];
  for (const change of changes) {
    await f.store.update(state => { Object.assign(state, structuredClone(original)); change(state); });
    assert.throws(() => f.history.get(OWNER, f.record.id), code('CONVERSATION_NOT_FOUND'));
    assert.equal(f.history.list(OWNER).items.some(item => item.id === f.record.id), false);
  }
});

test('composite strict shape and exact ordered references reject injection and altered roots even with recomputed integrity', async () => {
  const f = await compositeFixture(undefined, true), original = f.store.read();
  const changes = [
    (record: any) => { record.sourceIds = []; },
    (record: any) => { record.question = 'Transplanted question?'; },
    (record: any) => { record.rowIds = record.rowIds.filter((id: string) => id !== f.facts[2].id); },
    (record: any) => { record.rawState = { description: SECRET }; },
    (record: any) => { record.answer.message = SECRET; },
    (record: any) => { record.answer.results[0].extra = SECRET; },
    (record: any) => { record.answer.results[2].answer = f.financial.answer; },
    (record: any) => { record.answer.results[2].error.extra = SECRET; },
    (record: any) => { record.answer.results[1].answer.receipt.valueMinor = '99999'; },
    (record: any) => { record.resultRefs.reverse(); record.answer.receipt.resultRefs = structuredClone(record.resultRefs); },
    (record: any) => { record.resultRefs[1].answerId = record.resultRefs[0].answerId; record.answer.receipt.resultRefs = structuredClone(record.resultRefs); },
    (record: any) => { record.answer.receipt.id = 'other-receipt'; },
    (record: any) => { record.answer.modelReceiptId = 'other-model'; },
    (record: any) => { record.answer.results = [{ tool: 'calculator.calculate', error: { code: 'SOURCE_NOT_READY', message: 'Unavailable' } }]; record.resultRefs = []; record.answer.receipt.resultRefs = []; },
  ];
  for (const change of changes) {
    await f.store.update(state => {
      Object.assign(state, structuredClone(original)); const record = state.conversations.find(item => item.id === f.record.id);
      change(record); record.integrity = conversationRecordIntegrity(record);
    });
    assert.throws(() => f.history.get(OWNER, f.record.id), code('CONVERSATION_NOT_FOUND'));
  }
});

test('completed model, original approval, route and current privacy guards remain authoritative for composite history', async () => {
  const f = await compositeFixture(), original = f.store.read();
  const changes = [
    (state: State) => { state.modelReceipts.find(item => item.id === f.model.id).status = 'failed'; },
    (state: State) => { state.modelReceipts = state.modelReceipts.filter(item => item.id !== f.model.id); },
    (state: State) => { state.modelReceipts.push(structuredClone(f.model)); },
    (state: State) => { state.modelReceipts.find(item => item.id === f.model.id).epoch = 2; },
    (state: State) => { state.modelReceipts.find(item => item.id === f.approval.id).used = false; },
    (state: State) => { state.modelReceipts.find(item => item.id === f.approval.id).expiresAt = new Date(Date.now() - 1000).toISOString(); },
    (state: State) => { state.routes[0].enabled = false; },
    (state: State) => { state.policy.send = 'samples'; },
    (state: State) => { state.modelReceipts.find(item => item.id === f.model.id).plan.calls.reverse(); },
  ];
  for (const change of changes) {
    await f.store.update(state => { Object.assign(state, structuredClone(original)); change(state); });
    assert.throws(() => f.history.get(OWNER, f.record.id), code('CONVERSATION_NOT_FOUND'));
    assert.equal(f.history.list(OWNER).items.some(item => item.id === f.record.id), false);
  }
  assert.equal(f.history.get(OWNER, f.financial.record.id).answer.receipt.valueMinor, '30000', 'saved arithmetic is unchanged; aggregate authority never falls back to it');
});

test('composite completed under valid approval remains readable after its send window expires', async t => {
  const f = await compositeFixture();
  const approval = f.store.read().modelReceipts.find(item => item.id === f.approval.id);
  assert.ok(Date.parse(f.model.completedAt) < Date.parse(approval.expiresAt));
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(approval.expiresAt) + 60000 });
  assert.ok(Date.now() > Date.parse(approval.expiresAt));
  assert.deepEqual(f.history.get(OWNER, f.record.id).answer, JSON.parse(JSON.stringify(f.answer)));
  assert.equal(f.store.read().receipts.length, 1, 'the expired send approval never authorizes another calculation or transfer');
});

test('composite source revocation and actual source deletion hide and purge its complete lineage', async () => {
  const f = await compositeFixture();
  await f.trust.grantSource(OWNER, { sourceId: 'synthetic-history-excluded', revoked: true });
  assert.throws(() => f.history.get(OWNER, f.record.id), code('CONVERSATION_NOT_FOUND'));
  await f.trust.grantSource(OWNER, { sourceId: 'synthetic-history-excluded', allow: true });
  await f.trust.deleteSource(OWNER, 'synthetic-history-excluded');
  assert.equal(f.store.read().conversations.some(item => item.id === f.record.id), false);
  assert.throws(() => f.history.get(OWNER, f.record.id), code('CONVERSATION_NOT_FOUND'));
});

test('composite model and fact retention refuse before cleanup and absent model guard never admits composites', async () => {
  const f = await compositeFixture(), original = f.store.read(), expired = new Date(Date.now() - 100 * 86400000).toISOString();
  assert.throws(() => history(f.store).get(OWNER, f.record.id), code('CONVERSATION_NOT_FOUND'));
  for (const change of [
    (state: State) => { state.modelReceipts.find(item => item.id === f.model.id).createdAt = expired; },
    (state: State) => { state.facts[2].learnedAt = expired; },
  ]) {
    await f.store.update(state => { Object.assign(state, structuredClone(original)); change(state); });
    assert.throws(() => f.history.get(OWNER, f.record.id), code('CONVERSATION_NOT_FOUND'));
  }
  await f.trust.cleanup(OWNER);
  assert.equal(f.store.read().conversations.some(item => item.id === f.record.id), false);
});
