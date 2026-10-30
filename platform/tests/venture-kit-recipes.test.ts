// Manual paths, recipes and measurement boundaries (Ink v2 wave 5, package 5A3; catalogue P5, P6). Every planned
// connector names the manual path a person takes meanwhile, and the step that needs it carries that line in its task
// guidance and on the order card. Recipes are data: when to use, steps with why, how to read the result and common
// mistakes, a mistake marked judge becoming a judge rule with its own floor. Each playbook carries a measurement-
// boundaries table: what its evidence can say and what it cannot. venture.rules.list hands both to Plan and playbook.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MANUAL_PATH_LEAD, manualPathFor, manualPathLine, manualPathsForOrder, validateManualPaths, withManualPaths } from '../runtime/venture/playbooks/kit/manual-path.ts';
import { recipeJudgeRules, recipeViews, validateRecipes } from '../runtime/venture/playbooks/kit/recipes.ts';
import { boundaryViews, validateBoundaries } from '../runtime/venture/playbooks/kit/boundaries.ts';
import { rulesListOf } from '../runtime/venture/playbooks/rules-view.ts';
import { definePlaybook, type KitConnector, type KitRecipe, type PlaybookDefinition } from '../runtime/venture/playbooks/kit/define.ts';
import { forgetHi, type HiFile } from '../runtime/venture/playbooks/kit/words.ts';
import { fixtureHi, kitFixture } from './fixtures/venture/kit-fixture.ts';
import { FIXTURE_BOUNDARIES, FIXTURE_CONNECTORS, FIXTURE_RECIPES, FIXTURE_STEPS, TODAY, fixtureDefinition } from './venture-kit-rules-helpers.ts';

const code = (expected: string, words?: RegExp) => (error: any) => {
  assert.equal(error?.code, expected, error?.message);
  if (words) assert.match(error.message, words);
  return true;
};
const definition = fixtureDefinition();
const GSC_LINE = 'Until then: in Search Console open Performance, choose Export, and add the CSV to the order.';

// ---------------------------------------------------------------------------
// Manual paths (P5)
// ---------------------------------------------------------------------------

test('manual path: every planned connector names one, with who it waits on; a step names only a connector the playbook has', () => {
  validateManualPaths(definition);
  const planned = FIXTURE_CONNECTORS[0];
  const without = (patch: Partial<KitConnector>) => fixtureDefinition({ connectors: [{ ...planned, ...patch }, FIXTURE_CONNECTORS[1]] });
  assert.throws(() => validateManualPaths(without({ manualPath: undefined })), code('MANUAL_PATH_MISSING', /Google Search Console is planned, so it needs the manual path a person takes until it works/));
  assert.throws(() => validateManualPaths(without({ manualPath: '  ' })), code('MANUAL_PATH_MISSING'));
  assert.throws(() => validateManualPaths(without({ waitsOn: undefined })), code('MANUAL_PATH_MISSING', /needs who it waits on/));
  for (const label of ['planned: write', 'planned: handoff'] as const) assert.throws(() => validateManualPaths(without({ label, manualPath: undefined })), code('MANUAL_PATH_MISSING'));
  validateManualPaths(without({ label: 'read', manualPath: undefined, waitsOn: undefined }));
  const lost = fixtureDefinition({ steps: [{ ...FIXTURE_STEPS[0], connector: 'shopify' }] });
  assert.throws(() => validateManualPaths(lost), code('MANUAL_PATH_MISSING', /The step gather needs the connector shopify, which the playbook does not list/));
});

test('manual path: the line reads "Until then: ..." and only a planned connector has one', () => {
  assert.equal(MANUAL_PATH_LEAD, 'Until then: ');
  assert.equal(manualPathLine(FIXTURE_CONNECTORS[0]), GSC_LINE);
  assert.equal(manualPathLine({ ...FIXTURE_CONNECTORS[0], manualPath: 'WhatsApp the export to yourself and add it to the order.' }),
    'Until then: WhatsApp the export to yourself and add it to the order.', 'a name keeps its capital');
  assert.equal(manualPathLine({ ...FIXTURE_CONNECTORS[0], manualPath: 'Until then: open the export.' }), 'Until then: open the export.', 'never said twice');
  assert.equal(manualPathLine(FIXTURE_CONNECTORS[1]), null);
});

test('manual path: the step that needs a planned connector shows the line in its task guidance; other steps are as they were', () => {
  const steps = withManualPaths(definition);
  assert.deepEqual(steps[0].guidance, ["Read the client's numbers first.", GSC_LINE]);
  assert.equal(steps[1].guidance, undefined);
  assert.equal(steps[2].guidance, undefined, 'a handoff connector works today, so no manual path');
  assert.deepEqual(withManualPaths(fixtureDefinition({ steps }))[0].guidance, steps[0].guidance, 'added once');
  assert.deepEqual(FIXTURE_STEPS[0].guidance, ["Read the client's numbers first."], 'the definition is not changed');
});

test('manual path: the order card names each stage that needs a planned connector, with the line and who it waits on', () => {
  assert.deepEqual(manualPathFor(definition, 'gather'), { step: 'gather', connector: 'Google Search Console', waitsOn: 'Google approving the app for Search Console reads', line: GSC_LINE });
  assert.equal(manualPathFor(definition, 'draft'), null);
  assert.equal(manualPathFor(definition, 'send'), null);
  assert.deepEqual(manualPathsForOrder(definition, ['gather', 'draft', 'send']).map(item => item.step), ['gather']);
  assert.deepEqual(manualPathsForOrder(definition, ['draft']), []);
});

// ---------------------------------------------------------------------------
// Recipes and boundaries (P6)
// ---------------------------------------------------------------------------

test('recipes: each has when to use, steps with why, how to read the result and common mistakes', () => {
  assert.equal(validateRecipes(FIXTURE_RECIPES), FIXTURE_RECIPES);
  const one = FIXTURE_RECIPES[0];
  const bad = (patch: Partial<KitRecipe>) => () => validateRecipes([{ ...one, ...patch }]);
  assert.throws(bad({ whenToUse: '' }), code('RECIPE_INVALID', /traffic-drop needs when to use it/));
  assert.throws(bad({ steps: [] }), code('RECIPE_INVALID', /needs its steps/));
  assert.throws(bad({ steps: [{ do: 'Compare the weeks.', why: '' }] }), code('RECIPE_INVALID', /step 1 needs what to do and why/));
  assert.throws(bad({ howToRead: ' ' }), code('RECIPE_INVALID', /how to read the result/));
  assert.throws(bad({ mistakes: [] }), code('RECIPE_INVALID', /common mistakes/));
  assert.throws(bad({ mistakes: [{ text: '' }] }), code('RECIPE_INVALID', /common mistakes/));
  assert.throws(bad({ id: 'Traffic Drop' }), code('RECIPE_INVALID', /short lowercase id/));
  assert.throws(() => validateRecipes([one, one]), code('RECIPE_INVALID', /listed twice/));
  assert.throws(() => validateRecipes([]), code('RECIPE_INVALID', /at least one recipe/));
});

test('recipes: a mistake marked judge becomes a judge rule with its own floor; the others stay advice', () => {
  const rules = recipeJudgeRules(FIXTURE_RECIPES);
  assert.deepEqual(rules, [{
    id: 'traffic-drop-mistake-1',
    question: 'Does the draft avoid this mistake: blaming an update without dates that match?',
    text: 'Find why traffic dropped: avoid blaming an update without dates that match.',
    floor: { kind: 'required-yes' },
  }]);
  const two = recipeJudgeRules([{ ...FIXTURE_RECIPES[0], mistakes: [{ text: 'One.', judge: true }, { text: 'Two.', judge: true }] }]);
  assert.notEqual(two[0].floor, two[1].floor, 'each rule holds its own floor');
});

test('boundaries: each row says what its evidence can say and cannot say; a playbook has at least one', () => {
  assert.equal(validateBoundaries(FIXTURE_BOUNDARIES), FIXTURE_BOUNDARIES);
  assert.throws(() => validateBoundaries([]), code('BOUNDARY_INVALID', /at least one row/));
  assert.throws(() => validateBoundaries([{ ...FIXTURE_BOUNDARIES[0], cannotSay: '' }]), code('BOUNDARY_INVALID', /A JSON-LD block parsed needs what it can say and what it cannot/));
  assert.throws(() => validateBoundaries([FIXTURE_BOUNDARIES[0], FIXTURE_BOUNDARIES[0]]), code('BOUNDARY_INVALID', /listed twice/));
  assert.deepEqual(boundaryViews(FIXTURE_BOUNDARIES), [{ evidence: 'A JSON-LD block parsed', canSay: 'The page carries structured data a parser can read.', cannotSay: 'The page is eligible for rich results.' }]);
});

test('Plan and playbook: venture.rules.list hands over the recipes and the boundaries table; a flagship has none', () => {
  const view = rulesListOf(definition.registration, TODAY, [definition]);
  assert.deepEqual(view.recipes, recipeViews(FIXTURE_RECIPES));
  assert.deepEqual(view.recipes[0], {
    id: 'traffic-drop', name: 'Find why traffic dropped', whenToUse: 'When clicks fell by a lot in one week.',
    steps: [
      { do: 'Compare the last 28 days with the 28 before.', why: 'A week is too short to tell a drop from a holiday.' },
      { do: 'Split by page, then by search words.', why: 'One page often explains most of the drop.' },
    ],
    howToRead: 'A drop on one page is a page problem; a drop on every page is a site or season problem.',
    mistakes: ['Blaming an update without dates that match.', 'Comparing a holiday week with a normal one.'],
  });
  assert.deepEqual(view.boundaries, boundaryViews(FIXTURE_BOUNDARIES));
  const youtube = rulesListOf({ id: 'youtube', label: 'YouTube channel', riskLevel: 'medium', lastReviewed: '2026-10-23' }, TODAY, [definition]);
  assert.deepEqual([youtube.recipes, youtube.boundaries], [[], []]);
  assert.ok(youtube.rules.length > 0);
  assert.ok(youtube.rules.every(rule => rule.sources.length === 1 && rule.sources[0].url === rule.source!.url));
});

// ---------------------------------------------------------------------------
// Through definePlaybook (5A3 review): the words checked, the manual path's own code, judge ids unique
// ---------------------------------------------------------------------------

/** definePlaybook refused it with PLAYBOOK_DEFINITION_INVALID on this field, with these words. */
function refusedDefinition(definition: PlaybookDefinition, field: string, words: RegExp, hi: HiFile = fixtureHi(definition)) {
  assert.throws(() => definePlaybook(definition, hi, '2026-10-27'), (error: any) => {
    assert.equal(error?.code, 'PLAYBOOK_DEFINITION_INVALID', error?.message);
    assert.match(error.message, new RegExp(`^The kit-fixture playbook's ${field}: `), error.message);
    assert.match(error.message, words);
    return true;
  });
  forgetHi('kit-fixture');
}

test('definePlaybook checks the words of recipes, boundaries, dated rules and the recipes\' judge rules, house style and Hindi', () => {
  const base = kitFixture();
  const recipe = base.recipes[0];
  refusedDefinition(kitFixture({ recipes: [{ ...recipe, whenToUse: 'When clicks fell by 30 percent.' }] }), 'words', /holds a number/);
  refusedDefinition(kitFixture({ boundaries: [{ ...base.boundaries[0], cannotSay: 'Why people bought \u2014 or did not.' }] }), 'words', /breaks house style/);
  refusedDefinition(kitFixture({ rules: [{ ...base.rules[0], how: 'Read on 20 October 2026.' }] }), 'words', /holds a number/);
  const shown = ['Voice before posts', 'A new client with no voice sheet yet.', 'Write the voice sheet first.', 'The posts follow the voice.', 'Read the voice sheet aloud to the client.',
    'Skipping the voice sheet.', 'A post export', 'Which posts went out and when.', 'Why people bought.', 'Promised results', 'A post never promises results.',
    'Chausar house rule.', 'Covers the words of a post, not its pictures.',
    'Does the draft avoid this mistake: promising results in a post?', 'Voice before posts: avoid promising results in a post.'];
  for (const text of shown) {
    const hi = { ...fixtureHi(base) } as Record<string, string>;
    assert.ok(Object.hasOwn(hi, text), `${text} is a shown string`);
    delete hi[text];
    refusedDefinition(base, 'words', /has no Hindi/, hi);
  }
  const defined = definePlaybook(base, fixtureHi(base), '2026-10-27');
  assert.deepEqual(defined.judgeRules.map(item => item.id), ['on-brief', 'voice-first-mistake-1']);
  forgetHi('kit-fixture');
});

test('definePlaybook: a planned connector without its manual path is MANUAL_PATH_MISSING, and a recipe judge rule may not reuse a judge rule id', () => {
  const base = kitFixture();
  const { manualPath: _gone, ...noPath } = base.connectors[1];
  const lost = kitFixture({ connectors: [base.connectors[0], noPath] });
  assert.throws(() => definePlaybook(lost, fixtureHi(lost), '2026-10-27'), code('MANUAL_PATH_MISSING', /A scheduler is planned/));
  const { waitsOn: _none, ...noWait } = base.connectors[1];
  const waiting = kitFixture({ connectors: [base.connectors[0], noWait] });
  assert.throws(() => definePlaybook(waiting, fixtureHi(waiting), '2026-10-27'), code('MANUAL_PATH_MISSING', /who it waits on/));
  const twice = kitFixture({ judgeRules: [...base.judgeRules, { id: 'voice-first-mistake-1', question: 'Is the voice first?', text: 'The voice comes first.', floor: { kind: 'required-yes' } }] });
  refusedDefinition(twice, 'judgeRules', /voice-first-mistake-1 is also a recipe's judge rule/);
});
