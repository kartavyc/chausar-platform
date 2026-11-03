import { AI_SETTING_BOUNDARIES, defaultAiSettings, validateAiSettings, type AiSettings, type AiSettingsView } from '../../../../platform/runtime/venture/agent-runtime/settings';
import { EngineError } from './types';
import { validateExternalCredentialScope } from '../../../../platform/runtime/venture/agent-runtime/external-config';
import { listCuratedMcpServers, type CuratedMcpView } from '../../../../platform/runtime/venture/agent-runtime/mcp-registry';

type Host = { current(): string; exists(): boolean; agents(): { id: string; name: string }[]; changed(): void };
export class FakeAgentSettings {
  private saved = new Map<string, AiSettings>();
  private host: Host;
  constructor(host: Host) { this.host = host; }
  request(method: string, raw: unknown): AiSettingsView {
    if (!this.host.exists()) throw new EngineError('VENTURE_NOT_FOUND', 'Start a business first.');
    const keys = method === 'venture.agentSettings.set' ? ['settings', 'approveMcpConfiguration'] : [];
    const required = method === 'venture.agentSettings.set' ? ['settings'] : [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send one request object.');
    const p = raw as Record<string, unknown>;
    if (Object.keys(p).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(p, key))) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
    const agents = this.host.agents();
    if (method === 'venture.agentSettings.set') {
      if (p.approveMcpConfiguration !== undefined && p.approveMcpConfiguration !== true) throw new EngineError('INVALID_VENTURE_REQUEST', 'Confirm this exact external tool configuration.');
      let settings: AiSettings;
      try { settings = validateAiSettings(p.settings); validateExternalCredentialScope(settings.mcpServers, `venture_${this.host.current()}`); } catch (error) { const known = error as { code: string; message: string }; throw new EngineError(known.code, known.message); }
      if (Object.keys(settings.agentAutoReview).some(id => !agents.some(agent => agent.id === id))) throw new EngineError('AGENT_NOT_FOUND', 'Choose an agent from this business.');
      const current = this.saved.get(this.host.current()) ?? defaultAiSettings();
      if (JSON.stringify(current.mcpServers) !== JSON.stringify(settings.mcpServers) && p.approveMcpConfiguration !== true) throw new EngineError('MCP_CONFIGURATION_APPROVAL_REQUIRED', 'Review and approve this exact external tool configuration before saving.');
      this.saved.set(this.host.current(), settings); this.host.changed();
    }
    return structuredClone({ settings: this.saved.get(this.host.current()) ?? defaultAiSettings(), boundaries: AI_SETTING_BOUNDARIES, agents });
  }
  credential(raw: unknown): { serverId: string; saved: boolean } {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype,null].includes(Object.getPrototypeOf(raw))) throw new EngineError('INVALID_VENTURE_REQUEST','Send one request object.');
    const p = raw as Record<string, unknown>;
    if (Object.keys(p).some(key => !['serverId','token'].includes(key)) || !Object.hasOwn(p,'serverId') || !Object.hasOwn(p,'token') || typeof p.serverId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(p.serverId)
      || !(p.token === null || typeof p.token === 'string' && p.token.length > 0 && new TextEncoder().encode(p.token).length <= 16384 && !/[\u0000-\u001f\u007f]/.test(p.token))) throw new EngineError('INVALID_VENTURE_REQUEST','Enter a token without line breaks, or remove the saved token.');
    if (!this.host.exists()) throw new EngineError('VENTURE_NOT_FOUND','Start a business first.');
    const settings = this.saved.get(this.host.current()) ?? defaultAiSettings();
    if (!settings.mcpServers.some(server => server.id === p.serverId)) throw new EngineError('MCP_SERVER_NOT_FOUND','Save this server configuration first.');
    // The browser demo has no OS credential shelf and must never pretend a token was protected.
    throw new EngineError('CREDENTIAL_UNAVAILABLE','Protected key storage is unavailable on this computer.');
  }
  /** W6 6F1: venture.mcpOAuth.start answers as the engine does up to protected storage, which the demo does not have. */
  oauth(raw: unknown): never {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype,null].includes(Object.getPrototypeOf(raw))) throw new EngineError('INVALID_VENTURE_REQUEST','Send one request object.');
    const p = raw as Record<string, unknown>;
    if (Object.keys(p).some(key => key !== 'serverId') || !Object.hasOwn(p,'serverId')) throw new EngineError('INVALID_VENTURE_REQUEST','Send the required fields and nothing else.');
    if (typeof p.serverId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(p.serverId)) throw new EngineError('INVALID_VENTURE_REQUEST','Choose a configured server.');
    if (!this.host.exists()) throw new EngineError('VENTURE_NOT_FOUND','Start a business first.');
    const server = (this.saved.get(this.host.current()) ?? defaultAiSettings()).mcpServers.find(row => row.id === p.serverId);
    if (!server) throw new EngineError('MCP_SERVER_NOT_FOUND','Save this server configuration first.');
    if (server.transport !== 'http' || !server.oauth) throw new EngineError('MCP_OAUTH_NOT_SET','Turn on sign-in for this server and save it first.');
    throw new EngineError('CREDENTIAL_UNAVAILABLE','Protected key storage is unavailable on this computer.');
  }
  /** W6 6F1: venture.mcpRegistry.list, the same curated list the engine reads. */
  registry(raw: unknown): CuratedMcpView {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length) throw new EngineError('INVALID_VENTURE_REQUEST','Send an empty request.');
    if (!this.host.exists()) throw new EngineError('VENTURE_NOT_FOUND','Start a business first.');
    return listCuratedMcpServers();
  }
}
