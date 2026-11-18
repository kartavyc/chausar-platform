import { useT, type T } from '../../text';
import type { QueueItemView } from '../../engine/types';
import { PLAN_FIXED_WORDS } from '../../../../../platform/runtime/venture/chief/plan-core';
import { REVIEW_FIXED_WORDS, REVIEW_OFFER_TITLE, STEP_FIXED_WORDS } from '../../../../../platform/runtime/venture/chief/plan-view';
import { QUEUE_FIXED_WORDS } from '../../../../../platform/runtime/venture/views/queue-words';
import { SEARCH_LINES } from '../../../../../platform/runtime/venture/customers/find-states';
import { SEARCH_DONE_WORDS } from '../../../../../platform/runtime/venture/customers/find-words';
import { FIND_TITLE_WORDS } from '../../../../../platform/runtime/venture/customers/find-brief';
import { CARD_FIXED_WORDS, CARD_TEMPLATE_WORDS } from '../../../../../platform/runtime/venture/views/card-words';
import { PRACTICE_REASON } from '../../../../../platform/runtime/venture/core/launch-stage';
import { RECEIPT_WORDS, RUN_FIXED_WORDS, RUN_TEMPLATE_WORDS, SERVICE_STEPS, stepKey } from '../../../../../platform/runtime/venture/views/run-words';
import { PLACE_KINDS } from '../../../../../platform/runtime/venture/customers/find-brief';
import { ACTION_WORDS } from '../../../../../platform/runtime/venture/journal/decision-words';

/**
 * Today's words that code writes, the same every time, each with the pack line that says it: the plan's (chief/
 * plan-core.ts PLAN_FIXED_WORDS, the daily review's offer title and fixed lines, the step's buttons and fixed lines in
 * chief/plan-view.ts), the setup cards and the plan's decided line (views/queue-words.ts), and a search's lines while it
 * runs (customers/find-states.ts). Real-app problem 18 and round 5 (re-check 082): with Hindi on, Today kept "Accept
 * your plan", "Done", "Plan accepted." and "Keep this business" in English. These are the app's own words, so the pack
 * says them; a line the owner's AI or the owner wrote, or one code builds with a count or a name in it, is not one of
 * these and stays as written. The English pack holds exactly these words (tests/languages.test.tsx). Round 6 adds the
 * draft card's own words and the lines code fills with a name, a count or a model (views/card-words.ts).
 */
const keyed = (words: Readonly<Record<string, string>>, prefix: string) => Object.entries(words).map(([name, text]) => [text, `${prefix}.${name}`] as const);

export const PLAN_WORD_KEYS: ReadonlyMap<string, string> = new Map([
  ...keyed(PLAN_FIXED_WORDS, 'today.plan.fixed'),
  [REVIEW_OFFER_TITLE, 'today.plan.fixed.reviewOffer'] as const,
  ...keyed(STEP_FIXED_WORDS, 'today.plan.step'),
  ...keyed(REVIEW_FIXED_WORDS, 'today.plan.review'),
  ...keyed(QUEUE_FIXED_WORDS, 'today.fixed'),
  ...keyed({ approved: SEARCH_LINES.approved, running: SEARCH_LINES.running }, 'today.search'),
  // Round 6 (re-check 036): a draft's card, its run and its preview (views/card-words.ts), and the practice notice.
  ...keyed(CARD_FIXED_WORDS, 'today.card'),
  [PRACTICE_REASON, 'today.card.practice'] as const,
  // Round 7 (re-check 6, item 5): the run's evidence, Team's idle line and own-plan spend, the model receipt's words and
  // each service's starting steps (views/run-words.ts).
  ...keyed(RUN_FIXED_WORDS, 'today.r7'),
  ...keyed({ templates: RECEIPT_WORDS.templates, ownCopy: RECEIPT_WORDS.ownCopy, noAi: RECEIPT_WORDS.noAi, noCost: RECEIPT_WORDS.noCost, plan: RECEIPT_WORDS.plan, unknown: RECEIPT_WORDS.unknown, tokensNotReported: RECEIPT_WORDS.tokensNotReported, yourTool: RECEIPT_WORDS.yourTool, yourKey: RECEIPT_WORDS.yourKey, job: RECEIPT_WORDS.job, main: RECEIPT_WORDS.tier.main, fast: RECEIPT_WORDS.tier.fast }, 'today.r7.receipt'),
  ...SERVICE_STEPS.map((step) => [step, `today.r7.step.${stepKey(step)}`] as const),
]);

/** Round 7: a map search's kind of place (customers/find-brief.ts PLACE_KINDS, as kindWords says it) and its pack line. */
export const KIND_WORD_KEYS: ReadonlyMap<string, string> = new Map(PLACE_KINDS.map((kind) => [kind.label.toLowerCase(), `today.search.kind.${stepKey(kind.tag)}`] as const));
/** Round 7: a Today action as a decision names it (journal/decision-words.ts ACTION_WORDS) and its pack line. */
export const ACTION_WORD_KEYS: ReadonlyMap<string, string> = new Map(Object.entries(ACTION_WORDS).map(([id, words]) => [words, `today.earlier.action.${stepKey(id)}`] as const));

/**
 * A template's {names} as named parts of a pattern that matches only a line filled from it. A part never holds the end of
 * a sentence (a full stop and a space), so a line with more sentences after it is not taken for the template: such a
 * line stays as written. A name with one in it ("Dr. Rao") leaves its line in English, never half changed. The one
 * exception is a check's {detail}, which always ends its line and is a check's own words of one or more sentences
 * (delivery/checks.ts): it takes the rest of the line, so "Passed: Nothing was sent anywhere. In this build ..." still
 * reads its outcome word from the pack (re-check 7).
 */
function templatePattern(template: string): RegExp {
  const source = template.split(/(\{[a-zA-Z]+\})/).map((part) => {
    const name = /^\{([a-zA-Z]+)\}$/.exec(part)?.[1];
    if (name === 'detail' && template.endsWith(part)) return '(?<detail>.+)';
    return name ? `(?<${name}>(?:(?!\\.\\s).)+?)` : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return new RegExp(`^${source}$`);
}

const templated = (words: Readonly<Record<string, string>>, prefix: string) => Object.entries(words).map(([name, template]) => ({ template, key: `${prefix}.${name}`, pattern: templatePattern(template) }));

/**
 * Round 6: the lines code fills with a client's name, a count or a model (views/card-words.ts CARD_TEMPLATE_WORDS), and
 * the sentences of a finished search's line (customers/find-words.ts SEARCH_DONE_WORDS), each with its pack line, which
 * holds the same {names}. The most words first, so "Written by {model} through {tool}" is tried before "Written by {model}".
 */
export const TEMPLATE_WORD_KEYS: readonly { template: string; key: string; pattern: RegExp }[] = [
  ...templated(CARD_TEMPLATE_WORDS, 'today.card.t'),
  ...templated(SEARCH_DONE_WORDS, 'today.search.t'),
  ...templated(FIND_TITLE_WORDS, 'today.search.title'),
  ...templated(RUN_TEMPLATE_WORDS, 'today.r7.t'),
].sort((a, b) => b.template.replace(/\{[a-zA-Z]+\}/g, '').length - a.template.replace(/\{[a-zA-Z]+\}/g, '').length);

/**
 * A template's value in the owner's language where Chausar wrote it: a map search's kind, a decision's action, and a
 * value that is itself one of these lines (a decision's reason, a check's detail). Any other value (a name, a place, a
 * count, a model) stays as written.
 */
function valueWords(t: T, name: string, value: string): string {
  const key = name === 'kind' ? KIND_WORD_KEYS.get(value) : name === 'action' ? ACTION_WORD_KEYS.get(value) : undefined;
  if (key) return t(key);
  return name === 'reason' || name === 'detail' ? fixedWords(t)(value) : value;
}

/** One fixed line or one line filled from a template, from the pack; null when the text is neither. */
function sayOne(t: T, text: string): string | null {
  const key = PLAN_WORD_KEYS.get(text);
  if (key) return t(key);
  for (const item of TEMPLATE_WORD_KEYS) {
    const found = item.pattern.exec(text);
    if (found) return t(item.key, Object.fromEntries(Object.entries(found.groups ?? {}).map(([name, value]) => [name, valueWords(t, name, value)])));
  }
  return null;
}

/**
 * Says one of Today's fixed lines from the pack, or a line filled from one of its templates with the same parts (a name
 * or a model stays as written). A line code joins from such sentences ("Found 10 possible customers in Indore. One has a
 * contact email. ...") is said sentence by sentence, only when every sentence is one of them; any other text comes back
 * as written, so nothing an AI or the owner wrote is ever half changed. A fixed line is looked up first; sentences come
 * before a whole-line template, so a value never swallows the sentences after it ("Indore. One has ..."), and a value
 * with a full stop in it ("For Dr. Rao. You send it yourself.") still reads from its template.
 */
export function fixedWords(t: T): (text: string) => string {
  return (text) => {
    const key = PLAN_WORD_KEYS.get(text);
    if (key) return t(key);
    const sentences = text.split(/(?<=\.)\s+/);
    if (sentences.length > 1) {
      const said = sentences.map((sentence) => sayOne(t, sentence));
      if (said.every((sentence): sentence is string => sentence !== null)) return said.join(' ');
    }
    return sayOne(t, text) ?? text;
  };
}

/** fixedWords with the screen's own pack. */
export function usePlanWords(): (text: string) => string {
  return fixedWords(useT());
}

/** The sections of a draft's view that Chausar writes after the draft itself (views/queue-view.ts), not the AI. */
const OWN_SECTIONS: ReadonlySet<string> = new Set([CARD_FIXED_WORDS.checks, CARD_FIXED_WORDS.files]);

/**
 * Round 6 (re-check 036): a draft's view in the owner's language where Chausar wrote it: its title and line when code
 * filled them ("For Asha Verma. You send it yourself."), and its Checks and Files sections. The draft's own sections
 * are the AI's words and stay as written; so do a file's name and a title the AI gave.
 */
export function draftViewWords(view: QueueItemView, words: (text: string) => string): QueueItemView {
  return {
    ...view, title: words(view.title), ...(view.line ? { line: words(view.line) } : {}),
    sections: view.sections.map((section) => (section.heading && OWN_SECTIONS.has(section.heading)
      ? { ...section, heading: words(section.heading), lines: section.heading === CARD_FIXED_WORDS.checks ? section.lines.map(words) : section.lines.map((line) => (line === CARD_FIXED_WORDS.fileGone ? words(line) : line)) }
      : section)),
  };
}
