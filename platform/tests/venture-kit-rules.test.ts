// The playbook kit's dated rule register (Ink v2 wave 5, package 5A3; catalogue P1 generalised). Every kit playbook keeps
// its rules one way: sources (none only for Chausar's own house rules), the day each was checked, how it was read, the
// steps and checks that use it, what it does not cover, and a recheck window of 90 days unless it names its own. A rule
// past its window is stale on the business's own calendar day; a check resting on an unconfirmed rule says so; a rule a
// CA or lawyer must confirm works in practice runs only until they do. rules-current (2H) and venture.rules.list read
// kit rules the same way they read the social and YouTube registers. No model is asked.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PlaybookCheckResult } from '../runtime/venture/contracts.ts';
import {
  HOUSE_SOURCE, RULE_RECHECK_DAYS, UNCONFIRMED_NOTE, noteUnconfirmed, requireConfirmedRules, ruleFreshness, rulesFreshness, rulesFreshnessAt, validateRules,
} from '../runtime/venture/playbooks/kit/rules.ts';
import { playbookRules, rulesCurrentResult } from '../runtime/venture/playbooks/rules-current.ts';
import { rulesListOf } from '../runtime/venture/playbooks/rules-view.ts';
import { failedPlaybookCheck } from '../runtime/venture/playbooks/draft-checks.ts';
import { runKitChecks } from '../runtime/venture/playbooks/kit/checks.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { FIXTURE_ID, FIXTURE_RULES, TODAY, fixtureDefinition, rule } from './venture-kit-rules-helpers.ts';
import { kitFixture } from './fixtures/venture/kit-fixture.ts';
import { installKitFixture, kitBusiness } from './fixtures/venture/kit-business.ts';

const code = (expected: string, words?: RegExp) => (error: any) => {
  assert.equal(error?.code, expected, error?.message);
  if (words) assert.match(error.message, words);
  return true;
};
const definition = fixtureDefinition();
const validate = (rules = FIXTURE_RULES, today = TODAY) => validateRules(rules, definition, today);

test('validateRules: the fixture register is accepted as it is', () => {
  assert.equal(validate(), FIXTURE_RULES);
  assert.equal(RULE_RECHECK_DAYS, 90);
});

test('validateRules: a rule with no source is refused unless it is a house rule, whose source is Chausar\'s own rule', () => {
  assert.throws(() => validate([rule('no-source', { sources: [] })]), code('RULE_INVALID', /no-source needs at least one source: only a house rule may have none/));
  assert.throws(() => validate([rule('no-source', { sources: [], read: 'unconfirmed' })]), code('RULE_INVALID', /at least one source/));
  validate([rule('house', { sources: [], read: 'house' })]);
  assert.equal(HOUSE_SOURCE, "Chausar's own rule");
  assert.throws(() => validate([rule('plain-link', { sources: [{ title: 'A page', url: 'http://example.com/rule' }] })]), code('RULE_INVALID', /title and an https link/));
  assert.throws(() => validate([rule('no-title', { sources: [{ title: '', url: 'https://example.com/rule' }] })]), code('RULE_INVALID', /title and an https link/));
});

test('validateRules: a checkedOn after today, a value without a unit and usedBy naming what the playbook lacks are refused', () => {
  assert.throws(() => validate([rule('future', { checkedOn: '2026-10-28' })]), code('RULE_INVALID', /future was checked on 2026-10-28, after today \(2026-10-27\)/));
  validate([rule('today', { checkedOn: TODAY })]);
  assert.throws(() => validate([rule('bad-day', { checkedOn: '2026-02-30' })]), code('RULE_INVALID', /needs the day it was checked/));
  assert.throws(() => validate([rule('no-unit', { unit: undefined })]), code('RULE_INVALID', /no-unit has a value without a unit/));
  assert.throws(() => validate([rule('no-value', { value: undefined })]), code('RULE_INVALID', /no-value has a unit without a value/));
  validate([rule('neither', { value: undefined, unit: undefined })]);
  assert.throws(() => validate([rule('lost', { usedBy: ['gather', 'publish', 'tone-check'] })]), code('RULE_INVALID', /lost is used by publish, tone-check, which the playbook has no step or check for/));
  assert.throws(() => validate([rule('unused', { usedBy: [] })]), code('RULE_INVALID', /needs the steps or checks that use it/));
});

test('validateRules: strict on the rest of the shape', () => {
  assert.throws(() => validate([rule('twice'), rule('twice')]), code('RULE_INVALID', /twice is listed twice/));
  assert.throws(() => validate([rule('Not An Id')]), code('RULE_INVALID', /short lowercase id/));
  assert.throws(() => validate([rule('no-how', { how: ' ' })]), code('RULE_INVALID', /needs how it was read/));
  assert.throws(() => validate([rule('no-words', { rule: '' })]), code('RULE_INVALID', /needs its words/));
  assert.throws(() => validate([rule('no-limits', { limitations: '' })]), code('RULE_INVALID', /does not cover/));
  assert.throws(() => validate([rule('odd-read', { read: 'rumour' as any })]), code('RULE_INVALID', /unknown reading/));
  assert.throws(() => validate([rule('long-window', { recheckAfterDays: 400 })]), code('RULE_INVALID', /recheck window/));
  assert.throws(() => validate([rule('half-window', { recheckAfterDays: 1.5 })]), code('RULE_INVALID', /recheck window/));
  assert.throws(() => validate([rule('nameless', { needs: 'ca', confirmedBy: { name: '', on: '2026-10-21' } })]), code('RULE_INVALID', /without the name/));
  assert.throws(() => validate([rule('early', { needs: 'ca', confirmedBy: { name: 'CA Meera Joshi', on: '2026-10-19' } })]), code('RULE_INVALID', /dated before it was checked or after today/));
  validate([rule('confirmed', { needs: 'ca', confirmedBy: { name: 'CA Meera Joshi', on: '2026-10-21' } }), rule('waiting', { needs: 'lawyer', confirmedBy: null })]);
});

test('rulesFreshness: the business\'s local day decides; day 90 after checkedOn is current, day 91 is stale', () => {
  const july = rule('july', { checkedOn: '2026-07-01' });
  assert.equal(ruleFreshness(july, '2026-09-29').stale, false, 'day 90');
  assert.equal(ruleFreshness(july, '2026-09-30').stale, true, 'day 91');
  assert.equal(ruleFreshness(july, '2026-09-30').ageDays, 91);
  // 19:00 UTC on 29 September is 00:30 on 30 September in India: day 91 there, though still day 90 in UTC.
  const india = rulesFreshnessAt([july], '2026-09-29T19:00:00.000Z', { code: 'IN' });
  assert.deepEqual(india.stale.map(item => item.id), ['july']);
  assert.equal(rulesFreshnessAt([july], '2026-09-29T19:00:00.000Z', { code: 'US' }).stale.length, 0, 'still 29 September in New York');
  assert.equal(india.stale[0].line, 'Rule july was checked 91 days ago, on 2026-07-01. Check it again on its source page before relying on it.');
  const own = ruleFreshness(rule('short', { checkedOn: '2026-10-01', recheckAfterDays: 14 }), TODAY);
  assert.deepEqual([own.windowDays, own.stale], [14, true], 'a rule may name a shorter window');
});

test('rulesFreshness: counts never overlap; an unconfirmed rule and one waiting for a CA say so', () => {
  const view = rulesFreshness([
    rule('fresh'), rule('old', { checkedOn: '2026-01-01' }), rule('unsure', { read: 'unconfirmed' }), rule('old-unsure', { read: 'unconfirmed', checkedOn: '2026-01-01' }),
  ], TODAY);
  assert.equal(view.current, 1);
  assert.deepEqual(view.stale.map(item => item.id), ['old', 'old-unsure']);
  assert.deepEqual(view.unconfirmed.map(item => item.id), ['unsure']);
  assert.equal(ruleFreshness(rule('unsure', { read: 'unconfirmed' }), TODAY).line, 'Not confirmed against a source yet. Read on the Search Console help page on 20 October 2026.');
  assert.equal(ruleFreshness(rule('fresh'), TODAY).line, 'Current. Read on the Search Console help page on 20 October 2026.');
  const waiting = ruleFreshness(rule('gst', { needs: 'ca', confirmedBy: null }), TODAY);
  assert.equal(waiting.awaitingConfirmation, true);
  assert.match(waiting.line, /A CA has not confirmed it yet, so it works in practice runs only\.$/);
  assert.match(ruleFreshness(rule('contract', { needs: 'lawyer', confirmedBy: null }), TODAY).line, /A lawyer has not confirmed it yet/);
  assert.equal(ruleFreshness(rule('plain'), TODAY).awaitingConfirmation, false, 'a rule that needs no one waits for no one');
  assert.equal(ruleFreshness(rule('house', { read: 'house', sources: [], checkedOn: '2026-01-01' }), TODAY).line,
    'Rule house was checked 299 days ago, on 2026-01-01. Check it again before relying on it.', 'a house rule has no source page to send you to');
});

test('a check that uses an unconfirmed rule ends its detail with "This rule is not confirmed."', () => {
  const results: PlaybookCheckResult[] = [
    { playbook: FIXTURE_ID, check: 'figures-match', outcome: 'pass', detail: 'Every figure matches the export.' },
    { playbook: FIXTURE_ID, check: 'claims-bounded', outcome: 'fail', detail: 'One line promises a ranking.' },
    { playbook: FIXTURE_ID, check: 'length-fits', outcome: 'not-run', detail: 'not run: no length was set.' },
  ];
  const rules = [rule('unsure', { read: 'unconfirmed', usedBy: ['figures-match', 'length-fits'] }), rule('sure', { usedBy: ['claims-bounded'] })];
  const noted = noteUnconfirmed(results, rules);
  assert.equal(noted[0].detail, `Every figure matches the export. ${UNCONFIRMED_NOTE}`);
  assert.equal(UNCONFIRMED_NOTE, 'This rule is not confirmed.');
  assert.equal(noted[1].detail, 'One line promises a ranking.', 'a confirmed rule adds nothing');
  assert.equal(noted[2].detail, 'not run: no length was set.', 'a check that did not run read no rule');
  assert.deepEqual(noteUnconfirmed(noted, rules), noted, 'said once');
  assert.equal(results[0].detail, 'Every figure matches the export.', 'the input is not changed');
});

test('a rule a CA or lawyer must confirm works in rehearsal only (RULE_UNCONFIRMED for a client order)', () => {
  const rules = [rule('gst-rate', { topic: 'GST on services', needs: 'ca', confirmedBy: null, usedBy: ['figures-match'] }), rule('plain')];
  assert.throws(() => requireConfirmedRules(rules, ['figures-match'], 'client'),
    code('RULE_UNCONFIRMED', /^A CA has not confirmed the rule "GST on services" yet\. It works in practice runs only until they do\.$/));
  requireConfirmedRules(rules, ['figures-match'], 'rehearsal');
  requireConfirmedRules(rules, ['claims-bounded'], 'client');
  requireConfirmedRules([rule('gst-rate', { needs: 'ca', confirmedBy: { name: 'CA Meera Joshi', on: '2026-10-21' }, usedBy: ['figures-match'] })], ['figures-match'], 'client');
  assert.throws(() => requireConfirmedRules([rule('terms', { topic: 'Client terms', needs: 'lawyer', confirmedBy: null, usedBy: ['send'] })], ['send'], 'client'),
    code('RULE_UNCONFIRMED', /^A lawyer has not confirmed the rule "Client terms" yet\./));
});

test('validateRules never fails open: every rule says who must confirm it (needs), and one that needs a CA or lawyer carries confirmedBy', () => {
  const { needs: _gone, ...noNeeds } = rule('silent');
  assert.throws(() => validate([noNeeds as never]), code('RULE_INVALID', /silent needs who must confirm it: ca, lawyer or null/));
  assert.throws(() => validate([rule('odd', { needs: 'auditor' as never })]), code('RULE_INVALID', /who must confirm it/));
  // A tax rule that leaves confirmedBy out would otherwise need no one: refused.
  assert.throws(() => validate([rule('gst', { needs: 'ca' })]), code('RULE_INVALID', /gst needs a CA to confirm it, so it carries confirmedBy: null until they do, or who confirmed it and when/));
  assert.throws(() => validate([rule('terms', { needs: 'lawyer' })]), code('RULE_INVALID', /needs a lawyer to confirm it/));
  assert.throws(() => validate([rule('plain', { needs: null, confirmedBy: null })]), code('RULE_INVALID', /plain needs no one to confirm it, so it carries no confirmedBy/));
  validate([rule('gst', { needs: 'ca', confirmedBy: null }), rule('plain', { needs: null })]);
});

test('runKitChecks keeps the check-time gate as a backstop: a client draft on an unconfirmed rule a check used is refused', () => {
  const definition = fixtureDefinition({
    rules: [rule('gst', { needs: 'ca', confirmedBy: null, usedBy: ['figures-match'] })],
    checks: [() => [{ playbook: FIXTURE_ID, check: 'figures-match', outcome: 'pass', detail: 'Figures match.' }]], checkIds: ['figures-match'],
  });
  const input = (mode: 'client' | 'rehearsal') => ({ mode, deliverable: { title: '', sections: [] } }) as never;
  assert.throws(() => runKitChecks(definition, input('client')), code('RULE_UNCONFIRMED'));
  assert.equal(runKitChecks(definition, input('rehearsal'))[0].outcome, 'pass');
});

test('a client order\'s run never starts on a rule a CA must confirm: refused before any preview or spend, over its stages and checks', async t => {
  for (const usedBy of [['voice'], ['brand-named']]) {
    const base = kitFixture();
    const gated = kitFixture({ rules: [...base.rules, { ...base.rules[0], id: 'tax-rule', topic: 'Tax on the service', needs: 'ca', confirmedBy: null, usedBy }] });
    const undo = installKitFixture(gated);
    try {
      const env = await kitBusiness();
      const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id, request: 'A voice sheet for Sunrise Bakery.', intake: { fields: { 'brand-name': 'Sunrise Bakery', 'consent-data': true } } });
      await assert.rejects(env.call('venture.delivery.run', { orderId: order.id }), code('RULE_UNCONFIRMED', /"Tax on the service"/), usedBy.join());
      assert.equal(env.models.previewed.length, 0, 'no preview, so nothing is spent');
      assert.equal(listRecords(env.store.read(), 'venture-delivery-run').length, 0, 'no run is left stranded');
    } finally { undo(); }
  }
  const base = kitFixture();
  const confirmed = kitFixture({ rules: [...base.rules, { ...base.rules[0], id: 'tax-rule', topic: 'Tax on the service', needs: 'ca', confirmedBy: { name: 'CA Meera Joshi', on: '2026-10-20' }, usedBy: ['voice'] }] });
  t.after(installKitFixture(confirmed));
  const env = await kitBusiness();
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id, request: 'A voice sheet for Sunrise Bakery.', intake: { fields: { 'brand-name': 'Sunrise Bakery', 'consent-data': true } } });
  assert.equal((await env.call('venture.delivery.run', { orderId: order.id })).status, 'waiting-for-you');
});

test('rules-current runs for a kit playbook over the rules its run\'s checks used; a stale rule is not run and never blocks Accept', () => {
  const fresh = rulesCurrentResult(FIXTURE_ID, TODAY, ['figures-match'], undefined, [definition]);
  assert.deepEqual(fresh, { check: 'rules-current', outcome: 'pass', detail: '1 rule checked within 90 days.' });
  assert.equal(rulesCurrentResult(FIXTURE_ID, TODAY, ['length-fits'], undefined, [definition]), null, 'no rule rests on that check');
  const later = rulesCurrentResult(FIXTURE_ID, '2027-02-01', ['figures-match', 'claims-bounded'], undefined, [definition])!;
  assert.equal(later.outcome, 'not-run');
  assert.equal(later.detail, 'not run: 2 rules past their 90-day recheck: Rule gsc-sixteen-months; No ranking promises. Recheck them.');
  assert.equal(failedPlaybookCheck([{ playbook: FIXTURE_ID, ...later }]), null, 'only a fail blocks Accept');
  assert.deepEqual(playbookRules('no-such-playbook', TODAY, [definition]), []);
});

test('venture.rules.list lists kit rules with their freshness and sources; a house rule names Chausar\'s own rule', () => {
  const view = rulesListOf(definition.registration, TODAY, [definition]);
  assert.deepEqual(view.playbook, { id: FIXTURE_ID, label: 'Rules fixture', riskLevel: 'low', lastReviewed: '2026-10-20' });
  assert.equal(view.summary, '2 current, 0 to recheck.');
  const [gsc, house] = view.rules;
  assert.deepEqual(gsc, {
    id: 'gsc-sixteen-months', platform: 'google', rule: 'Search Console keeps sixteen months of data.', checkedOn: '2026-10-20', stale: false,
    usedBy: ['gather', 'figures-match'], limitations: ['Says nothing about data kept by other tools.'],
    source: { title: 'Search Console Help: Performance report', url: 'https://support.google.com/webmasters/answer/7576553' },
    sources: [{ title: 'Search Console Help: Performance report', url: 'https://support.google.com/webmasters/answer/7576553' }],
    line: 'Current. Read on the Search Console help page on 20 October 2026.',
  });
  assert.deepEqual(house.sources, [{ title: HOUSE_SOURCE, url: '' }]);
  assert.equal(house.source, null, 'no page to open');
  const stale = rulesListOf(definition.registration, '2027-02-01', [definition]);
  assert.equal(stale.summary, '0 current, 2 to recheck.');
  assert.ok(stale.rules.every(item => item.stale));
});
