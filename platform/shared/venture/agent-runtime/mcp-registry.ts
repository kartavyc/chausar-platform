/**
 * W6 6F1 (D30): a small curated list of MCP servers, each copied from the official MCP registry
 * (registry.modelcontextprotocol.io, the latest version on the day checked). Browser-safe data: the app and the fake
 * engine read the same list. Adding one only fills the server form; saving it still needs the owner's exact approval,
 * and every call that is not on Chausar's checked read-only list still asks.
 */
import { check } from '../../portable.ts';
import type { ExternalMcpServer } from './external-config.ts';

export type CuratedMcpServer = {
  id: string; name: string; about: string;
  /** The server's name and version in the official registry. */
  registryName: string; registryVersion: string; checkedOn: string;
  /** How the owner connects: nothing, the service's own sign-in, or their own key saved to protected storage. */
  signIn: 'none' | 'oauth' | 'key';
  /** What its tools can do: only read, or also change things in the service (every such call asks). */
  access: 'read' | 'write';
  server: ExternalMcpServer;
};
export type CuratedMcpView = { source: 'https://registry.modelcontextprotocol.io'; checkedOn: string; servers: CuratedMcpServer[] };

const CHECKED = '2026-11-01';
export const CURATED_MCP_SERVERS: readonly CuratedMcpServer[] = Object.freeze([
  { id: 'microsoft-learn', name: 'Microsoft Learn', about: 'Search and read official Microsoft documentation.', registryName: 'com.microsoft/microsoft-learn-mcp', registryVersion: '1.0.0',
    checkedOn: CHECKED, signIn: 'none', access: 'read', server: { id: 'microsoft-learn', name: 'Microsoft Learn', transport: 'http', url: 'https://learn.microsoft.com/api/mcp' } },
  { id: 'notion', name: 'Notion', about: 'Read and update pages in your own Notion workspace.', registryName: 'com.notion/mcp', registryVersion: '1.0.1',
    checkedOn: CHECKED, signIn: 'oauth', access: 'write', server: { id: 'notion', name: 'Notion', transport: 'http', url: 'https://mcp.notion.com/mcp', oauth: true } },
  { id: 'canva', name: 'Canva', about: 'Find, make and export designs in your own Canva account.', registryName: 'com.canva.mcp/mcp', registryVersion: '1.0.0',
    checkedOn: CHECKED, signIn: 'oauth', access: 'write', server: { id: 'canva', name: 'Canva', transport: 'http', url: 'https://mcp.canva.com/mcp', oauth: true } },
  { id: 'linear', name: 'Linear', about: 'Find and update issues and projects in your Linear workspace.', registryName: 'app.linear/linear', registryVersion: '1.0.2',
    checkedOn: CHECKED, signIn: 'oauth', access: 'write', server: { id: 'linear', name: 'Linear', transport: 'http', url: 'https://mcp.linear.app/mcp', oauth: true } },
  { id: 'zapier', name: 'Zapier', about: 'Reach the apps you connected in your own Zapier account.', registryName: 'com.zapier/mcp', registryVersion: '1.0.1',
    checkedOn: CHECKED, signIn: 'oauth', access: 'write', server: { id: 'zapier', name: 'Zapier', transport: 'http', url: 'https://mcp.zapier.com/api/v1/connect', oauth: true } },
] satisfies CuratedMcpServer[]);

export function listCuratedMcpServers(): CuratedMcpView {
  return structuredClone({ source: 'https://registry.modelcontextprotocol.io' as const, checkedOn: CHECKED, servers: [...CURATED_MCP_SERVERS] });
}
/** venture.mcpRegistry.list {} (read): the curated list. Nothing is saved or connected by reading it. */
export function curatedMcpRequest(raw: unknown): CuratedMcpView {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0, 'INVALID_VENTURE_REQUEST', 'Send an empty request.');
  return listCuratedMcpServers();
}
