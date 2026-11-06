// The rules judge on the standard practice clients (Ink v2 wave 2, package 2C1, catalogue Q1): every template practice
// client asks the rules judge once its code checks pass and an AI judge is on, with the flagship playbook's own rules
// (the CA firm's) or the draft rules on a plain business. With built-in templates nothing is judged, and the runs view
// says so. Practice clients only: no client data goes to the judge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DRAFT_RULES } from '../runtime/venture/delivery/judge/rules.ts';
import { CA_JUDGE_RULES } from '../runtime/venture/playbooks/ca-firm/claims.ts';
import { scenariosFor } from '../runtime/venture/delivery/scenarios.ts';
import { business, CA_IDEA, PLAIN_IDEA } from './venture-judge-helpers.ts';

const failures = (episode: any) => JSON.stringify({
  firstFailure: episode.firstFailure,
  checks: episode.checks.filter((item: any) => !item.passed),
  playbook: (episode.playbookChecks ?? []).filter((item: any) => item.outcome === 'fail'),
});

test('practice clients: every template client lists the rules judge among its checks', () => {
  for (const type of ['bookkeeping', 'consulting', 'studio', 'agency'] as const) {
    for (const scenario of scenariosFor(type)) assert.ok(scenario.checks.includes('rules-judge'), scenario.id);
  }
});

test('practice clients of a CA firm get a rules judge result over the CA rules; a plain business gets the draft rules', async () => {
  const ca = await business(CA_IDEA);
  const run = await ca.call('venture.simulation.run', {});
  assert.deepEqual(run.scenarioIds, ['bookkeeping-clean', 'bookkeeping-messy', 'bookkeeping-pushback']);
  for (const id of run.scenarioIds) {
    const episode = run.episodes.find((item: any) => item.scenarioId === id);
    const judged = episode.checks.find((item: any) => item.check === 'rules-judge');
    assert.ok(judged, `${id} has no rules judge result: ${failures(episode)}`);
    assert.equal(judged.passed, true, judged.detail);
  }
  const asked = ca.models.rulesTasks();
  assert.equal(asked.length, 3, 'one rules judge call per practice client');
  for (const task of asked) {
    assert.deepEqual((task.input as any).rules.map((rule: any) => rule.id), CA_JUDGE_RULES.map(rule => rule.id));
    assert.equal(task.containsClientData, false, 'practice clients only');
  }

  const plain = await business(PLAIN_IDEA);
  const plainRun = await plain.call('venture.simulation.run', {});
  assert.equal(plainRun.scenarioIds.length, 3);
  for (const episode of plainRun.episodes) assert.ok(episode.checks.some((item: any) => item.check === 'rules-judge'), `${episode.scenarioId}: ${failures(episode)}`);
  const plainAsked = plain.models.rulesTasks();
  assert.equal(plainAsked.length, 3);
  for (const task of plainAsked) assert.deepEqual((task.input as any).rules.map((rule: any) => rule.id), DRAFT_RULES.map(rule => rule.id));
});

test('practice with built-in templates: no rules judge result, and the runs view says no judge is connected', async () => {
  const env = await business(PLAIN_IDEA);
  const run = await env.call('venture.simulation.run', { useTemplate: true });
  for (const episode of run.episodes) assert.equal(episode.checks.some((item: any) => item.check === 'rules-judge'), false, episode.scenarioId);
  assert.equal(env.models.rulesTasks().length, 0);
  const detail = await env.call('venture.runs.get', { runId: run.id });
  for (const step of detail.steps) {
    // 4J14 (Q7): a judge that was never asked did not run, so it reads "Not run" from the one table.
    assert.ok(step.evidence?.some((item: any) => item.id === 'rules-judge' && item.label === 'Not run: no judge connected.'), JSON.stringify(step));
  }
});
