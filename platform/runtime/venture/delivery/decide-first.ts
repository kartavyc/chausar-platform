// Chausar delivery (Ink v2 wave 4, 4J14, catalogue Q22): decide first. An optional agent action (add a follow-up, an
// upsell line) is asked as {decision, reason, content}: the model says yes or no, and why, before it writes anything.
// The default is no. Content without a yes and a reason is dropped, and so is content written before the decision or
// the reason; code says why it dropped it.
//
// Ideas taken, code written here: reels-af's accent agent, which commits to whether to add an accent before writing one.
import { ChausarError } from '../../contracts.ts';
import type { Json } from '../contracts.ts';
import { tidyWords } from '../records.ts';

const MAX_REASON = 200;

/** A decided answer: content only with a yes; dropped says why content was not kept, else null. */
export type Decided<T> = { decision: 'yes' | 'no'; reason: string; content: T | null; dropped: string | null };

/**
 * The answer's schema: the decision and its reason first, then the content, which only a yes may carry. Nothing else.
 * The decision lists no before yes: no is the default.
 */
export function decideFirstSchema(content: Json): { type: 'object'; properties: { decision: Json; reason: Json; content: Json }; required: ['decision', 'reason']; additionalProperties: false } {
  return {
    type: 'object',
    properties: { decision: { type: 'string', enum: ['no', 'yes'] }, reason: { type: 'string', maxLength: MAX_REASON }, content },
    required: ['decision', 'reason'],
    additionalProperties: false,
  };
}

/**
 * Reads a decide-first answer. Anything but a clear yes with a reason, written before its content, is a no with no
 * content. readContent checks the content itself; a refusal from it drops the content too.
 */
export function readDecideFirst<T>(raw: unknown, readContent: (value: unknown) => T): Decided<T> {
  const no = (reason: string, dropped: string | null): Decided<T> => ({ decision: 'no', reason, content: null, dropped });
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return no('', 'No decision was given, so the answer is no.');
  const answer = raw as Record<string, unknown>;
  const reason = typeof answer.reason === 'string' ? tidyWords(answer.reason).slice(0, MAX_REASON) : '';
  const has = Object.hasOwn(answer, 'content') && answer.content !== undefined && answer.content !== null;
  if (answer.decision !== 'yes') {
    if (answer.decision !== 'no') return no(reason, 'No decision was given, so the answer is no.');
    return no(reason, has ? 'The answer was no, so its content was dropped.' : null);
  }
  const keys = Object.keys(answer);
  if (has && keys.indexOf('content') < keys.indexOf('decision')) return no(reason, 'The content came before the decision, so it was dropped.');
  if (has && Object.hasOwn(answer, 'reason') && keys.indexOf('content') < keys.indexOf('reason')) return no(reason, 'The content came before the reason, so it was dropped.');
  if (!reason) return no('', 'A yes needs a reason, so its content was dropped.');
  if (!has) return no(reason, 'A yes came with nothing to add.');
  try {
    return { decision: 'yes', reason, content: readContent(answer.content), dropped: null };
  } catch (error) {
    if (error instanceof ChausarError) return no(reason, 'The content did not pass its checks, so it was dropped.');
    throw error;
  }
}
