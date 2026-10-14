import test from 'node:test';
import assert from 'node:assert/strict';
import { InvalidReply, run } from '../src/screens/work/kit/validate.ts';
import { actionView, approvalDetail, approvalList, idOf, jobs, partsOf, sheetOf } from '../src/screens/work/contract.ts';

const SHEET_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;
const NAMES = ['prepared', 'approved', 'done', 'read-back', 'recorded'];
const steps = NAMES.map(name => ({ name, state: 'not-reached', at: null }));
const row = {
  id: 'action:a1', source: 'action', kind: 'money', tier: 'tier-2', title: 'Pay a supplier', touches: null, amount: { minor: '1250000' },
  preparedBy: null, createdAt: '2026-10-01T09:00:00Z', expiresAt: null, state: 'prepared', practice: false,
};
const detail = { ...row, digest: 'd1', revision: 1, reason: 'always-waits:money', change: {}, steps, can: ['approve'], readOnly: false, prepareOnly: false, needsSecondAsk: true };

test('sheet ids are reversible and fit an address', () => {
  for (const id of ['action:a1', 'job:x_y', 'lesson:a@b:c', 'release:__']) {
    const sheet = sheetOf(id);
    assert.match(sheet, SHEET_ID);
    assert.equal(idOf(sheet), id);
  }
  assert.deepEqual(partsOf(sheetOf('tally', 'voucher:create_x')), ['tally', 'voucher:create_x']);
});

test('approval replies are checked field by field', () => {
  assert.equal(run(approvalDetail, detail).id, 'action:a1');
  assert.equal(run(approvalList, { items: [row], expired: [], snoozed: 0, counts: { tier2: 1, tier1: 0, prepareOnly: 0 } }).items.length, 1);
  assert.throws(() => run(approvalDetail, { ...detail, steps: steps.slice(0, 4) }), InvalidReply);
  assert.throws(() => run(approvalDetail, { ...detail, steps: [...steps].reverse() }), InvalidReply);
  assert.throws(() => run(approvalDetail, { ...detail, amount: { minor: 12500.5 } }), InvalidReply);
  assert.throws(() => run(approvalDetail, { ...detail, amount: { minor: '0', missing: 'unknown' }, tier: 'tier-3' }), InvalidReply);
  assert.throws(() => run(approvalDetail, { ...detail, can: ['approve', 'send-twice'] }), InvalidReply);
});

test('action, and jobs replies keep the contract shapes', () => {
  const view = { id: 'a1', system: 's', action: 'x', title: 't', touches: null, amount: null, state: 'unknown', steps, approvedBy: null, channel: 'phone',
    request: { to: 'someone' }, readBack: null, rule: 'r', attestation: null, wouldHaveDone: null, createdAt: '2026-10-01T09:00:00Z', settledAt: null, can: ['resolve'] };
  assert.equal(run(actionView, view).state, 'unknown');
  assert.throws(() => run(actionView, { ...view, request: { to: 5 } }), InvalidReply);
  assert.throws(() => run(jobs, { items: [], active: 0, limit: 12, proposals: { available: true } }), InvalidReply);
});
