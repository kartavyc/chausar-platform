// Collections behavior, after finance-skills (MIT prompt ideas); original Chausar tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionStage, promiseStatus, DEFAULT_LADDER, validateLadder, reminderDraft } from '../runtime/venture/playbooks/bookkeeping-cfo/collections.ts';

test('two broken promises move the client up exactly one stage in the owner editable ladder', () => {
  assert.equal(collectionStage(12, 0).id, 'reminder');
  assert.equal(collectionStage(12, 2).id, 'call');
  assert.equal(collectionStage(190, 3).id, 'writeoff');
  const own = DEFAULT_LADDER.map((row, index) => ({ ...row, fromDay: index * 10 + 1 }));
  assert.equal(collectionStage(14, 0, own).id, 'call');
  assert.throws(() => validateLadder([...own].reverse()), { code: 'COLLECTION_LADDER_INVALID' });
});

test('only cleared payments against promised invoices by its date keep a promise', () => {
  const promise = { invoiceIds: ['inv-a'], amountMinor: '10000', promisedOn: '2026-10-20' };
  const payments = [
    { invoiceId: 'inv-a', amountMinor: '4000', receivedOn: '2026-10-19', cleared: true },
    { invoiceId: 'inv-a', amountMinor: '6000', receivedOn: '2026-10-20', cleared: true },
  ];
  assert.equal(promiseStatus(promise, payments, '2026-10-21'), 'kept');
  assert.equal(promiseStatus(promise, payments.slice(0, 1), '2026-10-19'), 'pending');
  assert.equal(promiseStatus(promise, [{ ...payments[1], receivedOn: '2026-10-21' }], '2026-10-22'), 'broken');
  assert.equal(promiseStatus(promise, payments.map(p => ({ ...p, cleared: false })), '2026-10-21'), 'broken');
  assert.equal(promiseStatus(promise, payments.map(p => ({ ...p, invoiceId: 'inv-b' })), '2026-10-21'), 'broken');
});

test('a reminder is addressed only to the service client for their own review and send', () => {
  const draft = reminderDraft('client-a', 'inv-a', 'Call the customer through your own known contact.');
  assert.equal(draft.toClientId, 'client-a');
  assert.equal(draft.sender, 'client');
  assert.equal(draft.needsApproval, true);
  assert.throws(() => reminderDraft('client-a', 'inv-a', 'Pay us today.', 'debtor@example.test'), { code: 'NO_DEBTOR_CONTACT' });
});
