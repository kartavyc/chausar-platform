import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture, request, plan, refusedAnswer} from './comparison-scenario-custom-fields.ts';

// Explicit red coordinator join gate. Excluded from the ordinary *.test.ts
// suite. This never bypasses SQL refusal or admits a diagnostic receipt.
for (const operation of ['change', 'scenario'] as const) {
  test(`custom ${operation} diagnostic receipt must name and serialize its published money field`, async t => {
    const f = await fixture(t), input = request(operation);
    refusedAnswer((await f.turn(input, plan(operation, input))).answer);
    assert.equal(f.captured.length, 1);
    assert.deepEqual(f.captured[0].rows.map(row => row.entityId).sort(), operation === 'change'
      ? ['current-end', 'current-start', 'prior'] : ['current-end', 'current-start']);
    const expected: Record<string, string> = {'current-start': '10001', 'current-end': '20001', prior: '30000'};
    for (const row of f.captured[0].rows) {
      assert.equal(row.measureField, 'feeMinor', 'Shared calculator must preserve the published compound measure field.');
      assert.equal(row.amountMinor, expected[row.entityId], 'SQL projection must receive the exact custom-field amount.');
    }
    assert.equal(f.connectionCalls, 0); assert.deepEqual(f.custody().receipts, []);
  });
}
