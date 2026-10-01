import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { AlertCreate, AlertEvaluate, AlertEvaluation, BusinessAlert } from '../../runtime/alerts-contracts.ts';
import type { CalculationReceipt } from '../../runtime/calculator.ts';
import type { Context } from '../../runtime/contracts.ts';
import { Engine } from '../../runtime/engine.ts';
import type { MappingRecipe } from '../../runtime/ingest.ts';
import type { DictionaryDraft } from '../../runtime/ontology.ts';
import { harness } from './conversation-acceptance-renderer.ts';

export const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
export const SOURCE = 'synthetic-public-alert-sales';
export const PASSWORD = 'Synthetic public alerts disposable passphrase';
export const MINUTE = 60_000;
const HOST_START = Date.parse('2026-09-30T12:00:00.000Z');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OWNER: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const HEADER = 'id,kind,date,amount,currency,branch,status,description\n';
const recipe: MappingRecipe = {
  version: 1, id: 'synthetic-public-alert-map', system: 'synthetic-csv', edition: '1',
  scope: { company: 'Synthetic public alert business', branches: ['main'] },
  bindings: [
    { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
    { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
    ...['currency', 'branch', 'status', 'description'].map(field => ({ target: field, source: field, type: 'string' as const, nulls: 'reject' as const })),
  ], allowedKinds: ['sale'], allowedStatuses: ['delivered'], onUnmapped: 'reject',
};

// Actual preload -> structured clone -> strict IPC -> in-process Engine. The
// sole host substitution is historical Date, scoped to this sequential test.
// Facts, source controls, reconciliations and receipts all enter by public RPC.
export async function fixture(t: TestContext, excludeNulls = false) {
  t.mock.timers.enable({ apis: ['Date'], now: HOST_START });
  const directory = await mkdtemp(join(ROOT, '.alerts-public-acceptance-'));
  if (process.platform === 'win32') assert.match(directory, /^C:[\\/]/i);
  const options = { directory, demo: true, storage: 'experimental-file' as const };
  let engine = new Engine(options), currentContext = OWNER;
  t.after(async () => {
    await engine.close();
    const target = resolve(directory), child = relative(ROOT, target);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child), 'Cleanup stays within this C-scoped repository.');
    await rm(target, { recursive: true, force: true });
  });
  const h = await harness({ dispatch: (method, payload) => engine.requestAs(currentContext, method, payload) });
  const request = (method: string, payload: Record<string, unknown> = {}): Promise<any> => h.exposed.request(method, payload);
  async function requestAs(ctx: Context, method: string, payload: Record<string, unknown> = {}) {
    const prior = currentContext; currentContext = ctx;
    try { return await request(method, payload); } finally { currentContext = prior; }
  }
  await request('workspace.create', { name: 'Synthetic public alert business', folder: 'acceptance',
    passphrase: PASSWORD, demo: false, pack: 'ecommerce' });
  if (excludeNulls) {
    const packs: DictionaryDraft[] = await request('ontology.packs');
    const draft = packs.find(pack => pack.pack === 'ecommerce')!;
    draft.definitions.find(definition => definition.name === 'earned')!.nulls = 'exclude';
    await request('ontology.publish', { draft });
  }
  const at = (offset: number) => new Date(HOST_START + offset * MINUTE).toISOString();
  const advance = (offset: number) => { t.mock.timers.setTime(HOST_START + offset * MINUTE); return at(offset); };
  async function calculate(offset: number, period = PERIOD): Promise<CalculationReceipt> {
    advance(offset);
    return request('calculation.run', { operation: 'earned', period, sourceIds: [SOURCE], branch: 'main', asOf: at(offset) });
  }
  async function measurement(valueMinor: string, offset: number, period = PERIOD, eventDate = '2026-09-10'): Promise<CalculationReceipt> {
    assert.match(valueMinor, /^\d+$/); advance(offset);
    const imported = await request('sources.import', { sourceId: SOURCE, format: 'csv', recipe,
      content: HEADER + `observed-sale,sale,${eventDate},${valueMinor},INR,main,delivered,PRIVATE_PUBLIC_ALERT_ROW_${offset}\n`,
      expectedTotals: { rowCount: 1, amountMinor: valueMinor } });
    assert.equal(imported.qualification, 'experimental'); assert.equal(imported.coverage.reconciled, true);
    assert.equal(imported.totalsMinor, valueMinor); assert.equal(imported.rowIds.length, 1);
    const receipt = await calculate(offset, period);
    assert.equal(receipt.totalMinor, valueMinor); assert.equal(receipt.coverage.completeness, 'reconciled-imports');
    assert.deepEqual(receipt.requestedSourceIds, [SOURCE]); assert.deepEqual(receipt.rowIds, imported.rowIds);
    assert.ok(receipt.coverage.importIds.includes(imported.id));
    assert.deepEqual(await request('receipts.get', { id: receipt.id }), receipt);
    return receipt;
  }
  function definition(baseline: CalculationReceipt, overrides: Partial<AlertCreate> = {}): AlertCreate {
    return { conditionId: 'synthetic-earned-limit', label: 'PRIVATE_PUBLIC_ALERT_LABEL', baselineReceiptId: baseline.id,
      figureKey: 'total', unit: { kind: 'money', currency: 'INR' }, sourceIds: [SOURCE], periodMode: 'fixed', direction: 'above',
      activateMinor: '10000', clearMinor: '8000', activation: { observations: 2, durationMs: MINUTE },
      clearance: { observations: 2, durationMs: MINUTE }, severity: { initial: 'warning', criticalMinor: '20000', downgrade: 'on-clear' },
      reopening: 'same-episode', maxEvidenceAgeMs: 60 * MINUTE, maxObservationGapMs: 3 * MINUTE, ...overrides };
  }
  async function published(baseline: CalculationReceipt, overrides: Partial<AlertCreate> = {}): Promise<BusinessAlert> {
    const draft: BusinessAlert = await request('alerts.create', definition(baseline, overrides));
    assert.equal(draft.status, 'draft'); assert.equal(draft.revision, 1); assert.deepEqual(draft.observations, []);
    const alert: BusinessAlert = await request('alerts.publish', { id: draft.id, expectedRevision: draft.revision });
    assert.equal(alert.status, 'published'); assert.equal(alert.revision, 2); assert.deepEqual(alert.definition, draft.definition);
    return alert;
  }
  function evaluate(alert: BusinessAlert, receipt: CalculationReceipt, observationId: string, extra: Partial<AlertEvaluate> = {}): Promise<AlertEvaluation> {
    return request('alerts.evaluate', { id: alert.id, expectedRevision: alert.revision,
      observationId, observedAt: receipt.asOf, receiptId: receipt.id, ...extra });
  }
  async function emptyImport(offset: number) {
    advance(offset);
    return request('sources.import', { sourceId: SOURCE, format: 'csv', recipe, content: HEADER,
      expectedTotals: { rowCount: 0, amountMinor: '0' } });
  }
  async function restart() {
    await engine.close(); engine = new Engine(options);
    await request('workspace.open', { folder: 'acceptance', passphrase: PASSWORD });
  }
  const encrypted = () => readFile(join(directory, 'acceptance', 'authority.encrypted.json'), 'utf8');
  return { h, request, requestAs, at, advance, calculate, measurement, definition, published, evaluate, emptyImport, restart, encrypted, directory };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;
export const code = (expected: string) => (error: unknown) => error !== null && typeof error === 'object'
  && 'code' in error && error.code === expected;
