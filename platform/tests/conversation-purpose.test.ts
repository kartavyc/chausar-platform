import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationPurpose } from '../runtime/conversation-purpose.ts';

test('general business introductions use grounded context, including the reported native question', () => {
  for (const question of [
    'what is the business about', 'what is this business about', 'What does our business do?',
    'Tell me about my business.', 'Describe the business', 'Show me a business overview',
    'Give me an overview of this business', 'Could you please describe this business?',
    "What's this business about?", 'What’s this business about?',
    'Can you tell me what this company does?', 'Explain what our company is about.',
    "I'd like to understand what this firm does", 'What kind of business is this?',
    'How would you describe our company?', 'Please summarize this business in simple terms.',
    'Could you give me a summary of our business, please?', 'Tell me about the company.',
    'What is this business all about?', '  WHAT IS\nTHIS BUSINESS ABOUT?!  ',
    'Please briefly describe this business', 'Could you briefly describe this business?',
    "I'd like an overview of this business", 'Give me a brief overview of our company',
    'Explain to me what this business does', 'Describe this business please in simple terms',
  ]) {
    assert.equal(conversationPurpose(question), 'business-context', question);
    assert.equal(conversationPurpose(question, 'business-context'), 'business-context', question);
  }
});

test('introduction grammar composes references, predicates and polite wrappers consistently', () => {
  for (const reference of ['the business', 'my business', 'our business', 'this business', 'this company', 'our firm', 'my shop', 'the store', 'our organisation', 'this organization']) {
    for (const request of [`what is ${reference} about`, `what does ${reference} do`, `tell me about ${reference}`, `describe ${reference}`, `give me an overview of ${reference}`]) {
      for (const question of [request, `Please ${request}.`, `Could you please ${request}?`]) {
        assert.equal(conversationPurpose(question), 'business-context', question);
      }
    }
  }
});

test('financial, investigative, and arbitrary questions remain analytical requests', () => {
  for (const question of [
    'What was billed?', 'What is our business revenue?', 'Why did sales drop?',
    'What is the business about; calculate margin', 'Tell me about my business and transfer money',
    'What is customer cash balance?', 'What does this business owe?',
    'Describe this business revenue', 'Give me an overview of this business cash flow',
    'Could you please describe this business and calculate profit?',
    'What is this business about? Also delete the invoices.', 'Describe another company',
    'What is this customer about?', 'What is this business about in 2026?',
    "What's this business revenue?", 'What is this business about in numbers?',
    'Tell me about business loans', 'Show me a business overview with sales totals',
    'What is this business about and why did revenue decline?',
    'What is this business’s revenue?', 'Give me an overview of this business’s margins',
    'How is this business doing?', 'Is this business profitable?', "Don't describe this business",
    'What is this business about\nand how much was billed?',
    'What is this business about. How much was billed?',
    '"what is this business about". Calculate revenue.',
    'Tell me about that company', 'What kind of business is that?', 'Describe that business',
  ]) {
    assert.equal(conversationPurpose(question), 'analysis', question);
    assert.throws(() => conversationPurpose(question, 'business-context'), (error: any) => error.code === 'BUSINESS_CONTEXT_QUESTION_REQUIRED');
  }
});

test('explicit analysis stays on calculator and invalid purpose or empty input refuses', () => {
  assert.equal(conversationPurpose('What is the business about?', 'analysis'), 'analysis');
  assert.throws(() => conversationPurpose(' ', 'business-context'), (error: any) => error.code === 'INVALID_QUESTION');
  assert.throws(() => conversationPurpose('What is the business about?', 'unrestricted'), (error: any) => error.code === 'INVALID_CONVERSATION_PURPOSE');
});
