// One-shot B1 (W6-ALL-IDEAS section 4, "Stiff or confused replies" and "Tool jargon"): an agent's reply to a standing
// order and the launch checklist in plain words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDING_REPLY } from '../runtime/venture/agents/proposals.ts';
import { CHECKLIST_ITEMS } from '../runtime/venture/core/checklist.ts';
import { KEEPER_WORDS as AWAY_JOB_WORDS } from '../runtime/venture/delivery/away.ts';

test('an agent answers a standing order plainly', () => {
  assert.equal(STANDING_REPLY, "Got it. I've proposed it as a new rule for you to approve.");
});

test('the launch checklist says what to do, not which tool to open', () => {
  // B1 fix round 1 (spec 9): the checklist itself, not its source text.
  assert.equal(CHECKLIST_ITEMS.find(item => item.id === 'builder')?.label, 'Build your website');
  assert.equal(CHECKLIST_ITEMS.some(item => /Lovable|Replit/.test(item.label)), false);
});

// Hands-on bug 19: the run sheet said "in rehearsal" for a normal order. That is the agent's setting (How much it asks
// you), not the order, so the scope line now says it as the agent's.
test("a run's scope line says the agent's setting, never that the order is a rehearsal", async () => {
  const { RUN_SCOPE_POSTURE } = await import('../runtime/venture/views/runs.ts');
  assert.deepEqual(RUN_SCOPE_POSTURE, {
    rehearsal: 'with the agent still rehearsing', shadow: 'with the agent practicing on real orders',
    'approve-each': 'with each step waiting for your approval', 'auto-spot-check': 'on auto with spot checks',
  });
});

// SCREENS P1 (shot 18): the Keeper's job list on Away said "The check of actions whose outcome is unknown".
test("Away names the Keeper's journal check in plain words", () => {
  assert.equal(AWAY_JOB_WORDS['journal-sweep'], 'Checking anything that may not have gone through');
  assert.equal(Object.values(AWAY_JOB_WORDS).some(line => /outcome is unknown/.test(line)), false);
});

// B1 fix round 1 (spec 10): the two own-plan cost lines say the same thing the same way.
test('a run on your own AI plan reads the same whether all or some of it ran there', async () => {
  const { OWN_PLAN_PART, RAN_ON_OWN_PLAN } = await import('../runtime/venture/delivery/simulate.ts');
  assert.equal(RAN_ON_OWN_PLAN, 'Nothing extra, it ran on your own AI plan.');
  assert.equal(OWN_PLAN_PART, ' (plus calls on your own AI plan, nothing extra)');
});

// B1 fix round 1 (spec 6): the SEO pack's name, as W6-ALL-IDEAS section 4 put it ("Tool jargon").
test('the SEO pack is named for what it gets the owner', async () => {
  const { SEO_VISIBILITY_REGISTRATION } = await import('../runtime/venture/playbooks/seo-visibility/registration.ts');
  assert.equal(SEO_VISIBILITY_REGISTRATION.label, 'Get found on Google and AI search');
});

// B1 fix round 1 (quality 7): the chat consent's one screen line promises that keys, passphrases and bank or card numbers
// never go; every AI's consent text the owner agrees to says the same.
test('every AI\'s chat consent text carries the promise the screen line makes', async () => {
  const { chatConsentText } = await import('../runtime/venture/agents/consent.ts');
  const { PRESETS } = await import('../runtime/venture/models/presets.ts');
  assert.ok(PRESETS.length > 3);
  for (const preset of PRESETS) for (const withKey of [false, true]) {
    const text = chatConsentText({ presetId: preset.id, model: preset.id === 'openrouter' ? 'anthropic/claude' : null, connectionId: null, label: preset.label ?? preset.id, withKey } as never);
    assert.match(text, /Keys, passphrases and bank or card numbers are never sent\.$/, preset.id);
  }
});

// B1 fix round 1 (the founder's naming answers): a single agent task is a "job" in every line the engine writes for the
// owner, and one spelling, "practice".
test('the engine calls an agent task a job and spells practice one way', async () => {
  const { digestLine } = await import('../runtime/venture/notify/digest.ts');
  assert.equal(digestLine({ kinds: [], stillWaiting: 0, runsFinished: 3, ready: null }), 'Nothing needs you today. 3 jobs finished.');
  assert.equal(digestLine({ kinds: [], stillWaiting: 0, runsFinished: 1, ready: null }), 'Nothing needs you today. 1 job finished.');
  const { RUN_SCOPE_POSTURE } = await import('../runtime/venture/views/runs.ts');
  assert.equal(RUN_SCOPE_POSTURE.shadow, 'with the agent practicing on real orders');
  const { EXPERIMENTAL_NOTE } = await import('../runtime/venture/money/books.ts');
  const { EXPERIMENTAL_STORAGE_NOTICE } = await import('../runtime/venture/delivery/capabilities.ts');
  assert.equal(EXPERIMENTAL_NOTE, "Test version: practice here, don't send real invoices yet.");
  assert.equal(EXPERIMENTAL_STORAGE_NOTICE, EXPERIMENTAL_NOTE);
});

// B1 fix round 1 (the founder's default): "Settled chats" are "Old chats", and the change line says so.
test('a chat moved aside says it is in old chats', async () => {
  const { CHAT_STATE_WORDS } = await import('../runtime/venture/chief/states.ts');
  assert.equal(CHAT_STATE_WORDS.settled, 'Moved to old chats. It stays there until you open it again.');
});
