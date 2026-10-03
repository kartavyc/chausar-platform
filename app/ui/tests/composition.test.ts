import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchSheetPrimary, sheetAtAddress, workspaceLocked } from '../src/app/composition.ts';
import type { Address, ScreenState } from '../src/app/presentation.ts';

test('sheet replies remain bound to the full authorized address', () => {
  const loaded = { place: 'work', sub: 'approvals', sheet: 'action_7c13d496-35af-471c-a180-165679bdb6c0' } satisfies Address;
  const content = Object.freeze({ receipt: 'private reply' });
  const bound = { address: loaded, content };
  assert.equal(sheetAtAddress({ ...loaded }, bound), content);
  for (const current of [null, { place: 'today', sheet: loaded.sheet }, { place: 'work', sub: 'jobs', sheet: loaded.sheet }, { place: 'work', sub: 'approvals', sheet: 'another_receipt' }, { place: 'work', sub: 'approvals' }] satisfies ReadonlyArray<Address | null>) {
    assert.equal(sheetAtAddress(current, bound), undefined);
  }
  assert.equal(sheetAtAddress(loaded, undefined), undefined);
});

test('a closed sheet cannot render stale host content even when both addresses have no sheet', () => {
  assert.equal(sheetAtAddress({ place: 'today' }, { address: { place: 'today' }, content: 'stale' }), undefined);
});

test('both rich and checked lock states suppress private composition', () => {
  const checked: ScreenState = { kind: 'boundary-state', source: { kind: 'locked', reasonCode: 'VAULT_LOCKED' } };
  assert.equal(workspaceLocked({ kind: 'locked' }), true);
  assert.equal(workspaceLocked(checked), true);
  assert.equal(workspaceLocked({ kind: 'ready' }), false);
  assert.equal(workspaceLocked({ kind: 'read-only' }), false);
});

test('money and disabled primaries cancel native Enter without invoking their callback', () => {
  for (const intent of [{ money: true }, { money: false, disabled: true }]) {
    const order: string[] = [];
    dispatchSheetPrimary({ preventDefault: () => order.push('cancel') }, { ...intent, onPress: () => order.push('run') });
    assert.deepEqual(order, ['cancel']);
  }
});

test('a permitted non-money primary runs only after native Enter has been cancelled', () => {
  for (const flag of [{ money: false }, {}]) {
    const order: string[] = [];
    dispatchSheetPrimary({ preventDefault: () => order.push('cancel') }, { ...flag, onPress: () => order.push('run') });
    assert.deepEqual(order, ['cancel', 'run']);
  }
});

test('without a registered sheet primary the shortcut has no action', () => {
  const order: string[] = [];
  dispatchSheetPrimary({ preventDefault: () => order.push('cancel') }, null);
  assert.deepEqual(order, []);
});
