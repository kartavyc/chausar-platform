import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import type { AlertBrief, AlertCreate, AlertEvaluation, BusinessAlert } from '../runtime/alerts-contracts.ts';
import type { CalculationReceipt } from '../runtime/calculator.ts';
import type { DictionaryDraft } from '../runtime/ontology.ts';

// Synthetic business inputs through actual paired HTTP, retained calculation
// receipts and AES-GCM files. No installed GUI, native database, vendor adapter
// or model-provider qualification is inferred from this experimental file path.
const passphrase = 'Synthetic private alert brief HTTP fixture passphrase';
const sourceId = 'synthetic-alert-brief-main';
const westSourceId = 'synthetic-alert-brief-west';
const period = { from: '2026-09-01', to: '2026-09-30' };

async function fixture(t: TestContext) {
  const temporaryRoot = await realpath(tmpdir()), prefix = '.alert-brief-http-';
  if (process.platform === 'win32') assert.match(temporaryRoot, /^C:[\\/]/i);
  const directory = await mkdtemp(join(temporaryRoot, prefix));
  let providerCalls = 0, lastCut = 0, snapshotOrdinal = 0;
  function newEngine() {
    return new Engine({ directory, demo: true, storage: 'experimental-file',
      gateway: { http: async () => { providerCalls++; throw new Error('A receipt-backed brief must not dispatch a model.'); } } });
  }
  let engine = newEngine(), app = createLocalServer(engine);
  let { origin, token } = await app.listen();
  t.after(async () => {
    await app.close();
    const target = await realpath(directory), scope = relative(temporaryRoot, target);
    assert.equal(target, resolve(directory)); assert.equal(dirname(target), temporaryRoot);
    assert.ok(scope && !scope.startsWith('..') && !isAbsolute(scope) && basename(target).startsWith(prefix),
      'Cleanup stays within this exact C-temp fixture and its declared prefix.');
    await rm(target, { recursive: true, force: true });
  });
  async function pair() {
    assert.equal(new URL(origin).hostname, '127.0.0.1');
    const response = await fetch(`${origin}/api/session`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { token });
  }
  async function raw(method: string, payload: unknown = {}, bearer = token) {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ method, payload }) });
    return { status: response.status, body: await response.json() as any };
  }
  async function rpc(method: string, payload: unknown = {}, bearer = token): Promise<any> {
    const result = await raw(method, payload, bearer);
    assert.equal(result.status, 200, `${method}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.error, undefined); return result.body.result;
  }
  async function refused(method: string, payload: unknown, code: string, bearer = token) {
    const result = await raw(method, payload, bearer);
    assert.notEqual(result.status, 200, `${method} must refuse ${code}`);
    assert.equal(result.body.result, undefined); assert.equal(result.body.error.code, code);
  }
  await pair();
  await rpc('workspace.create', { name: 'PRIVATE SYNTHETIC ALERT BRIEF BUSINESS', passphrase, demo: false, pack: 'ecommerce' });
  const packs: DictionaryDraft[] = await rpc('ontology.packs');
  const draft = structuredClone(packs.find(pack => pack.pack === 'ecommerce')!);
  assert.ok(draft);
  draft.definitions.find(definition => definition.name === 'earned')!.meaning =
    'Owner convention: earned is delivered synthetic sale value in INR, by sale event date, excluding tax; it establishes no collections or causes.';
  const dictionary = await rpc('ontology.publish', { draft });
  await rpc('trust.update', { send: 'nothing', autonomy: false });
  async function nextCut() {
    while (Date.now() <= lastCut) await delay(1);
    lastCut = Date.now(); return new Date(lastCut).toISOString();
  }
  async function calculate(id = sourceId, branch = 'main', bearer = token): Promise<CalculationReceipt> {
    const receipt: CalculationReceipt = await rpc('calculation.run', {
      operation: 'earned', sourceIds: [id], branch, period, asOf: await nextCut(),
    }, bearer);
    assert.equal(receipt.dictionaryHash, dictionary.hash);
    assert.deepEqual(receipt.requestedSourceIds, [id]);
    assert.deepEqual(await rpc('receipts.get', { id: receipt.id }, bearer), receipt);
    return receipt;
  }
  async function measurement(valueMinor: string, id = sourceId, branch = 'main'): Promise<CalculationReceipt> {
    assert.match(valueMinor, /^\d+$/);
    const value = BigInt(valueMinor), amount = `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
    snapshotOrdinal++;
    const imported = await rpc('sources.import', { sourceId: id, format: 'csv',
      content: 'id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch\n'
        + `observed-sale,sale,2026-09-10,${amount},INR,SYNTHETIC_CUSTOMER,SYNTHETIC_INVOICE,SYNTHETIC_ORDER,,delivered,PRIVATE_SYNTHETIC_BRIEF_ROW_${snapshotOrdinal},${branch}\n`,
      expectedTotals: { rowCount: 1, amountMinor: valueMinor } });
    assert.equal(imported.qualification, 'experimental'); assert.equal(imported.coverage.reconciled, true);
    assert.equal(imported.totalsMinor, valueMinor);
    const receipt = await calculate(id, branch); assert.equal(receipt.valueMinor, valueMinor); return receipt;
  }
  function definition(receipt: CalculationReceipt, conditionId: string, overrides: Partial<AlertCreate> = {}): AlertCreate {
    return { conditionId, label: `PRIVATE_SYNTHETIC_BRIEF_${conditionId}`, baselineReceiptId: receipt.id,
      figureKey: 'total', unit: { kind: 'money', currency: 'INR' }, sourceIds: receipt.requestedSourceIds!,
      periodMode: 'fixed', direction: 'above', activateMinor: '10000', clearMinor: '8000',
      activation: { observations: 1, durationMs: 0 }, clearance: { observations: 1, durationMs: 0 },
      severity: { initial: 'warning', criticalMinor: '20000', downgrade: 'on-clear' }, reopening: 'same-episode',
      maxEvidenceAgeMs: 3_600_000, maxObservationGapMs: 3_600_000, ...overrides };
  }
  async function published(receipt: CalculationReceipt, conditionId: string, bearer = token): Promise<BusinessAlert> {
    const alert: BusinessAlert = await rpc('alerts.create', definition(receipt, conditionId), bearer);
    assert.equal(alert.status, 'draft');
    const result: BusinessAlert = await rpc('alerts.publish', { id: alert.id, expectedRevision: alert.revision }, bearer);
    assert.equal(result.status, 'published'); return result;
  }
  async function evaluate(alert: BusinessAlert, receipt: CalculationReceipt, observationId: string): Promise<AlertEvaluation> {
    return rpc('alerts.evaluate', { id: alert.id, expectedRevision: alert.revision,
      receiptId: receipt.id, observedAt: receipt.asOf, observationId });
  }
  async function brief(input: Record<string, unknown> = {}, bearer = token) {
    const result = await rpc('reports.brief', { period, ...input }, bearer);
    const section = result.alerts as AlertBrief;
    assert.equal(section.configured, true); assert.equal(section.evaluated, false);
    assert.match(section.pin, /^[a-f0-9]{64}$/); assert.ok(Number.isFinite(Date.parse(section.checkedAt)));
    assert.equal(result.delivery.state, 'draft'); assert.equal(result.delivery.requiresApproval, true);
    assert.deepEqual([...new Set(result.receiptIds)].sort(),
      [...new Set([...result.report.receiptIds, ...section.receiptIds])].sort());
    for (const id of result.receiptIds) assert.equal((await rpc('receipts.get', { id }, bearer)).id, id);
    return result;
  }
  function savedAlerts() { return engine.vault!.read().answers.filter(item => item.kind === 'business-alert-v1'); }
  function localOnly(expectedJobs = 0) {
    const state = engine.vault!.read();
    assert.equal(providerCalls, 0); assert.equal(state.modelReceipts.length, 0);
    assert.equal(state.actions.length, 0); assert.equal(state.schedules.length, 0); assert.equal(state.jobs.length, expectedJobs);
  }
  async function restart() {
    await rpc('workspace.lock'); await app.close();
    engine = newEngine(); app = createLocalServer(engine);
    ({ origin, token } = await app.listen()); await pair();
    await rpc('workspace.open', { folder: 'main', passphrase });
  }
  async function member() {
    const invite = await rpc('auth.invite', { name: 'Synthetic private brief author', role: 'cofounder', branches: ['main', 'west'] });
    return rpc('auth.accept', { token: invite.token });
  }
  return { directory, get engine() { return engine; }, rpc, refused, calculate, measurement, definition,
    published, evaluate, brief, nextCut, savedAlerts, localOnly, restart, member };
}

test('paired HTTP brief retains an observed alert episode across fresh Engine reopening and exposes missing evidence without evaluating', async t => {
  const f = await fixture(t), baseline = await f.measurement('5000');
  let alert = await f.published(baseline, 'main-observed');
  const unobserved = await f.published(baseline, 'main-unobserved');
  const draft: BusinessAlert = await f.rpc('alerts.create', f.definition(baseline, 'main-draft'));
  const west = await f.published(await f.measurement('5000', westSourceId, 'west'), 'west-unobserved');
  const observed = await f.measurement('12000');
  const opened = await f.evaluate(alert, observed, 'synthetic-breach'); alert = opened.alert;
  assert.deepEqual(opened.notices.map(notice => notice.transition), ['opened']);
  assert.equal(alert.episodes.length, 1); assert.equal(alert.episodes[0].status, 'open');
  const saved = f.savedAlerts(), before = Date.now();
  const first = await f.brief({ branch: 'main', sourceIds: [sourceId], onDate: '2099-01-01' });
  assert.ok(Date.parse(first.alerts.checkedAt) >= before && Date.parse(first.alerts.checkedAt) <= Date.now(),
    'A briefing date never supplies the trusted evidence clock.');
  assert.deepEqual(first.alerts.scope, { branch: 'main', sourceIds: [sourceId] });
  assert.deepEqual(first.alerts.items.map((item: any) => item.alertId).sort(), [alert.id, unobserved.id].sort());
  assert.ok(first.alerts.items.every((item: any) => ![draft.id, west.id].includes(item.alertId)));
  const item = first.alerts.items.find((value: any) => value.alertId === alert.id)!;
  assert.deepEqual(item.episodes, alert.episodes); assert.equal(item.revision, alert.revision);
  assert.equal(item.definitionDigest, alert.definitionDigest);
  assert.deepEqual(item.observation, { id: 'synthetic-breach', observedAt: observed.asOf,
    recordedAt: alert.observations.at(-1)!.recordedAt, state: 'breach', receiptId: observed.id });
  assert.deepEqual(item.evidence, { state: 'current', issues: [] });
  const waiting = first.alerts.items.find((value: any) => value.alertId === unobserved.id)!;
  assert.equal(waiting.observation, null); assert.equal(waiting.evidence.state, 'uncertain');
  assert.ok(waiting.evidence.issues.includes('not-observed')); assert.deepEqual(waiting.episodes, []);
  assert.deepEqual(f.savedAlerts(), saved); f.localOnly();
  const encrypted = await readFile(join(f.directory, 'main', 'authority.encrypted.json'), 'utf8');
  assert.equal(JSON.parse(encrypted).format, 'chausar.vault.v1');
  for (const value of [passphrase, 'PRIVATE SYNTHETIC ALERT BRIEF BUSINESS', alert.definition.label,
    'PRIVATE_SYNTHETIC_BRIEF_ROW']) assert.equal(encrypted.includes(value), false);
  await f.restart();
  const restored = await f.brief({ branch: 'main', sourceIds: [sourceId] });
  assert.deepEqual(restored.alerts.items, first.alerts.items); assert.equal(restored.alerts.pin, first.alerts.pin);
  assert.deepEqual(await f.rpc('alerts.get', { id: alert.id }), alert);
  alert = (await f.rpc('alerts.evaluate', { id: alert.id, expectedRevision: alert.revision,
    observationId: 'explicitly-unavailable', observedAt: await f.nextCut(), missingReason: 'Synthetic snapshot unavailable.' })).alert;
  const missingSaved = f.savedAlerts(), uncertain = await f.brief({ branch: 'main', sourceIds: [sourceId] });
  const missing = uncertain.alerts.items.find((value: any) => value.alertId === alert.id)!;
  assert.equal(missing.evidence.state, 'uncertain'); assert.ok(missing.evidence.issues.includes('missing-evidence'));
  assert.equal(missing.observation.state, 'unknown'); assert.equal(missing.observation.receiptId, null);
  assert.deepEqual(missing.episodes, alert.episodes); assert.equal(missing.episodes[0].id, item.episodes[0].id);
  assert.equal(missing.episodes[0].status, 'open'); assert.equal(missing.episodes[0].uncertain, true);
  await f.brief({ branch: 'main', sourceIds: [sourceId] });
  assert.deepEqual(f.savedAlerts(), missingSaved, 'Repeated brief reads never append observations or notices.'); f.localOnly();
});

test('paired HTTP brief filters private authors and current branch/source grants and never returns deleted-source receipt references', async t => {
  const f = await fixture(t);
  const ownerMain = await f.published(await f.measurement('5000'), 'owner-main-private');
  const ownerWest = await f.published(await f.measurement('6000', westSourceId, 'west'), 'owner-west-private');
  const author = await f.member();
  const memberMain = await f.published(await f.calculate(sourceId, 'main', author.token), 'member-main-private', author.token);
  const memberWest = await f.published(await f.calculate(westSourceId, 'west', author.token), 'member-west-private', author.token);
  const own = await f.brief(), other = await f.brief({}, author.token);
  assert.deepEqual(own.alerts.items.map((item: any) => item.alertId).sort(), [ownerMain.id, ownerWest.id].sort());
  assert.deepEqual(other.alerts.items.map((item: any) => item.alertId).sort(), [memberMain.id, memberWest.id].sort());
  assert.ok(!JSON.stringify(own.alerts).includes(memberMain.definition.label));
  assert.ok(!JSON.stringify(other.alerts).includes(ownerMain.definition.label));
  assert.deepEqual((await f.brief({ branch: 'main' })).alerts.items.map((item: any) => item.alertId), [ownerMain.id]);
  assert.deepEqual((await f.brief({ sourceIds: [westSourceId] })).alerts.items.map((item: any) => item.alertId), [ownerWest.id]);
  // Current branch grants are host-owned authorization state. This fixture-only
  // change is not a renderer-supplied context or a new public grant-update API.
  await f.engine.vault!.update(state => { state.members.find(member => member.id === author.member.id)!.branches = ['main']; });
  assert.deepEqual((await f.brief({}, author.token)).alerts.items.map((item: any) => item.alertId), [memberMain.id]);
  await f.rpc('trust.update', { allowedSources: [] });
  for (const bearer of [undefined, author.token]) {
    const revoked = await f.brief({}, bearer);
    assert.deepEqual(revoked.alerts.items, []); assert.deepEqual(revoked.alerts.receiptIds, []);
    for (const id of revoked.receiptIds) {
      assert.ok(![ownerMain, ownerWest, memberMain, memberWest].some(alert => alert.receiptIds.includes(id)),
        'Fresh empty report receipts cannot expose retained private alert references.');
      const receipt: CalculationReceipt = await f.rpc('receipts.get', { id }, bearer);
      assert.deepEqual(receipt.sourceIds, []); assert.deepEqual(receipt.rowIds, []);
      assert.deepEqual(receipt.rows, []); assert.deepEqual(receipt.exclusions, []);
    }
  }
  await f.rpc('trust.update', { allowedSources: [sourceId, westSourceId] });
  assert.deepEqual((await f.brief({ branch: 'main', sourceIds: [sourceId] })).alerts.items.map((item: any) => item.alertId), [ownerMain.id]);
  await f.rpc('sources.delete', { id: sourceId });
  const deleted = await f.brief({ branch: 'main', sourceIds: [sourceId] });
  assert.deepEqual(deleted.alerts.items, []); assert.deepEqual(deleted.alerts.receiptIds, []);
  assert.ok(!deleted.receiptIds.includes(ownerMain.definition.baselineReceiptId));
  for (const id of deleted.receiptIds) {
    assert.ok(![ownerMain, memberMain].some(alert => alert.receiptIds.includes(id)));
    const receipt: CalculationReceipt = await f.rpc('receipts.get', { id });
    assert.ok(!receipt.sourceIds.includes(sourceId));
    assert.ok(!receipt.rows.some(row => row.sourceId === sourceId));
    assert.ok(![...ownerMain.rowIds, ...memberMain.rowIds].some(rowId => receipt.rowIds.includes(rowId)
      || receipt.exclusions.some(item => item.rowId === rowId)));
  }
  await f.refused('receipts.get', { id: ownerMain.definition.baselineReceiptId }, 'RECEIPT_NOT_FOUND');
  assert.deepEqual((await f.brief()).alerts.items.map((item: any) => item.alertId), [ownerWest.id]);
  assert.deepEqual((await f.brief({}, author.token)).alerts.items, []); f.localOnly();
});

test('paired HTTP exact-approved owner brief job carries current alert evidence and withholds stale observation output before acceptance', async t => {
  const f = await fixture(t);
  let alert = await f.published(await f.measurement('5000'), 'owner-job-current');
  const otherSource = await f.measurement('6000', westSourceId, 'west');
  const otherAlert = await f.published(otherSource, 'outside-job-mandate');
  alert = (await f.evaluate(alert, await f.measurement('12000'), 'job-breach')).alert;
  await f.rpc('trust.update', { send: 'nothing', autonomy: true });
  const configuration = { type: 'owner-brief', goal: 'Prepare the synthetic receipt-backed owner brief only',
    budgetMinor: '100', reserveMinor: '10', sourceIds: [sourceId], requiresApproval: true,
    intervalMs: 60000, graceMs: 0, catchup: 'latest' as const,
    stopRule: { maxRuns: 1, deadline: new Date(Date.now() + 3_600_000).toISOString() } };
  const job = await f.rpc('jobs.create', configuration);
  assert.equal((await f.rpc('jobs.run', { id: job.id })).status, 'approval-blocked');
  const approved = await f.rpc('jobs.approve', { id: job.id, digest: job.digest });
  assert.equal(approved.approval.digest, job.digest); assert.equal(approved.approval.revision, job.revision);
  const delivered = await f.rpc('jobs.run', { id: job.id });
  assert.equal(delivered.status, 'awaiting-acceptance'); assert.equal(delivered.deliverable.kind, 'brief');
  const result = delivered.deliverable.result;
  assert.equal(result.alerts.evaluated, false); assert.equal(result.alerts.items.length, 1);
  assert.deepEqual(result.alerts.scope, { branch: null, sourceIds: [sourceId] });
  assert.equal(result.alerts.items[0].alertId, alert.id); assert.deepEqual(result.alerts.items[0].episodes, alert.episodes);
  assert.deepEqual(result.alerts.items[0].evidence, { state: 'current', issues: [] });
  assert.ok(!JSON.stringify(result.alerts).includes(otherAlert.definition.label));
  assert.ok(!result.receiptIds.includes(otherSource.id));
  assert.ok(otherSource.rowIds.every(id => !result.report.rowIds.includes(id)));
  for (const id of result.receiptIds) {
    const receipt: CalculationReceipt = await f.rpc('receipts.get', { id });
    assert.ok(!receipt.sourceIds.includes(westSourceId));
    assert.ok(!(receipt.requestedSourceIds ?? []).includes(westSourceId));
  }
  assert.ok(result.alerts.receiptIds.every((id: string) => result.receiptIds.includes(id)));
  assert.deepEqual((await f.rpc('jobs.list')).find((item: any) => item.id === job.id).deliverable, delivered.deliverable);
  const storedResult = structuredClone(f.engine.vault!.read().jobs.find(item => item.id === job.id)!.deliverable);
  const emptyJob = await f.rpc('jobs.create', { ...configuration, goal: 'Prepare a synthetic brief with no admitted sources', sourceIds: [] });
  assert.deepEqual(emptyJob.sourceIds, []);
  await f.rpc('jobs.approve', { id: emptyJob.id, digest: emptyJob.digest });
  const emptyRun = await f.rpc('jobs.run', { id: emptyJob.id });
  assert.equal(emptyRun.status, 'awaiting-acceptance');
  assert.deepEqual(emptyRun.deliverable.result.alerts.scope, { branch: null, sourceIds: [] });
  assert.deepEqual(emptyRun.deliverable.result.alerts.items, []);
  assert.deepEqual(emptyRun.deliverable.result.alerts.receiptIds, []);
  assert.deepEqual(emptyRun.deliverable.result.report.rowIds, []);
  for (const id of emptyRun.deliverable.result.receiptIds) {
    const receipt: CalculationReceipt = await f.rpc('receipts.get', { id });
    assert.deepEqual(receipt.rowIds, []); assert.deepEqual(receipt.sourceIds, []);
  }
  // Only the alert observation changes: no import, old calculation edit or
  // permission revocation can account for withholding this cached brief.
  alert = (await f.rpc('alerts.evaluate', { id: alert.id, expectedRevision: alert.revision,
    observationId: 'job-evidence-now-unavailable', observedAt: await f.nextCut(), missingReason: 'Synthetic source snapshot unavailable.' })).alert;
  assert.notEqual(alert.revision, result.alerts.items[0].revision);
  assert.equal((await f.rpc('jobs.list')).find((item: any) => item.id === job.id)?.deliverable, undefined);
  await f.refused('jobs.accept', { id: job.id }, 'JOB_EVIDENCE_REVOKED');
  const retained = f.engine.vault!.read().jobs.find(item => item.id === job.id)!;
  assert.equal(retained.status, 'awaiting-acceptance'); assert.deepEqual(retained.deliverable, storedResult);
  await f.restart();
  assert.equal((await f.rpc('jobs.list')).find((item: any) => item.id === job.id)?.deliverable, undefined);
  const current = await f.brief({ sourceIds: [sourceId] });
  assert.notEqual(current.alerts.pin, result.alerts.pin);
  assert.equal(current.alerts.items[0].evidence.state, 'uncertain');
  assert.deepEqual(current.alerts.items[0].episodes, alert.episodes); f.localOnly(2);
});

test('paired HTTP omitted owner brief scope retains both readable conflicting sources and their partial coverage', async t => {
  const f = await fixture(t), secondSource = 'synthetic-alert-brief-conflicting-books';
  await f.measurement('5000');
  await f.measurement('6000', secondSource, 'main');
  // Both imports deliberately claim the same logical sale in the same branch.
  // Conflict resolution has no winner, but both sources remain readable inputs.
  const memory = await f.rpc('memory.list');
  assert.equal(memory.facts.length, 0); assert.equal(memory.conflicts.length, 1);
  assert.equal(memory.conflicts[0].rowIds.length, 2);
  await f.rpc('trust.update', { send: 'nothing', autonomy: true });
  const job = await f.rpc('jobs.create', { type: 'owner-brief',
    goal: 'Prepare a synthetic brief while retaining both contradictory source claims',
    budgetMinor: '100', reserveMinor: '10', requiresApproval: true,
    intervalMs: 60000, graceMs: 0, catchup: 'latest',
    stopRule: { maxRuns: 1, deadline: new Date(Date.now() + 3_600_000).toISOString() } });
  assert.deepEqual(job.sourceIds, [sourceId, secondSource].sort(),
    'An omitted mandate scope must not discard every candidate because no conflict winner exists.');
  await f.rpc('jobs.approve', { id: job.id, digest: job.digest });
  const completed = await f.rpc('jobs.run', { id: job.id });
  assert.equal(completed.status, 'awaiting-acceptance');
  const result = completed.deliverable.result;
  assert.deepEqual(result.alerts.scope, { branch: null, sourceIds: [sourceId, secondSource].sort() });
  assert.deepEqual(result.alerts.items, []); assert.equal(result.alerts.evaluated, false);
  assert.equal(result.report.status, 'partial');
  assert.ok(result.report.gaps.some((gap: string) => /unresolved source conflicts/i.test(gap)));
  assert.ok(result.report.sections.length > 0);
  assert.ok(result.report.sections.some((section: any) => section.title === 'net_sales'),
    'The report must retain the calculation that actually consumes these conflicting sale claims.');
  for (const section of result.report.sections) {
    const receipt: CalculationReceipt = await f.rpc('receipts.get', { id: section.receiptId });
    assert.deepEqual(receipt.requestedSourceIds!.slice().sort(), [sourceId, secondSource].sort());
    if (['net_sales', 'margin'].includes(section.title)) {
      assert.equal(section.coverage.unresolvedConflicts, 1);
      assert.equal(section.coverage.completeness, 'partial', 'Conflicting sales cannot be relabelled as an empty selection.');
      assert.equal(receipt.coverage.unresolvedConflicts, 1);
      assert.ok(memory.conflicts[0].rowIds.every((id: string) => receipt.exclusions.some(item => item.rowId === id)));
    } else {
      assert.equal(section.coverage.unresolvedConflicts, 0,
        'Sale conflicts are not invoice, payment or aging conflicts under the published dictionary.');
      assert.equal(receipt.coverage.unresolvedConflicts, 0);
    }
  }
  f.localOnly(1);
});
