/**
 * The owner's saved MCP servers behind one set of rules, whichever scope uses them: a job for a client order
 * (external-mcp.ts) or work for the business itself (business-mcp.ts). This file connects, lists and sends; it never
 * decides that a call may run. Each scope adds its own approval on top.
 *
 * - The saved servers are read once. Any change to them ends this use (MCP_CONFIGURATION_CHANGED).
 * - Keys and sign-ins come from protected storage and are screened out of everything returned.
 * - stdio is desktop only. A server that can place broker orders is never used (W6 6E7, D49).
 * - A server's question for the owner goes to the scope's `elicit`; a scope with none declines every question.
 */
import { ChausarError, check, type State } from '../../contracts.ts';
import type { VentureDeps } from '../contracts.ts';
import { digest } from '../records.ts';
import { agentSettingsOf } from './settings.ts';
import { connectExternalClient, type ConnectOptions, type ExternalClient, type ExternalTool } from './external-client.ts';
import { validateExternalCredentialScope, type ExternalMcpServer } from './external-config.ts';
import { brokerOrderTool, refuseBrokerConnection } from '../policy/securities-guard.ts';
import { isCheckedReadOnly, CHECKED_READ_ONLY, type CheckedEntry } from './mcp-policy.ts';
import { jobOAuthProvider, oauthSecrets, type StoredOAuthProvider } from './mcp-oauth.ts';

export type ElicitReply = { action: 'accept'; content: Record<string, unknown> } | { action: 'decline' | 'cancel' };
export type ExternalServerOptions = {
  signal: AbortSignal;
  /** The scope's own check, run before and after every step: it is still live and still allowed. */
  guard(state: State): void;
  /** What a closed or stopped use says. */
  closedLine?: string;
  connect?: (server: ExternalMcpServer, signal: AbortSignal, token?: string, options?: ConnectOptions) => Promise<ExternalClient>;
  /** Defaults to Chausar's CHECKED_READ_ONLY list. Tests pass a list for local samples. */
  checkedList?: readonly CheckedEntry[];
  /** A server's question for the owner. Absent: every question is declined. */
  elicit?: (server: ExternalMcpServer, params: Record<string, unknown>, signal: AbortSignal) => Promise<ElicitReply>;
};
export type ExternalServers = {
  /** The saved servers as they were when this use began. */
  servers: readonly ExternalMcpServer[];
  guard(state?: State): void;
  configured(id: unknown): ExternalMcpServer;
  list(server: ExternalMcpServer): Promise<ExternalTool[]>;
  /** The digest of a tool's exact server, name, description and schema: a change to any of them changes it. */
  fingerprint(server: ExternalMcpServer, tool: ExternalTool): string;
  /** Whether Chausar's checked read-only list holds exactly this tool. A server's own hints never count. */
  checked(server: ExternalMcpServer, tool: ExternalTool): boolean;
  /** Sends one call as it is. A throw means no result came back, and the service may still have acted. */
  send(server: ExternalMcpServer, tool: ExternalTool, input: Record<string, unknown>): Promise<unknown>;
  secrets(): string[];
  /** A value with every saved key and sign-in cut out. */
  screened(value: unknown): unknown;
  closed(): boolean;
  close(): Promise<void>;
};

export function openExternalServers(deps: VentureDeps, ventureId: string, options: ExternalServerOptions): ExternalServers {
  const initial = agentSettingsOf(deps.store.read(), ventureId).mcpServers;
  validateExternalCredentialScope(initial, ventureId);
  const checkedList = options.checkedList ?? CHECKED_READ_ONLY;
  const configuration = digest(initial), clients = new Map<string, Promise<ExternalClient>>(), tokens = new Set<string>(), providers: StoredOAuthProvider[] = [];
  let closed = false;
  function guard(state = deps.store.read()) {
    check(!closed && !options.signal.aborted, 'JOB_CLOSED', options.closedLine ?? 'This job is no longer running.');
    options.guard(state);
    check(digest(agentSettingsOf(state, ventureId).mcpServers) === configuration, 'MCP_CONFIGURATION_CHANGED', 'External tool settings changed. Start a new job.');
  }
  const secrets = () => [...tokens, ...providers.flatMap(oauthSecrets)];
  function configured(id: unknown) { guard(); const server = initial.find(row => row.id === id); check(server, 'MCP_SERVER_NOT_FOUND', 'Choose a configured external tool server.'); return server; }
  async function client(server: ExternalMcpServer) {
    guard(); let pending = clients.get(server.id);
    if (!pending) {
      pending = (async () => {
        check(server.transport !== 'stdio' || deps.host === 'desktop' || deps.host === 'test', 'MCP_STDIO_DESKTOP_ONLY', 'Local program servers run only in the desktop app.');
        let token: string | undefined, authProvider: StoredOAuthProvider | undefined;
        if (server.transport === 'http' && server.oauth) {
          authProvider = await jobOAuthProvider(deps, deps.store.read().workspace.id, server); guard(); providers.push(authProvider);
        } else if (server.credentialRef) {
          check(deps.credentials, 'CREDENTIAL_UNAVAILABLE', 'Protected key storage is unavailable on this computer.');
          token = await deps.credentials.get(deps.store.read().workspace.id, server.credentialRef) ?? undefined;
          guard(); check(token, 'CREDENTIAL_UNAVAILABLE', 'Save this server’s token again before using it.'); tokens.add(token);
        }
        // With no `elicit` the client declares no elicitation support at all, so a server cannot even ask.
        const elicit = options.elicit;
        try { return await (options.connect ?? connectExternalClient)(server, options.signal, token, { ...(authProvider ? { authProvider } : {}), ...(elicit ? { elicit: ((params: unknown, signal: AbortSignal) => elicit(server, params as Record<string, unknown>, signal)) as unknown as NonNullable<ConnectOptions['elicit']> } : {}) }); }
        catch (error) { guard(); if (error instanceof ChausarError && error.code === 'MCP_SIGN_IN_REQUIRED') throw error; throw new ChausarError('MCP_CONNECTION_FAILED', 'The external tool server could not connect. Check its saved configuration.'); }
      })(); clients.set(server.id, pending);
      pending.catch(() => { if (clients.get(server.id) === pending) clients.delete(server.id); });
    }
    const result = await pending; guard(); return result;
  }
  async function list(server: ExternalMcpServer) {
    const connection = await client(server);
    let result: ExternalTool[];
    try { result = await connection.list(options.signal); } catch { guard(); throw new ChausarError('MCP_CONNECTION_FAILED', 'The external server could not list its tools.'); }
    guard();
    check(result.every(tool => typeof tool.name === 'string' && tool.name.length > 0 && tool.inputSchema?.type === 'object') && new Set(result.map(tool => tool.name)).size === result.length,
      'MCP_RESPONSE_INVALID', 'This server returned an invalid tool list.');
    // W6 6E7 (D49): a server that can place, change or cancel broker orders is never used, whatever the owner approves.
    if (result.some(brokerOrderTool)) refuseBrokerConnection('This external server');
    return result;
  }
  const fingerprint = (server: ExternalMcpServer, tool: ExternalTool) => digest({ server, tool });
  function screened(value: unknown): unknown {
    if (typeof value === 'string') { let text = value; for (const token of secrets()) text = text.split(token).join('[redacted secret]'); return text; }
    if (Array.isArray(value)) return value.map(screened);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [screened(key) as string, screened(child)]));
    return value;
  }
  return {
    servers: initial, guard, configured, list, fingerprint, secrets, screened,
    checked: (server, tool) => isCheckedReadOnly(server, tool, checkedList),
    send: async (server, tool, input) => (await client(server)).call(tool.name, input, options.signal),
    closed: () => closed,
    async close() { closed = true; await Promise.allSettled([...clients.values()].map(async pending => { await (await pending).close(); })); clients.clear(); tokens.clear(); providers.length = 0; },
  };
}
