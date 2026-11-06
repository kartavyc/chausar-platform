// Integration regression: an ad correction reaches the writing stage used by that offer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, ruleStep } from '../runtime/venture/delivery/improve.ts';
import { flagshipDelivery } from '../runtime/venture/playbooks/steps.ts';
import { applyPatch } from '../runtime/venture/delivery/harness/patches.ts';
import { DEFAULT_LIMITS } from '../runtime/venture/delivery/harness/loop.ts';

test('ad disclosure and customer-pretence corrections reach the actual ad-writing stage', () => {
  const delivery = flagshipDelivery('social-agency')!;
  for (const [offer, stage] of [['video-ads', 1], ['ugc-ads', 2]] as const) {
    const actualStep = delivery.draftStep(offer, stage);
    for (const reason of ['ad-disclosed', 'no-customer-pretence']) {
      const rule = RULES[reason];
      assert.ok(rule && 'op' in rule);
      const updated = applyPatch({ steps: structuredClone([...delivery.steps]), limits: { ...DEFAULT_LIMITS }, aliases: {} }, {
        id: 'patch_ad', level: rule.level, op: rule.op, stepId: ruleStep(rule.stepId, delivery.id), value: rule.value,
        note: { hypothesis: 'Keep the ad honest.', expectedFixes: [reason], likelyRegressions: [] }, proposedBy: 'chausar', parentHash: 'fixture',
      }, { serviceType: 'agency', entryIds: [], flagship: delivery.id });
      assert.ok(updated.steps.find(step => step.id === actualStep)?.guidance?.includes(rule.value), `${reason} reaches ${offer} writing`);
    }
  }
});

test('b-roll correction reaches the step that actually chooses added images', () => {
  const delivery = flagshipDelivery('youtube')!;
  const rule = RULES['broll-fits-claim'];
  assert.ok(rule && 'op' in rule);
  const actualStep = delivery.steps.find(step => step.tools?.includes('youtube.broll'))!;
  assert.ok(actualStep);
  assert.equal(ruleStep(rule.stepId, delivery.id), actualStep.id);
});
