// Chausar delivery harness (Ink v2 wave 4, package 4J11, catalogue H29): tools offered by group. Every tool belongs to
// one group. An act turn names every tool it may call, but carries the full fields only for the groups in use: the
// current step's, the asking tools (a hand-off is always one call away), and the groups of the tools the agent called
// in its last turn (fields load on demand, the turn after first use). The current step is the first agent step that
// names tools and has none of them audited yet (judge/auditor.ts); once each has, the last one. A playbook whose steps
// name no tools offers every tool whole, as before. The idea follows kimo's toolgroups.rs (2026-10-21 harvest).
import { TOOL_NAMES } from '../../contracts.ts';
import type { HarnessState, PlaybookRecord, ToolName } from '../../contracts.ts';

export type ToolGroup = 'files' | 'dictionary' | 'calculator' | 'sandbox' | 'ask' | 'outside' | 'heavy' | 'tax' | 'youtube' | 'social' | 'evidence';

/** The group of every tool. A new tool without a group fails the tests (venture-context-hygiene.test.ts). */
export const TOOL_GROUPS: Readonly<Record<ToolName, ToolGroup>> = Object.freeze({
  'files.list': 'files', 'files.read': 'files',
  'dictionary.browse': 'dictionary', 'dictionary.resolve': 'dictionary',
  'calc.sum': 'calculator', 'calc.totals': 'calculator', 'books.reconcile': 'calculator', 'bills.pick': 'calculator',
  'sandbox.transform': 'sandbox', 'sandbox.python': 'sandbox',
  'handoff.client': 'ask', 'handoff.owner': 'ask',
  'outbox.propose': 'outside',
  'agent.delegate': 'heavy',
  'tax.income': 'tax', 'tax.interest': 'tax', 'tax.gst': 'tax', 'tax.tds': 'tax', 'tax.statements': 'tax', 'tax.portal': 'tax',
  'youtube.hooks': 'youtube', 'youtube.editList': 'youtube', 'youtube.chapters': 'youtube', 'youtube.retention': 'youtube',
  'social.report': 'social',
  'evidence.record': 'evidence',
});

/** The groups always offered whole: asking a person ends a turn and must never wait for its fields. */
const ALWAYS: readonly ToolGroup[] = ['ask'];
const AGENT_KINDS = new Set(['gather', 'question', 'work']);

/** The group a tool belongs to. */
export function toolGroup(name: ToolName): ToolGroup {
  return TOOL_GROUPS[name];
}

/** What a tool outside the groups in use says instead of its fields. */
export const FIELDS_LATER = 'Fields not shown yet: they come with your next turn once you call a tool of this group, or when its step comes.';

/**
 * The offered tools whose full fields this turn carries, or null to carry every tool whole (no step names tools).
 * Read from the run's records only: its audited calls and its last turn's calls.
 */
export function loadedTools(playbook: Pick<PlaybookRecord, 'steps'>, state: Pick<HarnessState, 'toolCalls' | 'rounds' | 'turns'>, offered: readonly ToolName[]): Set<ToolName> | null {
  const steps = playbook.steps.filter(step => AGENT_KINDS.has(step.kind) && (step.tools?.length ?? 0) > 0);
  if (!steps.length) return null;
  const audited = new Set((state.rounds ?? []).flatMap(round => round.steps.filter(step => step.audited).map(step => step.tool)));
  const current = steps.find(step => !(step.tools ?? []).some(tool => audited.has(tool))) ?? steps[steps.length - 1];
  const groups = new Set<ToolGroup>([...ALWAYS, ...(current.tools ?? []).map(toolGroup)]);
  const last = state.turns.filter(turn => turn.step === 'act').at(-1)?.turn;
  for (const call of state.toolCalls) {
    if (call.turn === last && (TOOL_NAMES as readonly string[]).includes(call.tool)) groups.add(toolGroup(call.tool as ToolName));
  }
  return new Set(offered.filter(name => groups.has(toolGroup(name))));
}
