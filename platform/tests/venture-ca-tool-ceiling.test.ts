import test from 'node:test';
import assert from 'node:assert/strict';
import { toolCeiling } from '../runtime/venture/delivery/harness/patches.ts';
import { CA_STEPS } from '../runtime/venture/playbooks/ca-firm/playbook.ts';

test('every active CA step tool is inside its own ceiling and tax tools stay out of other firms', () => {
  const ca = toolCeiling('bookkeeping', 'ca-firm');
  const ordinary = toolCeiling('bookkeeping');
  for (const name of new Set(CA_STEPS.flatMap(step => step.tools))) {
    assert.ok(ca.includes(name), name + ' must be granted to the CA playbook');
    if (name.startsWith('tax.')) assert.equal(ordinary.includes(name), false, name + ' must remain CA-only');
  }
});
