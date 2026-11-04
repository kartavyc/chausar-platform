// One-shot B1 (hands-on row 12; SCREENS shot 5): the planned rows of "Connect what your business needs" in plain
// words. Still honest (label planned, who it waits on, the manual path meanwhile), but no developer word
// ("Fixture-tested") and no template sentence ("Waits on Chausar's X connection, which is planned.").
import test from 'node:test';
import assert from 'node:assert/strict';
import { FAMILY_IDS } from '../runtime/venture/core/families.ts';
import { businessNeeds } from '../runtime/venture/core/needs.ts';

const every = () => [...FAMILY_IDS, null].flatMap(family => businessNeeds(family, 'IN'));

test('no planned row says Fixture-tested or the old template sentence', () => {
  for (const need of every()) {
    for (const words of [need.waitsOn, need.meanwhile]) {
      if (words === null) continue;
      assert.doesNotMatch(words, /fixture|which is planned|Meanwhile/i, `${need.id}: ${words}`);
    }
  }
});

test("a planned card says Chausar's link comes later, and the way to do it until then", () => {
  const cal = businessNeeds('local-services', 'IN').find(need => need.id === 'cal-com')!;
  assert.equal(cal.label, 'planned');
  assert.equal(cal.waitsOn, "Chausar's Cal.com link is coming later.");
  assert.equal(cal.meanwhile, 'Use Cal.com on its own until then.');
  const razorpay = businessNeeds('money-tax', 'IN').find(need => need.id === 'razorpay')!;
  assert.equal(razorpay.waitsOn, "Chausar's Razorpay link is coming later.");
  assert.equal(razorpay.meanwhile, 'For now, share your UPI or bank details and mark payments yourself.');
});

test("a built service that waits on the owner's own key says so, and where to add it", () => {
  const probe = businessNeeds('money-tax', 'IN').find(need => need.id === 'probe42')!;
  assert.equal(probe.label, 'planned');
  assert.equal(probe.waitsOn, 'Needs your own Probe42 key, added in Connections, More ways to connect. Not tried on a live account yet.');
  assert.equal(probe.meanwhile, 'Check a company on the MCA website yourself.');
});
