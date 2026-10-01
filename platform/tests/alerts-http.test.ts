import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import type { AlertCreate, AlertEvaluate, AlertEvaluation, BusinessAlert } from '../runtime/alerts-contracts.ts';
import type { CalculationReceipt } from '../runtime/calculator.ts';
import type { DictionaryDraft } from '../runtime/ontology.ts';

// Actual paired Engine HTTP, import/calculation receipts and AES-GCM reopening.
// All business data and thresholds are synthetic owner inputs. Experimental file
// persistence is not native PostgreSQL, named connector or installed-app evidence.
const repository = fileURLToPath(new URL('../../', import.meta.url));
const passphrase = 'Synthetic receipt-backed alert HTTP fixture passphrase';
const sourceId = 'synthetic-http-alert-books';
const period = { from: '2026-09-01', to: '2026-09-30' };

async function fixture(t: TestContext) {
  if (process.platform === 'win32') assert.match(repository, /^C:[\\/]/i);
  const directory = await mkdtemp(join(repository, '.alerts-http-'));
  let providerCalls = 0, lastCut = 0, snapshotOrdinal = 0;
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file',
    gateway: { http: async () => { providerCalls++; throw new Error('A local receipt-backed alert must not dispatch a model.'); } } });
  const app = createLocalServer(engine), { origin, token } = await app.listen();
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  t.after(async () => {
    await app.close();
    const target = resolve(directory), scope = relative(resolve(repository), target);
    assert.ok(scope && !scope.startsWith('..') && !isAbsolute(scope)
      && target.startsWith(join(resolve(repository), '.alerts-http-')),
    'Fixture cleanup stays inside its C-scoped repository.');
    await rm(target, { recursive: true, force: true });
  });
  const paired = await fetch(`${origin}/api/session`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(paired.status, 200); assert.deepEqual(await paired.json(), { token });
  async function raw(method: string, payload: unknown = {}, bearer = token) {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ method, payload }) });
    return { status: response.status, body: await response.json() as any };
  }
  async function rpc(method: string, payload: unknown = {}, bearer = token): Promise<any> {
    const result = await raw(method, payload, bearer);
    assert.equal(result.status, 200, `${method}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.error, undefined); return result.body.result;
  }
  async function refused(method: string, payload: unknown, code: string, bearer = token) {
    const result = await raw(method, payload, bearer);
    assert.notEqual(result.status, 200, `${method} must refuse ${code}`);
    assert.equal(result.body.result, undefined); assert.equal(result.body.error.code, code);
    return result;
  }
  await rpc('workspace.create', { name: 'PRIVATE SYNTHETIC HTTP ALERT BUSINESS', passphrase, demo: false, pack: 'ecommerce' });
  const packs: DictionaryDraft[] = await rpc('ontology.packs');
  const draft = structuredClone(packs.find(pack => pack.pack === 'ecommerce')!);
  assert.ok(draft);
  draft.definitions.find(definition => definition.name === 'earned')!.meaning =
    'Owner convention: earned is delivered synthetic sale value in INR, by sale event date, excluding tax. This fixture does not establish collections or causes.';
  const dictionary = await rpc('ontology.publish', { draft });
  await rpc('trust.update', { send: 'nothing', autonomy: false });
  async function nextCut() {
    // Real host time is retained; no RPC-supplied clock or future evidence is used.
    while (Date.now() <= lastCut) await delay(1);
    lastCut = Date.now(); return new Date(lastCut).toISOString();
  }
  async function measurement(valueMinor: string, date = '2026-09-10', bearer = token): Promise<CalculationReceipt> {
    assert.match(valueMinor, /^\d+$/);
    const value = BigInt(valueMinor), major = `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
    // Each synthetic export is a newly authored snapshot. Reusing the bytes of
    // an older import is a duplicate retry, not a later restatement of facts.
    snapshotOrdinal++;
    const imported = await rpc('sources.import', { sourceId, format: 'csv',
      content: 'id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch\n'
        + `observed-sale,sale,${date},${major},INR,SYNTHETIC_CUSTOMER,SYNTHETIC_INVOICE,SYNTHETIC_ORDER,,delivered,PRIVATE_SYNTHETIC_ALERT_ROW_${snapshotOrdinal},main\n`,
      expectedTotals: { rowCount: 1, amountMinor: valueMinor } });
    assert.equal(imported.qualification, 'experimental');
    assert.equal(imported.coverage.reconciled, true); assert.equal(imported.totalsMinor, valueMinor);
    assert.equal(imported.rowIds.length, 1);
    const receipt: CalculationReceipt = await rpc('calculation.run', {
      operation: 'earned', sourceIds: [sourceId], period, branch: 'main', asOf: await nextCut(),
    }, bearer);
    assert.equal(receipt.valueMinor, date <= period.to ? valueMinor : '0');
    assert.equal(receipt.currency, 'INR'); assert.equal(receipt.dictionaryHash, dictionary.hash);
    assert.deepEqual(receipt.requestedSourceIds, [sourceId]);
    assert.deepEqual(await rpc('receipts.get', { id: receipt.id }, bearer), receipt);
    return receipt;
  }
  function definition(baseline: CalculationReceipt, overrides: Partial<AlertCreate> = {}): AlertCreate {
    return { conditionId: 'synthetic-earned-main-limit', label: 'PRIVATE_SYNTHETIC_HTTP_ALERT',
      baselineReceiptId: baseline.id, figureKey: 'total', unit: { kind: 'money', currency: 'INR' },
      sourceIds: [sourceId], periodMode: 'fixed', direction: 'above', activateMinor: '10000', clearMinor: '8000',
      activation: { observations: 2, durationMs: 0 }, clearance: { observations: 2, durationMs: 0 },
      severity: { initial: 'warning', criticalMinor: '20000', downgrade: 'on-clear' }, reopening: 'same-episode',
      maxEvidenceAgeMs: 3_600_000, maxObservationGapMs: 3_600_000, ...overrides };
  }
  async function published(baseline: CalculationReceipt, overrides: Partial<AlertCreate> = {}, bearer = token): Promise<BusinessAlert> {
    const created: BusinessAlert = await rpc('alerts.create', definition(baseline, overrides), bearer);
    assert.equal(created.status, 'draft'); assert.equal(created.revision, 1);
    const alert: BusinessAlert = await rpc('alerts.publish', { id: created.id, expectedRevision: created.revision }, bearer);
    assert.equal(alert.status, 'published'); assert.equal(alert.definition.dictionaryHash, dictionary.hash);
    assert.equal(alert.definition.operation, 'earned'); assert.equal(alert.definition.branch, 'main');
    return alert;
  }
  async function evaluate(alert: BusinessAlert, receipt: CalculationReceipt, observationId: string, bearer = token): Promise<AlertEvaluation> {
    return rpc('alerts.evaluate', { id: alert.id, expectedRevision: alert.revision,
      observationId, observedAt: receipt.asOf, receiptId: receipt.id }, bearer);
  }
  function localOnly() {
    const state = engine.vault!.read();
    assert.equal(providerCalls, 0); assert.equal(state.modelReceipts.length, 0);
    assert.equal(state.jobs.length, 0); assert.equal(state.actions.length, 0); assert.equal(state.schedules.length, 0);
  }
  async function reopen() {
    await rpc('workspace.lock'); await rpc('workspace.open', { folder: 'main', passphrase });
  }
  async function member() {
    const invite = await rpc('auth.invite', { name: 'Synthetic private alert author', role: 'cofounder', branches: ['main'] });
    return rpc('auth.accept', { token: invite.token });
  }
  return { directory, engine, rpc, raw, refused, measurement, definition, published, evaluate,
    nextCut, localOnly, reopen, member, draft };
}

test('paired HTTP receipt alert sustains one episode, escalates, clears, reopens and survives encrypted restart', async t => {
  const f = await fixture(t);
  let alert = await f.published(await f.measurement('5000'));
  let result = await f.evaluate(alert, await f.measurement('11000'), 'breach-first');
  alert = result.alert; assert.deepEqual(alert.episodes, []); assert.deepEqual(result.notices, []);
  const second = await f.measurement('12000');
  const replayInput = { id: alert.id, expectedRevision: alert.revision,
    observationId: 'breach-sustained', observedAt: second.asOf, receiptId: second.id };
  result = await f.rpc('alerts.evaluate', replayInput); alert = result.alert;
  assert.equal(alert.episodes.length, 1); assert.equal(alert.episodes[0].status, 'open');
  assert.equal(alert.episodes[0].severity, 'warning');
  assert.deepEqual(result.notices.map(notice => notice.transition), ['opened']);
  const episodeId = alert.episodes[0].id;
  const replay: AlertEvaluation = await f.rpc('alerts.evaluate', replayInput);
  assert.equal(replay.duplicate, true); assert.deepEqual(replay.alert, alert); assert.deepEqual(replay.notices, []);
  await f.refused('alerts.evaluate', { ...replayInput, missingReason: 'Changed occurrence', receiptId: undefined }, 'ALERT_OBSERVATION_CONFLICT');
  result = await f.evaluate(alert, await f.measurement('21000'), 'critical'); alert = result.alert;
  assert.equal(alert.episodes[0].severity, 'critical');
  assert.deepEqual(result.notices.map(notice => notice.transition), ['escalated']);
  result = await f.evaluate(alert, await f.measurement('9000'), 'hysteresis-band'); alert = result.alert;
  assert.equal(alert.observations.at(-1)!.state, 'band'); assert.equal(alert.episodes[0].status, 'open');
  assert.equal(alert.episodes[0].severity, 'critical'); assert.deepEqual(result.notices, []);
  result = await f.evaluate(alert, await f.measurement('7000'), 'clear-first'); alert = result.alert;
  assert.equal(alert.episodes[0].status, 'open'); assert.deepEqual(result.notices, []);
  result = await f.evaluate(alert, await f.measurement('7200'), 'clear-sustained'); alert = result.alert;
  assert.equal(alert.episodes[0].status, 'cleared'); assert.equal(alert.episodes[0].severity, 'critical');
  assert.deepEqual(result.notices.map(notice => notice.transition), ['cleared']);
  alert = (await f.evaluate(alert, await f.measurement('11000'), 'reopen-first')).alert;
  assert.equal(alert.episodes[0].status, 'cleared');
  result = await f.evaluate(alert, await f.measurement('12000'), 'reopen-sustained'); alert = result.alert;
  assert.equal(alert.episodes.length, 1); assert.equal(alert.episodes[0].id, episodeId);
  assert.equal(alert.episodes[0].status, 'open'); assert.equal(alert.episodes[0].reopenCount, 1);
  assert.deepEqual(result.notices.map(notice => notice.transition), ['reopened']);
  assert.ok(alert.notices.every(notice => notice.delivery === 'local-only'));
  assert.deepEqual(await f.rpc('alerts.list'), [alert]);
  const encrypted = await readFile(join(f.directory, 'main', 'authority.encrypted.json'), 'utf8');
  assert.equal(JSON.parse(encrypted).format, 'chausar.vault.v1');
  for (const value of ['PRIVATE SYNTHETIC HTTP ALERT BUSINESS', 'PRIVATE_SYNTHETIC_HTTP_ALERT',
    'PRIVATE_SYNTHETIC_ALERT_ROW', 'business-alert-v1', passphrase]) assert.equal(encrypted.includes(value), false);
  await f.reopen(); assert.deepEqual(await f.rpc('alerts.get', { id: alert.id }), alert);
  assert.deepEqual(await f.rpc('alerts.list'), [alert]);
  const afterRestart: AlertEvaluation = await f.rpc('alerts.evaluate', replayInput);
  assert.equal(afterRestart.duplicate, true); assert.deepEqual(afterRestart.notices, []);
  assert.equal(afterRestart.alert.notices.length, alert.notices.length); f.localOnly();
});

test('paired HTTP missing and complete-empty-looking receipt evidence cannot clear a saved breach', async t => {
  const f = await fixture(t);
  let alert = await f.published(await f.measurement('5000'), {
    activation: { observations: 1, durationMs: 0 }, clearance: { observations: 1, durationMs: 0 },
  });
  alert = (await f.evaluate(alert, await f.measurement('11000'), 'open')).alert;
  const episodeId = alert.episodes[0].id;
  let result: AlertEvaluation = await f.rpc('alerts.evaluate', { id: alert.id, expectedRevision: alert.revision,
    observationId: 'missing', observedAt: await f.nextCut(), missingReason: 'Synthetic source snapshot unavailable.' });
  alert = result.alert; assert.equal(alert.episodes[0].status, 'open'); assert.equal(alert.episodes[0].uncertain, true);
  assert.equal(alert.observations.at(-1)!.state, 'unknown');
  assert.deepEqual(result.notices.map(notice => notice.transition), ['uncertain']);
  const empty = await f.measurement('5000', '2026-10-10');
  assert.equal(empty.valueMinor, '0'); assert.equal(empty.sourceIds.includes(sourceId), false);
  result = await f.evaluate(alert, empty, 'empty-is-not-proven-zero'); alert = result.alert;
  assert.equal(alert.observations.at(-1)!.state, 'unknown');
  assert.ok(alert.observations.at(-1)!.issues.includes('unobserved-source'));
  assert.equal(alert.episodes[0].id, episodeId); assert.equal(alert.episodes[0].status, 'open');
  assert.equal(alert.episodes[0].uncertain, true); assert.deepEqual(result.notices, []);
  result = await f.evaluate(alert, await f.measurement('7000'), 'qualified-low'); alert = result.alert;
  assert.equal(alert.episodes[0].status, 'cleared');
  assert.deepEqual(result.notices.map(notice => notice.transition), ['cleared']);
  assert.ok(alert.observations.slice(1, 3).every(observation => observation.state === 'unknown'));
  f.localOnly();
});

test('paired HTTP later corrected import retains original observations and traceable retraction and restoration', async t => {
  const f = await fixture(t);
  let alert = await f.published(await f.measurement('5000'));
  alert = (await f.evaluate(alert, await f.measurement('11000'), 'original-first')).alert;
  const originalReceipt = await f.measurement('12000');
  alert = (await f.evaluate(alert, originalReceipt, 'original-second')).alert;
  const original = structuredClone(alert.observations[1]), episodeId = alert.episodes[0].id;
  const low = await f.measurement('5000');
  let result: AlertEvaluation = await f.rpc('alerts.evaluate', { id: alert.id, expectedRevision: alert.revision,
    observationId: 'later-low-amendment', observedAt: original.observedAt, receiptId: low.id,
    correction: { observationId: original.id, reason: 'Owner-provided synthetic restated sale export.' } });
  alert = result.alert;
  assert.deepEqual(alert.observations[1], original); assert.equal(alert.episodes[0].id, episodeId);
  assert.equal(alert.episodes[0].status, 'retracted');
  assert.deepEqual(result.notices.map(notice => notice.transition), ['amended']);
  assert.equal(result.notices[0].before!.status, 'open'); assert.equal(result.notices[0].after.status, 'retracted');
  assert.equal(alert.observations[2].amends, original.id);
  assert.equal(alert.observations[2].observedAt, original.observedAt);
  assert.equal(alert.observations[2].receipt!.asOf, low.asOf); assert.ok(low.asOf > originalReceipt.asOf);
  const high = await f.measurement('13000');
  result = await f.rpc('alerts.evaluate', { id: alert.id, expectedRevision: alert.revision,
    observationId: 'later-restoration', observedAt: original.observedAt, receiptId: high.id,
    correction: { observationId: original.id, reason: 'A further reconciled synthetic correction restores the breach.' } });
  alert = result.alert; assert.equal(alert.episodes.length, 1); assert.equal(alert.episodes[0].id, episodeId);
  assert.equal(alert.episodes[0].status, 'open'); assert.equal(alert.observations.length, 4);
  assert.deepEqual(alert.observations[1], original);
  assert.deepEqual(result.notices.map(notice => notice.transition), ['amended']);
  assert.ok([originalReceipt.id, low.id, high.id].every(id => alert.receiptIds.includes(id)));
  await f.reopen(); assert.deepEqual(await f.rpc('alerts.get', { id: alert.id }), alert); f.localOnly();
});

test('paired HTTP private alerts are withheld after current source revocation or source deletion', async t => {
  const f = await fixture(t), alert = await f.published(await f.measurement('5000'));
  await f.rpc('trust.update', { allowedSources: [] });
  await f.refused('alerts.get', { id: alert.id }, 'SOURCE_REVOKED');
  await f.refused('alerts.evaluate', { id: alert.id, expectedRevision: alert.revision,
    observationId: 'revoked-evidence', observedAt: await f.nextCut(), missingReason: 'Source is withheld.' }, 'SOURCE_REVOKED');
  assert.deepEqual(await f.rpc('alerts.list'), []);
  await f.rpc('trust.update', { allowedSources: [sourceId] });
  assert.deepEqual(await f.rpc('alerts.get', { id: alert.id }), alert);
  await f.rpc('sources.delete', { id: sourceId });
  await f.refused('alerts.get', { id: alert.id }, 'ALERT_NOT_FOUND');
  await f.refused('receipts.get', { id: alert.definition.baselineReceiptId }, 'RECEIPT_NOT_FOUND');
  assert.deepEqual(await f.rpc('alerts.list'), []); f.localOnly();
});

test('paired HTTP alert author and permission epoch are private, and member revocation invalidates its session', async t => {
  const f = await fixture(t), author = await f.member();
  const receipt = await f.measurement('5000', '2026-09-10', author.token);
  const alert = await f.published(receipt, {}, author.token);
  assert.equal(alert.ownerId, author.member.id); assert.equal(alert.epoch, author.member.epoch);
  await f.refused('alerts.get', { id: alert.id }, 'ALERT_NOT_FOUND');
  assert.deepEqual(await f.rpc('alerts.list'), []);
  assert.deepEqual(await f.rpc('alerts.get', { id: alert.id }, author.token), alert);
  const revoked = await f.rpc('members.revoke', { id: author.member.id });
  assert.equal(revoked.epoch, alert.epoch + 1); assert.equal(revoked.active, false);
  const denied = await f.refused('alerts.get', { id: alert.id }, 'UNAUTHENTICATED', author.token);
  assert.equal(denied.status, 401); f.localOnly();
});

test('paired HTTP alert writes retain closed payloads, revisions and published meaning', async t => {
  const f = await fixture(t), baseline = await f.measurement('5000');
  await f.refused('alerts.create', { ...f.definition(baseline), ctx: { memberId: 'forged' } }, 'INVALID_ALERT');
  const alert = await f.published(baseline);
  await f.refused('alerts.list', { sourceIds: [sourceId] }, 'INVALID_ALERT');
  await f.refused('alerts.get', { id: alert.id, epoch: alert.epoch }, 'INVALID_ALERT');
  await f.refused('alerts.publish', { id: alert.id, expectedRevision: alert.revision, label: 'changed' }, 'INVALID_ALERT');
  const input: AlertEvaluate & { id: string } = { id: alert.id, expectedRevision: alert.revision,
    observationId: 'closed-input', observedAt: await f.nextCut(), missingReason: 'Explicit unavailable source.' };
  await f.refused('alerts.evaluate', { ...input, send: true }, 'INVALID_ALERT');
  await f.refused('alerts.evaluate', { ...input, expectedRevision: alert.revision - 1 }, 'ALERT_REVISION_CONFLICT');
  const revision = structuredClone(f.draft);
  revision.definitions.find(definition => definition.name === 'earned')!.meaning += ' Owner changes recognition convention.';
  await f.rpc('ontology.publish', { draft: revision });
  await f.refused('alerts.evaluate', input, 'ALERT_MEANING_CHANGED');
  const retained = await f.rpc('alerts.get', { id: alert.id });
  assert.deepEqual(retained.definition, alert.definition);
  assert.deepEqual(retained.observations, alert.observations);
  assert.equal(retained.revision, alert.revision); assert.equal(retained.status, alert.status);
  assert.equal(retained.stale, true); assert.equal(retained.staleReason, 'The dictionary changed.');
  const ctx = f.engine.bootstrapContext();
  await assert.rejects(f.engine.requestAs({ ...ctx, channel: 'phone' }, 'alerts.evaluate', input), { code: 'ALERT_APP_REQUIRED' });
  await assert.rejects(f.engine.requestAs({ ...ctx, sourceTainted: true }, 'alerts.evaluate', input), { code: 'ALERT_APP_REQUIRED' });
  f.localOnly();
});
