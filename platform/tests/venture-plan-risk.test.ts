// The platform's own risk, in plain words, where the AI is chosen (the founder's rule: "Show the platform's own risk in
// plain words"). Found by running the real app, 15 Nov 2026: the first screen made "Sign in with ChatGPT" its main
// button and did not say what the engine's own Codex row says, that OpenAI has not yet said apps like Chausar may use
// a ChatGPT plan this way. The line the screens show is the engine's own sentence, held here inside the row's words so
// the two cannot drift.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_OPTION_WORDS } from '../runtime/venture/onboarding-contracts.ts';
import { AI_PLAN_RISK, planRiskOf } from '../runtime/venture/models/plan-risk.ts';

test('each line is a whole sentence of the engine\'s own words for that sign-in', () => {
  assert.equal(AI_PLAN_RISK.codex, "OpenAI hasn't said yet that apps like Chausar may use a ChatGPT plan this way.");
  assert.equal(AI_PLAN_RISK['claude-code'], 'Plans have limits made for one person, so heavy use can be cut off.');
  assert.ok(AI_OPTION_WORDS.codex.why.startsWith(`${AI_PLAN_RISK.codex} `), 'the Codex row leads with it');
  assert.ok(AI_OPTION_WORDS['claude-code'].why.endsWith(` ${AI_PLAN_RISK['claude-code']}`), 'the Claude Code row ends with it');
});

test('short, plain, and without frightening words or a dash', () => {
  for (const line of Object.values(AI_PLAN_RISK)) {
    assert.ok(line.split(/\s+/).length <= 16, line);
    assert.doesNotMatch(line, /[\u2014\u2013]/);
    assert.doesNotMatch(line, /\b(?:ban|banned|illegal|violat\w*|danger\w*|warning|risk\w*|lose|lost|suspend\w*)\b/i, line);
    assert.match(line, /\.$/);
  }
});

test('a line belongs to the sign-in that runs on the owner\'s own plan, and to no key', () => {
  assert.equal(planRiskOf('codex-cli'), AI_PLAN_RISK.codex);
  assert.equal(planRiskOf('claude-code-cli'), AI_PLAN_RISK['claude-code']);
  for (const id of ['anthropic-haiku-5-5', 'anthropic-sonnet-5-5', 'built-in-templates', 'openai-key', '']) assert.equal(planRiskOf(id), null, id);
});
