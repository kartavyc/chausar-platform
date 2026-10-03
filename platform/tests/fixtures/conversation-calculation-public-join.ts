import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Engine } from '../../runtime/engine.ts';
import { installSyntheticProductionStorage } from './synthetic-production-engine.ts';
import { createLocalServer } from '../../runtime/server.ts';

// Explicit coordinator integration gate, excluded from the ordinary test glob.
// It must fail on the pinned lane base until Gateway/Engine join these inputs.
// Real loopback HTTP; authored SYNTHETIC provider fixture; no external network.
const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
const PRIOR = { from: '2026-08-01', to: '2026-08-31' };
const ENDPOINT = 'https://synthetic-public-calculation.invalid/v1/responses';
const PASSWORD = 'SYNTHETIC disposable public calculation passphrase';

async function fixture(t: TestContext, operation: 'change' | 'scenario') {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-public-calculation-join-'));
  const calls: string[] = [];
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['fixture'], t.mock), gateway: {
    http: async request => {
      calls.push(request.body);
      const wire = { kind: 'execute', calls: [{ tool: 'calculator.calculate', args: {
        operation, period: PERIOD, branch: null, customerId: null,
        ...(operation === 'change' ? { comparePeriod: PRIOR } : { assumptions: { priceChangeBps: '00500' } }),
      } }], clarification: null };
      return { status: 200, endpoint: ENDPOINT, body: JSON.stringify({ status: 'completed', output: [
        { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(wire) }] },
      ] }) };
    },
  } });
  const app = createLocalServer(engine), { origin, token } = await app.listen();
  t.after(async () => {
    await app.close(5000);
    const target = resolve(directory);
    assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert.ok(basename(target).startsWith('chausar-public-calculation-join-'));
    await rm(target, { recursive: true, force: true });
  });
  async function rpc(method: string, payload: Record<string, unknown> = {}) {
    const response = await fetch(origin + '/api/rpc', { method: 'POST', headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
    }, body: JSON.stringify({ method, payload }) });
    const body = await response.json() as { result?: any; error?: { code: string; message: string } };
    if (body.error) throw Object.assign(new Error(body.error.message), { code: body.error.code });
    assert.equal(response.status, 200);
    return body.result;
  }
  await rpc('workspace.create', { name: 'SYNTHETIC public comparison business', folder: 'fixture',
    passphrase: PASSWORD, demo: false, pack: 'ecommerce' });
  for (const [sourceId, content, total] of [
    ['synthetic-current', 'current-one,sale,2026-09-02,10000,INR,main,delivered\ncurrent-two,sale,2026-09-03,20001,INR,main,delivered', '30001'],
    ['synthetic-prior-only', 'prior,sale,2026-08-02,12000,INR,main,delivered', '12000'],
    ['synthetic-unselected', 'outside-current,sale,2026-09-02,900000,INR,main,delivered\noutside-prior,sale,2026-08-02,800000,INR,main,delivered', '1700000'],
  ]) {
    const result = await rpc('sources.import', { sourceId, format: 'csv',
      content: 'id,kind,date,amount,currency,branch,status\n' + content,
      expectedTotals: { rowCount: content.split('\n').length, amountMinor: total },
      recipe: { version: 1, id: `${sourceId}-map`, system: 'synthetic-csv', edition: '1',
        scope: { company: 'SYNTHETIC public comparison business', branches: ['main'] }, bindings: [
          { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
          { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
          { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
          { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
          ...['currency', 'branch', 'status'].map(field => ({ target: field, source: field, type: 'string', nulls: 'reject' })),
        ], allowedKinds: ['sale'], allowedStatuses: ['delivered'], onUnmapped: 'reject' } });
    assert.equal(result.coverage.reconciled, true);
  }
  await rpc('models.configure', { config: { id: 'synthetic-join-route', kind: 'openai-responses',
    model: 'synthetic-authored-parameter-planner', endpoint: ENDPOINT, budgetMinor: '0', maxCostMinor: '0' },
    secret: 'synthetic-fixture-only' });
  await rpc('trust.update', { send: 'shape' });
  const request = { question: operation === 'change'
    ? 'SYNTHETIC: compare current September 2026 with prior August 2026 revenue.'
    : 'SYNTHETIC: assume exactly 00500 basis points price change for September 2026.',
    purpose: 'conversation', questionDisclosure: 'verbatim', routeId: 'synthetic-join-route',
    sourceIds: ['synthetic-current', 'synthetic-prior-only'], period: PERIOD,
    ...(operation === 'change' ? { comparePeriod: PRIOR } : { assumptions: { priceChangeBps: '00500' } }),
  };
  return { engine, rpc, request, calls };
}

for (const operation of ['change', 'scenario'] as const) {
  test(`coordinator HTTP join: ${operation} admits exact reviewed inputs and reopens the same answer and receipt`, async t => {
    const f = await fixture(t, operation), factsBefore = f.engine.vault!.read().facts;
    const preview = await f.rpc('models.preview', f.request);
    assert.equal(f.calls.length, 0);
    const schema = JSON.stringify(preview.schema);
    assert.ok(schema.includes(operation === 'change' ? 'comparePeriod' : 'priceChangeBps'),
      `PUBLIC_CALCULATION_JOIN_PENDING: ${operation} parameter schema absent; Gateway must supply reviewedCalculationParameters.`);
    const alternative = preview.schema.properties.calls.items.anyOf.find((candidate: any) =>
      candidate.properties.tool.enum.includes('calculator.calculate') && candidate.properties.args.properties.operation.enum?.includes(operation));
    assert.ok(alternative, 'The operation needs its own closed schema alternative.');
    const args = alternative.properties.args;
    assert.equal(args.additionalProperties, false);
    assert.deepEqual(args.properties.period.properties.from.enum, [PERIOD.from]);
    assert.deepEqual(args.properties.period.properties.to.enum, [PERIOD.to]);
    if (operation === 'change') {
      assert.deepEqual(args.required, ['operation', 'period', 'branch', 'customerId', 'comparePeriod']);
      assert.deepEqual(args.properties.comparePeriod.properties.from.enum, [PRIOR.from]);
      assert.deepEqual(args.properties.comparePeriod.properties.to.enum, [PRIOR.to]);
    } else {
      assert.deepEqual(args.required, ['operation', 'period', 'branch', 'customerId', 'assumptions']);
      assert.deepEqual(args.properties.assumptions.required, ['priceChangeBps']);
      assert.equal(args.properties.assumptions.additionalProperties, false);
      assert.deepEqual(args.properties.assumptions.properties.priceChangeBps.enum, ['00500']);
      assert.match(args.properties.assumptions.description, /Owner-requested/);
    }
    await assert.rejects(f.rpc('conversation.ask', { ...f.request, previewId: preview.id }), { code: 'OUTBOUND_APPROVAL_REQUIRED' });
    const approval = await f.rpc('models.approve', { id: preview.id });
    const changed = operation === 'change' ? { comparePeriod: { ...PRIOR, to: '2026-08-30' } } : { assumptions: { priceChangeBps: '00600' } };
    await assert.rejects(f.rpc('conversation.ask', { ...f.request, ...changed, previewId: preview.id, approvalId: approval.id }),
      { code: 'PREVIEW_REQUEST_CHANGED' });
    assert.equal(f.calls.length, 0, 'Changed reviewed inputs must refuse before provider entry.');
    const answer = await f.rpc('conversation.ask', { ...f.request, previewId: preview.id, approvalId: approval.id });
    assert.equal(answer.kind, 'grounded-conversation');
    assert.equal(answer.results.length, 1); assert.equal(answer.results[0].error, undefined);
    const receipt = answer.results[0].answer;
    assert.equal(receipt.totalMinor, operation === 'change' ? '18001' : '31501');
    assert.deepEqual(receipt.period, PERIOD);
    assert.deepEqual(receipt.requestedSourceIds, f.request.sourceIds);
    if (operation === 'change') assert.deepEqual(receipt.comparePeriod, PRIOR);
    else assert.equal(receipt.assumptions.status, 'Scenario only. Source facts are unchanged.');
    assert.ok(receipt.sourceIds.every((id: string) => f.request.sourceIds.includes(id)));
    const expected = operation === 'change'
      ? { current: '30001', previous: '12000', change: '18001', changeBps: '15000' }
      : { baseline: '30001', scenario: '31501', change: '1500', priceChangeBps: '500' };
    assert.deepEqual(Object.fromEntries(receipt.figures.map((figure: { key: string; minor: string }) => [figure.key, figure.minor])), expected);
    assert.deepEqual(f.engine.vault!.read().facts, factsBefore);
    assert.deepEqual(f.calls, [preview.payload]);
    await assert.rejects(f.rpc('conversation.ask', { ...f.request, previewId: preview.id, approvalId: approval.id }), { code: 'PREVIEW_NOT_FOUND' });
    await f.rpc('workspace.lock'); await f.rpc('workspace.open', { folder: 'fixture', passphrase: PASSWORD });
    assert.deepEqual(await f.rpc('receipts.get', { id: receipt.id }), receipt);
    assert.deepEqual((await f.rpc('conversation.get', { id: answer.id })).answer, answer);
    assert.equal(f.calls.length, 1);
  });
}
