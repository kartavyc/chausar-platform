import { useState } from 'react';
import type { ExternalMcpServer } from '../../../../../platform/runtime/venture/agent-runtime/external-config';
import { useEngine, useResource } from '../../engine/context';
import type { EngineMethods } from '../../engine/types';
import { useT } from '../../text';
import { Button } from '../../parts/Button';
import { McpServers, ServerSignIn, ServerToken } from './McpServers';
import s from './AgentSettings.module.css';
import connections from './Connections.module.css';

type SettingsView = EngineMethods['venture.agentSettings.get']['result'];
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const sameAddress = (a: ExternalMcpServer, b: ExternalMcpServer) => a.transport === 'http' && b.transport === 'http' && a.url === b.url;

/**
 * One MCP server's connect flow, wherever the owner is (the first run's services step, Connections): the steps of
 * Connections, AI settings, and nothing new. A server of the curated list shows the registry's own words for it, its
 * exact address and what it can do, waits for the owner's tick for exactly that connection, and is then saved (venture.agentSettings.set); once saved,
 * its own sign-in or token follows (McpServers.tsx). Nothing is called and nothing signs in by itself. serverId: a
 * curated server, or one already saved. Left out, it is the whole server form. onSaved: the servers changed.
 */
export function McpConnect({ serverId, onSaved }: { serverId?: string | undefined; onSaved?: (() => void) | undefined }) {
  const t = useT();
  const engine = useEngine();
  const view = useResource('venture.agentSettings.get', {});
  const registry = useResource('venture.mcpRegistry.list', {}, { skip: !serverId });
  /** What the last save answered, shown until the settings are read again. */
  const [answered, setAnswered] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<ExternalMcpServer[] | null>(null);
  const [approve, setApprove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const current = answered ?? view.data;
  const saved = current?.settings.mcpServers ?? [];
  const entry = serverId ? registry.data?.servers.find((row) => row.id === serverId) : undefined;
  const server = serverId ? saved.find((row) => row.id === serverId) ?? (entry ? saved.find((row) => sameAddress(row, entry.server)) : undefined) : undefined;

  async function save(mcpServers: ExternalMcpServer[]) {
    if (!current || busy || !approve) return;
    setBusy(true);
    setProblem(null);
    try {
      setAnswered(await engine.request('venture.agentSettings.set', { settings: { ...current.settings, mcpServers }, approveMcpConfiguration: true }));
      setApprove(false);
      setDraft(null);
      view.reload();
      onSaved?.();
    } catch (error) { setProblem(messageOf(error)); }
    finally { setBusy(false); }
  }
  const credentialSaved = () => { setAnswered(null); view.reload(); };
  const confirm = <label className={s.check}><input type="checkbox" checked={approve} onChange={(event) => setApprove(event.currentTarget.checked)} />{t('connections.mcp.confirm')}</label>;

  const failed = view.error ?? registry.error;
  if (failed) return <p role="alert">{failed.message}</p>;
  if (!current || (serverId && !server && !registry.data)) return <p className={connections.note}>{t('connections.sheet.loading')}</p>;
  if (server) return <div className={s.group}>{server.transport === 'http' && server.oauth ? <ServerSignIn server={server} /> : <ServerToken server={server} onSaved={credentialSaved} />}</div>;
  if (serverId) {
    if (!entry) return <p className={connections.note}>{t('connections.sheet.notFound')}</p>;
    return (
      <div className={s.group}>
        <p className={connections.note} data-content="">{entry.about}</p>
        <p className={connections.note}>{t(`connections.mcp.signIn.${entry.signIn}`)}. {t(`connections.mcp.access.${entry.access}`)}.</p>
        {/* The exact address the approval is for: kept, after the plain words, and named for what it is. */}
        {entry.server.transport === 'http' && <p className={connections.note}>{t('connections.mcp.address')} <span data-content="">{entry.server.url}</span></p>}
        {confirm}
        <div className={s.actions}><Button locked={!approve || busy} onClick={() => void save([...saved, structuredClone(entry.server)])}>{t('connections.mcp.addSuggested', { name: entry.name })}</Button></div>
        {problem && <p role="alert">{problem}</p>}
      </div>
    );
  }
  const servers = draft ?? saved;
  const changed = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  return (
    <div className={s.group}>
      <McpServers servers={servers} busy={busy} saved={!changed} onCredentialSaved={credentialSaved} onChange={(next) => { setApprove(false); setDraft(next); }} />
      {changed && confirm}
      <div className={s.actions}><Button locked={!changed || !approve || busy} onClick={() => void save(servers)}>{t('connections.settings.save')}</Button></div>
      {problem && <p role="alert">{problem}</p>}
    </div>
  );
}
