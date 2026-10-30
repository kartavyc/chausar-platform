/** Official MCP transports. No shell, inherited application secrets, automatic auth or request replay. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { check } from '../../portable.ts';
import type { ExternalMcpServer } from './external-config.ts';

export type ExternalTool = { name: string; description?: string; inputSchema: Record<string, unknown>; annotations?: Record<string, unknown> };
export type ExternalClient = { list(signal: AbortSignal): Promise<ExternalTool[]>; call(name: string, input: Record<string, unknown>, signal: AbortSignal): Promise<unknown>; close(): Promise<void> };
export async function connectExternalClient(server: ExternalMcpServer, signal: AbortSignal, token?: string): Promise<ExternalClient> {
  const client = new Client({ name: 'chausar-owner-tools', version: '1.0.0' }, { capabilities: {} });
  const transport = server.transport === 'stdio'
    ? new StdioClientTransport({ command: server.command, args: server.args, env: token ? { MCP_AUTH_TOKEN: token } : {}, stderr: 'ignore', maxBufferSize: 2 * 1024 * 1024 })
    : new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { redirect: 'error', ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) },
      reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 } });
  const close = async () => { signal.removeEventListener('abort', aborted); await client.close(); };
  const aborted = () => { void close().catch(() => undefined); };
  signal.addEventListener('abort', aborted, { once: true });
  try {
    signal.throwIfAborted(); await client.connect(transport, { signal }); signal.throwIfAborted();
    return {
      async list(current) {
        const tools: ExternalTool[] = [], seen = new Set<string>(); let cursor: string | undefined;
        do {
          const page = await client.listTools(cursor ? { cursor } : {}, { signal: current });
          tools.push(...page.tools); cursor = page.nextCursor;
          check(!cursor || !seen.has(cursor), 'MCP_RESPONSE_INVALID', 'This server repeated its tool list.');
          if (cursor) seen.add(cursor);
          check(Buffer.byteLength(JSON.stringify(tools)) <= 2 * 1024 * 1024, 'MCP_RESPONSE_INVALID', 'This server returned too much tool metadata.');
        } while (cursor);
        return tools;
      },
      call: (name, input, current) => client.callTool({ name, arguments: input }, undefined, { signal: current }), close,
    };
  } catch (error) { await close().catch(() => undefined); throw error; }
}
