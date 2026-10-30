import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { AiNetwork, AiProvider, AiProviderSettings, AiSettings, AiTask, AiTaskSettings } from '../../../../../platform/runtime/venture/agent-runtime/settings';
import { useEngine, useResource } from '../../engine/context';
import { useT } from '../../text';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Inner } from '../../parts/Card';
import s from './AgentSettings.module.css';
import connections from './Connections.module.css';
import { McpServers } from './McpServers';

export function AgentSettings() {
  const t = useT(), engine = useEngine(), id = useId();
  const [open, setOpen] = useState(false);
  const resource = useResource('venture.agentSettings.get', {}, { skip: !open, refreshOn: event => event.type === 'queue.changed' });
  const [draft, setDraft] = useState<AiSettings | null>(null), [busy, setBusy] = useState(false);
  const dirty = useRef(false);
  const [approveMcp, setApproveMcp] = useState(false);
  const mcpChanged = Boolean(draft && resource.data && JSON.stringify(draft.mcpServers) !== JSON.stringify(resource.data.settings.mcpServers));
  const [said, setSaid] = useState<{ error: boolean; text: string } | null>(null);
  useEffect(() => { if (resource.data && !dirty.current) setDraft(structuredClone(resource.data.settings)); }, [resource.data]);
  function changed() { dirty.current = true; setSaid(null); }
  function provider(name: AiProvider, patch: Partial<AiProviderSettings>) { changed(); setDraft(value => value && ({ ...value, [name]: { ...value[name], ...patch } })); }
  function task(name: AiProvider, kind: AiTask, patch: Partial<AiTaskSettings>) { if (draft) provider(name, { [kind]: { ...draft[name][kind], ...patch } }); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!draft || busy) return;
    setBusy(true); setSaid(null);
    try { const next = await engine.request('venture.agentSettings.set', { settings: draft, ...(mcpChanged && approveMcp ? { approveMcpConfiguration: true as const } : {}) }); dirty.current = false; setApproveMcp(false); setDraft(next.settings); resource.reload(); setSaid({ error: false, text: t('connections.settings.saved') }); }
    catch (error) { setSaid({ error: true, text: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(false); }
  }
  return <details className={connections.fold} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{t('connections.settings.title')}</summary>
    {open && <Inner card={false}><form className={s.form} aria-label={t('connections.settings.title')} onSubmit={event => void save(event)}>
      {resource.error && <p role="alert">{resource.error.message}</p>}
      {!draft && !resource.error && <p>{t('connections.ai.loading')}</p>}
      {draft && <>
        {(['codex', 'claude'] as const).map(name => <fieldset key={name} className={s.group} disabled={busy}>
          <legend className={connections.subheading}>{t(`connections.settings.${name}`)}</legend>
          <div className={s.fields}>{(['quick', 'main'] as const).map(kind => <div key={kind} className={s.task}>
            <Field label={t('connections.settings.model', { provider: t(`connections.settings.${name}`), task: t(`connections.settings.${kind}`) })} value={draft[name][kind].model} onChange={event => task(name, kind, { model: event.currentTarget.value })} />
            <label className={s.label}>{t('connections.settings.effort', { provider: t(`connections.settings.${name}`), task: t(`connections.settings.${kind}`) })}
              <select className={s.select} value={draft[name][kind].effort} onChange={event => task(name, kind, { effort: event.currentTarget.value as AiTaskSettings['effort'] })}>
                {(['low', 'medium', 'high', 'max'] as const).map(effort => <option key={effort} value={effort}>{t(`connections.settings.effort.${effort}`)}</option>)}
              </select>
            </label>
          </div>)}</div>
          <div className={s.fields}>{(['network', 'webSearch'] as const).map(field => <label key={field} className={s.label}>
            {t('connections.settings.access', { provider: t(`connections.settings.${name}`), access: t(`connections.settings.${field}`) })}
            <select className={s.select} value={draft[name][field]} onChange={event => provider(name, { [field]: event.currentTarget.value as AiNetwork })}>
              {(['off', 'research', 'on'] as const).map(mode => <option key={mode} value={mode}>{t(`connections.settings.${mode}`)}</option>)}
            </select>
          </label>)}</div>
          {name === 'claude' && <label className={s.check}><input type="checkbox" checked={Boolean(draft.claude.fallbackModel)} onChange={event => {
            const { fallbackModel: _fallback, ...rest } = draft.claude;
            changed(); setDraft({ ...draft, claude: { ...rest, ...(event.currentTarget.checked ? { fallbackModel: 'claude-haiku-5-5' } : {}) } });
          }} />{t('connections.settings.fallback')}</label>}
          {name === 'claude' && draft.claude.fallbackModel && <Field label={t('connections.settings.fallbackModel')} value={draft.claude.fallbackModel} onChange={event => provider('claude', { fallbackModel: event.currentTarget.value })} />}
        </fieldset>)}
        <fieldset className={s.group} disabled={busy}>
          <legend className={connections.subheading}>{t('connections.settings.approvals')}</legend>
          <label className={s.check}><input type="checkbox" checked={draft.autoReview} onChange={event => { changed(); setDraft({ ...draft, autoReview: event.currentTarget.checked }); }} />{t('connections.settings.defaultReview')}</label>
          {resource.data?.agents.map(agent => <label className={s.check} key={agent.id}><input type="checkbox" checked={draft.agentAutoReview[agent.id] ?? draft.autoReview} onChange={event => { changed(); setDraft({ ...draft, agentAutoReview: { ...draft.agentAutoReview, [agent.id]: event.currentTarget.checked } }); }} />{t('connections.settings.agentReview', { name: agent.name })}</label>)}
          <p className={connections.note}>{t('connections.settings.outside')}</p>
        </fieldset>
        <McpServers servers={draft.mcpServers} busy={busy} saved={!dirty.current} onCredentialSaved={() => resource.reload()} onChange={mcpServers => { changed(); setApproveMcp(false); setDraft({ ...draft, mcpServers }); }} />
        {mcpChanged && <label className={s.check}><input type="checkbox" checked={approveMcp} onChange={event => setApproveMcp(event.currentTarget.checked)} />{t('connections.mcp.confirm')}</label>}
        <div className={s.notes} id={id}>
          <p>{t('connections.settings.folder')}</p><p>{t('connections.settings.shell')}</p>
          <p>{t('connections.settings.support')}</p><p>{t('connections.settings.mcp')}</p>
          <p>{t('connections.settings.keys')}</p>
        </div>
        <div className={s.actions}><Button type="submit" variant="primary" locked={busy || resource.loading || Boolean(resource.error) || mcpChanged && !approveMcp} aria-describedby={id}>{t('connections.settings.save')}</Button>{said && <span role={said.error ? 'alert' : 'status'}>{said.text}</span>}</div>
      </>}
    </form></Inner>}
  </details>;
}
