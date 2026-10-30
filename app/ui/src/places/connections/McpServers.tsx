import { useState } from 'react';
import type { ExternalMcpServer } from '../../../../../platform/runtime/venture/agent-runtime/external-config';
import { useEngine } from '../../engine/context';
import { useT } from '../../text';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import s from './AgentSettings.module.css';
import connections from './Connections.module.css';

export function McpServers({ servers, onChange, busy, saved, onCredentialSaved }: { servers: ExternalMcpServer[]; onChange(value: ExternalMcpServer[]): void; busy: boolean; saved: boolean; onCredentialSaved(): void }) {
  const t = useT();
  const replace = (id: string, next: ExternalMcpServer) => onChange(servers.map(server => server.id === id ? next : server));
  function add() { let n = 1; while (servers.some(server => server.id === `server${n}`)) n++; onChange([...servers, { id: `server${n}`, name: '', transport: 'http', url: '' }]); }
  return <fieldset className={s.group} disabled={busy}>
    <legend className={connections.subheading}>{t('connections.mcp.title')}</legend>
    <p className={connections.note}>{t('connections.mcp.warning')}</p>
    {servers.map(server => <div className={s.group} key={server.id}>
      <Field label={t('connections.mcp.name')} value={server.name} onChange={event => replace(server.id, { ...server, name: event.currentTarget.value })} />
      <label className={s.label}>{t('connections.mcp.connection')}<select className={s.select} value={server.transport} onChange={event => replace(server.id, event.currentTarget.value === 'stdio'
        ? { id: server.id, name: server.name, transport: 'stdio', command: '', args: [] }
        : { id: server.id, name: server.name, transport: 'http', url: '' })}>
        <option value="http">{t('connections.mcp.http')}</option><option value="stdio">{t('connections.mcp.stdio')}</option>
      </select></label>
      {server.transport === 'http' ? <Field label={t('connections.mcp.url')} value={server.url} onChange={event => replace(server.id, { ...server, url: event.currentTarget.value })} /> : <>
        <Field label={t('connections.mcp.command')} value={server.command} onChange={event => replace(server.id, { ...server, command: event.currentTarget.value })} />
        <Field multiline label={t('connections.mcp.args')} value={server.args.join('\n')} onChange={event => replace(server.id, { ...server, args: event.currentTarget.value ? event.currentTarget.value.split('\n') : [] })} />
        <p className={connections.note}>{t('connections.mcp.localRisk')}</p>
      </>}
      <Button type="button" onClick={() => onChange(servers.filter(row => row.id !== server.id))}>{t('connections.mcp.remove')}</Button>
      {saved && <ServerToken server={server} onSaved={onCredentialSaved} />}
    </div>)}
    <Button type="button" onClick={add}>{t('connections.mcp.add')}</Button>
  </fieldset>;
}
function ServerToken({ server, onSaved }: { server: ExternalMcpServer; onSaved(): void }) {
  const t = useT(), engine = useEngine(); const [token, setToken] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string|null>(null);
  async function save(value: string | null) {
    if (busy) return; setBusy(true); setError(null); setToken('');
    try { await engine.request('venture.mcpCredential.set', { serverId: server.id, token: value }); onSaved(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <details className={connections.fold}><summary>{t(server.credentialRef ? 'connections.mcp.tokenSaved' : 'connections.mcp.token')}</summary>
    <Field type="password" autoComplete="off" label={t('connections.mcp.token')} value={token} onChange={event => setToken(event.currentTarget.value)} />
    <div className={s.actions}><Button type="button" locked={busy || !token} onClick={() => void save(token)}>{t('connections.mcp.saveToken')}</Button>
      {server.credentialRef && <Button type="button" locked={busy} onClick={() => void save(null)}>{t('connections.mcp.removeToken')}</Button>}</div>
    {error && <p role="alert">{error}</p>}
  </details>;
}
