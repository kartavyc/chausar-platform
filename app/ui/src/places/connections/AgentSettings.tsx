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
import { Packs } from './Packs';
import { Fold } from '../../parts/Fold';
import { Select } from '../../parts/Select';
import { LoadingPlace } from '../../parts/Skeleton';

export function AgentSettings({ providers = [] }: { providers?: readonly AiProvider[] }) {
  const t = useT(), engine = useEngine(), id = useId();
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState<Partial<Record<AiProvider, boolean>>>({});
  const resource = useResource('venture.agentSettings.get', {}, { skip: !open, refreshOn: event => event.type === 'queue.changed' });
  const [draft, setDraft] = useState<AiSettings | null>(null), [busy, setBusy] = useState(false);
  const dirty = useRef(false);
  const [approveMcp, setApproveMcp] = useState(false);
  const mcpChanged = Boolean(draft && resource.data && JSON.stringify(draft.mcpServers) !== JSON.stringify(resource.data.settings.mcpServers));
  const [said, setSaid] = useState<{ error: boolean; text: string } | null>(null);
  /** C1 task 13: the Codex jobs where the owner chose "Another model", so the exact-id field shows. */
  const [typed, setTyped] = useState<Partial<Record<AiTask, boolean>>>({});
  const listed = resource.data?.models?.codex ?? null;
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
  return <Fold summary={t('connections.settings.title')} className={connections.fold} onToggle={event => setOpen(event.currentTarget.open)}>
    {open && <Inner card={false}><form className={s.form} aria-label={t('connections.settings.title')} onSubmit={event => void save(event)}>
      {resource.error && <p role="alert">{resource.error.message}</p>}
      <LoadingPlace shape="settings" loading={!draft && !resource.error} />
      {draft && <>
        {providers.map(name => <fieldset key={name} className={s.group} disabled={busy}>
          <legend className={connections.subheading}>{t(`connections.settings.${name}`)}</legend>
          <div className={s.fields}>{(['quick', 'main'] as const).map(kind => {
            const choices = resource.data!.modelChoices[name];
            const choice = draft[name][kind].model === choices.faster ? 'faster' : draft[name][kind].model === choices.smarter ? 'smarter' : '';
            return <label key={kind} className={s.label}>{t(`connections.settings.simple.${kind}`)}
              <Select value={choice} onChange={event => task(name, kind, { model: choices[event.currentTarget.value as 'faster' | 'smarter'] })}>
                {choice === '' && <option value="" disabled>{t('connections.settings.custom')}</option>}
                <option value="faster">{t('connections.settings.faster')}</option><option value="smarter">{t('connections.settings.smarter')}</option>
              </Select>
            </label>;
          })}</div>
          <label className={s.label}>{t('connections.settings.thinking')}
            <Select value={draft[name].quick.effort === draft[name].main.effort ? (['high', 'max'].includes(draft[name].main.effort) ? 'thorough' : 'normal') : ''} onChange={event => {
              const effort = event.currentTarget.value === 'thorough' ? 'high' : 'medium';
              provider(name, { quick: { ...draft[name].quick, effort }, main: { ...draft[name].main, effort } });
            }}>
              {draft[name].quick.effort !== draft[name].main.effort && <option value="" disabled>{t('connections.settings.custom')}</option>}
              <option value="normal">{t('connections.settings.normal')}</option><option value="thorough">{t('connections.settings.thorough')}</option>
            </Select>
          </label>
          <label className={s.label}>{t('connections.settings.online')}
            <Select value={draft[name].network === draft[name].webSearch ? draft[name].network : ''} onChange={event => { const value = event.currentTarget.value as AiNetwork; provider(name, { network: value, webSearch: value }); }}>
              {draft[name].network !== draft[name].webSearch && <option value="" disabled>{t('connections.settings.custom')}</option>}
              {(['off', 'research', 'on'] as const).map(mode => <option key={mode} value={mode}>{t(`connections.settings.${mode}`)}</option>)}
            </Select>
          </label>
          <Fold summary={t('connections.settings.advanced')} className={connections.fold} onToggle={event => { const opened = event.currentTarget.open; setAdvanced(was => ({ ...was, [name]: opened })); }}>
            {advanced[name] && <>
            <div className={s.fields}>{(['quick', 'main'] as const).map(kind => <div key={kind} className={s.task}>
            {name === 'codex' && listed
              ? <CodexModel listed={listed} model={draft.codex[kind].model} typed={typed[kind] === true} label={t('connections.settings.model', { provider: t('connections.settings.codex'), task: t(`connections.settings.${kind}`) })}
                  otherLabel={t('connections.settings.modelOther', { provider: t('connections.settings.codex'), task: t(`connections.settings.${kind}`) })}
                  onType={on => setTyped(was => ({ ...was, [kind]: on }))} onModel={model => task('codex', kind, { model })} />
              : <Field label={t('connections.settings.model', { provider: t(`connections.settings.${name}`), task: t(`connections.settings.${kind}`) })} value={draft[name][kind].model} onChange={event => task(name, kind, { model: event.currentTarget.value })} />}
            </div>)}</div>
            {name === 'codex' && !listed && <p className={connections.note} data-no-model-list="">{t('connections.settings.modelNoList')}</p>}
          {name === 'claude' && <label className={s.check}><input type="checkbox" checked={Boolean(draft.claude.fallbackModel)} onChange={event => {
            const { fallbackModel: _fallback, ...rest } = draft.claude;
            changed(); setDraft({ ...draft, claude: { ...rest, ...(event.currentTarget.checked ? { fallbackModel: resource.data!.modelChoices.claude.faster } : {}) } });
          }} />{t('connections.settings.fallback')}</label>}
          {name === 'claude' && draft.claude.fallbackModel && <Field label={t('connections.settings.fallbackModel')} value={draft.claude.fallbackModel} onChange={event => provider('claude', { fallbackModel: event.currentTarget.value })} />}
            </>}
          </Fold>
        </fieldset>)}
        <fieldset className={s.group} disabled={busy}>
          <legend className={connections.subheading}>{t('connections.settings.approvals')}</legend>
          <label className={s.check}><input type="checkbox" checked={draft.autoReview} onChange={event => { changed(); setDraft({ ...draft, autoReview: event.currentTarget.checked }); }} />{t('connections.settings.defaultReview')}</label>
          {resource.data?.agents.map(agent => <label className={s.check} key={agent.id}><input type="checkbox" checked={draft.agentAutoReview[agent.id] ?? draft.autoReview} onChange={event => { changed(); setDraft({ ...draft, agentAutoReview: { ...draft.agentAutoReview, [agent.id]: event.currentTarget.checked } }); }} />{t('connections.settings.agentReview', { name: agent.name })}</label>)}
          {/* C7: offers are on until the owner says no; each one is still theirs to keep or dismiss. */}
          <label className={s.check}><input type="checkbox" checked={draft.offerWays !== false} onChange={event => { changed(); setDraft({ ...draft, offerWays: event.currentTarget.checked }); }} />{t('connections.settings.offerWays')}</label>
          <p className={connections.note}>{t('connections.settings.outside')}</p>
        </fieldset>
        <McpServers servers={draft.mcpServers} busy={busy} saved={!dirty.current} onCredentialSaved={() => resource.reload()} onChange={mcpServers => { changed(); setApproveMcp(false); setDraft({ ...draft, mcpServers }); }} />
        {mcpChanged && <label className={s.check}><input type="checkbox" checked={approveMcp} onChange={event => setApproveMcp(event.currentTarget.checked)} />{t('connections.mcp.confirm')}</label>}
        <Packs />
        <div className={s.notes} id={id}>
          <p>{t('connections.settings.folder')}</p><p>{t('connections.settings.shell')}</p>
          <p>{t('connections.settings.support')}</p><p>{t('connections.settings.mcp')}</p>
          <p>{t('connections.settings.keys')}</p>
        </div>
        <div className={s.actions}><Button type="submit" variant="primary" locked={busy || resource.loading || Boolean(resource.error) || mcpChanged && !approveMcp} aria-describedby={id}>{t('connections.settings.save')}</Button>{said && <span role={said.error ? 'alert' : 'status'}>{said.text}</span>}</div>
      </>}
    </form></Inner>}
  </Fold>;
}

const ANOTHER = '__another-model__';

/**
 * C1 task 13: Codex's model for one job, chosen from Codex's own list (the saved id first). A saved id Codex does not
 * list says so. "Another model" shows the exact-id field. The id is sent exactly as picked or typed.
 */
function CodexModel({ listed, model, typed, label, otherLabel, onType, onModel }: {
  listed: readonly string[]; model: string; typed: boolean; label: string; otherLabel: string;
  onType: (on: boolean) => void; onModel: (model: string) => void;
}) {
  const t = useT();
  const options = [model, ...listed.filter(id => id !== model)].filter(Boolean);
  return <>
    <label className={s.label}>{label}
      <Select value={typed ? ANOTHER : model} onChange={event => {
        const value = event.currentTarget.value;
        if (value === ANOTHER) { onType(true); return; }
        onType(false); onModel(value);
      }}>
        {options.map(id => <option key={id} value={id}>{listed.includes(id) ? id : t('connections.settings.modelUnlisted', { id })}</option>)}
        <option value={ANOTHER}>{t('connections.settings.modelAnother')}</option>
      </Select>
    </label>
    {typed && <Field label={otherLabel} value={model} onChange={event => onModel(event.currentTarget.value)} />}
  </>;
}
