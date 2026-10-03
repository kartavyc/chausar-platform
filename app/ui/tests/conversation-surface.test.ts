import assert from 'node:assert/strict';
import test from 'node:test';
import { answerAddress, boundConversationAddress, conversationSurfaceAddress, modelConsentAddress, newQuestionAddress, questionRequest } from '../src/app/conversation-surface.ts';
import type { ConversationQuestionSettings } from '../src/app/conversation-surface.ts';

const settings: ConversationQuestionSettings = { purpose: 'conversation', questionDisclosure: 'verbatim', routeId: 'official-cli' };

test('a submitted question reaches the checked request verbatim, with server continuation excluded', () => {
  for (const question of ['  What changed?  ', '\n बिक्री समझाओ\n', 'e\u0301']) {
    assert.equal(questionRequest(settings, question)?.question, question);
  }
  assert.equal(questionRequest(settings, ' \t\n'), null);
  const invalid: unknown = { ...settings, continuationId: 'caller-history' };
  // Exercise a JavaScript host violating the typed settings contract.
  assert.throws(() => questionRequest(invalid as ConversationQuestionSettings, 'answer'), /CONTINUATION_HOST_OWNED/);
});

test('new Ask cannot redirect into a different role grant, a firm shell, or a locked workspace', () => {
  assert.deepEqual(newQuestionAddress({ kind: 'desktop', view: 'simple' }, false), { place: 'ask', sub: 'new' });
  assert.equal(newQuestionAddress({ kind: 'desktop', view: 'guided' }, true), null);
  assert.equal(newQuestionAddress({ kind: 'ca-firm', view: 'guided' }, false), null);
  assert.equal(newQuestionAddress({ kind: 'enterprise', view: 'guided', allowed: new Set(['ask.saved']) }, false), null);
  const allowed = new Set(['ask.new']);
  const shell = { kind: 'enterprise', view: 'guided', allowed } as const;
  assert.ok(newQuestionAddress(shell, false));
  allowed.clear();
  assert.equal(newQuestionAddress(shell, false), null);
});

test('only exactly authorized New/Saved addresses can retain conversation content or consent', () => {
  const shell = { kind: 'enterprise', view: 'guided', allowed: new Set(['ask.new', 'ask.saved']) } as const;
  const saved = { place: 'ask', sub: 'saved', sheet: 'turn_1' } as const;
  assert.deepEqual(conversationSurfaceAddress(shell, saved, false), saved);
  for (const address of [null, { place: 'today' }, { place: 'ask', sub: 'decisions' }] as const) {
    assert.equal(conversationSurfaceAddress(shell, address, false), null);
  }
  assert.equal(conversationSurfaceAddress(shell, saved, true), null);
  shell.allowed.delete('ask.saved');
  assert.equal(conversationSurfaceAddress(shell, saved, false), null);
});

test('review and answer addresses are distinct and never cross an address change', () => {
  const answer = { place: 'ask', sub: 'new' } as const;
  const review = modelConsentAddress(answer);
  assert.deepEqual(review, { place: 'ask', sub: 'new', sheet: 'model-consent' });
  assert.deepEqual(answerAddress(review), answer);
  assert.equal(boundConversationAddress(review, answer), false);
  assert.equal(boundConversationAddress(review, { ...review, sub: 'saved' }), false);
  assert.equal(boundConversationAddress(review, { ...review }), true);
  assert.equal(boundConversationAddress(review, null), false);
});
