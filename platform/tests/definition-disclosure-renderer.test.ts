import assert from 'node:assert/strict';
import test from 'node:test';
import { dialogFor, descendants, find, harness, hasText, lastNamedButton, namedButton } from './fixtures/conversation-acceptance-renderer.ts';

// Actual renderer/preload/strict clone boundary with an authored gateway preview.
// No provider, credentials, Engine worker, Electron or network is invoked.
test('published definition disclosure warning is visible beside consent before the sole reviewed request', async () => {
  const question = 'What was billed?', warning = 'Published calculation labels, definitions and parameter meanings are included separately from evidence Shape. Review definition text for private names, amounts and instructions before approving this exact payload.';
  const preview = { id: 'synthetic-definition-preview', routeId: 'synthetic-definition-route', purpose: 'conversation',
    questionDisclosure: 'verbatim', naturalQuestion: question, definitionDisclosure: 'published',
    definitionDisclosureWarning: warning, approvalRequired: true, send: 'shape',
    endpoint: 'https://synthetic.invalid/v1/responses', digest: 'a'.repeat(64),
    payload: JSON.stringify({ question, questionDisclosure: 'verbatim', definitionDisclosure: 'published',
      publishedCalculations: [{ operation: 'billed', meaning: 'Owner-published synthetic definition text.' }] }) };
  const h = await harness({ mount: true, dispatch: async method => {
    if (method === 'dashboard.get') return { factCount: 0, policy: { send: 'shape' } };
    if (method === 'models.list') return [{ id: preview.routeId, kind: 'openai-responses', model: 'synthetic' }];
    if (method === 'models.preview') return preview;
    if (method === 'models.approve') return { id: 'synthetic-definition-approval' };
    if (method === 'conversation.ask') return { clarification: 'Which period should I use?' };
    assert.fail(`Unexpected disclosure UI fixture request: ${method}`);
  } });
  find(h.app, node => node.tagName === 'select' && node.attributes['aria-label'] === 'Model route').value = preview.routeId;
  await h.ask(question);
  await lastNamedButton(h.app, 'Review outbound request').dispatch('click');
  const dialog = dialogFor(h.body, 'Review model disclosure');
  const notice = find(dialog, node => node.className === 'notice warn' && hasText(node, warning));
  const consent = find(dialog, node => node.tagName === 'label' && node.className === 'field-check');
  assert.equal(notice.parent, consent.parent);
  assert.equal(notice.parent!.children.indexOf(notice), consent.parent!.children.indexOf(consent) - 1,
    'The category warning must be next to consent rather than only inside collapsed preview details.');
  assert.ok(hasText(dialog, question)); assert.ok(hasText(dialog, preview.payload));
  assert.ok(hasText(dialog, 'Shape'));
  assert.ok(descendants(dialog).some(node => node.textContent?.includes('separate verbatim disclosure')));
  const approve = namedButton(dialog, 'Approve and send once');
  await approve.dispatch('click');
  assert.equal(h.calls.some(call => call.method === 'models.approve' || call.method === 'conversation.ask'), false);
  find(consent, node => node.tagName === 'input').checked = true;
  await approve.dispatch('click'); await approve.dispatch('click');
  assert.equal(h.calls.filter(call => call.method === 'models.approve').length, 1);
  assert.equal(h.calls.filter(call => call.method === 'conversation.ask').length, 1);
});

test('definition warning uses ordinary text nodes even when preview prose contains markup', async () => {
  const h = await harness();
  const warning = 'Published definitions may contain <img src=x onerror=untrusted> private prose.';
  await h.renderer.reviewOutbound({ id: 'synthetic-warning-preview', question: 'Describe our business.', purpose: 'conversation',
    send: 'shape', routeId: 'synthetic-warning-route', definitionDisclosure: 'published', definitionDisclosureWarning: warning });
  const dialog = dialogFor(h.body, 'Review model disclosure');
  const notice = find(dialog, node => node.className === 'notice warn' && hasText(node, warning));
  assert.equal(descendants(notice).some(node => node.tagName === 'img'), false);
  assert.equal(h.calls.some(call => call.method === 'models.approve' || call.method === 'conversation.ask'), false);
});
