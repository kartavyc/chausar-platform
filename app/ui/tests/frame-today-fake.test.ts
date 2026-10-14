import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeEngine, registerFakeMethods, FAKE_SCENARIOS } from '../src/bridge/fake.ts';
import { createHostController } from '../src/host/controller.ts';
import { validateModelRoutes, validateUiContext } from '../src/host/contracts.ts';
import { projectCalculationReceipt } from '../src/bridge/validate.ts';
import { validateEngineToday, validateTodayQueue } from '../src/bridge/today-engine.ts';
import { validateOntologyReadback, validatePacks } from '../src/screens/first-run/contracts.ts';
import { publishedVerified, webCryptoDigest } from '../src/screens/first-run/digest.ts';
import {
  isActivityReply, isCapabilitiesReply, isChecklistReply, isFaultReport, isFirstRunStatusReply, isHelpReply, isIdentityCard, isIdentityCheckReply,
  isPhoneMessagesReply, isShellReply, isStatusReply, isWorthReply, notBuilt,
} from '../src/bridge/todayx-contract.ts';

const settle = async () => { for (let i = 0; i < 64; i++) await new Promise(resolve => setImmediate(resolve)); };
const codeOf = async (promise: Promise<unknown>) => { try { await promise; return null; } catch (error) { return (error as { code?: unknown }).code; } };

test('every scenario serves a valid ui.context, ontology readback and route catalogue (or a locked vault)', async () => {
  for (const scenario of FAKE_SCENARIOS) {
    const engine = createFakeEngine({ scenario });
    if (scenario === 'locked') { assert.equal(await codeOf(engine.request('ui.context', {})), 'VAULT_LOCKED'); continue; }
    const context = validateUiContext(await engine.request('ui.context', {}));
    assert.equal(context.workspace.name, 'Demo shop');
    assert.equal(context.member.role, scenario === 'read-only' ? 'viewer' : 'owner');
    const ontology = validateOntologyReadback(await engine.request('ontology.get', {}));
    assert.equal(ontology.current === null, scenario === 'first-run');
    if (ontology.current) assert.equal(await publishedVerified(ontology.current, webCryptoDigest()), true);
    validateModelRoutes(await engine.request('models.list', {}));
    assert.equal(validatePacks(await engine.request('ontology.packs', {})).length, 6);
  }
});

test('the host controller reaches a populated Today, prepares three tiles and opens their receipts', async () => {
  const engine = createFakeEngine();
  const controller = createHostController(engine, { todayProducer: await engine.todayProducer() });
  await controller.refresh(); await settle();
  assert.equal(controller.snapshot().phase, 'ready');
  assert.equal(controller.snapshot().todayConfiguration, 'configured');
  const consumer = controller.todayConsumer!;
  let today = consumer.snapshot();
  assert.equal(today.phase, 'ready');
  assert.equal(today.response?.review.state, 'available');
  if (today.response?.review.state !== 'available') throw Error('review');
  assert.equal(today.response.review.value.rows.length, 3);
  assert.equal(today.response.attention.state === 'available' && today.response.attention.selection.rows.length, 2);
  assert.equal(await consumer.prepare(today, () => true), true);
  today = consumer.snapshot();
  assert.equal(today.response?.tiles.state, 'prepared');
  if (today.response?.tiles.state !== 'prepared') throw Error('tiles');
  const tiles = today.response.tiles.value.result.tiles;
  assert.equal(tiles.length, 3);
  const receiptId = tiles[0]!.value.receiptId!;
  const detail = await consumer.receipt(today, receiptId, () => true);
  assert.equal(detail?.receipt?.id, receiptId);
  assert.equal(detail?.receipt?.figures[0]?.minor, '253685000');
  for (const tile of tiles) for (const point of tile.points) if (point.value.receiptId) projectCalculationReceipt(await engine.request('receipts.get', { id: point.value.receiptId }));
  const row = today.response.review.state === 'available' ? today.response.review.value.rows[0]! : null;
  const opened = await consumer.review(consumer.snapshot(), row!, () => true);
  assert.equal(opened?.kind, 'action');
  const page = validateTodayQueue(await engine.request('today.review', { limit: 4 }), 4);
  assert.equal(page.rows.length, 4); assert.ok(page.nextCursor);
  assert.equal(validateTodayQueue(await engine.request('today.review', { limit: 4, cursor: page.nextCursor }), 4).rows.length, 1);
  controller.dispose();
});

test('every day event and attention row resolves to a checked destination', async () => {
  const engine = createFakeEngine();
  const controller = createHostController(engine, { todayProducer: await engine.todayProducer() });
  await controller.refresh(); await settle();
  const consumer = controller.todayConsumer!;
  const response = consumer.snapshot().response!;
  if (response.dayEvents.state !== 'available' || response.attention.state !== 'available') throw Error('Expected events and attention');
  for (const event of response.dayEvents.value.events) assert.ok(await consumer.event(consumer.snapshot(), event.id, () => true), event.kind);
  for (const row of response.attention.selection.rows) assert.ok(await consumer.attention(consumer.snapshot(), row.id, () => true), row.kind);
  assert.equal(consumer.snapshot().phase, 'ready');
  controller.dispose();
});

test('the empty scenario answers with honest empties and unavailable figures, never invented amounts', async () => {
  const engine = createFakeEngine({ scenario: 'empty' });
  const producer = await engine.todayProducer();
  const context = validateUiContext(await engine.request('ui.context', {}));
  const response = validateEngineToday(await engine.request('today.get', producer.display!), producer.display!, context, producer.configuration);
  assert.equal(response.dayEvents.state, 'unavailable');
  assert.equal(response.review.state === 'available' && response.review.value.rows.length, 0);
  const prepared = await engine.request('today.prepareTiles', { ...producer.display!, ...producer.configuration! }) as { result: { tiles: { value: { status: string; figure: unknown } }[] } };
  assert.ok(prepared.result.tiles.every(tile => tile.value.status === 'unavailable' && tile.value.figure === null));
  assert.equal(await codeOf(engine.request('receipts.get', { id: 'rcpt_tile_billed' })), 'RECEIPT_NOT_FOUND');
});

test('every todayx method replies with a shape its contract validator accepts', async () => {
  for (const scenario of FAKE_SCENARIOS.filter(item => item !== 'locked')) {
    const engine = createFakeEngine({ scenario });
    assert.ok(isShellReply(await engine.request('todayx.shell', {})), scenario);
    assert.ok(isStatusReply(await engine.request('todayx.status', {})));
    assert.ok(isCapabilitiesReply(await engine.request('todayx.capabilities', {})));
    assert.ok(isWorthReply(await engine.request('todayx.worthALook', {})));
    const activity = await engine.request('todayx.activity', {});
    assert.ok(isActivityReply(activity));
    if (scenario === 'populated') assert.ok(isActivityReply(await engine.request('todayx.activity', { cursor: (activity as { nextCursor: string }).nextCursor })));
    assert.ok(isFirstRunStatusReply(await engine.request('todayx.firstRun.status', {})));
    assert.ok(isIdentityCheckReply(await engine.request('todayx.identity.check', { fields: { pan: 'ABCDE1234F', gstin: '27ABCDE1234F1Z0' } })));
    const card = await engine.request('todayx.identity.get', {});
    assert.ok(card === null || isIdentityCard(card));
    assert.ok(isChecklistReply(await engine.request('todayx.setupChecklist', {})));
    assert.ok(isHelpReply(await engine.request('todayx.help', {})));
    assert.ok(isFaultReport(await engine.request('todayx.faultReport', {})));
    assert.ok(isPhoneMessagesReply(await engine.request('todayx.phoneMessages', {})));
  }
});

test('identity checks are format checks with exact problem codes; a valid card saves', async () => {
  const engine = createFakeEngine();
  const card = await engine.request('todayx.identity.get', {}) as { fields: { gstin: string; pan: string } };
  assert.ok(isIdentityCard(card));
  const ok = await engine.request('todayx.identity.check', { fields: card.fields }) as { fields: Record<string, { ok: boolean; problem?: string }> };
  assert.deepEqual(ok.fields, { pan: { ok: true }, gstin: { ok: true } });
  const wrongCheck = card.fields.gstin.slice(0, 14) + (card.fields.gstin[14] === 'A' ? 'B' : 'A');
  const bad = await engine.request('todayx.identity.check', { fields: { pan: 'ABCDE12', gstin: wrongCheck, udyam: 'UDYAM!' } }) as { fields: Record<string, { ok: boolean; problem?: string; expectedLength?: number | null }> };
  assert.equal(bad.fields.pan?.problem, 'length'); assert.equal(bad.fields.pan?.expectedLength, 10);
  assert.equal(bad.fields.gstin?.problem, 'pan-mismatch');
  assert.equal(bad.fields.udyam?.problem, 'characters');
  const checksum = await engine.request('todayx.identity.check', { fields: { gstin: wrongCheck } }) as { fields: Record<string, { problem?: string }> };
  assert.equal(checksum.fields.gstin?.problem, 'checksum');
  assert.equal(await codeOf(engine.request('todayx.identity.save', { fields: { pan: 'BAD' }, gstMode: 'regular' })), 'IDENTITY_INVALID');
  assert.ok(isIdentityCard(await engine.request('todayx.identity.save', { fields: card.fields, gstMode: 'composition' })));
});

test('the demo clock moves forward only, in memory, and a real workspace keeps the real clock', async () => {
  const engine = createFakeEngine({ clock: '2026-09-30' });
  const advanced = await engine.request('todayx.clock.advance', { by: 'week' }) as { clock: { date: string }; banners: { kind: string; date?: string }[] };
  assert.equal(advanced.clock.date, '2026-10-07'); assert.equal(engine.date(), '2026-10-07');
  assert.equal(await codeOf(engine.request('todayx.clock.set', { date: '2026-10-01' })), 'INVALID_REQUEST');
  assert.ok(isShellReply(await engine.request('todayx.clock.set', { date: '2026-10-10' })));
  assert.equal(await codeOf(engine.request('todayx.clock.set', { date: '2026-10-11' })), 'DEMO_CLOCK_ALREADY_SET');
  const dismissed = await engine.request('todayx.jobsPaused.dismiss', {}) as { banners: { kind: string }[] };
  assert.ok(!dismissed.banners.some(banner => banner.kind === 'jobs-paused'));
  assert.equal(createFakeEngine({ clock: '2026-09-30' }).date(), '2026-09-30');
  const locked = createFakeEngine({ scenario: 'locked' });
  await locked.request('workspace.create', { name: 'Demo created shop', passphrase: 'synthetic passphrase', dictionaryMode: 'deferred', demo: false });
  assert.equal(await codeOf(locked.request('todayx.clock.advance', { by: 'day' })), 'DEMO_CLOCK_REAL_WORKSPACE');
  const viewer = createFakeEngine({ scenario: 'read-only' });
  assert.equal(await codeOf(viewer.request('todayx.clock.advance', { by: 'day' })), 'ACCESS_DENIED');
});

test('unknown methods say not built yet; registered lane handlers are served and removable', async () => {
  const engine = createFakeEngine();
  const error = await engine.request('books.sources', {}).catch((reason: unknown) => reason);
  assert.equal((error as { code: string }).code, 'UNKNOWN_METHOD'); assert.equal(notBuilt(error), true);
  const remove = registerFakeMethods('books', { sources: (_payload, context) => ({ rows: [], date: context.date }) });
  assert.deepEqual(await engine.request('books.sources', {}), { rows: [], date: '2026-09-30' });
  assert.ok(engine.methods().includes('books.sources'));
  remove();
  assert.equal(await codeOf(engine.request('books.sources', {})), 'UNKNOWN_METHOD');
  assert.throws(() => registerFakeMethods('today', { get: () => null }), /serves this family itself/);
});

test('first run publishes meanings in memory and the next readback verifies', async () => {
  const engine = createFakeEngine({ scenario: 'first-run' });
  const packs = validatePacks(await engine.request('ontology.packs', {}));
  const published = await engine.request('ontology.publish', { draft: packs[1], expectedCurrentHash: null, attemptId: 'fake-attempt' });
  const readback = validateOntologyReadback(await engine.request('ontology.get', {}));
  assert.equal(readback.current?.hash, (published as { hash: string }).hash);
  assert.equal(await publishedVerified(readback.current!, webCryptoDigest()), true);
  const attempt = await engine.request('ontology.get', { attemptId: 'fake-attempt' }) as { attempt: { version: number } };
  assert.equal(attempt.attempt.version, 1);
});

test('the fake is deterministic for the same options', async () => {
  const a = createFakeEngine(), b = createFakeEngine();
  for (const method of ['ui.context', 'todayx.activity', 'todayx.worthALook', 'ontology.get']) assert.deepEqual(await a.request(method, {}), await b.request(method, {}));
  assert.deepEqual(await a.todayProducer(), await b.todayProducer());
});

test('no production source imports the fake engine or its fixtures', () => {
  const src = fileURLToPath(new URL('../src/', import.meta.url));
  const files: string[] = [];
  const walk = (directory: string) => { for (const name of readdirSync(directory)) { const path = join(directory, name); if (statSync(path).isDirectory()) walk(path); else if (/\.(?:ts|tsx|js|mjs)$/.test(name)) files.push(path); } };
  walk(src);
  const allowed = (path: string) => { const rel = relative(src, path).split(sep).join('/'); return rel === 'bridge/fake.ts' || rel.startsWith('bridge/fixtures/'); };
  const offenders = files.filter(path => !allowed(path) && /(?:from\s+|import\s*\(\s*)['"][^'"]*(?:bridge\/fake|\/fake(?:\.ts)?|fixtures\/(?:shop|todayx))['"]/.test(readFileSync(path, 'utf8')));
  assert.deepEqual(offenders.map(path => relative(src, path)), []);
  // The detector itself catches the import forms.
  assert.ok(/(?:from\s+|import\s*\(\s*)['"][^'"]*(?:bridge\/fake|\/fake(?:\.ts)?|fixtures\/(?:shop|todayx))['"]/.test(`import { createFakeEngine } from '../bridge/fake.ts';`));
});
