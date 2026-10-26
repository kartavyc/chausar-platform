// Ink v2 wave 4, package 4J16 (catalogue Q15): learning from the owner's corrections. Each edit or send-back of a
// draft becomes a regression case with typed expectations (mentions, doesn't mention, hands off, uses a tool, cites),
// made by code from the review and from fixed lists, never from the client's own words, and added to rehearsal, where
// a practice draft that breaks one fails. A field corrected in 60 percent of at least 3 reviews is flagged "Fix the
// rule". Nothing here changes the playbook: a lasting rule comes only from the owner's own words in the agent's chat,
// as a 4B1 proposal the owner accepts, which lands as a versioned owner patch they can undo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import type { DeliveryRunRecord, Deliverable, Episode, SignalRecord } from '../runtime/venture/contracts.ts';
import {
  CORRECTION_SHARE, CORRECTION_REVIEWS, checkExpectations, correctionCases, expectationsFor, fixTheRule, type Expectation,
} from '../runtime/venture/delivery/corrections.ts';
import { detectStanding } from '../runtime/venture/agents/standing.ts';
import { PLAIN_IDEA, business, owner, readyDraft } from './venture-judge-helpers.ts';
import { agentBusiness, consent, scriptChat } from './venture-agent-helpers.ts';

const text = (value: string) => ({ kind: 'text' as const, text: value });
const deliverable = (sections: [string, string][], questions: string[] = []): Deliverable => ({ title: 'Your plan', sections: sections.map(([heading, words]) => ({ heading, parts: [text(words)] })), questionsForClient: questions });
const run = (fields: Partial<DeliveryRunRecord>): DeliveryRunRecord => ({
  id: 'run_1', kind: 'venture-delivery-run', ventureId: 'venture_1', memberId: 'owner', epoch: 1, at: '2026-10-21T10:00:00.000Z',
  orderId: 'order_1', playbookId: 'playbook_1', playbookHash: 'h', status: 'edited', servedBy: 'model', practice: false, callId: null, preview: null,
  deliverable: deliverable([['Summary', 'We will delve into your pricing and we reconciled your books.'], ['Next steps', 'Send the price list.']]),
  renderedText: null, checks: [], verdict: { choice: 'edited', reason: 'tone', at: '2026-10-21T10:05:00.000Z' }, editedText: null, ...fields,
} as DeliveryRunRecord);
const signal = (source: SignalRecord['source'], reason: SignalRecord['reason']): SignalRecord => ({ id: 'signal_1', kind: 'venture-signal', ventureId: 'venture_1', memberId: 'owner', epoch: 1, at: '2026-10-21T10:05:00.000Z', source, runId: 'run_1', reason, scenarioId: null });

test('expectations come from the review by code: tells and done claims the owner took out, headings they added, the reason', () => {
  const edited = run({ editedText: '# Your plan\n\n## Summary\nWe will look at your pricing for Meera Joshi.\n\n## Next steps\nSend the price list.\n\n## Price\nThe price comes from Chausar.' });
  const found = expectationsFor(edited, signal('owner-edited', 'tone'), ['Summary', 'Next steps', 'Price']);
  assert.deepEqual(found, [
    { kind: 'not-mentions', text: 'delve' },
    { kind: 'not-mentions', text: 'we reconciled' },
    { kind: 'mentions', text: 'Price' },
  ] satisfies Expectation[]);
  // The client's own words never become an expectation: practice clients are made up.
  assert.ok(!JSON.stringify(found).includes('Meera'));
  assert.deepEqual(expectationsFor(run({}), signal('owner-rejected', 'missing-fact'), []), [{ kind: 'hands-off', to: 'client' }]);
  assert.deepEqual(expectationsFor(run({}), signal('owner-rejected', 'wrong-number'), []), [{ kind: 'cites', what: 'figure' }]);
  const tooled = run({ harness: { toolCalls: [{ tool: 'calc.sum', outcome: 'succeeded' }, { tool: 'files.read', outcome: 'succeeded' }] } as never });
  assert.deepEqual(expectationsFor(tooled, signal('owner-rejected', 'wrong-number'), []), [{ kind: 'cites', what: 'figure' }, { kind: 'uses-tool', tool: 'calc.sum' }]);
});

const episode = (fields: Partial<Episode>): Episode => ({
  scenarioId: 'signal-signal_1', index: 0, turns: [{ turn: 1, by: 'agent', text: 'x', author: 'model', callId: 'c' }], deliverable: deliverable([['Summary', 'We will look at your pricing.']]),
  renderedText: '# Your plan\n\n## Summary\nWe will look at your pricing.', mocks: [], checks: [], judge: [], passed: true, firstFailure: null, costMicros: '0', ...fields,
} as Episode);

test('a practice draft is checked against each expectation; a template outline is not checked by them', () => {
  const expectations: Expectation[] = [{ kind: 'not-mentions', text: 'delve' }, { kind: 'mentions', text: 'Price' }, { kind: 'cites', what: 'figure' }, { kind: 'hands-off', to: 'client' }];
  const results = checkExpectations(expectations, episode({}));
  assert.deepEqual(results.map(item => item.outcome), ['pass', 'fail', 'fail', 'fail']);
  assert.match(results[1].detail, /Price/);
  const asked = checkExpectations([{ kind: 'hands-off', to: 'client' }], episode({ deliverable: deliverable([['Summary', 'x']], ['Which month?']) }));
  assert.equal(asked[0].outcome, 'pass');
  const outline = checkExpectations(expectations, episode({ turns: [{ turn: 1, by: 'agent', text: 'x', author: 'template', callId: null }] as never }));
  assert.ok(outline.every(item => item.outcome === 'not-checked'));
  // uses-tool needs the agent loop: a draft with no tool run is not checked by it.
  assert.equal(checkExpectations([{ kind: 'uses-tool', tool: 'calc.sum' }], episode({}))[0].outcome, 'not-checked');
});

test('each edit or send-back is a regression case in rehearsal; a practice draft that breaks one fails, and nothing changes the playbook', async () => {
  const env = await business(PLAIN_IDEA);
  const first = await readyDraft(env);
  await env.call('venture.delivery.review', { runId: first.id, verdict: 'rejected', reason: 'wrong-number' });
  const state = env.store.read();
  const venture = listRecords(state, 'venture-record')[0];
  const cases = correctionCases(state, venture.id);
  assert.equal(cases.length, 1);
  assert.deepEqual(cases[0].expectations, [{ kind: 'cites', what: 'figure' }]);
  assert.equal(cases[0].source, 'owner-rejected');
  const playbooks = listRecords(state, 'venture-playbook').map(record => record.hash);

  const [signalRecord] = listRecords(state, 'venture-signal');
  // Recorded, the send-back is already a rehearsal case: listed with its expectations, before anyone turns it into one.
  const recorded = await env.call('venture.simulation.scenarios', {});
  assert.deepEqual(recorded.find((item: any) => item.id === `signal-${signalRecord.id}`)?.expectations, [{ kind: 'cites', what: 'figure' }]);
  const scenario = await env.call('venture.simulation.fromSignal', { signalId: signalRecord.id });
  assert.deepEqual(scenario.expectations, [{ kind: 'cites', what: 'figure' }]);
  const listed = await env.call('venture.simulation.scenarios', {});
  assert.deepEqual(listed.find((item: any) => item.id === scenario.id)?.expectations, [{ kind: 'cites', what: 'figure' }]);
  // The practice draft (plainDraft) cites no figure, so the case fails on the correction, with its result on the episode.
  const rehearsal = await env.call('venture.simulation.run', { scenarioIds: [scenario.id] });
  const [practice] = rehearsal.episodes;
  assert.equal(practice.passed, false);
  assert.match(practice.firstFailure, /^correction:cites/);
  assert.equal(practice.expectations[0].outcome, 'fail');
  // Learning never changed a playbook: the versions are the ones the run made, unchanged.
  assert.deepEqual(listRecords(env.store.read(), 'venture-playbook').map(record => record.hash), playbooks);
  assert.equal(listRecords(env.store.read(), 'venture-agent-proposal').length, 0);
});

test('a field corrected in 60 percent of at least 3 reviews is flagged "Fix the rule"; fewer reviews flag nothing', async () => {
  assert.equal(CORRECTION_SHARE, 0.6);
  assert.equal(CORRECTION_REVIEWS, 3);
  const env = await business(PLAIN_IDEA);
  const editSummary = async () => {
    const ready = await readyDraft(env);
    const edited = ready.renderedText.replace('We will read what you send', 'We read what you send');
    await env.call('venture.delivery.review', { runId: ready.id, verdict: 'edited', reason: 'tone', editedText: edited });
  };
  await editSummary();
  await editSummary();
  const venture = () => listRecords(env.store.read(), 'venture-record')[0];
  assert.deepEqual(fixTheRule(env.store.read(), venture().id), [], 'two reviews are too few');
  await editSummary();
  const accepted = await readyDraft(env);
  await env.call('venture.delivery.review', { runId: accepted.id, verdict: 'accepted' });
  const flags = fixTheRule(env.store.read(), venture().id);
  assert.equal(flags.length, 1, JSON.stringify(flags));
  const [flag] = flags;
  assert.equal(flag.corrected, 3);
  assert.equal(flag.reviews, 4);
  assert.match(flag.line, /^Fix the rule: /);
  assert.match(flag.line, /3 of 4 reviews/);
  // The way to a lasting rule is the owner's own words in that agent's chat: the starter says "from now on" and is never sent.
  assert.equal(detectStanding(`${flag.starter} keep it short.`), 'standing');
  // The flag shows with the guidance report.
  const view = await env.call('venture.playbook.guidance', {});
  assert.deepEqual(view.fixTheRule, flags);
  // Only reviews since the version in use count: with a new version, the old corrections flag nothing.
  await ventureAction(env.deps, owner, 'approve', 'seed.version', tx => {
    const current = tx.find('venture-playbook', listRecords(tx.state, 'venture-record')[0].playbookId!)!;
    const next = tx.put({ ...current, ...tx.base('venture-playbook'), version: current.version + 1, parentId: current.id });
    tx.touch({ playbookId: next.id });
  });
  assert.deepEqual(fixTheRule(env.store.read(), venture().id), []);
});

test('the owner\'s yes is the only way a correction becomes a rule: a 4B1 proposal, a new version, undoable', async () => {
  const env = await agentBusiness();
  await consent(env);
  scriptChat(env, { patch: task => ({ stepId: (task.input as any).steps[0].id, op: 'guidance.add', value: 'Keep each chapter title short.' }) });
  const sent = await env.agents('venture.agents.thread.send', { agent: 'story-editor', text: 'From now on, keep each chapter title short.' });
  const proposal = sent.added.find((item: any) => item.type === 'proposal')?.proposal;
  assert.ok(proposal, JSON.stringify(sent));
  assert.ok(!listRecords(env.store.read(), 'venture-playbook').some(record => record.origin === 'owner'), 'nothing changes until the owner says yes');
  const decided = await env.agents('venture.agents.proposal.decide', { id: proposal.id, digest: proposal.digest, decision: 'accept' });
  const made = listRecords(env.store.read(), 'venture-playbook').find(record => record.id === decided.playbook.id)!;
  assert.equal(made.origin, 'owner');
  assert.equal(made.patches!.at(-1)!.proposedBy, 'owner');
  assert.ok(made.patches!.at(-1)!.source!.quote.includes('from now on') || made.patches!.at(-1)!.source!.quote.includes('From now on'));
  // And the owner can take it back: the version it came from is in use again, and this one stays stored.
  const undone = await env.agents('venture.agents.version.undo', { agent: 'story-editor', digest: made.hash });
  assert.equal(undone.playbookId, made.parentId);
  assert.ok(listRecords(env.store.read(), 'venture-playbook').some(record => record.id === made.id));
});
