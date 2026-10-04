import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScreenState } from '../src/app/presentation.ts';
import type { TodayIntents } from '../src/screens/today/TodayData.ts';
import { allowsTodayMutation, todayIntentsForState } from '../src/screens/today/permissions.ts';

function retainedHostIntents(): TodayIntents {
  return {
    onReview: () => {},
    onPrepare: () => {},
    onPrepareTiles: () => {},
    onOpenRow: () => {},
    onReceipt: () => {},
    onOpenActivity: () => {},
    onOpenEvent: () => {},
    onOpenTile: () => {},
    onSeeAll: () => {},
    onResumeSetup: () => {},
    onUpdate: () => {},
    onSaveClosing: () => {},
    onOpenQueueRow: () => {},
    onLens: () => {},
  };
}

const readOnlyStates: readonly ScreenState[] = [
  { kind: 'read-only', holder: 'another computer' },
  { kind: 'boundary-state', source: { kind: 'read-only', reasonCode: 'LOCK_HELD' } },
];

for (const state of readOnlyStates) {
  test(`${state.kind} hides retained mutation ports while preserving receipt and row reading`, () => {
    const offered = retainedHostIntents();
    const safe = todayIntentsForState(state, offered);
    assert.equal(allowsTodayMutation(state), false);
    for (const action of ['onPrepare', 'onPrepareTiles', 'onResumeSetup', 'onUpdate', 'onSaveClosing'] as const) {
      assert.equal(safe[action], undefined, action);
      assert.equal(typeof offered[action], 'function', `${action} remains untouched on the host object`);
    }
    for (const reading of ['onReview', 'onOpenRow', 'onReceipt', 'onOpenEvent', 'onOpenTile', 'onOpenActivity', 'onSeeAll', 'onOpenQueueRow', 'onLens'] as const) {
      assert.equal(safe[reading], offered[reading], reading);
    }
  });
}

test('ready and partial source states retain only the host ports actually supplied', () => {
  const offered = retainedHostIntents();
  const states: readonly ScreenState[] = [
    { kind: 'ready' },
    { kind: 'boundary-state', source: { kind: 'partial', asOf: null, reasonCode: 'IMPORT_PARTIAL' } },
  ];
  for (const state of states) {
    assert.equal(allowsTodayMutation(state), true);
    assert.equal(todayIntentsForState(state, offered), offered);
    const readingOnly: TodayIntents = { onReview: offered.onReview, onReceipt: offered.onReceipt };
    assert.equal(todayIntentsForState(state, readingOnly).onPrepare, undefined);
    assert.equal(todayIntentsForState(state, readingOnly).onSaveClosing, undefined);
  }
});
