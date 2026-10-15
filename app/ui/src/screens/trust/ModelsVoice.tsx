/**
 * TR-08 Models · the voice row: choose the speech provider and give or withdraw its key
 * (`modelsx.speechCatalogue`, core `speech.configure { config, secret? }`, `modelsx.speechRevoke
 * { providerId }`). The key is typed in a password field, sent once and cleared; the engine
 * answers only whether a key is held, and the screen never shows it. Voice stays off until a
 * provider is chosen (SH-05). Demo mode refuses speech providers, said in words.
 */
import { useState, type FormEvent } from 'react';
import { money } from '../../format/index.ts';
import { words } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Choice } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import { KeyValue, type Pair } from '../../parts/KeyValue';
import { useEngine, useSend } from './kit/engine.ts';
import { Group, Note, Screen } from './kit/Screen';
import { AskTwice, Tag, powers, type P } from './common';
import { ModelsOutcome, modelWords } from './models-kit';
import { KEYED_SPEECH, validateSpeechCatalogue, validateSpeechConfigured, validateSpeechRevoked, type SpeechCatalogue, type SpeechConfigured, type SpeechKind, type SpeechProvider } from './models-replies.ts';
import { rupeesToPaise } from './paise.ts';
import { COMMON } from './words.ts';
import s from './Trust.module.css';

export function ModelsVoiceScreen(p: P) {
  const m = modelWords(p.language);
  const { state, reload } = useEngine(p.rpc, 'modelsx.speechCatalogue', {}, validateSpeechCatalogue);
  return <Screen where={m('voice.where')} title={m('voice.title')} loaded={state}>{(v) => <VoiceBody p={p} v={v} reload={reload} />}</Screen>;
}

function VoiceBody({ p, v, reload }: { p: P; v: SpeechCatalogue; reload: () => void }) {
  const m = modelWords(p.language), c = words(COMMON, p.language);
  const { admin } = powers(p);
  const revoke = useSend(p.rpc, validateSpeechRevoked);
  const [revoking, setRevoking] = useState<string | null>(null);
  const withdraw = async (id: string) => {
    setRevoking(id);
    if (await revoke.send('modelsx.speechRevoke', { providerId: id }) !== null && p.live(p.address)) reload();
  };
  return (
    <>
      <Note>{m('voice.note')}</Note>
      <Group title={m('voice.providersTitle')}>
        <ul className={s.list}>
          {v.providers.map((x) => (
            <li key={x.kind} className={s.item} data-speech-kind={x.kind}>
              <span className={s.itemHead}>
                <span className={s.name}>{x.label}</span>
                <Tag>{m(x.status === 'supported' ? 'supported' : 'experimental')}</Tag>
                <Tag>{m(x.cost === 'free' ? 'voice.free' : 'voice.perMinute')}</Tag>
              </span>
              <p className={s.quiet}>{x.privacyGate}</p>
              {p.view !== 'simple' && <p className={s.quiet}>{x.limits}{x.account !== null && ` ${m('voice.needs', { account: x.account })}`}</p>}
              {x.configured.map((y) => (
                <div key={y.id} className={s.stack} data-speech-provider={y.id}>
                  <KeyValue onReceipt={p.openReceipt} pairs={configuredPairs(p, x, y)} />
                  {admin && y.enabled && (
                    <AskTwice label={m('voice.revoke')} ask={m('voice.revokeAsk', { provider: y.label ?? x.label })} confirmLabel={m('voice.revokeYes')}
                      onConfirm={() => void withdraw(y.id)} language={p.language} disabled={revoke.sent.kind === 'sending'} />
                  )}
                  {revoking === y.id && <ModelsOutcome sent={revoke.sent} language={p.language} done={() => m('voice.revoked')} />}
                </div>
              ))}
            </li>
          ))}
        </ul>
      </Group>
      <Group title={m('voice.chooseTitle')}>
        {admin ? <ProviderForm p={p} providers={v.providers} reload={reload} /> : <Note>{c.adminOnly}</Note>}
      </Group>
    </>
  );
}

function configuredPairs(p: P, x: SpeechProvider, y: SpeechConfigured): Pair[] {
  const m = modelWords(p.language);
  const pairs: Pair[] = [
    { name: m('voice.provider'), value: y.label ?? y.id, mono: y.label === null },
    { name: m('voice.state'), value: m(y.enabled ? 'voice.on' : 'voice.off') },
  ];
  if (KEYED_SPEECH.includes(x.kind)) pairs.push({ name: m('voice.key'), value: m(y.keyHeld ? 'voice.keyHeld' : 'voice.keyMissing') });
  pairs.push({ name: m('voice.rate'), value: y.ratePerMinuteMinor === null ? m('voice.free') : m('voice.rateValue', { rate: money(y.ratePerMinuteMinor) }), mono: y.ratePerMinuteMinor !== null,
    after: y.ratePerMinuteMinor === null ? undefined : <> <Tag>{m('costTag')}</Tag></> });
  if (y.budgetMinor !== null) pairs.push({ name: m('voice.budget'), value: money(y.budgetMinor), mono: true, after: <> <Tag>{m('costTag')}</Tag></> });
  return pairs;
}

/** The settings each kind needs (platform/runtime/speech.ts configure). */
const NEEDS: Readonly<Record<SpeechKind, { model?: 'name' | 'path'; command?: true; language?: 'optional' | 'required'; pipeline?: true }>> = {
  'browser-transcript': {}, 'local-command': { model: 'path', command: true }, 'api-upload': { model: 'name' },
  'sarvam-stt': { model: 'name', language: 'optional' }, 'bhashini-asr': { language: 'required', pipeline: true }, 'live-voice': { model: 'name' },
};

function ProviderForm({ p, providers, reload }: { p: P; providers: readonly SpeechProvider[]; reload: () => void }) {
  const m = modelWords(p.language);
  const [kind, setKind] = useState<SpeechKind | null>(null);
  const [model, setModel] = useState('');
  const [command, setCommand] = useState('');
  const [language, setLanguage] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [rate, setRate] = useState('');
  const [key, setKey] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const { sent, send } = useSend(p.rpc, validateSpeechConfigured);
  const chosen = providers.find((x) => x.kind === kind) ?? null;
  const needs = kind === null ? {} : NEEDS[kind];
  const keyed = kind !== null && KEYED_SPEECH.includes(kind);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (kind === null || chosen === null) { setProblem(m('voice.pickKind')); return; }
    const config: Record<string, unknown> = { kind, enabled: true };
    const existing = chosen.configured[0];
    if (existing !== undefined) config['id'] = existing.id;
    if (needs.model !== undefined && model.trim() !== '') config['model'] = model.trim();
    if (needs.command === true && command.trim() !== '') config['command'] = command.trim();
    if (needs.language !== undefined && language.trim() !== '') config['language'] = language.trim();
    if (needs.pipeline === true) { if (pipelineId.trim() !== '') config['pipelineId'] = pipelineId.trim(); if (serviceId.trim() !== '') config['serviceId'] = serviceId.trim(); }
    if (chosen.cost === 'per-minute' && rate.trim() !== '') {
      const paise = rupeesToPaise(rate);
      if (paise === null) { setProblem(m('voice.badRate')); return; }
      config['ratePerMinuteMinor'] = paise;
    }
    setProblem(undefined);
    const typedKey = key;
    // The key leaves the field as it is sent; it is never kept on the screen.
    setKey('');
    const done = await send('speech.configure', typedKey !== '' && keyed ? { config, secret: typedKey } : { config });
    if (done !== null && p.live(p.address)) reload();
  };
  return (
    <form className={s.form} onSubmit={(e) => void submit(e)} data-speech-form="">
      <Choice label={m('voice.kindField')} options={providers.map((x) => ({ value: x.kind, label: x.label }))} value={kind} onChange={(k) => { setKind(k); setProblem(undefined); }} />
      {needs.model !== undefined && <Field label={m(needs.model === 'path' ? 'voice.modelPath' : 'voice.model')} value={model} onChange={(e) => setModel(e.currentTarget.value)} />}
      {needs.command === true && <Field label={m('voice.command')} value={command} onChange={(e) => setCommand(e.currentTarget.value)} />}
      {needs.language !== undefined && <Field label={m(needs.language === 'required' ? 'voice.language' : 'voice.languageOptional')} value={language} onChange={(e) => setLanguage(e.currentTarget.value)} />}
      {needs.pipeline === true && <Field label={m('voice.pipeline')} value={pipelineId} onChange={(e) => setPipelineId(e.currentTarget.value)} />}
      {needs.pipeline === true && <Field label={m('voice.service')} value={serviceId} onChange={(e) => setServiceId(e.currentTarget.value)} />}
      {chosen?.cost === 'per-minute' && <Field label={m('voice.rateField')} prefix="₹" value={rate} onChange={(e) => setRate(e.currentTarget.value)} inputMode="decimal" />}
      {keyed && (
        <Field label={m(kind === 'bhashini-asr' ? 'voice.keyBhashini' : 'voice.keyField')} type="password" autoComplete="off" spellCheck={false} value={key}
          onChange={(e) => setKey(e.currentTarget.value)} placeholder={chosen !== null && chosen.configured.some((y) => y.keyHeld) ? m('voice.keyKeep') : undefined} />
      )}
      {problem !== undefined && <p className={s.problem} role="status">{problem}</p>}
      <Button submit disabled={sent.kind === 'sending'}>{m('voice.save')}</Button>
      <ModelsOutcome sent={sent} language={p.language} done={(v) => m(v.keyHeld ? 'voice.savedKey' : 'voice.saved')} />
    </form>
  );
}
