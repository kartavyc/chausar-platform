import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Inner } from '../../parts/Card';
import { Chip, type ChipTone } from '../../parts/Chip';
import { Field } from '../../parts/Field';
import { Icon } from '../../parts/Icon';
import { Row } from '../../parts/Row';
import { Tile } from '../../parts/Tile';
import type { ModelAvailability, ModelConnectParams, ModelPresetLite, ModelStatusLite, ModelTier, ModelTierLite } from '../../engine/types';
import { useCliChecks } from './CliStatus';
import s from './Connections.module.css';

/** The built-in templates' preset id: no AI, nothing sent (Your AI and the agent panel's Its AI). */
export const TEMPLATES = 'built-in-templates';
const HAIKU = 'anthropic-haiku-5-5';
const SONNET = 'anthropic-sonnet-5-5';
const CONNECTABLE = new Set(['ready', 'unverified']);
/** How the owner pays for each choice: their own key with the AI company, their own AI app on this computer, or no AI. */
const RUNS_ON: readonly ModelPresetLite['runsOn'][] = ['provider-api', 'this-computer', 'chausar-engine'];
/** The availability chip's tone: words always say it; colour only repeats it. */
const AVAILABILITY_TONE: Readonly<Record<ModelAvailability, ChipTone>> = { ready: 'line', unverified: 'line', 'needs-setup': 'wait', unavailable: 'idle' };

interface Choice { id: string; title: string; presets: { preset: ModelPresetLite; tiers?: ModelTier[] }[]; keyName: string }

/**
 * Your AI, the first tile on Connections: which AI does each job, what this month cost (as the engine writes it), the
 * connections with Disconnect, and the AI that can be added. The owner pays for AI directly, with their own key or
 * their own AI app on this computer (founder, 23 Oct); "Every choice" groups the choices that way, each with whether
 * it can connect and the engine's one fix line. Inside a business this is venture.models.*; before any business exists
 * it is the draft desk, venture.ai.*. A key is typed into a password field, sent once with Connect, cleared at once,
 * and never shown again: the engine only ever says whether one is loaded. On the desktop the privacy rule sits beside
 * it as a tile of its own (transcription sits beside What Chausar can do, index.tsx). What the engine found of the
 * owner's Claude Code and Codex is the tile under this one (CliStatus.tsx, W4 4H2); each of its Check again reads the
 * choices here again, since their availability comes from the same look. A choice the engine says is unavailable and
 * runs on this computer is not listed: on the hosted app that is every command-line tool, so it lists keys only.
 */
export function YourAi({ focus }: { focus: boolean }) {
  const t = useT();
  const client = useEngine();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const venture = useResource('venture.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const known = venture.data !== undefined || venture.error !== undefined;
  const draft = known && !venture.data;
  // A business switch arrives as queue.changed: read again for the business now open.
  const changed = { refreshOn: (event: { type: string }) => event.type === 'queue.changed' };
  const status = useResource(draft ? 'venture.ai.status' : 'venture.models.status', {}, { skip: !known, ...changed });
  const vaultPresets = useResource('venture.models.presets', {}, { skip: !known || draft, ...changed });
  const draftOptions = useResource('venture.ai.options', {}, { skip: !draft, ...changed });
  const presets = (draft ? draftOptions.data?.presets : vaultPresets.data) ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState<{ text: string; problem: boolean } | null>(null);
  const checks = useCliChecks();
  const reloadPresets = draft ? draftOptions.reload : vaultPresets.reload;

  useEffect(() => { if (focus) heading.current?.focus(); }, [focus]);
  // A fresh look at the command-line tools changes their availability here too.
  useEffect(() => { if (checks > 0 && known) reloadPresets(); }, [checks]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = (presetId: string) => presets.find((p) => p.id === presetId)?.label ?? presetId;
  const tierName = (tier: ModelTierLite) => (tier.presetId === TEMPLATES ? tier.reason : `${label(tier.presetId)}${tier.usable ? '' : `. ${tier.reason}`}`);

  async function disconnect(connectionId: string) {
    setSaid(null);
    try {
      await client.request(draft ? 'venture.ai.disconnect' : 'venture.models.disconnect', { connectionId });
      status.reload();
    } catch (error) {
      setSaid({ text: t('connections.ai.disconnectFailed', { message: error instanceof Error ? error.message : String(error) }), problem: true });
    }
  }

  const haiku = presets.find((p) => p.id === HAIKU);
  const sonnet = presets.find((p) => p.id === SONNET);
  const recommended: Choice | null = haiku && sonnet
    ? { id: 'recommended', title: t('connections.ai.recommended'), presets: [{ preset: haiku, tiers: ['fast'] }, { preset: sonnet, tiers: ['main'] }], keyName: 'Anthropic' }
    : null;
  // An AI app that cannot run here at all (the engine says unavailable: the hosted app) is not a choice to list.
  const listed = presets.filter((preset) => !(preset.availability === 'unavailable' && preset.runsOn === 'this-computer'));
  const singles: Choice[] = listed.map((preset) => ({ id: preset.id, title: preset.label, presets: [{ preset }], keyName: preset.label }));

  function choiceRow(choice: Choice) {
    const lead = choice.presets[0]!.preset;
    const canConnect = choice.presets.every(({ preset }) => CONNECTABLE.has(preset.availability));
    const note = lead.verificationNote && !lead.availabilityReason.includes(lead.verificationNote) ? lead.verificationNote : null;
    const line = choice.id === 'recommended'
      ? `${t('connections.ai.recommendedLine')} ${lead.availabilityReason}`
      : <><span className={s.fixLine} data-fix-line="">{lead.availabilityReason}</span>{note && <span className={s.quiet}> {note}</span>}</>;
    return (
      <Row
        key={choice.id}
        id={`ai-add-${choice.id}`}
        title={choice.title}
        line={line}
        aside={choice.id === 'recommended' ? undefined : (
          <span data-availability={lead.availability}><Chip tone={AVAILABILITY_TONE[lead.availability] ?? 'neutral'}>{t(`connections.ai.availability.${lead.availability}`)}</Chip></span>
        )}
        actions={canConnect && open !== choice.id ? (
          <Button size="sm" onClick={() => { setOpen(choice.id); setSaid(null); }}>{lead.id === TEMPLATES ? t('connections.ai.useTemplates') : t('connections.ai.connect')}</Button>
        ) : undefined}
      >
        {open === choice.id && (
          <ConnectForm
            choice={choice}
            draft={draft}
            onCancel={() => setOpen(null)}
            onDone={(text) => { setOpen(null); setSaid({ text, problem: false }); status.reload(); }}
          />
        )}
      </Row>
    );
  }

  const data: ModelStatusLite | undefined = status.data;
  const connected = data?.connections.filter((c) => c.status === 'connected') ?? [];
  const bothTemplates = data && data.tiers.fast.presetId === TEMPLATES && data.tiers.main.presetId === TEMPLATES;
  // The privacy rule is this computer's, so only the desktop app inside a business shows it.
  const side = Boolean(data) && !draft && client.transport !== 'hosted';

  return (
    <div className={s.top} data-side={side ? undefined : 'none'}>
      <Tile as="section" labelledBy={headingId}>
        <div className={s.head}>
          <h2 id={headingId} ref={heading} tabIndex={-1} className={s.title}>{t('connections.ai.title')}</h2>
        </div>
        {draft && <p className={s.note}>{t('connections.ai.draft')}</p>}
        {status.error && <p className={s.problem} role="alert">{t('connections.ai.failed', { message: status.error.message })}</p>}
        {!data && !status.error && <p className={s.note}>{t('connections.ai.loading')}</p>}
        {data && (
          <>
            <div className={s.jobs} data-one={bothTemplates ? '' : undefined}>
              {bothTemplates ? (
                <Inner card={false} className={s.job}><span className={s.jobIcon} aria-hidden="true"><Icon name="bot" size={16} /></span><span>{data.tiers.main.reason}</span></Inner>
              ) : (
                (['fast', 'main'] as const).map((tier) => (
                  <Inner key={tier} card={false} className={s.job}>
                    <span className={s.jobIcon} aria-hidden="true"><Icon name="bot" size={16} /></span>
                    <span>{t('connections.ai.tier', { job: t(`connections.ai.job.${tier}`), name: tierName(data.tiers[tier]) })}</span>
                  </Inner>
                ))
              )}
            </div>
            {/* The month's spend as the engine writes it, with no receipt until W4 4J1: its words, marked so. */}
            <p className={s.spend}><span data-engine-line="">{t('connections.ai.spent', { amount: data.spentThisMonthDisplay })}</span></p>
            <p className={s.note}>{t('connections.ai.spendNote')}</p>
            {data.sendPolicy === 'nothing' && <p className={s.note}>{t('connections.ai.sendNothing')}</p>}
            {data.replay.active && <p className={s.note}>{t('connections.ai.replay')}</p>}
            {connected.length > 0 && (
              <ul className={s.rows} aria-label={t('connections.ai.connected')}>
                {connected.map((connection) => (
                  <Row
                    key={connection.id}
                    id={`ai-${connection.id}`}
                    mark={<span className={s.mini} aria-hidden="true"><Icon name="bot" size={16} /></span>}
                    title={label(connection.presetId)}
                    line={[connection.tiers.map((tier) => t(`connections.ai.job.${tier}`)).join(', '), connection.model, connection.usable ? connection.verificationNote : connection.reason].filter(Boolean).join(' · ')}
                    actions={<Button size="sm" onClick={() => void disconnect(connection.id)}>{t('connections.ai.disconnect')}</Button>}
                  />
                ))}
              </ul>
            )}
          </>
        )}
        {said && <p className={said.problem ? s.problem : s.said} role="status">{said.text}</p>}
        {presets.length > 0 && (
          <>
            <h3 className={s.subheading}>{t('connections.ai.add')}</h3>
            {/* The recommended pair at rest; every single choice, grouped by how it is paid for, one fold away. */}
            {recommended && <ul className={s.rows}>{choiceRow(recommended)}</ul>}
            <details className={s.fold}>
              <summary>{t('connections.ai.every')}</summary>
              {RUNS_ON.map((runsOn) => {
                const here = singles.filter((choice) => choice.presets[0]!.preset.runsOn === runsOn);
                return here.length === 0 ? null : (
                  <div key={runsOn} className={s.choiceGroup} data-runs-on={runsOn}>
                    {/* Under "Add an AI" (a level 3 heading), each group is a level 4 heading. */}
                    <h4 className={s.groupLabel}>{t(`connections.ai.group.${runsOn}`)}</h4>
                    <ul className={s.rows}>{here.map(choiceRow)}</ul>
                  </div>
                );
              })}
            </details>
          </>
        )}
      </Tile>
      {side && data && (
        <div className={s.side}>
          <SendRule now={data.sendPolicy} onSaved={() => status.reload()} />
        </div>
      )}
    </div>
  );
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
