import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AlertsService, type AlertCreate, type AlertEvaluate, type BusinessAlert } from '../runtime/alerts.ts';
import { CalculatorService, type CalculationReceipt } from '../runtime/calculator.ts';
import type { Context } from '../runtime/contracts.ts';
import { ImportService } from '../runtime/ingest.ts';
import { MemoryService } from '../runtime/memory.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import { Vault } from '../runtime/vault.ts';

// Real local import/calculation services and encrypted experimental-file storage.
// Synthetic CSV totals are independent literal inputs, not installation or native-SQL qualification.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const period = { from: '2026-09-01', to: '2026-09-30' };
const sourceId = 'synthetic-alert-source';
const password = 'synthetic alerts acceptance passphrase';
const minute = 60_000;
const repository = fileURLToPath(new URL('../../', import.meta.url));

async function fixture(t: TestContext, nulls: 'reject' | 'exclude' = 'reject') {
  // Keep all generated snapshots in this C-only worktree, regardless of TEMP/TMP settings.
  if (process.platform === 'win32') assert.match(repository, /^C:[\\/]/i);
  const directory = await mkdtemp(join(repository, '.alerts-acceptance-'));
  let vault: Vault | undefined;
  t.after(async () => {
    await vault?.close();
    const target = resolve(directory), scope = relative(resolve(repository), target);
    assert.ok(scope.length > 0 && !scope.startsWith('..') && !isAbsolute(scope),
      'Acceptance cleanup must stay inside its repository directory.');
    await rm(target, { recursive: true, force: true });
  });
  vault = (await Vault.create({ directory, storage: 'experimental-file', passphrase: password,
    name: 'PRIVATE SYNTHETIC ALERT WORKSPACE', demo: true })).vault;
  const dictionary = structuredClone(starterPacks.find(pack => pack.pack === 'ecommerce')!);
  dictionary.definitions.find(definition => definition.name === 'earned')!.nulls = nulls;
  await new OntologyService(vault).publish(owner, dictionary);
  const base = Date.now() + minute;
  let currentTime = new Date(base).toISOString();
  const at = (offset: number) => new Date(base + offset * minute).toISOString();
  const clock = () => currentTime;
  const advance = (offset: number) => { currentTime = at(offset); return currentTime; };
  const service = () => new AlertsService(vault!, { clock });
  async function measurement(valueMinor: string, offset: number): Promise<CalculationReceipt> {
    assert.match(valueMinor, /^\d+$/);
    const amount = BigInt(valueMinor);
    const major = `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
    const content = 'id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch\n'
      + `observed-sale,sale,2026-09-10,${major},INR,SYNTHETIC_CUSTOMER,SYNTHETIC_INVOICE,SYNTHETIC_ORDER,,delivered,PRIVATE_SYNTHETIC_SOURCE_ROW_${offset},main\n`;
    const imported = await new ImportService(vault!).commit(owner, {
      sourceId, format: 'csv', content, expectedTotals: { rowCount: 1, amountMinor: valueMinor },
    });
    assert.equal(imported.qualification, 'experimental');
    assert.equal(imported.coverage.reconciled, true);
    assert.equal(imported.totalsMinor, valueMinor);
    assert.equal(imported.rowIds.length, 1);
    advance(offset);
    const receipt = await new CalculatorService(vault!).calculate(owner, {
      operation: 'earned', sourceIds: [sourceId], period, branch: 'main', asOf: at(offset),
    });
    assert.equal(receipt.valueMinor, valueMinor);
    assert.equal(receipt.coverage.completeness, 'reconciled-imports');
    assert.deepEqual(receipt.coverage.importIds.includes(imported.id), true);
    assert.deepEqual(receipt.requestedSourceIds, [sourceId]);
    assert.deepEqual(receipt.rowIds, imported.rowIds);
    return receipt;
  }
  async function published(baseline: CalculationReceipt, overrides: Partial<AlertCreate> = {}) {
    const created = await service().create(owner, {
      conditionId: 'synthetic-earned-revenue-limit', label: 'PRIVATE_SYNTHETIC_RECEIPT_ALERT',
      baselineReceiptId: baseline.id, figureKey: 'total', unit: { kind: 'money', currency: 'INR' },
      sourceIds: [sourceId], periodMode: 'fixed', direction: 'above', activateMinor: '10000', clearMinor: '8000',
      activation: { observations: 2, durationMs: minute }, clearance: { observations: 2, durationMs: minute },
      severity: { initial: 'warning', criticalMinor: '20000', downgrade: 'on-clear' }, reopening: 'same-episode',
      maxEvidenceAgeMs: 60 * minute, maxObservationGapMs: 60 * minute, ...overrides,
    });
    assert.equal(created.status, 'draft');
    const alert = await service().publish(owner, created.id, { expectedRevision: created.revision });
    assert.equal(alert.status, 'published');
    return alert;
  }
  async function evaluate(alert: BusinessAlert, receipt: CalculationReceipt, id: string) {
    const input: AlertEvaluate = { expectedRevision: alert.revision, observationId: id,
      observedAt: receipt.asOf, receiptId: receipt.id };
    return service().evaluate(owner, alert.id, input);
  }
  return {
    directory, at, advance, service, measurement, published, evaluate,
    store: () => vault!,
    async reopen() {
      await vault!.close();
      vault = await Vault.open({ directory, storage: 'experimental-file', passphrase: password });
      return service();
    },
  };
}

test('reconciled receipts activate one episode, respect hysteresis, escalate, clear and reopen through encrypted restart', async t => {
  const f = await fixture(t);
  let alert = await f.published(await f.measurement('5000', 0));
  let result = await f.evaluate(alert, await f.measurement('11000', 1), 'breach-first');
  alert = result.alert;
  assert.equal(alert.episodes.length, 0);
  assert.deepEqual(result.notices, []);
  result = await f.evaluate(alert, await f.measurement('12000', 2), 'breach-sustained');
  alert = result.alert;
  assert.equal(alert.episodes.length, 1);
  assert.equal(alert.episodes[0].status, 'open');
  assert.equal(alert.episodes[0].severity, 'warning');
  assert.deepEqual(result.notices.map(notice => notice.transition), ['opened']);
  const episodeId = alert.episodes[0].id;

  result = await f.evaluate(alert, await f.measurement('9000', 3), 'hysteresis-band');
  alert = result.alert;
  assert.equal(alert.observations.at(-1)!.state, 'band');
  assert.equal(alert.episodes[0].status, 'open');
  assert.deepEqual(result.notices, []);
  result = await f.evaluate(alert, await f.measurement('21000', 4), 'critical-breach');
  alert = result.alert;
  assert.deepEqual(result.notices.map(notice => notice.transition), ['escalated']);
  assert.equal(alert.episodes[0].severity, 'critical');
  result = await f.evaluate(alert, await f.measurement('11000', 5), 'warning-value-held-critical');
  alert = result.alert;
  assert.equal(alert.episodes[0].severity, 'critical');
  assert.deepEqual(result.notices, []);

  alert = (await f.evaluate(alert, await f.measurement('7000', 6), 'clear-first')).alert;
  assert.equal(alert.episodes[0].status, 'open');
  alert = (await f.evaluate(alert, await f.measurement('9000', 7), 'clear-reset-by-band')).alert;
  alert = (await f.evaluate(alert, await f.measurement('7100', 8), 'clear-after-reset-first')).alert;
  assert.equal(alert.episodes[0].status, 'open');
  result = await f.evaluate(alert, await f.measurement('7200', 9), 'clear-after-reset-sustained');
  alert = result.alert;
  assert.equal(alert.episodes[0].status, 'cleared');
  assert.equal(alert.episodes[0].clearedAt, f.at(9));
  assert.deepEqual(result.notices.map(notice => notice.transition), ['cleared']);

  alert = (await f.evaluate(alert, await f.measurement('11000', 10), 'reopen-first')).alert;
  assert.equal(alert.episodes[0].status, 'cleared');
  const lastReceipt = await f.measurement('12000', 11);
  const repeated: AlertEvaluate = { expectedRevision: alert.revision, observationId: 'reopen-sustained',
    observedAt: lastReceipt.asOf, receiptId: lastReceipt.id };
  result = await f.service().evaluate(owner, alert.id, repeated);
  alert = result.alert;
  assert.equal(alert.episodes.length, 1);
  assert.equal(alert.episodes[0].id, episodeId);
  assert.equal(alert.episodes[0].status, 'open');
  assert.equal(alert.episodes[0].severity, 'warning');
  assert.equal(alert.episodes[0].reopenCount, 1);
  assert.deepEqual(result.notices.map(notice => notice.transition), ['reopened']);
  const replay = await f.service().evaluate(owner, alert.id, repeated);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.alert.revision, alert.revision);
  assert.deepEqual(replay.notices, []);
  assert.equal(replay.alert.observations.length, 11);
  assert.ok(alert.notices.every(notice => notice.delivery === 'local-only'));
  assert.equal(f.store().read().jobs.length, 0);
  assert.equal(f.store().read().actions.length, 0);
  assert.equal(f.store().read().schedules.length, 0);

  const encrypted = await readFile(join(f.directory, 'authority.encrypted.json'), 'utf8');
  assert.equal(JSON.parse(encrypted).format, 'chausar.vault.v1');
  for (const secret of ['PRIVATE SYNTHETIC ALERT WORKSPACE', 'PRIVATE_SYNTHETIC_RECEIPT_ALERT',
    'PRIVATE_SYNTHETIC_SOURCE_ROW', 'business-alert-v1', password]) assert.equal(encrypted.includes(secret), false);
  const reopened = await f.reopen();
  assert.deepEqual(reopened.get(owner, alert.id), alert);
  assert.deepEqual(reopened.list(owner).map(saved => saved.id), [alert.id]);
  assert.equal(reopened.get(owner, alert.id).definition.baseline.receiptId, alert.definition.baselineReceiptId);
  assert.ok(f.store().read().receipts.every(receipt => receipt.coverage.importIds.length > 0));
});

test('missing, partial and stale low evidence preserve an open breach and reset clearance persistence', async t => {
  const f = await fixture(t, 'exclude');
  let alert = await f.published(await f.measurement('5000', 0));
  alert = (await f.evaluate(alert, await f.measurement('11000', 1), 'first')).alert;
  alert = (await f.evaluate(alert, await f.measurement('12000', 2), 'sustained')).alert;
  const episodeId = alert.episodes[0].id;

  const latest = new MemoryService(f.store()).query(owner, { period, branch: 'main' }).facts[0];
  await new MemoryService(f.store()).correct(owner, latest.id, { amountMinor: null });
  f.advance(3);
  const partial = await new CalculatorService(f.store()).calculate(owner, {
    operation: 'earned', sourceIds: [sourceId], period, branch: 'main', asOf: f.at(3),
  });
  assert.equal(partial.valueMinor, '0');
  assert.equal(partial.coverage.completeness, 'partial');
  assert.ok(partial.coverage.gaps.some(gap => gap.includes('not zero')));
  let result = await f.evaluate(alert, partial, 'partial-low');
  alert = result.alert;
  assert.equal(alert.observations.at(-1)!.state, 'unknown');
  assert.ok(alert.observations.at(-1)!.issues.includes('coverage-partial'));
  assert.equal(alert.episodes[0].status, 'open');
  assert.equal(alert.episodes[0].uncertain, true);
  assert.deepEqual(result.notices.map(notice => notice.transition), ['uncertain']);

  f.advance(4);
  result = await f.service().evaluate(owner, alert.id, { expectedRevision: alert.revision,
    observationId: 'missing-source', observedAt: f.at(4), missingReason: 'Synthetic export unavailable.' });
  alert = result.alert;
  assert.equal(alert.episodes[0].status, 'open');
  assert.equal(alert.observations.at(-1)!.state, 'unknown');
  assert.deepEqual(result.notices, []);

  const staleLow = await f.measurement('7000', 5);
  await f.measurement('15000', 5);
  assert.equal(new CalculatorService(f.store()).receipt(owner, staleLow.id).stale, true);
  result = await f.evaluate(alert, staleLow, 'stale-low');
  alert = result.alert;
  assert.equal(alert.observations.at(-1)!.state, 'unknown');
  assert.ok(alert.observations.at(-1)!.issues.includes('stale-receipt'));
  assert.equal(alert.episodes[0].status, 'open');
  assert.deepEqual(result.notices, []);

  result = await f.evaluate(alert, await f.measurement('7100', 6), 'restored-clear-first');
  alert = result.alert;
  assert.equal(alert.episodes[0].status, 'open');
  assert.equal(alert.episodes[0].uncertain, false);
  assert.deepEqual(result.notices.map(notice => notice.transition), ['evidence-restored']);
  result = await f.evaluate(alert, await f.measurement('7200', 7), 'restored-clear-sustained');
  alert = result.alert;
  assert.equal(alert.episodes[0].status, 'cleared');
  assert.equal(alert.episodes[0].id, episodeId);
  assert.deepEqual(result.notices.map(notice => notice.transition), ['cleared']);
  assert.equal(alert.episodes.length, 1);
});

test('later real import receipts append traceable amendments, retract and restore the original episode', async t => {
  const f = await fixture(t);
  let alert = await f.published(await f.measurement('5000', 0));
  const originalFirst = await f.measurement('11000', 1);
  alert = (await f.evaluate(alert, originalFirst, 'original-first')).alert;
  const originalSecond = await f.measurement('12000', 2);
  alert = (await f.evaluate(alert, originalSecond, 'original-second')).alert;
  const opened = structuredClone(alert.episodes[0]);
  const correctionLow = await f.measurement('5000', 3);
  let result = await f.service().evaluate(owner, alert.id, { expectedRevision: alert.revision,
    observationId: 'correction-low', observedAt: f.at(2), receiptId: correctionLow.id,
    correction: { observationId: 'original-second', reason: 'Independent synthetic corrected export restates this sample.' } });
  alert = result.alert;
  assert.equal(alert.episodes.length, 1);
  assert.equal(alert.episodes[0].id, opened.id);
  assert.equal(alert.episodes[0].status, 'retracted');
  assert.deepEqual(result.notices.map(notice => notice.transition), ['amended']);
  assert.equal(result.notices[0].before!.status, 'open');
  assert.equal(result.notices[0].after.status, 'retracted');
  assert.equal(alert.observations[1].receipt!.receiptId, originalSecond.id);
  assert.equal(alert.observations[2].amends, 'original-second');
  assert.equal(alert.observations[2].observedAt, f.at(2));
  assert.equal(alert.observations[2].recordedAt, f.at(3));
  assert.equal(alert.observations[2].receipt!.asOf, f.at(3));
  assert.match(alert.observations[2].amendmentReason!, /corrected export/);

  const correctionHigh = await f.measurement('13000', 4);
  result = await f.service().evaluate(owner, alert.id, { expectedRevision: alert.revision,
    observationId: 'correction-restored', observedAt: f.at(2), receiptId: correctionHigh.id,
    correction: { observationId: 'original-second', reason: 'A further reconciled correction restores the breach.' } });
  alert = result.alert;
  assert.equal(alert.episodes.length, 1);
  assert.equal(alert.episodes[0].id, opened.id);
  assert.equal(alert.episodes[0].status, 'open');
  assert.deepEqual(result.notices.map(notice => notice.transition), ['amended']);
  assert.equal(alert.observations.length, 4);
  assert.deepEqual(alert.observations.map(observation => observation.id),
    ['original-first', 'original-second', 'correction-low', 'correction-restored']);
  assert.ok(alert.receiptIds.includes(originalFirst.id) && alert.receiptIds.includes(originalSecond.id)
    && alert.receiptIds.includes(correctionLow.id) && alert.receiptIds.includes(correctionHigh.id));
  assert.deepEqual((await f.reopen()).get(owner, alert.id), alert);
});
