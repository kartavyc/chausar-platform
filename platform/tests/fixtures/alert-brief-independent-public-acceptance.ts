import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { Engine } from '../../runtime/engine.ts';
import { createLocalServer } from '../../runtime/server.ts';
import type { BusinessAlert, AlertCreate, AlertEvaluation } from '../../runtime/alerts-contracts.ts';
import type { CalculationReceipt } from '../../runtime/calculator.ts';
import type { Job } from '../../runtime/jobs.ts';

// Independent literal business oracles: one delivered INR 120 sale is INR 12000
// earned, above INR 10000, and cannot establish collections or a causal claim.
// CSV admission is experimental. The failing HTTP provider below is an explicit
// fixture boundary, not a qualified model/provider or live connector.
export const independentSources = {
  a: 'independent-brief-source-a', b: 'independent-brief-source-b',
} as const;
export const independentPeriod = { from: '2026-09-01', to: '2026-09-30' };
const passphrase = 'Independent synthetic brief acceptance fixture only';
const prefix = '.independent-alert-brief-';

export async function independentBriefHost(t: TestContext) {
  const root = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(root, /^C:[\\/]/i, 'Synthetic fixtures stay on C.');
  const directory = await mkdtemp(join(root, prefix));
  let providerCalls = 0, origin = '', token = '', lastCut = 0;
  const makeEngine = () => new Engine({ directory, demo: true, storage: 'experimental-file',
    gateway: { http: async () => { providerCalls++; throw new Error('Independent fixture: no provider inference is authorized.'); } } });
  let engine = makeEngine(), server = createLocalServer(engine);
  t.after(async () => {
    await server.close();
    const target = await realpath(directory), within = relative(root, target);
    assert.equal(dirname(target), root);
    assert.ok(within && !within.startsWith('..') && !isAbsolute(within) && basename(target).startsWith(prefix));
    await rm(target, { recursive: true, force: true });
  });
  async function listen() {
    ({ origin, token } = await server.listen());
    assert.equal(new URL(origin).hostname, '127.0.0.1');
    const response = await fetch(`${origin}/api/session`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { token });
  }
  async function raw(method: string, payload: unknown = {}, bearer = token) {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ method, payload }) });
    return { status: response.status, body: await response.json() as any };
  }
  async function rpc(method: string, payload: unknown = {}, bearer = token): Promise<any> {
    const response = await raw(method, payload, bearer);
    assert.equal(response.status, 200, `${method}: ${JSON.stringify(response.body)}`);
    assert.equal(response.body.error, undefined); return response.body.result;
  }
  async function refuses(method: string, payload: unknown, code: string, bearer = token) {
    const response = await raw(method, payload, bearer);
    assert.notEqual(response.status, 200); assert.equal(response.body.result, undefined);
    assert.equal(response.body.error.code, code); return response;
  }
  async function nextCut() {
    while (Date.now() <= lastCut) await delay(1);
    lastCut = Date.now(); return new Date(lastCut).toISOString();
  }
  await listen();
  await rpc('workspace.create', { name: 'INDEPENDENT SYNTHETIC BRIEF ACCEPTANCE', passphrase, demo: false, pack: 'ecommerce' });
  const dictionary = await rpc('ontology.publish', { pack: 'ecommerce' });
  await rpc('trust.update', { send: 'nothing', autonomy: true });

  async function measurement(which: keyof typeof independentSources, minor: '5000' | '12000', bearer = token): Promise<CalculationReceipt> {
    const sourceId = independentSources[which], amount = minor === '5000' ? '50.00' : '120.00';
    const imported = await rpc('sources.import', { sourceId, format: 'csv',
      content: 'id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch\n'
        + `${which}-sale,sale,2026-09-09,${amount},INR,${which}-customer,${which}-invoice,${which}-order,,delivered,INDEPENDENT_SYNTHETIC_${which},main\n`,
      expectedTotals: { rowCount: 1, amountMinor: minor } });
    assert.equal(imported.qualification, 'experimental'); assert.equal(imported.coverage.reconciled, true);
    assert.equal(imported.totalsMinor, minor);
    const receipt: CalculationReceipt = await rpc('calculation.run', { operation: 'earned', branch: 'main',
      sourceIds: [sourceId], period: independentPeriod, asOf: await nextCut() }, bearer);
    assert.equal(receipt.valueMinor, minor); assert.equal(receipt.currency, 'INR');
    assert.equal(receipt.dictionaryHash, dictionary.hash); assert.deepEqual(receipt.requestedSourceIds, [sourceId]);
    assert.deepEqual(await rpc('receipts.get', { id: receipt.id }, bearer), receipt);
    return receipt;
  }
  async function condition(which: keyof typeof independentSources, bearer = token, maxEvidenceAgeMs = 3_600_000) {
    const baseline = await measurement(which, '5000', bearer);
    const create: AlertCreate = { conditionId: `independent-condition-${which}`, label: `INDEPENDENT PRIVATE ${which.toUpperCase()} SALES`,
      baselineReceiptId: baseline.id, figureKey: 'total', unit: { kind: 'money', currency: 'INR' },
      sourceIds: [independentSources[which]], periodMode: 'fixed', direction: 'above', activateMinor: '10000', clearMinor: '8000',
      activation: { observations: 1, durationMs: 0 }, clearance: { observations: 1, durationMs: 0 },
      severity: { initial: 'warning', downgrade: 'on-clear' }, reopening: 'same-episode',
      maxEvidenceAgeMs, maxObservationGapMs: 3_600_000 };
    const draft: BusinessAlert = await rpc('alerts.create', create, bearer);
    const published: BusinessAlert = await rpc('alerts.publish', { id: draft.id, expectedRevision: draft.revision }, bearer);
    const observed = await measurement(which, '12000', bearer);
    const evaluation: AlertEvaluation = await rpc('alerts.evaluate', { id: published.id, expectedRevision: published.revision,
      observationId: `independent-breach-${which}`, observedAt: observed.asOf, receiptId: observed.id }, bearer);
    assert.equal(evaluation.duplicate, false); assert.equal(evaluation.alert.episodes.length, 1);
    assert.equal(evaluation.alert.episodes[0].status, 'open'); assert.equal(evaluation.alert.episodes[0].severity, 'warning');
    assert.equal(evaluation.alert.episodes[0].uncertain, false);
    return { alert: evaluation.alert, receipt: observed };
  }
  async function delivered(which: keyof typeof independentSources, bearer = token): Promise<any> {
    const job: Job = await rpc('jobs.create', { type: 'owner-brief', goal: 'Prepare the exact independent synthetic source brief',
      sourceIds: [independentSources[which]], budgetMinor: '100', reserveMinor: '10', requiresApproval: true,
      intervalMs: 60000, graceMs: 0, catchup: 'latest',
      stopRule: { maxRuns: 1, deadline: new Date(Date.now() + 3_600_000).toISOString() } }, bearer);
    assert.equal((await rpc('jobs.run', { id: job.id }, bearer)).status, 'approval-blocked');
    const approval = await rpc('jobs.approve', { id: job.id, digest: job.digest }, bearer);
    assert.equal(approval.approval.digest, job.digest); assert.equal(approval.approval.revision, job.revision);
    const result = await rpc('jobs.run', { id: job.id }, bearer);
    assert.equal(result.status, 'awaiting-acceptance'); assert.equal(result.deliverable.kind, 'brief');
    assert.equal(result.deliverable.result.alerts.configured, true); assert.equal(result.deliverable.result.alerts.evaluated, false);
    assert.deepEqual(result.deliverable.result.alerts.scope, { branch: null, sourceIds: [independentSources[which]] });
    assert.equal(result.deliverable.result.alerts.items.length, 1);
    assert.deepEqual(result.deliverable.result.alerts.items[0].evidence, { state: 'current', issues: [] });
    const netSales = result.deliverable.result.report.sections.find((section: any) => section.title === 'net_sales');
    assert.ok(netSales, 'The owner brief must carry its actual sales calculation.');
    const receipt: CalculationReceipt = await rpc('receipts.get', { id: netSales.receiptId }, bearer);
    assert.equal(receipt.valueMinor, '12000', 'The independent one-sale business oracle is INR 12000, not the two-source total.');
    assert.deepEqual(receipt.requestedSourceIds, [independentSources[which]]);
    return result;
  }
  function retainedJob(id: string): Job {
    const job = engine.vault!.read().jobs.find(item => item.id === id);
    assert.ok(job); return structuredClone(job);
  }
  function retainedAlerts() { return structuredClone(engine.vault!.read().answers.filter(item => item.kind === 'business-alert-v1')); }
  async function restart() {
    await rpc('workspace.lock'); await server.close();
    engine = makeEngine(); server = createLocalServer(engine); await listen();
    await rpc('workspace.open', { folder: 'main', passphrase });
  }
  async function member() {
    const invitation = await rpc('auth.invite', { name: 'Independent synthetic cofounder', role: 'cofounder', branches: ['main'] });
    return rpc('auth.accept', { token: invitation.token });
  }
  async function ciphertextOnly() {
    const bytes = await readFile(join(directory, 'main', 'authority.encrypted.json'), 'utf8');
    assert.equal(JSON.parse(bytes).format, 'chausar.vault.v1');
    for (const literal of [passphrase, 'INDEPENDENT SYNTHETIC BRIEF ACCEPTANCE', 'INDEPENDENT PRIVATE A SALES', 'INDEPENDENT_SYNTHETIC_a'])
      assert.equal(bytes.includes(literal), false, 'Synthetic business values must not appear as plaintext in the retained wrapper.');
  }
  function noDispatch() {
    const state = engine.vault!.read();
    assert.equal(providerCalls, 0); assert.equal(state.modelReceipts.length, 0);
    assert.equal(state.actions.length, 0); assert.equal(state.schedules.length, 0);
  }
  return { get engine() { return engine; }, rpc, refuses, condition, delivered, retainedJob, retainedAlerts,
    restart, nextCut, member, ciphertextOnly, noDispatch };
}
