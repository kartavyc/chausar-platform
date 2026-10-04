import test from 'node:test';
import assert from 'node:assert/strict';
import { audit, type Context, type StateStore } from '../runtime/contracts.ts';
import { ActionService, digest, type Connector } from '../runtime/actions.ts';
import { CalculatorService, type CalculatorOptions } from '../runtime/calculator.ts';
import { IntlCalendarRules } from '../runtime/calendar-zone.ts';
import { Engine } from '../runtime/engine.ts';
import { EngineConnectorService } from '../runtime/engine-connectors.ts';
import { createEngineJobRunner } from '../runtime/engine-jobs.ts';
import { ImportService, type ImportInput, type MappingRecipe } from '../runtime/ingest.ts';
import type { JournalContent } from '../runtime/decision-journal.ts';
import { createJournalExecutionResolver } from '../runtime/journal-execution.ts';
import { JobService, type JobConfig } from '../runtime/jobs.ts';
import { LearningService } from '../runtime/learning.ts';
import { MemoryService } from '../runtime/memory.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { ReportService } from '../runtime/reports.ts';
import { TodayEventsService, type TodayDayEvent, type TodayEventsRequest } from '../runtime/today-events.ts';
import { TrustService } from '../runtime/trust.ts';
import { ConnectorCapabilityRegistry, type ConnectorOperationScope } from '../runtime/connector-framework/registry.ts';
import { CursorImportService, type QualifiedDecoder } from '../runtime/connector-framework/import.ts';
import { FixtureStateStore } from './database-fixtures.ts';

// Source-service integration over explicitly synthetic CSV and in-memory custody.
// This does not execute Engine registration, a provider, native SQL, or the UI,
// and establishes neither database durability nor external qualification.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const accountant: Context = { memberId: 'accountant', role: 'accountant', epoch: 1, channel: 'desktop' };
const otherOwner: Context = { memberId: 'other-owner', role: 'owner', epoch: 1, channel: 'desktop' };
const period = { from: '2026-09-01', to: '2026-09-30' };
const sourceId = 'today-synthetic-invoices';
const privateText = 'PRIVATE_SYNTHETIC_SOURCE_DESCRIPTION_DO_NOT_RELEASE';

function input(source = sourceId, branch = 'main', entity = 'invoice-one'): ImportInput {
  const recipe: MappingRecipe = {
    version: 1, id: 'today-synthetic-csv-v1', system: 'synthetic-file', edition: 'fixture',
    scope: { company: 'Synthetic Today service shop', branches: [branch] },
    bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
      { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
      ...['currency', 'branch', 'status', 'invoiceId', 'description'].map(name => ({
        target: name, source: name, type: 'string' as const, nulls: 'reject' as const,
      })),
    ], allowedKinds: ['invoice'], allowedStatuses: ['unpaid'], onUnmapped: 'reject',
  };
  return {
    sourceId: source, format: 'csv', recipe,
    content: `id,kind,date,amount,currency,branch,status,invoiceId,description\n${entity},invoice,2026-09-02,123.45,INR,${branch},unpaid,${entity},${privateText}\n`,
    expectedTotals: { rowCount: 1, amountMinor: '12345' },
  };
}

function dayRequest(): TodayEventsRequest {
  return { date: new Date().toISOString().slice(0, 10), timeZone: 'Etc/UTC' };
}

async function fixture() {
  const store = new FixtureStateStore();
  const ontology = new OntologyService(store), imports = new ImportService(store), trust = new TrustService(store);
  await ontology.publish(owner, 'retail');
  await trust.addMember(owner, { id: accountant.memberId, name: 'Synthetic restricted accountant', role: accountant.role, branches: ['main'] });
  await trust.addMember(owner, { id: otherOwner.memberId, name: 'Synthetic second owner', role: otherOwner.role, branches: ['*'] });
  const connectors = new EngineConnectorService(store);
  const guards: CalculatorOptions = {
    consumerGuard: (ctx, request) => connectors.assertCalculationReady(ctx, request),
    receiptGuard: (ctx, receipt) => connectors.assertReceiptReady(ctx, receipt),
  };
  const calculator = new CalculatorService(store, guards), learning = new LearningService(store);
  // The shipped local registry has no exported factory. Invoke the exact source
  // factory with a narrow test-only view, avoiding a copied or permissive adapter.
  const factory = Engine.prototype as unknown as { builtinActions(store: StateStore): Connector[] };
  const actions = new ActionService(store, factory.builtinActions(store));
  const reports = new ReportService(store, { ...guards, executionReceipt: createJournalExecutionResolver(actions) });
  let runner!: ReturnType<typeof createEngineJobRunner>;
  const jobs = new JobService(store, { deliverableGuard: (ctx, job) => runner.canRelease(ctx, job) });
  runner = createEngineJobRunner(store, jobs, actions, guards, {
    workerId: 'today-source-service-test', maxActiveJobs: 4, leaseMs: 1000, networkAvailable: () => false,
  });
  const rules = new IntlCalendarRules({ timeZones: ['Etc/UTC'], minYear: 2026, maxYear: 2026, maxCachedLocalTimes: 0 });
  const today = new TodayEventsService({ store, rules, services: { learning, calculator, actions, reports, jobs } });
  return { store, ontology, imports, trust, connectors, calculator, learning, actions, reports, jobs, runner, today };
}

function evidenceJob(receiptId: string, sources = [sourceId]): Omit<JobConfig, 'plan'> & { type: 'evidence-review' } {
  return {
    type: 'evidence-review', goal: 'Review the explicitly supplied synthetic invoice receipt',
    input: { records: [{ id: 'invoice-proof', input: { receiptId }, reserveMinor: '1', durationMs: 2000 }] },
    sourceIds: sources, budgetMinor: '10', reserveMinor: '2',
    limits: { modelUnits: 0, durationMs: 10000, actionExposureMinor: '0' },
    stopRule: { maxRuns: 1, deadline: new Date(Date.now() + 60000).toISOString() },
    nextRunAt: new Date().toISOString(), intervalMs: 60000, graceMs: 60000, catchup: 'latest',
    background: false, testedRoutes: [], allowedActions: [], requiresApproval: false,
  };
}

async function sixFamilies() {
  const f = await fixture();
  const imported = await f.imports.commit(owner, input());
  await assert.rejects(f.imports.commit(owner, { ...input('today-refused-file'), expectedTotals: { rowCount: 1, amountMinor: '12344' } }), { code: 'IMPORT_REFUSED' });
  const receipt = await f.calculator.calculate(owner, { operation: 'billed', period, sourceIds: [sourceId] });
  const action = await f.actions.prepare(owner, {
    connector: 'local', operation: 'reminder-draft', payload: { invoiceId: 'invoice-one', text: privateText },
    idempotencyKey: 'today-local-reminder-draft', sourceIds: [sourceId],
  });
  const decision = await f.reports.decision(owner, {
    text: privateText, reviewDate: '2026-10-15', receiptIds: [receipt.id], branch: 'main',
  });
  await f.trust.updatePolicy(owner, { autonomy: true });
  const job = await f.runner.create(owner, evidenceJob(receipt.id));
  const delivered = await f.runner.run(owner, job.id);
  assert.equal(delivered.status, 'awaiting-acceptance');
  assert.ok(Object.hasOwn(delivered, 'deliverable'));
  assert.equal(f.runner.canRelease(owner, f.jobs.find(f.store.read(), job.id)), true);
  return { ...f, imported, receipt, action, decision, job, delivered };
}

function eventId(f: Awaited<ReturnType<typeof fixture>>, kind: string, key?: string, value?: string): string {
  const candidates = f.store.read().activity.filter(item => item.event === kind && (!key || item.details[key] === value));
  assert.equal(candidates.length, 1, `One real ${kind} audit entry must exist.`);
  return candidates[0].id;
}

function hasReference(events: readonly TodayDayEvent[], referenceId: string): boolean {
  return events.some(event => Object.values(event.reference).includes(referenceId));
}

test('Today projects all six families produced by real source services without raw data or read side effects', async () => {
  const f = await sixFamilies(), request = dayRequest();
  assert.equal(f.receipt.valueMinor, '12345');
  assert.equal(f.receipt.coverage.completeness, 'reconciled-imports');
  const before = f.store.read(), projection = f.today.day(owner, request);
  assert.equal(projection.total, 6);
  assert.deepEqual([...new Set(projection.events.map(event => event.kind))].sort(), [
    'action.prepared', 'calculation.completed', 'decision.created', 'job.delivered', 'source.import-refused', 'source.imported',
  ]);
  assert.deepEqual(projection.events.find(event => event.kind === 'source.imported')?.actor, { kind: 'member', memberId: owner.memberId });
  assert.deepEqual(projection.events.find(event => event.kind === 'job.delivered')?.actor, { kind: 'not-recorded' });
  assert.ok(projection.state.reasonCodes.includes('ACTOR_NOT_RECORDED'));
  assert.equal(projection.state.kind, 'partial');
  const serialized = JSON.stringify(projection);
  for (const forbidden of [privateText, 'retainedInput', 'businessSuccess', 'rawError', 'payload', 'explanation']) assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.deepEqual(f.today.day(owner, request), projection);
  assert.deepEqual(f.today.release(owner, projection), projection);
  assert.deepEqual(f.store.read(), before, 'Repeated display reads create no business event or record.');
  for (const event of projection.events) assert.deepEqual(f.today.resolveReference(owner, { ...request, eventId: event.id }), event.reference);
  const count = f.store.read().activity.length;
  assert.equal((await f.imports.commit(owner, input())).duplicate, true);
  assert.equal(f.store.read().activity.length, count, 'An exact repeat import adds no activity.');
});

test('real branch and receipt ownership resolvers filter before counting and reference release', async () => {
  const f = await fixture(), request = dayRequest();
  await f.imports.commit(accountant, input('accountant-main', 'main', 'own-invoice'));
  await f.imports.commit(owner, input('owner-south', 'south', 'hidden-invoice'));
  const own = await f.calculator.calculate(accountant, { operation: 'billed', period, sourceIds: ['accountant-main'] });
  const sharedSourcePrivateReceipt = await f.calculator.calculate(owner, { operation: 'billed', period, sourceIds: ['accountant-main'] });
  const hidden = await f.calculator.calculate(owner, { operation: 'billed', period, sourceIds: ['owner-south'] });
  const scoped = f.today.day(accountant, request);
  assert.equal(scoped.total, 2);
  assert.equal(hasReference(scoped.events, own.id), true);
  assert.equal(hasReference(scoped.events, sharedSourcePrivateReceipt.id), false);
  assert.equal(hasReference(scoped.events, hidden.id), false);
  assert.equal(JSON.stringify(scoped).includes('owner-south'), false);
  assert.equal(JSON.stringify(scoped).includes('hidden-invoice'), false);
  for (const receipt of [sharedSourcePrivateReceipt, hidden]) {
    assert.throws(() => f.today.resolveReference(accountant, { ...request, eventId: eventId(f, 'calculation.completed', 'receiptId', receipt.id) }), { code: 'TODAY_EVENT_REFERENCE_UNAVAILABLE' });
  }
  assert.throws(() => f.calculator.receipt(otherOwner, sharedSourcePrivateReceipt.id), { code: 'RECEIPT_FORBIDDEN' });
  const secondOwner = f.today.day(otherOwner, request);
  assert.equal(secondOwner.total, 2, 'Even an unrestricted second owner sees imports but no other author private receipts.');
  assert.equal(hasReference(secondOwner.events, sharedSourcePrivateReceipt.id), false);
});

test('source grant revocation and source deletion reauthorize authentic held projections and references', async () => {
  const f = await sixFamilies(), request = dayRequest(), held = f.today.day(owner, request);
  const receiptEventId = eventId(f, 'calculation.completed', 'receiptId', f.receipt.id);
  await f.trust.grantSource(owner, { sourceId, allow: false });
  const revoked = f.today.release(owner, held);
  assert.equal(revoked.total, 1, 'Only the separately authorized refusal remains.');
  for (const target of [sourceId, f.receipt.id, f.action.id, f.decision.id, f.job.id]) assert.equal(JSON.stringify(revoked.events).includes(target), false);
  assert.throws(() => f.today.resolveReference(owner, { ...request, eventId: receiptEventId }), { code: 'TODAY_EVENT_REFERENCE_UNAVAILABLE' });
  assert.equal(held.total, 6, 'The authentic held value remains an immutable historical projection.');
  await f.trust.grantSource(owner, { sourceId, allow: true });
  await f.trust.deleteSource(owner, sourceId);
  const deleted = f.today.release(owner, held);
  assert.equal(deleted.total, 1);
  assert.equal(f.store.read().receipts.some(item => item.id === f.receipt.id), false);
  assert.equal(f.store.read().actions.some(item => item.id === f.action.id), false);
  assert.equal(f.store.read().jobs.some(item => item.id === f.job.id), false);
  assert.throws(() => f.today.resolveReference(owner, { ...request, eventId: receiptEventId }), { code: 'TODAY_EVENT_REFERENCE_UNAVAILABLE' });
});

test('real member epoch revocation rejects a previously held read and all reference release', async () => {
  const f = await fixture(), request = dayRequest();
  await f.imports.commit(accountant, input('accountant-main'));
  const receipt = await f.calculator.calculate(accountant, { operation: 'billed', period, sourceIds: ['accountant-main'] });
  const held = f.today.day(accountant, request), receiptEventId = eventId(f, 'calculation.completed', 'receiptId', receipt.id);
  await f.trust.revokeMember(owner, accountant.memberId);
  assert.throws(() => f.today.day(accountant, request), { code: 'ACCESS_REVOKED' });
  assert.throws(() => f.today.release(accountant, held), { code: 'ACCESS_REVOKED' });
  assert.throws(() => f.today.resolveReference(accountant, { ...request, eventId: receiptEventId }), { code: 'ACCESS_REVOKED' });
  assert.equal(f.today.day(otherOwner, request).total, 0, 'The real learning authority removes a revoked author import; receipts stay private.');
});

test('real durable job release hides stale delivery evidence while retained calculation history stays labelled', async () => {
  const f = await sixFamilies(), request = dayRequest(), held = f.today.day(owner, request);
  const jobEventId = eventId(f, 'job.delivered', 'jobId', f.job.id);
  await new MemoryService(f.store).setSourcePrecedence(owner, 'invoice', [sourceId]);
  assert.equal(f.calculator.receipt(owner, f.receipt.id).stale, true);
  assert.equal(f.runner.canRelease(owner, f.jobs.find(f.store.read(), f.job.id)), false);
  assert.equal(Object.hasOwn(f.jobs.list(owner).find(job => job.id === f.job.id)!, 'deliverable'), false);
  const current = f.today.release(owner, held);
  assert.equal(current.total, 5);
  assert.equal(current.events.some(event => event.kind === 'job.delivered'), false);
  const calculation = current.events.find(event => event.kind === 'calculation.completed');
  assert.ok(calculation?.kind === 'calculation.completed');
  assert.equal(calculation.args.stale, true);
  assert.ok(current.state.reasonCodes.includes('EVENT_EVIDENCE_UNRESOLVED'));
  assert.throws(() => f.today.resolveReference(owner, { ...request, eventId: jobEventId }), { code: 'TODAY_EVENT_REFERENCE_UNAVAILABLE' });
  assert.equal(held.events.some(event => event.kind === 'job.delivered'), true);
});

test('the installed real connector readiness guard refuses a retained capture without a current consumer profile', async () => {
  const f = await sixFamilies(), request = dayRequest(), held = f.today.day(owner, request);
  const now = new Date().toISOString();
  const scope: ConnectorOperationScope = {
    connectorId: 'synthetic-today-capture', connectorVersion: 'v1', operationId: 'import-invoices', kind: 'import', transport: 'file',
    applicability: { applicationVersion: 'v1', edition: 'fixture', module: 'invoices', configuration: 'synthetic-today-v1', deploymentProfile: 'synthetic' },
  };
  const registry = new ConnectorCapabilityRegistry([{ scope, implemented: true, capabilities: [], evidenceIds: ['synthetic-today-import'], limitations: ['Synthetic capture only.'] }], [{
    id: 'synthetic-today-import', scope, assertions: ['operation'], observedAt: now,
    expiresAt: new Date(Date.now() + 60000).toISOString(), artifact: { sha256: digest('synthetic-today-import'), reference: 'platform/tests/today-events-services.test.ts' },
    notes: ['No external source or readiness qualification.'], environment: 'synthetic', provenance: { kind: 'synthetic-fixture', generatorVersion: 'v1' },
  }]);
  const decoder: QualifiedDecoder = {
    id: 'synthetic-today-json', version: 'v1', schemaSha256: digest('synthetic-today-schema'), identityNamespace: 'synthetic-today-invoices-v1',
    identityFields: ['id', 'kind'], resourceIdentityFields: ['id', 'kind'], revisionOrder: { kind: 'unqualified' },
    businessFields: ['id', 'kind', 'date', 'amount', 'currency', 'branch', 'status', 'invoiceId', 'description'], deliveryFields: [], decode: content => JSON.parse(content),
  };
  const cursor = new CursorImportService(f.store, registry, decoder);
  const recipe = input().recipe!, domain = { company: recipe.scope.company, dataset: 'invoices', branches: ['main'], period };
  const review = await cursor.reviewMapping(owner, { sourceId, scope, domain, recipe, evidence: { reportId: 'synthetic-schema-review', sha256: decoder.schemaSha256 } });
  await cursor.open(owner, { sourceId, scope, domain, recipe, reviewId: review.id, snapshot: { kind: 'unverified', limitation: 'Synthetic retained capture; no consumer profile installed.' }, idempotencyKey: 'synthetic-today-capture-key' });
  assert.throws(() => f.calculator.receipt(owner, f.receipt.id), { code: 'CONNECTOR_CONSUMER_BINDING_REQUIRED' });
  assert.equal(f.runner.canRelease(owner, f.jobs.find(f.store.read(), f.job.id)), false);
  const current = f.today.release(owner, held);
  assert.equal(current.total, 3, 'Only import, refusal and prepared action retain sufficient current authority.');
  assert.equal(current.events.some(event => ['calculation.completed', 'decision.created', 'job.delivered'].includes(event.kind)), false);
  assert.ok(current.state.reasonCodes.includes('EVENT_EVIDENCE_UNRESOLVED'));
  assert.throws(() => f.today.resolveReference(owner, { ...request, eventId: eventId(f, 'calculation.completed', 'receiptId', f.receipt.id) }), { code: 'TODAY_EVENT_REFERENCE_UNAVAILABLE' });
});

test('tampered canonical accepted and refused import evidence remains unresolved rather than complete empty', async () => {
  for (const accepted of [true, false]) {
    const f = await fixture(), request = dayRequest();
    if (accepted) await f.imports.commit(owner, input());
    else await assert.rejects(f.imports.commit(owner, { ...input(), expectedTotals: { rowCount: 1, amountMinor: '12344' } }), { code: 'IMPORT_REFUSED' });
    const kind = accepted ? 'source.imported' : 'source.import-refused';
    const target = eventId(f, kind);
    assert.equal(f.today.day(owner, request).total, 1);
    await f.store.update(state => {
      const evidence = state.learning.find(item => item.type === 'decision' && item.importIdentity?.outcome === (accepted ? 'accepted' : 'rejected'));
      assert.ok(evidence);
      evidence.recordIntegrity = '0'.repeat(64);
    });
    assert.equal(f.learning.list(owner).length, 0, 'The current real learning reader rejects corrupted integrity.');
    const current = f.today.day(owner, request);
    assert.equal(current.total, 0);
    assert.deepEqual(current.events, []);
    assert.equal(current.state.kind, 'partial');
    assert.ok(current.state.reasonCodes.includes('EVENT_EVIDENCE_UNRESOLVED'));
    assert.throws(() => f.today.resolveReference(owner, { ...request, eventId: target }), { code: 'TODAY_EVENT_REFERENCE_UNAVAILABLE' });
  }
});

function richContent(receiptId: string): JournalContent {
  return {
    text: privateText,
    options: [
      { id: 'keep', label: 'Keep the current terms', reason: 'Wait for the explicit observation window.', evidence: [{ receiptId, figureKey: 'total' }] },
      { id: 'change', label: 'Consider different terms', reason: 'A declared alternative only.', evidence: [] },
    ], selectedOptionId: 'keep', ownerId: otherOwner.memberId,
    assumptions: [{ id: 'lag', text: 'Payment timing has not been qualified.', status: 'unverified', evidence: [] }],
    expectedOutcome: {
      description: 'Observe the imported invoice measure.', measure: 'billed', population: 'Explicit synthetic invoice import',
      baseline: { receiptId, figureKey: 'total' }, window: period, maturityDate: '2026-10-10',
      lagRule: 'Use only supplied receipt evidence.', uncertainty: ['One imported row does not establish a measured cause.'],
    }, reviewDate: '2026-10-15', hypotheses: [], branch: 'main',
  };
}

test('real rich decision audit events bind creation, revision and review to retained actors and outcomes', async () => {
  const f = await fixture(), request = dayRequest();
  await f.imports.commit(owner, input());
  const receipt = await f.calculator.calculate(owner, { operation: 'billed', period, sourceIds: [sourceId] });
  const content = richContent(receipt.id), draft = f.reports.draftDecision(owner, content);
  const created = await f.reports.confirmDecision(owner, draft, { reviewedDigest: draft.digest });
  const revised = await f.reports.reviseDecision(owner, created.id, { ...content, reviewDate: '2026-10-16' }, {
    expectedRevision: created.revision, reason: 'Explicitly move the human review date.',
  });
  const reviewed = await f.reports.reviewJournalDecision(owner, created.id, {
    outcome: 'continue', nextReviewDate: '2026-10-20',
    observation: {
      state: 'pending', measurements: [], notes: privateText,
      uncertainty: ['No new measured result is supplied.'], concurrentInterventions: [], executionReceiptIds: [],
    },
  }, { expectedRevision: revised.revision });
  assert.equal(created.revision, 1);
  assert.equal(revised.revision, 2);
  assert.equal(reviewed.revision, 3);
  assert.equal(reviewed.reviews[0].atRevision, 2);
  assert.equal(reviewed.ownerId, otherOwner.memberId);
  const projection = f.today.day(owner, request);
  assert.equal(projection.total, 5);
  const expected = [
    { kind: 'decision.created', args: { revision: 1 } },
    { kind: 'decision.revised', args: { revision: 2 } },
    { kind: 'decision.reviewed', args: { revision: 3, outcome: 'continue' } },
  ];
  for (const value of expected) {
    const projected = projection.events.find(event => event.kind === value.kind);
    assert.ok(projected);
    assert.deepEqual(projected.args, value.args);
    assert.deepEqual(projected.actor, { kind: 'member', memberId: owner.memberId }, 'The decision owner is not substituted for the recorded actor.');
    assert.deepEqual(projected.reference, { kind: 'decision', decisionId: created.id });
  }
  assert.equal(JSON.stringify(projection).includes(privateText), false);
  const forgeries = [
    { kind: 'decision.created', patch: { memberId: otherOwner.memberId } },
    { kind: 'decision.created', patch: { revision: 2 } },
    { kind: 'decision.revised', patch: { memberId: otherOwner.memberId } },
    { kind: 'decision.revised', patch: { revision: 99 } },
    { kind: 'decision.reviewed', patch: { memberId: otherOwner.memberId } },
    { kind: 'decision.reviewed', patch: { revision: reviewed.reviews[0].atRevision } },
    { kind: 'decision.reviewed', patch: { outcome: 'completed' } },
  ];
  for (const forgery of forgeries) {
    const target = eventId(f, forgery.kind, 'decisionId', created.id);
    const original = f.store.read().activity.find(item => item.id === target)!;
    await f.store.update(state => { state.activity.find(item => item.id === target).details = { ...original.details, ...forgery.patch }; });
    assert.equal(f.reports.decisions(owner).some(decision => decision.id === created.id), true, 'The real domain record is still authorized; only its forged audit claim is refused.');
    const current = f.today.day(owner, request);
    assert.equal(current.total, 4);
    assert.equal(current.events.some(event => event.id === target), false);
    assert.ok(current.state.reasonCodes.includes('EVENT_EVIDENCE_UNRESOLVED'));
    assert.throws(() => f.today.resolveReference(owner, { ...request, eventId: target }), { code: 'TODAY_EVENT_REFERENCE_UNAVAILABLE' });
    await f.store.update(state => { state.activity[state.activity.findIndex(item => item.id === target)] = original; });
  }
  assert.deepEqual(f.today.day(owner, request), projection);
});

test('restricted-seat capability diagnostics stay invariant when unknown or unresolved hidden evidence appears', async () => {
  const f = await fixture(), request = dayRequest();
  await f.store.update(state => { state.activity = []; });
  const empty = f.today.day(accountant, request);
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.state, { kind: 'partial', reasonCodes: ['PROJECTION_CAPABILITY_PARTIAL'] });
  assert.equal(f.today.day(owner, request).state.kind, 'complete');
  await f.store.update(state => {
    audit(state, 'PRIVATE_UNKNOWN_FAMILY', { sourceId: 'PRIVATE_HIDDEN_SOURCE', payload: privateText });
    audit(state, 'calculation.completed', { receiptId: 'PRIVATE_MISSING_RECEIPT', operation: 'billed', rowCount: 1 });
    state.activity.push({ id: 'PRIVATE_BAD_EVENT', at: privateText, event: 'source.imported', details: { sourceId: 'PRIVATE_HIDDEN_SOURCE' } });
  });
  const encountered = f.today.day(owner, request);
  assert.ok(encountered.state.reasonCodes.includes('UNSUPPORTED_EVENT_KIND'));
  assert.ok(encountered.state.reasonCodes.includes('EVENT_EVIDENCE_UNRESOLVED'));
  assert.deepEqual(f.today.day(accountant, request), empty, 'Hidden audit evidence changes neither counts nor diagnostics for this restricted seat.');
  assert.equal(JSON.stringify(f.today.day(accountant, request)).includes('PRIVATE_'), false);
});
