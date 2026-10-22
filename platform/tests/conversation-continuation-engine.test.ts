import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, turn, openSaved } from './fixtures/conversation-public-flow-acceptance.ts';

// Real desktop preload/strict IPC/production worker/Engine, authored synthetic HTTP only. Opening a saved clarification
// selects it for the next reviewed reply, as the desktop does.
const OBJECTIVE = 'What was billed?';
const REPLY = 'September 2026';

test('actual reviewed September reply carries billed objective, calculates exact local total and reopens joined receipt without another provider call', async t => {
  const f = await fixture(t, { [OBJECTIVE]: { kind: 'clarification' }, [REPLY]: { calls: ['billed'] } }, 'ollama');
  const first = await turn(f, OBJECTIVE), history = await f.request('conversation.history');
  const pending = history.items.find((item: any) => item.kind === 'clarification'); assert.ok(pending);
  assert.equal(first.answer.clarification.length > 0, true);
  await f.restart(); const fresh = await f.desktop();
  const saved = await openSaved(fresh, OBJECTIVE); assert.equal(saved.continuationId, pending.id);
  const second = await turn(f, REPLY, fresh, saved.continuationId), calls = await f.calls(), input = calls[1].input;
  assert.equal(calls.length, 2); assert.equal(input.question, REPLY);
  assert.equal(input.continuation.turnId, pending.id); assert.equal(input.continuation.originalQuestion, OBJECTIVE);
  assert.equal(input.continuation.clarification, first.answer.clarification);
  assert.equal(second.preview.continuationId, pending.id); assert.equal(second.preview.digest.length, 64);
  assert.equal(second.answer.kind, 'grounded-conversation');
  const result = second.answer.results[0].answer;
  assert.equal(result.totalMinor, '30000'); assert.equal(result.rowIds.length, 2);
  assert.deepEqual(result.period, { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(result.requestedSourceIds, ['synthetic-acceptance-invoices']);
  assert.equal(input.continuationDisclosure, 'verbatim');
  assert.equal(calls[1].payload.includes('SYNTHETIC RAW INVOICE DESCRIPTION'), false);
  await assert.rejects(f.request('conversation.continuation', { id: pending.id }), { code: 'CONVERSATION_CONTINUATION_RESOLVED' });
  assert.deepEqual((await f.request('conversation.get', { id: pending.id })).answer, first.answer);
  await f.restart();
  assert.deepEqual((await f.request('conversation.get', { id: second.answer.id })).answer, second.answer);
  assert.deepEqual(await f.request('receipts.get', { id: result.id }), result);
  assert.equal((await f.calls()).length, 2);
});

test('further clarification keeps original objective through two reviewed replies and consumes only the parent turn', async t => {
  const firstReply = 'Which part is supported?', secondReply = 'September 2026, please.';
  const f = await fixture(t, { [OBJECTIVE]: { kind: 'clarification' }, [firstReply]: { kind: 'clarification' },
    [secondReply]: { calls: ['billed'] } }, 'ollama');
  const first = await turn(f, OBJECTIVE); let pending = (await f.request('conversation.history')).items.find((item: any) => item.kind === 'clarification');
  let saved = await openSaved(f.h, OBJECTIVE); assert.equal(saved.continuationId, pending.id);
  const second = await turn(f, firstReply, f.h, saved.continuationId);
  await assert.rejects(f.request('conversation.continuation', { id: pending.id }), { code: 'CONVERSATION_CONTINUATION_RESOLVED' });
  pending = (await f.request('conversation.history')).items.find((item: any) => item.kind === 'clarification' && item.question === firstReply);
  const descriptor = await f.request('conversation.continuation', { id: pending.id });
  assert.equal(descriptor.originalQuestion, OBJECTIVE); assert.deepEqual(descriptor.exchanges, [
    { question: OBJECTIVE, clarification: first.answer.clarification }, { question: firstReply, clarification: second.answer.clarification } ]);
  saved = await openSaved(f.h, firstReply); assert.equal(saved.continuationId, pending.id);
  const third = await turn(f, secondReply, f.h, saved.continuationId), calls = await f.calls();
  assert.equal(calls.length, 3); assert.equal(calls[2].input.continuation.originalQuestion, OBJECTIVE);
  assert.deepEqual(calls[2].input.continuation.exchanges, descriptor.exchanges);
  assert.equal(third.answer.results[0].answer.totalMinor, '30000');
});

test('failed provider reply leaves original clarification pending and requires a new reviewed attempt', async t => {
  const badReply = 'September failed fixture.', goodReply = 'September succeeds fixture.';
  const f = await fixture(t, { [OBJECTIVE]: { kind: 'clarification' }, [badReply]: { calls: ['billed'], transportFailure: true },
    [goodReply]: { calls: ['billed'] } }, 'ollama');
  await turn(f, OBJECTIVE); const pending = (await f.request('conversation.history')).items.find((item: any) => item.kind === 'clarification');
  const saved = await openSaved(f.h, OBJECTIVE); assert.equal(saved.continuationId, pending.id);
  // A failed reply keeps the selection, so the next reviewed reply continues the same clarification.
  const failed = await turn(f, badReply, f.h, saved.continuationId); assert.equal(failed.answer, undefined);
  assert.equal((await f.calls()).length, 2); assert.equal((await f.request('conversation.continuation', { id: pending.id })).originalQuestion, OBJECTIVE);
  const succeeded = await turn(f, goodReply, f.h, saved.continuationId);
  assert.equal(succeeded.answer.results[0].answer.totalMinor, '30000'); assert.equal((await f.calls()).length, 3);
  assert.notEqual(succeeded.preview.id, failed.preview.id);
});

test('current source revocation after reply preview blocks dispatch and leaves no retained continuation answer', async t => {
  const f = await fixture(t, { [OBJECTIVE]: { kind: 'clarification' }, [REPLY]: { calls: ['billed'] } }, 'ollama');
  await turn(f, OBJECTIVE); const pending = (await f.request('conversation.history')).items.find((item: any) => item.kind === 'clarification');
  const payload = { question: REPLY, purpose: 'conversation', questionDisclosure: 'verbatim', routeId: f.route.id, continuationId: pending.id };
  const preview = await f.request('models.preview', payload), approval = await f.request('models.approve', { id: preview.id });
  await f.request('trust.update', { allowedSources: ['other-source'] });
  await assert.rejects(f.request('conversation.ask', { ...payload, previewId: preview.id, approvalId: approval.id }));
  assert.equal((await f.calls()).length, 1); assert.deepEqual(await f.request('conversation.history'), { items: [] });
});

test('continuing selected zero-row source retains that authority and refuses local or forged resolved-by overrides', async t => {
  const f = await fixture(t, { [OBJECTIVE]: { kind: 'clarification' }, [REPLY]: { calls: ['billed'] } }, 'ollama');
  const input = { question: OBJECTIVE, purpose: 'conversation', questionDisclosure: 'verbatim', routeId: f.route.id, sourceIds: ['synthetic-empty-source'] };
  const preview = await f.request('models.preview', input), approval = await f.request('models.approve', { id: preview.id });
  const first = await f.request('conversation.ask', { ...input, previewId: preview.id, approvalId: approval.id });
  const pending = (await f.request('conversation.history')).items.find((item: any) => item.receiptId === first.modelReceiptId);
  assert.ok(pending); const descriptor = await f.request('conversation.continuation', { id: pending.id });
  assert.deepEqual(descriptor.sourceIds, ['synthetic-empty-source']); assert.deepEqual(descriptor.requestScope.sourceIds, ['synthetic-empty-source']);
  await assert.rejects(f.request('conversation.continuation', { id: pending.id, resolvedByModelReceiptId: preview.id }), { code: 'INVALID_HISTORY_REFERENCE' });
  await assert.rejects(f.request('conversation.ask', { question: REPLY, continuationId: pending.id }), { code: 'MODEL_ROUTE_REQUIRED' });
  const reply = { question: REPLY, purpose: 'conversation', questionDisclosure: 'verbatim', routeId: f.route.id, continuationId: pending.id };
  const next = await f.request('models.preview', reply), accepted = await f.request('models.approve', { id: next.id });
  const answer = await f.request('conversation.ask', { ...reply, previewId: next.id, approvalId: accepted.id });
  assert.equal(answer.results[0].answer.totalMinor, '0'); assert.deepEqual(answer.results[0].answer.requestedSourceIds, ['synthetic-empty-source']);
  assert.deepEqual(answer.results[0].answer.rowIds, []); assert.equal((await f.calls()).length, 2);
  await f.request('trust.update', { allowedSources: ['other-source'] });
  await assert.rejects(f.request('receipts.get', { id: answer.results[0].answer.id }));
});

test('actual worker admits eight reviewed continuation links then refuses a ninth without truncating or redispatching', async t => {
  const replies = Array.from({ length: 8 }, (_, index) => `Synthetic bounded reply ${index + 1}`);
  const scenarios = Object.fromEntries([OBJECTIVE, ...replies].map(question => [question, { kind: 'clarification' }]));
  const f = await fixture(t, scenarios, 'ollama');
  let answer = (await turn(f, OBJECTIVE)).answer;
  for (let index = 0; index < replies.length; index++) {
    const pending = (await f.request('conversation.history')).items.find((item: any) => item.receiptId === answer.modelReceiptId);
    const descriptor = await f.request('conversation.continuation', { id: pending.id });
    assert.equal(descriptor.exchanges.length, index + 1); assert.equal(descriptor.originalQuestion, OBJECTIVE);
    const input = { question: replies[index], purpose: 'conversation', questionDisclosure: 'verbatim', routeId: f.route.id, continuationId: pending.id };
    const preview = await f.request('models.preview', input), approval = await f.request('models.approve', { id: preview.id });
    answer = await f.request('conversation.ask', { ...input, previewId: preview.id, approvalId: approval.id });
  }
  const pending = (await f.request('conversation.history')).items.find((item: any) => item.receiptId === answer.modelReceiptId);
  assert.deepEqual((await f.request('conversation.get', { id: pending.id })).answer, answer);
  await assert.rejects(f.request('conversation.continuation', { id: pending.id }), { code: 'CONVERSATION_CONTINUATION_LIMIT' });
  await assert.rejects(f.request('models.preview', { question: 'A ninth reply', purpose: 'conversation', questionDisclosure: 'verbatim',
    routeId: f.route.id, continuationId: pending.id }), { code: 'INVALID_CONVERSATION_CONTINUATION' });
  const saved = await openSaved(f.h, replies[replies.length - 1]!);
  assert.equal(saved.saved.answer.clarification, answer.clarification); assert.equal(saved.continuationId, undefined);
  assert.deepEqual(saved.refusal, { code: 'CONVERSATION_CONTINUATION_LIMIT', message: 'This clarification chain is full. Start a new question.' });
  assert.equal((await f.calls()).length, 9);
  const fresh = await f.request('models.preview', { question: 'An explicitly new question', purpose: 'conversation', questionDisclosure: 'verbatim', routeId: f.route.id });
  assert.equal(fresh.continuationId, undefined); assert.equal((await f.calls()).length, 9);
});
