import assert from 'node:assert/strict';
import test from 'node:test';
import { dialogFor, descendants, find, harness, hasText, lastNamedButton, namedButton, type Element } from './fixtures/conversation-acceptance-renderer.ts';

// Authored synthetic replies exercise the actual renderer, preload and strict IPC clone boundary.
// These tests invoke no provider, engine worker, network, Electron GUI or user vault.
const originalQuestion = 'What was billed?', clarification = 'Which period?', turnId = 'synthetic-pending-billed';
const routeId = 'synthetic-continuation-route', modelReceiptId = 'synthetic-clarification-model-receipt';
const warning = 'Your original question, clarification and earlier clarification exchanges are separate disclosures alongside your exact latest reply. Review this continuation text before approving the payload once.';
const descriptor = { schemaVersion: 1, turnId, originalQuestion, clarification, sourceIds: ['synthetic-source'],
  requestScope: { sourceIds: ['synthetic-source'] }, digest: 'a'.repeat(64), exchanges: [{ question: originalQuestion, clarification }] };
const saved = { id: turnId, at: '2026-10-01T10:00:00.000Z', question: originalQuestion, answer: { clarification, modelReceiptId } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture(options: { continuationRead?: () => Promise<unknown>; dashboardRead?: () => Promise<unknown>; execute?: () => Promise<unknown>; finalAnswer?: unknown } = {}) {
  const control = { available: true, resolved: false, executionFailure: false, previewCount: 0 };
  const h = await harness({ mount: true, dispatch: async (method, payload) => {
    if (method === 'dashboard.get') return options.dashboardRead ? options.dashboardRead() : { factCount: 0, sources: 1, policy: { send: 'shape' } };
    if (method === 'models.list') return [{ id: routeId, kind: 'openai-responses', model: 'synthetic' }];
    if (method === 'conversation.history') return { items: [{ id: turnId, kind: 'clarification', question: originalQuestion, receiptId: modelReceiptId, at: saved.at }] };
    if (method === 'conversation.get') { assert.deepEqual(payload, { id: turnId }); return saved; }
    if (method === 'conversation.continuation') {
      assert.deepEqual(payload, { id: turnId });
      if (!control.available) throw Object.assign(new Error('Synthetic continuation is unavailable.'), { code: 'CONVERSATION_CONTINUATION_UNAVAILABLE' });
      if (control.resolved) throw Object.assign(new Error('This clarification has already been continued.'), { code: 'CONVERSATION_CONTINUATION_RESOLVED' });
      return options.continuationRead ? options.continuationRead() : descriptor;
    }
    if (method === 'models.preview') {
      const continuing = payload.continuationId === turnId;
      return { id: `synthetic-preview-${++control.previewCount}`, routeId, purpose: 'conversation', questionDisclosure: 'verbatim',
        approvalRequired: true, endpoint: 'https://synthetic.invalid/v1/responses', send: 'shape', digest: 'b'.repeat(64),
        ...(continuing ? { continuationId: turnId, continuationDisclosureWarning: warning } : {}),
        definitionDisclosureWarning: 'Synthetic published definition text is disclosed separately from source Shape.',
        payload: JSON.stringify({ question: payload.question, ...(continuing ? { continuation: descriptor } : {}) }) };
    }
    if (method === 'models.approve') return { id: 'synthetic-single-use-approval' };
    if (method === 'conversation.ask') {
      if (control.executionFailure) throw Object.assign(new Error('Synthetic provider failure.'), { code: 'MODEL_NETWORK_ERROR' });
      if (payload.continuationId && options.execute) return options.execute();
      return payload.continuationId ? options.finalAnswer || { status: 'unsupported', reason: 'Synthetic retained final answer.' } : saved.answer;
    }
    if (['sources.delete', 'members.revoke', 'trust.update', 'models.configure', 'workspace.lock', 'workspace.open', 'workspace.delete'].includes(method)) return {};
    assert.fail(`Unexpected continuation UI fixture request: ${method}`);
  } });
  return { ...h, control };
}
async function chooseRoute(h: Awaited<ReturnType<typeof fixture>>) {
  const route = find(h.app, node => node.tagName === 'select' && node.attributes['aria-label'] === 'Model route');
  route.value = routeId; await route.dispatch('change');
}
function selection(h: Awaited<ReturnType<typeof fixture>>) {
  return find(h.app, node => node.attributes['aria-label'] === 'Selected clarification');
}
async function openReview(h: Awaited<ReturnType<typeof fixture>>) {
  await lastNamedButton(h.app, 'Review outbound request').dispatch('click');
  return dialogFor(h.body, 'Review model disclosure');
}
async function approve(h: Awaited<ReturnType<typeof fixture>>, dialog: Element) {
  find(dialog, node => node.tagName === 'input' && node.attributes.type === 'checkbox').checked = true;
  await namedButton(dialog, 'Approve and send once').dispatch('click');
}
async function selectSaved(h: Awaited<ReturnType<typeof fixture>>) {
  await h.renderer.showConversationHistory();
  await namedButton(dialogFor(h.body, 'Recent answers'), 'Continue this question').dispatch('click');
}

test('fresh clarification explicitly continues billed objective through exact reviewed September reply and one approval', { timeout: 5000 }, async () => {
  const h = await fixture(); await chooseRoute(h);
  await h.ask(originalQuestion); await approve(h, await openReview(h));
  assert.equal(h.calls.filter(call => call.method === 'conversation.continuation').length, 0, 'A clarification does not automatically select private history.');
  const dispatched = h.calls.filter(call => ['models.preview', 'models.approve', 'conversation.ask'].includes(call.method)).length;
  await lastNamedButton(h.app, 'Continue this question').dispatch('click');
  assert.equal(h.renderer.state.continuation.id, turnId);
  assert.ok(hasText(selection(h), originalQuestion)); assert.ok(hasText(selection(h), clarification));
  assert.equal(h.calls.filter(call => ['models.preview', 'models.approve', 'conversation.ask'].includes(call.method)).length, dispatched, 'Selecting a clarification performs only guarded reads.');
  assert.deepEqual(h.calls.filter(call => call.method === 'conversation.continuation').at(-1).payload, { id: turnId });
  const reply = '  September2026\n\n';
  await h.ask(reply);
  assert.deepEqual(h.calls.filter(call => call.method === 'models.preview').at(-1).payload,
    { question: reply, routeId, purpose: 'conversation', questionDisclosure: 'verbatim', continuationId: turnId });
  const dialog = await openReview(h), consent = find(dialog, node => node.tagName === 'label' && node.className === 'field-check');
  const continuationNotice = find(dialog, node => node.className === 'notice warn' && hasText(node, warning));
  assert.equal(continuationNotice.parent, consent.parent);
  assert.equal(continuationNotice.parent!.children.indexOf(continuationNotice), consent.parent!.children.indexOf(consent) - 2);
  assert.ok(hasText(consent.parent!.children[consent.parent!.children.indexOf(consent) - 1], 'Synthetic published definition text is disclosed separately from source Shape.'));
  assert.equal(descendants(continuationNotice).some(node => node.tagName === 'details'), false);
  assert.ok(hasText(dialog, reply)); assert.ok(descendants(dialog).some(node => node.tagName === 'pre' && node.children.some(child => child.textContent?.includes('"originalQuestion":"What was billed?"'))));
  const approveButton = namedButton(dialog, 'Approve and send once');
  await approveButton.dispatch('click');
  assert.equal(h.calls.filter(call => call.method === 'conversation.ask').length, 1);
  find(consent, node => node.tagName === 'input').checked = true;
  await Promise.all([approveButton.dispatch('click'), approveButton.dispatch('click')]);
  assert.equal(h.calls.filter(call => call.method === 'models.approve').length, 2, 'Each of the two distinct previews has one approval.');
  assert.deepEqual(h.calls.filter(call => call.method === 'conversation.ask').at(-1).payload,
    { previewId: 'synthetic-preview-2', approvalId: 'synthetic-single-use-approval', question: reply, routeId, purpose: 'conversation', questionDisclosure: 'verbatim', continuationId: turnId });
  assert.equal(h.calls.filter(call => call.method === 'conversation.ask').length, 2);
  assert.equal(h.renderer.state.continuation, null); assert.equal(selection(h).children.length, 0);
  assert.equal(h.rejected.length, 0);
});

test('saved and reopened clarification controls select guarded pending ID without dispatching a model', { timeout: 5000 }, async () => {
  const h = await fixture(); await chooseRoute(h);
  await h.renderer.showConversationHistory();
  await namedButton(dialogFor(h.body, 'Recent answers'), 'Open saved answer').dispatch('click');
  assert.equal(h.renderer.state.continuation.id, turnId, 'Opening a current saved clarification explicitly selects its pending question.');
  await namedButton(dialogFor(h.body, 'Saved answer'), 'Continue this question').dispatch('click');
  assert.equal(h.renderer.state.continuation.id, turnId); assert.ok(hasText(selection(h), originalQuestion));
  await namedButton(selection(h), 'Start a new question').dispatch('click');
  await selectSaved(h);
  assert.equal(h.renderer.state.continuation.id, turnId);
  const reopened = await h.renderer.renderConversation();
  assert.ok(hasText(find(reopened, node => node.attributes['aria-label'] === 'Selected clarification'), originalQuestion));
  assert.equal(h.calls.filter(call => call.method === 'conversation.continuation').length, 4, 'Reopening the composer rechecks pending authority.');
  assert.equal(h.calls.some(call => ['models.preview', 'models.approve', 'conversation.ask'].includes(call.method)), false);
});

test('start a new question clears prior objective and does not attach continuation ID or private text', { timeout: 5000 }, async () => {
  const h = await fixture(); await chooseRoute(h); await selectSaved(h);
  await namedButton(selection(h), 'Start a new question').dispatch('click');
  assert.equal(h.renderer.state.continuation, null); assert.equal(selection(h).children.length, 0);
  const question = '  Describe the shop.\n'; await h.ask(question);
  const previewCall = h.calls.filter(call => call.method === 'models.preview').at(-1);
  assert.deepEqual(previewCall.payload, { question, routeId, purpose: 'conversation', questionDisclosure: 'verbatim' });
  const preview = h.renderer.state.messages.at(-1).data.preview;
  assert.equal(preview.payload.includes(originalQuestion), false); assert.equal(preview.continuationId, undefined);
  assert.equal(h.calls.some(call => call.method === 'models.approve' || call.method === 'conversation.ask'), false);
});

test('opening current saved clarification retains selection after both saved dialogs close', { timeout: 5000 }, async () => {
  const h = await fixture(); await chooseRoute(h);
  await h.renderer.showConversationHistory();
  const recent = dialogFor(h.body, 'Recent answers');
  await namedButton(recent, 'Open saved answer').dispatch('click');
  dialogFor(h.body, 'Saved answer').close(); recent.close();
  assert.ok(hasText(selection(h), originalQuestion)); assert.ok(hasText(selection(h), clarification));
  await h.ask('September, please.');
  assert.deepEqual(h.calls.filter(call => call.method === 'models.preview').at(-1).payload,
    { question: 'September, please.', routeId, purpose: 'conversation', questionDisclosure: 'verbatim', continuationId: turnId });
  assert.equal(h.calls.some(call => call.method === 'models.approve' || call.method === 'conversation.ask'), false);
});

test('resolved archived clarification stays readable without selecting or continuing it', { timeout: 5000 }, async () => {
  const h = await fixture(); await selectSaved(h); h.control.resolved = true;
  await h.renderer.showConversationHistory();
  const recent = dialogFor(h.body, 'Recent answers');
  await namedButton(recent, 'Open saved answer').dispatch('click');
  const archived = dialogFor(h.body, 'Saved answer');
  assert.ok(hasText(archived, originalQuestion)); assert.ok(hasText(archived, clarification));
  assert.equal(descendants(archived).some(node => node.tagName === 'button' && hasText(node, 'Continue this question')), false);
  assert.ok(descendants(h.body).includes(recent), 'Resolved selection does not erase readable saved evidence dialogs.');
  assert.equal(h.renderer.state.continuation, null); assert.equal(selection(h).children.length, 0);
  await namedButton(recent, 'Continue this question').dispatch('click');
  assert.ok(hasText(h.notifications, 'This clarification has already been continued.'));
  assert.equal(h.calls.some(call => ['models.preview', 'models.approve', 'conversation.ask'].includes(call.method)), false);
});

test('resolved active selection clears only that selection and prevents a continued preview', { timeout: 5000 }, async () => {
  const h = await fixture(); await chooseRoute(h); await selectSaved(h); h.control.resolved = true;
  h.renderer.state.messages.push({ role: 'assistant', data: { text: 'Synthetic retained unrelated answer.' } });
  await h.ask('September2026');
  assert.equal(h.renderer.state.continuation, null); assert.equal(selection(h).children.length, 0);
  assert.equal(h.renderer.state.messages[0].data.text, 'Synthetic retained unrelated answer.');
  assert.equal(h.calls.some(call => ['models.preview', 'models.approve', 'conversation.ask'].includes(call.method)), false);
});

test('continued reply cannot silently fall through to local calculator', { timeout: 5000 }, async () => {
  const h = await fixture(); await selectSaved(h);
  await h.ask('September2026');
  assert.equal(h.calls.some(call => ['models.preview', 'models.approve', 'conversation.ask'].includes(call.method)), false);
  assert.match(h.renderer.state.messages.at(-1).error, /Choose a model route to continue/);
  assert.equal(find(h.app, node => node.tagName === 'textarea').value, 'September2026');
  assert.equal(h.renderer.state.continuation.id, turnId);
  await chooseRoute(h); await h.ask('September2026');
  assert.equal(h.calls.filter(call => call.method === 'models.preview').at(-1).payload.continuationId, turnId,
    'Choosing the requested route keeps the explicitly selected objective.');
  assert.equal(h.calls.some(call => call.method === 'conversation.ask'), false);
});

test('expired or revoked selection is removed before a preview and before reopening cached composer', { timeout: 5000 }, async () => {
  for (const operation of ['preview', 'reopen']) {
    const h = await fixture(); await chooseRoute(h); await selectSaved(h); h.control.available = false;
    if (operation === 'preview') await h.ask('September2026');
    else await h.renderer.renderConversation();
    assert.equal(h.renderer.state.continuation, null); assert.equal(selection(h).children.length, 0);
    assert.equal(h.calls.some(call => ['models.preview', 'models.approve', 'conversation.ask'].includes(call.method)), false);
  }
});

test('evidence mutations remove selected objective and stale delayed authority cannot restore it', { timeout: 5000 }, async () => {
  for (const method of ['sources.delete', 'members.revoke', 'trust.update', 'models.configure', 'workspace.lock', 'workspace.open', 'workspace.delete']) {
    const h = await fixture(); await selectSaved(h);
    await h.renderer.request(method, {});
    assert.equal(h.renderer.state.continuation, null); assert.equal(selection(h).children.length, 0);
  }
  const started = deferred<void>(), delayed = deferred<unknown>();
  const h = await fixture({ continuationRead: async () => { started.resolve(); return delayed.promise; } });
  await h.renderer.showConversationHistory();
  const pending = namedButton(dialogFor(h.body, 'Recent answers'), 'Continue this question').dispatch('click');
  await started.promise; await h.renderer.request('members.revoke', {});
  delayed.resolve(descriptor); await pending;
  assert.equal(h.renderer.state.continuation, null); assert.equal(selection(h).children.length, 0);
  assert.equal(h.calls.some(call => ['models.preview', 'models.approve', 'conversation.ask'].includes(call.method)), false);
});

test('closing saved selection dialog while authority read is delayed cannot revive private objective', { timeout: 5000 }, async () => {
  const started = deferred<void>(), delayed = deferred<unknown>();
  let reads = 0;
  const h = await fixture({ continuationRead: async () => { if (++reads === 1) return descriptor; started.resolve(); return delayed.promise; } });
  await h.renderer.showSavedConversation(turnId);
  const dialog = dialogFor(h.body, 'Saved answer');
  const pending = namedButton(dialog, 'Continue this question').dispatch('click');
  await started.promise; dialog.close(); delayed.resolve(descriptor); await pending;
  assert.equal(h.renderer.state.continuation, null); assert.equal(selection(h).children.length, 0);
});

test('revoked continued preview does not render cached outbound objective or ask for approval', { timeout: 5000 }, async () => {
  const h = await fixture(); await chooseRoute(h); await selectSaved(h); await h.ask('September2026');
  h.control.available = false; await lastNamedButton(h.app, 'Review outbound request').dispatch('click');
  assert.equal(descendants(h.body).some(node => node.tagName === 'dialog' && hasText(node, 'Review model disclosure')), false);
  assert.equal(h.renderer.state.continuation, null); assert.equal(selection(h).children.length, 0);
  assert.equal(h.calls.some(call => call.method === 'models.approve' || call.method === 'conversation.ask'), false);
});

test('new-question reset discards a delayed old continuation review', { timeout: 5000 }, async () => {
  const started = deferred<void>(), delayed = deferred<unknown>(); let reads = 0;
  const h = await fixture({ continuationRead: async () => {
    if (++reads !== 3) return descriptor;
    started.resolve(); return delayed.promise;
  } });
  await chooseRoute(h); await selectSaved(h); await h.ask('September2026');
  const pending = lastNamedButton(h.app, 'Review outbound request').dispatch('click');
  await started.promise; await namedButton(selection(h), 'Start a new question').dispatch('click');
  delayed.resolve(descriptor); await pending;
  assert.equal(descendants(h.body).some(node => node.tagName === 'dialog' && hasText(node, 'Review model disclosure')), false);
  assert.equal(h.renderer.state.continuation, null); assert.equal(selection(h).children.length, 0);
  assert.equal(h.calls.some(call => call.method === 'models.approve' || call.method === 'conversation.ask'), false);
});

test('late continued send completion preserves a newer explicit continuation selection', { timeout: 5000 }, async () => {
  const started = deferred<void>(), delayed = deferred<unknown>();
  const h = await fixture({ execute: async () => { started.resolve(); return delayed.promise; } });
  await chooseRoute(h); await selectSaved(h); await h.ask('September2026');
  const dialog = await openReview(h);
  find(dialog, node => node.tagName === 'input' && node.attributes.type === 'checkbox').checked = true;
  const pending = namedButton(dialog, 'Approve and send once').dispatch('click');
  await started.promise; dialog.close(); await selectSaved(h);
  const newerSelection = h.renderer.state.continuation;
  delayed.resolve({ status: 'unsupported', reason: 'Synthetic old retained completion.' }); await pending;
  assert.equal(h.renderer.state.continuation, newerSelection); assert.ok(hasText(selection(h), originalQuestion));
  assert.equal(h.renderer.state.messages.some((message: any) => message.data?.reason === 'Synthetic old retained completion.'), false);
  assert.equal(h.calls.filter(call => call.method === 'conversation.ask').length, 1);
});

test('out-of-order composer renders cannot replace mounted evidence-clearing painter', { timeout: 5000 }, async () => {
  const started = deferred<void>(), delayed = deferred<unknown>(); let reads = 0;
  const h = await fixture({ dashboardRead: async () => {
    if (++reads !== 2) return { factCount: 0, sources: 1, policy: { send: 'shape' } };
    started.resolve(); return delayed.promise;
  } });
  await selectSaved(h);
  const oldRender = h.renderer.renderConversation(); await started.promise;
  h.renderer.state.generation++;
  const newerPage = await h.renderer.renderConversation();
  find(h.app, node => node.id === 'page-content').replaceChildren(newerPage);
  delayed.resolve({ factCount: 0, sources: 1, policy: { send: 'shape' } }); await oldRender;
  assert.ok(hasText(selection(h), originalQuestion));
  await namedButton(selection(h), 'Start a new question').dispatch('click');
  assert.equal(h.renderer.state.continuation, null); assert.equal(selection(h).children.length, 0);
  await selectSaved(h); await h.renderer.request('sources.delete', {});
  assert.equal(selection(h).children.length, 0);
});

test('provider failure leaves pending continuation for a fresh explicit review without automatic retry', { timeout: 5000 }, async () => {
  const h = await fixture(); await chooseRoute(h); await selectSaved(h); await h.ask('September2026');
  h.control.executionFailure = true;
  await approve(h, await openReview(h));
  assert.equal(h.renderer.state.continuation.id, turnId); assert.ok(hasText(selection(h), originalQuestion));
  assert.equal(h.calls.filter(call => call.method === 'conversation.ask').length, 1);
  await namedButton(dialogFor(h.body, 'Review model disclosure'), 'Approve and send once').dispatch('click');
  assert.equal(h.calls.filter(call => call.method === 'conversation.ask').length, 1);
  h.control.executionFailure = false; dialogFor(h.body, 'Review model disclosure').close();
  await h.ask('September2026');
  assert.equal(h.calls.filter(call => call.method === 'models.preview').length, 2);
  assert.equal(h.calls.filter(call => call.method === 'conversation.ask').length, 1, 'A fresh preview still waits for explicit approval.');
  await approve(h, await openReview(h));
  assert.equal(h.calls.filter(call => call.method === 'conversation.ask').length, 2);
  assert.equal(h.renderer.state.continuation, null);
});

test('successful retained further clarification and all-error turns clear old selection', { timeout: 5000 }, async () => {
  for (const finalAnswer of [{ clarification: 'Which branch?', modelReceiptId: 'synthetic-next-clarification' },
    { kind: 'grounded-conversation', id: 'synthetic-all-error', results: [{ tool: 'calculator.calculate', error: { code: 'FIXTURE_REFUSED', message: 'Synthetic retained tool error.' } }] }]) {
    const h = await fixture({ finalAnswer }); await chooseRoute(h); await selectSaved(h); await h.ask('September2026');
    await approve(h, await openReview(h));
    assert.equal(h.renderer.state.continuation, null); assert.equal(selection(h).children.length, 0);
    assert.equal(h.calls.filter(call => call.method === 'conversation.ask').length, 1);
  }
});

test('continuation warning and objective prose remain ordinary safe text nodes', { timeout: 5000 }, async () => {
  const h = await fixture();
  const prose = 'Continuation text <img src=x onerror=untrusted> is a separate disclosure.';
  await h.renderer.reviewOutbound({ id: 'synthetic-safe-prose-preview', question: 'September2026', routeId, purpose: 'conversation',
    continuationId: turnId, continuationDisclosureWarning: prose, send: 'shape' });
  const dialog = dialogFor(h.body, 'Review model disclosure');
  const notice = find(dialog, node => node.className === 'notice warn' && hasText(node, prose));
  assert.equal(descendants(notice).some(node => node.tagName === 'img'), false);
  assert.equal(h.calls.some(call => call.method === 'models.approve' || call.method === 'conversation.ask'), false);
});
