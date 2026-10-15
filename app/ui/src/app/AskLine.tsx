/**
 * The ask line (SH-04): your square, the field, the microphone, "Ctrl K". On every screen
 * except first run and the lock screen. What is typed is data and goes to `onAsk` as
 * text; nothing runs from the ask line alone. Suggestions arrive from the engine already
 * typed; the line never builds them.
 *
 * Hold to talk is a capability the screen is given. It is absent unless supplied and off
 * unless the supplied capability says it is on. A hold is one tracked thing, shared by
 * the microphone and the Ctrl Space chord: it starts once and it always ends. It ends
 * when the pointer is released (anywhere: the button captures the pointer), when the
 * pointer is cancelled or its capture is lost, when either key of the chord comes up,
 * when the window loses focus or is hidden, when voice is switched off, and when the
 * frame goes away. No end depends on Ctrl still being down.
 */

import { forwardRef, useEffect, useId, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useT } from './text';
import { Square } from '../parts/Square';
import { Button } from '../parts/Button';
import { submittedQuestion } from './ask-question.ts';
import s from './AskLine.module.css';

export interface AskSuggestion {
  id: string;
  text: string;
  /** calculation, customer, place, saved answer: a text key suffix. */
  kind: 'calculation' | 'customer' | 'place' | 'saved';
}

export interface AskVoice {
  /** Off by default: the adapter passes true only when the person switched voice on. */
  on: boolean;
  listening?: boolean | undefined;
  /** Cost per minute, already formatted, when paid speech is in use. */
  costPerMinute?: string | undefined;
  onHoldStart: () => void;
  onHoldEnd: () => void;
  /** Voice is off: the microphone opens Trust, Rules, Send. */
  onOpenSettings: () => void;
  /** Voice is not built on this computer or engine yet: the microphone says so. */
  notBuilt?: boolean | undefined;
}

export interface AskLineProps {
  onAsk: (text: string) => void;
  onChange?: ((text: string) => void) | undefined;
  suggestions?: ReadonlyArray<AskSuggestion> | undefined;
  /** A picked suggestion. Returning text sends it as the question (a calculation or saved answer goes to Ask). */
  onPick?: ((id: string) => string | void) | undefined;
  /** "About: Kiran Retail Demo" with a way to clear it. */
  about?: { name: string; onClear: () => void } | undefined;
  voice?: AskVoice | undefined;
  /** No AI model connected: the menu is the way to ask. */
  noModel?: boolean | undefined;
  readOnly?: { holder: string } | undefined;
  placeholderKey?: string | undefined;
  /**
   * Every submitted question first, typed or confirmed from voice. Returns true when the host
   * took it (a statement to remember, BK-17) so it does not go to Ask.
   */
  onSubmitted?: ((text: string, by: 'typed' | 'voice') => boolean) | undefined;
  /** The voice panel under the line (SH-05): `ask` sends a confirmed question, `edit` puts text in the field. */
  renderVoice?: ((ask: (text: string) => void, edit: (text: string) => void) => ReactNode) | undefined;
  /** A recorded voice note dropped on the line. */
  onDropNote?: ((file: File) => void) | undefined;
}

/** One hold to talk. `start` does nothing while a hold is on or voice is off; `end` does
 *  nothing when nothing is held, so it is safe to call from every way a hold can end. */
export interface VoiceHold {
  start: () => void;
  end: () => void;
  isHeld: () => boolean;
}

export function useVoiceHold(voice: AskVoice | undefined): VoiceHold {
  /* The end callback of the hold in progress, or null when nothing is held. */
  const release = useRef<(() => void) | null>(null);
  const latest = useRef(voice);
  useEffect(() => {
    latest.current = voice;
  });

  const hold = useMemo<VoiceHold>(
    () => ({
      start: () => {
        const v = latest.current;
        if (!v || !v.on || release.current) return;
        release.current = v.onHoldEnd;
        v.onHoldStart();
      },
      end: () => {
        const done = release.current;
        if (!done) return;
        release.current = null;
        done();
      },
      isHeld: () => release.current !== null,
    }),
    [],
  );

  const on = voice?.on === true;
  useEffect(() => {
    if (!on) {
      hold.end();
      return;
    }
    const hidden = () => {
      if (document.visibilityState === 'hidden') hold.end();
    };
    window.addEventListener('blur', hold.end);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', hold.end);
      document.removeEventListener('visibilitychange', hidden);
      hold.end();
    };
  }, [on, hold]);

  return hold;
}

interface AskLineOwnProps extends AskLineProps {
  /** The frame's one hold, shared with the Ctrl Space chord. */
  hold: VoiceHold;
  /** The Simple view shows a "Hold to talk" button with words. */
  simple?: boolean | undefined;
}

export const AskLine = forwardRef<HTMLInputElement, AskLineOwnProps>(function AskLine(
  { onAsk, onChange, suggestions, onPick, about, voice, hold, simple = false, noModel = false, readOnly, placeholderKey = 'SH-04.placeholder', onSubmitted, renderVoice, onDropNote },
  ref,
) {
  const t = useT();
  const [text, setText] = useState('');
  const [active, setActive] = useState(-1);
  const [closed, setClosed] = useState(false);
  const listId = useId();
  const shown = !closed && suggestions !== undefined && suggestions.length > 0 ? suggestions.slice(0, 5) : [];
  const optionId = (i: number) => `${listId}-o${i}`;
  /* The field is a combobox while its suggestions show; at rest it stays a plain text field. */
  const suggests = shown.length > 0;

  const send = (value: string, by: 'typed' | 'voice') => {
    const v = submittedQuestion(value);
    if (v === null) return;
    if (onSubmitted?.(v, by) === true) return;
    onAsk(v);
  };
  const edit = (value: string) => {
    setText(value); setActive(-1); setClosed(false);
    onChange?.(value);
  };
  const pick = (id: string) => {
    setActive(-1); setClosed(true);
    const question = onPick?.(id);
    if (typeof question === 'string') { send(question, 'typed'); setText(''); }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (active >= 0 && shown[active] && onPick) { pick(shown[active].id); return; }
    if (submittedQuestion(text) === null) return;
    send(text, 'typed');
    setText(''); setActive(-1);
  };
  /* The combobox keys: Down and Up move through the suggestions, Enter picks, Esc closes them. */
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = Math.min(suggestions?.length ?? 0, 5);
    if (n === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      /* Positions -1 (the field) and 0..n-1, round and round. */
      setActive(a => ((a + 1 + d + n + 1) % (n + 1)) - 1);
      setClosed(false);
    } else if (e.key === 'Escape' && shown.length > 0) {
      e.preventDefault(); e.stopPropagation(); setActive(-1); setClosed(true);
    }
  };
  useEffect(() => { setActive(-1); }, [suggestions]);

  /* Voice on: press and hold. The button captures the pointer, so a release outside it
     still ends the hold here. Voice off: a press opens the setting, and nothing listens. */
  const micHandlers = voice
    ? voice.on
      ? {
          onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            hold.start();
          },
          onPointerUp: hold.end,
          onPointerCancel: hold.end,
          onLostPointerCapture: hold.end,
          onBlur: hold.end,
        }
      : { onClick: voice.onOpenSettings }
    : {};
  const micLabel = voice?.notBuilt ? t('SH-05.notBuilt') : voice?.on ? t('SH-04.mic') : t('SH-04.mic.off');

  const mic = voice ? (
    simple ? (
      <Button variant="quiet" className={s.hold} aria-pressed={voice.listening ? true : undefined} {...micHandlers}>
        <MicGlyph /> {voice.on ? t('SH-04.mic') : t('SH-04.mic.off.short')}
      </Button>
    ) : (
      <button
        type="button"
        className={s.mic}
        aria-label={micLabel}
        aria-pressed={voice.listening ? true : undefined}
        title={voice.costPerMinute !== undefined ? t('SH-04.mic.cost', { cost: voice.costPerMinute }) : undefined}
        {...micHandlers}
      >
        <MicGlyph />
      </button>
    )
  ) : null;

  const drop = onDropNote ? {
    onDragOver: (e: DragEvent<HTMLFormElement>) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); },
    onDrop: (e: DragEvent<HTMLFormElement>) => {
      const file = e.dataTransfer.files[0];
      if (!file) return;
      e.preventDefault();
      onDropNote(file);
    },
  } : {};

  return (
    <form className={s.line} role="search" aria-label={t('SH-01.region.ask')} onSubmit={submit} data-region="ask" {...drop}>
      <Square mark="you" wordsKey="MARK.you" />
      {about && (
        <span className={s.about} data-ask-about="">
          <span>{t('SH-04.about', { name: about.name })}</span>
          <Button variant="link" onClick={about.onClear} className={s.aboutClear}>
            {t('SH-04.about.clear')}
          </Button>
        </span>
      )}
      <input
        ref={ref}
        className={s.input}
        type="text"
        value={text}
        placeholder={t(placeholderKey)}
        aria-label={t(placeholderKey)}
        role={suggests ? 'combobox' : undefined}
        aria-autocomplete={suggests ? 'list' : undefined}
        aria-controls={suggests && shown.length > 0 ? listId : undefined}
        aria-expanded={suggests ? shown.length > 0 : undefined}
        aria-activedescendant={active >= 0 && shown[active] ? optionId(active) : undefined}
        onKeyDown={onKeyDown}
        onChange={(e) => edit(e.target.value)}
      />
      {mic}
      {!simple && (
        <span className={[s.key, 'fig'].join(' ')} aria-hidden="true">
          {t('SH-04.key')}
        </span>
      )}
      {voice?.listening && (
        <span className={s.state} role="status">
          {t('SH-04.listening')}
        </span>
      )}
      {noModel && (
        <span className={s.state} role="status">
          {t('SH-04.noModel')}
        </span>
      )}
      {readOnly && <span className={s.state}>{t('SH-04.readOnly', { holder: readOnly.holder })}</span>}
      {renderVoice && <div className={s.voice}>{renderVoice(v => send(v, 'voice'), edit)}</div>}
      {shown.length > 0 && (
        <ul id={listId} className={s.suggestions} role="listbox" aria-label={t('SH-04.suggestions')}>
          {shown.map((sg, i) => (
            <li
              key={sg.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className={[s.suggestion, i === active ? s.active : ''].filter(Boolean).join(' ')}
              data-kind={sg.kind}
              onMouseDown={(e) => e.preventDefault()}
              onClick={onPick ? () => pick(sg.id) : undefined}
            >
              <span>{sg.text}</span>
              <span className={s.kind}>{t(`SH-04.kind.${sg.kind}`)}</span>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
});

/** The microphone: one of the three icons the design allows. */
function MicGlyph() {
  return (
    <svg className={s.glyph} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.5 14.5h5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
