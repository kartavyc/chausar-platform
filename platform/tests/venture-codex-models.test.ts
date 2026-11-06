// A2: the models Codex offers are read from Codex itself; the fixed ids stand only when the list cannot be read. The
// fixture is the founder's Codex 0.166.0 `codex debug models` answer on 3 Nov 2026, cut to the ids, names, visibility
// and priority (the catalogue's instructions were dropped).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CODEX_MODEL_DEFAULTS, codexModelsFrom, parseCodexModels, pickCodexModels } from '../runtime/venture/models/codex-models.ts';
import { defaultAiSettings } from '../runtime/venture/agent-runtime/settings.ts';

const REAL = readFileSync(new URL('./fixtures/venture/models/cli-help/codex-cli-0.166.0-debug-models.json', import.meta.url), 'utf8');

test('the real 0.166.0 list: the ids shown for choosing, in Codex\'s priority order, hidden ones left out', () => {
  assert.deepEqual(parseCodexModels(REAL), ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
});

test('Chausar uses gpt-6-luna and gpt-6.1-terra when Codex offers them', () => {
  assert.deepEqual(pickCodexModels(parseCodexModels(REAL)), {
    route: 'gpt-6-luna', quick: 'gpt-6-luna', main: 'gpt-6.1-terra', source: 'codex',
    listed: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
  });
});

test('an account that lacks them gets the first model its own list shows', () => {
  const older = JSON.stringify({ models: [{ slug: 'gpt-6-astra', visibility: 'list', priority: 2 }, { slug: 'gpt-5.6-luna', visibility: 'list', priority: 9 }, { slug: 'gpt-6-luna', visibility: 'hide', priority: 1 }] });
  // A2 review: route and quick work take the closest small model the list shows (a -luna id), main work the first listed.
  assert.deepEqual(pickCodexModels(parseCodexModels(older)), { route: 'gpt-5.6-luna', quick: 'gpt-5.6-luna', main: 'gpt-6-astra', listed: ['gpt-6-astra', 'gpt-5.6-luna'], source: 'codex' });
  assert.deepEqual(pickCodexModels(['gpt-6-astra', 'gpt-6-sol']).route, 'gpt-6-astra', 'no small model listed: the first one');
});

test('a list that cannot be read leaves the fixed ids', () => {
  for (const response of [null, { exitCode: 1, stdout: REAL }, { exitCode: 0, stdout: 'not json' }, { exitCode: 0, stdout: '{"models":[]}' }, { exitCode: 0, stdout: '{"models":[{"slug":"Bad Id!","visibility":"list"}]}' }]) {
    assert.deepEqual(codexModelsFrom(response), { ...CODEX_MODEL_DEFAULTS, listed: null, source: 'fallback' });
  }
});

test('the agent defaults: quick work on gpt-6-luna, main work on gpt-6.1-terra', () => {
  const codex = defaultAiSettings().codex;
  assert.equal(codex.quick.model, 'gpt-6-luna');
  assert.equal(codex.main.model, 'gpt-6.1-terra');
});
