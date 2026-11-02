// Chausar venture launcher, core (wave 6, founder decisions of 3 November 2026): the business's size, asked only when it
// matters. A profession's rules say what their size threshold counts (professions.ts CautionSize). When one of them
// counts yearly turnover or headcount with a confirmed figure, the compliance check asks for it, as ranges built from
// every distinct confirmed figure of those rules (never a figure typed here), plus "I'd rather not say". Each sized rule
// then gets a verdict line: what applies at the owner's size, or a calm line asking for the size when it is not known.
// A figure not confirmed yet is never guessed.
//
// A range is judged by one value inside it: "up to X" is X, "more than X, up to Y" is Y, and "more than X" is X plus
// one paisa (or one person). Because the ranges are cut at every figure, each range sits wholly on one side of each
// figure, so that value gives the same verdict as any amount in the range. Money stays in paise, as bigint or string.
//
// Pure and shared with the fake engine: no clock, no store, no Node built-ins.
import { cautionApplies, rupeeWords, type BusinessSize, type Caution } from './professions.ts';

/** The measures the owner can be asked, in the order they are asked. */
export const ASKED_MEASURES = Object.freeze(['turnover', 'headcount'] as const);
export type AskedMeasure = (typeof ASKED_MEASURES)[number];
/** The owner's answer: a range id for each measure answered. Not answered: left out. */
export type SizeAnswers = { turnover?: string; headcount?: string };
export type SizeChoice = { id: string; label: string };
/** One size question: its words, its ranges, and the saved range id (null when none is saved, or it is no longer offered). */
export type SizeQuestion = { measure: AskedMeasure; question: string; choices: SizeChoice[]; answer: string | null };
/** The size question of a profession, or null when none of its rules counts a size with a confirmed figure. */
export type SizeAsk = { measures: AskedMeasure[]; line: string; questions: SizeQuestion[] };

/** The range id for "I'd rather not say": kept as said, and read as unknown. */
export const SIZE_NOT_SAY = 'not-say';
export const SIZE_ASK_LINE = 'Some rules change with your size. Chausar uses this only to show which ones apply.';
const QUESTIONS: Readonly<Record<AskedMeasure, string>> = Object.freeze({
  turnover: "What's your yearly turnover?",
  headcount: 'How many people work in your business?',
});
const MISSING: Readonly<Record<AskedMeasure, string>> = Object.freeze({
  turnover: 'your yearly turnover',
  headcount: 'how many people work in your business',
});
const NOT_SAY_LABEL = "I'd rather not say";
const UNCONFIRMED = "This rule's size figure isn't confirmed yet, so Chausar can't say which applies.";

type Sized = Pick<Caution, 'size'>;
type Range = SizeChoice & { value: bigint | null };

/** A rule's confirmed figure for a measure, or null when it does not count that measure or the figure is not confirmed. */
function figureOf(caution: Sized, measure: AskedMeasure): bigint | null {
  const size = caution.size;
  if (measure === 'turnover') return (size.measure === 'turnover' || size.measure === 'both') && size.turnover.confirmed && size.turnover.aboveMinor !== null ? BigInt(size.turnover.aboveMinor) : null;
  return (size.measure === 'headcount' || size.measure === 'both') && size.headcount.confirmed && size.headcount.above !== null ? BigInt(size.headcount.above) : null;
}

/** Every distinct confirmed figure of the rules for a measure, smallest first. */
function figuresOf(cautions: readonly Sized[], measure: AskedMeasure): bigint[] {
  const figures = new Set<bigint>();
  for (const caution of cautions) {
    const figure = figureOf(caution, measure);
    if (figure !== null) figures.add(figure);
  }
  return [...figures].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const people = (count: bigint) => `${count} ${count === 1n ? 'person' : 'people'}`;

/** The ranges cut at the figures, each with the one value it is judged by, then "I'd rather not say". */
function rangesOf(measure: AskedMeasure, figures: readonly bigint[]): Range[] {
  if (figures.length === 0) return [];
  const money = (minor: bigint) => rupeeWords(minor.toString());
  const words = measure === 'turnover'
    ? { upTo: (f: bigint) => `Up to ${money(f)} a year`, between: (lo: bigint, hi: bigint) => `More than ${money(lo)}, up to ${money(hi)} a year`, above: (f: bigint) => `More than ${money(f)} a year` }
    : { upTo: (f: bigint) => `Up to ${people(f)}`, between: (lo: bigint, hi: bigint) => (lo + 1n === hi ? people(hi) : `${lo + 1n} to ${hi} people`), above: (f: bigint) => `More than ${people(f)}` };
  const first = figures[0]!, last = figures[figures.length - 1]!;
  const ranges: Range[] = [{ id: `up-to-${first}`, label: words.upTo(first), value: first }];
  for (let index = 1; index < figures.length; index++) {
    const lo = figures[index - 1]!, hi = figures[index]!;
    ranges.push({ id: `${lo}-to-${hi}`, label: words.between(lo, hi), value: hi });
  }
  ranges.push({ id: `above-${last}`, label: words.above(last), value: last + 1n });
  ranges.push({ id: SIZE_NOT_SAY, label: NOT_SAY_LABEL, value: null });
  return ranges;
}

/** The size question for a set of rules (a profession's), with the saved answers where they are still offered. */
export function sizeAskOf(cautions: readonly Sized[], saved: SizeAnswers | null | undefined): SizeAsk | null {
  const questions: SizeQuestion[] = [];
  for (const measure of ASKED_MEASURES) {
    const ranges = rangesOf(measure, figuresOf(cautions, measure));
    if (ranges.length === 0) continue;
    const answer = saved?.[measure];
    questions.push({
      measure, question: QUESTIONS[measure], choices: ranges.map(({ id, label }) => ({ id, label })),
      answer: typeof answer === 'string' && ranges.some(range => range.id === answer) ? answer : null,
    });
  }
  return questions.length ? { measures: questions.map(question => question.measure), line: SIZE_ASK_LINE, questions } : null;
}

/** What the answers say about the business, for cautionApplies. Not saying, not answering or a range no longer offered stays unknown. */
export function businessSizeOf(cautions: readonly Sized[], answers: SizeAnswers | null | undefined): BusinessSize {
  const business: BusinessSize = {};
  for (const measure of ASKED_MEASURES) {
    const range = rangesOf(measure, figuresOf(cautions, measure)).find(item => item.id === answers?.[measure]);
    if (!range || range.value === null) continue;
    if (measure === 'turnover') business.yearlyTurnoverMinor = range.value;
    else business.headcount = Number(range.value);
  }
  return business;
}

/**
 * The verdict line of one rule at the owner's size, judged against the figures of all the rules asked about (cautions),
 * or null when the rule applies at any size.
 */
export function sizeVerdict(caution: Sized, cautions: readonly Sized[], answers: SizeAnswers | null | undefined): string | null {
  const size = caution.size;
  if (size.measure === 'none') return null;
  const business = businessSizeOf(cautions, answers);
  const verdict = cautionApplies(caution, business);
  if (verdict === 'applies') {
    if (size.measure === 'turnover') return `Above ${rupeeWords(size.turnover.aboveMinor!)} a year: ${size.above}.`;
    if (size.measure === 'headcount') return `Above ${people(BigInt(size.headcount.above!))}: ${size.above}.`;
    return `At your size: ${size.above}.`;
  }
  if (verdict === 'below') return size.below ? `At your size: ${size.below}.` : "At your size, this rule doesn't apply.";
  const known = { turnover: business.yearlyTurnoverMinor != null, headcount: business.headcount != null };
  const missing = ASKED_MEASURES.filter(measure => figureOf(caution, measure) !== null && !known[measure]);
  return missing.length ? `Add ${missing.map(measure => MISSING[measure]).join(' and ')} to see which applies.` : UNCONFIRMED;
}

/**
 * The owner's size answers, checked strictly against what is asked: one plain object, only the measures asked, each an
 * offered range id. A problem in words otherwise.
 */
export function readSizeAnswers(value: unknown, ask: SizeAsk | null): { answers: SizeAnswers } | { problem: string } {
  if (!ask) return { problem: "This profession's rules don't depend on size." };
  if (value === null || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return { problem: 'Send your size as one object.' };
  const answers: SizeAnswers = {};
  for (const [key, id] of Object.entries(value as Record<string, unknown>)) {
    const question = ask.questions.find(item => item.measure === key);
    if (!question) return { problem: 'Answer only the size questions shown.' };
    if (typeof id !== 'string' || !question.choices.some(choice => choice.id === id)) return { problem: 'Choose one of the size ranges shown.' };
    answers[question.measure] = id;
  }
  return { answers };
}
