// W6 6C6 (D5, D21): the day-job and compliance check. When the profession is picked, onboarding asks the side-work
// question, shows the profession's rules, and the engine switches off what its regulator forbids (outreach and
// advertising for advocates). The switch-off holds whatever the settings or attestations say: it is a hard stop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kitBusiness, owner } from './fixtures/venture/kit-business.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { complianceBeforeVault, refuseRegulatorForbidden } from '../runtime/venture/core/compliance.ts';
import { PROFESSION_COMPLIANCE, SIDE_WORK_QUESTION } from '../runtime/venture/core/compliance-data.ts';
import { outreachDraft, outreachOpen } from '../runtime/venture/network/outreach.ts';
import { leadsDraft } from '../runtime/venture/customers/lead-methods.ts';
import { postingPropose } from '../runtime/venture/build/posting.ts';
import { handlers as coreHandlers } from '../runtime/venture/core/index.ts';
import { HARD_STOPS } from '../runtime/venture/policy/hard-stops.ts';
import type { ComplianceView, RuleLocksView } from '../runtime/venture/contracts.ts';

const phone = { ...owner, channel: 'phone' as const };
const code = (expected: string) => (error: any) => { assert.equal(error.code, expected, error.message); return true; };

test('the side-work question and each profession rule are plain, unchecked statutes are marked, and an unknown profession is refused', () => {
  const advocate = complianceBeforeVault({ profession: 'advocate' });
  assert.equal(advocate.question, SIDE_WORK_QUESTION);
  assert.equal(advocate.question, 'Does your employment contract allow side work? This is your responsibility.');
  assert.match(advocate.responsibility, /responsible/);
  // W6 F4: BCI Rule 36 was read on the Bar Council's own site on 2 November 2026.
  assert.deepEqual(advocate.rules.map(rule => [rule.id, rule.checked]), [['bci-rule-36', true]]);
  assert.deepEqual(advocate.switchedOff.map(item => item.tool), ['outreach', 'advertising']);
  assert.deepEqual(advocate.hardStops.map(stop => stop.id), ['advocate-solicit']);
  assert.equal(advocate.recorded, null);
  // A family id answers too, with no profession-specific rules (the tutor's family switches nothing off).
  const teaching = complianceBeforeVault({ profession: 'teaching' });
  assert.deepEqual([teaching.rules, teaching.switchedOff], [[], []]);
  assert.throws(() => complianceBeforeVault({ profession: 'astronaut' }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => complianceBeforeVault({}), code('INVALID_VENTURE_REQUEST'));
  for (const item of PROFESSION_COMPLIANCE) {
    for (const words of [item.label, ...item.rules.map(rule => rule.line), ...item.switchedOff.map(entry => entry.line)]) assert.doesNotMatch(words, /\u2014/, words);
    for (const id of item.hardStops) assert.ok(HARD_STOPS.some(stop => stop.id === id), id);
  }
});

test('an advocate business records the side-work answer with the date, and outreach and promotion stay off even after every rule is attested', async () => {
  const env = await kitBusiness({ now: new Date('2026-10-27T10:00:00Z') }, { idea: 'Support desk for small shops' });
  const get = (payload: unknown) => coreHandlers['venture.compliance.get']!(env.deps, owner, payload) as Promise<ComplianceView>;
  const set = (payload: unknown, ctx = owner) => coreHandlers['venture.compliance.set']!(env.deps, ctx, payload) as Promise<ComplianceView>;
  const view = await get({ profession: 'advocate' });
  assert.equal(view.recorded, null);
  await assert.rejects(set({ profession: 'advocate', sideWork: 'allowed', digest: 'compliance-old' }), code('APPROVAL_STALE'));
  await assert.rejects(set({ profession: 'advocate', sideWork: 'maybe', digest: view.digest }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(set({ profession: 'advocate', sideWork: 'allowed', digest: view.digest }, phone), code('APP_APPROVAL_REQUIRED'));
  // Before the profession is recorded, nothing is switched off.
  assert.doesNotThrow(() => refuseRegulatorForbidden(env.store.read(), 'outreach'));
  const recorded = await set({ profession: 'advocate', sideWork: 'not-sure', digest: view.digest });
  assert.deepEqual(recorded.recorded, { professionId: 'advocate', sideWork: 'not-sure', acknowledgedOn: '2026-10-27' });
  assert.deepEqual(listRecords(env.store.read(), 'venture-compliance').map(row => [row.professionId, row.sideWork, row.switchedOff]), [['advocate', 'not-sure', ['outreach', 'advertising']]]);
  assert.deepEqual((await get({})).recorded?.professionId, 'advocate');

  // Every attestable rule of the business is ticked: the regulator's switch-off still holds.
  const locks = await env.call('venture.rules.locks') as RuleLocksView;
  for (const rule of locks.rules) await env.call('venture.rules.attest', { ruleId: rule.id, attest: true, digest: rule.digest });
  await assert.rejects(env.call('venture.rules.attest', { ruleId: 'advocate-solicit', attest: true, digest: 'x' }), code('HARD_STOP'));
  await assert.rejects(outreachDraft(env.deps, owner, {}), code('REGULATOR_FORBIDS'));
  await assert.rejects(outreachOpen(env.deps, owner, { draftId: 'outreach_x' }), code('REGULATOR_FORBIDS'));
  await assert.rejects(leadsDraft(env.deps, owner, { leadId: 'lead_x', subject: 'Hello', body: 'Hello' }), code('REGULATOR_FORBIDS'));
  await assert.rejects(postingPropose(env.deps, owner, { draftId: 'post_x' }), code('REGULATOR_FORBIDS'));
  await assert.rejects(outreachDraft(env.deps, owner, {}), (error: any) => /Bar Council/.test(error.message) && /No attestation or setting can unlock it/.test(error.message));
});

test('a tutor business records its answer and keeps outreach on', async () => {
  const env = await kitBusiness({ now: new Date('2026-10-27T10:00:00Z') }, { idea: 'Support desk for small shops' });
  const view = await coreHandlers['venture.compliance.get']!(env.deps, owner, { profession: 'teaching' }) as ComplianceView;
  await coreHandlers['venture.compliance.set']!(env.deps, owner, { profession: 'teaching', sideWork: 'allowed', digest: view.digest });
  assert.doesNotThrow(() => refuseRegulatorForbidden(env.store.read(), 'outreach'));
  await assert.rejects(outreachDraft(env.deps, owner, {}), (error: any) => error.code !== 'REGULATOR_FORBIDS');
});
