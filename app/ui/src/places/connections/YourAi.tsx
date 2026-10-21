import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Row } from '../../parts/Row';
import type { ModelConnectParams, ModelPresetLite, ModelStatusLite, ModelTier, ModelTierLite } from '../../engine/types';
import s from './Connections.module.css';

const TEMPLATES = 'built-in-templates';
const HAIKU = 'anthropic-haiku-5-5';
const SONNET = 'anthropic-sonnet-5-5';
const CONNECTABLE = new Set(['ready', 'unverified']);

interface Choice { id: string; title: string; presets: { preset: ModelPresetLite; tiers?: ModelTier[] }[]; keyName: string }

/**
 * Your AI: which AI does each job, what this month cost (as the engine writes it), the connections with Disconnect,
 * and the AI that can be added. Inside a business this is venture.models.*; before any business exists it is the
 * draft desk, venture.ai.*. A key is typed into a password field, sent once with Connect, cleared at once, and never
 * shown again: the engine only ever says whether one is loaded.
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

  useEffect(() => { if (focus) heading.current?.focus(); }, [focus]);

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
  const choices: Choice[] = [
    ...(haiku && sonnet ? [{ id: 'recommended', title: t('connections.ai.recommended'), presets: [{ preset: haiku, tiers: ['fast'] as ModelTier[] }, { preset: sonnet, tiers: ['main'] as ModelTier[] }], keyName: 'Anthropic' }] : []),
    ...presets.map((preset) => ({ id: preset.id, title: preset.label, presets: [{ preset }], keyName: preset.label })),
  ];
  function choiceRow(choice: Choice) {
    const lead = choice.presets[0]!.preset;
    const canConnect = choice.presets.every(({ preset }) => CONNECTABLE.has(preset.availability));
    const note = lead.verificationNote && !lead.availabilityReason.includes(lead.verificationNote) ? ` ${lead.verificationNote}` : '';
    const line = choice.id === 'recommended'
      ? `${t('connections.ai.recommendedLine')} ${lead.availabilityReason}`
      : `${t(`connections.ai.availability.${lead.availability}`)} · ${lead.availabilityReason}${note}`;
    return (
      <Row
        key={choice.id}
        id={`ai-add-${choice.id}`}
        title={choice.title}
        line={line}
        actions={canConnect && open !== choice.id ? (
          <Button onClick={() => { setOpen(choice.id); setSaid(null); }}>{lead.id === TEMPLATES ? t('connections.ai.useTemplates') : t('connections.ai.connect')}</Button>
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

  return (
    <section className={s.group} aria-labelledby={headingId}>
      <h2 id={headingId} ref={heading} tabIndex={-1} className={s.heading}>{t('connections.ai.title')}</h2>
      {draft && <p className={s.note}>{t('connections.ai.draft')}</p>}
      {status.error && <p className={s.problem} role="alert">{t('connections.ai.failed', { message: status.error.message })}</p>}
      {!data && !status.error && <p className={s.note}>{t('connections.ai.loading')}</p>}
      {data && (
        <>
          {bothTemplates ? (
            <p className={s.line}>{data.tiers.main.reason}</p>
          ) : (
            <ul className={s.tiers}>
              {(['fast', 'main'] as const).map((tier) => (
                <li key={tier}>{t('connections.ai.tier', { job: t(`connections.ai.job.${tier}`), name: tierName(data.tiers[tier]) })}</li>
              ))}
            </ul>
          )}
          <p className={s.line}>{t('connections.ai.spent', { amount: data.spentThisMonthDisplay })}</p>
          <p className={s.note}>{t('connections.ai.spendNote')}</p>
          {data.sendPolicy === 'nothing' && <p className={s.note}>{t('connections.ai.sendNothing')}</p>}
          {data.replay.active && <p className={s.note}>{t('connections.ai.replay')}</p>}
          {connected.length > 0 && (
            <ul className={s.list} aria-label={t('connections.ai.connected')}>
              {connected.map((connection) => (
                <Row
                  key={connection.id}
                  id={`ai-${connection.id}`}
                  title={label(connection.presetId)}
                  line={[connection.tiers.map((tier) => t(`connections.ai.job.${tier}`)).join(', '), connection.model, connection.usable ? connection.verificationNote : connection.reason].filter(Boolean).join(' · ')}
                  actions={<Button onClick={() => void disconnect(connection.id)}>{t('connections.ai.disconnect')}</Button>}
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
          {/* The recommended pair at rest; every single choice, with each one's own availability, one fold away. */}
          <ul className={s.list}>{choices.filter((c) => c.id === 'recommended').map(choiceRow)}</ul>
          <details className={s.fold}>
            <summary>{t('connections.ai.every')}</summary>
            <ul className={s.list}>{choices.filter((c) => c.id !== 'recommended').map(choiceRow)}</ul>
          </details>
        </>
      )}
    </section>
  );
}

/** The consent words exactly as the engine wrote them, I agree, then Connect. The key never outlives the click. */
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

  async function submit(event: FormEvent) {
    event.preventDefault();
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
      setBusy(false);
    }
  }

  return (
    <form className={s.form} onSubmit={(event) => void submit(event)}>
      {needsKey && (
        <Field
          label={t('connections.ai.key', { name: choice.keyName })}
          hint={[lead.keyHint, t('connections.ai.keyHint')].filter(Boolean).join('. ')}
          type="password" autoComplete="off" spellCheck={false} value={key}
          onChange={(event) => setKey(event.currentTarget.value)}
        />
      )}
      {lead.modelEditable && <Field label={t('connections.ai.model')} value={model} maxLength={64} onChange={(event) => setModel(event.currentTarget.value)} />}
      {lead.runsOn === 'provider-api' && (
        <Field label={t('connections.ai.cap')} hint={t('connections.ai.capHint')} inputMode="decimal" value={cap} onChange={(event) => setCap(event.currentTarget.value)} />
      )}
      <div>
        <h4 className={s.subheading}>{t('connections.ai.consent')}</h4>
        {consents.map((text) => <p key={text} className={s.consent}>{text}</p>)}
      </div>
      <label className={s.agree}>
        <input type="checkbox" checked={agree} onChange={(event) => setAgree(event.currentTarget.checked)} />
        {t('connections.ai.agree')}
      </label>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      <div className={s.buttons}>
        <Button onClick={onCancel}>{t('connections.ai.cancel')}</Button>
        <Button variant="primary" type="submit" disabled={busy || !agree}>{lead.id === TEMPLATES ? t('connections.ai.useTemplates') : t('connections.ai.connect')}</Button>
      </div>
    </form>
  );
}
