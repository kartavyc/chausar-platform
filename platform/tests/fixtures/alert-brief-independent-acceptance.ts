import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {mkdtemp, readFile, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, relative} from 'node:path';
import {Engine} from '../../runtime/engine.ts';
import {createLocalServer} from '../../runtime/server.ts';
import type {CalculationReceipt} from '../../runtime/calculator.ts';
import type {BusinessAlert, AlertCreate} from '../../runtime/alerts-contracts.ts';
import type {MappingRecipe} from '../../runtime/ingest.ts';

export const A = 'independent-brief-a', B = 'independent-brief-b', C = 'independent-brief-later';
export const PERIOD = {from: '2026-09-01', to: '2026-09-30'};
export const SECRET = 'SYNTHETIC_PRIVATE_BRIEF_MARKER_913706';
const PASSWORD = 'Synthetic independent owner brief credential only';

// Real HTTP, encrypted files and ordinary public authorship. Date alone is a
// labelled synthetic host clock; no State/receipt fabrication or provider ports.
export async function fixture(t: TestContext) {
  t.mock.timers.enable({apis: ['Date'], now: new Date('2026-10-02T12:00:00.000Z')});
  const base = await realpath(tmpdir()); if (process.platform === 'win32') assert.match(base, /^C:[\\/]/i);
  const directory = await realpath(await mkdtemp(join(base, 'chausar-independent-alert-brief-')));
  assert.equal(dirname(directory), base);
  let providerCalls = 0, ordinal = 0;
  const options = {directory, demo: true, storage: 'experimental-file' as const,
    gateway: {http: async () => {providerCalls++; throw Error('This source fixture forbids live inference.');}}};
  let engine = new Engine(options), app = createLocalServer(engine), host = await app.listen();
  const raw = async (method: string, payload: unknown = {}, token = host.token) => {
    const response = await fetch(`${host.origin}/api/rpc`, {method: 'POST', headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify({method, payload})});
    return {status: response.status, body: await response.json() as any};
  };
  const rpc = async <T = any>(method: string, payload: unknown = {}, token = host.token): Promise<T> => {
    const response = await raw(method, payload, token);
    assert.equal(response.status, 200, `${method}: ${response.body.error?.code} ${response.body.error?.message}`);
    return response.body.result as T;
  };
  const refuse = async (method: string, payload: unknown, code: string, token = host.token) => {
    const response = await raw(method, payload, token);
    assert.notEqual(response.status, 200); assert.equal(response.body.error?.code, code); assert.equal(response.body.result, undefined);
  };
  t.after(async () => {
    await app.close(); const actual = await realpath(directory), child = relative(base, actual);
    assert.equal(dirname(actual), base); assert.ok(child && !isAbsolute(child) && !child.startsWith('..')
      && child.startsWith('chausar-independent-alert-brief-'));
    await rm(actual, {recursive: true, force: true}); assert.equal(providerCalls, 0);
  });
  assert.equal(new URL(host.origin).hostname, '127.0.0.1');
  const paired = await fetch(`${host.origin}/api/session`, {headers: {authorization: `Bearer ${host.token}`}});
  assert.equal(paired.status, 200); assert.deepEqual(await paired.json(), {token: host.token});
  await rpc('workspace.create', {name: `Independent synthetic brief ${SECRET}`, passphrase: PASSWORD, pack: 'ecommerce', demo: false});
  await rpc('trust.update', {send: 'nothing', autonomy: true, retentionDays: 3650});
  const advance = (ms = 1000) => t.mock.timers.setTime(Date.now() + ms);
  const mapping = (source: string): MappingRecipe => ({version: 1, id: `mapping-${source}`, system: 'synthetic-csv', edition: '1',
    scope: {company: 'Independent synthetic shop', branches: ['main', 'west']}, bindings: [
      {target: 'entityId', source: 'id', type: 'string', nulls: 'reject'},
      {target: 'kind', source: 'kind', type: 'string', nulls: 'reject'},
      {target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject'},
      {target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject'},
      ...['currency', 'branch', 'status', 'description'].map(target => ({target, source: target,
        type: 'string' as const, nulls: 'reject' as const})),
    ], allowedKinds: ['sale'], allowedStatuses: ['delivered'], onUnmapped: 'reject'});
  const importRows = async (rows: {minor: string; entity: string; branch?: string}[], source = A) => {
    advance(); ordinal++;
    const total = rows.reduce((sum, row) => sum + BigInt(row.minor), 0n).toString();
    const imported = await rpc('sources.import', {sourceId: source, format: 'csv', recipe: mapping(source),
      content: 'id,kind,date,amount,currency,branch,status,description\n' + rows.map(row =>
        `${row.entity},sale,2026-09-30,${row.minor},INR,${row.branch ?? 'main'},delivered,${SECRET}_${ordinal}\n`).join(''),
      expectedTotals: {rowCount: rows.length, amountMinor: total}});
    assert.equal(imported.coverage.reconciled, true); assert.equal(imported.totalsMinor, total); return imported;
  };
  const importRow = (minor: string, source = A, entity = `${source}-sale`, branch = 'main') => importRows([{minor, entity, branch}], source);
  const calculate = async (sources = [A], branch: string | null = 'main', token = host.token) => {
    advance(); return rpc<CalculationReceipt>('calculation.run', {operation: 'earned', sourceIds: sources,
      ...(branch === null ? {} : {branch}), period: PERIOD, asOf: new Date().toISOString()}, token);
  };
  const measurement = async (minor: string, source = A, entity = `${source}-sale`, branch = 'main', token = host.token) => {
    await importRow(minor, source, entity, branch); const receipt = await calculate([source], branch, token);
    assert.equal(receipt.totalMinor, minor); assert.deepEqual(await rpc('receipts.get', {id: receipt.id}, token), receipt); return receipt;
  };
  const definition = (receipt: CalculationReceipt, id: string, overrides: Partial<AlertCreate> = {}): AlertCreate => ({conditionId: id,
    label: `${SECRET}_${id}`, baselineReceiptId: receipt.id, figureKey: 'total', unit: {kind: 'money', currency: 'INR'},
    sourceIds: receipt.requestedSourceIds!, periodMode: 'fixed', direction: 'above', activateMinor: '10000', clearMinor: '8000',
    activation: {observations: 1, durationMs: 0}, clearance: {observations: 1, durationMs: 0},
    severity: {initial: 'warning', criticalMinor: '20000', downgrade: 'on-clear'}, reopening: 'same-episode',
    maxEvidenceAgeMs: 60_000, maxObservationGapMs: 60_000, ...overrides});
  const publish = async (receipt: CalculationReceipt, id: string, overrides: Partial<AlertCreate> = {}, token = host.token) => {
    const draft = await rpc<BusinessAlert>('alerts.create', definition(receipt, id, overrides), token);
    return rpc<BusinessAlert>('alerts.publish', {id: draft.id, expectedRevision: draft.revision}, token);
  };
  const evaluate = (alert: BusinessAlert, receipt: CalculationReceipt, id: string, token = host.token) => rpc('alerts.evaluate', {
    id: alert.id, expectedRevision: alert.revision, observationId: id, observedAt: receipt.asOf, receiptId: receipt.id}, token);
  const brief = async (payload: Record<string, unknown> = {}, token = host.token) => {
    const result = await rpc('reports.brief', {period: PERIOD, ...payload}, token);
    assert.equal(result.alerts.configured, true); assert.equal(result.alerts.evaluated, false);
    assert.equal(result.delivery.state, 'draft'); assert.equal(result.delivery.requiresApproval, true);
    assert.deepEqual([...new Set(result.receiptIds)].sort(), [...new Set([...result.report.receiptIds, ...result.alerts.receiptIds])].sort());
    for (const id of result.receiptIds) assert.equal((await rpc('receipts.get', {id}, token)).id, id);
    return result;
  };
  const createJob = async (sourceIds: string[] | undefined, token = host.token, maxRuns = 3) => {
    advance(); return rpc('jobs.create', {type: 'owner-brief', goal: `Prepare a current independent local brief ${ordinal}`,
      budgetMinor: '100', reserveMinor: '10', requiresApproval: true,
      intervalMs: 60_000, graceMs: 0, catchup: 'latest', stopRule: {maxRuns, deadline: new Date(Date.now() + 86_400_000).toISOString()},
      ...(sourceIds === undefined ? {} : {sourceIds})}, token);
  };
  const runJob = async (job: any, token = host.token) => {
    const pending = await rpc('jobs.run', {id: job.id}, token); assert.equal(pending.status, 'approval-blocked');
    await rpc('jobs.approve', {id: job.id, digest: job.digest}, token);
    const delivered = await rpc('jobs.run', {id: job.id}, token); assert.equal(delivered.status, 'awaiting-acceptance');
    assert.equal(delivered.deliverable.kind, 'brief'); return delivered;
  };
  const controls = () => {const state = engine.vault!.read(); return {
    alerts: state.answers.filter(item => item.kind === 'business-alert-v1'), actions: state.actions, jobs: state.jobs,
    notices: state.answers.filter(item => item.kind === 'business-alert-v1').flatMap(item => item.notices),
    modelReceipts: state.modelReceipts, schedules: state.schedules};};
  const assertLocal = () => {const state = engine.vault!.read(); assert.equal(providerCalls, 0);
    assert.deepEqual(state.actions, []); assert.deepEqual(state.modelReceipts, []); assert.deepEqual(state.schedules, []);};
  const ciphertext = () => readFile(join(directory, 'main', 'authority.encrypted.json'));
  const restart = async () => {const oldToken = host.token; await rpc('workspace.lock'); await app.close();
    engine = new Engine(options); app = createLocalServer(engine); host = await app.listen();
    await rpc('workspace.open', {passphrase: PASSWORD}); assert.notEqual(host.token, oldToken); return oldToken;};
  return {raw, rpc, refuse, advance, importRow, importRows, calculate, measurement, definition, publish, evaluate, brief, createJob, runJob,
    controls, assertLocal, ciphertext, restart, directory, get engine() {return engine;}, get token() {return host.token;}};
}
