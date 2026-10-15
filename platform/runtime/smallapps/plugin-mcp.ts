/**
 * Speaking MCP to a remote MCP server, through the plugin network door (plugin-network.ts `sendOnce`).
 *
 * Streamable HTTP, checked against the specification at modelcontextprotocol.io on 2026-10-15:
 * - 2026-07-28 (current, "modern"): no handshake and no session. Each JSON-RPC request is one HTTPS POST to the
 *   MCP endpoint, carrying `_meta` (`io.modelcontextprotocol/protocolVersion`, `…/clientInfo`,
 *   `…/clientCapabilities`) and the mirrored headers `MCP-Protocol-Version`, `Mcp-Method` and, for `tools/call`,
 *   `Mcp-Name`. An unsupported version is a 400 with JSON-RPC error -32022.
 * - 2025-11-25 and 2025-06-18 ("legacy"): `initialize` → `notifications/initialized` (answered 202) → the call,
 *   with the server-assigned `Mcp-Session-Id` and the `MCP-Protocol-Version` header on every request after
 *   `initialize`.
 * Both accept a reply as `application/json` or as a `text/event-stream` carrying the response.
 *
 * The era is fixed when the server is wrapped (it is part of the signed plugin), never discovered by trial: a
 * fallback would send requests nobody approved. Every request body is decided before approval, so the approval
 * names each request that will be sent; only the session number the server hands back is filled in later.
 * Answers are untrusted data: tool content is quoted, never followed.
 */
import { createHash } from 'node:crypto';
import { ChausarError, check } from '../contracts.ts';
import { canonical } from '../actions.ts';
import { sendOnce } from './plugin-network.ts';
import type { CredentialBroker, Fetched, Sent, Transport } from './plugin-network.ts';

export const MCP_MODERN = '2026-07-28';
export const MCP_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18'] as const;
export type McpVersion = typeof MCP_VERSIONS[number];
export type McpEndpoint = { site: string; path: string; protocolVersion: McpVersion; maxResponseBytes: number; timeoutMs: number };
export type McpRpc = 'initialize' | 'notifications/initialized' | 'tools/call' | 'tools/list';
/** One request of an exchange: its exact body and fixed headers. `session` adds the server's session number, if it gave one. */
export type McpStep = { rpc: McpRpc; id: number | null; body: string; headers: Record<string, string>; session: boolean };

export const MCP_LIMITS = { response: 256 * 1024, minTimeout: 100, maxTimeout: 30_000, defaultResponse: 64 * 1024, defaultTimeout: 10_000, session: 256, content: 32 };
export const CLIENT_INFO = { name: 'chausar', version: '1.0.0' };
const SITE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const PATH = /^\/[A-Za-z0-9\-._~/]{0,255}$/;
const ACCEPT = 'application/json, text/event-stream';
const plain = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const isLegacy = (version: McpVersion) => version !== MCP_MODERN;

/** Structural check of a recorded endpoint. Returns false rather than throwing so files can still be inspected. */
export function endpointShapeValid(value: unknown): value is McpEndpoint {
  if (!plain(value) || Object.keys(value).sort().join() !== 'maxResponseBytes,path,protocolVersion,site,timeoutMs') return false;
  return typeof value.site === 'string' && SITE.test(value.site) && typeof value.path === 'string' && PATH.test(value.path) && !value.path.split('/').some((part: string) => part === '.' || part === '..')
    && MCP_VERSIONS.includes(value.protocolVersion) && Number.isSafeInteger(value.maxResponseBytes) && value.maxResponseBytes > 0 && value.maxResponseBytes <= MCP_LIMITS.response
    && Number.isSafeInteger(value.timeoutMs) && value.timeoutMs >= MCP_LIMITS.minTimeout && value.timeoutMs <= MCP_LIMITS.maxTimeout;
}

/** `pluginWrap`'s `remote`: `{ endpoint: 'https://site/path', protocolVersion?, maxResponseBytes?, timeoutMs? }`. */
export function parseRemote(input: unknown): McpEndpoint {
  check(plain(input) && Object.keys(input).every(key => ['endpoint', 'protocolVersion', 'maxResponseBytes', 'timeoutMs'].includes(key)) && typeof input.endpoint === 'string' && input.endpoint.length <= 600, 'PLUGIN_MCP_INVALID', 'A remote MCP server is an https endpoint with an optional protocol version and limits.');
  let url: URL | null = null; try { url = new URL(input.endpoint); } catch { url = null; }
  check(url && url.protocol === 'https:' && url.port === '' && !url.username && !url.password && !url.search && !url.hash && `https://${url.hostname}${url.pathname}` === input.endpoint, 'PLUGIN_MCP_INVALID', 'The MCP endpoint is an exact https address on a named site, with no port, query or fragment.');
  const endpoint = { site: url.hostname, path: url.pathname, protocolVersion: input.protocolVersion ?? MCP_MODERN, maxResponseBytes: input.maxResponseBytes ?? MCP_LIMITS.defaultResponse, timeoutMs: input.timeoutMs ?? MCP_LIMITS.defaultTimeout };
  check(endpointShapeValid(endpoint), MCP_VERSIONS.includes(endpoint.protocolVersion) ? 'PLUGIN_MCP_INVALID' : 'PLUGIN_MCP_VERSION_UNSUPPORTED', MCP_VERSIONS.includes(endpoint.protocolVersion) ? 'The MCP endpoint, its size limit or its time limit is outside what Chausar allows.' : 'Chausar speaks MCP 2026-07-28, 2025-11-25 or 2025-06-18.');
  return endpoint;
}

export function endpointUrl(endpoint: McpEndpoint): URL {
  const url = new URL(`https://${endpoint.site}${endpoint.path}`);
  check(url.hostname === endpoint.site && url.pathname === endpoint.path && !url.search && url.port === '', 'PLUGIN_REQUEST_INVALID', 'The MCP endpoint would be changed on the way out.');
  return url;
}

const meta = (version: McpVersion) => ({ 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': CLIENT_INFO, 'io.modelcontextprotocol/protocolVersion': version });
const rpc = (id: number | null, method: string, params?: Record<string, unknown>) => canonical({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) });

/** Every request of one exchange, in order: a tool call (`call`) or a tools list (`call: null`). Nothing is sent. */
export function mcpExchange(endpoint: McpEndpoint, call: { tool: string; arguments: Record<string, unknown> } | null): McpStep[] {
  const version = endpoint.protocolVersion; const method = call ? 'tools/call' : 'tools/list';
  if (!isLegacy(version)) {
    const params = call ? { name: call.tool, arguments: call.arguments, _meta: meta(version) } : { _meta: meta(version) };
    return [{ rpc: method, id: 1, body: rpc(1, method, params), headers: { accept: ACCEPT, 'mcp-protocol-version': version, 'mcp-method': method, ...(call ? { 'mcp-name': call.tool } : {}) }, session: false }];
  }
  const after = { accept: ACCEPT, 'mcp-protocol-version': version };
  return [
    { rpc: 'initialize', id: 1, body: rpc(1, 'initialize', { capabilities: {}, clientInfo: CLIENT_INFO, protocolVersion: version }), headers: { accept: ACCEPT }, session: false },
    { rpc: 'notifications/initialized', id: null, body: rpc(null, 'notifications/initialized'), headers: after, session: true },
    { rpc: method, id: 2, body: rpc(2, method, call ? { name: call.tool, arguments: call.arguments } : {}), headers: after, session: true },
  ];
}
export const stepDigest = (step: McpStep) => createHash('sha256').update(step.body, 'utf8').digest('hex');

const fail = (code: string, message: string) => new ChausarError(code, message);
/** The JSON-RPC response with this id, from a JSON body or a `text/event-stream`; server notifications are skipped. */
export function readReply(fetched: Pick<Fetched, 'contentType' | 'text'>, id: number): Record<string, any> {
  const type = (fetched.contentType ?? '').split(';')[0].trim().toLowerCase();
  const messages: unknown[] = [];
  const parse = (text: string) => { try { return JSON.parse(text); } catch { throw fail('PLUGIN_MCP_REPLY_INVALID', 'The MCP server gave an answer that is not JSON-RPC.'); } };
  if (type === 'application/json') messages.push(parse(fetched.text));
  else if (type === 'text/event-stream') {
    for (const event of fetched.text.replace(/\r\n?/g, '\n').split(/\n\n+/)) {
      const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, ''));
      if (data.length) messages.push(parse(data.join('\n')));
    }
  } else throw fail('PLUGIN_MCP_REPLY_INVALID', 'The MCP server answered with a content type MCP does not use.');
  const reply = messages.flat().find((message): message is Record<string, any> => plain(message) && message.jsonrpc === '2.0' && message.id === id && !Object.hasOwn(message, 'method') && (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error')));
  check(reply, 'PLUGIN_MCP_REPLY_INVALID', 'The MCP server did not answer this request.');
  return reply;
}

/** Error codes a 2026-07-28 server uses; any other 4xx to a modern request means the server is from an earlier era. */
const MODERN_ERRORS = new Set([-32022, -32021, -32020, -32601, -32602, -32600, -32603]);
function errorOf(fetched: Fetched): number | null {
  try { const body = JSON.parse(fetched.text); return plain(body) && plain(body.error) && Number.isInteger(body.error.code) ? body.error.code : null; } catch { return null; }
}

export type ExchangeOutcome = { sent: (Sent & { rpc: McpRpc })[]; result?: Record<string, any>; error?: ChausarError };
/**
 * Send an approved exchange once, step by step. A step that fails stops the exchange: nothing after it is sent.
 * Nothing is retried, no version is renegotiated and no request outside the approved list is ever made.
 */
export async function runExchange(input: { endpoint: McpEndpoint; steps: McpStep[]; plugin: string; keyId: string | null; approvedSites: readonly string[]; transport: Transport; credentials: CredentialBroker | null; expectCredential: boolean[] }): Promise<ExchangeOutcome> {
  const { endpoint } = input; const url = endpointUrl(endpoint); const sent: ExchangeOutcome['sent'] = []; let session: string | null = null;
  for (const [index, step] of input.steps.entries()) {
    const headers = { ...step.headers, ...(step.session && session ? { 'mcp-session-id': session } : {}) };
    const outcome = await sendOnce({ site: endpoint.site, method: 'POST', url, headers, body: step.body, timeoutMs: endpoint.timeoutMs, maxResponseBytes: endpoint.maxResponseBytes, plugin: input.plugin, keyId: input.keyId, approvedSites: input.approvedSites, transport: input.transport, credentials: input.credentials, expectCredential: input.expectCredential[index] });
    sent.push({ ...outcome, rpc: step.rpc });
    if (outcome.error) return { sent, error: outcome.error };
    const fetched = outcome.fetched!; const { status } = fetched;
    if (isLegacy(endpoint.protocolVersion) && status === 404 && step.session && session) return { sent, error: fail('PLUGIN_MCP_SESSION_ENDED', 'The MCP server ended the session. Nothing more was sent; prepare the request again.') };
    if (step.id === null) { if (status < 200 || status > 299) return { sent, error: fail('PLUGIN_MCP_ERROR', 'The MCP server did not accept the start of the session.') }; continue; }
    if (status === 400 || status === 404 || status === 405) {
      const code = errorOf(fetched);
      if (code === -32022) return { sent, error: fail('PLUGIN_MCP_VERSION_UNSUPPORTED', 'The MCP server does not speak the protocol version this plugin was wrapped for. Wrap it again for a version it supports.') };
      if (!isLegacy(endpoint.protocolVersion) && (code === null || !MODERN_ERRORS.has(code))) return { sent, error: fail('PLUGIN_MCP_LEGACY_SERVER', 'The MCP server speaks an earlier MCP version. Wrap it again with protocol version 2025-11-25.') };
    }
    if (status < 200 || status > 299) return { sent, error: fail('PLUGIN_MCP_ERROR', 'The MCP server refused the request.') };
    let reply: Record<string, any>;
    try { reply = readReply(fetched, step.id); } catch (error) { return { sent, error: error as ChausarError }; }
    if (reply.error !== undefined) return { sent, error: plain(reply.error) && reply.error.code === -32022 ? fail('PLUGIN_MCP_VERSION_UNSUPPORTED', 'The MCP server does not speak the protocol version this plugin was wrapped for.') : fail('PLUGIN_MCP_ERROR', 'The MCP server answered with an error.') };
    if (!plain(reply.result)) return { sent, error: fail('PLUGIN_MCP_REPLY_INVALID', 'The MCP server answered without a result.') };
    if (step.rpc === 'initialize') {
      // The approved bodies and headers name this version; a server choosing another one ends the exchange here.
      if (reply.result.protocolVersion !== endpoint.protocolVersion) return { sent, error: fail('PLUGIN_MCP_VERSION_UNSUPPORTED', 'The MCP server chose a different protocol version than the one approved. Nothing more was sent.') };
      if (fetched.sessionId !== undefined) {
        if (fetched.sessionId.length > MCP_LIMITS.session || !/^[\x21-\x7e]+$/.test(fetched.sessionId)) return { sent, error: fail('PLUGIN_MCP_REPLY_INVALID', 'The MCP server gave an unusable session number.') };
        session = fetched.sessionId;
      }
      continue;
    }
    if (reply.result.resultType === 'input_required') return { sent, error: fail('PLUGIN_MCP_INPUT_REQUIRED', 'The MCP server asked for more input before answering. Chausar does not answer a server’s own questions.') };
    return { sent, result: reply.result };
  }
  return { sent, error: fail('PLUGIN_MCP_REPLY_INVALID', 'The MCP exchange ended without an answer.') };
}

/** The parts of a tool result Chausar shows: text as quoted outside text; images, audio and resources only named. */
export function toolContent(result: Record<string, any>, quote: (text: string) => unknown) {
  const content = Array.isArray(result.content) ? result.content.slice(0, MCP_LIMITS.content) : [];
  return {
    isError: result.isError === true,
    content: content.map((item: unknown) => plain(item) && item.type === 'text' && typeof item.text === 'string' ? { type: 'text' as const, text: quote(item.text) } : { type: plain(item) && typeof item.type === 'string' && /^[a-z_]{1,20}$/.test(item.type) ? item.type : 'unknown', text: null, shown: false }),
    structured: plain(result.structuredContent) ? quote(canonical(result.structuredContent)) : null,
    truncated: Array.isArray(result.content) && result.content.length > MCP_LIMITS.content,
  };
}
