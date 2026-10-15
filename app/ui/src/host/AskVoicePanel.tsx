/**
 * The voice panel under the ask line (SH-05), drawn from the voice controller's snapshot.
 * The words as they are heard; then the question as text; any amount or date shown back
 * large, "₹2,00,000. Is that right?", with Yes and Change; a word such as "nahi" named as
 * changing the meaning. "Ask this" is the confirmation as text, and only then does the
 * question go to Ask. Change puts the words in the field to be edited and typed.
 */
import { useSyncExternalStore } from 'react';
import { useT } from '../app/text';
import { Button } from '../parts/Button';
import { State } from '../patterns/States';
import { money } from '../format/money.ts';
import type { VoiceController, VoiceSnapshot } from './voice-controller.ts';
import type { VoiceStatus } from '../bridge/voice-contract.ts';
import s from './AskVoicePanel.module.css';

/** "Paid speech: ₹2 a minute. 3 minutes this month, ₹6." or "on this computer". */
export function voiceModeKey(status: VoiceStatus): { key: string; vars: Record<string, string> } | null {
  if (!status.enabled) return null;
  if (status.mode === 'paid') {
    const minutes = String(Math.round(status.usage.totals.minutesMs / 60000));
    const rate = status.provider?.ratePerMinuteMinor ?? null;
    const spent = status.usage.totals.costMinor;
    if (rate === null || spent === 'not counted') return { key: 'SH-05.paid.notCounted', vars: { minutes } };
    return { key: 'SH-05.paid', vars: { cost: money(rate), minutes, spent: money(spent) } };
  }
  return status.mode === 'off' ? null : { key: 'SH-05.local', vars: {} };
}

export function AskVoicePanel({ voice, ask, edit, onOpenModels }: {
  voice: VoiceController;
  ask: (text: string) => void;
  edit: (text: string) => void;
  onOpenModels: () => void;
}) {
  const t = useT();
  const snap: VoiceSnapshot = useSyncExternalStore(voice.subscribe, voice.snapshot, voice.snapshot);
  const p = snap.phase;
  if (p.kind === 'idle') return null;
  const status = snap.status.kind === 'ready' ? snap.status.value : null;
  const mode = status !== null ? voiceModeKey(status) : null;
  const close = <Button variant="link" onClick={() => voice.reset()}>{t('BTN.close')}</Button>;
  const change = (text: string) => { voice.reset(); edit(text); };

  let body;
  switch (p.kind) {
    case 'starting':
    case 'listening':
      body = <>
        <p role="status" className={s.state}>{t('SH-04.listening')}</p>
        <p className={s.words} aria-live="polite" data-voice-words="">{p.kind === 'listening' ? p.words : ''}</p>
      </>;
      break;
    case 'reading':
      body = <>
        <p role="status" className={s.state}>{t('SH-05.reading')}</p>
        {p.words.length > 0 && <p className={s.words}>{p.words}</p>}
      </>;
      break;
    case 'approval':
      body = <p role="status" className={s.state}>{t('SH-05.approval', { cap: money(p.costCapMinor) })}{' '}
        <Button variant="link" onClick={onOpenModels}>{t('SH-05.openModels')}</Button></p>;
      break;
    case 'heard': {
      const pending = p.answers.findIndex(a => a !== true);
      const back = pending >= 0 ? p.readBacks[pending]! : null;
      body = <>
        <p className={s.question} data-voice-question="">{t('SH-05.question', { text: p.text })}</p>
        {p.flips.map(word => <p key={word} className={s.flip} data-voice-flip="">{t('SH-05.flips', { word })}</p>)}
        {back !== null ? <div className={s.readBack} data-voice-readback={back.kind}>
          <p className={s.big} role="status">{t('TD-02.voice.confirm', { amount: back.kind === 'amount' ? money(back.paise) : back.text })}</p>
          <span className={s.buttons}>
            <Button variant="filled" onClick={() => voice.answer(pending, true)}>{t('BTN.yes')}</Button>
            <Button variant="quiet" onClick={() => change(p.text)}>{t('BTN.change')}</Button>
          </span>
        </div> : <span className={s.buttons}>
          <Button variant="filled" disabled={p.confirming} onClick={() => { void voice.confirm().then(text => { if (text !== null) ask(text); }); }}>{t('SH-05.askThis')}</Button>
          <Button variant="quiet" onClick={() => change(p.text)}>{t('BTN.change')}</Button>
        </span>}
      </>;
      break;
    }
    case 'unsure':
      body = <p role="status" className={s.state} data-voice-unsure="">
        {t('TD-02.voice.unsure')}{p.words.length > 0 ? ` ${t('TD-02.voice.heard', { words: p.words })}` : ''}
      </p>;
      break;
    case 'off':
      body = <p role="status" className={s.state}>{t('SH-04.mic.off')}</p>;
      break;
    case 'local-only':
      body = <p role="status" className={s.state}>{t('SH-05.localOnly')}</p>;
      break;
    case 'not-built':
      body = <State state={{ kind: 'not-built' }} />;
      break;
    case 'failed':
      body = <p role="status" className={s.state} data-voice-failed={p.code}>{t(p.code === 'UNDERSTOOD_CHANGED' ? 'SH-05.changed' : 'SH-05.failed')}</p>;
      break;
  }
  return <div className={s.panel} data-voice-phase={p.kind}>
    {mode !== null && <p className={s.mode} data-voice-mode={status?.mode}>{t(mode.key, mode.vars)}</p>}
    {body}
    {p.kind !== 'starting' && p.kind !== 'listening' && close}
  </div>;
}

/** Read an answer aloud from its receipt (`voice.speak`), and Stop speaking. Drawn only while voice is on. */
export function SpeakReceipt({ voice, receiptId, language }: { voice: VoiceController; receiptId: string; language: 'en' | 'hi' }) {
  const t = useT();
  const snap = useSyncExternalStore(voice.subscribe, voice.snapshot, voice.snapshot);
  if (snap.status.kind !== 'ready' || !snap.status.value.enabled) return null;
  const speaking = snap.speak.kind === 'speaking' && snap.speak.receiptId === receiptId;
  return <p className={s.speak} data-voice-speak={snap.speak.kind}>
    {speaking ? <>
      <span role="status">{t('SH-05.speaking')}</span>{' '}
      <Button variant="quiet" onClick={() => voice.stopSpeaking()}>{t('SH-05.stopSpeaking')}</Button>
    </> : <Button variant="quiet" disabled={snap.speak.kind === 'reading'} onClick={() => { void voice.speak(receiptId, language); }}>{t('SH-05.speak')}</Button>}
    {snap.speak.kind === 'not-built' && <span className={s.state}>{t('SH-05.notBuilt')}</span>}
    {snap.speak.kind === 'failed' && <span className={s.state}>{t('SH-05.speakFailed')}</span>}
  </p>;
}
