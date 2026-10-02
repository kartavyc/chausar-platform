import assert from 'node:assert/strict';
import test from 'node:test';
import {A, B, C, CUT, NEW_CUT, PERIOD, PRIOR, OCTOBER, PRIVATE_CELL, ROUTE,
  content, figures, fixture, plan, receipt, request} from './fixtures/comparison-scenario-independent-acceptance.ts';

// Actual paired public HTTP -> Gateway single-use approval -> synthetic provider
// -> Engine calculator -> encrypted custody -> fresh Engine/public readback.
// Literal arithmetic is authored independently; no private State/helper writes.

test('independent approved comparison keeps period endpoints, main branch and prior-only source through a fresh Engine', {timeout: 120_000}, async t => {
  const f = await fixture(t), input = request('change'); f.provider(plan('change', input));
  const before = await f.rpc('memory.list'), preview = await f.rpc('models.preview', input);
  assert.deepEqual(preview.sourceIds, [A, B]); assert.deepEqual(preview.businessContext.sourceIds, [A]);
  const body = content(preview);
  assert.equal(body.question, input.question); assert.deepEqual(body.calculationParameters.period, PERIOD);
  assert.deepEqual(body.calculationParameters.comparePeriod, PRIOR);
  assert.deepEqual(body.calculationParameters.origins, {period: 'owner-requested', comparePeriod: 'owner-requested'});
  assert.equal(preview.payload.includes(PRIVATE_CELL), false);
  await f.refuse('conversation.ask', {...input, previewId: preview.id}, 'OUTBOUND_APPROVAL_REQUIRED');
  const approval = await f.rpc('models.approve', {id: preview.id});
  const exact = {...input, previewId: preview.id, approvalId: approval.id};
  await f.refuse('conversation.ask', {...exact, sourceIds: [A, B, C]}, 'PREVIEW_REQUEST_CHANGED');
  await f.refuse('conversation.ask', {...exact, comparePeriod: {...PRIOR, to: '2026-08-30'}}, 'PREVIEW_REQUEST_CHANGED');
  assert.equal(f.calls.length, 0);
  const answer = await f.rpc('conversation.ask', exact), result = receipt(answer);
  assert.equal(result.operation, 'change'); assert.equal(result.totalMinor, '2');
  assert.deepEqual(figures(result), {current: '30002', previous: '30000', change: '2', changeBps: '0'});
  assert.equal(result.currency, 'INR'); assert.equal(result.dictionaryHash, f.dictionary.hash);
  assert.deepEqual(result.period, PERIOD); assert.deepEqual(result.comparePeriod, PRIOR);
  assert.equal(result.branch, 'main'); assert.equal(result.asOf, CUT); assert.deepEqual(result.requestedSourceIds, [A, B]);
  assert.deepEqual(result.rows.map((row: any) => row.entityId).sort(),
    ['00017', 'A-current-end', 'A-prior-start', 'A-prior-end', 'B-prior-only'].sort());
  assert.ok(result.rows.every((row: any) => row.branch === 'main' && [A, B].includes(row.sourceId)));
  assert.equal(result.coverage.completeness, 'reconciled-imports');
  assert.deepEqual(await f.rpc('memory.list'), before); assert.deepEqual(f.calls.map(call => call.body), [preview.payload]);
  const saved = (await f.rpc('trials.savedQuestions')).find((item: any) => item.receiptId === result.id);
  assert.deepEqual(saved.request, {operation: 'change', period: PERIOD, branch: 'main', comparePeriod: PRIOR,
    sourceIds: [A, B], asOf: CUT, onDate: '2026-10-01'});
  await f.refuse('conversation.ask', exact, 'PREVIEW_NOT_FOUND');
  const token = f.token; await f.restart();
  assert.deepEqual(await f.rpc('receipts.get', {id: result.id}), result);
  assert.deepEqual((await f.rpc('conversation.get', {id: answer.id})).answer, answer);
  assert.equal((await f.raw('workspace.status', {}, token)).status, 401);
  assert.equal(f.calls.length, 1);
  const ciphertext = await f.ciphertext(); assert.equal(ciphertext.includes(input.question), false);
  assert.equal(ciphertext.includes(PRIVATE_CELL), false);
});

test('independent scenario keeps exact reviewed 00500 text, signed truncation and huge integer arithmetic across repeated fresh reviews', {timeout: 120_000}, async t => {
  const f = await fixture(t), facts = await f.rpc('memory.list');
  const input = request('scenario'), positive = await f.turn(input, plan('scenario', input));
  const first = receipt(positive.answer);
  assert.deepEqual(figures(first), {baseline: '30002', scenario: '31502', change: '1500', priceChangeBps: '500'});
  assert.equal(first.operation, 'scenario'); assert.equal(first.totalMinor, '31502');
  assert.equal(first.assumptions.priceChangeBps, '500'); assert.match(first.assumptions.status, /Scenario only/);
  const schema = positive.preview.schema.properties.calls.items.anyOf.find((entry: any) =>
    entry.properties.tool.enum.includes('calculator.calculate') && entry.properties.args.properties.operation.enum?.includes('scenario'));
  assert.deepEqual(schema.properties.args.properties.assumptions.properties.priceChangeBps.enum, ['00500']);
  assert.equal(content(positive.preview).question, input.question);
  const saved = (await f.rpc('trials.savedQuestions')).find((item: any) => item.receiptId === first.id);
  assert.deepEqual(saved.request.assumptions, {priceChangeBps: '00500'});
  await f.restart(); assert.deepEqual((await f.rpc('conversation.get', {id: positive.answer.id})).answer, positive.answer);
  assert.equal(f.calls.length, 1);
  const negativeInput = request('scenario', {question: 'Now use my negative price assumption for that same September scope.',
    assumptions: {priceChangeBps: '-00500'}});
  const negative = receipt((await f.turn(negativeInput, plan('scenario', negativeInput))).answer);
  assert.deepEqual(figures(negative), {baseline: '30002', scenario: '28501', change: '-1501', priceChangeBps: '-500'});
  assert.equal(negative.totalMinor, '28501');
  const hugeInput = request('scenario', {question: 'Apply my reviewed price assumption to the large October sale.', period: OCTOBER, sourceIds: [A]});
  const huge = await f.turn(hugeInput, plan('scenario', hugeInput)), result = receipt(huge.answer);
  assert.deepEqual(figures(result), {baseline: '900719925474099325', scenario: '945755921747804291',
    change: '45035996273704966', priceChangeBps: '500'});
  assert.equal(result.totalMinor, '945755921747804291'); assert.deepEqual(result.period, OCTOBER);
  assert.deepEqual(result.rows.map((row: any) => row.entityId), ['A-large-october']);
  assert.deepEqual(await f.rpc('memory.list'), facts); assert.equal(f.calls.length, 3);
  assert.equal(new Set([first.id, negative.id, result.id]).size, 3);
  await f.restart(); assert.deepEqual(await f.rpc('receipts.get', {id: result.id}), result);
  assert.deepEqual((await f.rpc('conversation.get', {id: huge.answer.id})).answer, huge.answer); assert.equal(f.calls.length, 3);
});

test('unreviewed comparison refuses and a retained clarification genuinely continues after fresh Engine with a new exact approval', {timeout: 120_000}, async t => {
  const f = await fixture(t), missing = request('change'); delete missing.comparePeriod;
  f.provider(plan('change', missing)); const bad = await f.review(missing);
  await f.refuse('conversation.ask', bad.payload, 'INVALID_CONVERSATION_PLAN');
  assert.deepEqual((await f.rpc('conversation.history')).items, []); assert.deepEqual(await f.rpc('trials.savedQuestions'), []);
  const wire = {kind: 'clarification', calls: [], clarification: 'Which comparison period should I use?'};
  const clarified = await f.turn(missing, wire); assert.equal(clarified.answer.clarification, wire.clarification);
  const pending = (await f.rpc('conversation.history')).items.find((item: any) => item.kind === 'clarification'); assert.ok(pending);
  assert.deepEqual(await f.rpc('trials.savedQuestions'), []);
  await f.restart(); assert.deepEqual((await f.rpc('conversation.get', {id: pending.id})).answer, clarified.answer);
  assert.equal(f.calls.length, 2);
  const reply = {question: 'Use August as the comparison, please.', purpose: 'conversation', questionDisclosure: 'verbatim',
    routeId: ROUTE, continuationId: pending.id, comparePeriod: PRIOR};
  f.provider(plan('change', request('change'))); const review = await f.rpc('models.preview', reply);
  const disclosed = content(review);
  assert.equal(disclosed.question, reply.question); assert.equal(disclosed.continuation.originalQuestion, missing.question);
  assert.equal(disclosed.continuation.turnId, pending.id); assert.deepEqual(disclosed.calculationParameters.period, PERIOD);
  assert.deepEqual(disclosed.calculationParameters.comparePeriod, PRIOR);
  assert.equal(review.calculationParameterOrigins.period, 'retained-owner-requested');
  await f.refuse('conversation.ask', {...reply, previewId: review.id}, 'OUTBOUND_APPROVAL_REQUIRED');
  const approval = await f.rpc('models.approve', {id: review.id});
  const answer = await f.rpc('conversation.ask', {...reply, previewId: review.id, approvalId: approval.id});
  assert.deepEqual(figures(receipt(answer)), {current: '30002', previous: '30000', change: '2', changeBps: '0'});
  await f.refuse('conversation.continuation', {id: pending.id}, 'CONVERSATION_CONTINUATION_RESOLVED');
  assert.deepEqual((await f.rpc('conversation.get', {id: pending.id})).answer, clarified.answer);
  await f.restart(); assert.deepEqual((await f.rpc('conversation.get', {id: answer.id})).answer, answer);
  assert.equal(f.calls.length, 3);
});

test('model period, textual assumption and trusted-cut overrides refuse without partial calculator results', {timeout: 120_000}, async t => {
  const f = await fixture(t);
  const variants = [
    {input: request('change'), wire: plan('change', request('change'), {comparePeriod: {...PRIOR, to: '2026-08-30'}})},
    {input: request('scenario'), wire: plan('scenario', request('scenario'), {assumptions: {priceChangeBps: '500'}})},
    {input: request('scenario'), wire: plan('scenario', request('scenario'), {assumptions: {priceChangeBps: '00500', demandBps: '100'}})},
    {input: request('change'), wire: plan('change', request('change'), {asOf: NEW_CUT})},
  ];
  for (const [index, variant] of variants.entries()) {
    f.provider(variant.wire); const reviewed = await f.review(variant.input);
    await f.refuse('conversation.ask', reviewed.payload, 'INVALID_CONVERSATION_PLAN');
    assert.equal(f.calls.length, index + 1); assert.equal(f.calls.at(-1)!.body, reviewed.preview.payload);
    await f.refuse('conversation.ask', reviewed.payload, 'PREVIEW_NOT_FOUND');
    assert.deepEqual((await f.rpc('conversation.history')).items, []); assert.deepEqual(await f.rpc('trials.savedQuestions'), []);
  }
});

test('selected prior-only source authority is checked before dispatch and on retained readback after reopen', {timeout: 120_000}, async t => {
  const f = await fixture(t), input = request('change'); f.provider(plan('change', input));
  const reviewed = await f.review(input); await f.rpc('trust.update', {allowedSources: [A]});
  await f.refuse('conversation.ask', reviewed.payload, 'PREVIEW_STALE'); assert.equal(f.calls.length, 0);
  await f.rpc('trust.update', {allowedSources: [A, B, C]});
  const turn = await f.turn(input, plan('change', input)), result = receipt(turn.answer);
  assert.equal(result.totalMinor, '2'); assert.ok(result.rows.some((row: any) => row.sourceId === B));
  await f.rpc('trust.update', {allowedSources: [A]});
  await f.refuse('conversation.get', {id: turn.answer.id}, 'CONVERSATION_NOT_FOUND');
  await f.refuse('receipts.get', {id: result.id}, 'SOURCE_REVOKED');
  assert.deepEqual((await f.rpc('conversation.history')).items, []);
  await f.restart(); await f.refuse('conversation.get', {id: turn.answer.id}, 'CONVERSATION_NOT_FOUND');
  await f.refuse('receipts.get', {id: result.id}, 'SOURCE_REVOKED'); assert.equal(f.calls.length, 1);
});

test('real correction invalidates pending review and saved conversation while old and fresh knowledge cuts retain their exact meaning', {timeout: 120_000}, async t => {
  const f = await fixture(t), input = request('change');
  const original = await f.turn(input, plan('change', input)), first = receipt(original.answer);
  const pending = await f.review(input), fact = (await f.rpc('memory.list')).facts.find((value: any) => value.entityId === '00017');
  assert.ok(fact); f.advance('2026-10-02T12:00:00.000Z');
  await f.rpc('memory.correct', {id: fact.id, fields: {amountMinor: '20001'}});
  await f.refuse('conversation.ask', pending.payload); assert.equal(f.calls.length, 1);
  await f.refuse('conversation.get', {id: original.answer.id}, 'CONVERSATION_NOT_FOUND');
  const stale = await f.rpc('receipts.get', {id: first.id}); assert.equal(stale.stale, true);
  const {stale: oldFlag, staleReason: oldReason, ...oldBody} = first;
  const {stale: newFlag, staleReason: newReason, ...newBody} = stale;
  assert.equal(oldFlag, false); assert.equal(newFlag, true); assert.equal(oldReason, undefined);
  assert.equal(typeof newReason, 'string'); assert.deepEqual(newBody, oldBody);
  f.advance(NEW_CUT);
  const current = request('change', {asOf: NEW_CUT}), fresh = await f.turn(current, plan('change', current));
  assert.deepEqual(figures(receipt(fresh.answer)), {current: '40002', previous: '30000', change: '10002', changeBps: '3334'});
  assert.equal(receipt(fresh.answer).coverage.completeness, 'unreconciled-facts');
  const historical = await f.turn(input, plan('change', input));
  assert.deepEqual(figures(receipt(historical.answer)), {current: '30002', previous: '30000', change: '2', changeBps: '0'});
  assert.equal(receipt(historical.answer).asOf, CUT);
  await f.restart(); assert.deepEqual((await f.rpc('conversation.get', {id: fresh.answer.id})).answer, fresh.answer);
  assert.deepEqual((await f.rpc('conversation.get', {id: historical.answer.id})).answer, historical.answer);
  assert.equal((await f.rpc('receipts.get', {id: first.id})).stale, true); assert.equal(f.calls.length, 3);
});

test('explicit empty and narrower reviewed comparison scopes preserve coverage uncertainty and do not broaden prior evidence', {timeout: 120_000}, async t => {
  const f = await fixture(t), empty = request('change', {sourceIds: []});
  const zero = receipt((await f.turn(empty, plan('change', empty))).answer);
  assert.deepEqual(figures(zero), {current: '0', previous: '0', change: '0'});
  assert.deepEqual(zero.rowIds, []); assert.deepEqual(zero.rows, []); assert.deepEqual(zero.sourceIds, []);
  assert.deepEqual(zero.requestedSourceIds, []); assert.equal(zero.coverage.completeness, 'empty');
  assert.ok(zero.coverage.gaps.some((gap: string) => /not proof/i.test(gap)));
  const narrower = request('change', {sourceIds: [A]}), scoped = receipt((await f.turn(narrower, plan('change', narrower))).answer);
  assert.deepEqual(figures(scoped), {current: '30002', previous: '20000', change: '10002', changeBps: '5001'});
  assert.deepEqual(scoped.requestedSourceIds, [A]); assert.ok(scoped.rows.every((row: any) => row.sourceId === A));
  const noPrior = request('change', {sourceIds: [A], comparePeriod: {from: '2026-07-01', to: '2026-07-31'}});
  const result = receipt((await f.turn(noPrior, plan('change', noPrior))).answer);
  assert.deepEqual(figures(result), {current: '30002', previous: '0', change: '30002'});
  assert.equal(result.figures.some((figure: any) => figure.key === 'changeBps'), false);
  assert.equal(f.calls.length, 3);
});

test('explicit provider incomplete terminal response admits no comparison result and cannot reuse its exact approval', {timeout: 120_000}, async t => {
  const f = await fixture(t), input = request('change'); f.provider(plan('change', input), 'incomplete');
  const turn = await f.review(input); await f.refuse('conversation.ask', turn.payload, 'MODEL_INCOMPLETE');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].body, turn.preview.payload);
  await f.refuse('conversation.ask', turn.payload, 'PREVIEW_NOT_FOUND');
  assert.deepEqual((await f.rpc('conversation.history')).items, []); assert.deepEqual(await f.rpc('trials.savedQuestions'), []);
  await f.restart(); assert.deepEqual((await f.rpc('conversation.history')).items, []); assert.equal(f.calls.length, 1);
});
