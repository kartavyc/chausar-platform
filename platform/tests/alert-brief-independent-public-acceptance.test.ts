import assert from 'node:assert/strict';
import test from 'node:test';
import {A, B, C, SECRET, fixture} from './fixtures/alert-brief-independent-acceptance.ts';
import type {CalculationReceipt} from '../runtime/calculator.ts';

// Independent literal arithmetic, actual paired HTTP and real encrypted reopen.
// Positive freshness assertions are retained if the production guard fails.
test('a cached report-only owner brief refuses stale report evidence and repeat acceptance after a genuine correction', async t => {
  const f = await fixture(t); await f.measurement('5000');
  const delivered = await f.runJob(await f.createJob([A]));
  const result = delivered.deliverable.result;
  assert.deepEqual(result.alerts.items, []); assert.equal(result.alerts.evaluated, false);
  const oldReceipts: CalculationReceipt[] = await Promise.all(result.report.receiptIds.map((id: string) => f.rpc('receipts.get', {id})));
  const original = oldReceipts.find(receipt => receipt.operation === 'net_sales'); assert.ok(original);
  assert.equal(original.totalMinor, '5000'); assert.equal(original.stale, false);
  const stored = structuredClone(f.engine.vault!.read().jobs.find(job => job.id === delivered.id)!.deliverable);
  const fact = (await f.rpc('memory.list')).facts.find((row: any) => row.sourceId === A); assert.ok(fact);
  f.advance(2000); await f.rpc('memory.correct', {id: fact.id, fields: {amountMinor: '9000'}});
  const retained: CalculationReceipt[] = await Promise.all(result.report.receiptIds.map((id: string) => f.rpc('receipts.get', {id})));
  assert.ok(retained.every(receipt => receipt.stale)); assert.equal(retained.find(receipt => receipt.id === original.id)!.totalMinor, '5000');
  const corrected = await f.calculate(); assert.equal(corrected.totalMinor, '9000'); assert.equal(corrected.stale, false);
  assert.deepEqual(f.engine.vault!.read().jobs.find(job => job.id === delivered.id)!.deliverable, stored);
  const cached = (await f.rpc('jobs.list')).find((job: any) => job.id === delivered.id);
  const acceptance = await f.raw('jobs.accept', {id: delivered.id, repeat: true});
  t.diagnostic(JSON.stringify({case: 'report-only-current-freshness', originalMinor: original.totalMinor,
    correctedMinor: corrected.totalMinor, staleReportReceiptCount: retained.length,
    cachedDeliverableVisible: Boolean(cached?.deliverable), acceptanceHttpStatus: acceptance.status,
    acceptanceCode: acceptance.body.error?.code ?? null, resultingJobStatus: acceptance.body.result?.status ?? null}));
  f.assertLocal();
  assert.equal(Boolean(cached?.deliverable), false, 'Current owner-brief delivery must withhold a cached report whose receipts are now stale.');
  assert.notEqual(acceptance.status, 200, 'Stale current report evidence cannot authorize acceptance or a repeat mandate.');
  assert.equal(acceptance.body.error?.code, 'JOB_EVIDENCE_REVOKED');
});

test('actual HTTP expiry retains an open episode as uncertain and refuses its cached owner brief across lock and a fresh Engine', async t => {
  const f = await fixture(t), baseline = await f.measurement('5000');
  let alert = await f.publish(baseline, 'expiry-observed');
  const waiting = await f.publish(baseline, 'expiry-never-observed');
  await f.rpc('alerts.create', f.definition(baseline, 'expiry-draft'));
  alert = (await f.evaluate(alert, await f.measurement('12505'), 'expiry-breach')).alert;
  const saved = f.controls(), current = await f.brief({branch: 'main', sourceIds: [A], onDate: '2099-01-01'});
  assert.deepEqual(f.controls(), saved, 'Brief report calculations cannot evaluate alerts, append notices or schedule work.');
  assert.deepEqual(current.alerts.items.map((item: any) => item.alertId).sort(), [alert.id, waiting.id].sort());
  const item = current.alerts.items.find((value: any) => value.alertId === alert.id);
  assert.equal(item.evidence.state, 'current'); assert.deepEqual(item.episodes, alert.episodes);
  assert.ok(current.alerts.items.find((value: any) => value.alertId === waiting.id).evidence.issues.includes('not-observed'));
  assert.equal(current.alerts.checkedAt, new Date().toISOString());
  const delivered = await f.runJob(await f.createJob([A]));
  const stored = structuredClone(f.engine.vault!.read().jobs.find(job => job.id === delivered.id)!);
  f.advance(60_001); const beforeExpiryRead = f.controls();
  const expired = await f.brief({branch: 'main', sourceIds: [A], onDate: '1900-01-01'});
  assert.deepEqual(f.controls(), beforeExpiryRead);
  const uncertain = expired.alerts.items.find((value: any) => value.alertId === alert.id);
  assert.equal(uncertain.evidence.state, 'uncertain'); assert.ok(uncertain.evidence.issues.includes('expired-evidence'));
  assert.ok(uncertain.evidence.issues.includes('observation-gap')); assert.deepEqual(uncertain.episodes, alert.episodes);
  assert.notEqual(expired.alerts.pin, current.alerts.pin);
  assert.equal((await f.rpc('jobs.list')).find((job: any) => job.id === delivered.id).deliverable, undefined);
  const beforeAcceptance = f.engine.vault!.read();
  await f.refuse('jobs.accept', {id: delivered.id, repeat: true}, 'JOB_EVIDENCE_REVOKED');
  assert.deepEqual(f.engine.vault!.read(), beforeAcceptance);
  assert.deepEqual(f.engine.vault!.read().jobs.find(job => job.id === delivered.id), stored);
  const ciphertext = await f.ciphertext(); assert.equal(ciphertext.includes(Buffer.from(SECRET)), false);
  await f.rpc('workspace.lock'); await f.refuse('reports.brief', {sourceIds: [A]}, 'VAULT_LOCKED');
  // Restart helper also locks; reopen first to exercise both transitions.
  await f.rpc('workspace.open', {passphrase: 'Synthetic independent owner brief credential only'});
  const oldToken = await f.restart();
  assert.equal((await f.raw('workspace.status', {}, oldToken)).status, 401);
  const reopened = await f.brief({branch: 'main', sourceIds: [A]});
  assert.deepEqual(reopened.alerts.items, expired.alerts.items); assert.equal(reopened.alerts.pin, expired.alerts.pin);
  assert.equal((await f.rpc('jobs.list')).find((job: any) => job.id === delivered.id).deliverable, undefined);
  await f.refuse('jobs.accept', {id: delivered.id}, 'JOB_EVIDENCE_REVOKED'); f.assertLocal();
});

test('explicit unavailable observation preserves episode history and invalidates cached job acceptance without a new calculation', async t => {
  const f = await fixture(t); let alert = await f.publish(await f.measurement('5000'), 'missing-observation');
  alert = (await f.evaluate(alert, await f.measurement('12505'), 'available-breach')).alert;
  const delivered = await f.runJob(await f.createJob([A]));
  const receiptBytes = JSON.stringify(f.engine.vault!.read().receipts), episodes = alert.episodes;
  f.advance();
  alert = (await f.rpc('alerts.evaluate', {id: alert.id, expectedRevision: alert.revision,
    observationId: 'explicit-gap', observedAt: new Date().toISOString(), missingReason: 'Synthetic source capture unavailable.'})).alert;
  assert.equal(JSON.stringify(f.engine.vault!.read().receipts), receiptBytes);
  const controls = f.controls(), current = await f.brief({sourceIds: [A]}); assert.deepEqual(f.controls(), controls);
  const item = current.alerts.items[0]; assert.equal(item.observation.state, 'unknown'); assert.equal(item.observation.receiptId, null);
  assert.equal(item.evidence.state, 'uncertain'); assert.ok(item.evidence.issues.includes('missing-evidence'));
  assert.equal(item.episodes[0].id, episodes[0].id); assert.equal(item.episodes[0].status, 'open');
  assert.deepEqual(item.episodes, alert.episodes);
  assert.equal((await f.rpc('jobs.list')).find((job: any) => job.id === delivered.id).deliverable, undefined);
  const before = f.engine.vault!.read(); await f.refuse('jobs.accept', {id: delivered.id, repeat: true}, 'JOB_EVIDENCE_REVOKED');
  assert.deepEqual(f.engine.vault!.read(), before); await f.restart();
  assert.deepEqual((await f.brief({sourceIds: [A]})).alerts.items, current.alerts.items); f.assertLocal();
});

test('omitted job sources are captured once while explicit empty and whole-condition subset scopes remain exact', async t => {
  const f = await fixture(t); await f.measurement('12505', A); await f.measurement('4107', B, 'b-sale', 'west');
  const combined = await f.calculate([A, B], null); assert.equal(combined.totalMinor, '16612');
  const both = await f.publish(combined, 'entire-a-and-b-condition');
  const partial = await f.brief({sourceIds: [A]}); assert.deepEqual(partial.alerts.items, []);
  const all = await f.brief({sourceIds: [A, B]}); assert.deepEqual(all.alerts.items.map((item: any) => item.alertId), [both.id]);
  const job = await f.createJob(undefined); assert.deepEqual(job.sourceIds, [A, B].sort());
  await f.measurement('7779', C, 'later-sale');
  const later = await f.publish(await f.calculate([C]), 'outside-frozen-job-scope');
  const completed = await f.runJob(job), result = completed.deliverable.result;
  assert.deepEqual(result.alerts.scope, {branch: null, sourceIds: [A, B].sort()});
  assert.deepEqual(result.alerts.items.map((item: any) => item.alertId), [both.id]);
  assert.equal(JSON.stringify(result).includes(later.definition.label), false);
  for (const id of result.receiptIds) {
    const receipt: CalculationReceipt = await f.rpc('receipts.get', {id});
    assert.deepEqual(receipt.requestedSourceIds!.slice().sort(), [A, B].sort()); assert.ok(receipt.rows.every(row => row.sourceId !== C));
    if (receipt.operation === 'net_sales') assert.equal(receipt.totalMinor, '16612');
  }
  const empty = await f.runJob(await f.createJob([]));
  assert.deepEqual(empty.deliverable.result.alerts.scope, {branch: null, sourceIds: []});
  assert.deepEqual(empty.deliverable.result.alerts.items, []); assert.deepEqual(empty.deliverable.result.report.rowIds, []);
  for (const id of empty.deliverable.result.receiptIds) {
    const receipt: CalculationReceipt = await f.rpc('receipts.get', {id}); assert.deepEqual(receipt.requestedSourceIds, []);
    assert.deepEqual(receipt.rows, []); assert.deepEqual(receipt.exclusions, []);
  }
  await f.restart(); assert.deepEqual((await f.rpc('jobs.list')).find((item: any) => item.id === job.id).sourceIds, [A, B].sort()); f.assertLocal();
});

test('two contradictory sale claims remain explicit partial coverage in an omitted-scope owner brief job', async t => {
  const f = await fixture(t); await f.importRow('10003', A, 'same-sale'); await f.importRow('20009', B, 'same-sale');
  const memory = await f.rpc('memory.list'); assert.equal(memory.facts.length, 0); assert.equal(memory.conflicts.length, 1);
  const conflict = memory.conflicts[0]; assert.equal(conflict.rowIds.length, 2);
  const job = await f.createJob(undefined); assert.deepEqual(job.sourceIds, [A, B].sort());
  const completed = await f.runJob(job), result = completed.deliverable.result;
  assert.equal(result.report.status, 'partial'); assert.ok(result.report.gaps.some((gap: string) => /unresolved source conflicts/i.test(gap)));
  assert.deepEqual(result.alerts.items, []); assert.equal(result.alerts.evaluated, false);
  for (const operation of ['net_sales', 'margin']) {
    const section = result.report.sections.find((item: any) => item.title === operation); assert.ok(section);
    const receipt: CalculationReceipt = await f.rpc('receipts.get', {id: section.receiptId});
    assert.equal(receipt.coverage.completeness, 'partial'); assert.equal(receipt.coverage.unresolvedConflicts, 1);
    assert.deepEqual(receipt.requestedSourceIds!.slice().sort(), [A, B].sort());
    assert.ok(conflict.rowIds.every((id: string) => receipt.exclusions.some(row => row.rowId === id))); assert.equal(receipt.totalMinor, '0');
  }
  assert.deepEqual((await f.rpc('memory.list')).conflicts, memory.conflicts);
  await f.restart(); assert.deepEqual((await f.rpc('memory.list')).conflicts, memory.conflicts); f.assertLocal();
});

test('private author epoch and current source grants are rechecked after actual encrypted reopening', async t => {
  const f = await fixture(t), baseline = await f.measurement('12505');
  const own = await f.publish(baseline, 'owner-private-condition');
  const member = await f.rpc('members.add', {name: 'Synthetic independent private brief author', role: 'cofounder', branches: ['main']});
  const session = await f.rpc('auth.session', {memberId: member.id});
  const memberReceipt = await f.calculate([A], 'main', session.token);
  const other = await f.publish(memberReceipt, 'member-private-condition', {}, session.token);
  const memberJob = await f.runJob(await f.createJob([A], session.token), session.token);
  const ownBrief = await f.brief({sourceIds: [A]}), memberBrief = await f.brief({sourceIds: [A]}, session.token);
  assert.deepEqual(ownBrief.alerts.items.map((item: any) => item.alertId), [own.id]);
  assert.deepEqual(memberBrief.alerts.items.map((item: any) => item.alertId), [other.id]);
  assert.equal(JSON.stringify(ownBrief.alerts).includes(other.definition.label), false);
  assert.equal((await f.rpc('jobs.list')).some((item: any) => item.id === memberJob.id), false);
  await f.rpc('members.revoke', {id: member.id}); await f.restart();
  for (const method of ['reports.brief', 'alerts.list', 'jobs.list']) {
    const response = await f.raw(method, {}, session.token); assert.equal(response.status, 401); assert.equal(response.body.error.code, 'UNAUTHENTICATED');
    assert.equal(response.body.result, undefined);
  }
  await f.rpc('trust.update', {allowedSources: []}); await f.restart();
  assert.deepEqual(await f.rpc('alerts.list'), []);
  const revoked = await f.brief({sourceIds: [A]}); assert.deepEqual(revoked.alerts.items, []); assert.deepEqual(revoked.alerts.receiptIds, []);
  assert.equal(JSON.stringify(revoked).includes(own.definition.label), false);
  await f.refuse('receipts.get', {id: baseline.id}, 'SOURCE_REVOKED'); f.assertLocal();
});

test('a genuinely conflicting partial receipt cannot clear an already open alert in the owner brief', async t => {
  const f = await fixture(t); await f.importRow('5000', A, 'sale-x'); await f.importRow('6000', B, 'sale-y');
  const baseline = await f.calculate([A, B]); assert.equal(baseline.totalMinor, '11000');
  assert.equal(baseline.coverage.completeness, 'reconciled-imports');
  let alert = await f.publish(baseline, 'open-then-conflicting');
  alert = (await f.evaluate(alert, baseline, 'qualified-open')).alert;
  assert.equal(alert.episodes.length, 1); assert.equal(alert.episodes[0].status, 'open');
  const episodeId = alert.episodes[0].id, delivered = await f.runJob(await f.createJob([A, B]));
  // Imports append versions: explicitly supersede sale-y rather than assuming omission deletes it.
  await f.importRows([{entity: 'sale-y', minor: '0'}, {entity: 'sale-x', minor: '6000'}], B);
  const conflict = (await f.rpc('memory.list')).conflicts; assert.equal(conflict.length, 1); assert.equal(conflict[0].rowIds.length, 2);
  const partial = await f.calculate([A, B]); assert.equal(partial.totalMinor, '0');
  assert.equal(partial.coverage.completeness, 'partial'); assert.equal(partial.coverage.unresolvedConflicts, 1);
  assert.ok(conflict[0].rowIds.every((id: string) => partial.exclusions.some(row => row.rowId === id)));
  alert = (await f.evaluate(alert, partial, 'conflicting-not-clear')).alert;
  const controls = f.controls(), current = await f.brief({sourceIds: [A, B]}); assert.deepEqual(f.controls(), controls);
  const item = current.alerts.items[0]; assert.equal(item.observation.state, 'unknown'); assert.equal(item.observation.receiptId, partial.id);
  assert.equal(item.evidence.state, 'uncertain'); assert.ok(item.evidence.issues.includes('coverage-partial'));
  assert.equal(item.episodes.length, 1); assert.equal(item.episodes[0].id, episodeId); assert.equal(item.episodes[0].status, 'open');
  assert.deepEqual(item.episodes, alert.episodes); assert.ok(current.receiptIds.includes(partial.id));
  assert.equal((await f.rpc('jobs.list')).find((job: any) => job.id === delivered.id).deliverable, undefined);
  const before = f.engine.vault!.read(); await f.refuse('jobs.accept', {id: delivered.id, repeat: true}, 'JOB_EVIDENCE_REVOKED');
  assert.deepEqual(f.engine.vault!.read(), before); await f.restart();
  assert.deepEqual((await f.brief({sourceIds: [A, B]})).alerts.items, current.alerts.items);
  assert.deepEqual((await f.rpc('memory.list')).conflicts, conflict); f.assertLocal();
});

test('source-scoped report and alert evidence coexist with authorized due decisions and recheck their current source access', async t => {
  const f = await fixture(t); await f.measurement('12505', A);
  const bReceipt = await f.measurement('4107', B, 'separate-b-decision-sale');
  const bAlert = await f.publish(bReceipt, 'outside-a-due-decision-scope');
  const decision = await f.rpc('decisions.create', {text: `${SECRET}_authorized_b_due_decision`,
    reviewDate: new Date().toISOString().slice(0, 10), receiptIds: [bReceipt.id], hypotheses: [], branch: 'main'});
  const delivered = await f.runJob(await f.createJob([A])), result = delivered.deliverable.result;
  assert.deepEqual(delivered.sourceIds, [A]); assert.deepEqual(result.alerts.scope, {branch: null, sourceIds: [A]});
  assert.deepEqual(result.alerts.items, []); assert.equal(JSON.stringify(result.alerts).includes(bAlert.definition.label), false);
  for (const id of result.receiptIds) {
    const receipt: CalculationReceipt = await f.rpc('receipts.get', {id});
    assert.deepEqual(receipt.requestedSourceIds, [A]); assert.ok(receipt.rows.every(row => row.sourceId === A));
    if (receipt.operation === 'net_sales') assert.equal(receipt.totalMinor, '12505');
  }
  // The documented due-decision inbox is broader than report/alert source filters.
  // Do not claim whole-brief source confinement from the top-level receipt list.
  assert.deepEqual(result.decisions.map((item: any) => item.id), [decision.id]);
  assert.deepEqual(result.decisions[0].receiptIds, [bReceipt.id]);
  assert.equal(result.receiptIds.includes(bReceipt.id), false);
  assert.equal((await f.rpc('receipts.get', {id: bReceipt.id})).totalMinor, '4107');
  t.diagnostic(JSON.stringify({case: 'authorized-global-due-decision', jobSourceIds: [A],
    reportAndAlertSourceIds: [A], decisionSourceIds: [B], decisionReceiptIncludedInTopLevelList: false}));
  await f.rpc('trust.update', {allowedSources: [A]}); await f.restart();
  const visible = (await f.rpc('jobs.list')).find((job: any) => job.id === delivered.id); assert.ok(visible);
  assert.deepEqual(visible.sourceIds, [A]); assert.equal(visible.deliverable, undefined);
  const current = await f.brief({sourceIds: [A]}); assert.deepEqual(current.decisions, []);
  const before = f.engine.vault!.read(); await f.refuse('jobs.accept', {id: delivered.id, repeat: true}, 'JOB_EVIDENCE_REVOKED');
  assert.deepEqual(f.engine.vault!.read(), before); await f.refuse('receipts.get', {id: bReceipt.id}, 'SOURCE_REVOKED'); f.assertLocal();
});

test('open cleared and newly reopened episodes remain literal retained history in repeated owner briefs', async t => {
  const f = await fixture(t); let alert = await f.publish(await f.measurement('5000'), 'repeated-history', {reopening: 'new-episode'});
  alert = (await f.evaluate(alert, await f.measurement('12505'), 'first-open')).alert;
  const firstId = alert.episodes[0].id; assert.equal(alert.episodes[0].status, 'open');
  alert = (await f.evaluate(alert, await f.measurement('7000'), 'qualified-clear')).alert;
  assert.equal(alert.episodes[0].status, 'cleared'); assert.equal(alert.episodes[0].id, firstId);
  const cleared = await f.brief({sourceIds: [A]}); assert.deepEqual(cleared.alerts.items[0].episodes, alert.episodes);
  alert = (await f.evaluate(alert, await f.measurement('15007'), 'second-open')).alert;
  assert.equal(alert.episodes.length, 2); assert.notEqual(alert.episodes[1].id, firstId);
  assert.deepEqual(alert.episodes.map(episode => episode.status), ['cleared', 'open']);
  const before = f.controls(), repeated = await f.brief({sourceIds: [A]});
  assert.deepEqual(f.controls(), before); assert.deepEqual(repeated.alerts.items[0].episodes, alert.episodes);
  assert.equal(repeated.alerts.items[0].evidence.state, 'current');
  const again = await f.brief({sourceIds: [A]}); assert.equal(again.alerts.pin, repeated.alerts.pin);
  assert.deepEqual(again.alerts.items, repeated.alerts.items); assert.deepEqual(f.controls(), before);
  await f.restart(); assert.deepEqual((await f.brief({sourceIds: [A]})).alerts.items, repeated.alerts.items); f.assertLocal();
});
