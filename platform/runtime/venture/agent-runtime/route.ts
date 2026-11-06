import { check, type Context } from '../../contracts.ts';
import type { VentureDeps } from '../contracts.ts';
import { listRecords, readVenture } from '../records.ts';
import { agentSettingsOf, driverSettingsFor } from './settings.ts';
import { createClaudeDriver } from './claude-driver.ts';
import { CodexDriver } from './codex-driver.ts';
import { locateOnThisComputer, startableProgram } from '../models/cli-look.ts';
import type { AgentRoute } from './route-types.ts';

/** Only trusted playbook metadata may enable research defaults, never words in a client's request. */
export async function selectAgentRoute(deps: VentureDeps, ctx: Context, agentId: string, research = false): Promise<AgentRoute> {
  if (deps.agentRoute) return deps.agentRoute(ctx, agentId);
  check(deps.host !== 'hosted-web', 'PRESET_UNAVAILABLE', 'Run your AI tools in the desktop app.');
  const { state, venture } = readVenture(deps, ctx);
  check(state.policy.send !== 'nothing', 'MODEL_SEND_BLOCKED', 'Allow your AI to receive work in privacy settings.');
  const serving = deps.models.status(ctx).tiers.main;
  check(serving.presetId !== 'built-in-templates', 'NO_MODEL_CONNECTED', 'Connect your AI first.');
  const provider = serving.presetId.startsWith('anthropic-') || serving.presetId === 'claude-code-cli' ? 'claude' : 'codex';
  check(provider !== 'claude' || deps.claudeCodeTerms !== 'pending', 'PRESET_UNAVAILABLE', 'Claude Code is switched off on this computer.');
  const settings = driverSettingsFor(agentSettingsOf(state, venture.id), provider, 'main', agentId, research);
  // A2: while the owner has not set the agent models, Codex's main work uses the model Codex's own list offers.
  if (provider === 'codex' && venture.aiSettings === undefined && serving.presetId === 'codex-cli' && deps.models.codexModels) settings.model = (await deps.models.codexModels()).main;
  const plan = serving.presetId === 'claude-code-cli' || serving.presetId === 'codex-cli';
  const connection = listRecords(state, 'venture-model-connection', venture.id).findLast(row => row.status === 'connected' && row.presetId === serving.presetId && row.tiers.includes('main'));
  check(plan || connection, 'MODEL_KEY_MISSING', 'Reconnect this AI before starting.');
  if (serving.presetId === 'openrouter') {
    check(connection!.model, 'SPEND_UNPRICED', 'Select the exact gateway model before starting.');
    settings.model = connection!.model;
  }
  const apiKey = plan ? null : deps.secrets.get(`model:${serving.presetId}`);
  check(plan || apiKey, 'MODEL_KEY_REQUIRED', 'Connect your AI key again before starting.');
  let driver;
  if (provider === 'claude') {
    const executable = locateOnThisComputer('claude');
    check(executable && startableProgram(executable), 'CLI_UNAVAILABLE', 'Install Claude Code on this computer, then try again.');
    driver = createClaudeDriver({ executable });
  } else {
    // A2 review: only the program of the Codex setup in use (bundled, or the one the owner chose), its digest checked
    // again now; with no setup in use the job is refused, never run on a Codex the search path happens to find.
    const executable = await deps.models.codexVerifiedProgram?.();
    check(executable, 'CODEX_SETUP_UNAVAILABLE', 'Choose the Codex Chausar found under Connect your AI first.');
    driver = new CodexDriver({ executable });
  }
  return { driver, settings, presetId: serving.presetId, ...(apiKey ? { credentials: { apiKey, ...(serving.presetId === 'openrouter' ? { baseUrl: 'https://openrouter.ai/api/v1' } : {}) },
    billing: { connectionId: connection!.id, presetId: connection!.presetId, model: settings.model } } : {}) };
}
