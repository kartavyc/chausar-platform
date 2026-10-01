import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationPurpose } from '../runtime/conversation-purpose.ts';

test('general business introductions use grounded context, including the reported native question', () => {
  for (const question of ['what is the business about', 'What does our business do?', 'Tell me about my business.', 'Describe the business', 'Show me a business overview']) {
    assert.equal(conversationPurpose(question), 'business-context');
  }
});

test('financial, investigative, and arbitrary questions remain analytical requests', () => {
  for (const question of ['What was billed?', 'What is our business revenue?', 'Why did sales drop?', 'What is the business about; calculate margin', 'Tell me about my business and transfer money', 'What is customer cash balance?']) {
    assert.equal(conversationPurpose(question), 'analysis');
    assert.throws(() => conversationPurpose(question, 'business-context'), (error: any) => error.code === 'BUSINESS_CONTEXT_QUESTION_REQUIRED');
  }
});

test('explicit analysis stays on calculator and invalid purpose or empty input refuses', () => {
  assert.equal(conversationPurpose('What is the business about?', 'analysis'), 'analysis');
  assert.throws(() => conversationPurpose(' ', 'business-context'), (error: any) => error.code === 'INVALID_QUESTION');
  assert.throws(() => conversationPurpose('What is the business about?', 'unrestricted'), (error: any) => error.code === 'INVALID_CONVERSATION_PURPOSE');
});
