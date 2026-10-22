import assert from 'node:assert/strict';
import test from 'node:test';
import { approveFinal, fixture, prepare, release, synthesisReview, tools, waitEntered } from './fixtures/conversation-synthesis-public-flow.ts';

// Actual desktop preload/strict IPC and production worker, with authored HTTP
// responses and the default production codec. No live inference or private vault.
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function noFinal(f: Fixture) {
  const page = await f.request('conversation.history', { limit: 50 });
  assert.equal(page.items.some((item: any) => item.kind === 'synthesized-conversation'), false,
    'A refused stage-two turn must not retain a final answer.');
}
async function refusedRun(f: Fixture, prepared: Awaited<ReturnType<typeof prepare>>, original: any) {
  const before = (await f.calls()).length;
  let rejection: unknown, admitted: any;
  try { admitted = await f.request('conversation.synthesis.run', prepared.payload); }
  catch (error) { rejection = error; }
  if (!rejection) {
    const saved = await f.request('conversation.get', { id: admitted.id });
    const history = await f.request('conversation.history', { limit: 50 });
    assert.fail('Expected refusal; public flow admitted and retained: ' + JSON.stringify({ kind: admitted.kind,
      paragraphs: admitted.paragraphs, receipt: admitted.receipt, exactSavedReadback: JSON.stringify(saved.answer) === JSON.stringify(admitted),
      listedFinal: history.items.some((item: any) => item.id === admitted.id && item.kind === 'synthesized-conversation') }));
  }
  assert.equal((await f.calls()).length, before + 1, 'Exactly one authored provider attempt; no retry or fallback.');
  await assert.rejects(f.request('conversation.synthesis.run', prepared.payload));
  assert.equal((await f.calls()).length, before + 1, 'A used or failed preview cannot redispatch.');
  await noFinal(f);
  assert.deepEqual((await f.request('conversation.get', { id: original.id })).answer, original,
    'A provider refusal does not replace the still-current local tool result.');
}

test('public synthesis refuses malformed grounding and currency assertions without retaining or redispatching', async t => {
  const variants = ['foreign-ref', 'omit-caution', 'numeric-prose', 'omit-required-slot', 'wrong-currency'];
  const scenarios = Object.fromEntries(variants.map(variant => [`Synthetic malformed final answer ${variant}`, { calls: ['billed'], synthesis: { variant } }]));
  const f = await fixture(t, scenarios);
  for (const variant of variants) await t.test(variant, async () => {
    const turn = await tools(f, `Synthetic malformed final answer ${variant}`);
    assert.equal(turn.answer.kind, 'grounded-conversation');
    await refusedRun(f, await prepare(f, turn.answer.id), turn.answer);
  });
});

test('public synthesis refuses incomplete, failed and tool-attempt Responses envelopes', async t => {
  const scenarios = {
    'Synthetic incomplete final response': { calls: ['billed'], synthesis: { status: 'incomplete' } },
    'Synthetic transport failed final response': { calls: ['billed'], synthesis: { transportFailure: true } },
    'Synthetic tool attempted final response': { calls: ['billed'], synthesis: { rawBody: JSON.stringify({ status: 'completed',
      output: [{ type: 'function_call', name: 'calculator.calculate', arguments: '{}' }] }) } },
    'Synthetic explicit refused final response': { calls: ['billed'], synthesis: { rawBody: JSON.stringify({ status: 'completed',
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Authored synthetic refusal.' }] }] }) } },
  };
  const f = await fixture(t, scenarios);
  for (const question of Object.keys(scenarios)) await t.test(question, async () => {
    const turn = await tools(f, question); await refusedRun(f, await prepare(f, turn.answer.id), turn.answer);
  });
});

test('mixed current business citations cannot be replaced by undeclared provider citation fields', async t => {
  const question = 'Describe the cited business and September billing with an invented final citation.';
  const f = await fixture(t, { [question]: { calls: ['business.describe', 'billed'], business: 'owner', synthesis: { variant: 'extra-citation' } } });
  await f.request('business.profile.record', { field: 'products', value: 'Handcrafted tables', origin: 'owner-told',
    sourceId: 'synthetic-synthesis-invoices', validFrom: '2026-09-01' });
  const original = (await tools(f, question)).answer;
  await refusedRun(f, await prepare(f, original.id), original);
  const input = (await f.calls()).at(-1).input;
  assert.ok(input.citationRefs.length, 'This refusal is tested against an actually cited business tool result.');
});

test('public synthesis refuses valid-shaped nonterminal Ollama responses', async t => {
  const scenarios = {
    'Synthetic unfinished Ollama synthesis': { calls: ['billed'], synthesis: { done: false } },
  };
  const f = await fixture(t, scenarios, 'ollama');
  for (const question of Object.keys(scenarios)) await t.test(question, async () => {
    const turn = await tools(f, question); await refusedRun(f, await prepare(f, turn.answer.id), turn.answer);
  });
});

test('public synthesis refuses a valid-shaped length-limited compatible response', async t => {
  const question = 'Synthetic length-limited compatible synthesis';
  const f = await fixture(t, { [question]: { calls: ['billed'], synthesis: { finishReason: 'length' } } }, 'openai-compatible');
  const turn = await tools(f, question); await refusedRun(f, await prepare(f, turn.answer.id), turn.answer);
});

test('Shape planner consent does not permit a final answer preview or second dispatch', async t => {
  const question = 'Synthetic Shape-only final question';
  const f = await fixture(t, { [question]: { calls: ['billed'] } }, 'openai-responses', 'shape');
  const turn = await tools(f, question), before = (await f.calls()).length;
  await assert.rejects(f.request('conversation.synthesis.preview', { id: turn.answer.id }));
  assert.equal((await f.calls()).length, before); await noFinal(f);
  assert.deepEqual((await f.request('conversation.get', { id: turn.answer.id })).answer, turn.answer);
});

test('missing or cross-preview approval and forged public synthesis fields refuse before provider entry', async t => {
  const firstQuestion = 'Synthetic first approval-bound objective', secondQuestion = 'Synthetic second approval-bound objective';
  const f = await fixture(t, { [firstQuestion]: { calls: ['billed'] }, [secondQuestion]: { calls: ['billed'] } });
  const first = await tools(f, firstQuestion), firstReview = await prepare(f, first.answer.id);
  const second = await tools(f, secondQuestion), secondReview = await prepare(f, second.answer.id);
  assert.equal(typeof first.plannerApprovalId, 'string');
  assert.notEqual(first.plannerApprovalId, firstReview.approval.id, 'The actual planning approval must differ from final-answer consent.');
  const before = (await f.calls()).length;
  for (const payload of [
    { ...firstReview.payload, approvalId: 'synthetic-missing-approval' },
    { ...firstReview.payload, approvalId: first.plannerApprovalId },
    { ...firstReview.payload, approvalId: secondReview.approval.id },
    { ...firstReview.payload, id: second.answer.id },
    { ...firstReview.payload, paragraphs: ['Injected caller final answer'] },
  ]) await assert.rejects(f.request('conversation.synthesis.run', payload));
  for (const payload of [
    { id: first.answer.id, summary: { question: 'Caller supplied evidence' } },
    { id: first.answer.id, routeId: 'synthetic-different-route' },
    { id: first.answer.id, output: { paragraphs: [] } },
  ]) await assert.rejects(f.request('conversation.synthesis.preview', payload));
  assert.equal((await f.calls()).length, before); await noFinal(f);
  assert.deepEqual((await f.request('conversation.get', { id: first.answer.id })).answer, first.answer);
  assert.deepEqual((await f.request('conversation.get', { id: second.answer.id })).answer, second.answer);
});

test('a reviewed final-answer preview without its separate approval cannot approve or dispatch through the desktop preload', async t => {
  const question = 'Synthetic explicitly unchecked final consent';
  const f = await fixture(t, { [question]: { calls: ['billed'] } });
  const turn = await tools(f, question), review = await synthesisReview(f, turn.answer.id);
  const before = (await f.calls()).length, approvals = f.bridge.calls.filter(call => call.method === 'models.approve').length;
  await assert.rejects(f.request('conversation.synthesis.run', { id: turn.answer.id, previewId: review.preview.id }));
  assert.equal((await f.calls()).length, before);
  assert.equal(f.bridge.calls.filter(call => call.method === 'models.approve').length, approvals);
  await noFinal(f); assert.equal(typeof turn.answer.results[0].answer.figures[0].display, 'string');
  assert.deepEqual((await f.request('conversation.get', { id: turn.answer.id })).answer, turn.answer);
});

test('external source authority loss before final preview refuses', async t => {
  const question = 'Synthetic revoked-before-preview final objective';
  const f = await fixture(t, { [question]: { calls: ['billed'] } });
  const turn = await tools(f, question), before = (await f.calls()).length;
  await f.request('trust.update', { allowedSources: ['synthetic-unrelated-authority'] });
  await assert.rejects(f.request('conversation.synthesis.preview', { id: turn.answer.id }));
  assert.equal((await f.calls()).length, before); await noFinal(f);
});

test('external authority loss after separate approval blocks dispatch', async t => {
  const question = 'Synthetic revoked-after-approval final objective';
  const f = await fixture(t, { [question]: { calls: ['billed'] } });
  const turn = await tools(f, question), prepared = await prepare(f, turn.answer.id), before = (await f.calls()).length;
  await f.request('trust.update', { allowedSources: ['synthetic-unrelated-authority'] });
  await assert.rejects(f.request('conversation.synthesis.run', prepared.payload));
  assert.equal((await f.calls()).length, before); await noFinal(f);
});

test('external authority loss during the second provider response withholds prose without retry', async t => {
  const question = 'Synthetic revoked-during-provider final objective';
  const f = await fixture(t, { [question]: { calls: ['billed'], synthesis: { gate: true } } });
  const turn = await tools(f, question), review = await synthesisReview(f, turn.answer.id), before = (await f.calls()).length;
  // The outcome of the held run is not asserted here; what must hold is that no final answer is kept and no retry is sent.
  const pending = approveFinal(review).catch(() => undefined);
  try {
    await waitEntered(f, before + 1);
    await f.request('trust.update', { allowedSources: ['synthetic-unrelated-authority'] });
  } finally { await release(f); await pending; }
  assert.equal((await f.calls()).length, before + 1); await noFinal(f);
});
