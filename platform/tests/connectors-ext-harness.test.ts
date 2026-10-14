import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runHarness } from '../runtime/connectors-ext/harness.ts';
import { RECIPES } from '../runtime/connectors-ext/recipes/index.ts';

const root = fileURLToPath(new URL('../../fixtures/connectors', import.meta.url));

test('every fixture case in fixtures/connectors meets its hand-written expectation', () => {
  const { results } = runHarness(root);
  assert.ok(results.length > 0);
  const failed = results.filter(result => !result.passed);
  assert.deepEqual(failed.map(result => `${result.group}/${result.name}: ${result.problems.join('; ')}`), []);
});

test('every registered recipe is accepted on at least one synthetic fixture case', () => {
  const { uncovered } = runHarness(root);
  assert.deepEqual(uncovered, [], 'recipes without an accepted fixture case');
  assert.ok(RECIPES.size >= 5);
});
