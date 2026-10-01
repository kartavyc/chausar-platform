import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import type { Binding, ImportInput, MappingRecipe } from '../runtime/ingest.ts';
import type { DictionaryDraft } from '../runtime/ontology.ts';
import type { InvestigationCreate } from '../runtime/investigations.ts';

const passphrase = 'Synthetic private investigation HTTP fixture passphrase';
const july = { from: '2026-07-01', to: '2026-07-31' };
const august = { from: '2026-08-01', to: '2026-08-31' };
const sourceId = 'synthetic-private-invoice-and-payment-export';
const importInput: ImportInput & { recipe: MappingRecipe } = {
  sourceId, format: 'csv',
  content: 'id,kind,date,amount,currency,branch,status,description\njuly-invoice,invoice,2026-07-02,500.00,INR,main,issued,Private literal invoice evidence\njuly-payment,payment,2026-07-03,300.00,INR,main,settled,Private literal collection evidence\naugust-invoice,invoice,2026-08-02,700.00,INR,main,issued,Counterevidence is retained\naugust-payment,payment,2026-08-03,150.00,INR,main,settled,August private collection row',
  recipe: {
    version: 1, id: 'synthetic-private-investigation-money', system: 'synthetic-csv', edition: '1',
    scope: { company: 'Synthetic Investigation', branches: ['main'] },
    bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
      { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
      ...['currency', 'branch', 'status', 'description'].map((field): Binding => ({ target: field, source: field, type: 'string', nulls: 'reject' })),
    ], allowedKinds: ['invoice', 'payment'], allowedStatuses: ['issued', 'settled'], onUnmapped: 'reject',
  }, expectedTotals: { rowCount: 4, amountMinor: '165000' },
};

async function fixture(t: TestContext) {
  const base = resolve(tmpdir()), directory = await mkdtemp(join(base, 'chausar-investigation-http-'));
  let providerCalls = 0;
  // Experimental file storage and actual HTTP/service/Vault execution; no native search claim.
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', gateway: { http: async () => {
    providerCalls++; throw new Error('This private persisted plan must not contact a model provider.');
  } } });
  const app = createLocalServer(engine), { origin, token } = await app.listen();
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  t.after(async () => {
    await app.close(); const target = resolve(directory), child = relative(base, target);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && target.startsWith(join(base, 'chausar-investigation-http-')));
    await rm(target, { recursive: true, force: true });
  });
  const paired = await fetch(`${origin}/api/session`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(paired.status, 200); assert.deepEqual(await paired.json(), { token });
  async function raw(method: string, payload: unknown = {}, bearer = token) {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify({ method, payload }) });
    return { status: response.status, body: await response.json() as any };
  }
  async function rpc(method: string, payload: unknown = {}, bearer = token) {
    const result = await raw(method, payload, bearer); assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.error, undefined); return result.body.result;
  }
  await rpc('workspace.create', { name: 'Synthetic Investigation', passphrase, demo: false, pack: 'ecommerce' });
  const packs = await rpc('ontology.packs');
  const draft: DictionaryDraft = structuredClone(packs.find((pack: DictionaryDraft) => pack.pack === 'ecommerce'));
  assert.ok(draft);
  draft.definitions.find(definition => definition.name === 'billed')!.meaning = 'Owner convention for these synthetic rows: separately reported issued invoice amounts excluding tax, by invoice event date. They do not establish collections.';
  draft.definitions.find(definition => definition.name === 'received')!.meaning = 'Owner convention for these synthetic rows: separately reported settled payment amounts excluding tax, by settlement event date. No causal collection explanation is inferred.';
  const dictionary = await rpc('ontology.publish', { draft });
  const imported = await rpc('sources.import', importInput);
  assert.equal(imported.coverage.reconciled, true); assert.equal(imported.rowIds.length, 4);
  async function member() {
    const invitation = await rpc('auth.invite', { name: 'Synthetic private investigator', role: 'accountant', branches: ['main'] });
    return rpc('auth.accept', { token: invitation.token });
  }
  return { engine, rpc, raw, dictionary, draft, imported, member, providerCalls: () => providerCalls };
}

function plan(asOf: string, hypotheses: InvestigationCreate['hypotheses'] = []): InvestigationCreate {
  return {
    objective: 'Why did collections fall in August? Keep measured results separate from owner guesses.', branch: 'main', asOf, sourceIds: [sourceId],
    steps: [
      { id: 'july-collections', label: 'Measure settled July collections', request: { operation: 'received', period: july } },
      { id: 'august-collections', label: 'Measure settled August collections', request: { operation: 'received', period: august } },
      { id: 'august-invoices', label: 'Measure separately reported August invoice value as counterevidence', request: { operation: 'billed', period: august } },
    ], hypotheses, budget: { maxSteps: 3, maxReceiptRows: 100, maxContextBytes: 16384 },
  };
}

async function references(value: Awaited<ReturnType<typeof fixture>>, asOf: string) {
  const forReceipt = await value.rpc('calculation.run', { operation: 'received', period: august, asOf, branch: 'main' });
  const againstReceipt = await value.rpc('calculation.run', { operation: 'billed', period: august, asOf, branch: 'main' });
  assert.equal(forReceipt.totalMinor, '15000'); assert.equal(againstReceipt.totalMinor, '70000');
  return { forReceipt, againstReceipt, hypotheses: [{ id: 'collection-timing-guess',
    text: 'Owner guess: payment timing might explain the August collection decrease; rising invoices do not establish that cause.',
    uncertainty: 'unresolved' as const, forReceiptIds: [forReceipt.id], againstReceiptIds: [againstReceipt.id] }] };
}

async function complete(value: Awaited<ReturnType<typeof fixture>>, investigation: any, bearer?: string) {
  let current = investigation;
  for (const expected of ['30000', '15000', '70000']) {
    current = await value.rpc('investigations.advance', { id: current.id, expectedRevision: current.revision }, bearer);
    const measured = current.steps.filter((step: any) => step.state === 'completed').at(-1);
    assert.ok(measured?.receipt);
    const receipt = await value.rpc('receipts.get', { id: measured.receipt.receiptId }, bearer);
    assert.equal(receipt.totalMinor, expected);
    assert.equal(receipt.dictionaryHash, value.dictionary.hash); assert.equal(receipt.databaseProof, undefined);
  }
  assert.equal(current.status, 'complete'); return current;
}

test('paired HTTP saved explicit investigation plan resumes through encrypted reopen and matches an uninterrupted run', async t => {
  const value = await fixture(t), asOf = new Date().toISOString(), refs = await references(value, asOf), input = plan(asOf, refs.hypotheses);
  const created = await value.rpc('investigations.create', input);
  assert.equal(created.kind, 'private-investigation-v1'); assert.equal(created.status, 'open'); assert.equal(created.revision, 1);
  assert.deepEqual(created.sourceIds, [sourceId]); assert.deepEqual(created.budget, input.budget);
  assert.deepEqual(created.steps.map((step: any) => step.id), input.steps.map(step => step.id));
  assert.ok(created.steps.every((step: any) => step.state === 'pending' && step.request.asOf === asOf && step.request.branch === 'main'));
  assert.equal(created.dictionaryHash, value.dictionary.hash); assert.deepEqual(created.hypotheses[0].forReceiptIds, [refs.forReceipt.id]);
  assert.deepEqual(created.hypotheses[0].againstReceiptIds, [refs.againstReceipt.id]); assert.equal(created.hypotheses[0].uncertainty, 'unresolved');
  assert.equal(created.hypotheses[0].kind, 'owner-authored-hypothesis'); assert.equal(created.hypotheses[0].authoredBy, 'owner');
  assert.equal(created.hypotheses[0].causalStatus, 'not-established-cause');
  const first = await value.rpc('investigations.advance', { id: created.id, expectedRevision: created.revision });
  assert.deepEqual(first.steps.map((step: any) => step.state), ['completed', 'pending', 'pending']);
  const firstReceiptId = first.steps[0].receipt.receiptId;
  assert.equal((await value.rpc('receipts.get', { id: firstReceiptId })).totalMinor, '30000');
  const paused = await value.rpc('investigations.pause', { id: first.id, expectedRevision: first.revision, reason: 'Explicit owner pause before remaining August calculations' });
  assert.equal(paused.status, 'paused');
  await value.rpc('workspace.lock'); await value.rpc('workspace.open', { folder: 'main', passphrase });
  const reopened = await value.rpc('investigations.get', { id: created.id }); assert.deepEqual(reopened, paused);
  const resumed = await value.rpc('investigations.resume', { id: reopened.id, expectedRevision: reopened.revision });
  assert.equal(resumed.status, 'open'); assert.equal(resumed.asOf, asOf); assert.equal(resumed.planHash, created.planHash);
  assert.equal(resumed.scopeDigest, created.scopeDigest); assert.deepEqual(resumed.budget, input.budget);
  assert.equal(resumed.steps[0].receipt.receiptId, firstReceiptId);
  let done = resumed;
  for (const expected of ['15000', '70000']) {
    done = await value.rpc('investigations.advance', { id: done.id, expectedRevision: done.revision });
    const receipt = await value.rpc('receipts.get', { id: done.steps.filter((step: any) => step.state === 'completed').at(-1).receipt.receiptId });
    assert.equal(receipt.totalMinor, expected);
  }
  assert.equal(done.status, 'complete'); assert.equal(done.steps[0].receipt.receiptId, firstReceiptId);
  assert.equal(value.engine.vault!.read().receipts.filter((receipt: any) => receipt.id === firstReceiptId).length, 1);
  const uninterrupted = await complete(value, await value.rpc('investigations.create', input));
  assert.equal(uninterrupted.planHash, done.planHash); assert.equal(uninterrupted.scopeDigest, done.scopeDigest);
  for (let index = 0; index < input.steps.length; index++) {
    const left = await value.rpc('receipts.get', { id: done.steps[index].receipt.receiptId });
    const right = await value.rpc('receipts.get', { id: uninterrupted.steps[index].receipt.receiptId });
    for (const key of ['operation', 'totalMinor', 'figures', 'dictionaryHash', 'asOf', 'period', 'branch', 'rowIds', 'rows', 'coverage']) assert.deepEqual(left[key], right[key], `Resumed ${key} must equal the uninterrupted saved-plan result.`);
    assert.ok(left.rowIds.every((id: string) => value.imported.rowIds.includes(id)));
  }
  const capsule = await value.rpc('investigations.capsule', { id: done.id });
  assert.equal(capsule.completeness, 'complete-persisted-plan'); assert.equal(capsule.interpretation, 'measured-results-and-owner-hypotheses');
  assert.equal(capsule.planHash, done.planHash); assert.deepEqual(capsule.completedStepIds, ['july-collections', 'august-collections', 'august-invoices']);
  assert.deepEqual(capsule.pendingStepIds, []); assert.equal(capsule.hypotheses[0].uncertainty, 'unresolved');
  assert.equal(capsule.hypotheses[0].causalStatus, 'not-established-cause');
  assert.deepEqual(capsule.hypotheses[0].forReceiptIds, [refs.forReceipt.id]); assert.deepEqual(capsule.hypotheses[0].againstReceiptIds, [refs.againstReceipt.id]);
  assert.ok(Buffer.byteLength(JSON.stringify(capsule)) <= input.budget.maxContextBytes);
  assert.deepEqual(await value.rpc('investigations.capsule', { id: done.id }), capsule);
  assert.equal((await value.rpc('trust.get')).policy.send, 'nothing'); assert.equal(value.engine.vault!.read().modelReceipts.length, 0);
  assert.equal(value.providerCalls(), 0);
});

test('paired HTTP investigations use exact private receipt references and bounded row drilldown', async t => {
  const value = await fixture(t), asOf = new Date().toISOString(), refs = await references(value, asOf);
  const created = await value.rpc('investigations.create', plan(asOf, refs.hypotheses));
  const page = await value.rpc('investigations.drilldown', { id: created.id, receiptId: refs.forReceipt.id, offset: 0, limit: 1 });
  assert.equal(page.completeness, 'bounded-receipt-page'); assert.equal(page.totalRows, 1); assert.deepEqual(page.rows, refs.forReceipt.rows);
  assert.equal(page.rows[0].amountMinor, '15000'); assert.ok(value.imported.rowIds.includes(page.rows[0].factId));
  const exhausted = await value.rpc('investigations.drilldown', { id: created.id, receiptId: refs.forReceipt.id, offset: 1, limit: 1 });
  assert.deepEqual(exhausted.rows, []); assert.equal(exhausted.totalRows, 1);
  const unbound = await value.rpc('calculation.run', { operation: 'billed', period: july, asOf, branch: 'main' });
  const unrelated = await value.raw('investigations.drilldown', { id: created.id, receiptId: unbound.id, offset: 0, limit: 1 });
  assert.equal(unrelated.body.error.code, 'INVESTIGATION_RECEIPT_CHANGED');
  const overflow = await value.raw('investigations.drilldown', { id: created.id, receiptId: refs.forReceipt.id, offset: 0, limit: 1001 });
  assert.equal(overflow.body.error.code, 'INVALID_INVESTIGATION');
  const reader = await value.member();
  const borrowed = await value.raw('investigations.create', plan(asOf, refs.hypotheses), reader.token);
  assert.equal(borrowed.body.error.code, 'RECEIPT_FORBIDDEN');
  const missing = await value.raw('investigations.create', plan(asOf, [{ ...refs.hypotheses[0], forReceiptIds: ['receipt-does-not-exist'] }]));
  assert.equal(missing.body.error.code, 'RECEIPT_NOT_FOUND');
  assert.equal(value.providerCalls(), 0);
});

test('paired HTTP explicit budgets pause without sampling or extra calculations and revisions preserve original hypotheses', async t => {
  const value = await fixture(t), asOf = new Date().toISOString();
  const stepLimited = plan(asOf); stepLimited.budget.maxSteps = 1;
  const created = await value.rpc('investigations.create', stepLimited);
  assert.equal(created.status, 'paused'); assert.equal(created.pauseReason, 'step-budget'); assert.equal(value.engine.vault!.read().receipts.length, 0);
  assert.ok(created.steps.every((step: any) => step.state === 'pending'));
  const revised = await value.rpc('investigations.revise', { id: created.id, expectedRevision: created.revision,
    reason: 'Owner explicitly approves a larger step budget', budget: plan(asOf).budget,
    hypotheses: [{ id: 'still-a-guess', text: 'Owner guess requires additional evidence before any causal interpretation.', uncertainty: 'unverified', forReceiptIds: [], againstReceiptIds: [] }] });
  assert.equal(revised.revisions.length, 1); assert.deepEqual(revised.revisions[0].budget, stepLimited.budget);
  assert.deepEqual(revised.revisions[0].hypotheses, []); assert.equal(revised.hypotheses[0].uncertainty, 'unverified');
  assert.equal(revised.hypotheses[0].causalStatus, 'not-established-cause');
  const resumed = await value.rpc('investigations.resume', { id: revised.id, expectedRevision: revised.revision }); assert.equal(resumed.status, 'open');
  const stale = await value.raw('investigations.advance', { id: resumed.id, expectedRevision: created.revision });
  assert.equal(stale.body.error.code, 'INVESTIGATION_REVISION_CONFLICT'); assert.equal(value.engine.vault!.read().receipts.length, 0);
  const advanced = await value.rpc('investigations.advance', { id: resumed.id, expectedRevision: resumed.revision });
  assert.equal(advanced.steps[0].state, 'completed'); assert.equal(value.engine.vault!.read().receipts.length, 1);
  const tiny = plan(asOf); tiny.budget.maxContextBytes = 512;
  const contextLimited = await value.rpc('investigations.create', tiny);
  assert.equal(contextLimited.status, 'paused'); assert.equal(contextLimited.pauseReason, 'context-byte-budget');
  const capsule = await value.raw('investigations.capsule', { id: contextLimited.id }); assert.equal(capsule.body.error.code, 'INVESTIGATION_CONTEXT_LIMIT');
  assert.equal(contextLimited.steps.length, 3); assert.equal(value.engine.vault!.read().receipts.length, 1);
  const rowLimited = plan(asOf); rowLimited.budget.maxReceiptRows = 0;
  const rowPlan = await value.rpc('investigations.create', rowLimited); assert.equal(rowPlan.status, 'open');
  const rowPause = await value.rpc('investigations.advance', { id: rowPlan.id, expectedRevision: rowPlan.revision });
  assert.equal(rowPause.status, 'paused'); assert.equal(rowPause.pauseReason, 'receipt-row-budget');
  assert.ok(rowPause.steps.every((step: any) => step.state === 'pending')); assert.equal(value.engine.vault!.read().receipts.length, 1);
  assert.equal(value.providerCalls(), 0);
});

test('paired HTTP private investigations enforce owner, source, current session and deletion gates', async t => {
  const value = await fixture(t), asOf = new Date().toISOString(), refs = await references(value, asOf);
  const owner = await value.rpc('investigations.create', plan(asOf, refs.hypotheses)), reader = await value.member();
  const privateRead = await value.raw('investigations.get', { id: owner.id }, reader.token);
  assert.equal(privateRead.body.error.code, 'INVESTIGATION_NOT_FOUND'); assert.equal(JSON.stringify(privateRead.body).includes('Why did collections'), false);
  assert.deepEqual(await value.rpc('investigations.list', {}, reader.token), []);
  const privatePage = await value.raw('investigations.drilldown', { id: owner.id, receiptId: refs.forReceipt.id, offset: 0, limit: 1 }, reader.token);
  assert.equal(privatePage.body.error.code, 'INVESTIGATION_NOT_FOUND'); assert.equal(JSON.stringify(privatePage.body).includes('15000'), false);
  const readerPlan = await value.rpc('investigations.create', plan(asOf), reader.token);
  assert.equal(readerPlan.ownerId, reader.member.id);
  await value.rpc('members.revoke', { id: reader.member.id });
  const revokedMember = await value.raw('investigations.resume', { id: readerPlan.id, expectedRevision: readerPlan.revision }, reader.token);
  assert.equal(revokedMember.status, 401); assert.equal(revokedMember.body.error.code, 'UNAUTHENTICATED');
  await value.rpc('trust.update', { allowedSources: ['another-explicit-source'] });
  const revokedSource = await value.raw('investigations.get', { id: owner.id }); assert.equal(revokedSource.body.error.code, 'SOURCE_REVOKED');
  const deniedAdvance = await value.raw('investigations.advance', { id: owner.id, expectedRevision: owner.revision }); assert.equal(deniedAdvance.body.error.code, 'SOURCE_REVOKED');
  await value.rpc('trust.update', { allowedSources: [sourceId] });
  await value.rpc('sources.delete', { id: sourceId });
  const erased = await value.raw('investigations.get', { id: owner.id }); assert.equal(erased.body.error.code, 'INVESTIGATION_NOT_FOUND');
  assert.deepEqual(await value.rpc('investigations.list'), []);
  assert.ok(!value.engine.vault!.read().answers.some((answer: any) => answer.kind === 'private-investigation-v1'));
  const erasedReceipt = await value.raw('receipts.get', { id: refs.forReceipt.id }); assert.equal(erasedReceipt.body.error.code, 'RECEIPT_NOT_FOUND');
  assert.equal(value.providerCalls(), 0);
});

test('paired HTTP pinned investigation rejects current dictionary and source changes instead of continuing obsolete evidence', async t => {
  const dictionaryValue = await fixture(t), asOf = new Date().toISOString();
  const beforeDictionary = await dictionaryValue.rpc('investigations.create', plan(asOf));
  const draft = structuredClone(dictionaryValue.draft); draft.definitions.find(item => item.name === 'received')!.meaning += ' Owner revised the explicit collection event rule.';
  const published = await dictionaryValue.rpc('ontology.publish', { draft }); assert.notEqual(published.hash, dictionaryValue.dictionary.hash);
  const definitionDenied = await dictionaryValue.raw('investigations.advance', { id: beforeDictionary.id, expectedRevision: beforeDictionary.revision });
  assert.equal(definitionDenied.body.error.code, 'INVESTIGATION_DEFINITION_CHANGED');
  assert.deepEqual(await dictionaryValue.rpc('investigations.list'), []); assert.equal(dictionaryValue.engine.vault!.read().receipts.length, 0);
  const sourceValue = await fixture(t), cut = new Date().toISOString();
  const beforeCorrection = await sourceValue.rpc('investigations.create', plan(cut));
  const changed = structuredClone(importInput); changed.content = changed.content.replace('300.00', '350.00'); changed.expectedTotals!.amountMinor = '170000';
  const corrected = await sourceValue.rpc('sources.import', changed); assert.equal(corrected.coverage.reconciled, true);
  const sourceDenied = await sourceValue.raw('investigations.advance', { id: beforeCorrection.id, expectedRevision: beforeCorrection.revision });
  assert.equal(sourceDenied.body.error.code, 'INVESTIGATION_SCOPE_CHANGED'); assert.equal(sourceValue.engine.vault!.read().receipts.length, 0);
  assert.equal(dictionaryValue.providerCalls(), 0); assert.equal(sourceValue.providerCalls(), 0);
});
