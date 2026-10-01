import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusinessAlert } from '../runtime/alerts-contracts.ts';
import type { CalculationReceipt } from '../runtime/calculator.ts';
import type { Context } from '../runtime/contracts.ts';
import { code, fixture, PASSWORD, PERIOD, SOURCE } from './fixtures/alerts-public-acceptance.ts';

// Independently authored public acceptance. All retained evidence comes from
// Engine sources.import/calculation.run through actual preload and strict IPC.
// No private state writes or fabricated reconciliations; experimental encrypted
// files qualify only this local source path, not native PostgreSQL/live sources.
test('public alerts sustain real receipt observations, deduplicate, preserve hysteresis and reopen after encrypted Engine restart', { concurrency: false }, async t => {
  const f = await fixture(t);
  let alert = await f.published(await f.measurement('5000', 0));
  assert.equal(alert.definition.baseline.request.operation, 'earned');
  assert.equal(alert.definition.baselineReceiptId, alert.definition.baseline.receiptId);
  assert.deepEqual((await f.request('alerts.list')).map((item: BusinessAlert) => item.id), [alert.id]);
  const first = await f.measurement('11000', 1);
  const payload = { id: alert.id, expectedRevision: alert.revision, observationId: 'sustained-first', observedAt: first.asOf, receiptId: first.id };
  let result = await f.request('alerts.evaluate', payload); alert = result.alert;
  assert.equal(result.duplicate, false); assert.deepEqual(alert.episodes, []); assert.equal(alert.observations.length, 1);
  const replay = await f.request('alerts.evaluate', payload);
  assert.equal(replay.duplicate, true); assert.deepEqual(replay.notices, []); assert.deepEqual(replay.alert, alert);
  const equivalent = await f.calculate(1); assert.notEqual(equivalent.id, first.id);
  result = await f.evaluate(alert, equivalent, 'equivalent-recreated-receipt');
  assert.equal(result.duplicate, true); assert.deepEqual(result.alert, alert); assert.deepEqual(result.notices, []);
  await assert.rejects(f.request('alerts.evaluate', { ...payload, missingReason: 'Additional evidence is not allowed.' }), code('INVALID_ALERT'));
  await assert.rejects(f.request('alerts.publish', { id: alert.id, expectedRevision: alert.revision }), code('ALERT_ALREADY_PUBLISHED'));
  const laterCut = await f.calculate(2);
  assert.equal(laterCut.totalMinor, first.totalMinor); assert.deepEqual(laterCut.rowIds, first.rowIds);
  result = await f.evaluate(alert, laterCut, 'sustained-second'); alert = result.alert;
  assert.equal(result.duplicate, false, 'A new knowledge cut advances persistence even when source facts are unchanged.');
  assert.deepEqual(result.notices.map((item: any) => item.transition), ['opened']);
  const episodeId = alert.episodes[0].id;
  assert.equal(alert.episodes[0].severity, 'warning'); assert.equal(alert.episodes[0].status, 'open');
  result = await f.evaluate(alert, await f.measurement('23000', 3), 'critical'); alert = result.alert;
  assert.deepEqual(result.notices.map((item: any) => item.transition), ['escalated']);
  for (const [offset, value, id] of [[4, '9000', 'band'], [5, '7000', 'clear-first'], [6, '9000', 'band-breaks-clear'], [7, '7100', 'clear-restarted']] as const) {
    alert = (await f.evaluate(alert, await f.measurement(value, offset), id)).alert;
    assert.equal(alert.episodes[0].status, 'open'); assert.equal(alert.episodes[0].severity, 'critical');
  }
  result = await f.evaluate(alert, await f.measurement('7500', 8), 'clear-sustained'); alert = result.alert;
  assert.equal(alert.episodes[0].status, 'cleared'); assert.equal(alert.episodes[0].severity, 'critical');
  assert.deepEqual(result.notices.map((item: any) => item.transition), ['cleared']);
  const encrypted = await f.encrypted(); assert.equal(JSON.parse(encrypted).format, 'chausar.vault.v1');
  for (const privateText of [PASSWORD, 'PRIVATE_PUBLIC_ALERT_LABEL', 'PRIVATE_PUBLIC_ALERT_ROW', 'business-alert-v1']) assert.equal(encrypted.includes(privateText), false);
  await f.restart(); assert.deepEqual(await f.request('alerts.get', { id: alert.id }), alert);
  assert.deepEqual((await f.request('alerts.list')).map((item: BusinessAlert) => item.id), [alert.id]);
  alert = (await f.evaluate(alert, await f.measurement('11000', 9), 'reopen-first')).alert;
  assert.equal(alert.episodes[0].status, 'cleared');
  result = await f.evaluate(alert, await f.measurement('13000', 10), 'reopen-sustained'); alert = result.alert;
  assert.equal(alert.episodes.length, 1); assert.equal(alert.episodes[0].id, episodeId);
  assert.equal(alert.episodes[0].status, 'open'); assert.equal(alert.episodes[0].reopenCount, 1); assert.equal(alert.episodes[0].severity, 'warning');
  assert.deepEqual(result.notices.map((item: any) => item.transition), ['reopened']);
  assert.ok(alert.notices.every(item => item.delivery === 'local-only' && item.alertId === alert.id && item.episodeId === episodeId));
  for (const method of ['alerts.create', 'alerts.publish', 'alerts.evaluate', 'alerts.list', 'alerts.get']) assert.ok(f.h.calls.some(item => item.method === method));
  assert.deepEqual(await f.request('jobs.list'), []); assert.deepEqual(await f.request('actions.list'), []);
});

test('public partial, missing and stale low receipts never clear or downgrade an open breach', { concurrency: false }, async t => {
  const f = await fixture(t, true);
  let alert = await f.published(await f.measurement('5000', 0));
  alert = (await f.evaluate(alert, await f.measurement('11000', 1), 'first')).alert;
  alert = (await f.evaluate(alert, await f.measurement('23000', 2), 'critical-second')).alert;
  const episodeId = alert.episodes[0].id;
  f.advance(3);
  const rows = await f.request('memory.list', { period: PERIOD, branch: 'main', sourceIds: [SOURCE] });
  assert.equal(rows.facts.length, 1);
  await f.request('memory.correct', { id: rows.facts[0].id, fields: { amountMinor: null } });
  const partial = await f.calculate(3); assert.equal(partial.totalMinor, '0'); assert.equal(partial.coverage.completeness, 'partial');
  let result = await f.evaluate(alert, partial, 'partial-low'); alert = result.alert;
  assert.equal(alert.observations.at(-1)!.state, 'unknown'); assert.ok(alert.observations.at(-1)!.issues.includes('coverage-partial'));
  assert.deepEqual(result.notices.map(item => item.transition), ['uncertain']);
  f.advance(4);
  alert = (await f.request('alerts.evaluate', { id: alert.id, expectedRevision: alert.revision,
    observationId: 'missing-export', observedAt: f.at(4), missingReason: 'Synthetic export unavailable.' })).alert;
  const staleLow = await f.measurement('7000', 5);
  await f.measurement('24000', 5);
  assert.equal((await f.request('receipts.get', { id: staleLow.id })).stale, true);
  result = await f.evaluate(alert, staleLow, 'stale-low'); alert = result.alert;
  assert.ok(alert.observations.at(-1)!.issues.includes('stale-receipt')); assert.equal(alert.observations.at(-1)!.state, 'unknown');
  assert.deepEqual(result.notices, []);
  assert.equal(alert.episodes[0].id, episodeId); assert.equal(alert.episodes[0].status, 'open');
  assert.equal(alert.episodes[0].severity, 'critical'); assert.equal(alert.episodes[0].uncertain, true);
  result = await f.evaluate(alert, await f.measurement('7100', 6), 'qualified-clear-first'); alert = result.alert;
  assert.equal(alert.episodes[0].status, 'open'); assert.equal(alert.episodes[0].uncertain, false);
  assert.deepEqual(result.notices.map(item => item.transition), ['evidence-restored']);
  result = await f.evaluate(alert, await f.measurement('7200', 7), 'qualified-clear-sustained'); alert = result.alert;
  assert.equal(alert.episodes[0].status, 'cleared'); assert.equal(alert.episodes[0].severity, 'critical');
  assert.deepEqual(result.notices.map(item => item.transition), ['cleared']);
});

test('public later reconciled corrections retain original evidence and append traceable retraction and restoration', { concurrency: false }, async t => {
  const f = await fixture(t);
  let alert = await f.published(await f.measurement('5000', 0));
  const first = await f.measurement('11000', 1);
  alert = (await f.evaluate(alert, first, 'original-first')).alert;
  const second = await f.measurement('12000', 2);
  alert = (await f.evaluate(alert, second, 'original-second')).alert;
  const original = structuredClone(alert.observations), opened = structuredClone(alert.episodes[0]);
  const low = await f.measurement('5000', 3);
  let result = await f.evaluate(alert, low, 'amend-low', { observedAt: second.asOf,
    correction: { observationId: 'original-second', reason: 'Reconciled later export restates the original measurement.' } });
  alert = result.alert;
  assert.deepEqual(alert.observations.slice(0, 2), original);
  assert.equal(alert.episodes[0].id, opened.id); assert.equal(alert.episodes[0].status, 'retracted');
  assert.deepEqual(result.notices.map(item => item.transition), ['amended']);
  assert.deepEqual(result.notices[0].before, opened); assert.equal(result.notices[0].after.status, 'retracted');
  const amendment = alert.observations.at(-1)!;
  assert.equal(amendment.amends, 'original-second'); assert.equal(amendment.anchorId, 'original-second');
  assert.equal(amendment.observedAt, second.asOf); assert.equal(amendment.recordedAt, low.asOf);
  assert.equal(amendment.receipt!.asOf, low.asOf); assert.equal(amendment.receipt!.receiptId, low.id);
  assert.match(amendment.amendmentReason!, /later export/);
  const high = await f.measurement('13000', 4);
  result = await f.evaluate(alert, high, 'amend-restored', { observedAt: second.asOf,
    correction: { observationId: 'original-second', reason: 'Further reconciled export restores the original breach.' } });
  alert = result.alert;
  assert.deepEqual(alert.observations.slice(0, 2), original); assert.equal(alert.episodes.length, 1);
  assert.equal(alert.episodes[0].id, opened.id); assert.equal(alert.episodes[0].status, 'open');
  assert.deepEqual(result.notices.map(item => item.transition), ['amended']);
  assert.equal(result.notices[0].before!.status, 'retracted'); assert.equal(result.notices[0].after.status, 'open');
  for (const receipt of [first, second, low, high]) {
    assert.ok(alert.receiptIds.includes(receipt.id));
    assert.equal((await f.request('receipts.get', { id: receipt.id })).totalMinor, receipt.totalMinor);
  }
  await f.restart(); assert.deepEqual(await f.request('alerts.get', { id: alert.id }), alert);
});

test('public alert reads and writes honor current source, member, ownership and desktop authority', { concurrency: false }, async t => {
  const f = await fixture(t);
  const baseline = await f.measurement('5000', 0);
  const alert = await f.published(baseline);
  const viewer = await f.request('members.add', { id: 'alert-viewer', name: 'Synthetic viewer', role: 'viewer', branches: ['main'] });
  const viewerContext: Context = { memberId: viewer.id, role: viewer.role, epoch: viewer.epoch, channel: 'desktop' };
  assert.deepEqual(await f.requestAs(viewerContext, 'alerts.list'), []);
  await assert.rejects(f.requestAs(viewerContext, 'alerts.get', { id: alert.id }), code('ALERT_NOT_FOUND'));
  await assert.rejects(f.requestAs(viewerContext, 'alerts.create', f.definition(baseline)), code('FORBIDDEN'));
  for (const context of [{ memberId: 'owner', role: 'owner', epoch: 1, channel: 'phone' },
    { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop', sourceTainted: true }] as Context[]) {
    await assert.rejects(f.requestAs(context, 'alerts.evaluate', { id: alert.id, expectedRevision: alert.revision,
      observationId: 'untrusted-writer', observedAt: f.at(1), missingReason: 'No authorized desktop measurement.' }), code('ALERT_APP_REQUIRED'));
  }
  const member = await f.request('members.add', { id: 'alert-accountant', name: 'Synthetic accountant', role: 'accountant', branches: ['main'] });
  const accountant: Context = { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' };
  const accountantReceipt: CalculationReceipt = await f.requestAs(accountant, 'calculation.run', {
    operation: 'earned', period: PERIOD, branch: 'main', sourceIds: [SOURCE], asOf: f.at(0) });
  const privateDraft: BusinessAlert = await f.requestAs(accountant, 'alerts.create', f.definition(accountantReceipt));
  await f.requestAs(accountant, 'alerts.publish', { id: privateDraft.id, expectedRevision: privateDraft.revision });
  await f.request('members.revoke', { id: member.id });
  await assert.rejects(f.requestAs(accountant, 'alerts.get', { id: privateDraft.id }), code('ACCESS_REVOKED'));
  await f.request('trust.update', { allowedSources: [] });
  assert.deepEqual(await f.request('alerts.list'), []);
  await assert.rejects(f.request('alerts.get', { id: alert.id }), code('SOURCE_REVOKED'));
  await assert.rejects(f.request('alerts.evaluate', { id: alert.id, expectedRevision: alert.revision,
    observationId: 'revoked-source', observedAt: f.at(0), missingReason: 'Revoked source cannot be evaluated.' }), code('SOURCE_REVOKED'));
  await f.restart(); assert.deepEqual(await f.request('alerts.list'), []);
  await assert.rejects(f.request('alerts.get', { id: alert.id }), code('SOURCE_REVOKED'));
});

test('public zero-row exports provide no receipt completeness proof and receiptless moving-window corrections are conservatively refused', { concurrency: false }, async t => {
  const f = await fixture(t);
  let alert = await f.published(await f.measurement('5000', 0, { from: '2026-08-01', to: '2026-08-30' }, '2026-08-10'), { periodMode: 'moving' });
  alert = (await f.evaluate(alert, await f.measurement('11000', 1, { from: '2026-08-02', to: '2026-08-31' }, '2026-08-10'), 'moving-first')).alert;
  alert = (await f.evaluate(alert, await f.measurement('12000', 2, { from: '2026-08-03', to: '2026-09-01' }, '2026-08-10'), 'moving-second')).alert;
  const episodeId = alert.episodes[0].id;
  const emptyExport = await f.emptyImport(3);
  assert.equal(emptyExport.coverage.reconciled, true); assert.equal(emptyExport.coverage.sourceRows, 0);
  assert.equal(emptyExport.expectedTotals.rowCount, 0); assert.equal(emptyExport.totalsMinor, '0');
  const empty = await f.calculate(3);
  assert.equal(empty.totalMinor, '0'); assert.equal(empty.coverage.completeness, 'empty');
  // The public calculator does not bind zero-row export completeness to a
  // measurement receipt. This explicitly documents the conservative contract.
  assert.deepEqual(empty.coverage.importIds, []);
  assert.ok(empty.coverage.gaps.some(gap => gap.includes('not proof')));
  let result = await f.evaluate(alert, empty, 'empty-moving-window'); alert = result.alert;
  assert.equal(alert.observations.at(-1)!.state, 'unknown');
  assert.ok(alert.observations.at(-1)!.issues.includes('coverage-empty'));
  assert.ok(alert.observations.at(-1)!.issues.includes('unobserved-source'));
  assert.equal(alert.episodes[0].id, episodeId); assert.equal(alert.episodes[0].status, 'open'); assert.equal(alert.episodes[0].uncertain, true);
  f.advance(4);
  alert = (await f.request('alerts.evaluate', { id: alert.id, expectedRevision: alert.revision,
    observationId: 'receiptless-moving', observedAt: f.at(4), missingReason: 'Moving-window export was unavailable.' })).alert;
  const later = await f.measurement('7000', 5, PERIOD, '2026-09-06');
  const before = await f.request('alerts.get', { id: alert.id });
  await assert.rejects(f.evaluate(alert, later, 'refused-moving-amendment', { observedAt: f.at(4),
    correction: { observationId: 'receiptless-moving', reason: 'There is no receipt-backed original window to amend.' } }), code('ALERT_WINDOW_CHANGED'));
  assert.deepEqual(await f.request('alerts.get', { id: alert.id }), before, 'Refused correction appends no observation, revision or notice.');
  result = await f.evaluate(alert, later, 'qualified-moving-clear-first'); alert = result.alert;
  assert.equal(alert.episodes[0].status, 'open'); assert.equal(alert.episodes[0].uncertain, false);
  result = await f.evaluate(alert, await f.measurement('7200', 6, PERIOD, '2026-09-06'), 'qualified-moving-clear-second');
  assert.equal(result.alert.episodes[0].status, 'cleared'); assert.equal(result.alert.episodes[0].id, episodeId);
});
