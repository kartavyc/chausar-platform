/**
 * Today's cash by voice (TD-02, SH-05). Hold to say it; the words heard go to
 * `modelsx.speechInterpret` (voice-cash.ts); any amount comes back large, "₹2,00,000. Is that
 * right?", with Yes and Change. Nothing is saved until Yes, and then only through the same
 * `onSave` the typed field uses, so the figure is stored as told by owner. Change saves
 * nothing and goes back to the field. Voice is off by default; off, the button opens the
 * setting. The hold is the ask line's own `useVoiceHold`: it always ends.
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useLanguage, useT } from '../../app/text';
import { useVoiceHold } from '../../app/AskLine';
import { Button } from '../../parts/Button';
import { State } from '../../patterns/States';
import { money } from '../../format/money.ts';
import { interpretCash, rupeesText, type CashHeard, type CashVoiceCapability } from './voice-cash.ts';
import s from './Today.module.css';

type Phase = { readonly kind: 'idle' } | { readonly kind: 'listening' } | { readonly kind: 'reading' } | { readonly kind: 'saved' } | CashHeard;

export function CashVoice({ voice, onSave, onChange }: { voice: CashVoiceCapability; onSave: (text: string) => void; onChange?: (() => void) | undefined }) {
  const t = useT();
  const language = useLanguage();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const turn = useRef(0);

  const hold = useVoiceHold({
    on: voice.on,
    onOpenSettings: () => voice.onOpenSettings?.(),
    onHoldStart: () => {
      turn.current++;
      if (voice.listen === undefined) { setPhase({ kind: 'not-built' }); return; }
      setPhase({ kind: 'listening' });
      voice.listen.start();
    },
    onHoldEnd: () => {
      const mine = turn.current, listen = voice.listen;
      if (listen === undefined) return;
      setPhase({ kind: 'reading' });
      void listen.stop().then(
        (words) => interpretCash(voice.rpc, words ?? '', language),
        (): CashHeard => ({ kind: 'failed', code: 'REQUEST_FAILED' }),
      ).then((heard) => { if (mine === turn.current) setPhase(heard); });
    },
  });

  if (!voice.on) {
    return voice.onOpenSettings ? <Button variant="quiet" onClick={voice.onOpenSettings}>{t('SH-04.mic.off.short')}</Button> : null;
  }

  const press = {
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture?.(e.pointerId); hold.start(); },
    onPointerUp: hold.end, onPointerCancel: hold.end, onLostPointerCapture: hold.end, onBlur: hold.end,
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); hold.start(); } },
    onKeyUp: (e: KeyboardEvent<HTMLButtonElement>) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); hold.end(); } },
  };
  const again = () => { turn.current++; setPhase({ kind: 'idle' }); };

  return (
    <div className={s.cashVoice} data-cash-voice={phase.kind}>
      {phase.kind === 'amount' ? (
        <>
          <p className={s.cashHeard} role="status">{t('TD-02.voice.confirm', { amount: money(phase.paise) })}</p>
          {phase.heard.length > 0 && <p className={s.missing}>{t('TD-02.voice.heard', { words: phase.heard })}</p>}
          <span className={s.cashForm}>
            <Button variant="filled" onClick={() => { onSave(rupeesText(phase.paise)); turn.current++; setPhase({ kind: 'saved' }); }}>{t('BTN.yes')}</Button>
            <Button variant="quiet" onClick={() => { again(); onChange?.(); }}>{t('BTN.change')}</Button>
          </span>
        </>
      ) : (
        <>
          <Button variant="quiet" aria-pressed={phase.kind === 'listening' ? true : undefined} {...press}>
            {phase.kind === 'listening' ? t('TD-02.voice.listening') : t('TD-02.voice.hold')}
          </Button>
          {phase.kind === 'not-built' && <State state={{ kind: 'not-built' }} />}
          {phase.kind === 'unsure' && (
            <p className={s.missing} role="status">
              {t('TD-02.voice.unsure')}{phase.heard.length > 0 ? ` ${t('TD-02.voice.heard', { words: phase.heard })}` : ''}
            </p>
          )}
          {phase.kind === 'failed' && <p className={s.missing} role="status">{t('TD-02.voice.failed')}</p>}
          {phase.kind === 'saved' && <p className={s.missing} role="status">{t('TD-02.voice.saved')}</p>}
        </>
      )}
    </div>
  );
}
