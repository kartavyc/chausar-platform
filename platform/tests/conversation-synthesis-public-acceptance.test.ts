import assert from 'node:assert/strict';
import test from 'node:test';
import type { PreloadBridge } from './fixtures/preload-bridge.ts';
import { fixture, MODEL_PROSE, openSaved, PASSWORD, PERIOD, SECRET, selectContinuation, SOURCE, synthesize, tools, type Fixture } from './fixtures/conversation-synthesis-public-flow.ts';

// Independent two-stage acceptance through the actual desktop preload -> structured
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
/** Lock, then open the vault again the way the desktop app does: workspace.open, then workspace.status. */
async function lockAndUnlock(bridge: PreloadBridge) {
  await bridge.request('workspace.lock');
  await bridge.request('workspace.open', { folder: 'acceptance', passphrase: PASSWORD });
  assert.equal((await bridge.request('workspace.status')).open, true);
}
/** A calculation receipt opened the way the desktop app opens it. */
async function calculationReceipt(f: Fixture, id: string, bridge = f.bridge) {
  const result = await bridge.request('receipts.get', { id, receiptId: id });
  return result.receipt || result;
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
  for (const caution of final.cautions) assert.equal(typeof caution.text, 'string');
  const evidence = calls[1].input.evidence;
  assert.ok(evidence.some((item: any) => item.kind === 'claim' && item.citationRefs.length));
  assert.ok(evidence.some((item: any) => item.kind === 'figure'));
  for (const privateText of [original.id, original.modelReceiptId, original.results[0].answer.id, original.results[1].answer.id, SOURCE, SECRET, '30000', '300.00', '2026-09-01']) {
    assert.equal(calls[1].payload.includes(privateText), false, 'Stage-two summary must omit host-only value or identifier: ' + privateText);
  }
  assert.equal((await calculationReceipt(f, original.results[1].answer.id)).id, original.results[1].answer.id);
  assert.equal((await f.calls()).length, 2);
});

test('final answer stays readable in saved history after actual lock/unlock and a complete worker restart', async t => {
  const question = 'What was billed in the selected September invoices?';
  const f = await fixture(t, { [question]: { calls: ['billed'] } }, 'ollama');
  const original = (await tools(f, question)).answer, final = (await synthesize(f, original.id)).answer;
  verifySlots(final, original, (await f.calls())[1]);
  assert.deepEqual((await f.request('conversation.get', { id: final.id })).answer, final);
  await lockAndUnlock(f.bridge);
  const saved = await openSaved(f, final.id); assert.deepEqual(saved.paragraphs, final.paragraphs);
  assert.deepEqual(saved.cautions, final.cautions);
  assert.equal((await calculationReceipt(f, original.results[0].answer.id)).id, original.results[0].answer.id);
  assert.equal((await f.calls()).length, 2);
  await f.restart(); const reopened = await f.newBridge(), savedAgain = await openSaved(f, final.id, reopened);
  assert.deepEqual(savedAgain.paragraphs, final.paragraphs);
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
    const saved = await openSaved(f, final.id); assert.deepEqual(saved.paragraphs, final.paragraphs);
    assert.deepEqual((await f.request('conversation.get', { id: final.id })).answer, final);
  }
  assert.equal((await f.calls()).length, 6);
});

test('unknown and failing tools retain their canonical warnings alongside separately authored final prose', async t => {
  const questions = ['What do you know about my business?', 'Which invoices are overdue?', 'Describe my business and age its invoices.'];
  const f = await fixture(t, { [questions[0]]: { calls: ['business.describe'] }, [questions[1]]: { calls: ['aging'] },
    [questions[2]]: { calls: ['business.describe', 'aging'] } });
  for (const question of questions) {
    const original = (await tools(f, question)).answer, final = (await synthesize(f, original.id)).answer;
    const synthesis = (await f.calls()).at(-1); verifySlots(final, original, synthesis);
    assert.ok(final.cautions.length, 'Unknown or unavailable evidence must stay explicit.');
    for (const result of original.results) {
      if (result.error) { assert.ok(final.cautions.some((item: any) => item.text === result.error.message)); assert.equal(result.error.code, 'AGING_LINK_REQUIRED'); }
      else for (const unknown of result.answer.unknowns) assert.ok(final.cautions.some((item: any) => item.text === unknown.message));
    }
    for (const caution of final.cautions) assert.equal(typeof caution.text, 'string');
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
  await lockAndUnlock(f.bridge);
  // Recent answers lists the retained clarification; continuing it selects that saved turn.
  const pending = (await f.request('conversation.history', { limit: 20 })).items.find((item: any) => item.kind === 'clarification');
  assert.ok(pending); assert.equal((await selectContinuation(f.bridge, pending.id)).originalQuestion, objective);
  const original = (await tools(f, reply, { continuationId: pending.id })).answer; assert.equal(original.kind, 'grounded-conversation');
  assert.equal(original.results[0].answer.totalMinor, '30000'); assert.equal((await f.calls()).length, 2);
  const final = (await synthesize(f, original.id)).answer, calls = await f.calls();
  assert.equal(calls[1].input.question, reply); assert.equal(calls[1].input.continuation.originalQuestion, objective);
  assert.equal(calls[2].input.question, objective); assert.equal(calls[2].stage, 'synthesis');
  assert.equal((await f.request('conversation.get', { id: final.id })).question, objective);
  verifySlots(final, original, calls[2]); assert.equal(calls.length, 3);
});

test('external authority revocation removes saved final prose without redispatch', async t => {
  const question = 'What did the permitted September records bill?';
  const f = await fixture(t, { [question]: { calls: ['billed'] } });
  const original = (await tools(f, question)).answer, final = (await synthesize(f, original.id)).answer;
  assert.equal((await openSaved(f, final.id)).paragraphs[0], final.paragraphs[0]);
  await f.request('trust.update', { allowedSources: [] });
  await assert.rejects(f.request('conversation.get', { id: final.id }));
  assert.equal((await f.request('conversation.history', { limit: 20 })).items.some((item: any) => item.id === final.id), false);
  assert.equal((await f.calls()).length, 2);
});
