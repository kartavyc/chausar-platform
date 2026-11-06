import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Inner } from '../../parts/Card';
import { Field } from '../../parts/Field';
import { Row } from '../../parts/Row';
import { Tile } from '../../parts/Tile';
import type { ModelConnectParams, ModelConnectionLite, ModelPresetLite, ModelStatusLite, ModelTier } from '../../engine/types';
import { useCliChecks, useCliStatus, CliTool } from './CliStatus';
import { connectionWords } from './ConnectionWords';
import { AgentSettings } from './AgentSettings';
import s from './Connections.module.css';
import { Fold } from '../../parts/Fold';
import { LoadingPlace } from '../../parts/Skeleton';
import { SwapWords } from '../../parts/Swap';
import { LeaveRow } from '../../parts/LeaveRow';
import { useLeavingList } from '../../parts/useLeaving';

export const TEMPLATES = 'built-in-templates';
const CONNECTABLE = new Set(['ready', 'unverified']);
interface Choice { id: string; title: string; presets: { preset: ModelPresetLite; tiers?: ModelTier[] }[]; keyName: string }

/** One row per AI. Native trust, exact key consent and engine status retain their own boundaries. */
export function YourAi({ focus }: { focus: boolean }) {
  const t = useT(), client = useEngine(), headingId = useId(), heading = useRef<HTMLHeadingElement>(null);
  const changed = { refreshOn: (event: { type: string }) => event.type === 'queue.changed' };
  const venture = useResource('venture.get', {}, changed);
  const known = venture.data !== undefined || venture.error !== undefined;
  const draft = known && !venture.data;
  const status = useResource(draft ? 'venture.ai.status' : 'venture.models.status', {}, { skip: !known, ...changed });
  const vaultPresets = useResource('venture.models.presets', {}, { skip: !known || draft, ...changed });
  const draftOptions = useResource('venture.ai.options', {}, { skip: !draft, ...changed });
  const presets = (draft ? draftOptions.data?.presets : vaultPresets.data) ?? [];
  const [open, setOpen] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; problem: boolean } | null>(null);
  const checks = useCliChecks(), cli = useCliStatus();
  const reloadPresets = draft ? draftOptions.reload : vaultPresets.reload;
  useEffect(() => { if (focus) heading.current?.focus(); }, [focus]);
  useEffect(() => { if (checks > 0 && known) reloadPresets(); }, [checks]);
  const data = status.data;
  const connected = data?.connections.filter(row => row.status === 'connected') ?? [];
  const providers = (['codex', 'claude'] as const).filter(name => connected.some(row => row.presetId === (name === 'codex' ? 'codex-cli' : 'claude-code-cli')));
  const side = Boolean(data) && !draft && client.transport !== 'hosted';
  const choice = (id: string, title: string, keyName: string): Choice | null => {
    const preset = presets.find(row => row.id === id);
    return preset ? { id, title, keyName, presets: [{ preset }] } : null;
  };
  const haiku = presets.find(row => row.id === 'anthropic-haiku-5-5'), sonnet = presets.find(row => row.id === 'anthropic-sonnet-5-5');
  const anthropic: Choice | null = haiku && sonnet ? { id: 'anthropic', title: t('connections.ai.anthropic'), keyName: 'Anthropic', presets: [{ preset: haiku, tiers: ['fast'] }, { preset: sonnet, tiers: ['main'] }] } : null;
  const main = [choice('claude-code-cli', 'Claude Code', 'Claude Code'), choice('codex-cli', 'Codex', 'Codex'), anthropic, choice('openai-gpt-6-luna', t('connections.ai.openai'), 'OpenAI')].filter((row): row is Choice => row !== null && !(row.presets[0]!.preset.runsOn === 'this-computer' && row.presets[0]!.preset.availability === 'unavailable'));
  const mainIds = new Set(main.flatMap(row => row.presets.map(item => item.preset.id)));
  const others = presets.filter(row => !mainIds.has(row.id) && !(row.runsOn === 'this-computer' && row.availability === 'unavailable')).map(row => ({ id: row.id, title: row.label, presets: [{ preset: row }], keyName: row.label }));
  async function disconnect(ids: string[]) {
    if (busy) return; setBusy(true); setSaid(null);
    try { for (const connectionId of ids) await client.request(draft ? 'venture.ai.disconnect' : 'venture.models.disconnect', { connectionId }); }
    catch (error) { setSaid({ text: t('connections.ai.disconnectFailed', { message: error instanceof Error ? error.message : String(error) }), problem: true }); }
    finally { status.reload(); setBusy(false); }
  }
  async function check() {
    if (busy) return; setBusy(true); setSaid(null);
    try { await cli.check(); } catch (error) { setSaid({ text: error instanceof Error ? error.message : String(error), problem: true }); }
    finally { setBusy(false); }
  }
  function row(item: Choice) {
    const lead = item.presets[0]!.preset, saved = connected.filter(connection => item.presets.some(p => p.preset.id === connection.presetId));
    const canConnect = item.presets.every(({ preset }) => CONNECTABLE.has(preset.availability));
    const action = saved.length ? <Button size="sm" locked={busy} onClick={() => void disconnect(saved.map(connection => connection.id))}>{t('connections.ai.disconnect')}</Button>
      : canConnect && open !== item.id ? <Button size="sm" onClick={() => { setOpen(item.id); setSaid(null); }}>{lead.id === TEMPLATES ? t('connections.ai.useTemplates') : t('connections.ai.connect')}</Button> : undefined;
    const form = open === item.id && <ConnectForm choice={item} draft={draft} onCancel={() => setOpen(null)} onDone={text => { setOpen(null); setSaid({ text, problem: false }); status.reload(); }} />;
    const native = cli.status.data?.clis.find(view => view.cli === (lead.id === 'codex-cli' ? 'codex' : lead.id === 'claude-code-cli' ? 'claude-code' : ''));
    if (native) return <CliTool key={item.id} view={!canConnect && native.setup?.state === 'trusted' && native.fix === null && native.state !== 'ready' && native.lastTask?.outcome !== 'failed' ? { ...native, fix: lead.availabilityReason } : native} onChosen={() => void check()} actions={action} plan={cli.plan.data?.tools.find(view => view.cli === native.cli)} ran={cli.status.data?.clis[0]?.cli === native.cli ? cli.status.data.line : undefined}>{form}</CliTool>;
    const line = saved.length ? t('connections.ai.connected') : canConnect ? t('connections.ai.notConnected') : connectionWords(t, lead.availabilityReason);
    return <Row key={item.id} id={`ai-add-${item.id}`} title={<span data-ai-name="">{item.title}</span>} line={<SwapWords>{line}</SwapWords>} actions={action}>
      <Fold summary={t('connections.cli.details')} className={s.fold}>
        <ConnectedModels connections={saved} />
        {!saved.length && <p className={s.note}>{connectionWords(t, lead.availabilityReason.replace('Not yet checked with a live key.', '').trim())}{lead.needsKey && <> {lead.keyHint}</>}</p>}
      </Fold>
      {form}
    </Row>;
  }
  return <div className={s.top} data-side={side ? undefined : 'none'}>
    <Tile as="section" labelledBy={headingId}>
      <div className={s.head}><h2 id={headingId} ref={heading} tabIndex={-1} className={s.title}>{t('connections.ai.title')}</h2>
        {draft && <Button size="sm" locked={busy} onClick={() => void check()}>{t('connections.checks.run')}</Button>}
      </div>
      {draft && <p className={s.note}>{t('connections.ai.draft')}</p>}
      {status.error && <p className={s.problem} role="alert">{t('connections.ai.failed', { message: status.error.message })}</p>}
      {!data && !status.error && <LoadingPlace shape="cards" />}
      {cli.status.error?.code === 'TIER_UNAVAILABLE' && <p className={s.note}>{cli.status.error.message}</p>}
      {cli.status.error && cli.status.error.code !== 'TIER_UNAVAILABLE' && <p className={s.problem} role="alert">{cli.status.error.message}</p>}
      {data && <>
        <p className={s.spend}><span data-engine-line="">{t('connections.ai.spent', { amount: data.spentThisMonthDisplay })}</span></p>
        <p className={s.note}>{t('connections.ai.spendNote')}</p>
        {data.sendPolicy === 'nothing' && <p className={s.note}>{t('connections.ai.sendNothing')}</p>}
        {data.replay.active && <p className={s.note}>{t('connections.ai.replay')}</p>}
        {!connected.length && <p className={s.note}>{connectionWords(t, data.tiers.main.reason)}</p>}
      </>}
      {presets.length > 0 && <ul className={s.rows} aria-label={t('connections.ai.choices')}>{main.map(row)}</ul>}
      {presets.some(preset => preset.needsKey && preset.verification === 'not-live-verified') && <p className={s.note}>{t('connections.ai.keyNotChecked')}</p>}
      {others.length > 0 && <Fold summary={t('connections.ai.other')} className={s.fold}><ul className={s.rows}>{others.map(row)}</ul></Fold>}
      {said && <p className={said.problem ? s.problem : s.said} role={said.problem ? 'alert' : 'status'}>{said.text}</p>}
      {data && !draft && <AgentSettings key={venture.data?.venture.id} providers={providers} />}
    </Tile>
    {side && data && <div className={s.side}><SendRule now={data.sendPolicy} onSaved={() => status.reload()} /></div>}
  </div>;
}

/** Choice rows stay put. Only their connected model details leave or arrive after the engine answers. */
function ConnectedModels({ connections }: { connections: ModelConnectionLite[] }) {
  const t = useT();
  const { drawn, left } = useLeavingList(connections, connection => connection.id);
  return <ul className={s.modelConnections}>{drawn.map(row => <LeaveRow key={row.key} row={row} left={left}>
    <p className={s.note} data-model-connection={row.item.id}><span data-code="">{row.item.model}</span>{!row.item.usable && <>. {connectionWords(t, row.item.reason)}</>}</p>
  </LeaveRow>)}</ul>;
}

const SEND_RULES = ['nothing', 'shape', 'samples'] as const;

/**
 * What may leave this computer for an AI (trust.update { send }), the old Trust & access page's disclosure rule, as a
 * tile of radio cards beside Your AI. The engine checks it before every AI call. A choice is sent only on Save;
 * afterwards the tile shows the engine's setting.
 */
function SendRule({ now, onSaved }: { now: ModelStatusLite['sendPolicy']; onSaved: () => void }) {
  const t = useT();
  const client = useEngine();
  const name = useId();
  const [chosen, setChosen] = useState(now);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { setChosen(now); }, [now]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await client.request('trust.update', { send: chosen });
      onSaved();
    } catch (error) {
      setProblem(t('connections.ai.sendFailed', { message: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Tile pad="compact">
      <form className={s.form} onSubmit={(event) => void save(event)}>
        <fieldset className={s.rule}>
          <legend className={s.title}>{t('connections.ai.sendTitle')}</legend>
          {SEND_RULES.map((rule) => (
            <label key={rule} className={s.choice}>
              <input type="radio" name={name} checked={chosen === rule} onChange={() => setChosen(rule)} />
              {t(`connections.ai.send.${rule}`)}
            </label>
          ))}
          {problem && <p className={s.problem} role="alert">{problem}</p>}
          <div className={s.buttons}><Button size="sm" type="submit" disabled={busy || chosen === now}>{t('connections.ai.sendSave')}</Button></div>
        </fieldset>
      </form>
    </Tile>
  );
}

/**
 * The consent words exactly as the engine wrote them, I agree, then Connect. The key never outlives the click: its
 * password field sits outside any form (so no browser offers to save it), autocomplete off, sent from a button and
 * cleared in a finally, whether Connect worked or not.
 */
function ConnectForm({ choice, draft, onCancel, onDone }: { choice: Choice; draft: boolean; onCancel: () => void; onDone: (text: string) => void }) {
  const t = useT();
  const client = useEngine();
  const lead = choice.presets[0]!.preset;
  const [key, setKey] = useState('');
  const [model, setModel] = useState(lead.modelEditable ? lead.model ?? '' : '');
  const [cap, setCap] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const needsKey = choice.presets.some(({ preset }) => preset.needsKey);
  const consents = [...new Set(choice.presets.map(({ preset }) => preset.consentText))];

  async function connect() {
    if (busy) return;
    if (needsKey && !key.trim()) { setProblem(t('connections.ai.keyFirst')); return; }
    const typed = key.trim();
    setKey('');
    setBusy(true);
    setProblem(null);
    let connectedOne = false;
    try {
      for (const { preset, tiers } of choice.presets) {
        const params: ModelConnectParams = { presetId: preset.id, consentDigest: preset.consentDigest };
        if (preset.needsKey) params.apiKey = typed;
        if (preset.modelEditable && model.trim()) params.model = model.trim();
        if (tiers) params.tiers = tiers;
        if (cap.trim()) params.monthlyCapUsd = cap.trim();
        await client.request(draft ? 'venture.ai.connect' : 'venture.models.connect', params);
        connectedOne = true;
      }
      onDone(t('connections.ai.done', { name: choice.title }));
    } catch (error) {
      const message = t('connections.ai.connectFailed', { message: error instanceof Error ? error.message : String(error) });
      setProblem(connectedOne ? `${t('connections.ai.half')} ${message}` : message);
    } finally {
      setKey('');
      setBusy(false);
    }
  }

  return (
    <Inner card={false} className={s.connect}>
      {needsKey && (
        <Field
          label={t('connections.ai.key', { name: choice.keyName })}
          hint={[lead.keyHint, t('connections.ai.keyHint')].filter(Boolean).join('. ')}
          type="password" autoComplete="off" spellCheck={false} value={key} disabled={busy}
          onChange={(event) => setKey(event.currentTarget.value)}
        />
      )}
      {lead.modelEditable && <Field label={t('connections.ai.model')} value={model} maxLength={64} onChange={(event) => setModel(event.currentTarget.value)} />}
      {lead.runsOn === 'provider-api' && (
        <Field label={t('connections.ai.cap')} hint={t('connections.ai.capHint')} inputMode="decimal" value={cap} onChange={(event) => setCap(event.currentTarget.value)} />
      )}
      <div>
        <h4 className={s.groupLabel}>{t('connections.ai.consent')}</h4>
        {consents.map((text) => <p key={text} className={s.consent}>{text}</p>)}
      </div>
      <label className={s.agree}>
        <input type="checkbox" checked={agree} onChange={(event) => setAgree(event.currentTarget.checked)} />
        {t('connections.ai.agree')}
      </label>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      <div className={s.buttons}>
        <Button onClick={onCancel}>{t('connections.ai.cancel')}</Button>
        <Button variant="primary" disabled={busy || !agree} onClick={() => void connect()}>{lead.id === TEMPLATES ? t('connections.ai.useTemplates') : t('connections.ai.connect')}</Button>
      </div>
    </Inner>
  );
}
