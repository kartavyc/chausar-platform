import { messageOf } from '../../../../platform/shared/errors.ts';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '../text';
import { Button } from './Button';
import { cx } from './cx';
import { Icon } from './Icon';
import { InlineError, type InlineFix } from './InlineError';
import s from './Composer.module.css';
import { WaitLine } from './Progress';

export interface ComposerProps {
  /** The box's name, said by screen readers and shown as the placeholder ("Message Editor", "Ask Chausar"). */
  label: string;
  /** A longer placeholder, when the name alone is too short ("Ask Chausar about your businesses"). */
  placeholder?: string | undefined;
  /** Stores the message. The text is cleared only once this resolves; if it rejects the text stays. */
  onSend: (text: string) => Promise<void>;
  /** Short things to ask; a tap puts the words in the box and never sends them. C5 task 8: an idea may carry a preview line. */
  /** A press fills the box and the chip goes. `fill`: the box gets these words, the chip says `label`. */
  suggestions?: readonly (string | { label: string; preview?: string | undefined; fill?: string | undefined })[] | undefined;
  /** The suggestions' name for screen readers, when not plain suggestions. */
  suggestionsLabel?: string | undefined;
  /** One-shot C3 task 11: while a send is on its way, one still line with its elapsed time ("Writing, 8 s"), never dots. */
  waitLabel?: string | undefined;
  /** One quiet line under the box, such as what the agent does without asking. */
  hint?: string | undefined;
  /** Words already in the box when it opens (W4 4C2: an ask from the header or Start), unsent until Send. */
  initial?: string | undefined;
  /** A place's own way to say a known failure, with its fix. Left out, or null, the plain failure line shows. */
  describeFailure?: ((failure: unknown) => ComposerFailure | null) | undefined;
  className?: string | undefined;
}

/** How a place says a failure it knows. */
export interface ComposerFailure {
  words: string;
  tone?: 'failure' | 'expected' | undefined;
  fix?: InlineFix | undefined;
}



/**
 * Where the owner writes to an agent or to Chausar (D's `.cp-comp`, `.cbox`, `.sugs`, `.send`). Enter sends,
 * Shift+Enter starts a new line, and nothing sends while an input method (Hindi, for one) is still composing.
 * What was written is kept until the engine confirms it stored the message (catalogue O22): while sending the box
 * is read-only and the suggestions wait, and a failure leaves the words in place with the reason under them: one short
 * red line, then the long reason in the normal colour, whole (B4 task 4). A send starts once however fast Enter is
 * pressed. Nothing goes to browser storage.
 */
export function Composer({ label, placeholder, onSend, suggestions, suggestionsLabel, hint, initial, describeFailure, className, waitLabel }: ComposerProps) {
  const t = useT();
  const id = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  /** Set the moment a send starts, before React re-renders, so a second Enter or submit can never send twice. */
  const inFlight = useRef(false);
  const [text, setText] = useState(initial ?? '');
  const [sending, setSending] = useState(false);
  /** B4 tasks 14 and 19: a chip already used is gone. */
  const [used, setUsed] = useState<readonly string[]>([]);
  const [error, setError] = useState<{ message: string; known: ComposerFailure | null } | null>(null);
  const empty = text.trim() === '';

  async function send() {
    if (inFlight.current || empty) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      await onSend(text.trim());
      setText('');
    } catch (failure) {
      setError({ message: messageOf(failure), known: describeFailure?.(failure) ?? null });
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void send();
  }

  /** Nothing may change the words while they are on their way: a failed send must leave exactly what was sent. */
  function write(value: string) {
    if (inFlight.current) return;
    setText(value);
    setError(null);
  }

  const described = cx(error !== null && `${id}-error`, hint && `${id}-hint`) || undefined;
  return (
    <form
      className={cx(s.composer, className)}
      aria-label={label}
      aria-busy={sending || undefined}
      onSubmit={(event) => { event.preventDefault(); void send(); }}
    >
      {waitLabel && <WaitLine label={waitLabel} running={sending} />}
      {suggestions && suggestions.length > 0 && (
        <div className={s.suggestions} role="group" aria-label={suggestionsLabel ?? t('composer.suggestions')}>
          {suggestions.map((suggestion) => {
            const words = typeof suggestion === 'string' ? suggestion : suggestion.label;
            const preview = typeof suggestion === 'string' ? undefined : suggestion.preview;
            const fill = typeof suggestion === 'string' ? words : suggestion.fill ?? words;
            if (used.includes(words)) return null;
            return (
              <button
                key={words}
                type="button"
                className={preview === undefined ? s.suggestion : s.idea}
                disabled={sending}
                onClick={() => { write(fill); setUsed((was) => [...was, words]); box.current?.focus(); }}
              >
                {words}
                {preview !== undefined && <span className={s.ideaPreview}>{preview}</span>}
              </button>
            );
          })}
        </div>
      )}
      <div className={s.box} data-sending={sending ? '' : undefined}>
        <label className="sr-only" htmlFor={id}>{label}</label>
        <textarea
          ref={box}
          id={id}
          className={s.text}
          rows={1}
          value={text}
          placeholder={placeholder ?? label}
          readOnly={sending}
          aria-describedby={described}
          onChange={(event) => write(event.target.value)}
          onKeyDown={onKeyDown}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
        />
        <Button variant="primary" type="submit" className={s.send} aria-label={t('composer.send')} disabled={sending || empty}>
          <Icon name="send" size={18} />
        </Button>
      </div>
      {error !== null && (error.known
        ? <InlineError id={`${id}-error`} tone={error.known.tone} fix={error.known.fix}>{error.known.words}</InlineError>
        : <InlineError id={`${id}-error`} detail={error.message}>{t('composer.failed')}</InlineError>)}
      {hint && (
        <p id={`${id}-hint`} className={s.hint}>
          <Icon name="shield-check" size={12} />
          {hint}
        </p>
      )}
    </form>
  );
}
