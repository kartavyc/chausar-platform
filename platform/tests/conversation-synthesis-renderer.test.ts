import assert from 'node:assert/strict';
import test from 'node:test';
import { descendants, dialogFor, find, harness, hasText, lastNamedButton, namedButton, type Element } from './fixtures/conversation-acceptance-renderer.ts';

// Actual renderer/preload/strict structured-clone boundary; authored fixtures only.
// No model provider, engine worker, Electron GUI, network or user vault is used.
// These mocks verify UI wiring; they do not qualify engine admission or provider plans.
const question = '  What was billed in September?\n';
const toolTurnId = 'synthetic-tool-turn', synthesizedId = 'synthetic-synthesized-turn', plannerRoute = 'synthetic-planner-route';
const warning = 'This separately approved final answer sends your exact question and private admitted claim text under Approved samples. Derived figures use reviewed placeholders; the host inserts canonical values into the final answer.';
const tools = { id: toolTurnId, kind: 'grounded-conversation', modelReceiptId: 'synthetic-planner-receipt',
  results: [{ tool: 'calculator.calculate', answer: { text: 'Synthetic canonical billed result: INR 1,200.00.' } }], receipt: { id: 'synthetic-composite-receipt' } };
const synthesized = { id: synthesizedId, kind: 'synthesized-conversation', paragraphs: ['September billed invoices totaled INR 1,200.00.'],
  cautions: [{ ref: 'synthetic-caution', text: 'Only the admitted invoice records are included.' }], tools,
  receipt: { id: 'synthetic-synthesis-receipt', kind: 'conversation-synthesis-receipt', toolTurnId,
    plannerModelReceiptId: tools.modelReceiptId, synthesisModelReceiptId: 'synthetic-synthesis-preview', inputDigest: 'a'.repeat(64), outputDigest: 'b'.repeat(64) } };
const synthesisPreview = { id: 'synthetic-synthesis-preview', purpose: 'conversation-synthesis', toolTurnId,
  routeId: plannerRoute, naturalQuestion: question, synthesisDisclosureWarning: warning, approvalRequired: true,
  send: 'samples', endpoint: 'https://synthetic.invalid/planner-endpoint', digest: 'c'.repeat(64),
  payload: JSON.stringify({ question, claims: [{ ref: 'synthetic-claim', text: 'Owner-admitted private synthetic business meaning.' }],
    figures: [{ ref: 'synthetic-figure', placeholder: '{{figure:synthetic-figure}}', label: 'Billed invoices', unit: 'money', currency: 'INR' }] }) };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(options: { preview?: () => Promise<unknown>; run?: () => Promise<unknown>; read?: (id: unknown) => Promise<unknown>; answer?: typeof synthesized } = {}) {
  const control = { available: true, send: 'shape', failed: false };
  const h = await harness({ mount: true, dispatch: async (method, payload) => {
    if (method === 'dashboard.get') return { factCount: 1, sourceCount: 1, policy: { send: control.send } };
    if (method === 'models.list') return [{ id: plannerRoute, kind: 'openai-responses', model: 'synthetic' }, { id: 'synthetic-other-route', kind: 'openai-responses', model: 'other' }];
    if (method === 'conversation.get') {
      if (!control.available) throw Object.assign(new Error('Synthetic current evidence is unavailable.'), { code: 'CONVERSATION_NOT_FOUND' });
      if (options.read) return options.read(payload.id);
      assert.ok(payload.id === toolTurnId || payload.id === synthesizedId);
      return { id: payload.id, question, answer: payload.id === toolTurnId ? tools : options.answer || synthesized };
    }
    if (method === 'conversation.history') return { items: [{ id: synthesizedId, question, kind: 'synthesized-conversation', receiptId: synthesized.receipt.id, at: '2026-10-01T10:00:00.000Z' }] };
    if (method === 'models.preview') return { id: 'synthetic-planner-preview', routeId: plannerRoute, purpose: 'conversation', naturalQuestion: payload.question,
      send: control.send, approvalRequired: true, endpoint: 'https://synthetic.invalid/planner-endpoint', payload: JSON.stringify({ question: payload.question }), digest: 'd'.repeat(64) };
    if (method === 'conversation.ask') return tools;
    if (method === 'conversation.synthesis.preview') {
      assert.deepEqual(payload, { id: toolTurnId });
      if (control.send === 'nothing') throw Object.assign(new Error('Nothing leaves blocks synthesis.'), { code: 'SEND_DISABLED' });
      return options.preview ? options.preview() : synthesisPreview;
    }
    if (method === 'models.approve') return { id: `${payload.id}-approval` };
    if (method === 'conversation.synthesis.run') {
      if (control.failed) throw Object.assign(new Error('Synthetic synthesis provider failed.'), { code: 'MODEL_FAILED' });
      return options.run ? options.run() : options.answer || synthesized;
    }
    if (['workspace.lock', 'workspace.open', 'workspace.delete', 'sources.delete', 'members.revoke', 'trust.update', 'models.configure'].includes(method)) return {};
    assert.fail(`Unexpected synthesis UI fixture request: ${method}`);
  } });
  return { ...h, control };
}
async function approve(dialog: Element) {
  find(dialog, node => node.tagName === 'input' && node.attributes.type === 'checkbox').checked = true;
  await namedButton(dialog, 'Approve and send once').dispatch('click');
}
async function stageOne(h: Awaited<ReturnType<typeof fixture>>) {
  const route = find(h.app, node => node.tagName === 'select' && node.attributes['aria-label'] === 'Model route');
  route.value = plannerRoute; await route.dispatch('change');
  await h.ask(question); await lastNamedButton(h.app, 'Review outbound request').dispatch('click');
  await approve(dialogFor(h.body, 'Review model disclosure'));
}
async function reviewFinal(h: Awaited<ReturnType<typeof fixture>>) {
  await lastNamedButton(h.app, 'Review final answer').dispatch('click');
  return dialogFor(h.body, 'Review model disclosure');
}

test('final answer is an explicit separately reviewed second request with exact ID-only run', { timeout: 5000 }, async () => {
  const h = await fixture(); await stageOne(h);
  assert.equal(h.calls.some(call => call.method.startsWith('conversation.synthesis.')), false, 'Planner completion must not dispatch or preview a second call automatically.');
  const dialog = await reviewFinal(h);
  assert.deepEqual(h.calls.filter(call => call.method === 'conversation.synthesis.preview').at(-1).payload, { id: toolTurnId });
  assert.equal(h.calls.some(call => call.method === 'conversation.synthesis.run'), false);
  const consent = find(dialog, node => node.tagName === 'label' && node.className === 'field-check');
  const warningNode = find(dialog, node => node.className === 'notice warn' && hasText(node, warning));
  assert.equal(warningNode.parent, consent.parent);
  assert.equal(warningNode.parent!.children.indexOf(warningNode), consent.parent!.children.indexOf(consent) - 1);
  assert.ok(descendants(consent).some(node => node.textContent?.includes('separately approve')));
  assert.ok(hasText(dialog, question)); assert.ok(hasText(dialog, synthesisPreview.payload)); assert.ok(hasText(dialog, synthesisPreview.endpoint));
  const submit = namedButton(dialog, 'Approve and send once'); await submit.dispatch('click');
  assert.equal(h.calls.filter(call => call.method === 'models.approve').length, 1, 'Unchecked second consent does not reuse first approval.');
  find(consent, node => node.tagName === 'input').checked = true;
  await Promise.all([submit.dispatch('click'), submit.dispatch('click')]);
  assert.equal(h.calls.filter(call => call.method === 'models.approve').length, 2);
  assert.deepEqual(h.calls.filter(call => call.method === 'conversation.synthesis.run').map(call => call.payload),
    [{ id: toolTurnId, previewId: synthesisPreview.id, approvalId: `${synthesisPreview.id}-approval` }]);
  assert.equal(h.calls.filter(call => call.method === 'conversation.ask').length, 1, 'Second stage never invokes conversation.ask.');
  assert.ok(h.calls.filter(call => call.method === 'conversation.get' && call.payload.id === synthesizedId).length >= 2, 'Both completion and cached render use guarded saved readback.');
  assert.ok(hasText(h.app, synthesized.paragraphs[0])); assert.ok(hasText(h.app, synthesized.cautions[0].text));
  assert.equal(h.rejected.length, 0);
});

test('final answer route comes from trusted planner turn rather than current dropdown', { timeout: 5000 }, async () => {
  const h = await fixture(); await stageOne(h);
  const route = find(h.app, node => node.tagName === 'select' && node.attributes['aria-label'] === 'Model route');
  route.value = 'synthetic-other-route'; await route.dispatch('change');
  const dialog = await reviewFinal(h);
  assert.deepEqual(h.calls.filter(call => call.method === 'conversation.synthesis.preview').at(-1).payload, { id: toolTurnId });
  assert.ok(hasText(dialog, synthesisPreview.endpoint));
});

test('host-materialized paragraphs precede canonical cautions and collapsed tool evidence as safe text', { timeout: 5000 }, async () => {
  const h = await fixture();
  const paragraph = '<img src=x onerror=untrusted> billed INR 1,200.00.';
  const caution = 'Coverage <script>untrusted</script> is limited.';
  const body = h.renderer.renderAnswer({ ...synthesized, paragraphs: [paragraph], cautions: [{ ref: 'synthetic', text: caution }] }) as Element;
  assert.ok(hasText(body.children[0], paragraph)); assert.ok(hasText(body.children[1], caution));
  assert.equal(descendants(body.children[0]).some(node => node.tagName === 'img'), false);
  assert.equal(descendants(body.children[1]).some(node => node.tagName === 'script'), false);
  const evidence = find(body, node => node.tagName === 'details' && hasText(node, 'Tool results and receipts'));
  assert.equal(evidence.attributes.open, undefined); assert.ok(hasText(evidence, tools.results[0].answer.text));
  assert.equal(descendants(body).some(node => node.tagName === 'button' && hasText(node, 'Review final answer')), false, 'Evidence expansion cannot trigger recursive synthesis.');
  assert.ok(hasText(find(body, node => node.tagName === 'details' && hasText(node, 'Final answer evidence binding')), JSON.stringify(synthesized.receipt, null, 2)));
  assert.equal(h.calls.some(call => call.method.startsWith('conversation.synthesis.')), false);
});

test('host-bound final paragraph citations render as collapsed safe text when present', { timeout: 5000 }, async () => {
  const h = await fixture();
  const references = [{ evidenceRefs: ['synthetic-evidence'], answerIds: [toolTurnId],
    receiptIds: ['synthetic-composite-receipt'], citationIds: ['<img src=x onerror=untrusted>'] }];
  const body = h.renderer.renderAnswer({ ...synthesized, references }) as Element;
  const citations = find(body, node => node.tagName === 'details' && hasText(node, 'Final answer citations'));
  assert.ok(hasText(citations, JSON.stringify(references, null, 2))); assert.equal(citations.attributes.open, undefined);
  assert.equal(descendants(citations).some(node => node.tagName === 'img'), false);
  const legacy = h.renderer.renderAnswer(synthesized) as Element;
  assert.equal(descendants(legacy).some(node => node.tagName === 'details' && hasText(node, 'Final answer citations')), false);
  assert.equal(h.calls.some(call => call.method.startsWith('conversation.synthesis.')), false);
});

test('saved synthesized answer reopens through guarded history and clears on revoked cached read', { timeout: 5000 }, async () => {
  const h = await fixture();
  await h.renderer.showConversationHistory();
  await namedButton(dialogFor(h.body, 'Recent answers'), 'Open saved answer').dispatch('click');
  assert.ok(hasText(dialogFor(h.body, 'Saved answer'), synthesized.paragraphs[0]));
  h.renderer.state.messages.push({ role: 'assistant', data: synthesized }); h.control.available = false;
  await h.renderer.renderConversation();
  assert.equal(h.renderer.state.messages.length, 0);
  assert.equal(descendants(h.body).some(node => node.tagName === 'dialog'), false);
  assert.equal(hasText(h.body, synthesized.paragraphs[0]), false);
  assert.equal(h.calls.some(call => call.method.startsWith('conversation.synthesis.')), false);
});

test('revoked tool turn is erased before creating a final answer preview', { timeout: 5000 }, async () => {
  const h = await fixture(); await stageOne(h); h.control.available = false;
  await lastNamedButton(h.app, 'Review final answer').dispatch('click');
  assert.equal(h.calls.some(call => call.method === 'conversation.synthesis.preview' || call.method === 'conversation.synthesis.run'), false);
  assert.equal(h.renderer.state.messages.length, 0); assert.equal(descendants(h.body).some(node => node.tagName === 'dialog'), false);
});

test('Nothing leaves blocks second preview without approval reuse or fallback', { timeout: 5000 }, async () => {
  const h = await fixture(); await stageOne(h); h.control.send = 'nothing';
  await lastNamedButton(h.app, 'Review final answer').dispatch('click');
  assert.equal(h.rejected.at(-1).error.code, 'SEND_DISABLED');
  assert.equal(h.calls.filter(call => call.method === 'models.approve').length, 1);
  assert.equal(h.calls.some(call => call.method === 'conversation.synthesis.run'), false);
  assert.equal(h.calls.filter(call => call.method === 'conversation.ask').length, 1);
});

test('delayed final preview is discarded after evidence change or new-question selection reset', { timeout: 5000 }, async () => {
  for (const invalidate of ['evidence', 'selection']) {
    const entered = deferred<void>(), released = deferred<unknown>();
    const h = await fixture({ preview: async () => { entered.resolve(); return released.promise; } }); await stageOne(h);
    const pending = lastNamedButton(h.app, 'Review final answer').dispatch('click'); await entered.promise;
    if (invalidate === 'evidence') await h.renderer.request('workspace.lock');
    else h.renderer.state.continuationGeneration++;
    released.resolve(synthesisPreview); await pending;
    assert.equal(descendants(h.body).some(node => node.tagName === 'dialog'), false);
    assert.equal(h.calls.some(call => call.method === 'conversation.synthesis.run'), false);
  }
});

test('closing saved tool answer during delayed synthesis preview cannot reopen private review', { timeout: 5000 }, async () => {
  const entered = deferred<void>(), released = deferred<unknown>();
  const h = await fixture({ preview: async () => { entered.resolve(); return released.promise; } });
  await h.renderer.showSavedConversation(toolTurnId);
  const saved = dialogFor(h.body, 'Saved answer');
  const pending = namedButton(saved, 'Review final answer').dispatch('click'); await entered.promise;
  saved.close(); released.resolve(synthesisPreview); await pending;
  assert.equal(descendants(h.body).some(node => node.tagName === 'dialog'), false);
});

test('closing saved tool answer during final review authority recheck cannot reopen private disclosure', { timeout: 5000 }, async () => {
  const entered = deferred<void>(), released = deferred<unknown>(); let reads = 0;
  const h = await fixture({ read: async id => {
    assert.equal(id, toolTurnId);
    if (++reads !== 3) return { id, question, answer: tools };
    entered.resolve(); return released.promise;
  } });
  await h.renderer.showSavedConversation(toolTurnId);
  const saved = dialogFor(h.body, 'Saved answer');
  const pending = namedButton(saved, 'Review final answer').dispatch('click'); await entered.promise;
  saved.close(); released.resolve({ id: toolTurnId, question, answer: tools }); await pending;
  assert.equal(descendants(h.body).some(node => node.tagName === 'dialog'), false);
  assert.equal(h.calls.some(call => call.method === 'models.approve' || call.method === 'conversation.synthesis.run'), false);
});

test('second provider failure does not retry and keeps original tool result available', { timeout: 5000 }, async () => {
  const h = await fixture(); await stageOne(h); h.control.failed = true;
  const dialog = await reviewFinal(h); await approve(dialog);
  await namedButton(dialog, 'Approve and send once').dispatch('click');
  assert.equal(h.calls.filter(call => call.method === 'conversation.synthesis.run').length, 1);
  assert.ok(hasText(h.app, tools.results[0].answer.text)); assert.equal(hasText(h.app, synthesized.paragraphs[0]), false);
  assert.equal(h.calls.filter(call => call.method === 'conversation.ask').length, 1);
});

test('late synthesis completion after lock does not render a retained paragraph', { timeout: 5000 }, async () => {
  const entered = deferred<void>(), released = deferred<unknown>();
  const h = await fixture({ run: async () => { entered.resolve(); return released.promise; } }); await stageOne(h);
  const dialog = await reviewFinal(h);
  find(dialog, node => node.tagName === 'input' && node.attributes.type === 'checkbox').checked = true;
  const pending = namedButton(dialog, 'Approve and send once').dispatch('click'); await entered.promise;
  await h.renderer.request('workspace.lock'); released.resolve(synthesized); await pending;
  assert.equal(hasText(h.app, synthesized.paragraphs[0]), false); assert.equal(h.renderer.state.messages.length, 0);
  assert.equal(h.calls.filter(call => call.method === 'conversation.synthesis.run').length, 1);
});

test('wrong Shape policy or missing second-stage warning fails closed before review or approval', { timeout: 5000 }, async () => {
  const h = await fixture();
  for (const malformed of [{ ...synthesisPreview, send: 'shape' }, { ...synthesisPreview, send: 'nothing' },
    { ...synthesisPreview, synthesisDisclosureWarning: '' }, { ...synthesisPreview, synthesisDisclosureWarning: '   ' }]) {
    await h.renderer.reviewOutbound(malformed);
  }
  assert.equal(descendants(h.body).some(node => node.tagName === 'dialog'), false);
  assert.equal(h.calls.some(call => call.method === 'models.approve' || call.method === 'conversation.synthesis.run'), false);
});
