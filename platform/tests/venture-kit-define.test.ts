// The playbook kit's definition checks (Ink v2 wave 5, package 5A1, test 1). definePlaybook refuses a bad definition
// with PLAYBOOK_DEFINITION_INVALID, naming the field: steps, roles and departments, approvals and the floor, connector
// labels and manual paths, owner-set prices, the start tile, judge floors, edges and loops, and a shown string with no
// Hindi. A good definition passes and comes back frozen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { definePlaybook, type PlaybookDefinition } from '../runtime/venture/playbooks/kit/define.ts';
import { hiOf, forgetHi } from '../runtime/venture/playbooks/kit/words.ts';
import { fixtureHi, kitFixture } from './fixtures/venture/kit-fixture.ts';

const code = (expected: string, words?: RegExp) => (error: any) => { assert.equal(error?.code, expected, error?.message); if (words) assert.match(error.message, words); return true; };
/** Refused with PLAYBOOK_DEFINITION_INVALID, the message naming the field. */
function refused(definition: PlaybookDefinition, field: string, words?: RegExp, hi = fixtureHi(kitFixture())) {
  assert.throws(() => definePlaybook(definition, hi), (error: any) => {
    assert.equal(error?.code, 'PLAYBOOK_DEFINITION_INVALID', error?.message);
    assert.match(error.message, new RegExp(`^The kit-fixture playbook's ${field}: `), error.message);
    if (words) assert.match(error.message, words);
    return true;
  });
}

test('a good kit definition passes, frozen, and its Hindi is found by hiOf', () => {
  const definition = kitFixture();
  const defined = definePlaybook(definition, fixtureHi(definition));
  assert.ok(Object.isFrozen(defined));
  assert.equal(hiOf('kit-fixture', 'Kit fixture studio'), 'हिंदी में: Kit fixture studio');
  assert.equal(hiOf('kit-fixture', 'A string it never showed'), 'A string it never showed', 'no Hindi falls back to the English');
  forgetHi('kit-fixture');
});

test('offers, steps, roles and approvals that do not hold together are refused, naming the field', () => {
  const base = kitFixture();
  refused(kitFixture({ offers: [{ ...base.offers[0], stages: ['voice', 'missing-step'] }, base.offers[1]] }), 'offers', /missing-step, which does not exist/);
  refused(kitFixture({ steps: base.steps.map(step => (step.id === 'gather' ? { ...step, role: 'ghost' } : step)) }), 'steps', /done by ghost/);
  refused(kitFixture({ roles: base.roles.map(role => (role.id === 'writer' ? { ...role, department: 'sales-and-clients' as never } : role)) }), 'roles', /five departments/);
  refused(kitFixture({ approvals: [{ ...base.approvals[0], step: 'nowhere' }] }), 'approvals', /nowhere, which does not exist/);
  refused(kitFixture({ approvals: [] }), 'steps', /always asks, so it needs an approval point/);
});

test('connectors: one of the six labels, and a planned one names its manual path and who it waits on', () => {
  const base = kitFixture();
  refused(kitFixture({ connectors: [{ ...base.connectors[0], label: 'maybe' as never }, base.connectors[1]] }), 'connectors', /six labels/);
  // 5A3 review: the manual path is checked once, by kit/manual-path.ts, with its own code.
  const { manualPath: _gone, ...noPath } = base.connectors[1];
  assert.throws(() => definePlaybook(kitFixture({ connectors: [base.connectors[0], noPath] }), fixtureHi(kitFixture())), code('MANUAL_PATH_MISSING', /manual path/));
  const { waitsOn: _none, ...noWait } = base.connectors[1];
  assert.throws(() => definePlaybook(kitFixture({ connectors: [base.connectors[0], noWait] }), fixtureHi(kitFixture())), code('MANUAL_PATH_MISSING', /waits on/));
});

test('an offer whose price is anything but owner-sets is refused', () => {
  const base = kitFixture();
  refused(kitFixture({ offers: [{ ...base.offers[0], price: '5000' as never }, base.offers[1]] }), 'offers', /owner-sets/);
});

test('the start tile: hours in order and at most sixty, rupees above zero and in order, at most four team roles it has', () => {
  const base = kitFixture();
  const tile = (change: Partial<PlaybookDefinition['startTile']>) => kitFixture({ startTile: { ...base.startTile, ...change } });
  refused(tile({ youDo: { ...base.startTile.youDo, hoursMin: 5, hoursMax: 4 } }), 'startTile', /fewest first/);
  refused(tile({ youDo: { ...base.startTile.youDo, hoursMin: 10, hoursMax: 61 } }), 'startTile', /one to sixty/);
  refused(tile({ pay: { ...base.startTile.pay, minRupees: 0 } }), 'startTile', /above zero/);
  refused(tile({ pay: { ...base.startTile.pay, minRupees: 20000, maxRupees: 15000 } }), 'startTile', /lowest first/);
  refused(tile({ team: { ...base.startTile.team, roleIds: ['researcher', 'stranger'] } }), 'startTile', /stranger/);
  const many = kitFixture({
    roles: [...base.roles, { id: 'checker', name: 'Checker', kind: 'agent', department: 'operations', job: 'Checks the posts.' }],
    startTile: { ...base.startTile, team: { ...base.startTile.team, roleIds: ['researcher', 'writer', 'billing', 'owner', 'checker'] } },
  });
  refused(many, 'startTile', /at most four/, fixtureHi(many));
});

test('a judge rule without a floor, an edge to a missing step and an uncapped loop are refused', () => {
  const base = kitFixture();
  refused(kitFixture({ judgeRules: [{ ...base.judgeRules[0], floor: undefined as never }] }), 'judgeRules', /floor/);
  refused(kitFixture({ steps: base.steps.map(step => (step.id === 'calendar' ? { ...step, next: [{ on: 'blocked', to: 'elsewhere' }] } : step)) }), 'steps', /elsewhere/);
  // drafts back to voice on failure, with no cap on either: a loop no cap or approval breaks.
  const uncapped = base.steps.map(step => (step.id === 'drafts' ? { ...step, next: [{ on: 'failed' as const, to: 'calendar' }] }
    : step.id === 'calendar' ? { ...step, next: [{ on: 'failed' as const, to: 'drafts' }] } : step));
  assert.throws(() => definePlaybook(kitFixture({ steps: uncapped }), fixtureHi(kitFixture())), (error: any) => error?.code === 'PLAYBOOK_DEFINITION_INVALID' && /steps: /.test(error.message));
});

test('a shown string with no Hindi in hi.json is refused, and so is one that breaks house style', () => {
  const definition = kitFixture();
  const hi = { ...fixtureHi(definition) };
  delete (hi as Record<string, string>)['Voice and calendar pack'];
  refused(definition, 'words', /"Voice and calendar pack" has no Hindi/, hi);
  const own = kitFixture({ words: () => ['We will delve into your brand.'] });
  refused(own, 'words', /breaks house style/, fixtureHi(own));
  const numbered = kitFixture({ words: () => ['Up to 30 posts.'] });
  refused(numbered, 'words', /holds a number/, fixtureHi(numbered));
});

test('tools: a step may hold only tools within its own ceiling, and the playbook lists only its own or the kit\'s tools', () => {
  const base = kitFixture();
  const withTool = (tool: string) => kitFixture({ steps: base.steps.map(step => (step.id === 'gather' ? { ...step, tools: ['files.read', tool as never] } : step)) });
  refused(withTool('seo.meta'), 'steps', /seo\.meta/);
  refused(withTool('youtube.hooks'), 'steps', /youtube\.hooks/);
  refused(withTool('assets.record'), 'steps', /assets\.record/);
  refused(kitFixture({ tools: ['media.clean', 'youtube.hooks'] }), 'tools', /youtube\.hooks/);
  refused(kitFixture({ tools: ['media.clean', 'seo.meta'] }), 'tools', /seo\.meta/, fixtureHi(kitFixture()));
  // The engine's own playbook checks run too: a writing step must check for claims of unproven work.
  const noClaimCheck = kitFixture({ steps: base.steps.map(step => (step.id === 'drafts' ? { ...step, checks: step.checks.filter(id => id !== 'no-done-claims') } : step)) });
  refused(noClaimCheck, 'steps', /never claims unproven work/);
});

test('a floor step\'s approval must itself be on the floor', () => {
  const base = kitFixture();
  refused(kitFixture({ approvals: [{ ...base.approvals[0], floor: false }] }), 'approvals', /always asks, so its approval .* on the floor/);
});

test('every shown string needs Hindi: connector notes, manual paths, who it waits on, judge rules, what is never built and the scope', () => {
  const definition = kitFixture();
  for (const text of ['You send each draft from your own mail.', 'Import the calendar file into your scheduler.', 'The scheduler app review.',
    'The draft answers what the client asked for.', 'Posting from inside the app.', 'social posts', 'paid ads']) {
    const hi = { ...fixtureHi(definition) } as Record<string, string>;
    assert.ok(Object.hasOwn(hi, text), text);
    delete hi[text];
    refused(definition, 'words', /has no Hindi/, hi);
  }
});

test('definePlaybook checks the dated rules, the recipes and the boundaries (5A3), and adds the recipes\' judge rules', () => {
  const base = kitFixture();
  const rule = base.rules[0];
  assert.throws(() => definePlaybook(kitFixture({ rules: [{ ...rule, usedBy: ['nowhere'] }] }), fixtureHi(base)), code('RULE_INVALID', /nowhere/));
  assert.throws(() => definePlaybook(kitFixture({ rules: [{ ...rule, checkedOn: '2026-11-30' }] }), fixtureHi(base), '2026-10-27'), code('RULE_INVALID', /after today/));
  assert.throws(() => definePlaybook(kitFixture({ recipes: [] }), fixtureHi(base)), code('RECIPE_INVALID'));
  assert.throws(() => definePlaybook(kitFixture({ boundaries: [] }), fixtureHi(base)), code('BOUNDARY_INVALID'));
  const defined = definePlaybook(kitFixture(), fixtureHi(base), '2026-10-27');
  assert.deepEqual(defined.judgeRules.map(item => item.id), ['on-brief', 'voice-first-mistake-1']);
  assert.deepEqual(defined.judgeRules[1].floor, { kind: 'required-yes' });
});
