import { rememberAiSetup } from '../models/ai-setup.ts';
import { check, type Context, type State } from '../../contracts.ts';
import type { VentureDeps, VentureRecord } from '../contracts.ts';
import { digest, exactPayload, readVenture, requireAppChannel, ventureAction } from '../records.ts';
import { recordDecision } from '../journal/decisions.ts';
import { validateExternalCredentialScope } from './external-config.ts';
import { teamRoles } from '../models/roles.ts';
import { AI_SETTING_BOUNDARIES, agentSettingsOf, validateAiSettings, type AiSettingsView } from './settings.ts';

function view(state: State, venture: VentureRecord): AiSettingsView {
  return { settings: agentSettingsOf(state, venture.id), boundaries: { ...AI_SETTING_BOUNDARIES }, agents: teamRoles(state, venture).map(({ agent, name }) => ({ id: agent, name })) };
}
export async function getAgentSettings(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AiSettingsView> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  return view(state, venture);
}
export async function setAgentSettings(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AiSettingsView> {
  requireAppChannel(ctx, 'venture.agentSettings.set');
  const body = exactPayload(payload, ['settings', 'approveMcpConfiguration'], ['settings']);
  check(body.approveMcpConfiguration === undefined || body.approveMcpConfiguration === true, 'INVALID_VENTURE_REQUEST', 'Confirm this exact external tool configuration.');
  const settings = validateAiSettings(body.settings);
  const saved = await ventureAction(deps, ctx, 'approve', 'agentSettings.set', tx => {
    check(tx.venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
    validateExternalCredentialScope(settings.mcpServers, tx.venture.id);
    const agents = teamRoles(tx.state, tx.venture);
    check(Object.keys(settings.agentAutoReview).every(id => agents.some(agent => agent.agent === id)), 'AGENT_NOT_FOUND', 'Choose an agent from this business.');
    const changed = digest(agentSettingsOf(tx.state, tx.venture.id).mcpServers) !== digest(settings.mcpServers);
    check(!changed || body.approveMcpConfiguration === true, 'MCP_CONFIGURATION_APPROVAL_REQUIRED', 'Review and approve this exact external tool configuration before saving.');
    if (changed) recordDecision(tx, { subject: `mcp-configuration:${digest(settings.mcpServers)}`, action: 'approve', ruleId: null, reason: 'Approved this exact external tool configuration for future jobs. Every external tool call still asks.', rowId: null });
    const previous=agentSettingsOf(tx.state,tx.venture.id),aiNetworkRevision={...tx.venture.aiNetworkRevision};
    for(const provider of ['codex','claude'] as const)if(previous[provider].network!==settings[provider].network)aiNetworkRevision[provider]=(aiNetworkRevision[provider]??0)+1;
    const venture = tx.touch({ aiSettings: settings, aiNetworkRevision });
    tx.emit('queue.changed', {});
    return view(tx.state, venture);
  });
  // A4 fix round: the agents' models are part of the AI setup a gallery business may reuse.
  await rememberAiSetup(deps);
  return saved;
}
