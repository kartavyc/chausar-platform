import assert from 'node:assert/strict';
import test from 'node:test';
import {A, fixture} from './fixtures/alert-brief-independent-acceptance.ts';
import type {CalculationReceipt} from '../runtime/calculator.ts';

// Original HTTP/Vault fixture and its trusted synthetic Date clock. No cleanup,
// receipt fabrication, changed access or source correction explains expiry.
test('current owner briefs require retained report receipts and facts while preserving encrypted historical bytes', async t => {
  const f = await fixture(t), day = 86_400_000;
  await f.rpc('trust.update', {retentionDays: 1});
  await f.measurement('5000');
  // Receipts are newer than the selected fact, so row expiry is independently
  // observable before receipt expiry. Empty reports separately prove receipt age.
  f.advance(day / 2);
  const accepted = await f.runJob(await f.createJob([A]));
  const selected = await f.runJob(await f.createJob([A]));
  const empty = await f.runJob(await f.createJob([]));
  const selectedResult = selected.deliverable.result, emptyResult = empty.deliverable.result;
  assert.deepEqual(selectedResult.alerts.items, []); assert.deepEqual(emptyResult.alerts.items, []);
  const selectedReceipts: CalculationReceipt[] = await Promise.all(selectedResult.report.receiptIds
    .map((id: string) => f.rpc('receipts.get', {id})));
  const sale = selectedReceipts.find(receipt => receipt.operation === 'net_sales');
  assert.ok(sale); assert.equal(sale.totalMinor, '5000'); assert.ok(sale.rowIds.length > 0);
  const emptyReceipts: CalculationReceipt[] = await Promise.all(emptyResult.report.receiptIds
    .map((id: string) => f.rpc('receipts.get', {id})));
  assert.ok(emptyReceipts.length > 0); assert.ok(emptyReceipts.every(receipt => receipt.rowIds.length === 0));
  const visible = await f.rpc('jobs.list');
  for (const job of [accepted, selected, empty]) {
    assert.deepEqual(visible.find((item: any) => item.id === job.id).deliverable, job.deliverable);
  }
  assert.equal((await f.rpc('jobs.accept', {id: accepted.id})).status, 'accepted',
    'Fresh retained evidence must still allow ordinary acceptance.');
  const historyBytes = () => {
    const state = f.engine.vault!.read();
    return JSON.stringify({facts: state.facts, receipts: state.receipts, answers: state.answers,
      conversations: state.conversations, jobs: state.jobs});
  };
  const retainedHistory = historyBytes();
  const unchangedRefusal = async (id: string, repeat: boolean) => {
    const before = f.engine.vault!.read(), ciphertext = await f.ciphertext();
    await f.refuse('jobs.accept', {id, repeat}, 'JOB_EVIDENCE_REVOKED');
    assert.deepEqual(f.engine.vault!.read(), before, 'Refusal rolls back counters, budget, acceptance and repeat scheduling.');
    assert.deepEqual(await f.ciphertext(), ciphertext, 'Refusal does not rewrite the encrypted authority file.');
    assert.equal(historyBytes(), retainedHistory);
  };

  f.advance(day / 2 + 10_000);
  const cutoff = Date.now() - day, state = f.engine.vault!.read();
  assert.ok(sale.rowIds.every(id => Date.parse(state.facts.find(fact => fact.id === id)!.learnedAt) < cutoff));
  assert.ok([...selectedReceipts, ...emptyReceipts].every(receipt => Date.parse(receipt.createdAt) >= cutoff),
    'The first refusal must be caused by selected fact age while all report receipts remain young.');
  for (const receipt of selectedReceipts) {
    assert.deepEqual(await f.rpc('receipts.get', {id: receipt.id}), receipt);
    assert.equal(receipt.stale, false, 'Historical arithmetic remains unchanged and unstaled without source edits.');
  }
  const rowExpired = await f.rpc('jobs.list');
  assert.equal(rowExpired.find((job: any) => job.id === selected.id).deliverable, undefined);
  assert.deepEqual(rowExpired.find((job: any) => job.id === empty.id).deliverable, empty.deliverable,
    'Young receipts without expired facts remain currently releasable.');
  assert.equal(historyBytes(), retainedHistory);
  await unchangedRefusal(selected.id, false); await unchangedRefusal(selected.id, true);

  f.advance(day);
  assert.ok(emptyReceipts.every(receipt => Date.parse(receipt.createdAt) < Date.now() - day));
  const receiptExpired = await f.rpc('jobs.list');
  for (const job of [selected, empty]) assert.equal(receiptExpired.find((item: any) => item.id === job.id).deliverable, undefined);
  for (const receipt of emptyReceipts) assert.deepEqual(await f.rpc('receipts.get', {id: receipt.id}), receipt);
  await unchangedRefusal(empty.id, false); await unchangedRefusal(empty.id, true);
  assert.equal(historyBytes(), retainedHistory);
  await f.restart();
  assert.equal(historyBytes(), retainedHistory, 'Real encrypted reopen preserves the exact retained report, fact and job history.');
  const reopened = await f.rpc('jobs.list');
  for (const job of [selected, empty]) assert.equal(reopened.find((item: any) => item.id === job.id).deliverable, undefined);
  await unchangedRefusal(selected.id, true); await unchangedRefusal(empty.id, true);
  f.assertLocal();
});
