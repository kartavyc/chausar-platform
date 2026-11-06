/** Saved owner choices only. Credentials and live native capabilities never live here. */
import { check } from '../../portable.ts';
import type { State } from '../../contracts.ts';
import type { AgentDriverSettings } from './driver-types.ts';
import { validateExternalServers, type ExternalMcpServer } from './external-config.ts';

export type AiProvider = 'codex' | 'claude';
export type AiTask = 'quick' | 'main';
export type AiNetwork = 'off' | 'research' | 'on';
export type AiTaskSettings = { model: string; effort: AgentDriverSettings['effort'] };
export type AiProviderSettings = {
  quick: AiTaskSettings; main: AiTaskSettings; network: AiNetwork; webSearch: AiNetwork;
  shell: false; fallbackModel?: string;
  /** W6 6F5 (D34): use the Gmail connection the owner made in ChatGPT (Codex) or Claude. Left out means off. */
  connectors?: boolean;
};
export type AiSettings = {
  codex: AiProviderSettings; claude: AiProviderSettings; autoReview: boolean; agentAutoReview: Record<string, boolean>; mcpServers: ExternalMcpServer[];
  /** C7: routines wait once the plan meter reads this percent or more (50 to 95); left out or null, only a used-up plan holds them. */
  planPause?: number | null;
  /** C7: whether agents may offer a way of working after an edited sign-off; left out means on. */
  offerWays?: boolean;
};
export type AiSettingsView = {
  settings: AiSettings;
  boundaries: { jobFolderOnly: true; windowsSandbox: 'unelevated'; shell: 'unavailable'; mcp: 'chausar-proxy'; externalMcp: 'approval-required' };
  agents: { id: string; name: string }[];
  /** C1 task 13: the models Codex itself lists, in its order; null when there is no list (no Codex, a failed read, or
   *  the fixed fallback ids, which are never shown as if Codex listed them). Claude has no list to read. */
  models: { codex: string[] | null };
};
export const AI_SETTING_BOUNDARIES: AiSettingsView['boundaries'] = Object.freeze({ jobFolderOnly: true, windowsSandbox: 'unelevated', shell: 'unavailable', mcp: 'chausar-proxy', externalMcp: 'approval-required' });

export function defaultAiSettings(): AiSettings {
  return {
    codex: { quick: { model: 'gpt-6-luna', effort: 'high' }, main: { model: 'gpt-6.1-terra', effort: 'high' }, network: 'research', webSearch: 'research', shell: false },
    claude: { quick: { model: 'claude-haiku-5-5', effort: 'high' }, main: { model: 'claude-sonnet-5-5', effort: 'high' }, network: 'research', webSearch: 'research', shell: false, fallbackModel: 'claude-haiku-5-5' },
    autoReview: true, agentAutoReview: {}, mcpServers: [],
  };
}
const BAD = 'INVALID_VENTURE_REQUEST';
function exact(raw: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw) && Object.getPrototypeOf(raw) === Object.prototype, BAD, 'Use the AI settings shown here.');
  const row = raw as Record<string, unknown>;
  check(required.every(key => Object.hasOwn(row, key)) && Object.keys(row).every(key => required.includes(key) || optional.includes(key)), BAD, 'Use only the AI settings shown here.');
  return row;
}
function task(raw: unknown): AiTaskSettings {
  const row = exact(raw, ['model', 'effort']);
  check(typeof row.model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(row.model), BAD, 'Enter the exact model name from your AI provider.');
  check(['low', 'medium', 'high', 'max'].includes(row.effort as string), BAD, 'Choose an effort shown here.');
  return { model: row.model, effort: row.effort as AiTaskSettings['effort'] };
}
function provider(raw: unknown, name: AiProvider): AiProviderSettings {
  const row = exact(raw, ['quick', 'main', 'network', 'webSearch', 'shell'], ['fallbackModel', 'connectors']);
  check(!Object.hasOwn(row, 'connectors') || typeof row.connectors === 'boolean', BAD, 'Choose whether the AI may use your Gmail connection.');
  check(row.shell === false, 'AI_SETTING_UNSUPPORTED', 'Shell access is not available for this AI driver yet.');
  for (const field of ['network', 'webSearch']) check(['off', 'research', 'on'].includes(row[field] as string), BAD, 'Choose when the AI may use the internet.');
  check(row.webSearch === 'off' || row.network === 'on' || row.webSearch === 'research' && row.network === 'research', BAD, 'Web search needs internet access for the same jobs.');
  check(!Object.hasOwn(row, 'fallbackModel') || name === 'claude' && typeof row.fallbackModel === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(row.fallbackModel), BAD, 'Enter an exact Claude fallback model, or switch fallback off.');
  return { quick: task(row.quick), main: task(row.main), network: row.network as AiNetwork, webSearch: row.webSearch as AiNetwork, shell: false, ...(Object.hasOwn(row, 'fallbackModel') ? { fallbackModel: row.fallbackModel as string } : {}), ...(Object.hasOwn(row, 'connectors') ? { connectors: row.connectors as boolean } : {}) };
}
export function validateAiSettings(raw: unknown): AiSettings {
  const row = exact(raw, ['codex', 'claude', 'autoReview', 'agentAutoReview', 'mcpServers'], ['planPause', 'offerWays']);
  check(!Object.hasOwn(row, 'offerWays') || typeof row.offerWays === 'boolean', BAD, 'Choose whether agents may offer ways of working.');
  check(!Object.hasOwn(row, 'planPause') || row.planPause === null || Number.isInteger(row.planPause) && (row.planPause as number) >= 50 && (row.planPause as number) <= 95, BAD, 'Choose a pause point from 50 to 95 percent, or none.');
  check(typeof row.autoReview === 'boolean', BAD, 'Choose whether the reviewer may approve routine steps.');
  check(row.agentAutoReview !== null && typeof row.agentAutoReview === 'object' && !Array.isArray(row.agentAutoReview) && Object.getPrototypeOf(row.agentAutoReview) === Object.prototype, BAD, 'Choose routine-step approval for each agent.');
  const agentAutoReview: Record<string, boolean> = {};
  for (const [id, value] of Object.entries(row.agentAutoReview)) {
    check(/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id) && !['constructor', 'prototype', '__proto__'].includes(id) && typeof value === 'boolean', BAD, 'Choose routine-step approval for a current agent.');
    agentAutoReview[id] = value;
  }
  return { codex: provider(row.codex, 'codex'), claude: provider(row.claude, 'claude'), autoReview: row.autoReview, agentAutoReview, mcpServers: validateExternalServers(row.mcpServers),
    ...(Object.hasOwn(row, 'planPause') ? { planPause: row.planPause as number | null } : {}),
    ...(Object.hasOwn(row, 'offerWays') ? { offerWays: row.offerWays as boolean } : {}) };
}
export function agentSettingsOf(state: State, ventureId: string): AiSettings {
  const venture = state.conversations.find(row => row?.kind === 'venture-record' && row.id === ventureId);
  check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
  return venture.aiSettings === undefined ? defaultAiSettings() : validateAiSettings(venture.aiSettings);
}
/** Research comes from the trusted playbook, never an instruction or claim in client content. */
export function driverSettingsFor(settings: AiSettings, name: AiProvider, kind: AiTask, agentId: string, research = false): AgentDriverSettings {
  const clean = validateAiSettings(settings), selected = clean[name];
  const enabled = (value: AiNetwork) => value === 'on' || value === 'research' && research;
  return { ...selected[kind], autoReview: Object.hasOwn(clean.agentAutoReview, agentId) ? clean.agentAutoReview[agentId]! : clean.autoReview,
    network: enabled(selected.network), webSearch: enabled(selected.webSearch), shell: false,
    ...(kind === 'main' && selected.fallbackModel ? { fallbackModel: selected.fallbackModel } : {}),
    // W6 6F5: the driver turns the connection on only with a plan login; a key route ignores it.
    ...(selected.connectors === true ? { connectors: true } : {}) };
}
