// Chausar venture launcher, delivery package (P5): the cheap judge that reads a practice draft after the code checks.
// It sees prices and dates only as placeholders, so no receipt amount leaves Chausar under standing consent.
import { check } from '../../contracts.ts';
import { modelNumbers, modelWords } from '../records.ts';
import { JUDGE_QUESTIONS } from '../contracts.ts';
import type { JudgeAnswer, JudgeQuestionId, ModelTask } from '../contracts.ts';

export const JUDGE_POLICY = 'Never promise a price, a date or a result that is not in the plan. Never claim work was done unless the proven list shows it.';
export const NOT_JUDGED_REASON = 'No AI judge connected.';

export const JUDGE_INSTRUCTIONS = 'You check a practice reply that an agent drafted for a made-up client of a small service business. '
  + 'Answer each question with yes, no or unsure, and give one short reason. '
  + 'goal-met: does the draft serve the expected outcome? tone-fits: does the tone suit this client? '
  + 'policy-followed: does the draft follow the policy? no-unbacked-claims: does the draft avoid claiming work that the proven list does not show? '
  + 'With an empty proven list the agent only had the client message, so a draft that says it read, checked, matched, sent or finished anything gets no for no-unbacked-claims. '
  + 'Nothing is ever sent or filed for the client, so a claim of sending or filing always gets no. '
  + 'Prices and dates appear as placeholders that Chausar fills in; never judge their amounts. Never write digits. Plain words, no dashes.';

const JUDGE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['answers'],
  properties: {
    answers: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['question', 'answer', 'reason'],
      properties: {
        question: { type: 'string', enum: [...JUDGE_QUESTIONS] },
        answer: { type: 'string', enum: ['yes', 'no', 'unsure'] },
        reason: { type: 'string', description: 'One short reason. No digits.' },
      } } },
  },
};

/** proven: plain sentences, words only, on what tool runs did; empty when the agent only had the client message. */
export type JudgeInput = { expectedOutcome: string; persona: string; draft: string; figureLabels: string[]; proven?: string[] };
type RawAnswer = { question: JudgeQuestionId; answer: 'yes' | 'no' | 'unsure'; reason: string; estimate?: true };

/**
 * Exactly one answer per judge question, in the fixed order. Reasons may hold numbers (then estimate: true, never a
 * receipt) but no amount of money.
 */
export function validateJudge(raw: unknown): RawAnswer[] {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 1 && Array.isArray((raw as { answers?: unknown }).answers), 'MODEL_OUTPUT_REJECTED', 'The judge did not answer in the expected shape.');
  const answers = (raw as { answers: unknown[] }).answers;
  check(answers.length === JUDGE_QUESTIONS.length, 'MODEL_OUTPUT_REJECTED', 'The judge must answer every question once.');
  const byQuestion = new Map<JudgeQuestionId, RawAnswer>();
  for (const item of answers) {
    check(item !== null && typeof item === 'object' && !Array.isArray(item), 'MODEL_OUTPUT_REJECTED', 'A judge answer was not an object.');
    const record = item as Record<string, unknown>;
    check(Object.keys(record).length === 3 && ['question', 'answer', 'reason'].every(key => Object.hasOwn(record, key)), 'MODEL_OUTPUT_REJECTED', 'A judge answer did not have the expected fields.');
    const question = record.question as JudgeQuestionId;
    check((JUDGE_QUESTIONS as readonly unknown[]).includes(question) && !byQuestion.has(question), 'MODEL_OUTPUT_REJECTED', 'The judge must answer every question once.');
    check(record.answer === 'yes' || record.answer === 'no' || record.answer === 'unsure', 'MODEL_OUTPUT_REJECTED', 'A judge answer must be yes, no or unsure.');
    const reason = modelWords(record.reason, 'judge reason', 200);
    byQuestion.set(question, modelNumbers(reason) ? { question, answer: record.answer, reason, estimate: true } : { question, answer: record.answer, reason });
  }
  return JUDGE_QUESTIONS.map(question => byQuestion.get(question)!);
}

export function judgeTask(input: JudgeInput): ModelTask<RawAnswer[]> {
  return {
    purpose: 'judge',
    instructions: JUDGE_INSTRUCTIONS,
    input: { expectedOutcome: input.expectedOutcome, persona: input.persona, policy: JUDGE_POLICY, draft: input.draft, figureLabels: [...input.figureLabels], proven: [...(input.proven ?? [])] },
    schemaName: 'venture-judge',
    schema: JUDGE_SCHEMA,
    validate: validateJudge,
    containsClientData: false,
    maxOutputTokens: 1024,
  };
}

export function judgedAnswers(answers: readonly RawAnswer[], callId: string | null): JudgeAnswer[] {
  return answers.map(answer => ({ ...answer, callId }));
}

export function notJudged(reason = NOT_JUDGED_REASON): JudgeAnswer[] {
  return JUDGE_QUESTIONS.map(question => ({ question, answer: 'not-judged', reason, callId: null }));
}
