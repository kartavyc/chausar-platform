import { check } from './contracts.ts';

export type ConversationPurpose = 'analysis' | 'business-context';

/** A bounded general introduction intent. Numeric/financial requests stay on the calculator path. */
export function conversationPurpose(question: string, explicit?: unknown): ConversationPurpose {
  check(typeof question === 'string' && question.trim().length > 0 && question.length <= 10000,
    'INVALID_QUESTION', 'Use a question between one and 10000 characters.');
  check(explicit === undefined || explicit === 'analysis' || explicit === 'business-context',
    'INVALID_CONVERSATION_PURPOSE', 'Choose an analytical question or a grounded business introduction.');
  const normalized = question.toLowerCase().replace(/[?!.,:;]/g, ' ').replace(/\s+/g, ' ').trim();
  const introduction = /^(?:what is (?:the|my|our) business about|what does (?:the|my|our) business do|(?:tell me about|describe|introduce|summarize) (?:the|my|our) business|(?:give me|show me) (?:a |an )?business (?:overview|introduction|summary))$/.test(normalized);
  if (explicit === 'analysis') return 'analysis';
  if (explicit === 'business-context') {
    check(introduction, 'BUSINESS_CONTEXT_QUESTION_REQUIRED',
      'Use a general business introduction here. Financial questions need the analytical calculator.');
    return 'business-context';
  }
  return introduction ? 'business-context' : 'analysis';
}
