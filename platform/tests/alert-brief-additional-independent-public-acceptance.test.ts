import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { independentBriefHost, independentPeriod, independentSources } from './fixtures/alert-brief-independent-public-acceptance.ts';

// Independently chosen consumer journeys. No existing implementation fixture or
// service substitute supplies the expected results or acceptance decisions.
test('independent paired HTTP current alert brief survives physical restart and the exact owner accepts its unchanged cache', { timeout: 90000 }, async t => {
  const f = await independentBriefHost(t), known = await f.condition('a');
  const delivered = await f.delivered('a'), saved = structuredClone(delivered.deliverable);
  const alertBefore = f.retainedAlerts();
  assert.equal(saved.result.alerts.items[0].alertId, known.alert.id);
  assert.equal(saved.result.alerts.items[0].observation.receiptId, known.receipt.id);
  assert.deepEqual(saved.result.alerts.items[0].episodes, known.alert.episodes);
  await f.ciphertextOnly(); await f.restart();
  const restored = (await f.rpc('jobs.list')).find((job: any) => job.id === delivered.id);
  assert.ok(restored); assert.deepEqual(restored.deliverable, saved);
  const current = await f.rpc('reports.brief', { period: independentPeriod, sourceIds: [independentSources.a], onDate: '2099-01-01' });
  assert.equal(current.alerts.pin, saved.result.alerts.pin); assert.deepEqual(current.alerts.items, saved.result.alerts.items);
  assert.deepEqual(f.retainedAlerts(), alertBefore, 'Fresh briefing and restart do not evaluate or clear the retained condition.');
  const accepted = await f.rpc('jobs.accept', { id: delivered.id });
  assert.equal(accepted.status, 'accepted'); assert.deepEqual(accepted.deliverable, saved);
  assert.equal(f.retainedJob(delivered.id).ledger.filter(item => item.event === 'accepted').length, 1);
  await f.restart();
  const final = (await f.rpc('jobs.list')).find((job: any) => job.id === delivered.id);
  assert.equal(final.status, 'accepted'); assert.deepEqual(final.deliverable, saved);
  assert.deepEqual(f.retainedAlerts(), alertBefore); f.noDispatch();
});

test('independent paired HTTP clock-only evidence expiry withholds cached acceptance without changing the observation or episode', { timeout: 90000 }, async t => {
  const f = await independentBriefHost(t), known = await f.condition('a', undefined, 10000);
  const delivered = await f.delivered('a'), retained = f.retainedJob(delivered.id), alertBefore = f.retainedAlerts();
  assert.equal(delivered.deliverable.result.alerts.items[0].revision, known.alert.revision);
  // Wait for the actual host clock; do not forge request dates, receipt content,
  // process clock, saved revision, provider state or a fixture-only clock seam.
  const expiration = Math.min(Date.parse(known.receipt.asOf), Date.parse(known.receipt.createdAt)) + 10000;
  const waitMs = expiration - Date.now() + 100;
  assert.ok(waitMs > 0 && waitMs <= 12000, `Initial current-evidence window must be measurable; remaining wait ${waitMs} ms.`);
  await delay(waitMs);
  assert.deepEqual(f.retainedAlerts(), alertBefore, 'Only host time changes; every saved alert byte remains retained.');
  const listed = (await f.rpc('jobs.list')).find((job: any) => job.id === delivered.id);
  assert.ok(listed); assert.equal(listed.deliverable, undefined);
  await f.refuses('jobs.accept', { id: delivered.id, repeat: true }, 'JOB_EVIDENCE_REVOKED');
  assert.deepEqual(f.retainedJob(delivered.id), retained, 'A refused acceptance neither consumes, repeats nor erases the retained run.');
  await f.restart();
  assert.equal((await f.rpc('jobs.list')).find((job: any) => job.id === delivered.id).deliverable, undefined);
  const fresh = await f.rpc('reports.brief', { period: independentPeriod, sourceIds: [independentSources.a], onDate: '2026-09-01' });
  const item = fresh.alerts.items[0];
  assert.equal(item.revision, known.alert.revision); assert.deepEqual(item.episodes, known.alert.episodes);
  assert.equal(item.evidence.state, 'uncertain'); assert.ok(item.evidence.issues.includes('expired-evidence'));
  assert.ok(!item.evidence.issues.includes('observation-gap'), 'This probe isolates receipt expiry from the separately bounded observation gap.');
  assert.notEqual(fresh.alerts.pin, delivered.deliverable.result.alerts.pin);
  assert.deepEqual(f.retainedAlerts(), alertBefore); assert.deepEqual(f.retainedJob(delivered.id), retained); f.noDispatch();
});

test('independent paired HTTP current source withdrawal and a revoked owner epoch prevent old brief disclosure or owner takeover', { timeout: 180000 }, async t => {
  const sourceHost = await independentBriefHost(t);
  await sourceHost.condition('a'); const sourceRun = await sourceHost.delivered('a');
  const sourceRetained = sourceHost.retainedJob(sourceRun.id), sourceAlerts = sourceHost.retainedAlerts();
  await sourceHost.rpc('trust.update', { allowedSources: [] });
  assert.ok(!(await sourceHost.rpc('jobs.list')).some((job: any) => job.id === sourceRun.id));
  await sourceHost.refuses('jobs.accept', { id: sourceRun.id }, 'SOURCE_REVOKED');
  assert.deepEqual(sourceHost.retainedJob(sourceRun.id), sourceRetained); assert.deepEqual(sourceHost.retainedAlerts(), sourceAlerts);
  await sourceHost.restart();
  assert.ok(!(await sourceHost.rpc('jobs.list')).some((job: any) => job.id === sourceRun.id));
  await sourceHost.refuses('jobs.accept', { id: sourceRun.id }, 'SOURCE_REVOKED');
  const brief = await sourceHost.rpc('reports.brief', { period: independentPeriod });
  assert.deepEqual(brief.alerts.items, []); assert.deepEqual(brief.alerts.receiptIds, []);
  assert.ok(!JSON.stringify(brief).includes('INDEPENDENT PRIVATE A SALES'));
  assert.deepEqual(sourceHost.retainedJob(sourceRun.id), sourceRetained); sourceHost.noDispatch();

  const epochHost = await independentBriefHost(t), cofounder = await epochHost.member();
  const known = await epochHost.condition('a', cofounder.token);
  const epochRun = await epochHost.delivered('a', cofounder.token), epochRetained = epochHost.retainedJob(epochRun.id);
  assert.equal(epochRetained.ownerId, cofounder.member.id); assert.equal(epochRetained.ownerEpoch, 1);
  const revoked = await epochHost.rpc('members.revoke', { id: cofounder.member.id });
  assert.equal(revoked.epoch, 2); assert.equal(revoked.active, false);
  await epochHost.refuses('jobs.list', {}, 'UNAUTHENTICATED', cofounder.token);
  await epochHost.refuses('jobs.accept', { id: epochRun.id }, 'UNAUTHENTICATED', cofounder.token);
  assert.ok(!(await epochHost.rpc('jobs.list')).some((job: any) => job.id === epochRun.id));
  await epochHost.refuses('jobs.accept', { id: epochRun.id }, 'JOB_OWNER_REQUIRED');
  await epochHost.refuses('receipts.get', { id: known.receipt.id }, 'RECEIPT_FORBIDDEN');
  await epochHost.restart();
  await epochHost.refuses('jobs.list', {}, 'UNAUTHENTICATED', cofounder.token);
  await epochHost.refuses('jobs.accept', { id: epochRun.id }, 'JOB_OWNER_REQUIRED');
  assert.deepEqual(epochHost.retainedJob(epochRun.id), epochRetained); epochHost.noDispatch();
});

test('independent paired HTTP a new observation outside the reviewed source mandate leaves the exact cached brief acceptable', { timeout: 90000 }, async t => {
  const f = await independentBriefHost(t), b = await f.condition('b'), a = await f.condition('a');
  // Complete every import before obtaining the current A observation: ordinary
  // imports conservatively mark saved calculations stale across the workspace.
  const delivered = await f.delivered('a'), saved = structuredClone(delivered.deliverable);
  const retainedA = await f.rpc('alerts.get', { id: a.alert.id });
  assert.deepEqual(saved.result.alerts.items.map((item: any) => item.alertId), [a.alert.id]);
  assert.ok(!JSON.stringify(saved.result).includes('INDEPENDENT PRIVATE B SALES'));
  for (const id of saved.result.receiptIds) {
    const receipt = await f.rpc('receipts.get', { id });
    assert.ok(!receipt.sourceIds.includes(independentSources.b));
    assert.ok(!(receipt.requestedSourceIds ?? []).includes(independentSources.b));
  }
  const wholeBefore = await f.rpc('reports.brief', { period: independentPeriod });
  const combinedSales = wholeBefore.report.sections.find((section: any) => section.title === 'net_sales');
  assert.ok(combinedSales);
  assert.equal((await f.rpc('receipts.get', { id: combinedSales.receiptId })).valueMinor, '24000',
    'The independently distinct A and B sales total INR 24000 only in the unscoped report.');
  // No import or grant change: only an explicitly unavailable new observation
  // of source B changes. The owner-approved source A mandate must stay usable.
  const changed = await f.rpc('alerts.evaluate', { id: b.alert.id, expectedRevision: b.alert.revision,
    observationId: 'independent-b-now-unavailable', observedAt: await f.nextCut(), missingReason: 'Independent source B observation unavailable.' });
  assert.equal(changed.alert.revision, b.alert.revision + 1);
  assert.deepEqual(await f.rpc('alerts.get', { id: a.alert.id }), retainedA);
  const whole = await f.rpc('reports.brief', { period: independentPeriod });
  assert.equal(whole.alerts.items.find((item: any) => item.alertId === b.alert.id).evidence.state, 'uncertain');
  assert.notEqual(whole.alerts.pin, wholeBefore.alerts.pin, 'B alone changes the unscoped alert projection.');
  assert.notEqual(whole.alerts.pin, saved.result.alerts.pin);
  assert.deepEqual((await f.rpc('jobs.list')).find((job: any) => job.id === delivered.id).deliverable, saved);
  await f.restart();
  assert.deepEqual((await f.rpc('jobs.list')).find((job: any) => job.id === delivered.id).deliverable, saved);
  const scoped = await f.rpc('reports.brief', { period: independentPeriod, sourceIds: [independentSources.a] });
  assert.equal(scoped.alerts.pin, saved.result.alerts.pin); assert.deepEqual(scoped.alerts.items, saved.result.alerts.items);
  const accepted = await f.rpc('jobs.accept', { id: delivered.id });
  assert.equal(accepted.status, 'accepted'); assert.deepEqual(accepted.deliverable, saved);
  assert.equal(f.retainedJob(delivered.id).ledger.filter(item => item.event === 'accepted').length, 1); f.noDispatch();
});
