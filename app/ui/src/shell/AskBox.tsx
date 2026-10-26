/**
 * "Ask Chausar anything" (W4 4C2; D's `button.ask` in every page header, beside the bell): a box the owner types a
 * question into. Enter, or Ctrl K from anywhere, opens a new chat with the words in its composer, unsent (shell/ask.ts).
 * It sits only beside the rail; a phone has the Chats tab instead. The shortcut shows as keys (the same in Hindi), and
 * only while the box has focus or the pointer is over it, so it adds nothing to a page at rest.
 */

import { useEffect, useId, useState, type FormEvent } from 'react';
import { useT } from '../text';
import { cx } from '../parts/cx';
import { Icon } from '../parts/Icon';
import { askChausar, onAsk, setAskDraft } from './ask';
import s from './AskBox.module.css';

const KEYS = 'Ctrl K';

export function AskBox() {
  const t = useT();
  const id = useId();
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  useEffect(() => onAsk(() => setText('')), []);

  function submit(event: FormEvent) {
    event.preventDefault();
    askChausar(text);
  }

  return (
    <form className={s.ask} onSubmit={submit} data-ask-box="" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <Icon name="sparkles" size={16} className={s.icon} />
      <label className="sr-only" htmlFor={id}>{t('ask.label')}</label>
      <input
        id={id}
        className={s.input}
        type="text"
        value={text}
        placeholder={t('ask.label')}
        autoComplete="off"
        enterKeyHint="send"
        aria-keyshortcuts="Control+K"
        onChange={(event) => { setText(event.target.value); setAskDraft(event.target.value); }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {(focused || hovered) && <kbd className={cx(s.keys, 'mono')} aria-hidden="true">{KEYS}</kbd>}
    </form>
  );
}
