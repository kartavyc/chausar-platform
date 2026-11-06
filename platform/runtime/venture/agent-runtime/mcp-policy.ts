import { sha256Hex } from '../../hash.ts';
/**
 * W6 6F1 (D30): what an outside MCP tool may do without the owner, decided by Chausar and never by the server.
 *
 * - Chausar's checked list names the read-only tools it has reviewed, pinned to the exact tool name, description and
 *   input fields. A server's own readOnlyHint never grants anything. A changed description or field list drops the
 *   tool off the list, so it asks again.
 * - Every other call is bound to a digest of its exact arguments before the owner sees the card.
 * - Large tool sets sit behind a search: the AI sees a count and searches by words instead of reading every schema.
 */

import { canonical } from '../../portable.ts';
import type { ExternalMcpServer } from './external-config.ts';
import type { ExternalTool } from './external-client.ts';

/**
 * How one reviewed server is recognised: its exact HTTPS address, the npm package npx runs, or (for local samples)
 * an exact program and arguments.
 */
export type CheckedServer = { url: string } | { npmPackage: string } | { stdio: { command: string; args: readonly string[] } };
/**
 * One reviewed read-only tool. properties are the input field names, sorted. The description is pinned as its exact
 * text, or for a long one as the sha256 of its exact text.
 */
export type CheckedTool = { tool: string; properties: readonly string[] } & ({ description: string } | { descriptionSha256: string });
export type CheckedEntry = { server: CheckedServer; checkedOn: string; tools: readonly CheckedTool[] };

/**
 * Reviewed read-only tools. Each one reads public or owner data and has no outside effect. Descriptions are copied
 * exactly from the server's own tool list on the day checked, so any change asks again.
 */
export const CHECKED_READ_ONLY: readonly CheckedEntry[] = Object.freeze([
  // Read by a live call on 1 November 2026 (results/w6-6F1-live.json); each tool searches or reads public Microsoft docs.
  { server: { url: 'https://learn.microsoft.com/api/mcp' }, checkedOn: '2026-11-01', tools: [
    { tool: 'microsoft_docs_search', descriptionSha256: 'a35c2251683a3a4bd9c49290806cac7bd978336a9e86528a21ee5431de1a20a6', properties: ['query'] },
    { tool: 'microsoft_code_sample_search', descriptionSha256: '07f556ec6242f1aebe1f68f8a91a86d638554841209e7eed40faa9c9c590abf7', properties: ['language', 'query'] },
    { tool: 'microsoft_docs_fetch', descriptionSha256: '3c07322913d73c6c65c723ff04b98fbe932e27883673fd02fede6bec441cf91e', properties: ['url'] },
  ] },
  { server: { npmPackage: '@sunra/mcp-server' }, checkedOn: '2026-11-01', tools: [
    { tool: 'status', description: 'Check the status of a request in the Sunra queue', properties: ['logs', 'requestId'] },
    { tool: 'result', description: 'Retrieve the result of a completed request from the Sunra queue', properties: ['requestId'] },
    { tool: 'list-models', description: 'List all available AI models from the Sunra API', properties: ['limit'] },
    { tool: 'search-models', description: 'Search for AI models by keywords in their names, descriptions, or aliases', properties: ['keywords', 'limit'] },
    { tool: 'model-schema', description: 'Get the input and output JSON schemas for a specific AI model endpoint from its OpenAPI specification', properties: ['modelSlug'] },
  ] },
] satisfies CheckedEntry[]);

/**
 * The npm package npx runs: the command is npx (or npx.cmd), and the first argument that is not a flag is the package,
 * as in `npx -y @sunra/mcp-server@0.1.2`. Anything else is not recognised as that package.
 */
export function npmPackageOf(server: ExternalMcpServer): string | null {
  if (server.transport !== 'stdio' || !/(^|[\\/])npx(\.cmd|\.exe)?$/i.test(server.command)) return null;
  const first = server.args.find(arg => !arg.startsWith('-'));
  const match = first ? /^(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:@[0-9A-Za-z.+-]+)?$/.exec(first) : null;
  return match ? match[1]! : null;
}
function serverMatches(entry: CheckedServer, server: ExternalMcpServer): boolean {
  if ('url' in entry) return server.transport === 'http' && server.url === entry.url;
  if ('stdio' in entry) return server.transport === 'stdio' && server.command === entry.stdio.command && canonical(server.args) === canonical(entry.stdio.args);
  return npmPackageOf(server) === entry.npmPackage;
}
function propertiesOf(tool: Pick<ExternalTool, 'inputSchema'>): string[] {
  const properties = tool.inputSchema?.properties;
  return properties && typeof properties === 'object' && !Array.isArray(properties) ? Object.keys(properties).sort() : [];
}
/** True only when this exact server, tool name, description and field list are on Chausar's checked list. */
export function isCheckedReadOnly(server: ExternalMcpServer, tool: ExternalTool, list: readonly CheckedEntry[] = CHECKED_READ_ONLY): boolean {
  const fields = canonical(propertiesOf(tool));
  const text = tool.description ?? '', sha = sha256Hex(text);
  return list.some(entry => serverMatches(entry.server, server) && entry.tools.some(item =>
    item.tool === tool.name && ('description' in item ? item.description === text : item.descriptionSha256 === sha) && canonical([...item.properties].sort()) === fields));
}

/** sha256 of the canonical JSON of the exact arguments. The approval card and the dispatch both carry it. */
export function argumentsDigest(input: unknown): string {
  return sha256Hex(canonical(input));
}

/** Above this many tools, a listing without search words returns only the count. */
export const TOOL_SEARCH_THRESHOLD = 40;
/** At most this many tools come back from one search. */
export const TOOL_SEARCH_LIMIT = 20;
const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/**
 * Rank tools by how many search words appear in the name (counted twice) and description. Ties keep the server's
 * order. A small set with no words comes back whole; a large set with no words comes back empty with its count.
 */
export function searchTools(tools: readonly ExternalTool[], query: string, limit = TOOL_SEARCH_LIMIT): { total: number; tools: ExternalTool[]; narrowed: boolean } {
  const terms = words(query);
  if (!terms.length) return tools.length > TOOL_SEARCH_THRESHOLD ? { total: tools.length, tools: [], narrowed: true } : { total: tools.length, tools: [...tools], narrowed: false };
  const scored = tools.map((tool, index) => {
    const name = words(tool.name), about = words(tool.description ?? '');
    const score = terms.reduce((sum, term) => sum + (name.some(word => word.includes(term)) ? 2 : 0) + (about.some(word => word.includes(term)) ? 1 : 0), 0);
    return { tool, index, score };
  }).filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  return { total: tools.length, tools: scored.slice(0, limit).map(row => row.tool), narrowed: scored.length > limit };
}
