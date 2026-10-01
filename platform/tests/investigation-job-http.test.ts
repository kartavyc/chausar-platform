import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import type { Binding, ImportInput, MappingRecipe } from '../runtime/ingest.ts';
import type { DictionaryDraft } from '../runtime/ontology.ts';
import type { Investigation, InvestigationCreate } from '../runtime/investigations.ts';
import type { JobConfig } from '../runtime/jobs.ts';
import type { StepAttempt } from '../runtime/job-protocol.ts';

const passphrase = 'Synthetic private investigation job HTTP fixture passphrase';
const sourceId = 'synthetic-private-job-invoices-and-payments';
const july = { from: '2026-07-01', to: '2026-07-31' };
const august = { from: '2026-08-01', to: '2026-08-31' };
// Explicit synthetic host settings, not product spending or scheduling defaults.
// File encryption and exact capsule validation use real wall time; short-lease
// heartbeat and expiry regressions use a controllable trusted fixture clock.
const hostPolicy = { workerId: 'synthetic-investigation-http-worker', maxActiveJobs: 12,
  leaseMs: 10000, networkAvailable: () => false };
const importInput: ImportInput & { recipe: MappingRecipe } = {
  sourceId, format: 'csv',
  content: 'id,kind,date,amount,currency,branch,status,description\njuly-invoice,invoice,2026-07-02,500.00,INR,main,issued,Separate invoice evidence\njuly-payment,payment,2026-07-03,300.00,INR,main,settled,Literal July collections\naugust-invoice,invoice,2026-08-02,700.00,INR,main,issued,Retained counterevidence\naugust-payment,payment,2026-08-03,150.00,INR,main,settled,Literal August collections',
  recipe: {
    version: 1, id: 'synthetic-private-job-money', system: 'synthetic-csv', edition: '1',
    scope: { company: 'Synthetic Investigation Jobs', branches: ['main'] },
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
  const base = resolve(tmpdir()), directory = await mkdtemp(join(base, 'chausar-investigation-job-http-'));
  let providerCalls = 0;
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', durableJobs: hostPolicy,
    gateway: { http: async () => { providerCalls++; throw new Error('This saved local plan must not use a model provider.'); } } });
  const app = createLocalServer(engine), { origin, token } = await app.listen();
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  t.after(async () => {
    await app.close();
    const target = resolve(directory), child = relative(base, target);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && target.startsWith(join(base, 'chausar-investigation-job-http-')));
    await rm(target, { recursive: true, force: true });
  });
  const paired = await fetch(`${origin}/api/session`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(paired.status, 200); assert.deepEqual(await paired.json(), { token });
  async function raw(method: string, payload: unknown = {}, bearer = token) {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify({ method, payload }) });
    return { status: response.status, body: await response.json() as any };
  }
  async function rpc(method: string, payload: unknown = {}, bearer = token) {
    const result = await raw(method, payload, bearer);
    assert.equal(result.status, 200, `${method}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.error, undefined); return result.body.result;
  }
  async function refused(method: string, payload: unknown, code: string, bearer = token) {
    const result = await raw(method, payload, bearer);
    assert.notEqual(result.status, 200, `${method} must refuse ${code}`);
    assert.equal(result.body.result, undefined); assert.equal(result.body.error.code, code); return result;
  }
  await rpc('workspace.create', { name: 'Synthetic Investigation Jobs', passphrase, demo: false, pack: 'ecommerce' });
  const packs = await rpc('ontology.packs');
  const draft: DictionaryDraft = structuredClone(packs.find((pack: DictionaryDraft) => pack.pack === 'ecommerce'));
  assert.ok(draft);
  draft.definitions.find(item => item.name === 'received')!.meaning = 'Owner convention: separately reported settled payment amounts excluding tax, by settlement event date. These synthetic rows do not establish collection causes.';
  draft.definitions.find(item => item.name === 'billed')!.meaning = 'Owner convention: separately reported issued invoice amounts excluding tax, by invoice event date. Invoice value is not collected cash.';
  const dictionary = await rpc('ontology.publish', { draft });
  const imported = await rpc('sources.import', importInput);
  assert.equal(imported.coverage.reconciled, true); assert.equal(imported.rowIds.length, 4);
  await rpc('trust.update', { autonomy: true, send: 'nothing' });
  async function member() {
    const invitation = await rpc('auth.invite', { name: 'Synthetic other investigation owner', role: 'cofounder', branches: ['main'] });
    return rpc('auth.accept', { token: invitation.token });
  }
  return { engine, rpc, raw, refused, directory, dictionary, draft, imported, member,
    providerCalls: () => providerCalls };
}

function plan(asOf: string, hypotheses: InvestigationCreate['hypotheses'] = []): InvestigationCreate {
  return { objective: 'Measure July and August collections and retain August invoices as counterevidence; timing remains an owner guess.',
    branch: 'main', asOf, sourceIds: [sourceId],
    steps: [
      { id: 'july-collections', label: 'Measure settled July collections', request: { operation: 'received', period: july } },
      { id: 'august-collections', label: 'Measure settled August collections', request: { operation: 'received', period: august } },
      { id: 'august-invoices', label: 'Measure separately reported August invoice value', request: { operation: 'billed', period: august } },
    ], hypotheses, budget: { maxSteps: 3, maxReceiptRows: 100, maxContextBytes: 16384 } };
}

function config(investigation: Investigation, patch: Partial<JobConfig> = {}): JobConfig {
  return { type: 'private-investigation', goal: investigation.objective,
    input: { investigationId: investigation.id, expectedRevision: investigation.revision,
      steps: investigation.steps.filter(step => step.state === 'pending').map(step => ({ stepId: step.id, reserveMinor: '1', durationMs: 2000 })) },
    sourceIds: [...investigation.sourceIds], budgetMinor: '10', reserveMinor: '3',
    limits: { modelUnits: 0, durationMs: 10000, actionExposureMinor: '0' },
    stopRule: { maxRuns: 1, deadline: new Date(Date.now() + 300000).toISOString() },
    nextRunAt: new Date().toISOString(), intervalMs: 60000, graceMs: 0, catchup: 'latest',
    background: false, testedRoutes: [], allowedActions: [], requiresApproval: false, ...patch };
}

async function references(value: Awaited<ReturnType<typeof fixture>>, asOf: string) {
  const forReceipt = await value.rpc('calculation.run', { operation: 'received', period: august, asOf, branch: 'main' });
  const againstReceipt = await value.rpc('calculation.run', { operation: 'billed', period: august, asOf, branch: 'main' });
  assert.equal(forReceipt.totalMinor, '15000'); assert.equal(againstReceipt.totalMinor, '70000');
  return { forReceipt, againstReceipt, hypotheses: [{ id: 'owner-timing-guess',
    text: 'Owner guess: payment timing might explain the decrease. Higher invoice value does not establish that cause.',
    uncertainty: 'unresolved' as const, forReceiptIds: [forReceipt.id], againstReceiptIds: [againstReceipt.id] }] };
}

const operations = (value: Awaited<ReturnType<typeof fixture>>) => value.engine.vault!.read().answers.filter(item => item.kind === 'private-investigation-job-operation-v1');
const receipts = (value: Awaited<ReturnType<typeof fixture>>) => value.engine.vault!.read().receipts;
async function measuredDelivery(value: Awaited<ReturnType<typeof fixture>>, job: any, original: Investigation, bearer?: string) {
  assert.equal(job.status, 'awaiting-acceptance', JSON.stringify({ status: job.status,
    ledger: job.ledger?.map((item: { event: string; reason?: string }) => ({ event: item.event, reason: item.reason })),
    attempts: job.execution?.attempts.map((item: { status: string; reason?: string }) => ({ status: item.status, reason: item.reason })) }));
  assert.equal(job.deliverable.kind, 'private-investigation');
  const delivered = job.deliverable.result;
  assert.equal(delivered.kind, 'private-investigation-deliverable-v1'); assert.equal(delivered.investigationId, original.id);
  assert.equal(delivered.interpretation, 'measured-results-and-owner-hypotheses');
  const current = await value.rpc('investigations.get', { id: original.id }, bearer);
  assert.equal(current.status, 'complete'); assert.equal(current.planHash, original.planHash); assert.equal(current.scopeDigest, original.scopeDigest);
  assert.equal(current.asOf, original.asOf); assert.deepEqual(current.budget, original.budget);
  assert.equal(delivered.revision, current.revision);
  assert.deepEqual(delivered.capsule, await value.rpc('investigations.capsule', { id: original.id }, bearer));
  assert.equal(delivered.capsule.completeness, 'complete-persisted-plan');
  assert.deepEqual(delivered.capsule.pendingStepIds, []);
  assert.deepEqual(delivered.stepReceipts, current.steps.map((step: any) => ({ stepId: step.id, receiptId: step.receipt.receiptId })));
  assert.ok(Buffer.byteLength(JSON.stringify(delivered.capsule)) <= original.budget.maxContextBytes);
  for (const [index, expected] of ['30000', '15000', '70000'].entries()) {
    const id = current.steps[index].receipt.receiptId, receipt = await value.rpc('receipts.get', { id }, bearer);
    assert.equal(receipt.totalMinor, expected); assert.equal(receipt.asOf, original.asOf);
    assert.equal(receipt.dictionaryHash, value.dictionary.hash); assert.equal(receipt.databaseProof, undefined);
    assert.deepEqual(receipt.sourceIds, [sourceId]); assert.equal(receipt.branch, 'main');
    assert.deepEqual(receipt.period, original.steps[index].request.period);
    assert.ok(receipt.rowIds.length > 0 && receipt.rowIds.every((rowId: string) => value.imported.rowIds.includes(rowId)));
    assert.equal(receipts(value).filter(item => item.id === id).length, 1);
  }
  assert.ok(job.execution.attempts.every((attempt: any) => attempt.status === 'verified' && attempt.settlement === undefined));
  assert.equal(job.spentMinor, '0'); assert.equal(job.reservedMinor, '0');
  assert.equal(job.execution.meters.modelUnits, 0); assert.equal(job.execution.meters.actionExposureMinor, '0');
  assert.equal(value.providerCalls(), 0); assert.equal(value.engine.vault!.read().modelReceipts.length, 0);
  return current;
}

test('paired HTTP investigation job recovers lost settlement through encrypted reopen without duplicate receipts or guessed causes', async t => {
  const value = await fixture(t), asOf = new Date().toISOString(), refs = await references(value, asOf);
  const investigation = await value.rpc('investigations.create', plan(asOf, refs.hypotheses));
  const types = await value.rpc('jobs.types'); assert.equal(types.configured, true); assert.ok(types.types.includes('private-investigation'));
  const mandate = config(investigation), job = await value.rpc('jobs.create', mandate);
  for (const key of ['investigationId', 'expectedRevision', 'steps']) assert.deepEqual(job.input[key], (mandate.input as any)[key]);
  const binding = job.input.binding;
  assert.equal(binding.version, 1); assert.equal(binding.investigationId, investigation.id); assert.equal(binding.revision, investigation.revision);
  assert.equal(binding.ownerId, investigation.ownerId); assert.equal(binding.epoch, investigation.epoch); assert.equal(binding.role, 'owner');
  assert.equal(binding.planHash, investigation.planHash); assert.equal(binding.scopeDigest, investigation.scopeDigest);
  assert.equal(binding.dictionaryHash, investigation.dictionaryHash); assert.equal(binding.asOf, investigation.asOf);
  assert.match(binding.basisHash, /^[a-f0-9]{64}$/); assert.deepEqual(binding.sourceIds, investigation.sourceIds);
  assert.deepEqual(binding.rowIds, investigation.rowIds); assert.deepEqual(binding.initialReceiptPins, investigation.receiptPins);
  assert.deepEqual(binding.completedPrefix, []); assert.deepEqual(binding.pendingStepIds, investigation.steps.map((step: any) => step.id));
  assert.deepEqual(job.sourceIds, mandate.sourceIds);
  assert.deepEqual(job.limits, mandate.limits); assert.deepEqual(job.stopRule, mandate.stopRule);
  assert.deepEqual((await value.rpc('jobs.progress', { id: job.id })).remainingStepIds,
    ['investigation-step-1', 'investigation-step-2', 'investigation-step-3']);
  const vault = value.engine.vault!, update = vault.update.bind(vault); let loseSettlement = true;
  // Existing trusted host fixture seam: lose the runner's first settlement commit.
  // The real adapter has already committed the measured receipt and plan progress.
  vault.update = change => update(async state => {
    const result = await change(state);
    if (loseSettlement && state.jobs.some(item => item.id === job.id && item.execution?.attempts.some((attempt: StepAttempt) => attempt.status === 'verified'))) {
      loseSettlement = false; throw new Error('Labelled synthetic private-job settlement commit loss');
    }
    return result;
  });
  const unknown = await value.rpc('jobs.run', { id: job.id });
  assert.equal(loseSettlement, false); assert.equal(unknown.status, 'outcome-unknown'); assert.equal(unknown.reservedMinor, '3');
  assert.equal(unknown.deliverable, undefined); assert.equal(unknown.execution.attempts.length, 1);
  const first = await value.rpc('investigations.get', { id: investigation.id });
  assert.deepEqual(first.steps.map((step: any) => step.state), ['completed', 'pending', 'pending']);
  const firstReceiptId = first.steps[0].receipt.receiptId;
  assert.equal((await value.rpc('receipts.get', { id: firstReceiptId })).totalMinor, '30000');
  assert.equal(operations(value).length, 1); assert.equal(operations(value)[0].key, unknown.execution.attempts[0].key);
  assert.equal(operations(value)[0].outcome, 'completed'); assert.equal(receipts(value).length, 3);
  assert.equal((await value.rpc('jobs.run', { id: job.id })).status, 'outcome-unknown');
  assert.equal(receipts(value).length, 3); assert.equal(operations(value).length, 1);
  await value.rpc('workspace.lock'); await value.rpc('workspace.open', { folder: 'main', passphrase });
  assert.deepEqual(await value.rpc('investigations.get', { id: investigation.id }), first);
  const reconciled = await value.rpc('jobs.reconcile', { id: job.id });
  assert.equal(reconciled.reservedMinor, '0'); assert.equal(reconciled.execution.attempts[0].status, 'verified');
  assert.ok(reconciled.execution.attempts[0].reconciliationId);
  const delivered = await value.rpc('jobs.run', { id: job.id });
  const completed = await measuredDelivery(value, delivered, investigation);
  assert.equal(completed.steps[0].receipt.receiptId, firstReceiptId);
  assert.equal(delivered.execution.attempts.length, 3); assert.equal(operations(value).length, 3); assert.equal(receipts(value).length, 5);
  assert.equal(new Set(operations(value).map(item => item.key)).size, 3);
  assert.equal(delivered.deliverable.result.capsule.hypotheses[0].uncertainty, 'unresolved');
  assert.equal(delivered.deliverable.result.capsule.hypotheses[0].causalStatus, 'not-established-cause');
  assert.deepEqual(delivered.deliverable.result.capsule.hypotheses[0].forReceiptIds, [refs.forReceipt.id]);
  assert.deepEqual(delivered.deliverable.result.capsule.hypotheses[0].againstReceiptIds, [refs.againstReceipt.id]);
  const page = await value.rpc('investigations.drilldown', { id: investigation.id, receiptId: firstReceiptId, offset: 0, limit: 1 });
  assert.equal(page.rows[0].amountMinor, '30000'); assert.ok(value.imported.rowIds.includes(page.rows[0].factId));
  assert.equal((await value.rpc('jobs.run', { id: job.id })).status, 'awaiting-acceptance');
  assert.equal((await value.rpc('jobs.accept', { id: job.id })).status, 'accepted');
  assert.equal((await value.rpc('jobs.run', { id: job.id })).status, 'accepted');
  assert.equal(receipts(value).length, 5); assert.equal(operations(value).length, 3); assert.equal(value.providerCalls(), 0);
});

test('paired HTTP job retains a completed prefix and distinct authored cuts without expanding the saved plan to extra mandate sources', async t => {
  const value = await fixture(t), other = structuredClone(importInput);
  other.sourceId = 'synthetic-other-branch'; other.content = other.content.replaceAll(',main,', ',elsewhere,');
  other.recipe.scope.branches = ['elsewhere']; await value.rpc('sources.import', other);
  const firstCut = new Date().toISOString();
  const original = await value.rpc('investigations.create', plan(firstCut));
  const prefix = await value.rpc('investigations.advance', { id: original.id, expectedRevision: original.revision });
  const firstReceiptId = prefix.steps[0].receipt.receiptId;
  const job = await value.rpc('jobs.create', config(prefix, { sourceIds: [sourceId, other.sourceId] }));
  const continued = await value.rpc('jobs.run', { id: job.id });
  const completed = await measuredDelivery(value, continued, prefix);
  assert.equal(completed.steps[0].receipt.receiptId, firstReceiptId); assert.equal(continued.execution.attempts.length, 2);
  await new Promise(resolve => setTimeout(resolve, 2));
  const secondCut = new Date().toISOString(); assert.notEqual(secondCut, firstCut);
  const uncut = await value.rpc('investigations.create', plan(secondCut));
  const uncutJob = await value.rpc('jobs.create', config(uncut));
  const uncutDone = await measuredDelivery(value, await value.rpc('jobs.run', { id: uncutJob.id }), uncut);
  for (let index = 0; index < 3; index++) {
    const left = await value.rpc('receipts.get', { id: completed.steps[index].receipt.receiptId });
    const right = await value.rpc('receipts.get', { id: uncutDone.steps[index].receipt.receiptId });
    for (const key of ['operation', 'totalMinor', 'figures', 'dictionaryHash', 'period', 'branch', 'rowIds', 'rows', 'coverage']) assert.deepEqual(left[key], right[key]);
    assert.equal(left.asOf, firstCut); assert.equal(right.asOf, secondCut);
  }
  assert.equal(receipts(value).length, 6); assert.equal(operations(value).length, 5);
  assert.equal((await value.rpc('jobs.accept', { id: job.id })).status, 'accepted');
  assert.equal((await value.rpc('jobs.accept', { id: uncutJob.id })).status, 'accepted');
  assert.equal(value.providerCalls(), 0);
});

test('paired HTTP admission requires the exact saved remaining steps, revision and full source roots', async t => {
  const value = await fixture(t), investigation = await value.rpc('investigations.create', plan(new Date().toISOString()));
  const mandate = config(investigation), input = mandate.input as { investigationId: string; expectedRevision: number; steps: any[] };
  for (const steps of [input.steps.slice(1), [...input.steps].reverse(), [input.steps[0], input.steps[0], input.steps[2]],
    [{ ...input.steps[0], stepId: 'unpublished-step' }, ...input.steps.slice(1)]]) {
    await value.refused('jobs.create', { ...mandate, input: { ...input, steps } }, 'INVALID_INVESTIGATION_JOB');
  }
  await value.refused('jobs.create', { ...mandate, input: { ...input, steps: input.steps.map(step => ({ ...step, request: { operation: 'billed' } })) } }, 'INVALID_INVESTIGATION_JOB');
  await value.refused('jobs.create', { ...mandate, sourceIds: [] }, 'JOB_SOURCE_SCOPE');
  await value.refused('jobs.create', { ...mandate, input: { ...input, expectedRevision: investigation.revision + 1 } }, 'INVESTIGATION_REVISION_CONFLICT');
  assert.deepEqual(await value.rpc('jobs.list'), []); assert.equal(receipts(value).length, 0); assert.equal(operations(value).length, 0);
  assert.deepEqual((await value.rpc('investigations.get', { id: investigation.id })).steps.map((step: any) => step.state), ['pending', 'pending', 'pending']);
  assert.equal(value.providerCalls(), 0);
});

test('paired HTTP owner and live session gates protect job input, progress and acceptance', async t => {
  const value = await fixture(t), investigator = await value.member();
  const ownerPlan = await value.rpc('investigations.create', plan(new Date().toISOString()));
  await value.refused('jobs.create', config(ownerPlan), 'INVESTIGATION_NOT_FOUND', investigator.token);
  const ownerJob = await value.rpc('jobs.create', config(ownerPlan));
  await value.refused('jobs.run', { id: ownerJob.id }, 'JOB_OWNER_REQUIRED', investigator.token);
  await value.refused('jobs.progress', { id: ownerJob.id }, 'JOB_OWNER_REQUIRED', investigator.token);
  assert.deepEqual(await value.rpc('jobs.list', {}, investigator.token), []);
  const delivered = await value.rpc('jobs.run', { id: ownerJob.id }); await measuredDelivery(value, delivered, ownerPlan);
  await value.refused('jobs.accept', { id: ownerJob.id }, 'JOB_OWNER_REQUIRED', investigator.token);
  const privatePlan = await value.rpc('investigations.create', plan(new Date().toISOString()), investigator.token);
  const privateJob = await value.rpc('jobs.create', config(privatePlan), investigator.token);
  assert.equal(privateJob.ownerId, investigator.member.id);
  await value.refused('jobs.run', { id: privateJob.id }, 'JOB_OWNER_REQUIRED');
  assert.equal((await value.rpc('jobs.list')).some((item: any) => item.id === privateJob.id), false);
  await value.rpc('members.revoke', { id: investigator.member.id });
  const revoked = await value.refused('jobs.run', { id: privateJob.id }, 'UNAUTHENTICATED', investigator.token);
  assert.equal(revoked.status, 401); assert.equal(receipts(value).length, 3);
  assert.equal((await value.rpc('jobs.accept', { id: ownerJob.id })).status, 'accepted'); assert.equal(value.providerCalls(), 0);
});

test('paired HTTP source revocation gates dispatch and acceptance, while deletion removes job, plan, operation and receipt roots', async t => {
  const value = await fixture(t), investigation = await value.rpc('investigations.create', plan(new Date().toISOString()));
  const job = await value.rpc('jobs.create', config(investigation));
  await value.rpc('trust.update', { allowedSources: ['another-explicit-source'] });
  await value.refused('jobs.run', { id: job.id }, 'SOURCE_REVOKED');
  assert.deepEqual(await value.rpc('jobs.list'), []); assert.equal(receipts(value).length, 0);
  await value.rpc('trust.update', { allowedSources: [sourceId] });
  const delivered = await value.rpc('jobs.run', { id: job.id }); await measuredDelivery(value, delivered, investigation);
  const receiptId = delivered.deliverable.result.stepReceipts[0].receiptId;
  await value.rpc('trust.update', { allowedSources: ['another-explicit-source'] });
  await value.refused('jobs.accept', { id: job.id }, 'SOURCE_REVOKED'); assert.deepEqual(await value.rpc('jobs.list'), []);
  await value.rpc('trust.update', { allowedSources: [sourceId] });
  assert.equal((await value.rpc('jobs.accept', { id: job.id })).status, 'accepted');
  await value.rpc('sources.delete', { id: sourceId });
  await value.refused('jobs.progress', { id: job.id }, 'NOT_FOUND');
  await value.refused('investigations.get', { id: investigation.id }, 'INVESTIGATION_NOT_FOUND');
  await value.refused('receipts.get', { id: receiptId }, 'RECEIPT_NOT_FOUND');
  assert.deepEqual(await value.rpc('jobs.list'), []); assert.deepEqual(await value.rpc('investigations.list'), []);
  assert.equal(receipts(value).length, 0); assert.equal(operations(value).length, 0); assert.equal(value.providerCalls(), 0);
});

test('paired HTTP current dictionary drift refuses both pending execution and delivered result acceptance', async t => {
  for (const phase of ['before-dispatch', 'before-acceptance']) {
    const value = await fixture(t), investigation = await value.rpc('investigations.create', plan(new Date().toISOString()));
    const job = await value.rpc('jobs.create', config(investigation));
    if (phase === 'before-acceptance') await measuredDelivery(value, await value.rpc('jobs.run', { id: job.id }), investigation);
    const revised = structuredClone(value.draft); revised.definitions.find(item => item.name === 'received')!.meaning += ' Owner revised the collection event convention.';
    assert.notEqual((await value.rpc('ontology.publish', { draft: revised })).hash, value.dictionary.hash);
    if (phase === 'before-dispatch') {
      const blocked = await value.rpc('jobs.run', { id: job.id }); assert.equal(blocked.status, 'runner-blocked');
      assert.ok(blocked.ledger.some((item: any) => item.reason === 'INVESTIGATION_DEFINITION_CHANGED'));
      assert.equal(blocked.execution.attempts.length, 0); assert.equal(receipts(value).length, 0);
    } else {
      await value.refused('jobs.accept', { id: job.id }, 'JOB_EVIDENCE_REVOKED');
      assert.equal((await value.rpc('jobs.list'))[0].deliverable, undefined); assert.equal(receipts(value).length, 3);
    }
    assert.equal(value.providerCalls(), 0);
  }
});

test('paired HTTP source correction and authored revision drift cannot silently change an admitted investigation job', async t => {
  for (const change of ['source-correction', 'plan-revision']) {
    const value = await fixture(t), investigation = await value.rpc('investigations.create', plan(new Date().toISOString()));
    const job = await value.rpc('jobs.create', config(investigation));
    if (change === 'source-correction') {
      const corrected = structuredClone(importInput); corrected.content = corrected.content.replace('300.00', '350.00'); corrected.expectedTotals!.amountMinor = '170000';
      assert.equal((await value.rpc('sources.import', corrected)).coverage.reconciled, true);
    } else {
      await value.rpc('investigations.revise', { id: investigation.id, expectedRevision: investigation.revision,
        reason: 'Owner changes the investigation objective after the job was admitted', objective: 'A separately revised objective requires a newly reviewed job.' });
    }
    const blocked = await value.rpc('jobs.run', { id: job.id }); assert.equal(blocked.status, 'runner-blocked');
    const code = change === 'source-correction' ? 'INVESTIGATION_SCOPE_CHANGED' : 'INVESTIGATION_JOB_CHANGED';
    assert.ok(blocked.ledger.some((item: any) => item.reason === code)); assert.equal(blocked.deliverable, undefined);
    assert.equal(blocked.execution.attempts.length, 0); assert.equal(receipts(value).length, 0); assert.equal(operations(value).length, 0);
    assert.equal(value.providerCalls(), 0);
  }
});

test('paired HTTP explicit investigation budgets retain pending work and readback confirms a known block without success or replay', async t => {
  const value = await fixture(t), asOf = new Date().toISOString();
  for (const budget of [{ ...plan(asOf).budget, maxSteps: 1 }, { ...plan(asOf).budget, maxContextBytes: 512 }]) {
    const paused = await value.rpc('investigations.create', { ...plan(asOf), budget }); assert.equal(paused.status, 'paused');
    await value.refused('jobs.create', config(paused), 'INVESTIGATION_NOT_OPEN');
  }
  const limited = await value.rpc('investigations.create', { ...plan(asOf), budget: { ...plan(asOf).budget, maxReceiptRows: 0 } });
  assert.equal(limited.status, 'open'); const job = await value.rpc('jobs.create', config(limited));
  const unknown = await value.rpc('jobs.run', { id: job.id }); assert.equal(unknown.status, 'outcome-unknown');
  assert.equal(unknown.deliverable, undefined); assert.equal(unknown.reservedMinor, '3');
  const paused = await value.rpc('investigations.get', { id: limited.id });
  assert.equal(paused.status, 'paused'); assert.equal(paused.pauseReason, 'receipt-row-budget');
  assert.ok(paused.steps.every((step: any) => step.state === 'pending' && step.receipt === undefined));
  assert.equal(receipts(value).length, 0); assert.equal(operations(value).length, 1); assert.equal(operations(value)[0].outcome, 'blocked');
  const reconciled = await value.rpc('jobs.reconcile', { id: job.id }); assert.equal(reconciled.status, 'paused');
  assert.equal(reconciled.reservedMinor, '0'); assert.equal(reconciled.spentMinor, '0');
  assert.equal(reconciled.execution.attempts[0].status, 'blocked'); assert.equal(reconciled.deliverable, undefined);
  assert.ok(reconciled.ledger.some((item: any) => item.event === 'step-blocked' && item.reason === 'receipt-row-budget'));
  assert.equal((await value.rpc('jobs.run', { id: job.id })).status, 'paused');
  await value.refused('jobs.accept', { id: job.id }, 'JOB_EVIDENCE_REVOKED');
  const capsule = await value.rpc('investigations.capsule', { id: limited.id });
  assert.equal(capsule.status, 'paused'); assert.deepEqual(capsule.completedStepIds, []);
  assert.deepEqual(capsule.pendingStepIds, ['july-collections', 'august-collections', 'august-invoices']); assert.deepEqual(capsule.measurements, []);
  assert.equal((await value.rpc('jobs.cancel', { id: job.id })).status, 'cancelled');
  assert.equal(receipts(value).length, 0); assert.equal(operations(value).length, 1); assert.equal(value.providerCalls(), 0);
});

test('paired HTTP explicit job or investigation cancellation produces no measurement or completed-plan deliverable', async t => {
  const value = await fixture(t), asOf = new Date().toISOString();
  const planCancelledByOwner = await value.rpc('investigations.create', plan(asOf));
  const first = await value.rpc('jobs.create', config(planCancelledByOwner));
  await value.rpc('investigations.cancel', { id: planCancelledByOwner.id, expectedRevision: planCancelledByOwner.revision });
  const blocked = await value.rpc('jobs.run', { id: first.id });
  assert.equal(blocked.status, 'runner-blocked'); assert.equal(blocked.deliverable, undefined); assert.equal(blocked.execution.attempts.length, 0);
  const planWithCancelledJob = await value.rpc('investigations.create', plan(asOf));
  const second = await value.rpc('jobs.create', config(planWithCancelledJob));
  assert.equal((await value.rpc('jobs.cancel', { id: second.id })).status, 'cancelled');
  const cancelled = await value.rpc('jobs.run', { id: second.id }); assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.deliverable, undefined);
  const unchanged = await value.rpc('investigations.get', { id: planWithCancelledJob.id });
  assert.equal(unchanged.status, 'open'); assert.equal(unchanged.revision, planWithCancelledJob.revision);
  assert.ok(unchanged.steps.every((step: any) => step.state === 'pending'));
  assert.equal(receipts(value).length, 0); assert.equal(operations(value).length, 0); assert.equal(value.providerCalls(), 0);
});
