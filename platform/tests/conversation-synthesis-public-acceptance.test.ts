import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { dialogFor, descendants, find, hasText, lastNamedButton, namedButton } from './fixtures/conversation-acceptance-renderer.ts';
import { fixture, MODEL_PROSE, openSaved, PASSWORD, PERIOD, SECRET, SOURCE, synthesize, tools, type Fixture } from './fixtures/conversation-synthesis-public-flow.ts';

// Independent two-stage acceptance through actual UI -> preload -> structured
// clone -> strict IPC -> EngineHarness -> production worker and installed codec.
// These authored fixtures prove transport/grounding, not model prose entailment.
function verifySlots(final: any, original: any, call: any) {
  const summary = call.input, output = call.output, values = new Map<string, string>();
  assert.equal(summary.results.length, original.results.length);
  for (const [index, result] of original.results.entries()) {
    const projected = summary.results[index]; assert.equal(projected.tool, result.tool);
    const evidence = summary.evidence.filter((item: any) => item.resultRef === projected.ref);
    assert.deepEqual(projected.evidenceRefs, evidence.map((item: any) => item.ref));
    if (result.error) { assert.equal(projected.status, 'unavailable'); continue; }
    for (const item of evidence) {
      if (item.kind === 'claim') {
        const claim = result.answer.claims.find((claim: any) => claim.text === item.text);
        assert.ok(claim, 'Model claim must come from the actual admitted local business tool.');
        assert.equal(item.origin, claim.origin); assert.equal(item.qualification, claim.qualification);
        assert.ok(item.citationRefs.every((ref: string) => summary.citationRefs.includes(ref)));
        assert.equal(item.citationRefs.length, claim.citationIds.length);
        assert.ok(claim.citationIds.every((id: string) => result.answer.citations.some((citation: any) => citation.id === id)));
        values.set(item.ref, claim.text);
      } else if (item.kind === 'figure') {
        const figure = result.answer.figures.find((figure: any) => figure.label === item.label && figure.unit === item.unit);
        assert.ok(figure); assert.equal(item.currency, figure.currency); values.set(item.ref, figure.display);
      } else if (item.kind === 'scope') {
        const scope: Record<string, string> = { 'Calculation period': `${PERIOD.from} to ${PERIOD.to}`,
          'Selected branch': 'All permitted branches in the selected sources', 'Known-on timestamp': result.answer.asOf };
        assert.ok(scope[item.label], 'Only public receipt scope values may materialize.'); values.set(item.ref, scope[item.label]);
      }
    }
  }
  const expected = output.paragraphs.map((paragraph: any) => paragraph.parts.map((part: any) => {
    if (part.kind === 'text') return part.text;
    assert.ok(values.has(part.ref), 'Every output slot must resolve from actual public tool evidence.');
    assert.ok(paragraph.evidenceRefs.includes(part.ref)); return values.get(part.ref);
  }).join(''));
  assert.deepEqual(final.paragraphs, expected, 'Model text must survive unchanged around exact local receipt slots.');
  assert.deepEqual(final.tools, original);
  assert.equal(final.receipt.kind, 'conversation-synthesis-receipt'); assert.equal(final.receipt.toolTurnId, original.id);
  assert.equal(final.receipt.plannerModelReceiptId, original.modelReceiptId);
  assert.match(final.receipt.inputDigest, /^[a-f0-9]{64}$/); assert.match(final.receipt.outputDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(final.cautions.map((item: any) => item.ref), summary.evidence.filter((item: any) => item.kind === 'caution').map((item: any) => item.ref));
}
async function mounted(h: Fixture['h']) {
  const deadline = Date.now() + 5000;
  while (!descendants(h.app).some(node => node.tagName === 'button' && hasText(node, 'Recent answers'))) {
    assert.ok(Date.now() < deadline, 'Conversation must mount after actual unlock.'); await delay(10);
  }
}
async function unlockInRenderer(h: Fixture['h']) {
  h.renderer.renderSetup(); await namedButton(h.app, 'Open a vault').dispatch('click');
  const form = find(h.app, node => node.tagName === 'form');
  find(form, node => node.tagName === 'input' && node.attributes.type === 'text').value = 'acceptance';
  find(form, node => node.tagName === 'input' && node.attributes.type === 'password').value = PASSWORD;
  await form.dispatch('submit'); await mounted(h);
}

test('natural mixed question reaches both reviewed stages and final model prose has current tool and citation receipts', async t => {
  const question = '  Explain what my business sells, and tell me what was billed in September.\n';
  const f = await fixture(t, { [question]: { calls: ['business.describe', 'billed'], business: 'owner' } });
  await f.request('business.profile.record', { field: 'products', value: 'Handcrafted tables', origin: 'owner-told', sourceId: SOURCE, validFrom: PERIOD.from });
  const planned = await tools(f, question), original = planned.answer;
  assert.equal(original.kind, 'grounded-conversation'); assert.deepEqual(original.results.map((item: any) => item.tool), ['business.describe', 'calculator.calculate']);
  assert.equal(original.results[1].answer.totalMinor, '30000');
  assert.ok(original.results[0].answer.claims.some((item: any) => item.origin === 'owner-told' && item.text.includes('Handcrafted tables')));
  const reviewed = await synthesize(f, original.id), final = reviewed.answer, calls = await f.calls();
  assert.deepEqual(calls.map(item => item.stage), ['planner', 'synthesis']);
  assert.equal(calls[0].input.question, question); assert.equal(calls[1].input.question, question);
  assert.equal(reviewed.preview.naturalQuestion, question); assert.equal(reviewed.preview.send, 'samples');
  assert.notEqual(reviewed.preview.id, planned.preview.id); assert.notEqual(reviewed.preview.digest, planned.preview.digest);
  assert.equal(calls[1].payload, reviewed.preview.payload, 'Dispatch must match the independently reviewed exact payload.');
  assert.equal(final.receipt.synthesisModelReceiptId, reviewed.preview.id);
  verifySlots(final, original, calls[1]); assert.ok(final.paragraphs[0].startsWith(MODEL_PROSE));
  for (const paragraph of final.paragraphs) assert.ok(hasText(f.h.app, paragraph));
  for (const caution of final.cautions) assert.ok(hasText(f.h.app, caution.text));
  const evidence = calls[1].input.evidence;
  assert.ok(evidence.some((item: any) => item.kind === 'claim' && item.citationRefs.length));
  assert.ok(evidence.some((item: any) => item.kind === 'figure'));
  for (const privateText of [original.id, original.modelReceiptId, original.results[0].answer.id, original.results[1].answer.id, SOURCE, SECRET, '30000', '300.00', '2026-09-01']) {
    assert.equal(calls[1].payload.includes(privateText), false, 'Stage-two summary must omit host-only value or identifier: ' + privateText);
  }
  assert.ok(hasText(f.h.app, 'Tool results and receipts')); assert.ok(hasText(f.h.app, 'Final answer evidence binding'));
  assert.equal(descendants(f.h.app).filter(node => node.tagName === 'button' && hasText(node, 'Review final answer')).length, 1,
    'Final answer does not recursively offer synthesis for its nested tools.');
  await lastNamedButton(f.h.app, 'Open calculation receipt').dispatch('click');
  const receipt = dialogFor(f.h.body, 'Calculation receipt'); assert.ok(hasText(receipt, original.results[1].answer.id));
  assert.equal((await f.calls()).length, 2);
});

test('final answer stays visible in saved history after actual lock/unlock and a complete worker restart', async t => {
  const question = 'What was billed in the selected September invoices?';
  const f = await fixture(t, { [question]: { calls: ['billed'] } }, 'ollama');
  const original = (await tools(f, question)).answer, final = (await synthesize(f, original.id)).answer;
  verifySlots(final, original, (await f.calls())[1]);
  assert.deepEqual((await f.request('conversation.get', { id: final.id })).answer, final);
  await f.h.renderer.request('workspace.lock');
  assert.equal(f.h.renderer.state.messages.length, 0); await unlockInRenderer(f.h);
  const saved = await openSaved(f, final.id); for (const paragraph of final.paragraphs) assert.ok(hasText(saved, paragraph));
  for (const caution of final.cautions) assert.ok(hasText(saved, caution.text));
  await namedButton(saved, 'Open calculation receipt').dispatch('click');
  assert.ok(hasText(dialogFor(f.h.body, 'Calculation receipt'), original.results[0].answer.id));
  assert.equal((await f.calls()).length, 2);
  await f.restart(); const reopened = await f.renderer(), savedAgain = await openSaved(f, final.id, reopened);
  for (const paragraph of final.paragraphs) assert.ok(hasText(savedAgain, paragraph));
  assert.deepEqual((await f.request('conversation.get', { id: final.id })).answer, final);
  assert.equal((await f.calls()).length, 2, 'Lock, reopen and saved readback never invoke either provider stage.');
});

test('repeated objectives retain distinct final IDs and summaries without cross-binding or automatic model calls', async t => {
  const questions = ['What did we bill in September?', 'What cash was received in September?', 'Describe the business and its September billing.'];
  const f = await fixture(t, { [questions[0]]: { calls: ['billed'] }, [questions[1]]: { calls: ['received'] },
    [questions[2]]: { calls: ['business.describe', 'billed'] } });
  const finals: any[] = [];
  for (const [index, question] of questions.entries()) {
    const original = (await tools(f, question)).answer; assert.equal((await f.calls()).length, index * 2 + 1);
    const final = (await synthesize(f, original.id)).answer, call = (await f.calls()).at(-1);
    verifySlots(final, original, call); assert.equal(call.input.question, question); finals.push(final);
    assert.equal((await f.calls()).length, (index + 1) * 2);
  }
  assert.equal(new Set(finals.map(item => item.id)).size, finals.length);
  assert.equal(new Set(finals.map(item => item.receipt.synthesisModelReceiptId)).size, finals.length);
  const history = await f.request('conversation.history', { limit: 20 });
  for (const final of finals) {
    assert.ok(history.items.some((item: any) => item.id === final.id && item.kind === 'synthesized-conversation'));
    const saved = await openSaved(f, final.id); for (const paragraph of final.paragraphs) assert.ok(hasText(saved, paragraph));
    assert.deepEqual((await f.request('conversation.get', { id: final.id })).answer, final);
  }
  assert.equal((await f.calls()).length, 6);
});

test('unknown and failing tools retain their canonical warnings alongside separately authored final prose', async t => {
  const questions = ['What do you know about my business?', 'How did billing change?', 'Describe my business and compare billing.'];
  const f = await fixture(t, { [questions[0]]: { calls: ['business.describe'] }, [questions[1]]: { calls: ['change'] },
    [questions[2]]: { calls: ['business.describe', 'change'] } });
  for (const question of questions) {
    const original = (await tools(f, question)).answer, final = (await synthesize(f, original.id)).answer;
    const synthesis = (await f.calls()).at(-1); verifySlots(final, original, synthesis);
    assert.ok(final.cautions.length, 'Unknown or unavailable evidence must stay explicit.');
    for (const result of original.results) {
      if (result.error) { assert.ok(final.cautions.some((item: any) => item.text === result.error.message)); assert.match(result.error.code, /COMPARISON_REQUIRED/); }
      else for (const unknown of result.answer.unknowns) assert.ok(final.cautions.some((item: any) => item.text === unknown.message));
    }
    for (const caution of final.cautions) assert.ok(hasText(f.h.app, caution.text));
    if (original.results.every((item: any) => item.error)) {
      assert.match(final.paragraphs.join(' '), /unavailable/); assert.equal(synthesis.input.evidence.some((item: any) => item.kind === 'figure'), false);
      assert.deepEqual(final.tools.receipt.resultRefs, []);
    }
  }
  assert.equal((await f.calls()).length, 6);
});

test('saved clarification replies synthesize the retained original objective, not the short latest reply', async t => {
  const objective = 'Tell me what my business was billed for the period I choose.', reply = '  September, please.\n';
  const f = await fixture(t, { [objective]: { planner: { kind: 'clarification' } }, [reply]: { calls: ['billed'] } }, 'ollama');
  const clarification = (await tools(f, objective)).answer; assert.equal(typeof clarification.clarification, 'string');
  assert.equal((await f.calls()).length, 1);
  await f.h.renderer.request('workspace.lock'); await unlockInRenderer(f.h);
  await lastNamedButton(f.h.app, 'Recent answers').dispatch('click');
  await namedButton(dialogFor(f.h.body, 'Recent answers'), 'Continue this question').dispatch('click');
  const original = (await tools(f, reply)).answer; assert.equal(original.kind, 'grounded-conversation');
  assert.equal(original.results[0].answer.totalMinor, '30000'); assert.equal((await f.calls()).length, 2);
  const final = (await synthesize(f, original.id)).answer, calls = await f.calls();
  assert.equal(calls[1].input.question, reply); assert.equal(calls[1].input.continuation.originalQuestion, objective);
  assert.equal(calls[2].input.question, objective); assert.equal(calls[2].stage, 'synthesis');
  assert.equal((await f.request('conversation.get', { id: final.id })).question, objective);
  verifySlots(final, original, calls[2]); assert.equal(calls.length, 3);
});

test('external authority revocation removes cached and saved final prose without redispatch', async t => {
  const question = 'What did the permitted September records bill?';
  const f = await fixture(t, { [question]: { calls: ['billed'] } });
  const original = (await tools(f, question)).answer, final = (await synthesize(f, original.id)).answer;
  assert.ok(hasText(await openSaved(f, final.id), final.paragraphs[0]));
  await f.request('trust.update', { allowedSources: [] });
  await assert.rejects(f.request('conversation.get', { id: final.id }));
  assert.equal((await f.request('conversation.history', { limit: 20 })).items.some((item: any) => item.id === final.id), false);
  const page = await f.h.renderer.renderConversation();
  assert.equal(f.h.renderer.state.messages.length, 0);
  for (const paragraph of final.paragraphs) assert.equal(hasText(page, paragraph), false);
  assert.equal(descendants(f.h.body).some(node => node.tagName === 'dialog' && hasText(node, final.paragraphs[0])), false);
  assert.equal((await f.calls()).length, 2);
});
