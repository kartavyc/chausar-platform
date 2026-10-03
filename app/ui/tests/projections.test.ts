import test from 'node:test';
import assert from 'node:assert/strict';
import { figureFromReceipt, engineFigureDisplay, UnsupportedPresentationUnitError } from '../src/bridge/projections.ts';
import { approvalControls, canUsePrimaryKeyboard, phoneActions } from '../src/bridge/controls.ts';
import { ReplyValidationError } from '../src/bridge/validate.ts';
import { receiptEvidenceFixture, approvalFixture, phoneFixture } from './fixtures.ts';

test('receipt projection selects exact engine units and retained display, never totals from rows', () => {
  const receipt = receiptEvidenceFixture();
  assert.deepEqual(figureFromReceipt(receipt, 'contribution'), { kind: 'money', currency: 'INR', paise: '275', receiptId: receipt.id, labels: [] });
  assert.deepEqual(figureFromReceipt(receipt, 'marginBps'), { kind: 'percent', basisPoints: '3437', receiptId: receipt.id, labels: [] });
  assert.equal(engineFigureDisplay(receipt, 'contribution'), 'INR 2.75');
  assert.throws(() => figureFromReceipt(receipt, 'absent-key'), ReplyValidationError);
  // This operation has multiple financial figures and positive rows, not a ledger sum.
  assert.equal(figureFromReceipt(receipt, 'contribution').kind, 'money');
  assert.equal(receipt.totalMinor, '275');
});

test('zero with loaded coverage stays zero and empty coverage stays unknown', () => {
  const knownZero = { ...receiptEvidenceFixture(), figures: [{ key: 'total', label: 'Total', minor: '0', display: 'INR 0', unit: 'money' as const, currency: 'INR' }], valueMinor: '0', totalMinor: '0', rowIds: [], rows: [], coverage: { ...receiptEvidenceFixture().coverage, selectedRows: 0, countedRows: 0, completeness: 'reconciled-imports' as const } };
  assert.deepEqual(figureFromReceipt(knownZero, 'total'), { kind: 'money', currency: 'INR', paise: '0', receiptId: knownZero.id, labels: [] });
  assert.deepEqual(figureFromReceipt({ ...knownZero, coverage: { ...knownZero.coverage, completeness: 'empty' } }, 'total'), { kind: 'missing', state: 'unknown' });
  assert.deepEqual(figureFromReceipt({ ...knownZero, coverage: { ...knownZero.coverage, completeness: 'partial', unresolvedConflicts: 1, gaps: ['All selected amounts are unknown, not zero.'] } }, 'total'), { kind: 'missing', state: 'unknown' });
});

test('partial and stale evidence stays qualified; unsupported currency and invented provenance fail', () => {
  const receipt = receiptEvidenceFixture();
  assert.deepEqual(figureFromReceipt({ ...receipt, stale: true, staleReason: 'Source changed', coverage: { ...receipt.coverage, completeness: 'partial' } }, 'contribution'), { kind: 'money', currency: 'INR', paise: '275', receiptId: receipt.id, labels: ['stale'] });
  const usd = { ...receipt, currency: 'USD', figures: receipt.figures.map(f => f.unit === 'money' ? { ...f, currency: 'USD' } : f) };
  assert.throws(() => figureFromReceipt(usd, 'contribution'), UnsupportedPresentationUnitError);
  assert.throws(() => figureFromReceipt(receipt, 'contribution', ['seed']), ReplyValidationError);
  assert.throws(() => figureFromReceipt(receipt, 'contribution', ['stale']), ReplyValidationError);
});

test('approval controls use only offered actions, preserve exact revision and prevent money shortcut', () => {
  const approval = approvalFixture();
  assert.deepEqual(approvalControls({ ...approval, can: ['notNow'] }), [{ action: 'notNow', keyboardPrimary: false, requiresSecondAsk: false }]);
  assert.equal(canUsePrimaryKeyboard(approval), true);
  const money = { ...approval, kind: 'money' as const, needsSecondAsk: true };
  assert.equal(canUsePrimaryKeyboard(money), false);
  assert.equal(approvalControls(money).find(c => c.action === 'approve')?.requiresSecondAsk, true);
  assert.equal(canUsePrimaryKeyboard({ ...approval, needsSecondAsk: true }), false);
  assert.deepEqual(approvalControls({ ...approval, kind: 'prepare-only', prepareOnly: true, can: ['change', 'drop'] }).map(c => c.action), ['change', 'drop']);
  assert.deepEqual(approvalControls({ ...approval, readOnly: true, can: [] }), []);
  assert.deepEqual(approvalControls({ ...approval, state: 'unknown', can: ['reconcile'] }), [{ action: 'reconcile', keyboardPrimary: false, requiresSecondAsk: false }]);
  assert.throws(() => approvalControls({ ...approval, state: 'unknown' }), ReplyValidationError);
  assert.throws(() => approvalControls({ ...approval, readOnly: true }), ReplyValidationError);
  assert.throws(() => approvalControls({ ...approval, can: ['reconcile'] }), ReplyValidationError);
});

test('phone approval expiry is enforced in controls using provided UI clock, never extended', () => {
  const phone = phoneFixture();
  assert.deepEqual(phoneActions(phone, Date.parse('2029-12-31T23:59:59.000Z')), ['approve', 'notNow', 'open-app']);
  assert.deepEqual(phoneActions(phone, Date.parse('2030-01-01T00:00:00.000Z')), ['open-app']);
  assert.deepEqual(phoneActions({ ...phone, approval: null }, Date.now()), []);
  assert.deepEqual(phoneActions({ ...phone, approval: { policy: 'open-app-only', expiresAt: '2030-01-01T00:00:00.000Z', actions: ['open-app'] } }, Date.now()), ['open-app']);
  assert.throws(() => phoneActions(phone, NaN), { message: 'INVALID_UI_CLOCK' });
});
