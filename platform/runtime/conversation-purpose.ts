import { check } from './contracts.ts';

export type ConversationPurpose = 'analysis' | 'business-context';

// Match a complete nonfinancial introduction, rather than particular prompt sentences
// or isolated keywords. Every referent slot uses the same current-business vocabulary.
const BUSINESS = '(?:(?:the|my|our|this) )?(?:business|company|firm|shop|store|organisation|organization|enterprise)';
const OVERVIEW = '(?:(?:brief|short|general) )?(?:overview|introduction|summary|description|profile)';
const introductionForms = [
  `what is ${BUSINESS}(?: (?:all )?about)?`,
  `what does ${BUSINESS} (?:do|sell|provide)`,
  `what ${BUSINESS} (?:does|sells|provides|is about)`,
  `what (?:kind|type|sort) of (?:business|company) (?:is this|are we|do we run|is ${BUSINESS})`,
  `how (?:would|do) you describe ${BUSINESS}`,
  `(?:give|show) me (?:a |an )?${OVERVIEW} (?:of|about|for) ${BUSINESS}`,
  `(?:give|show) me (?:a |an )?${BUSINESS} ${OVERVIEW}`,
  `(?:a |an )?${OVERVIEW} (?:of|about|for) ${BUSINESS}`,
  `${BUSINESS} ${OVERVIEW}`,
].map(form => new RegExp(`^(?:${form})$`));

function isBusinessIntroduction(question: string): boolean {
  let text = question.normalize('NFKC').toLowerCase().replace(/[‘’]/g, "'")
    .replace(/\bwhat's\b/g, 'what is').replace(/\bi'd\b/g, 'i would')
    .replace(/[?!.,:;]/g, ' ').replace(/\s+/g, ' ').trim();
  // Politeness and presentation do not change the requested operation. Extra
  // clauses remain in the utterance and must still be consumed by the grammar.
  for (let i = 0; i < 4; i++) {
    text = text.replace(/^(?:please|briefly) /, '')
      .replace(/^(?:(?:can|could|would|will) you|i would like(?: you to| to)?|i want(?: you to| to)?) /, '')
      .replace(/ (?:please|briefly|in (?:plain|simple) english|in simple terms|at a high level|in a few words)$/, '');
  }
  const command = /^(?:tell me|explain(?: to me)?|describe(?: to me)?|introduce|summarize|summarise|help me understand|help me learn about|understand|learn about|know) /;
  const hasIntroductionCommand = command.test(text);
  if (hasIntroductionCommand) text = text.replace(command, '');
  if (hasIntroductionCommand && new RegExp(`^(?:about )?${BUSINESS}$`).test(text)) return true;
  return introductionForms.some(form => form.test(text));
}

/** A bounded general introduction intent. Numeric/financial requests stay on the calculator path. */
export function conversationPurpose(question: string, explicit?: unknown): ConversationPurpose {
  check(typeof question === 'string' && question.trim().length > 0 && question.length <= 10000,
    'INVALID_QUESTION', 'Use a question between one and 10000 characters.');
  check(explicit === undefined || explicit === 'analysis' || explicit === 'business-context',
    'INVALID_CONVERSATION_PURPOSE', 'Choose an analytical question or a grounded business introduction.');
  const introduction = isBusinessIntroduction(question);
  if (explicit === 'analysis') return 'analysis';
  if (explicit === 'business-context') {
    check(introduction, 'BUSINESS_CONTEXT_QUESTION_REQUIRED',
      'Use a general business introduction here. Financial questions need the analytical calculator.');
    return 'business-context';
  }
  return introduction ? 'business-context' : 'analysis';
}
