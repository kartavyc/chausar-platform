// W6 6C5 (D20, D21): owner attestation of locked rules. A rule a lawyer or CA would confirm held every real client order
// (RULE_UNCONFIRMED) with no way forward. The owner now reads it in plain words and ticks "I am responsible for this in my
// business"; the tick is recorded with its date, can be withdrawn, and lapses if the rule's words change. Hard stops are
// listed and can never be attested. The other locked playbooks' real-order tests sit beside their own fixtures
// (recruiting, job search, newsletter, narration, data entry, app testing).
import test from 'node:test';
import assert from 'node:assert/strict';
import { kitBusiness, deliver, draft, owner } from './fixtures/venture/kit-business.ts';
import { consentForOrder } from './fixtures/venture/scripted-agent.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { SUPPORT_DESK_DEFINITION } from '../runtime/venture/playbooks/support-desk/definition.ts';
import { ATTEST_WORDS, ATTESTATION_PLAYBOOKS, ruleDigest } from '../runtime/venture/playbooks/kit/attestation.ts';
import { HARD_STOPS } from '../runtime/venture/policy/hard-stops.ts';
import { rulesAttestHandler } from '../runtime/venture/playbooks/rules-attest.ts';
import { kitDefinitions } from '../runtime/venture/playbooks/kit/installed.ts';
import type { RuleLocksView } from '../runtime/venture/contracts.ts';

const phone = { ...owner, channel: 'phone' as const };
const code = (expected: string) => (error: any) => { assert.equal(error.code, expected, error.message); return true; };
const supportIntake = (id: string) => {
  const keys = SUPPORT_DESK_DEFINITION.offers.find(o => o.id === id)!.intake;
  return { intake: { fields: Object.fromEntries(Object.entries({ languages: ['en'] }).filter(([key]) => keys.includes(key))) },
    ...(keys.includes('policies') ? { intakeFiles: { policies: { name: 'policy.csv', contentBase64: Buffer.from('Topic,Rule\nParcel,Track').toString('base64') } } } : {}) };
};

test('the eight locked playbooks are the attestation playbooks, each with at least one locked rule', () => {
  assert.deepEqual([...ATTESTATION_PLAYBOOKS].sort(), ['app-testing', 'data-entry-desk', 'job-search-desk', 'lead-generation', 'narration-studio', 'newsletter-studio', 'recruiting-desk', 'support-desk']);
  for (const id of ATTESTATION_PLAYBOOKS) {
    const definition = kitDefinitions().find(item => item.registration.id === id);
    assert.ok(definition?.rules.some(rule => rule.needs && !rule.confirmedBy), id);
  }
  assert.equal(HARD_STOPS.length, 9);
  for (const stop of HARD_STOPS) assert.doesNotMatch(stop.line, /\u2014/);
});

test('support desk: the owner reads each locked rule, ticks it with the date, and the held real order then runs and is accepted', async () => {
  const env = await kitBusiness({ now: new Date('2026-10-27T10:00:00Z') }, { idea: 'Support desk for small shops' });
  let locks = await env.call('venture.rules.locks') as RuleLocksView;
  assert.equal(locks.playbook?.id, 'support-desk');
  assert.equal(locks.words, ATTEST_WORDS);
  assert.deepEqual(locks.rules.map(rule => [rule.id, rule.needs, rule.attestable, rule.attestedOn]), [['consumer-grievance', 'lawyer', true, null], ['support-privacy', 'lawyer', true, null]]);
  assert.ok(locks.rules.every(rule => rule.rule.length > 0 && rule.limitations.length > 0 && rule.sources.length > 0));
  assert.deepEqual(locks.hardStops.map(stop => stop.id), HARD_STOPS.map(stop => stop.id));
  assert.equal(locks.line, '2 rules wait for your tick.');

  const first = env.offers.find(o => o.playbookOffer === 'monthly-support')!;
  const held = await env.call('venture.order.create', { clientId: env.client.id, offerId: first.id, request: 'Draft a reply from the shop policy.', ...supportIntake(first.playbookOffer!) });
  await assert.rejects(env.call('venture.delivery.run', { orderId: held.id }), code('RULE_UNCONFIRMED'));

  const rule = locks.rules[0]!;
  await assert.rejects(env.call('venture.rules.attest', { ruleId: rule.id, attest: true, digest: 'rule-stale' }), code('APPROVAL_STALE'));
  await assert.rejects(env.call('venture.rules.attest', { ruleId: rule.id, attest: true }), code('APPROVAL_STALE'));
  await assert.rejects(rulesAttestHandler(env.deps, phone, { ruleId: rule.id, attest: true, digest: rule.digest }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.call('venture.rules.attest', { ruleId: 'not-a-rule', attest: true, digest: rule.digest }), code('RULE_NOT_FOUND'));
  await assert.rejects(env.call('venture.rules.attest', { ruleId: 'site-form-permission', attest: true, digest: 'x' }), code('RULE_NOT_ATTESTABLE'));
  for (const stop of HARD_STOPS) await assert.rejects(env.call('venture.rules.attest', { ruleId: stop.id, attest: true, digest: rule.digest }), code('HARD_STOP'));
  assert.equal(listRecords(env.store.read(), 'venture-rule-attestation').length, 0);

  for (const item of locks.rules) locks = await env.call('venture.rules.attest', { ruleId: item.id, attest: true, digest: item.digest }) as RuleLocksView;
  assert.deepEqual(locks.rules.map(item => item.attestedOn), ['2026-10-27', '2026-10-27']);
  assert.equal(locks.line, 'Every rule you can tick is ticked.');
  assert.ok(locks.rules.every(item => item.line === 'You said you are responsible for this on 2026-10-27.'));
  const records = listRecords(env.store.read(), 'venture-rule-attestation');
  assert.deepEqual(records.map(r => [r.ruleId, r.attestedOn, r.withdrawnAt, r.memberId]), [['consumer-grievance', '2026-10-27', null, 'owner'], ['support-privacy', '2026-10-27', null, 'owner']]);
  // Ticking again changes nothing.
  await env.call('venture.rules.attest', { ruleId: rule.id, attest: true, digest: rule.digest });
  assert.equal(listRecords(env.store.read(), 'venture-rule-attestation').length, 2);

  const run = await deliver(env, held.id, draft('Support draft', { Reply: ['Please check the parcel with the carrier. Nothing has been sent.'], Sources: ['Source: policy.csv'], 'Open questions': ['The shop owner will review this draft.'] }));
  assert.equal(run.status, 'ready-for-review', JSON.stringify({ status: run.status, checks: run.checks }));
  assert.equal(run.servedBy, 'model');
  await env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' });
  assert.equal(listRecords(env.store.read(), 'venture-delivery-run').find(r => r.id === run.id)?.status, 'accepted');

  // Withdrawn: the next real order is held again, and the tick says so.
  locks = await env.call('venture.rules.attest', { ruleId: 'support-privacy', attest: false }) as RuleLocksView;
  assert.equal(locks.rules.find(item => item.id === 'support-privacy')?.attestedOn, null);
  assert.ok(listRecords(env.store.read(), 'venture-rule-attestation').find(r => r.ruleId === 'support-privacy')?.withdrawnAt);
  const again = await env.call('venture.order.create', { clientId: env.client.id, offerId: first.id, request: 'Another reply.', ...supportIntake(first.playbookOffer!) });
  await assert.rejects(env.call('venture.delivery.run', { orderId: again.id }), code('RULE_UNCONFIRMED'));
});

test('an attestation of older words no longer counts once the rule changes', async () => {
  const env = await kitBusiness({ now: new Date('2026-10-27T10:00:00Z') }, { idea: 'Support desk for small shops' });
  const locks = await env.call('venture.rules.locks') as RuleLocksView;
  for (const item of locks.rules) await env.call('venture.rules.attest', { ruleId: item.id, attest: true, digest: item.digest });
  // Simulate an attestation recorded against older words of the rule.
  await ventureAction(env.deps, owner, 'approve', 'fixture.older-words', tx => {
    const row = tx.list('venture-rule-attestation').find(r => r.ruleId === 'support-privacy')!;
    tx.replace({ ...row, digest: ruleDigest({ id: 'support-privacy', topic: 'Customer privacy', rule: 'Older words.', limitations: 'x', needs: 'lawyer' }) });
  });
  const after = await env.call('venture.rules.locks') as RuleLocksView;
  assert.equal(after.rules.find(item => item.id === 'support-privacy')?.attestedOn, null);
  const first = env.offers.find(o => o.playbookOffer === 'monthly-support')!;
  const held = await env.call('venture.order.create', { clientId: env.client.id, offerId: first.id, request: 'Draft a reply.', ...supportIntake(first.playbookOffer!) });
  await consentForOrder(env.deps, owner, held.id);
  await assert.rejects(env.call('venture.delivery.run', { orderId: held.id }), code('RULE_UNCONFIRMED'));
});

test('lead generation: after the owner ticks its three legal rules, the held real order runs', async () => {
  const env = await kitBusiness({ now: new Date('2026-10-27T10:00:00Z') }, { idea: 'Lead generation for local businesses in Mumbai' });
  const fields = { city: 'Mumbai', vertical: 'shop=bakery', count: '10', ownOffer: 'shop websites', postalAddress: '12 Lake Road', sendDays: ['Monday'], sendTime: '09:30' };
  const first = env.offers.find(offer => offer.playbookOffer === 'researched-pipeline')!;
  const held = await env.call('venture.order.create', { clientId: env.client.id, offerId: first.id, request: 'Lead research for shop websites in Mumbai. Source https://bakery.example.', intake: { fields } });
  await assert.rejects(env.call('venture.delivery.run', { orderId: held.id }), code('RULE_UNCONFIRMED'));
  const locks = await env.call('venture.rules.locks') as RuleLocksView;
  assert.deepEqual(locks.rules.map(rule => rule.id), ['trai-dnd', 'can-spam', 'dpdp-contact-data']);
  for (const item of locks.rules) await env.call('venture.rules.attest', { ruleId: item.id, attest: true, digest: item.digest });
  const run = await deliver(env, held.id, draft('Local lead report', { 'Lead report': ['Source https://bakery.example. Review this bakery for your own website offer. You send every message yourself.'] }));
  assert.equal(run.status, 'ready-for-review', JSON.stringify({ status: run.status, checks: run.checks }));
  assert.equal(run.servedBy, 'model');
  await env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' });
  assert.equal(listRecords(env.store.read(), 'venture-delivery-run').find(r => r.id === run.id)?.status, 'accepted');
});

test('the CA firm keeps its professional sign-off: no owner attestation is offered for its rules', async () => {
  const env = await kitBusiness({ now: new Date('2026-10-27T10:00:00Z') }, { idea: 'A chartered accountant practice: books, GST and income tax for small businesses' });
  const locks = await env.call('venture.rules.locks') as RuleLocksView;
  if (locks.playbook?.id === 'ca-firm') {
    assert.deepEqual(locks.rules, []);
    assert.match(locks.line, /CA of record/);
  }
  for (const id of ['ca-tds-thresholds']) await assert.rejects(env.call('venture.rules.attest', { ruleId: id, attest: true, digest: 'x' }), code('RULE_NOT_FOUND'));
});

test('the registers the fake engine reads equal the installed definitions, and every other locked rule is listed as waiting elsewhere', async () => {
  const { SUPPORT_RULES } = await import('../runtime/venture/playbooks/support-desk/rules.ts');
  const { LEAD_RULES } = await import('../runtime/venture/playbooks/lead-generation/rules.ts');
  const { RECRUITING_RULES } = await import('../runtime/venture/playbooks/recruiting-desk/rules.ts');
  const { CAREER_PRIVACY_RULE } = await import('../runtime/venture/playbooks/job-search-desk/metadata-core.ts');
  const { NEWSLETTER_PRIVACY_RULE, NEWSLETTER_SPONSOR_RULE, NEWSLETTER_US_RULE } = await import('../runtime/venture/playbooks/newsletter-studio/legal-core.ts');
  const { NARRATION_RULES } = await import('../runtime/venture/playbooks/narration-studio/rules.ts');
  const { FORMS_ACCESS_RULE } = await import('../runtime/venture/playbooks/data-entry-desk/rules.ts');
  const { APP_TESTING_RULES } = await import('../runtime/venture/playbooks/app-testing/rules.ts');
  const { LOCKED_ELSEWHERE, ruleIsLocked } = await import('../runtime/venture/playbooks/kit/attestation.ts');
  const registers: Record<string, readonly any[]> = {
    'support-desk': SUPPORT_RULES, 'lead-generation': LEAD_RULES, 'recruiting-desk': RECRUITING_RULES, 'job-search-desk': [CAREER_PRIVACY_RULE],
    'newsletter-studio': [NEWSLETTER_PRIVACY_RULE, NEWSLETTER_SPONSOR_RULE, NEWSLETTER_US_RULE], 'narration-studio': NARRATION_RULES,
    'data-entry-desk': [FORMS_ACCESS_RULE], 'app-testing': APP_TESTING_RULES,
  };
  const elsewhere: Record<string, string[]> = {};
  for (const definition of kitDefinitions()) {
    const id = definition.registration.id;
    const fromDefinition = definition.rules.filter(ruleIsLocked).map(rule => [rule.id, ruleDigest(rule)]);
    if (registers[id]) assert.deepEqual(registers[id]!.filter(ruleIsLocked).map(rule => [rule.id, ruleDigest(rule)]), fromDefinition, id);
    else if (fromDefinition.length) elsewhere[id] = fromDefinition.map(([ruleId]) => ruleId!);
  }
  assert.deepEqual(elsewhere, LOCKED_ELSEWHERE);
});
