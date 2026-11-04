// One-shot A4 (hands-on row 103, S10): Rehearse and the improvement loop said "USD 0.0000" after a live run on Claude
// Code or Codex, as if the AI were free. Those calls run on the owner's own plan, so the cost says so (A4 review L4: with\n// no amount at all when nothing was charged to a key).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spendSummary } from '../runtime/venture/delivery/simulate.ts';

test('a rehearsal on the owner\'s own AI plan says so; a key\'s cost stays as it was', () => {
  assert.equal(spendSummary([{ by: 'model', costMicros: '0', priceConfirmed: true, presetId: 'claude-code-cli' }]).costDisplay, 'Ran on your own plan.');
  assert.equal(spendSummary([{ by: 'model', costMicros: '0', priceConfirmed: true, presetId: 'codex-cli' }, { by: 'model', costMicros: '0', priceConfirmed: true, presetId: 'codex-cli' }]).costDisplay, 'Ran on your own plan.');
  assert.equal(spendSummary([{ by: 'model', costMicros: '1200', priceConfirmed: true, presetId: 'anthropic-haiku-5-5' }, { by: 'model', costMicros: '0', priceConfirmed: true, presetId: 'codex-cli' }]).costDisplay, 'USD 0.0012 (plus calls on your own plan)');
  assert.equal(spendSummary([{ by: 'model', costMicros: '1200', priceConfirmed: true, presetId: 'anthropic-haiku-5-5' }]).costDisplay, 'USD 0.0012');
  assert.equal(spendSummary([{ by: 'template', costMicros: '0', priceConfirmed: true, presetId: 'built-in-templates' }]).costDisplay, 'USD 0.0000');
});
