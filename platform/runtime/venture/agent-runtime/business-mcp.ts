/**
 * An owner-connected MCP server used for the business itself, with no client order (BusinessWorkScope, scope.ts).
 * Until now a connected tool was reachable only inside a job bound to an order and a client (external-mcp.ts), so it
 * could not help find a first customer. This is the same set of servers and the same rules (external-servers.ts,
 * mcp-policy.ts) under a scope of its own. Nothing here invents an order or a client.
 *
 * - The engine holds this, never an AI. It is opened for one piece of work the owner approved and closed after it.
 * - A tool on Chausar's checked read-only list may run. Every other call runs only with the owner's approval of
 *   exactly that call: the tool as it was described to them (its fingerprint) and the exact inputs (their digest).
 *   The approval is the caller's card (for finding customers, the proposal on Today); a changed tool or changed
 *   inputs are refused, so the owner is asked again.
 * - No client data exists in this scope. The handle has no way to read a client, an order or a file, and inputs
 *   that name one of the business's clients are refused before anything connects (CLIENT_AI_CONSENT_REQUIRED).
 * - A server's question for the owner has no card here, so the connection declares no way to ask one.
 * - A server whose own rules need an order (mcp-adapters.ts: Sunra's cost and rights card) is refused here.
 * - What a tool returns is data, never instructions; saved keys and sign-ins are cut out of it.
 */
import { ChausarError, check, type State } from '../../contracts.ts';
import { validateMCPArguments } from '../../mcp.ts';
import type { VentureDeps } from '../contracts.ts';
import { listRecords } from '../records.ts';
import type { BusinessCapability } from './scope.ts';
import type { ConnectOptions, ExternalClient, ExternalTool } from './external-client.ts';
import type { ExternalMcpServer } from './external-config.ts';
import { argumentsDigest, type CheckedEntry } from './mcp-policy.ts';
import { DEFAULT_MCP_ADAPTERS, type McpCallAdapter } from './mcp-adapters.ts';
import { openExternalServers } from './external-servers.ts';

export type BusinessMcpOptions = {
  signal: AbortSignal;
  connect?: (server: ExternalMcpServer, signal: AbortSignal, token?: string, options?: ConnectOptions) => Promise<ExternalClient>;
  /** Defaults to Chausar's CHECKED_READ_ONLY list. Tests pass a list for local samples. */
  checkedList?: readonly CheckedEntry[];
  /** The order-bound adapters whose servers are refused here. Defaults to DEFAULT_MCP_ADAPTERS. */
  orderAdapters?: readonly McpCallAdapter[];
};
export type BusinessToolApproval = 'checked-read-only' | 'every-call';
/** One tool as the owner's card describes it: what the approval is bound to. */
export type BusinessToolLook = {
  serverId: string; serverName: string; tool: string; description: string;
  fingerprint: string; argumentsDigest: string; approval: BusinessToolApproval;
};
/** What the owner approved: the tool's fingerprint and the digest of the exact inputs, as the card showed them. */
export type BusinessCallPin = Pick<BusinessToolLook, 'fingerprint' | 'argumentsDigest'>;
export type BusinessCallInput = { serverId: string; tool: string; arguments: Record<string, unknown> };
export type BusinessCallReady = {
  approval: 'checked-read-only' | 'owner-approved'; serverName: string; tool: ExternalTool;
  /** Sends the one call. A throw means no result came back: the service may still have acted, or charged. */
  send(): Promise<unknown>;
};
export type BusinessMcp = {
  servers(): { id: string; name: string }[];
  /** A server's tools by name, with whether each needs the owner's approval. Lists only; nothing is called. */
  tools(serverId: string): Promise<{ name: string; description: string; approval: BusinessToolApproval }[]>;
  look(input: BusinessCallInput): Promise<BusinessToolLook>;
  prepare(input: BusinessCallInput & { approved: BusinessCallPin | null }): Promise<BusinessCallReady>;
  close(): Promise<void>;
};

const edge = (text: string) => new RegExp(`(?<![\\p{L}\\p{N}])${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu');

/**
 * Refuses inputs that carry one of the business's clients: their name as a whole phrase, their email or their tax
 * number. Client data reaches a tool only inside that client's order, after their recorded consent; this scope has
 * neither, so it carries none.
 */
export function refuseClientData(state: State, ventureId: string, input: unknown): void {
  const text = JSON.stringify(input ?? null);
  for (const client of listRecords(state, 'venture-client', ventureId)) {
    if (client.self) continue;
    const held = [client.name.trim().length >= 3 ? client.name.trim() : '', client.email ?? '', client.taxId ?? ''].filter(Boolean);
    check(!held.some(value => edge(value).test(text)), 'CLIENT_AI_CONSENT_REQUIRED',
      `A search for the business carries no client's details. Take ${client.name} out of the tool's inputs.`);
  }
}

export function openBusinessMcp(deps: VentureDeps, capability: BusinessCapability, options: BusinessMcpOptions): BusinessMcp {
  const ventureId = capability.scope.ventureId;
  const orderAdapters = options.orderAdapters ?? DEFAULT_MCP_ADAPTERS;
  // No `elicit`: a server's question has no card in this scope, so the connection offers no way to ask one.
  const servers = openExternalServers(deps, ventureId, {
    signal: options.signal, guard: () => { capability.assert(); }, closedLine: 'This search is no longer running.',
    ...(options.connect ? { connect: options.connect } : {}), ...(options.checkedList ? { checkedList: options.checkedList } : {}),
  });
  function serverFor(id: unknown): ExternalMcpServer {
    const server = servers.configured(id);
    check(!orderAdapters.some(adapter => adapter.matches(server)), 'MCP_ORDER_ONLY', `${server.name} works only inside a client's order, where its cost and rights are checked.`);
    return server;
  }
  const approvalOf = (server: ExternalMcpServer, tool: ExternalTool): BusinessToolApproval => (servers.checked(server, tool) ? 'checked-read-only' : 'every-call');
  /** The exact tool and inputs, checked against the server as it is now. Calls nothing. */
  async function exact(input: BusinessCallInput): Promise<{ server: ExternalMcpServer; tool: ExternalTool; args: Record<string, unknown>; look: BusinessToolLook }> {
    servers.guard();
    refuseClientData(deps.store.read(), ventureId, input.arguments);
    const server = serverFor(input.serverId);
    const tool = (await servers.list(server)).find(item => item.name === input.tool);
    check(tool, 'MCP_TOOL_CHANGED', `${server.name} has no tool called ${input.tool} now. Choose one of its tools again.`);
    let args: Record<string, unknown>;
    try { args = validateMCPArguments(tool.inputSchema, input.arguments); }
    catch (error) { throw new ChausarError('INVALID_VENTURE_REQUEST', `These inputs do not fit ${tool.name}: ${error instanceof Error ? error.message : 'check them against the tool.'}`); }
    const look: BusinessToolLook = {
      serverId: server.id, serverName: server.name, tool: tool.name, description: String(servers.screened(tool.description ?? '')).slice(0, 2000),
      fingerprint: servers.fingerprint(server, tool), argumentsDigest: argumentsDigest(args), approval: approvalOf(server, tool),
    };
    return { server, tool, args, look };
  }
  return {
    servers: () => { servers.guard(); return servers.servers.map(({ id, name }) => ({ id, name })); },
    async tools(serverId) {
      const server = serverFor(serverId);
      return (await servers.list(server)).map(tool => ({ name: tool.name, description: String(servers.screened(tool.description ?? '')).slice(0, 2000), approval: approvalOf(server, tool) }));
    },
    look: async input => (await exact(input)).look,
    async prepare(input) {
      const { server, tool, args, look } = await exact(input);
      if (look.approval !== 'checked-read-only') {
        check(input.approved, 'MCP_APPROVAL_REQUIRED', 'This call needs your approval of exactly this tool and these inputs.');
        check(input.approved.fingerprint === look.fingerprint, 'MCP_TOOL_CHANGED', 'This tool changed since you approved it. Read its current description and approve again.');
        check(input.approved.argumentsDigest === look.argumentsDigest, 'MCP_ARGUMENTS_CHANGED', 'These inputs differ from the ones you approved. Approve again.');
      }
      return {
        approval: look.approval === 'checked-read-only' ? 'checked-read-only' : 'owner-approved', serverName: server.name, tool,
        async send() {
          servers.guard();
          let result: unknown;
          try { result = await servers.send(server, tool, args); }
          catch { throw new ChausarError('MCP_CONNECTION_FAILED', 'The call did not return a result. Check the service before repeating it; it may already have acted.'); }
          check(Buffer.byteLength(JSON.stringify(result ?? null)) <= 2 * 1024 * 1024, 'MCP_RESPONSE_INVALID', 'This tool returned too much data.');
          return servers.screened(result);
        },
      };
    },
    close: () => servers.close(),
  };
}
