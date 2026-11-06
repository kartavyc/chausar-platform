import { useState, type KeyboardEvent, type Ref } from 'react';
import { useT } from '../text';
import { Button } from './Button';
import { Field } from './Field';
import s from './PassphraseField.module.css';

export interface PassphraseFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** A passphrase being chosen: it says the length under the field (or `hint`, the caller's fuller words). */
  isNew?: boolean | undefined;
  hint?: string | undefined;
  autoComplete?: string | undefined;
  autoFocus?: boolean | undefined;
  disabled?: boolean | undefined;
  inputRef?: Ref<HTMLInputElement> | undefined;
}

/**
 * One-shot C4 task 35: a passphrase field. "Show" switches the type and is named for readers; "Caps Lock is on" shows
 * while typing with it on (getModifierState, read on each key); a new one says its length. The words live only in the
 * field: nothing here keeps or sends them.
 */
export function PassphraseField({ label, value, onChange, isNew, hint, autoComplete, autoFocus, disabled, inputRef }: PassphraseFieldProps) {
  const t = useT();
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const readCaps = (event: KeyboardEvent<HTMLInputElement>) => setCaps(event.getModifierState?.('CapsLock') === true);
  return (
    <div className={s.passphrase}>
      <Field
        label={label} type={shown ? 'text' : 'password'} spellCheck={false} autoCapitalize="off" autoCorrect="off"
        autoComplete={autoComplete} autoFocus={autoFocus} disabled={disabled} ref={inputRef} value={value}
        hint={hint ?? (isNew ? t('custody.atLeast12') : undefined)}
        onChange={(event) => onChange(event.currentTarget.value)} onKeyDown={readCaps} onKeyUp={readCaps} onBlur={() => setCaps(false)}
      />
      <div className={s.under}>
        <Button
          variant="quiet" size="sm" aria-pressed={shown} aria-label={t(shown ? 'custody.hideField' : 'custody.showField', { name: label })}
          onClick={() => setShown((was) => !was)}
        >
          {t(shown ? 'custody.hide' : 'custody.show')}
        </Button>
        {caps && <span className={s.caps} role="status">{t('custody.capsLock')}</span>}
      </div>
    </div>
  );
}
