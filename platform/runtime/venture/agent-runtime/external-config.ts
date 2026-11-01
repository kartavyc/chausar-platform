/** Browser-safe configuration validation. Saving never connects or launches a program. */
import { check } from '../../portable.ts';
import { brokerTradingHost, refuseBrokerConnection } from '../policy/securities-guard.ts';

type Identity = { id: string; name: string; credentialRef?: string; credentialRevision?: string };
export type ExternalMcpServer = Identity & (
  | { transport: 'stdio'; command: string; args: string[] }
  | { transport: 'http'; url: string }
);
const BAD = 'INVALID_VENTURE_REQUEST';
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value); }
export function validateExternalServers(raw: unknown): ExternalMcpServer[] {
  check(Array.isArray(raw), BAD, 'Use a list of external tool servers.');
  const ids = new Set<string>();
  return raw.map(value => {
    check(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype, BAD, 'Use one server configuration.');
    const row = value as Record<string, unknown>;
    const keys = row.transport === 'stdio' ? ['id', 'name', 'transport', 'command', 'args'] : ['id', 'name', 'transport', 'url'];
    check(keys.every(key => Object.hasOwn(row, key)) && Object.keys(row).every(key => keys.includes(key) || ['credentialRef', 'credentialRevision'].includes(key)), BAD, 'Server settings cannot contain passwords, tokens, headers or environment values.');
    check(typeof row.id === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(row.id) && !ids.has(row.id), BAD, 'Give every server a unique short identifier.');
    check(text(row.name), BAD, 'Name this server.'); ids.add(row.id);
    check(row.credentialRef === undefined && row.credentialRevision === undefined || typeof row.credentialRef === 'string' && /^mcp:[A-Za-z0-9_-]{1,128}:[a-z][a-z0-9_-]{0,63}$/.test(row.credentialRef) && row.credentialRef.endsWith(`:${row.id}`) && typeof row.credentialRevision === 'string' && /^[A-Za-z0-9_-]+$/.test(row.credentialRevision), BAD, 'Use this server’s protected saved credential.');
    const identity = { id: row.id, name: row.name, ...(row.credentialRef ? { credentialRef: row.credentialRef as string, credentialRevision: row.credentialRevision as string } : {}) };
    if (row.transport === 'stdio') {
      check(text(row.command) && /^(?:[A-Za-z]:[\\/]|\/)/.test(row.command), BAD, 'Choose the full path of the program to run.');
      check(Array.isArray(row.args) && row.args.every(arg => typeof arg === 'string' && !/[\u0000-\u001f\u007f]/.test(arg)
        && !/(?:--?|\/)(?:api[-_]?key|token|password|secret|authorization)(?:=|:|$)/i.test(arg)
        && !/(?:Bearer\s|sk-[A-Za-z0-9_-]{16}|gh[pousr]_[A-Za-z0-9]{20})/.test(arg)), BAD, 'Use separate program arguments without passwords or tokens.');
      // W6 6E7 (D49): a local bridge to a broker trading API (for example a remote MCP proxy) is refused like the API itself.
      if ((row.args as string[]).some(arg => /^https?:\/\//i.test(arg) && brokerTradingHost(arg))) refuseBrokerConnection('This server');
      return { ...identity, transport: 'stdio', command: row.command, args: [...row.args] };
    }
    check(row.transport === 'http' && text(row.url), BAD, 'Choose a local program or HTTP server.');
    let url: URL; try { url = new URL(row.url); } catch { check(false, BAD, 'Enter a full server URL.'); }
    check(!url.username && !url.password && !url.search && !url.hash && (url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)), BAD, 'Use HTTPS, or local HTTP, without credentials or query parameters.');
    if (brokerTradingHost(url.href)) refuseBrokerConnection('This server'); // W6 6E7 (D49)
    return { ...identity, transport: 'http', url: url.href };
  });
}
export function validateExternalCredentialScope(servers: readonly ExternalMcpServer[], ventureId: string): void {
  check(servers.every(server => !server.credentialRef || server.credentialRef === `mcp:${ventureId}:${server.id}`), BAD, 'Use only this business’s protected server credentials.');
}
