// Chausar venture launcher, agents (Ink v2 wave 4, package 4J17, catalogue A18): an agent's skills, read from the steps
// its role does in the playbook in use. Each skill is a name, one line, and a "try this" starter: a question the owner
// can put in the agent's chat box, which prefills it and is never sent by Chausar (the owner presses send, or not). A
// starter only asks, so it never reads as "from now on", a note, work or anything on the always-ask floor.
import type { AgentSkillView, PlaybookStep } from '../contracts.ts';
import { tidyWords } from '../records.ts';

/** Step kinds an agent does with the owner's AI: its skills. Code steps and the people's steps are not. */
const SKILL_KINDS: ReadonlySet<PlaybookStep['kind']> = new Set(['gather', 'question', 'work', 'write']);
const NAME_CHARS = 60;

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** Words a short name never ends on (one-shot A4): it would read as cut off. */
const JOINING = /^(?:and|or|but|the|a|an|to|of|for|from|with|in|on|at|by|what|which|that|is|are|be|it|its|their|your)$/i;

/** A step's title up to the first comma, tidied. */
const clauseOf = (step: Pick<PlaybookStep, 'title'>) => tidyWords(step.title).split(',')[0].trim();

/**
 * A step's short name: its first clause. One-shot A4 (hands-on row 54): a clause longer than 60 characters stops at the
 * last whole word that fits, never on a joining word, rather than mid-word.
 */
function nameOf(step: Pick<PlaybookStep, 'title'>): string {
  const first = clauseOf(step);
  if (first.length <= NAME_CHARS) return first;
  const words: string[] = [];
  for (const word of first.split(/\s+/)) {
    if ([...words, word].join(' ').length > NAME_CHARS) break;
    words.push(word);
  }
  while (words.length > 1 && JOINING.test(words.at(-1)!)) words.pop();
  return words.join(' ') || first.slice(0, NAME_CHARS);
}

/**
 * The starter for a step, by its kind: a question about how the agent would do it on the owner's next order. It asks
 * only, so the chat answers it and nothing is drafted, ordered or proposed. It asks about the whole first clause.
 */
function starterOf(step: Pick<PlaybookStep, 'kind' | 'title'>): string {
  const name = lowerFirst(clauseOf(step)).replace(/[.]$/, '');
  if (step.kind === 'gather') return `What do you need from me before you ${name}?`;
  if (step.kind === 'question') return 'What would you ask about on my next order?';
  return `How would you ${name} for my next order?`;
}

/** An agent's skills, one per step it does with the owner's AI, in playbook order. */
export function agentSkills(agent: { steps: readonly Pick<PlaybookStep, 'kind' | 'title'>[] }): AgentSkillView[] {
  return agent.steps.filter(step => SKILL_KINDS.has(step.kind)).map(step => {
    const line = tidyWords(step.title);
    return { name: nameOf(step), line: /[.!?]$/.test(line) ? line : `${line}.`, starter: starterOf(step) };
  });
}
