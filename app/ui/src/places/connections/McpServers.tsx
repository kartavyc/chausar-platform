import { useState } from 'react';
import type { ExternalMcpServer } from '../../../../../platform/runtime/venture/agent-runtime/external-config';
import { useEngine, useResource } from '../../engine/context';
import { useT } from '../../text';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { openExternal, openProblem, reserveTab } from './external';
import s from './AgentSettings.module.css';
import connections from './Connections.module.css';
import { Fold } from '../../parts/Fold';

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
      {server.transport === 'http' ? <>
        <Field label={t('connections.mcp.url')} value={server.url} onChange={event => replace(server.id, { ...server, url: event.currentTarget.value })} />
        {/* W6 6F1: the service's own sign-in (OAuth with PKCE) instead of a pasted token. */}
        <label className={s.check}><input type="checkbox" checked={Boolean(server.oauth)} onChange={event => {
          const { oauth: _oauth, ...rest } = server; replace(server.id, { ...rest, ...(event.currentTarget.checked ? { oauth: true as const } : {}) });
        }} />{t('connections.mcp.oauth')}</label>
      </> : <>
        <Field label={t('connections.mcp.command')} value={server.command} onChange={event => replace(server.id, { ...server, command: event.currentTarget.value })} />
        <Field multiline label={t('connections.mcp.args')} value={server.args.join('\n')} onChange={event => replace(server.id, { ...server, args: event.currentTarget.value ? event.currentTarget.value.split('\n') : [] })} />
        <Field label={t('connections.mcp.tokenEnv')} value={server.tokenEnv ?? ''} onChange={event => {
          const { tokenEnv: _env, ...rest } = server; const value = event.currentTarget.value; replace(server.id, { ...rest, ...(value ? { tokenEnv: value } : {}) });
        }} />
        <p className={connections.note}>{t('connections.mcp.localRisk')}</p>
      </>}
      <Button type="button" onClick={() => onChange(servers.filter(row => row.id !== server.id))}>{t('connections.mcp.remove')}</Button>
      {saved && (server.transport === 'http' && server.oauth ? <ServerSignIn server={server} /> : <ServerToken server={server} onSaved={onCredentialSaved} />)}
    </div>)}
    <Button type="button" onClick={add}>{t('connections.mcp.add')}</Button>
    <SuggestedServers servers={servers} onAdd={server => onChange([...servers, server])} />
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
  return <Fold summary={t(server.credentialRef ? 'connections.mcp.tokenSaved' : 'connections.mcp.token')} className={connections.fold}>
    <Field type="password" autoComplete="off" label={t('connections.mcp.token')} value={token} onChange={event => setToken(event.currentTarget.value)} />
    <div className={s.actions}><Button type="button" locked={busy || !token} onClick={() => void save(token)}>{t('connections.mcp.saveToken')}</Button>
      {server.credentialRef && <Button type="button" locked={busy} onClick={() => void save(null)}>{t('connections.mcp.removeToken')}</Button>}</div>
    {error && <p role="alert">{error}</p>}
  </Fold>;
}
/** W6 6F1: Sign in opens the service's own sign-in in the owner's browser. Tokens go to protected storage only. */
function ServerSignIn({ server }: { server: ExternalMcpServer }) {
  const t = useT(), engine = useEngine(); const [busy, setBusy] = useState(false), [error, setError] = useState<string|null>(null), [link, setLink] = useState<string|null>(null);
  async function signIn() {
    if (busy) return; setBusy(true); setError(null); setLink(null);
    let tab: Window | null = null;
    try {
      tab = reserveTab();
      const started = await engine.request('venture.mcpOAuth.start', { serverId: server.id });
      try { await openExternal(started.authorizationUrl, tab); }
      catch (problem) { setLink(started.authorizationUrl); setError(openProblem(problem, t)); }
    } catch (problem) { tab?.close(); setError(problem instanceof Error ? problem.message : String(problem)); }
    finally { setBusy(false); }
  }
  return <div className={s.group}>
    <p className={connections.note}>{t(server.credentialRef ? 'connections.mcp.signedIn' : 'connections.mcp.signInNote')}</p>
    <div className={s.actions}><Button type="button" locked={busy} onClick={() => void signIn()}>{t(server.credentialRef ? 'connections.mcp.signInAgain' : 'connections.mcp.signIn')}</Button></div>
    {error && <p role="alert">{error}</p>}
    {link && <Field label={t('connections.mcp.signInLink')} value={link} readOnly onChange={() => undefined} />}
  </div>;
}
/** W6 6F1: a short list from the official MCP registry. Adding fills the form; saving still needs the exact approval. */
function SuggestedServers({ servers, onAdd }: { servers: ExternalMcpServer[]; onAdd(server: ExternalMcpServer): void }) {
  const t = useT(); const [open, setOpen] = useState(false);
  const list = useResource('venture.mcpRegistry.list', {}, { skip: !open });
  return <Fold summary={t('connections.mcp.suggested')} className={connections.fold} onToggle={event => setOpen(event.currentTarget.open)}>
    {list.error && <p role="alert">{list.error.message}</p>}
    {list.data && <>
      <p className={connections.note}>{t('connections.mcp.suggestedNote', { date: list.data.checkedOn })}</p>
      <ul className={s.group}>{list.data.servers.map(entry => <li key={entry.id} className={s.group}>
        <span><strong>{entry.name}</strong> <span data-content>{entry.about}</span></span>
        <span className={connections.note}>{t(`connections.mcp.signIn.${entry.signIn}`)}. {t(`connections.mcp.access.${entry.access}`)}.</span>
        <div className={s.actions}><Button type="button" locked={servers.some(server => server.id === entry.server.id)} onClick={() => onAdd(structuredClone(entry.server))}>{t('connections.mcp.addSuggested', { name: entry.name })}</Button></div>
      </li>)}</ul>
    </>}
  </Fold>;
}
