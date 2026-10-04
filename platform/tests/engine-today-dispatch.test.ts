import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';
import type { ActionService, PreparedAction } from '../runtime/actions.ts';
import type { CalculatorService } from '../runtime/calculator.ts';
import type { CalculationReceipt } from '../runtime/calculator.ts';
import type { EngineTodayMethods, EngineTodayResponse, TodayPreparedTiles } from '../runtime/engine-today-contracts.ts';
import type { TodayReviewQueue, TodayReviewRow } from '../runtime/today-review.ts';
import { hash } from '../runtime/contracts.ts';
import { defaultRecipe } from '../runtime/ingest.ts';
import type { OntologyService } from '../runtime/ontology.ts';
import type { TodayTilesRequest } from '../runtime/today-tiles-contracts.ts';

// These tests use the actual experimental file Engine and encrypted Vault with
// explicitly synthetic local data. They make no native, SQL, browser, provider,
// model, acquisition or credential call and establish no native qualification.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const display = { date: '2026-09-30', timeZone: 'Asia/Kolkata' };
const passphrase = 'Synthetic Today Engine dispatcher passphrase';

async function fixture(t: TestContext) {
  const base = await realpath(tmpdir());
  const directory = await realpath(await mkdtemp(join(base, 'chausar-today-dispatch-')));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => {
    await engine.shutdown();
    const actual = await realpath(directory), child = relative(base, actual);
    assert.equal(dirname(actual), base);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-today-dispatch-'),
      'Only the exact test-created directory beneath the owned TMP may be removed.');
    await rm(actual, { recursive: true, force: true });
  });
  await engine.requestAs(owner, 'workspace.create', {
    name: 'Synthetic Today dispatcher workspace', demo: false, passphrase,
  });
  const ciphertextHash = async () => createHash('sha256')
    .update(await readFile(join(directory, 'main', 'authority.encrypted.json'))).digest('hex');
  return { engine, directory, ciphertextHash };
}

async function prepared(engine: Engine, number: number): Promise<PreparedAction> {
  return engine.requestAs(owner, 'actions.prepare', {
    connector: 'local', operation: 'reminder-draft', sourceIds: [],
    idempotencyKey: `synthetic-today-reminder-${number}`,
    payload: { invoiceId: `synthetic-invoice-${number}`, text: `Synthetic reminder ${number}` },
  });
}

test('Engine Today exposes the same scoped first four and full review queue without implicit preparation or effects', async t => {
  const { engine, ciphertextHash } = await fixture(t);
  const actions: PreparedAction[] = [];
  for (let number = 1; number <= 6; number++) actions.push(await prepared(engine, number));
  const actionService = engine.services.actions as ActionService;
  const operation = actionService.operation('local', 'reminder-draft');
  const execute = operation.execute, reconcile = operation.reconcile;
  let effects = 0, reconciliations = 0, calculations = 0;
  operation.execute = async (...args) => { effects++; return execute(...args); };
  operation.reconcile = async (...args) => { reconciliations++; return reconcile(...args); };
  const calculator = engine.services.calculator as CalculatorService;
  const calculate = calculator.calculate.bind(calculator);
  calculator.calculate = async (...args) => { calculations++; return calculate(...args); };
  const before = engine.vault!.read(), ciphertextBefore = await ciphertextHash();

  const first: EngineTodayResponse = await engine.requestAs(owner, 'today.get', display);
  const dictionary = (engine.services.ontology as OntologyService).current(owner); assert.ok(dictionary);
  const starterPack = { id: dictionary.pack, dictionaryHash: dictionary.hash, version: dictionary.version };
  assert.equal(first.kind, 'today-engine-v1'); assert.deepEqual(first.display, display);
  assert.deepEqual(first.starterPack, starterPack);
  assert.deepEqual(first.defaults, { state: 'unconfigured', reason: 'pack-defaults-not-configured' });
  assert.equal(first.atomic, false); assert.equal(first.noAction, true);
  assert.deepEqual(first.state, { kind: 'partial', asOf: null, reasonCode: 'TODAY_ENGINE_CONTRACT_PARTIAL' });
  assert.equal(first.productReviewCount, null, 'The supported review scope is not a whole-product count.');
  assert.deepEqual(first.tiles, { state: 'unavailable', reason: 'capture-required' },
    'A read has no default tile preset and cannot prepare calculations.');
  assert.equal(first.attention.state, 'available'); assert.ok(first.attention.state === 'available');
  assert.deepEqual(first.attention.selection, { state: 'unavailable', reason: 'selection-policy-required', rows: [] });
  assert.equal(first.attention.value.evaluated, false);
  assert.equal(first.attention.value.calendar.state, 'unavailable');
  assert.equal(first.review.state, 'available');
  assert.ok(first.review.state === 'available');
  const initial = first.review.value;
  assert.equal(initial.knownCount, 6); assert.equal(initial.count, null);
  assert.equal(initial.completeness, 'incomplete'); assert.equal(initial.rows.length, 4);
  assert.equal(initial.producers.lessons.status, 'unavailable');
  assert.ok(initial.nextCursor);
  const rest: TodayReviewQueue = await engine.requestAs(owner, 'today.review', { limit: 4, cursor: initial.nextCursor });
  const complete: TodayReviewQueue = await engine.requestAs(owner, 'today.review', { limit: 100 });
  assert.equal(rest.knownCount, initial.knownCount); assert.equal(rest.count, initial.count);
  assert.equal(rest.rows.length, 2); assert.equal(rest.nextCursor, null);
  assert.equal(complete.knownCount, initial.knownCount); assert.equal(complete.count, initial.count);
  assert.deepEqual([...initial.rows, ...rest.rows], complete.rows);
  assert.deepEqual(new Set(complete.rows.map(row => row.reference.id)), new Set(actions.map(action => action.id)));
  for (const row of complete.rows) {
    assert.equal(row.kind, 'action-approval'); assert.equal(row.canApprove, true);
    assert.equal(row.request.method, 'actions.approve');
    const resolved: TodayReviewRow = await engine.requestAs(owner, 'today.resolveReview', { reference: row.reference });
    assert.deepEqual(resolved, row, 'The exact current reference resolves through the real producer.');
  }
  const again: EngineTodayResponse = await engine.requestAs(owner, 'today.get', display);
  assert.deepEqual(again.review, first.review, 'Repeated Today reads retain the same eligible set, counts and queue.');
  assert.deepEqual(again.tiles, first.tiles); assert.deepEqual(again.state, first.state);
  assert.ok(again.attention.state === 'available');
  assert.equal(again.attention.value.pin, first.attention.value.pin,
    'A fresh read timestamp may change while the retained attention evidence stays pinned.');
  assert.equal(calculations, 0); assert.equal(effects, 0); assert.equal(reconciliations, 0);
  assert.deepEqual(engine.vault!.read(), before, 'Reads add no receipts, audit/activity, approval, draft, job or model record.');
  assert.equal(await ciphertextHash(), ciphertextBefore, 'Read dispatch does not rewrite encrypted authority bytes.');
});

test('Engine Today rejects revoked contexts and undeclared top-level input before reaching producer methods', async t => {
  const { engine, ciphertextHash } = await fixture(t);
  await prepared(engine, 1);
  const service = engine.services.today as EngineTodayMethods;
  assert.ok(service, 'The real Engine installs its coherent Today service.');
  let calls = 0;
  const get = service.get.bind(service), review = service.review.bind(service), resolveReview = service.resolveReview.bind(service);
  const prepareTiles = service.prepareTiles.bind(service), resolveEvent = service.resolveEvent.bind(service), resolveAttention = service.resolveAttention.bind(service);
  service.get = (...args) => { calls++; return get(...args); };
  service.review = (...args) => { calls++; return review(...args); };
  service.resolveReview = (...args) => { calls++; return resolveReview(...args); };
  service.prepareTiles = (...args) => { calls++; return prepareTiles(...args); };
  service.resolveEvent = (...args) => { calls++; return resolveEvent(...args); };
  service.resolveAttention = (...args) => { calls++; return resolveAttention(...args); };
  const before = engine.vault!.read(), ciphertextBefore = await ciphertextHash();
  for (const [method, payload] of [
    ['today.get', { ...display, tilePreset: 'silently-chosen' }],
    ['today.get', { ...display, custody: before }],
    ['today.review', { limit: 4, label: 'caller-owned title' }],
    ['today.resolveReview', { reference: { kind: 'action-approval', id: 'unissued', revision: 1, digest: '0'.repeat(64) }, method: 'actions.execute' }],
    ['today.prepareTiles', { ...display, starterPack: { id: 'ecommerce', dictionaryHash: '0'.repeat(64), version: 1 }, configurationId: 'unissued', configurationDigest: '0'.repeat(64), request: {}, hostPorts: 'caller-owned' }],
    ['today.resolveEvent', { ...display, eventId: 'unissued', method: 'actions.execute' }],
    ['today.resolveAttention', { ...display, reference: { kind: 'decision', decisionId: 'unissued' }, sourceUrl: 'caller-owned' }],
  ] as const) await assert.rejects(engine.requestAs(owner, method, payload), { code: 'INVALID_TODAY_REQUEST' });
  for (const method of ['today.get', 'today.review', 'today.resolveReview', 'today.prepareTiles', 'today.resolveEvent', 'today.resolveAttention']) {
    await assert.rejects(engine.requestAs({ ...owner, epoch: 2 }, method, display), { code: 'ACCESS_REVOKED' });
  }
  assert.equal(calls, 0, 'Neither invalid payloads nor a revoked context reach the Today producer.');
  assert.deepEqual(engine.vault!.read(), before); assert.equal(await ciphertextHash(), ciphertextBefore);
});

test('Engine Today prepares only explicit tiles, freshly reopens every receipt, and refuses the capture after lock and reopen', async t => {
  const { engine, ciphertextHash } = await fixture(t);
  const recipe = defaultRecipe();
  const amount = recipe.bindings.find(binding => binding.target === 'amountMinor');
  assert.ok(amount); amount.moneyUnit = 'minor'; amount.currency = 'INR';
  await engine.requestAs(owner, 'sources.import', {
    sourceId: 'synthetic-today-books', format: 'csv', recipe,
    content: 'id,kind,date,amount,currency,status,branch\nsynthetic-first,sale,2026-09-05,5,INR,settled,main\nsynthetic-second,sale,2026-09-25,7,INR,settled,main\n',
    expectedTotals: { rowCount: 2, amountMinor: '12' },
  });
  const dictionary = (engine.services.ontology as OntologyService).current(owner);
  assert.ok(dictionary);
  const request: TodayTilesRequest = {
    dictionaryHash: dictionary.hash, asOf: '2100-01-01T00:00:00.000Z',
    scope: { sourceIds: ['synthetic-today-books'], branch: 'main' },
    // Explicit synthetic configurations exercise custody. These labels and
    // repeated operations are fixture inputs, never an installed product preset.
    tiles: [1, 2, 3].map(number => ({
      id: `synthetic-explicit-earned-${number}`, label: `Explicit synthetic earned ${number}`,
      operation: 'earned', figureKey: 'total', period: { from: '2026-09-01', to: '2026-09-30' },
      buckets: [
        { id: 'first-half', label: 'Synthetic first half', period: { from: '2026-09-01', to: '2026-09-15' } },
        { id: 'second-half', label: 'Synthetic second half', period: { from: '2026-09-16', to: '2026-09-30' } },
      ],
    })),
  };
  const starterPack = { id: dictionary.pack, dictionaryHash: dictionary.hash, version: dictionary.version };
  const preparation = { ...display, starterPack, configurationId: 'synthetic-explicit-fixture-v1', configurationDigest: hash(request), request };
  const calculator = engine.services.calculator as CalculatorService;
  const calculate = calculator.calculate.bind(calculator); let calculations = 0;
  calculator.calculate = async (...args) => { calculations++; return calculate(...args); };
  const beforeInvalid = engine.vault!.read(), ciphertextBeforeInvalid = await ciphertextHash();
  const mismatchedDictionary = { ...request, dictionaryHash: '0'.repeat(64) };
  for (const invalid of [
    { ...preparation, starterPack: { ...starterPack, id: 'retail' } },
    { ...preparation, starterPack: { ...starterPack, version: starterPack.version + 1 } },
    { ...preparation, request: mismatchedDictionary, configurationDigest: hash(mismatchedDictionary) },
  ]) await assert.rejects(engine.requestAs(owner, 'today.prepareTiles', invalid), { code: 'TODAY_CONFIGURATION_INVALID' });
  assert.equal(calculations, 0, 'Pack identity, revision and request dictionary disagreement refuse before calculation or receipt publication.');
  assert.deepEqual(engine.vault!.read(), beforeInvalid); assert.equal(await ciphertextHash(), ciphertextBeforeInvalid);
  const saved: TodayPreparedTiles = await engine.requestAs(owner, 'today.prepareTiles', preparation);
  assert.deepEqual(saved.display, display);
  assert.equal(saved.configuration.id, 'synthetic-explicit-fixture-v1');
  assert.equal(saved.configuration.digest, hash(request));
  assert.deepEqual(saved.configuration.starterPack, starterPack); assert.equal(saved.configuration.origin, 'custom');
  assert.ok(saved.reference.id); assert.match(saved.reference.digest, /^[a-f0-9]{64}$/);
  assert.equal(saved.result.atomic, false);
  assert.equal(saved.result.verification, 'not-configured', 'File-preview math does not qualify a native SQL verifier.');
  const receiptIds: string[] = [];
  for (const tile of saved.result.tiles) {
    assert.equal(tile.value.figure?.minor, '12'); assert.equal(tile.value.status, 'available');
    assert.deepEqual(tile.points.map(point => point.value.figure?.minor), ['5', '7']);
    for (const value of [tile.value, ...tile.points.map(point => point.value)]) {
      assert.ok(value.receiptId); receiptIds.push(value.receiptId);
    }
  }
  assert.equal(receiptIds.length, 9); assert.equal(new Set(receiptIds).size, 9);
  assert.equal(calculations, 9, 'Only the explicit preparation performs the nine requested calculations.');
  const receipt = calculator.receipt.bind(calculator);
  const opened: string[] = []; calculations = 0;
  calculator.receipt = (context, id) => { opened.push(id); return receipt(context, id); };
  const before = engine.vault!.read(), ciphertextBefore = await ciphertextHash();
  for (let reading = 0; reading < 2; reading++) {
    opened.length = 0;
    const result: EngineTodayResponse = await engine.requestAs(owner, 'today.get', { ...display, tileCapture: saved.reference });
    assert.deepEqual(result.starterPack, starterPack);
    assert.deepEqual(result.defaults, { state: 'unconfigured', reason: 'pack-defaults-not-configured' });
    assert.equal(result.tiles.state, 'prepared'); assert.ok(result.tiles.state === 'prepared');
    assert.deepEqual(result.tiles.value, saved);
    for (const id of receiptIds) assert.ok(opened.includes(id), 'Every primary and offscreen chart point receipt is freshly authorized on this read.');
    for (const tile of result.tiles.value.result.tiles) {
      for (const value of [tile.value, ...tile.points.map(point => point.value)]) {
        const exact: CalculationReceipt = await engine.requestAs(owner, 'receipts.get', { id: value.receiptId });
        assert.deepEqual(value.figure, exact.figures.find(figure => figure.key === 'total'));
        assert.deepEqual(value.coverage, exact.coverage); assert.equal(value.definition?.dictionaryHash, exact.dictionaryHash);
      }
    }
  }
  await assert.rejects(engine.requestAs(owner, 'today.get', {
    ...display, tileCapture: { ...saved.reference, digest: '0'.repeat(64) },
  }), { code: 'TODAY_CAPTURE_UNAVAILABLE' });
  await assert.rejects(engine.requestAs(owner, 'today.get', {
    ...display, date: '2026-09-29', tileCapture: saved.reference,
  }), { code: 'TODAY_CAPTURE_UNAVAILABLE' });
  await assert.rejects(engine.requestAs({ ...owner, epoch: 2 }, 'today.get', {
    ...display, tileCapture: saved.reference,
  }), { code: 'ACCESS_REVOKED' });
  assert.equal(calculations, 0); assert.deepEqual(engine.vault!.read(), before);
  assert.equal(await ciphertextHash(), ciphertextBefore);

  await engine.requestAs(owner, 'workspace.lock');
  await engine.requestAs(owner, 'workspace.open', { passphrase });
  const reopened = engine.vault!.read(), reopenedCiphertext = await ciphertextHash();
  await assert.rejects(engine.requestAs(owner, 'today.get', { ...display, tileCapture: saved.reference }), { code: 'TODAY_CAPTURE_UNAVAILABLE' });
  const fresh: EngineTodayResponse = await engine.requestAs(owner, 'today.get', display);
  assert.deepEqual(fresh.tiles, { state: 'unavailable', reason: 'capture-required' });
  assert.deepEqual(fresh.starterPack, starterPack);
  assert.deepEqual(fresh.defaults, { state: 'unconfigured', reason: 'pack-defaults-not-configured' });
  assert.deepEqual(engine.vault!.read(), reopened); assert.equal(await ciphertextHash(), reopenedCiphertext);
});

test('Engine Today exact review references and continuation refuse a real action revision', async t => {
  const { engine, ciphertextHash } = await fixture(t);
  const actions: PreparedAction[] = [];
  for (let number = 1; number <= 5; number++) actions.push(await prepared(engine, number));
  const queue: TodayReviewQueue = await engine.requestAs(owner, 'today.review', { limit: 4 });
  assert.equal(queue.knownCount, 5); assert.ok(queue.nextCursor);
  const oldReference = queue.rows[0]!.reference, continuation = queue.nextCursor;
  const currentAction = actions.find(action => action.id === oldReference.id);
  assert.ok(currentAction);
  const revised: PreparedAction = await engine.requestAs(owner, 'actions.revise', {
    id: currentAction.id, payload: { invoiceId: 'synthetic-revised-invoice', text: 'Human-authored synthetic revision' },
  });
  assert.equal(revised.revision, currentAction.revision + 1); assert.notEqual(revised.digest, currentAction.digest);
  const before = engine.vault!.read(), ciphertextBefore = await ciphertextHash();
  await assert.rejects(engine.requestAs(owner, 'today.resolveReview', { reference: oldReference }), { code: 'REVIEW_REFERENCE_UNAVAILABLE' });
  await assert.rejects(engine.requestAs(owner, 'today.review', { limit: 4, cursor: continuation }), { code: 'REVIEW_QUEUE_CHANGED' });
  const fresh: TodayReviewQueue = await engine.requestAs(owner, 'today.review', { limit: 100 });
  assert.equal(fresh.knownCount, 5);
  const exact = fresh.rows.find(row => row.reference.id === revised.id); assert.ok(exact);
  assert.equal(exact.reference.revision, revised.revision); assert.equal(exact.reference.digest, revised.digest);
  assert.deepEqual(await engine.requestAs(owner, 'today.resolveReview', { reference: exact.reference }), exact);
  assert.deepEqual(engine.vault!.read(), before); assert.equal(await ciphertextHash(), ciphertextBefore);
});
