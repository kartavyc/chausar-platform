import { useState } from 'react';
import type { PackView } from '../../../../../platform/runtime/venture/packs/pack-format';
import { useEngine, useResource } from '../../engine/context';
import { useT } from '../../text';
import { Button } from '../../parts/Button';
import s from './AgentSettings.module.css';
import connections from './Connections.module.css';
import { Fold } from '../../parts/Fold';
import { FilePick } from '../../parts/FilePick';

/**
 * W6 6F2 (D31): playbook packs. A pack adds markdown skills, MCP server suggestions and pure calculators, never code
 * hooks. Choosing a file shows the exact pack first; adding it needs a second tap on that exact preview. Server
 * suggestions are shown only: adding one is the normal server setting above, with its own approval.
 */
export function Packs() {
  const t = useT(), engine = useEngine();
  const [open, setOpen] = useState(false);
  const list = useResource('venture.packs.list', {}, { skip: !open, refreshOn: event => event.type === 'queue.changed' });
  const [preview, setPreview] = useState<{ pack: unknown; view: PackView; digest: string } | null>(null);
  const [busy, setBusy] = useState(false), [said, setSaid] = useState<{ error: boolean; text: string } | null>(null);
  async function act(work: () => Promise<void>) {
    if (busy) return; setBusy(true); setSaid(null);
    try { await work(); } catch (error) { setSaid({ error: true, text: error instanceof Error ? error.message : String(error) }); } finally { setBusy(false); }
  }
  function choose(file: File | undefined) {
    if (!file) return;
    void act(async () => {
      let pack: unknown;
      try { pack = JSON.parse(await file.text()); } catch { throw new Error(t('connections.packs.notJson')); }
      const answer = await engine.request('venture.packs.add', { pack });
      setPreview({ pack, view: answer.pack, digest: answer.digest });
    });
  }
  return <Fold summary={t('connections.packs.title')} className={connections.fold} onToggle={event => setOpen(event.currentTarget.open)}>
    <div className={s.group}>
      <p className={connections.note}>{t('connections.packs.note')}</p>
      {list.error && <p role="alert">{list.error.message}</p>}
      {list.data && (list.data.packs.length ? <ul className={s.group}>{list.data.packs.map(pack => <li key={pack.id} className={s.group}>
        <PackSummary pack={pack} />
        <div className={s.actions}><Button type="button" locked={busy} onClick={() => void act(async () => { await engine.request('venture.packs.remove', { packId: pack.id }); list.reload(); })}>{t('connections.packs.remove')}</Button></div>
      </li>)}</ul> : null)}
      <FilePick choose={t('connections.packs.choose')} accept=".json,application/json" disabled={busy} onChange={event => { choose(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
      {preview && <div className={s.group} aria-live="polite">
        <PackSummary pack={preview.view} />
        <div className={s.actions}>
          <Button type="button" locked={busy} onClick={() => setPreview(null)}>{t('connections.packs.cancel')}</Button>
          <Button type="button" variant="primary" locked={busy} onClick={() => void act(async () => {
            await engine.request('venture.packs.add', { pack: preview.pack, digest: preview.digest }); setPreview(null); list.reload(); setSaid({ error: false, text: t('connections.packs.added') });
          })}>{t('connections.packs.add')}</Button>
        </div>
      </div>}
      {said && <p role={said.error ? 'alert' : 'status'}>{said.text}</p>}
    </div>
  </Fold>;
}
function PackSummary({ pack }: { pack: PackView }) {
  const t = useT();
  return <div className={s.group}>
    <span><strong data-content>{pack.name}</strong> {t('connections.packs.version', { version: pack.version })}</span>
    <span data-content>{pack.about}</span>
    <span className={connections.note}>{t('connections.packs.parts', { skills: String(pack.skills.length), calculators: String(pack.calculators.length), servers: String(pack.mcpServers.length) })}</span>
    {pack.calculators.map(calc => <span key={calc.id} className={connections.note} data-content>{calc.name}: {calc.about}</span>)}
    {pack.mcpServers.map(server => <span key={server.id} className={connections.note} data-content>{t('connections.packs.server', { name: server.name })}</span>)}
  </div>;
}
