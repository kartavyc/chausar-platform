import type { QuestionCard } from '../../engine/types';

/**
 * W4 4J22b: an agent's question card read the way the engine reads the owner's reply (agents/questions.ts parseReply),
 * so the send button can say the answer back before it goes (questions.ts submitLabel). The engine sends no label of
 * its own on the row: the label changes with every key the owner types, so the screen reads the reply with the
 * engine's own patterns (tests/places/today-questions.test.tsx holds them to the engine's source) and words the label
 * in the UI's language. Only the label comes from here: the engine reads the reply again when it is sent.
 */

/** "ok" takes every guess (questions.ts EVERY_GUESS). */
const EVERY_GUESS = /^\s*(?:ok(?:ay)?|all ok|all good|yes to all|go with your guesses|sab th?eek(?: hai)?|सब ठीक(?: है)?)\s*[.!।]?\s*$/iu;
/** A question's own "ok": its guess (questions.ts TAKE_GUESS). */
const TAKE_GUESS = /^(?:ok(?:ay)?|guess|your guess|fine|th?eek|ठीक(?: है)?)$/iu;
/** A question's number at the start of its answer (questions.ts MARK). */
const MARK = /(?:^|[\s,;])(\d{1,2})\s*[.:)-]?\s*/gu;
/** An answer's letter (questions.ts answerOf), and a reply that is only one (parseReply). */
const LETTER = /^([a-d])[.)]?$/i;
const ONLY_LETTER = /^[a-d][.)]?$/i;
const LABELS = ['A', 'B', 'C', 'D'] as const;

/** The patterns, for the test that holds them to the engine's. */
export const READ_PATTERNS: readonly RegExp[] = [EVERY_GUESS, TAKE_GUESS, MARK, LETTER, ONLY_LETTER];

export interface ReadReply { answers: { number: number; answer: string }[]; free: string | null }

/** records.ts tidyWords: an em dash (U+2014, made from its code so no such character sits in the source) as a comma,
 *  runs of spaces as one, trimmed. */
const DASH = new RegExp(`\\s*${String.fromCharCode(0x2014)}\\s*`, 'g');
const tidy = (value: string) => value.replace(DASH, ', ').replace(/\s+/g, ' ').trim();

function answerOf(item: QuestionCard['items'][number], value: string): { number: number; answer: string } {
  const letter = LETTER.exec(value);
  const option = letter ? item.options[LABELS.indexOf(letter[1]!.toUpperCase() as (typeof LABELS)[number])] : undefined;
  if (option) return { number: item.number, answer: option.text };
  if (TAKE_GUESS.test(value)) return { number: item.number, answer: item.guess };
  return { number: item.number, answer: value };
}

/** questions.ts parseReply: "ok" for every guess; "1 B, 2 no" by number; anything left over is the owner's own note. */
export function readReply(card: QuestionCard, reply: string): ReadReply {
  const text = tidy(reply ?? '');
  if (!text) return { answers: [], free: null };
  if (EVERY_GUESS.test(text)) return { answers: card.items.map((item) => ({ number: item.number, answer: item.guess })), free: null };
  if (card.items.length === 1 && !/^\d/.test(text)) {
    const value = text.replace(/[.!]$/, '');
    if (ONLY_LETTER.test(value) || TAKE_GUESS.test(value)) return { answers: [answerOf(card.items[0]!, value)], free: null };
    return { answers: [], free: text };
  }
  if (!/^\d/.test(text)) return { answers: [], free: text };
  const marks = [...text.matchAll(MARK)];
  const answers: ReadReply['answers'] = [];
  const left: string[] = [];
  marks.forEach((mark, index) => {
    const start = (mark.index ?? 0) + mark[0].length;
    const end = index + 1 < marks.length ? marks[index + 1]!.index ?? text.length : text.length;
    const [value = '', ...rest] = text.slice(start, end).split(/[,;\n]/);
    const item = card.items.find((entry) => entry.number === Number(mark[1]));
    const clean = value.trim().replace(/[.!]$/, '');
    if (item && clean && !answers.some((answer) => answer.number === item.number)) answers.push(answerOf(item, clean));
    else if (clean) left.push(`${mark[1]} ${clean}`);
    const more = rest.join(',').trim();
    if (more) left.push(more);
  });
  answers.sort((a, b) => a.number - b.number);
  return { answers, free: left.length ? left.join(', ') : null };
}

/** questions.ts submitLabel's brief: an answer of more than 40 characters cut to 39 and a full stop. */
const brief = (text: string) => (text.length <= 40 ? text : `${text.slice(0, 39).trimEnd()}.`);

/** The answers as the label restates them: "1 Cut it short, 2 no". */
export function restated(read: ReadReply): string {
  return read.answers.map((answer) => `${answer.number} ${brief(answer.answer)}`).join(', ');
}
