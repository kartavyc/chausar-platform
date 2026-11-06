import { useState } from 'react';
import type { AiProvider } from '../../../../../platform/runtime/venture/agent-runtime/settings';
import { useEngine, useResource } from '../../engine/context';
import { useT } from '../../text';
import { Button } from '../../parts/Button';
import { Fold } from '../../parts/Fold';
import { Tile } from '../../parts/Tile';
import { messageOf } from '../../../../../platform/shared/errors';
import s from './AgentSettings.module.css';
import connections from './Connections.module.css';

/** Gmail is the AI tool's existing connection. The owner approves this standing setting here; sends still ask. */
export function GmailConnection({ providers }: { providers?: readonly AiProvider[] }) {
  const t = useT(), engine = useEngine();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [changes, setChanges] = useState<Partial<Record<AiProvider, boolean>>>({});
  const [said, setSaid] = useState<{ error: boolean; text: string } | null>(null);
  const models = useResource('venture.models.status', {}, { skip: providers !== undefined, refreshOn: event => event.type === 'queue.changed' });
  const active = providers ?? (['codex', 'claude'] as const).filter(name => models.data?.connections.some(row => row.status === 'connected' && row.presetId === (name === 'codex' ? 'codex-cli' : 'claude-code-cli')));
  const resource = useResource('venture.agentSettings.get', {}, { skip: !open, refreshOn: event => event.type === 'queue.changed' });
  async function save() {
    if (busy || !Object.keys(changes).length) return;
    setBusy(true); setSaid(null);
    try {
      // Read the latest settings so another open settings surface is never overwritten by this one choice.
      const current = await engine.request('venture.agentSettings.get', {});
      const settings = structuredClone(current.settings);
      for (const name of active) if (changes[name] !== undefined) settings[name].connectors = changes[name];
      await engine.request('venture.agentSettings.set', { settings });
      setChanges({}); resource.reload(); setSaid({ error: false, text: t('connections.gmail.saved') });
    } catch (error) { setSaid({ error: true, text: messageOf(error) }); }
    finally { setBusy(false); }
  }
  if (!active.length) return null;
  return <Tile><Fold summary={t('connections.gmail.title')} onToggle={event => setOpen(event.currentTarget.open)}>
    {open && <div className={s.group}>
      {resource.error && <p role="alert">{resource.error.message}<Button size="sm" onClick={resource.reload}>{t('connections.gmail.retry')}</Button></p>}
      {resource.data && active.map(name => <label key={name} className={s.check}><input type="checkbox" disabled={busy} checked={changes[name] ?? resource.data!.settings[name].connectors === true} onChange={event => { const checked = event.currentTarget.checked; setSaid(null); setChanges(was => ({ ...was, [name]: checked })); }} />{t(`connections.settings.gmail.${name}`)}</label>)}
      <p className={connections.note}>{t('connections.gmail.line')}</p>
      <Button size="sm" locked={busy || !resource.data || !Object.keys(changes).length} onClick={() => void save()}>{t('connections.gmail.save')}</Button>
      {said && <p role={said.error ? 'alert' : 'status'}>{said.text}</p>}
    </div>}
  </Fold></Tile>;
}
