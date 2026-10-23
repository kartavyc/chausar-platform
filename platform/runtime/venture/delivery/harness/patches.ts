// Chausar delivery harness: typed playbook patches. A playbook is data, never code, so the improvement loop edits it
// with one small typed operation at a time. Code checks every patch before any model money is spent: the step,
// tool, check or dictionary entry must exist, grants stay inside what the service type may hold, outside writes are
// never granted, budgets stay inside fixed choices, and no guidance asks the agent to do sums.
import { check } from '../../../contracts.ts';
import { assertNoNumbers, houseStyleFindings, tidyWords } from '../../records.ts';
import { CHECK_IDS, PLAYBOOK_PATCH_OPS, TOOL_NAMES } from '../../contracts.ts';
import type { CheckId, HarnessLimits, PlaybookPatch, PlaybookStep, ServiceType, ToolName } from '../../contracts.ts';
import { CA_FIRM_ID } from '../../playbooks/ca-firm/registration.ts';
import { SOCIAL_AGENCY_ID } from '../../playbooks/social/registration.ts';
import { YOUTUBE_ID } from '../../playbooks/youtube/registration.ts';
import { toolSpec } from './tools.ts';

export const MAX_GUIDANCE_LINES = 6;
export const TURN_CHOICES = ['2', '3', '4', '5', '6', '8'] as const;
const AGENT_KINDS = new Set(['gather', 'question', 'work']);
const SUMS = /\b(add(?:s|ed|ing)? up|sum(?:s|med|ming)?|totals?|totalling|totaling|calculat\w*|comput\w*|subtract\w*|multipl\w*|divid\w*|arithmetic|percent\w*|work(?:s|ed|ing)? out|deduct\w*|minus|net(?:s|ted|ting)? off|tally|tallies)\b/i;

/** A flagship playbook's own tools, by playbook id: only its agents may ever hold them. */
export const FLAGSHIP_TOOLS: Readonly<Record<string, readonly ToolName[]>> = Object.freeze({
  [CA_FIRM_ID]: Object.freeze(['tax.income', 'tax.interest', 'tax.gst', 'tax.tds', 'tax.statements', 'tax.portal'] as const),
  [YOUTUBE_ID]: Object.freeze(['youtube.hooks', 'youtube.editList', 'youtube.chapters', 'youtube.retention'] as const),
  [SOCIAL_AGENCY_ID]: Object.freeze(['social.report'] as const),
});

/**
 * The tools each service type's agents may ever hold. The bookkeeping tools stay with bookkeeping, and a flagship
 * playbook's own tools with that playbook (flagship: the playbook the business delivers with, or null). Every agent may
 * note where a fact came from (evidence.record).
 */
export function toolCeiling(type: ServiceType, flagship: string | null = null): ToolName[] {
  const base: ToolName[] = ['files.list', 'files.read', 'dictionary.browse', 'dictionary.resolve', 'calc.sum', 'calc.totals', 'sandbox.transform', 'sandbox.python', 'handoff.client', 'handoff.owner', 'agent.delegate', 'evidence.record'];
  const own: readonly ToolName[] = flagship !== null && Object.hasOwn(FLAGSHIP_TOOLS, flagship) ? FLAGSHIP_TOOLS[flagship] : [];
  return [...base, ...(type === 'bookkeeping' ? ['books.reconcile', 'bills.pick'] as const : []), ...own];
}

export type PlaybookBody = { steps: PlaybookStep[]; limits: HarnessLimits; aliases: Record<string, string[]> };

const refuse = (message: string): never => { check(false, 'INVALID_VENTURE_REQUEST', message); throw new Error(message); };

/** Words a patch adds: tidy, short, no numbers, house style, and never an instruction to do sums. */
function patchWords(value: string, field: string, max: number): string {
  const words = tidyWords(value);
  check(words.length >= 2 && words.length <= max, 'INVALID_VENTURE_REQUEST', `The ${field} must be between two and ${max} characters.`);
  try { assertNoNumbers(words, field); } catch { refuse(`The ${field} contained a number. Numbers come from the calculator.`); }
  check(houseStyleFindings(words).length === 0, 'INVALID_VENTURE_REQUEST', `The ${field} breaks the house style.`);
  return words;
}

/**
 * Applies one patch to a playbook body and returns a new body; the input is never changed. Refuses (with a plain
 * reason) any patch that does not apply cleanly or would leave the playbook outside its limits. flagship: the
 * playbook the business delivers with (deliveryFlagship), whose own tools it may grant; absent or null for none.
 */
export function applyPatch(body: PlaybookBody, patch: PlaybookPatch, context: { serviceType: ServiceType; entryIds: readonly string[]; flagship?: string | null }): PlaybookBody {
  check((PLAYBOOK_PATCH_OPS as readonly string[]).includes(patch.op), 'INVALID_VENTURE_REQUEST', 'The patch names an unknown change.');
  const next: PlaybookBody = structuredClone(body);
  const stepOf = (kinds: (kind: string) => boolean, what: string): PlaybookStep => {
    const step = next.steps.find(item => item.id === patch.stepId);
    if (!step || !kinds(step.kind)) refuse(`The patch names ${JSON.stringify(patch.stepId)}, which is not ${what} in this playbook.`);
    return step!;
  };
  switch (patch.op) {
    case 'guidance.add': {
      const step = stepOf(kind => AGENT_KINDS.has(kind) || kind === 'write', 'an agent or writing step');
      const words = patchWords(patch.value, 'guidance', 200);
      if (SUMS.test(words)) refuse("Guidance can't ask the agent to do sums; the calculator does them.");
      const lines = step.guidance ?? [];
      if (lines.includes(words)) refuse('The step already has that guidance.');
      if (lines.length >= MAX_GUIDANCE_LINES) refuse(`A step holds at most ${MAX_GUIDANCE_LINES} lines of guidance.`);
      step.guidance = [...lines, words];
      break;
    }
    case 'guidance.remove': {
      const step = stepOf(kind => AGENT_KINDS.has(kind) || kind === 'write', 'an agent or writing step');
      const lines = step.guidance ?? [];
      if (!lines.includes(patch.value)) refuse('The step has no such guidance to remove.');
      step.guidance = lines.filter(line => line !== patch.value);
      break;
    }
    case 'tools.grant': {
      const step = stepOf(kind => AGENT_KINDS.has(kind), 'an agent step');
      const tool = patch.value as ToolName;
      if (!(TOOL_NAMES as readonly string[]).includes(tool)) refuse(`There is no tool called ${JSON.stringify(patch.value)}.`);
      if (toolSpec(tool)?.effect === 'outside-write') refuse('Outside actions wait for your approval; an agent step never holds them.');
      if (!toolCeiling(context.serviceType, context.flagship ?? null).includes(tool)) refuse(`A ${context.serviceType} agent may not hold ${tool}.`);
      if ((step.tools ?? []).includes(tool)) refuse(`The step already holds ${tool}.`);
      step.tools = [...(step.tools ?? []), tool];
      break;
    }
    case 'tools.revoke': {
      const step = stepOf(kind => AGENT_KINDS.has(kind), 'an agent step');
      if (!(step.tools ?? []).includes(patch.value as ToolName)) refuse(`The step does not hold ${patch.value}.`);
      step.tools = (step.tools ?? []).filter(tool => tool !== patch.value);
      break;
    }
    case 'checks.add': {
      const step = stepOf(kind => kind === 'verify' || kind === 'write', 'a writing or checking step');
      if (!(CHECK_IDS as readonly string[]).includes(patch.value)) refuse(`There is no check called ${JSON.stringify(patch.value)}.`);
      if (step.checks.includes(patch.value as CheckId)) refuse('The step already runs that check.');
      step.checks = [...step.checks, patch.value as CheckId];
      break;
    }
    case 'limits.turns': {
      if (!(TURN_CHOICES as readonly string[]).includes(patch.value)) refuse(`Turn limits are one of ${TURN_CHOICES.join(', ')}.`);
      const turns = parseInt(patch.value, 10);
      if (turns === next.limits.maxTurns) refuse('The playbook already has that turn limit.');
      next.limits = { ...next.limits, maxTurns: turns, maxToolCalls: turns * 3 };
      break;
    }
    case 'alias.add': {
      const split = patch.value.indexOf('=');
      const entryId = split > 0 ? patch.value.slice(0, split).trim() : '';
      if (!context.entryIds.includes(entryId)) refuse(`The dictionary has no entry ${JSON.stringify(entryId)}.`);
      const word = patchWords(patch.value.slice(split + 1), 'alias', 40);
      const list = next.aliases[entryId] ?? [];
      if (list.map(item => item.toLowerCase()).includes(word.toLowerCase())) refuse('The entry already has that word.');
      if (list.length >= 8) refuse('An entry holds at most eight extra words.');
      next.aliases = { ...next.aliases, [entryId]: [...list, word] };
      break;
    }
  }
  return next;
}

/** Plain words for one change, for the owner's diff. */
export function describePatch(patch: PlaybookPatch, steps: readonly PlaybookStep[]): string {
  const title = steps.find(step => step.id === patch.stepId)?.title ?? patch.stepId;
  switch (patch.op) {
    case 'guidance.add': return `Adds to "${title}": ${patch.value}`;
    case 'guidance.remove': return `Removes from "${title}": ${patch.value}`;
    case 'tools.grant': return `Lets "${title}" use ${patch.value}.`;
    case 'tools.revoke': return `Stops "${title}" using ${patch.value}.`;
    case 'checks.add': return `Adds the ${patch.value} check to "${title}".`;
    case 'limits.turns': return `Gives the agent ${patch.value} turns before it must write.`;
    case 'alias.add': return `Teaches the dictionary another word: ${patch.value.slice(patch.value.indexOf('=') + 1)}.`;
  }
}
