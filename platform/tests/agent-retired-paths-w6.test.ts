import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handlers } from '../runtime/venture/delivery/index.ts';
import { VENTURE_METHODS } from '../runtime/venture/contract-values.ts';
import * as delivery from '../runtime/venture/delivery/runs.ts';

test('delivery exposes one native job entry and no turn approval or separate delegation path', () => {
  assert.equal(typeof handlers['venture.delivery.run'], 'function');
  for (const method of ['venture.delivery.approve', 'venture.delivery.answer', 'venture.delivery.delegate']) {
    assert.equal((handlers as Record<string, unknown>)[method], undefined, method);
    assert.equal((VENTURE_METHODS as readonly string[]).includes(method), false, method);
  }
  assert.equal('previewNextTurn' in delivery, false);
  assert.equal('approveDelivery' in delivery, false);
});
