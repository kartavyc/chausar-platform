import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Engine } from '../../runtime/engine.ts';
import type { Context, Member } from '../../runtime/contracts.ts';
import type { CalculationReceipt, CalculationRequest } from '../../runtime/calculator.ts';
import type { ForecastRequest, SavedForecastEvaluation } from '../../runtime/forecast-contracts.ts';
import { preloadBridge } from './preload-bridge.ts';

// Synthetic CSV evidence through real preload/strict IPC and Engine. This qualifies
// the local experimental flow, not native storage, a connector, or predictive quality.
export const SOURCE = 'forecast-acceptance-export';
const PASSWORD = 'Synthetic forecast fixture only';
const COMPANY = 'Synthetic forecast business';
export const period = (month: number) => ({ from: `2026-${String(month).padStart(2, '0')}-01`,
  to: `2026-${String(month).padStart(2, '0')}-${month === 4 || month === 6 || month === 9 ? '30' : '31'}` });

export async function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-01T00:00:00.000Z') });
  const base = resolve(tmpdir()), directory = await mkdtemp(join(base, 'chausar-forecast-acceptance-'));
  const options = { directory, demo: true, storage: 'experimental-file' as const };
  let engine = new Engine(options), context: Context | undefined;
  t.after(async () => {
    await engine.close();
    const target = resolve(directory), child = relative(base, target);
    assert.ok(child && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child));
    assert.ok(basename(target).startsWith('chausar-forecast-acceptance-'));
    await rm(target, { recursive: true, force: true });
  });
  await engine.request('workspace.create', { name: COMPANY, folder: 'acceptance',
    passphrase: PASSWORD, demo: false, pack: 'retail' });
  const h = await preloadBridge({ dispatch: (method, payload) => context
    ? engine.requestAs(context, method, payload) : engine.request(method, payload) });
  const request = (method: string, payload: Record<string, unknown> = {}): Promise<any> => h.exposed.request(method, payload);
  await request('trust.update', { retentionDays: 3650 });
  const dictionaryHash = (await request('ontology.get')).current.hash as string;
  function advance(at: string) {
    const time = Date.parse(at); assert.ok(time >= Date.now(), 'Only advance the trusted fixture host clock.');
    t.mock.timers.setTime(time); assert.equal(new Date().toISOString(), new Date(at).toISOString());
  }
  async function importMonth(month: number, amountMinor: string, at: string) {
    advance(at);
    const input = { sourceId: SOURCE, format: 'csv',
      content: `id,kind,date,amount,currency,branch,status,customerId\nmonth-${month},sale,${period(month).from},${amountMinor},INR,main,settled,customer-main`,
      expectedTotals: { rowCount: 1, amountMinor }, recipe: { version: 1, id: 'forecast-acceptance-map',
        system: 'synthetic-csv', edition: '1', scope: { company: COMPANY, branches: ['main'] }, bindings: [
          { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
          { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
          { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
          { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
          ...['currency', 'branch', 'status', 'customerId'].map(field => ({ target: field, source: field, type: 'string', nulls: 'reject' })),
        ], allowedKinds: ['sale'], allowedStatuses: ['settled'], onUnmapped: 'reject' } };
    const imported = await request('sources.import', input);
    assert.equal(imported.coverage.reconciled, true); assert.equal(imported.totalsMinor, amountMinor);
    const selected = await request('memory.list', { period: period(month), branch: 'main' });
    assert.equal(selected.facts.length, 1); assert.equal(selected.facts[0].learnedAt, new Date(at).toISOString());
    assert.equal(selected.facts[0].fields.amountMinor, amountMinor);
    return imported;
  }
  async function calculate(month: number, at = new Date().toISOString(), extra: Partial<CalculationRequest> = {}): Promise<CalculationReceipt> {
    const receipt = await request('calculation.run', { operation: 'earned', sourceIds: [SOURCE], branch: 'main',
      period: period(month), asOf: at, ...extra });
    assert.equal(receipt.coverage.completeness, 'reconciled-imports'); assert.deepEqual(receipt.coverage.gaps, []);
    assert.equal(receipt.asOf, new Date(at).toISOString());
    assert.deepEqual(await request('receipts.get', { id: receipt.id }), receipt);
    return receipt;
  }
  async function reopen() {
    assert.deepEqual(await request('workspace.lock'), { locked: true });
    await assert.rejects(request('forecasts.get', { id: 'locked-probe' }), { code: 'VAULT_LOCKED' });
    await engine.close(); engine = new Engine(options);
    await request('workspace.open', { folder: 'acceptance', passphrase: PASSWORD });
  }
  const as = (member?: Member) => { context = member && { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' }; };
  const evaluate = (payload: ForecastRequest): Promise<SavedForecastEvaluation> => request('forecasts.evaluate', payload);
  const get = (id: string): Promise<SavedForecastEvaluation> => request('forecasts.get', { id });
  return { h, request, advance, importMonth, calculate, reopen, as, evaluate, get, dictionaryHash, directory };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;

export async function history(f: Fixture, options: { baseMinor?: string; earlyCorrection?: boolean } = {}) {
  const base = BigInt(options.baseMinor ?? '0'), receipts: Record<string, CalculationReceipt> = {};
  const amount = (delta: number) => String(base + BigInt(delta));
  for (const [month, delta, knownAt] of [
    [4, 100, '2026-05-01T00:00:00.000Z'], [5, 200, '2026-06-01T00:00:00.000Z'],
    [6, 300, '2026-07-01T00:00:00.000Z'], [7, 410, '2026-08-01T00:00:00.000Z'],
    [9, 630, '2026-10-01T00:00:00.000Z'],
  ] as const) {
    await f.importMonth(month, amount(delta), knownAt); receipts[String(month)] = await f.calculate(month);
    assert.equal(receipts[String(month)].totalMinor, amount(delta));
    if (month === 6 && options.earlyCorrection) {
      await f.importMonth(6, amount(320), '2026-07-02T00:00:00.000Z'); receipts.correctedJune = await f.calculate(6);
    }
  }
  return receipts;
}

export function forecast(f: Fixture, receipts: Record<string, CalculationReceipt>, changes: Partial<ForecastRequest> = {}): ForecastRequest {
  return { version: 1, mode: 'operational-as-known', operation: 'earned', dictionaryHash: f.dictionaryHash,
    sourceIds: [SOURCE], branch: 'main', horizonsMonths: [1, 2, 3], cadenceMonths: 1, minimumTrainingMonths: 3,
    method: 'linear-trend-v1', benchmark: 'last-observed-v1', availabilityLagMs: 0,
    origins: [{ id: 'june-origin', eventCutoff: '2026-06-30', knowledgeCut: '2026-07-01T00:00:00.000Z',
      trainingReceiptIds: [receipts['4'].id, receipts['5'].id, receipts['6'].id],
      targets: [{ horizonMonths: 1, receiptId: receipts['7'].id }, { horizonMonths: 3, receiptId: receipts['9'].id }] }], ...changes };
}
