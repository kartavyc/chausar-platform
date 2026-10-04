import test from 'node:test';
import assert from 'node:assert/strict';
import { hash, type Context, type StateStore } from '../runtime/contracts.ts';
import { ActionService, type Connector } from '../runtime/actions.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { IntlCalendarRules } from '../runtime/calendar-zone.ts';
import { Engine } from '../runtime/engine.ts';
import { EngineConnectorService } from '../runtime/engine-connectors.ts';
import { EngineTodayService, type EngineTodayOptions } from '../runtime/engine-today.ts';
import type { TodayAttentionSelectionPolicy, TodayPrepareTilesRequest } from '../runtime/engine-today-contracts.ts';
import { createEngineJobRunner } from '../runtime/engine-jobs.ts';
import { defaultRecipe, ImportService } from '../runtime/ingest.ts';
import { createJournalExecutionResolver } from '../runtime/journal-execution.ts';
import { JobService } from '../runtime/jobs.ts';
import { LearningService } from '../runtime/learning.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { ReportService } from '../runtime/reports.ts';
import { TodayAttentionService } from '../runtime/today-attention.ts';
import { TodayEventsService } from '../runtime/today-events.ts';
import { TodayReviewService } from '../runtime/today-review.ts';
import { TodayTilesService } from '../runtime/today-tiles.ts';
import { FixtureStateStore } from './database-fixtures.ts';

// Actual imported synthetic facts and shipped guarded services. No native SQL,
// credential/provider access, GUI, acquisition or business-effect execution.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const date = new Date().toISOString().slice(0, 10), timeZone = 'Etc/UTC';
const period = { from: '2026-09-01', to: '2026-09-30' };
async function fixture(selection?: TodayAttentionSelectionPolicy) {
  const backing = new FixtureStateStore(); let writes = 0, effects = 0, authority = 1;
  const store: StateStore = { read: backing.read.bind(backing), update: async change => { writes++; return backing.update(change); } };
  const ontology = new OntologyService(store); await ontology.publish(owner, 'ecommerce');
  const imports = new ImportService(store);
  await imports.commit(owner, { sourceId: 'today-books', format: 'csv', recipe: defaultRecipe(),
    content: 'id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch\n'
      + 'i,invoice,2026-09-01,100.00,INR,C,I,O,2026-09-20,unpaid,Synthetic invoice,main\n'
      + 'p,payment,2026-09-15,90.00,INR,C,I,O,,settled,Synthetic payment,main\n'
      + 's,sale,2026-09-01,80.00,INR,C,I,O,,delivered,Synthetic sale,main\n'
      + 'r,refund,2026-09-01,0.00,INR,C,I,O,,settled,Synthetic explicit zero refund,main\n'
      + 'c,cost,2026-09-15,50.00,INR,C,I,O,,settled,Synthetic cost,main\n',
    expectedTotals: { rowCount: 5, amountMinor: '32000' } });
  const connectors = new EngineConnectorService(store), opened: string[] = [];
  const guards = { consumerGuard: connectors.assertCalculationReady.bind(connectors), receiptGuard: connectors.assertReceiptReady.bind(connectors) };
  const calculator = new CalculatorService(store, guards), open = calculator.receipt.bind(calculator);
  calculator.receipt = (ctx, id) => { opened.push(id); return open(ctx, id); };
  const factory = Engine.prototype as unknown as { builtinActions(current: StateStore): Connector[] };
  const actions = new ActionService(store, factory.builtinActions(store));
  const reports = new ReportService(store, { ...guards, executionReceipt: createJournalExecutionResolver(actions) });
  const jobs = new JobService(store, { deliverableGuard: (ctx, job) => runner.canRelease(ctx, job) });
  const runner = createEngineJobRunner(store, jobs, actions, guards, {
    workerId: 'synthetic-today-spine', maxActiveJobs: 2, leaseMs: 1000, networkAvailable: () => { effects++; return false; },
  });
  const learning = new LearningService(store);
  const attention = new TodayAttentionService(store, {
    alertsOptions: view => ({ calculatorOptions: current => {
      const currentConnectors = new EngineConnectorService(current);
      return { consumerGuard: currentConnectors.assertCalculationReady.bind(currentConnectors), receiptGuard: currentConnectors.assertReceiptReady.bind(currentConnectors) };
    } }), reportOptions: view => {
      const currentConnectors = new EngineConnectorService(view);
      return { consumerGuard: currentConnectors.assertCalculationReady.bind(currentConnectors), receiptGuard: currentConnectors.assertReceiptReady.bind(currentConnectors), executionReceipt: createJournalExecutionResolver(actions) };
    },
  });
  const events = new TodayEventsService({ store, rules: new IntlCalendarRules({ timeZones: [timeZone], minYear: 2020, maxYear: 2100, maxCachedLocalTimes: 0 }),
    services: { learning, calculator, actions, reports, jobs } });
  const review = new TodayReviewService(store, { actions, jobs, authorityRevision: () => String(authority) });
  const tiles = new TodayTilesService(calculator);
  const options: EngineTodayOptions = { store, tiles, attention, events, review, authorityRevision: () => String(authority), ...(selection ? { selection } : {}) };
  const service = new EngineTodayService(options);
  const dictionary = ontology.current(owner)!;
  const configuration: TodayPrepareTilesRequest = { date, timeZone, configurationId: 'explicit-synthetic-three', configurationDigest: '',
    starterPack: { id: dictionary.pack, dictionaryHash: dictionary.hash, version: dictionary.version },
    request: { dictionaryHash: ontology.current(owner)!.hash, asOf: '2100-01-01T00:00:00.000Z', scope: { sourceIds: ['today-books'], branch: 'main' },
      tiles: [['billed', 'total'], ['received', 'total'], ['margin', 'contribution']].map(([operation, figureKey]) => ({
        id: operation, label: `Explicit synthetic ${operation}`, operation, figureKey, period,
        buckets: [{ id: 'first', label: 'Explicit first half', period: { from: '2026-09-01', to: '2026-09-15' } },
          { id: 'second', label: 'Explicit second half', period: { from: '2026-09-16', to: '2026-09-30' } }],
      })) } };
  configuration.configurationDigest = hash(configuration.request);
  return { backing, store, service, options, configuration, calculator, opened, actions, reports, review, attention, events, tiles,
    writes: () => writes, effects: () => effects, withdraw: () => { authority++; },
    prepareAction: (id: string) => actions.prepare(owner, { connector: 'local', operation: 'reminder-draft', payload: { invoiceId: 'I', text: `Synthetic ${id}` }, idempotencyKey: `today-fixture-${id}`, sourceIds: ['today-books'] }) };
}

test('uncaptured Today uses real read-only sections and preserves explicit unknown contracts', async () => {
  const f = await fixture(), before = hash(f.store.read()), writes = f.writes();
  const value = f.service.get(owner, { date, timeZone });
  assert.deepEqual(value.state, { kind: 'partial', asOf: null, reasonCode: 'TODAY_ENGINE_CONTRACT_PARTIAL' });
  assert.equal(value.atomic, false); assert.equal(value.noAction, true); assert.equal(value.productReviewCount, null);
  assert.deepEqual(value.tiles, { state: 'unavailable', reason: 'capture-required' });
  assert.equal(value.attention.state, 'available');
  if (value.attention.state === 'available') assert.deepEqual(value.attention.selection, { state: 'unavailable', reason: 'selection-policy-required', rows: [] });
  assert.equal(value.review.state, 'available');
  if (value.review.state === 'available') { assert.equal(value.review.value.count, null); assert.equal(value.review.value.knownCount, 0); }
  assert.equal(value.dayEvents.state, 'available');
  assert.equal(hash(f.store.read()), before); assert.equal(f.writes(), writes); assert.equal(f.effects(), 0);
});

test('explicit preparation issues exact capture and repeated get rereads every offscreen point without writes', async () => {
  const f = await fixture(), prepared = await f.service.prepareTiles(owner, f.configuration);
  assert.equal(prepared.result.tiles.length, 3); assert.equal(prepared.result.atomic, false);
  assert.deepEqual(prepared.result.tiles.map(tile => tile.value.figure!.minor), ['10000', '9000', '3000']);
  const ids = prepared.result.tiles.flatMap(tile => [tile.value.receiptId!, ...tile.points.map(point => point.value.receiptId!)]);
  assert.equal(ids.length, 9); const before = hash(f.store.read()), writes = f.writes(); f.opened.length = 0;
  for (let repeat = 0; repeat < 2; repeat++) {
    const value = f.service.get(owner, { date, timeZone, tileCapture: prepared.reference });
    assert.equal(value.tiles.state, 'prepared'); if (value.tiles.state === 'prepared') assert.deepEqual(value.tiles.value, prepared);
  }
  for (const id of ids) assert.ok(f.opened.filter(opened => opened === id).length >= 2, `Every point is reauthorized: ${id}`);
  assert.equal(hash(f.store.read()), before); assert.equal(f.writes(), writes); assert.equal(f.effects(), 0);
  prepared.result.tiles[0].value.figure!.minor = '999999';
  const again = f.service.get(owner, { date, timeZone, tileCapture: prepared.reference });
  if (again.tiles.state === 'prepared') assert.equal(again.tiles.value.result.tiles[0].value.figure!.minor, '10000');
  assert.throws(() => f.service.get(owner, { date, timeZone, tileCapture: { ...prepared.reference, digest: 'f'.repeat(64) } }), { code: 'TODAY_CAPTURE_UNAVAILABLE' });
});

test('same persistent eligible review set supplies four rows, scoped known count and every continuation', async () => {
  const f = await fixture(); for (let index = 0; index < 7; index++) await f.prepareAction(String(index));
  const before = hash(f.store.read()), initial = f.service.get(owner, { date, timeZone });
  assert.equal(initial.review.state, 'available'); if (initial.review.state !== 'available') assert.fail('Real review service must be present.');
  assert.equal(initial.review.value.rows.length, 4); assert.equal(initial.review.value.knownCount, 7); assert.equal(initial.review.value.count, null);
  const remainder = f.service.review(owner, { cursor: initial.review.value.nextCursor! });
  assert.equal(remainder.rows.length, 3); assert.equal(remainder.knownCount, 7); assert.equal(remainder.nextCursor, null);
  assert.equal(new Set([...initial.review.value.rows, ...remainder.rows].map(row => row.reference.id)).size, 7);
  assert.deepEqual(f.service.resolveReview(owner, remainder.rows[0].reference), remainder.rows[0]);
  assert.equal(hash(f.store.read()), before); assert.equal(f.effects(), 0);
});

test('current source revocation refuses a prepared capture, including empty offscreen receipt scope', async () => {
  const f = await fixture(), prepared = await f.service.prepareTiles(owner, f.configuration);
  await f.store.update(state => { state.sourceRules.push({ sourceId: 'today-books', revoked: true }); });
  const before = hash(f.store.read());
  assert.throws(() => f.service.get(owner, { date, timeZone, tileCapture: prepared.reference }), { code: 'SOURCE_REVOKED' });
  assert.equal(hash(f.store.read()), before); assert.equal(f.effects(), 0);
});

test('later selection callback withdrawing external authority withholds the whole renewed Today', async () => {
  let f!: Awaited<ReturnType<typeof fixture>>, armed = false;
  f = await fixture({ id: 'explicit-synthetic-selection', revision: () => 'synthetic-selection-v1', select: (_ctx, value) => {
    if (armed) f.withdraw(); return value.dueDecisions.map(row => row.reference);
  } });
  await f.reports.decision(owner, { text: 'Synthetic due decision', reviewDate: date, receiptIds: [], branch: 'main' });
  const before = hash(f.store.read()); armed = true;
  assert.throws(() => f.service.get(owner, { date, timeZone }), { code: 'TODAY_AUTHORITY_CHANGED' });
  assert.equal(hash(f.store.read()), before); assert.equal(f.effects(), 0);
});

test('explicit policy selects unchanged real evidence in configured order and shares the five-row cap', async () => {
  const f = await fixture({ id: 'explicit-synthetic-order', revision: () => 'synthetic-order-v1', select: (_ctx, value) => {
    const refs = value.dueDecisions.map(row => row.reference).reverse();
    value.dueDecisions.forEach(row => { row.text = 'Caller fabricated detached text'; });
    return refs;
  } });
  for (let index = 0; index < 3; index++) await f.reports.decision(owner, { text: `Synthetic due ${index}`, reviewDate: date, receiptIds: [], branch: 'main' });
  for (let index = 0; index < 7; index++) await f.prepareAction(String(index));
  const before = hash(f.store.read()), writes = f.writes(), value = f.service.get(owner, { date, timeZone });
  assert.equal(value.review.state, 'available'); assert.equal(value.attention.state, 'available'); assert.equal(value.dayEvents.state, 'available');
  if (value.review.state !== 'available' || value.attention.state !== 'available' || value.dayEvents.state !== 'available') assert.fail('Real sections must be present.');
  const selected = value.attention.selection; assert.equal(selected.state, 'configured');
  if (selected.state !== 'configured') assert.fail('An explicit policy must select real current evidence.');
  assert.equal(selected.eligibleCount, 3); assert.equal(selected.rows.length, 1);
  assert.equal(value.review.value.rows.length + selected.rows.length, 5);
  const row = selected.rows[0]; assert.equal(row.kind, 'due-decision');
  if (row.kind !== 'due-decision') assert.fail('This policy selects due decisions.');
  assert.equal(row.value.text, 'Synthetic due 2');
  assert.deepEqual(f.service.resolveAttention(owner, { date, timeZone, reference: row.value.reference }), row.value);
  assert.equal(value.dayEvents.value.events.length, 6); assert.ok(value.dayEvents.value.total >= 7);
  const event = value.dayEvents.value.events[0];
  assert.deepEqual(f.service.resolveEvent(owner, { date, timeZone, eventId: event.id }), event.reference);
  assert.throws(() => f.service.resolveEvent(owner, { date: '2026-09-01', timeZone, eventId: event.id }), { code: 'TODAY_EVENT_REFERENCE_UNAVAILABLE' });
  assert.equal(hash(f.store.read()), before); assert.equal(f.writes(), writes); assert.equal(f.effects(), 0);
});

test('selection refuses unknown, duplicate and arbitrary attention references without writes', async () => {
  let bad: 'unknown' | 'duplicate' | 'url' = 'unknown';
  const f = await fixture({ id: 'explicit-synthetic-refusals', revision: () => 'synthetic-refusals-v1', select: (_ctx, value) => {
    if (bad === 'unknown') return [{ kind: 'decision', decisionId: 'never-issued' }];
    if (bad === 'duplicate') return [value.dueDecisions[0].reference, value.dueDecisions[0].reference];
    return [{ kind: 'decision', decisionId: 'https://arbitrary.invalid' }];
  } });
  for (let index = 0; index < 2; index++) await f.reports.decision(owner, { text: `Synthetic ref ${index}`, reviewDate: date, receiptIds: [], branch: 'main' });
  const before = hash(f.store.read()), writes = f.writes();
  for (const kind of ['unknown', 'duplicate'] as const) { bad = kind; assert.throws(() => f.service.get(owner, { date, timeZone }), { code: 'TODAY_SELECTION_INVALID' }); }
  bad = 'url'; assert.throws(() => f.service.get(owner, { date, timeZone }), { code: 'TODAY_ATTENTION_REFERENCE_UNAVAILABLE' });
  assert.throws(() => f.service.resolveAttention(owner, { date, timeZone, reference: { kind: 'decision', decisionId: 'never-issued' } }), { code: 'TODAY_ATTENTION_REFERENCE_UNAVAILABLE' });
  assert.equal(hash(f.store.read()), before); assert.equal(f.writes(), writes); assert.equal(f.effects(), 0);
});

test('capture custody refuses caller results, changed display/context and a reopened runtime', async () => {
  const f = await fixture(), prepared = await f.service.prepareTiles(owner, f.configuration), before = hash(f.store.read()), writes = f.writes();
  for (const ctx of [{ ...owner, channel: 'phone' as const }, { ...owner, sourceTainted: true }]) {
    assert.throws(() => f.service.get(ctx, { date, timeZone, tileCapture: prepared.reference }), { code: 'TODAY_CAPTURE_UNAVAILABLE' });
  }
  assert.throws(() => f.service.get(owner, { date: '2026-09-01', timeZone, tileCapture: prepared.reference }), { code: 'TODAY_CAPTURE_UNAVAILABLE' });
  assert.throws(() => f.service.get(owner, { date, timeZone: 'UTC', tileCapture: prepared.reference }), { code: 'TODAY_CAPTURE_UNAVAILABLE' });
  assert.throws(() => new EngineTodayService(f.options).get(owner, { date, timeZone, tileCapture: prepared.reference }), { code: 'TODAY_CAPTURE_UNAVAILABLE' });
  assert.throws(() => f.service.get(owner, { date, timeZone, tileCapture: prepared } as unknown as Parameters<EngineTodayService['get']>[1]), { code: 'TODAY_INVALID_REQUEST' });
  assert.throws(() => f.service.get(owner, { date, timeZone, result: prepared.result } as unknown as Parameters<EngineTodayService['get']>[1]), { code: 'TODAY_INVALID_REQUEST' });
  assert.throws(() => f.service.resolveEvent(owner, { date, timeZone, eventId: 'never-issued', request: { method: 'jobs.accept' } } as unknown as Parameters<EngineTodayService['resolveEvent']>[1]), { code: 'TODAY_INVALID_REQUEST' });
  assert.equal(hash(f.store.read()), before); assert.equal(f.writes(), writes); assert.equal(f.effects(), 0);
});

test('real producer composition requires exact same store and explicit guarded optional services', async () => {
  const f = await fixture(), other = new FixtureStateStore(), before = hash(f.store.read()), writes = f.writes();
  assert.throws(() => new EngineTodayService({ ...f.options, review: new TodayReviewService(other) }), { code: 'TODAY_AUTHORITY_STORE_MISMATCH' });
  assert.throws(() => new EngineTodayService({ ...f.options, events: new TodayEventsService({ store: other }) }), { code: 'TODAY_AUTHORITY_STORE_MISMATCH' });
  assert.throws(() => new EngineTodayService({ ...f.options, attention: {} as TodayAttentionService }), { code: 'TODAY_SERVICE_REQUIRED' });
  assert.throws(() => new EngineTodayService({ ...f.options, authorityRevision: undefined } as unknown as EngineTodayOptions), { code: 'TODAY_AUTHORITY_REQUIRED' });
  const absent = new EngineTodayService({ store: f.store, authorityRevision: f.options.authorityRevision }).get(owner, { date, timeZone });
  assert.deepEqual(absent.tiles, { state: 'unavailable', reason: 'tiles-service-unavailable' });
  assert.deepEqual(absent.attention, { state: 'unavailable', reason: 'attention-service-unavailable' });
  assert.deepEqual(absent.review, { state: 'unavailable', reason: 'review-service-unavailable' });
  assert.deepEqual(absent.dayEvents, { state: 'unavailable', reason: 'events-service-unavailable' });
  const unguarded = new EngineTodayService({ ...f.options, attention: new TodayAttentionService(f.store) }).get(owner, { date, timeZone });
  assert.deepEqual(unguarded.attention, { state: 'unavailable', reason: 'attention-guards-required' });
  const permissive = new EngineTodayService({ ...f.options, attention: new TodayAttentionService(f.store, { alertsOptions: () => ({}), reportOptions: () => ({}) }) }).get(owner, { date, timeZone });
  assert.deepEqual(permissive.attention, { state: 'unavailable', reason: 'attention-guards-required' });
  assert.equal(hash(f.store.read()), before); assert.equal(f.writes(), writes); assert.equal(f.effects(), 0);
});

test('exact configuration digest, three tiles and chart bounds are checked before publication', async () => {
  const f = await fixture(), before = hash(f.store.read()), writes = f.writes();
  await assert.rejects(f.service.prepareTiles(owner, { ...f.configuration, configurationDigest: 'f'.repeat(64) }), { code: 'TODAY_CONFIGURATION_INVALID' });
  await assert.rejects(f.service.prepareTiles(owner, { ...f.configuration, request: { ...f.configuration.request, tiles: f.configuration.request.tiles.slice(0, 2) } }), { code: 'TODAY_CONFIGURATION_INVALID' });
  const tooMany = structuredClone(f.configuration); tooMany.request.tiles[0].buckets = Array.from({ length: 121 }, (_, index) => ({ id: `b${index}`, label: 'Synthetic bounded bucket', period }));
  tooMany.configurationDigest = hash(tooMany.request);
  await assert.rejects(f.service.prepareTiles(owner, tooMany), { code: 'TODAY_CONFIGURATION_INVALID' });
  await assert.rejects(f.service.prepareTiles(owner, { ...f.configuration, result: {} } as unknown as TodayPrepareTilesRequest), { code: 'TODAY_CONFIGURATION_INVALID' });
  await assert.rejects(f.service.prepareTiles({ ...owner, channel: 'phone' }, f.configuration), { code: 'TODAY_PREPARATION_FORBIDDEN' });
  await assert.rejects(f.service.prepareTiles({ ...owner, sourceTainted: true }, f.configuration), { code: 'TODAY_PREPARATION_FORBIDDEN' });
  assert.equal(hash(f.store.read()), before); assert.equal(f.writes(), writes); assert.equal(f.effects(), 0);
});

test('authentic source Tiles release refuses serialized or changed results and stale offscreen receipts', async () => {
  const f = await fixture(), held = await f.tiles.build(owner, f.configuration.request), before = hash(f.store.read()), writes = f.writes();
  assert.deepEqual(f.tiles.release(owner, held), held);
  assert.throws(() => f.tiles.release(owner, structuredClone(held)), { code: 'TODAY_TILES_HELD_RESULT_FORBIDDEN' });
  held.tiles[0].value.figure!.minor = '123456';
  assert.throws(() => f.tiles.release(owner, held), { code: 'TODAY_TILES_HELD_RESULT_FORBIDDEN' });
  assert.equal(hash(f.store.read()), before); assert.equal(f.writes(), writes);
  const prepared = await f.service.prepareTiles(owner, f.configuration), offscreenId = prepared.result.tiles[2].points[1].value.receiptId!;
  await f.store.update(state => { state.receipts.find(receipt => receipt.id === offscreenId).stale = true; });
  const staleBefore = hash(f.store.read()), staleWrites = f.writes();
  assert.throws(() => f.service.get(owner, { date, timeZone, tileCapture: prepared.reference }), { code: 'TODAY_TILES_RECEIPT_CHANGED' });
  assert.equal(hash(f.store.read()), staleBefore); assert.equal(f.writes(), staleWrites); assert.equal(f.effects(), 0);
});

test('comparison and every unavailable offscreen point keep current receipt authority', async () => {
  const f = await fixture(), config = structuredClone(f.configuration);
  config.request.tiles[0] = { ...config.request.tiles[0], operation: 'earned', figureKey: 'total',
    comparison: { operation: 'change', figureKey: 'change', period: { from: '2026-08-01', to: '2026-08-31' } } };
  config.configurationDigest = hash(config.request);
  const prepared = await f.service.prepareTiles(owner, config), comparisonId = prepared.result.tiles[0].comparison!.value.receiptId!;
  assert.ok(comparisonId); assert.equal(prepared.result.tiles[0].comparison!.value.figure, null);
  const before = hash(f.store.read()), writes = f.writes(); f.opened.length = 0;
  f.service.get(owner, { date, timeZone, tileCapture: prepared.reference });
  assert.ok(f.opened.includes(comparisonId));
  assert.equal(hash(f.store.read()), before); assert.equal(f.writes(), writes);
  await f.store.update(state => { state.receipts.find(receipt => receipt.id === comparisonId).figures.push({ key: 'fabricated', unit: 'money', currency: 'INR', minor: '10' }); });
  const changedBefore = hash(f.store.read());
  assert.throws(() => f.service.get(owner, { date, timeZone, tileCapture: prepared.reference }), { code: 'TODAY_TILES_RECEIPT_CHANGED' });
  assert.equal(hash(f.store.read()), changedBefore); assert.equal(f.effects(), 0);
});

test('persistent review cursors refuse changed eligible evidence and exact stale references', async () => {
  const f = await fixture(); for (let index = 0; index < 5; index++) await f.prepareAction(String(index));
  const first = f.service.review(owner), row = first.rows[0];
  await f.actions.cancel(owner, row.reference.id);
  const before = hash(f.store.read()), writes = f.writes();
  assert.throws(() => f.service.review(owner, { cursor: first.nextCursor! }), { code: 'REVIEW_QUEUE_CHANGED' });
  assert.throws(() => f.service.resolveReview(owner, row.reference), { code: 'REVIEW_REFERENCE_UNAVAILABLE' });
  assert.equal(f.service.review(owner).knownCount, 4);
  assert.equal(hash(f.store.read()), before); assert.equal(f.writes(), writes); assert.equal(f.effects(), 0);
});

test('permission epochs and changed live capture authority require explicit new preparation', async () => {
  const f = await fixture(), prepared = await f.service.prepareTiles(owner, f.configuration);
  f.withdraw(); const before = hash(f.store.read()), writes = f.writes();
  assert.throws(() => f.service.get(owner, { date, timeZone, tileCapture: prepared.reference }), { code: 'TODAY_CAPTURE_UNAVAILABLE' });
  assert.equal(hash(f.store.read()), before); assert.equal(f.writes(), writes);
  await f.store.update(state => { state.members.find(member => member.id === owner.memberId)!.epoch = 2; });
  const changedBefore = hash(f.store.read()), changedWrites = f.writes();
  assert.throws(() => f.service.get(owner, { date, timeZone, tileCapture: prepared.reference }), { code: 'ACCESS_REVOKED' });
  assert.throws(() => f.service.get({ ...owner, epoch: 2 }, { date, timeZone, tileCapture: prepared.reference }), { code: 'TODAY_CAPTURE_UNAVAILABLE' });
  assert.equal(hash(f.store.read()), changedBefore); assert.equal(f.writes(), changedWrites); assert.equal(f.effects(), 0);
});

test('current starter pack is explicit, defaults are unconfigured, and customization stays custom', async () => {
  const f = await fixture(), before = hash(f.store.read()), writes = f.writes();
  const initial = f.service.get(owner, { date, timeZone });
  assert.deepEqual(initial.starterPack, f.configuration.starterPack);
  assert.deepEqual(initial.defaults, { state: 'unconfigured', reason: 'pack-defaults-not-configured' });
  assert.equal(hash(f.store.read()), before); assert.equal(f.writes(), writes);
  const custom = structuredClone(f.configuration);
  custom.configurationId = 'synthetic-user-customization';
  custom.request.tiles = custom.request.tiles.map((tile, index) => ({ ...tile, id: `custom-earned-${index}`, operation: 'earned', figureKey: 'total' }));
  custom.configurationDigest = hash(custom.request);
  const prepared = await f.service.prepareTiles(owner, custom);
  assert.deepEqual(prepared.configuration.starterPack, custom.starterPack); assert.equal(prepared.configuration.origin, 'custom');
  assert.deepEqual(prepared.result.tiles.map(tile => tile.value.figure!.minor), ['8000', '8000', '8000']);
  const current = f.service.get(owner, { date, timeZone, tileCapture: prepared.reference });
  assert.deepEqual(current.starterPack, custom.starterPack); assert.equal(current.defaults.state, 'unconfigured');
  assert.equal(f.effects(), 0);
});

test('pack identity, exact published revision and request hash reject before any calculation', async () => {
  const f = await fixture(), before = hash(f.store.read()), writes = f.writes(); let calculations = 0;
  const calculate = f.calculator.calculate.bind(f.calculator);
  f.calculator.calculate = async (ctx, request) => { calculations++; return calculate(ctx, request); };
  for (const starterPack of [{ ...f.configuration.starterPack, id: 'retail' },
    { ...f.configuration.starterPack, dictionaryHash: 'f'.repeat(64) },
    { ...f.configuration.starterPack, version: f.configuration.starterPack.version + 1 }]) {
    await assert.rejects(f.service.prepareTiles(owner, { ...f.configuration, starterPack }), { code: 'TODAY_CONFIGURATION_INVALID' });
  }
  const scopeMismatch = structuredClone(f.configuration); scopeMismatch.request.dictionaryHash = 'f'.repeat(64);
  scopeMismatch.configurationDigest = hash(scopeMismatch.request);
  await assert.rejects(f.service.prepareTiles(owner, scopeMismatch), { code: 'TODAY_CONFIGURATION_INVALID' });
  assert.equal(calculations, 0); assert.equal(hash(f.store.read()), before); assert.equal(f.writes(), writes); assert.equal(f.effects(), 0);
});

test('republishing a pack refuses old configuration and stale capture before publication', async () => {
  const f = await fixture(), prepared = await f.service.prepareTiles(owner, f.configuration);
  const dictionary = await new OntologyService(f.store).publish(owner, 'ecommerce'), before = hash(f.store.read()), writes = f.writes();
  assert.equal(dictionary.version, f.configuration.starterPack.version + 1);
  assert.throws(() => f.service.get(owner, { date, timeZone, tileCapture: prepared.reference }), { code: 'TODAY_TILES_DEFINITION_CHANGED' });
  await assert.rejects(f.service.prepareTiles(owner, f.configuration), { code: 'TODAY_CONFIGURATION_INVALID' });
  assert.equal(hash(f.store.read()), before); assert.equal(f.writes(), writes); assert.equal(f.effects(), 0);
});

test('elapsed receipt retention refuses captured tiles with unchanged State and no publication', async t => {
  const f = await fixture(), prepared = await f.service.prepareTiles(owner, f.configuration);
  const state = f.store.read(), receipt = state.receipts.find(item => item.id === prepared.result.tiles[0].value.receiptId);
  const elapsed = Date.parse(receipt.createdAt) + state.policy.retentionDays * 86400000 + 1;
  const before = hash(state), writes = f.writes(); t.mock.method(Date, 'now', () => elapsed);
  assert.throws(() => f.service.get(owner, { date, timeZone, tileCapture: prepared.reference }), { code: 'TODAY_TILES_RETENTION_EXPIRED' });
  assert.equal(hash(f.store.read()), before); assert.equal(f.writes(), writes); assert.equal(f.effects(), 0);
});

test('elapsed counted fact retention refuses fresh receipts even before cleanup changes State', async t => {
  const f = await fixture(), clock = Date.now();
  // Explicit synthetic chronology is installed before capture. The response is
  // never credited as native/source-provider proof.
  await f.store.update(state => { state.facts.find(fact => fact.kind === 'invoice')!.learnedAt = new Date(clock - 89 * 86400000).toISOString(); });
  const prepared = await f.service.prepareTiles(owner, f.configuration), state = f.store.read();
  const receipt = state.receipts.find(item => item.id === prepared.result.tiles[0].value.receiptId);
  assert.equal(receipt.rowIds.length, 1); assert.ok(Date.parse(receipt.createdAt) > clock - 86400000);
  const before = hash(state), writes = f.writes(); t.mock.method(Date, 'now', () => clock + 2 * 86400000);
  assert.throws(() => f.service.get(owner, { date, timeZone, tileCapture: prepared.reference }), { code: 'TODAY_TILES_RETENTION_EXPIRED' });
  assert.equal(hash(f.store.read()), before); assert.equal(f.writes(), writes); assert.equal(f.effects(), 0);
});

test('elapsed excluded fact retention is checked in fresh prepared receipts with unchanged State', async t => {
  const f = await fixture(), clock = Date.now();
  await new ImportService(f.store).commit(owner, { sourceId: 'today-excluded', format: 'csv', recipe: defaultRecipe(),
    content: 'id,kind,date,amount,currency,invoiceId,status,branch\nx,invoice,2026-09-01,99.00,INR,X,cancelled,main\n',
    expectedTotals: { rowCount: 1, amountMinor: '9900' } });
  await f.store.update(state => { state.facts.find(fact => fact.sourceId === 'today-excluded')!.learnedAt = new Date(clock - 89 * 86400000).toISOString(); });
  const config = structuredClone(f.configuration); config.request.scope.sourceIds.push('today-excluded'); config.configurationDigest = hash(config.request);
  const prepared = await f.service.prepareTiles(owner, config), state = f.store.read();
  const excluded = state.facts.find(fact => fact.sourceId === 'today-excluded')!, receipt = state.receipts.find(item => item.id === prepared.result.tiles[0].value.receiptId);
  assert.ok(receipt.exclusions.some((item: { rowId: string }) => item.rowId === excluded.id));
  assert.ok(!receipt.rowIds.includes(excluded.id)); assert.ok(Date.parse(receipt.createdAt) > clock - 86400000);
  const before = hash(state), writes = f.writes(); t.mock.method(Date, 'now', () => clock + 2 * 86400000);
  assert.throws(() => f.service.get(owner, { date, timeZone, tileCapture: prepared.reference }), { code: 'TODAY_TILES_RETENTION_EXPIRED' });
  assert.equal(hash(f.store.read()), before); assert.equal(f.writes(), writes); assert.equal(f.effects(), 0);
});

test('matches exact reviewed calendar opaque IDs and provider version under current authority', async () => {
  const f = await fixture(), through = new Date(`${date}T00:00:00Z`); through.setUTCDate(through.getUTCDate() + 6);
  const at = new Date().toISOString(), version = 'Tax calendar 2026-10 revision 2', calendarId = 'Synthetic calendar / reviewed';
  const attention = new TodayAttentionService(f.store, { ...f.attention.options, calendar: () => ({
    state: 'reviewed', calendarId, version, sourceIds: ['today-books'], reviewedAt: at, reviewedBy: 'Synthetic reviewer', lastCheckedAt: at,
    applicability: { state: 'applicable', basis: 'Explicit synthetic reviewed calendar fixture' },
    coverage: { from: date, through: through.toISOString().slice(0, 10), timeZone },
    entries: [{ entryId: 'Synthetic obligation A', title: 'Synthetic reviewed obligation', dueDate: date,
      sourceUrl: 'https://example.invalid/synthetic-calendar', publishedAt: at, lastCheckedAt: at, reviewedAt: at, reviewedBy: 'Synthetic reviewer',
      applicability: { state: 'applicable', basis: 'Explicit synthetic reviewed entry fixture' } }],
  }) });
  const service = new EngineTodayService({ ...f.options, attention }), before = hash(f.store.read()), writes = f.writes();
  const value = service.get(owner, { date, timeZone }); assert.equal(value.attention.state, 'available');
  if (value.attention.state !== 'available' || value.attention.value.calendar.state !== 'reviewed') assert.fail('Actual reviewed source projection must be available.');
  const calendar = value.attention.value.calendar;
  assert.equal(calendar.reference.version, version); assert.equal(calendar.reference.calendarId, calendarId);
  assert.deepEqual(service.resolveAttention(owner, { date, timeZone, reference: calendar.reference }), calendar);
  assert.deepEqual(service.resolveAttention(owner, { date, timeZone, reference: calendar.rows[0].reference }), calendar.rows[0]);
  const selected = new EngineTodayService({ ...f.options, attention,
    selection: { id: 'synthetic-calendar-policy', revision: () => 'synthetic-calendar-v1', select: (_ctx, projection) => projection.calendar.rows.map(row => row.reference) } }).get(owner, { date, timeZone });
  if (selected.attention.state !== 'available' || selected.attention.selection.state !== 'configured') assert.fail('Opaque source refs must also remain selectable.');
  assert.equal(selected.attention.selection.eligibleCount, 1); assert.deepEqual(selected.attention.selection.rows[0].value, calendar.rows[0]);
  assert.throws(() => service.resolveAttention(owner, { date, timeZone, reference: { ...calendar.reference, version: `${version} altered` } }), { code: 'TODAY_ATTENTION_REFERENCE_UNAVAILABLE' });
  assert.throws(() => service.resolveAttention(owner, { date, timeZone, reference: { ...calendar.rows[0].reference, entryId: 'https://arbitrary.invalid' } }), { code: 'TODAY_ATTENTION_REFERENCE_UNAVAILABLE' });
  assert.equal(hash(f.store.read()), before); assert.equal(f.writes(), writes); assert.equal(f.effects(), 0);
});

test('matches exact custom published dictionary opaque pack identity before configuration', async () => {
  const f = await fixture(), ontology = new OntologyService(f.store), published = ontology.current(owner)!;
  const { pack: _pack, label: _label, version: _version, publishedAt: _at, publishedBy: _by, hash: _hash,
    operations: _operations, compiledSums: _compiled, schema: _schema, checks: _checks, ...draft } = published;
  const dictionary = await ontology.publish(owner, { ...draft, pack: 'Custom Acme workspace', label: 'Explicit synthetic custom dictionary' });
  const starterPack = { id: dictionary.pack, dictionaryHash: dictionary.hash, version: dictionary.version };
  const before = hash(f.store.read()), writes = f.writes(), initial = f.service.get(owner, { date, timeZone });
  assert.deepEqual(initial.starterPack, starterPack); assert.equal(initial.defaults.state, 'unconfigured');
  assert.equal(hash(f.store.read()), before); assert.equal(f.writes(), writes);
  const configuration = structuredClone(f.configuration); configuration.starterPack = starterPack;
  configuration.request.dictionaryHash = dictionary.hash; configuration.configurationDigest = hash(configuration.request);
  const prepared = await f.service.prepareTiles(owner, configuration);
  assert.deepEqual(prepared.configuration.starterPack, starterPack); assert.equal(prepared.configuration.origin, 'custom');
  const preparedBefore = hash(f.store.read()), preparedWrites = f.writes();
  await assert.rejects(f.service.prepareTiles(owner, { ...configuration, starterPack: { ...starterPack, id: `${starterPack.id} altered` } }), { code: 'TODAY_CONFIGURATION_INVALID' });
  assert.equal(hash(f.store.read()), preparedBefore); assert.equal(f.writes(), preparedWrites); assert.equal(f.effects(), 0);
});
