// Wave 6, package 6E5 (DECISIONS D2, D21): the sign-off desk. A named licensed professional signs every regulated
// output before it can be accepted, shared or posted (the CA firm's gate, generalised in kit/signoff-core.ts), and the
// tools and words a regulator forbids are refused in code whatever the settings say. Rules are marked checked only
// when read on the regulator's own page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kitBusiness, deliver, draft, owner } from './fixtures/venture/kit-business.ts';
import { PLAYBOOK_REGISTRY, validateRegistry } from '../runtime/venture/playbooks/registry.ts';
import { PLAYBOOK_DEFINITIONS } from '../runtime/venture/playbooks/definitions.ts';
import { deskHandler } from '../runtime/venture/playbooks/desks.ts';
import { runKitBaseline } from '../runtime/venture/playbooks/kit/baseline.ts';
import { PROFESSION_SPECS, SIGNOFF_RULES, professionSpec } from '../runtime/venture/playbooks/signoff-desk/professions.ts';
import { signoffChecks } from '../runtime/venture/playbooks/signoff-desk/checks.ts';
import { outreachDraft } from '../runtime/venture/network/outreach.ts';
import { postingPropose } from '../runtime/venture/build/posting.ts';
import { shareCreate } from '../runtime/venture/build/share-links.ts';
import { houseStyleFindings, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { net, personNamed } from './venture-network-env.ts';

const code = (expected: string, words?: RegExp) => (error: any) => { assert.equal(error?.code, expected, error?.message); if (words) assert.match(error.message, words); return true; };
const IDEA = 'A sign-off desk for an advocate in Pune';
const EM_DASH = String.fromCodePoint(0x2014);
const text = (lines: string[]) => draft('Reply notice', { 'Draft for signature': lines });

test('6E5 the sign-off desk is registered, defined and has a desk', () => {
  validateRegistry();
  assert.ok(PLAYBOOK_REGISTRY.some(entry => entry.id === 'signoff-desk'));
  const definition = PLAYBOOK_DEFINITIONS.find(item => item.registration.id === 'signoff-desk');
  assert.ok(definition);
  assert.deepEqual(definition.offers.map(offer => offer.id), ['legal-drafting', 'clinic-follow-up', 'review-pack', 'secretarial-papers', 'tax-papers']);
  assert.ok(deskHandler('signoff-desk', 'professional') && deskHandler('signoff-desk', 'paper'));
  for (const spec of PROFESSION_SPECS) assert.ok(definition.offers.some(offer => offer.id === spec.offer), spec.id);
  const baseline = runKitBaseline(definition);
  assert.equal(baseline.ok, true, baseline.detail);
  assert.equal(baseline.passed, baseline.of);
});

test('6E5 a rule is checked only with its regulator page; the rest say unchecked; words are plain', () => {
  for (const rule of SIGNOFF_RULES) {
    assert.match(rule.url, /^https:\/\//, rule.id);
    assert.equal(typeof rule.checked, 'boolean');
    for (const words of [rule.title, rule.line]) { assert.equal(words.includes(EM_DASH), false); assert.deepEqual(houseStyleFindings(words), [], words); }
  }
  // W6 F4: BCI Rule 36 and the Telemedicine Guidelines were read on their official sources on 2 November 2026.
  assert.deepEqual(SIGNOFF_RULES.filter(rule => rule.checked).map(rule => rule.id), ['bci-rule-36', 'nmc-2002-6-1-1', 'nmc-2002-1-4-1', 'telemedicine-2020']);
  assert.deepEqual(professionSpec('advocate')!.refusedTools.map(item => item.tool), ['outreach', 'advertising']);
  assert.deepEqual(professionSpec('doctor')!.refusedTools.map(item => item.tool), ['outreach', 'advertising']);
});

test('6E5 the regulator-limits check refuses AI diagnosis, prescription, solicitation and stock tips, and passes plain papers', () => {
  const run = (offerKey: string | null, line: string) => signoffChecks({ offerKey, deliverable: text([line]) })[0]!;
  assert.equal(run('clinic-follow-up', 'Your review visit is on the date your doctor chose.').outcome, 'pass');
  assert.equal(run('clinic-follow-up', 'You have an appointment next week.').outcome, 'pass');
  assert.equal(run('clinic-follow-up', 'Take the tablet twice a day.').outcome, 'fail');
  assert.equal(run('clinic-follow-up', 'The diagnosis is a viral fever.').outcome, 'fail');
  assert.equal(run('legal-drafting', 'Hire us for a guaranteed win.').outcome, 'fail');
  assert.equal(run('legal-drafting', 'The tenant shall pay the arrears within the notice period.').outcome, 'pass');
  assert.equal(run('review-pack', 'Our target price for this share is high.').outcome, 'fail');
  assert.equal(run('review-pack', 'Your allocation is listed in the attached table.').outcome, 'pass');
  assert.equal(run(null, 'Take the tablet twice a day.').outcome, 'fail', 'an offer outside the desk meets every limit');
});

async function advocateRun() {
  const env = await kitBusiness(undefined, { idea: IDEA });
  const offer = env.offers.find(item => item.playbookOffer === 'legal-drafting')!;
  assert.ok(offer, 'the plan keeps the legal drafting offer');
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: offer.id, request: 'Draft a reply to the late rent notice.', intake: { fields: { scope: 'A reply notice.', deliverable: 'One signed reply.' } } });
  const run = await deliver(env, order.id, text(['The tenant shall pay the arrears within the notice period.']));
  assert.equal(run.status, 'ready-for-review', JSON.stringify(run.playbookChecks));
  const desk = (kind: string, op: 'list' | 'get' | 'act', extra: Record<string, unknown>) => deskHandler('signoff-desk', kind)![op]!(env.deps, owner, { playbook: 'signoff-desk', kind, ...extra } as never) as Promise<any>;
  return { env, order, run, desk };
}

test('6E5 an advocate draft waits for the named advocate to sign these exact papers before Accept', async () => {
  const { env, run, desk } = await advocateRun();
  await assert.rejects(env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' }), code('SIGNOFF_REQUIRED', /Name your advocate/));
  assert.match(run.acceptBlocked ?? '', /Name your advocate/);
  await assert.rejects(desk('professional', 'act', { id: 'advocate', action: 'name', payload: { name: 'Meera Joshi', registrationNumber: '1234' } }), code('SIGNOFF_REGISTRATION_INVALID'));
  await desk('professional', 'act', { id: 'advocate', action: 'name', payload: { name: 'Meera Joshi', registrationNumber: 'mah/1234/2015' } });
  await assert.rejects(env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' }), code('SIGNOFF_REQUIRED', /not gone to your advocate/));
  let paper = await desk('paper', 'get', { id: run.id });
  assert.equal(paper.item.stage, 'not-asked');
  await desk('paper', 'act', { id: run.id, action: 'send', payload: {}, digest: paper.digest });
  paper = await desk('paper', 'get', { id: run.id });
  assert.equal(paper.item.stage, 'sent');
  await assert.rejects(env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' }), code('SIGNOFF_REQUIRED', /with your advocate/));
  await assert.rejects(desk('paper', 'act', { id: run.id, action: 'sign', payload: { registrationNumber: 'MAH/9999/2015' }, digest: paper.digest }), code('SIGNOFF_SIGNER_MISMATCH'));
  await desk('paper', 'act', { id: run.id, action: 'sign', payload: { registrationNumber: 'MAH/1234/2015' }, digest: paper.digest });
  assert.equal((await desk('paper', 'get', { id: run.id })).item.stage, 'signed');
  const list = await desk('paper', 'list', {});
  assert.deepEqual(list.rows.map((row: any) => [row.runId, row.stage]), [[run.id, 'signed']]);
  const accepted = await env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' });
  assert.equal(accepted.status, 'accepted');
});

test('6E5 an owner edit is new papers that wait for their own signature; a return holds them', async () => {
  const { env, run, desk } = await advocateRun();
  await desk('professional', 'act', { id: 'advocate', action: 'name', payload: { name: 'Meera Joshi', registrationNumber: 'MAH/1234/2015' } });
  let paper = await desk('paper', 'get', { id: run.id });
  await desk('paper', 'act', { id: run.id, action: 'send', payload: {}, digest: paper.digest });
  paper = await desk('paper', 'get', { id: run.id });
  await desk('paper', 'act', { id: run.id, action: 'return', payload: { note: 'Add the notice date.' }, digest: paper.digest });
  await assert.rejects(env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' }), code('SIGNOFF_REQUIRED', /returned/));
  const edited = await env.call('venture.delivery.review', { runId: run.id, verdict: 'edited', editedText: 'The tenant shall pay the arrears within the notice period, as dated.' });
  assert.equal(edited.status, 'edited');
  const paperNow = (await desk('paper', 'get', { id: run.id })).item;
  assert.equal(paperNow.stage, 'not-asked', 'the edit is new papers');
  assert.match(paperNow.line, /your edit has not gone to your advocate/);
  await assert.rejects(shareCreate(env.deps, owner, { deliveryId: run.id }), code('SIGNOFF_REQUIRED', /your edit has not gone/));
});

test('6E5 an advocate business keeps outreach and promotion off with no compliance answer recorded', async () => {
  const { env } = await advocateRun();
  await assert.rejects(outreachDraft(env.deps, owner, {}), code('REGULATOR_FORBIDS', /Advocates do not solicit clients/));
  await assert.rejects(postingPropose(env.deps, owner, { draftId: 'post_x' }), code('REGULATOR_FORBIDS', /Advocates do not advertise/));
});

test('6E5 Forget removes the client\'s sign-off requests and keeps the professional of record', async () => {
  const { env, run, desk } = await advocateRun();
  await desk('professional', 'act', { id: 'advocate', action: 'name', payload: { name: 'Meera Joshi', registrationNumber: 'MAH/1234/2015' } });
  const paper = await desk('paper', 'get', { id: run.id });
  await desk('paper', 'act', { id: run.id, action: 'send', payload: {}, digest: paper.digest });
  await net(env as any, 'venture.network.import', { kind: 'contacts-csv', name: 'contacts.csv', text: 'Name,E-mail 1 - Value\nAsha Rao,asha@example.com' });
  const person = personNamed(env as any, 'Asha Rao');
  await ventureAction(env.deps, owner, 'prepare', 'test.link', tx => { tx.replace({ ...tx.find('venture-person', person.id)!, clientId: env.client.id }); });
  await net(env as any, 'venture.network.forget', { id: person.id });
  assert.deepEqual(listRecords(env.store.read(), 'venture-signoff').map(row => row.entry), ['professional']);
});
