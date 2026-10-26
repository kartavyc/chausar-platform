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

/** A step's short name: its title up to the first comma, tidied. */
function nameOf(step: Pick<PlaybookStep, 'title'>): string {
  const first = tidyWords(step.title).split(',')[0].trim();
  return first.length <= NAME_CHARS ? first : `${first.slice(0, NAME_CHARS - 1).trimEnd()}.`;
}

/**
 * The starter for a step, by its kind: a question about how the agent would do it on the owner's next order. It asks
 * only, so the chat answers it and nothing is drafted, ordered or proposed.
 */
function starterOf(step: Pick<PlaybookStep, 'kind' | 'title'>): string {
  const name = lowerFirst(nameOf(step)).replace(/[.]$/, '');
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
