import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import type { CalculationReceipt } from '../runtime/calculator.ts';
import type { ForecastRequest, SavedForecastEvaluation } from '../runtime/forecast-contracts.ts';
import type { Binding, ImportInput, MappingRecipe } from '../runtime/ingest.ts';
import type { Dictionary, DictionaryDraft } from '../runtime/ontology.ts';

// Synthetic CSV/import/receipt acceptance with the real encrypted experimental
// file Vault and paired loopback HTTP. Future event rows and retrospective cuts
// are deliberately authored fixtures, not observed customer history or predictive
// qualification. No internal State insertion, model dispatch or native DB claim.
const sourceId = 'synthetic-forecast-http-monthly-invoices';
const passphrase = 'Synthetic forecast HTTP acceptance fixture passphrase';
type RpcReply<T> = { result?: T; error?: { code: string; message: string } };
type ReturnedImport = { id: string; at: string; sourceId: string; rowIds: string[];
  coverage: { reconciled: boolean }; totalsMinor: string };
type MemberSession = { token: string; member: { id: string; epoch: number } };

function calendarMonth(offset: number, reference: Date) {
  const start = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + offset, 1));
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { from: start.toISOString().slice(0, 10), to: new Date(next.getTime() - 86400000).toISOString().slice(0, 10) };
}
const recipe: MappingRecipe = {
  version: 1, id: 'synthetic-forecast-http-invoice-money', system: 'synthetic-csv', edition: '1',
  scope: { company: 'Synthetic Historical Forecast Acceptance', branches: ['main'] },
  bindings: [
    { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
    { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
    ...['currency', 'branch', 'status', 'description'].map((field): Binding =>
      ({ target: field, source: field, type: 'string', nulls: 'reject' })),
  ], allowedKinds: ['invoice'], allowedStatuses: ['issued'], onUnmapped: 'reject',
};
function csvInput(rows: { month: { from: string; to: string }; amountMinor: string }[]): ImportInput {
  return { sourceId, format: 'csv', recipe: structuredClone(recipe),
    content: ['id,kind,date,amount,currency,branch,status,description', ...rows.map(({ month, amountMinor }) =>
      `month-${month.from},invoice,${month.from.slice(0, 8)}15,${amountMinor},INR,main,issued,Labelled synthetic monthly report`)].join('\n'),
    expectedTotals: { rowCount: rows.length, amountMinor: String(rows.reduce((total, row) => total + BigInt(row.amountMinor), 0n)) } };
}

async function fixture(t: TestContext) {
  const base = resolve(tmpdir()), directory = await mkdtemp(join(base, 'chausar-forecast-http-'));
  let providerCalls = 0;
  // Default local storage host; this fixture never configures the sync transport.
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file',
    gateway: { http: async () => { providerCalls++; throw new Error('Synthetic receipt-backed forecasts must not dispatch a provider.'); } } });
  const app = createLocalServer(engine), { origin, token } = await app.listen();
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  t.after(async () => {
    try { await app.close(); }
    finally {
      const target = resolve(directory), child = relative(base, target);
      assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && target.startsWith(join(base, 'chausar-forecast-http-')));
      await rm(target, { recursive: true, force: true });
    }
  });
  const paired = await fetch(`${origin}/api/session`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(paired.status, 200); assert.deepEqual(await paired.json(), { token });
  async function raw<T = unknown>(method: string, payload: unknown = {}, bearer = token) {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ method, payload }) });
    return { status: response.status, body: await response.json() as RpcReply<T> };
  }
  async function rpc<T = unknown>(method: string, payload: unknown = {}, bearer = token): Promise<T> {
    const result = await raw<T>(method, payload, bearer);
    assert.equal(result.status, 200, `${method}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.error, undefined); return result.body.result as T;
  }
  async function refused(method: string, payload: unknown, code: string, bearer = token) {
    const result = await raw(method, payload, bearer);
    assert.notEqual(result.status, 200, `${method} must refuse ${code}`);
    assert.equal(result.body.result, undefined); assert.equal(result.body.error?.code, code);
    return result;
  }
  await rpc('workspace.create', { name: 'Synthetic Historical Forecast Acceptance', passphrase, demo: false, pack: 'ecommerce' });
  const packs = await rpc<DictionaryDraft[]>('ontology.packs');
  const draft = structuredClone(packs.find(pack => pack.pack === 'ecommerce')!);
  assert.ok(draft);
  draft.definitions.find(definition => definition.name === 'billed')!.meaning =
    'Owner convention for this synthetic experiment: issued invoice report amounts excluding tax, by invoice event month. These are not cash collections or unconstrained demand.';
  const dictionary = await rpc<Dictionary>('ontology.publish', { draft });
  // Anchor the event calendar to the current import clock so this public fixture
  // stays valid when run later; no caller can backdate an import's learnedAt.
  const reference = new Date(), months = [-3, -2, -1, 0, 2].map(offset => calendarMonth(offset, reference));
  const values = ['10000', '20000', '30000', '45000', '62000'];
  const imported = await rpc<ReturnedImport>('sources.import', csvInput(months.map((month, index) => ({ month, amountMinor: values[index] }))));
  assert.equal(imported.coverage.reconciled, true); assert.equal(imported.rowIds.length, 5); assert.equal(imported.totalsMinor, '167000');
  const knowledgeCut = new Date().toISOString();
  assert.ok(Date.parse(imported.at) <= Date.parse(knowledgeCut));
  const scoringCut = calendarMonth(3, reference).from + 'T00:00:00.000Z';
  const request = (receipts: CalculationReceipt[]): ForecastRequest => ({
    version: 1, mode: 'operational-as-known', operation: 'billed', dictionaryHash: dictionary.hash,
    sourceIds: [sourceId], branch: 'main', horizonsMonths: [1, 3], cadenceMonths: 1,
    minimumTrainingMonths: 3, method: 'linear-trend-v1', benchmark: 'last-observed-v1', availabilityLagMs: 0,
    origins: [{ id: 'synthetic-last-closed-month-origin', eventCutoff: months[2].to, knowledgeCut,
      trainingReceiptIds: receipts.slice(0, 3).map(receipt => receipt.id),
      targets: [{ horizonMonths: 1, receiptId: receipts[3].id }, { horizonMonths: 3, receiptId: receipts[4].id }] }],
  });
  async function evidence(bearer = token) {
    const receipts: CalculationReceipt[] = [];
    for (const [index, period] of months.entries()) {
      const receipt = await rpc<CalculationReceipt>('calculation.run', { operation: 'billed', sourceIds: [sourceId],
        branch: 'main', period, asOf: index < 3 ? knowledgeCut : scoringCut }, bearer);
      assert.equal(receipt.totalMinor, values[index]); assert.equal(receipt.coverage.completeness, 'reconciled-imports');
      assert.deepEqual(receipt.coverage.gaps, []); assert.deepEqual(receipt.requestedSourceIds, [sourceId]);
      assert.ok(receipt.rowIds.every(rowId => imported.rowIds.includes(rowId)));
      receipts.push(receipt);
    }
    return { receipts, request: request(receipts) };
  }
  function noDispatch() { assert.equal(providerCalls, 0); assert.equal(engine.vault!.read().modelReceipts.length, 0); assert.equal(engine.vault!.read().actions.length, 0); }
  return { engine, directory, rpc, raw, refused, months, values, dictionary, imported, knowledgeCut, scoringCut,
    evidence, request, noDispatch, providerCalls: () => providerCalls };
}

function literalForecast(saved: SavedForecastEvaluation) {
  assert.equal(saved.type, 'forecast-evaluation-v1'); assert.equal(saved.mode, 'operational-as-known');
  assert.equal(saved.qualification, 'source-evidence-backtest'); assert.equal(saved.currency, 'INR');
  assert.deepEqual(saved.uncertainty, { calibratedIntervals: false, intervalType: 'none' });
  assert.equal(saved.methods.errorSign, 'prediction-minus-actual');
  assert.equal(saved.methods.target, 'individual-calendar-month');
  assert.equal(saved.methods.scoringBasis, 'emitted-integer-minor-prediction');
  assert.deepEqual(saved.origins[0].training.map(entry => entry.totalMinor), ['10000', '20000', '30000']);
  assert.deepEqual(saved.folds.map(fold => ({ horizon: fold.horizonMonths, actual: fold.actualMinor,
    prediction: fold.candidate.minor, error: fold.candidate.signedErrorMinor,
    absolute: fold.candidate.absoluteErrorMinor, squared: fold.candidate.squaredErrorMinor,
    baseline: fold.benchmark.minor, baselineError: fold.benchmark.signedErrorMinor })), [
    { horizon: 1, actual: '45000', prediction: '40000', error: '-5000', absolute: '5000', squared: '25000000', baseline: '30000', baselineError: '-15000' },
    { horizon: 3, actual: '62000', prediction: '60000', error: '-2000', absolute: '2000', squared: '4000000', baseline: '30000', baselineError: '-32000' },
  ]);
  assert.deepEqual(saved.horizons.map(horizon => [horizon.horizonMonths, horizon.scoredOrigins,
    horizon.requestedOrigins, horizon.candidate.meanAbsoluteErrorMinor, horizon.comparison]), [
    [1, 1, 1, { numerator: '5000', denominator: '1' }, 'lower-absolute-error'],
    [3, 1, 1, { numerator: '2000', denominator: '1' }, 'lower-absolute-error'],
  ]);
  assert.deepEqual(saved.sourceIds, [sourceId]); assert.match(saved.digest, /^[a-f0-9]{64}$/);
  assert.ok(saved.limitations.some(limitation => limitation.includes('not a deployment qualification')));
}

test('paired HTTP imports literal monthly evidence and saves one- and three-month forecasts through encrypted reopen', async t => {
  const f = await fixture(t), evidence = await f.evidence();
  const saved = await f.rpc<SavedForecastEvaluation>('forecasts.evaluate', evidence.request);
  literalForecast(saved); assert.equal(saved.dictionaryHash, f.dictionary.hash);
  assert.equal(saved.origins[0].knowledgeCut, f.knowledgeCut);
  assert.deepEqual(saved.folds.map(fold => fold.targetPeriod), [f.months[3], f.months[4]]);
  assert.deepEqual(saved.origins[0].training.map(entry => entry.receiptId), evidence.receipts.slice(0, 3).map(receipt => receipt.id));
  assert.deepEqual(await f.rpc('forecasts.get', { id: saved.id }), saved);
  const encrypted = await readFile(join(f.directory, 'main', 'authority.encrypted.json'), 'utf8');
  for (const plaintext of [sourceId, saved.id, saved.digest, passphrase]) assert.ok(!encrypted.includes(plaintext));
  f.noDispatch();
  await f.rpc('workspace.lock'); await f.rpc('workspace.open', { folder: 'main', passphrase });
  const reopened = await f.rpc<SavedForecastEvaluation>('forecasts.get', { id: saved.id });
  assert.deepEqual(reopened, saved); literalForecast(reopened);
  assert.equal(f.engine.vault!.read().answers.filter(answer => answer.type === 'forecast-evaluation-v1').length, 1);
  f.noDispatch();
});

test('paired HTTP excludes an actual later imported correction from an earlier operational forecast', async t => {
  const f = await fixture(t), evidence = await f.evidence();
  const baseline = await f.rpc<SavedForecastEvaluation>('forecasts.evaluate', evidence.request);
  literalForecast(baseline);
  const correction = await f.rpc<ReturnedImport>('sources.import', csvInput([{ month: f.months[1], amountMinor: '90000' }]));
  assert.equal(correction.coverage.reconciled, true); assert.equal(correction.rowIds.length, 1);
  assert.ok(Date.parse(correction.at) > Date.parse(f.knowledgeCut), 'The real correction import must be learned after the retained origin cut.');
  const late = await f.rpc<CalculationReceipt>('calculation.run', { operation: 'billed', sourceIds: [sourceId], branch: 'main',
    period: f.months[1], asOf: new Date().toISOString() });
  assert.equal(late.totalMinor, '90000'); assert.ok(Date.parse(late.asOf) > Date.parse(f.knowledgeCut));
  const request = structuredClone(evidence.request); request.origins[0].trainingReceiptIds.push(late.id);
  const operational = await f.rpc<SavedForecastEvaluation>('forecasts.evaluate', request);
  literalForecast(operational); assert.deepEqual(operational.folds, baseline.folds);
  assert.deepEqual(operational.origins[0].excludedTraining, [{ receiptId: late.id, reason: 'after-knowledge-cut' }]);
  assert.ok(!operational.origins[0].training.some(entry => entry.receiptId === late.id));
  const restated = await f.rpc<SavedForecastEvaluation>('forecasts.evaluate', { ...request, mode: 'restated-diagnostic' });
  assert.equal(restated.mode, 'restated-diagnostic');
  assert.deepEqual(restated.origins[0].training.map(entry => entry.totalMinor), ['10000', '90000', '30000']);
  assert.deepEqual(restated.folds.map(fold => [fold.horizonMonths, fold.candidate.minor, fold.candidate.signedErrorMinor]),
    [[1, '63333', '18333'], [3, '83333', '21333']]);
  assert.match(restated.interpretation, /not historical operational performance/);
  const reopened = await f.rpc<SavedForecastEvaluation>('forecasts.get', { id: operational.id });
  assert.deepEqual(reopened.folds, operational.folds);
  f.noDispatch();
});

test('paired HTTP forecasts.get refuses malformed or expanded payloads without creating evaluations', async t => {
  const f = await fixture(t), evidence = await f.evidence();
  const saved = await f.rpc<SavedForecastEvaluation>('forecasts.evaluate', evidence.request);
  const count = f.engine.vault!.read().answers.filter(answer => answer.type === 'forecast-evaluation-v1').length;
  for (const payload of [{}, { id: '' }, { id: 3 }, { id: {} }, { id: saved.id, sourceIds: [] },
    { id: saved.id, context: { memberId: 'invented-owner', epoch: 1 } }, { id: saved.id, resolvedEvidence: {} }, null]) {
    await f.refused('forecasts.get', payload, 'INVALID_FORECAST');
  }
  await f.refused('forecasts.get', [], 'INVALID_REQUEST');
  await f.refused('forecasts.evaluate', { ...evidence.request, resolvedEvidence: {} }, 'INVALID_FORECAST');
  assert.equal(f.engine.vault!.read().answers.filter(answer => answer.type === 'forecast-evaluation-v1').length, count);
  assert.deepEqual(await f.rpc('forecasts.get', { id: saved.id }), saved);
  f.noDispatch();
});

test('paired HTTP private forecast ownership and current revoked member epoch prevent saved replay', async t => {
  const f = await fixture(t), ownerEvidence = await f.evidence();
  const ownerSaved = await f.rpc<SavedForecastEvaluation>('forecasts.evaluate', ownerEvidence.request);
  const invitation = await f.rpc<{ token: string }>('auth.invite', { name: 'Synthetic forecast cofounder', role: 'cofounder', branches: ['main'] });
  const member = await f.rpc<MemberSession>('auth.accept', { token: invitation.token });
  await f.refused('forecasts.get', { id: ownerSaved.id }, 'FORECAST_FORBIDDEN', member.token);
  const memberEvidence = await f.evidence(member.token);
  const privateSaved = await f.rpc<SavedForecastEvaluation>('forecasts.evaluate', memberEvidence.request, member.token);
  assert.equal(privateSaved.memberId, member.member.id); assert.equal(privateSaved.epoch, member.member.epoch);
  assert.deepEqual(await f.rpc('forecasts.get', { id: privateSaved.id }, member.token), privateSaved);
  const revoked = await f.rpc<{ epoch: number; active: boolean }>('members.revoke', { id: member.member.id });
  assert.equal(revoked.epoch, member.member.epoch + 1); assert.equal(revoked.active, false);
  const staleSession = await f.refused('forecasts.get', { id: privateSaved.id }, 'UNAUTHENTICATED', member.token);
  assert.equal(staleSession.status, 401);
  await f.refused('forecasts.evaluate', memberEvidence.request, 'UNAUTHENTICATED', member.token);
  assert.deepEqual(await f.rpc('forecasts.get', { id: ownerSaved.id }), ownerSaved);
  f.noDispatch();
});

test('paired HTTP current source revocation blocks evaluate and get until the exact source is regranted', async t => {
  const f = await fixture(t), evidence = await f.evidence();
  const saved = await f.rpc<SavedForecastEvaluation>('forecasts.evaluate', evidence.request);
  await f.rpc('trust.update', { allowedSources: [] });
  await f.refused('forecasts.get', { id: saved.id }, 'SOURCE_REVOKED');
  await f.refused('forecasts.evaluate', evidence.request, 'SOURCE_REVOKED');
  await f.rpc('trust.update', { allowedSources: [sourceId] });
  assert.deepEqual(await f.rpc('forecasts.get', { id: saved.id }), saved);
  f.noDispatch();
});

test('paired HTTP source deletion cascades the saved forecast and prevents historical receipt replay after reopen', async t => {
  const f = await fixture(t), evidence = await f.evidence();
  const saved = await f.rpc<SavedForecastEvaluation>('forecasts.evaluate', evidence.request);
  const deleted = await f.rpc<{ sourceId: string; removed: number }>('sources.delete', { id: sourceId });
  assert.equal(deleted.sourceId, sourceId); assert.ok(deleted.removed > 0);
  assert.equal(f.engine.vault!.read().answers.some(answer => answer.id === saved.id), false);
  assert.equal(f.engine.vault!.read().receipts.some(receipt => saved.receiptIds.includes(receipt.id)), false);
  await f.refused('forecasts.get', { id: saved.id }, 'FORECAST_NOT_FOUND');
  await f.refused('forecasts.evaluate', evidence.request, 'SOURCE_REVOKED');
  await f.rpc('workspace.lock'); await f.rpc('workspace.open', { folder: 'main', passphrase });
  await f.refused('forecasts.get', { id: saved.id }, 'FORECAST_NOT_FOUND');
  await f.refused('receipts.get', { id: evidence.receipts[0].id }, 'RECEIPT_NOT_FOUND');
  f.noDispatch();
});
