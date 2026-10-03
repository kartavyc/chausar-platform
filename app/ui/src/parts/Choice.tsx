/**
 * Choice. A yes-or-no choice is a pair of words, No and Yes, with the chosen one in ink.
 * A choice among a few options is a row of words with the chosen one underlined.
 * The label is always visible. Radio semantics, arrow keys move within the group.
 */

import { useId, type KeyboardEvent } from 'react';
import { useT } from '../app/text';
import s from './Choice.module.css';

export interface ChoiceOption<V extends string> {
  value: V;
  label: string;
}

export interface ChoiceProps<V extends string> {
  label: string;
  /** Hide the label visually while keeping it for screen readers. */
  labelHidden?: boolean | undefined;
  options: ReadonlyArray<ChoiceOption<V>>;
  value: V | null;
  onChange: (value: V) => void;
  /** No and Yes as a pair, or a row of words. */
  form?: 'pair' | 'words' | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

export function Choice<V extends string>({
  label,
  labelHidden = false,
  options,
  value,
  onChange,
  form = 'words',
  disabled = false,
  className,
}: ChoiceProps<V>) {
  const id = useId();

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || options.length === 0) return;
    const i = options.findIndex((o) => o.value === value);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % options.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + options.length) % options.length;
    if (next >= 0) {
      e.preventDefault();
      const o = options[next];
      if (o) onChange(o.value);
    }
  };

  return (
    <div className={[s.choice, s[form], className].filter(Boolean).join(' ')}>
      <span id={id} className={labelHidden ? 'sr' : s.label}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className={s.words} onKeyDown={onKey}>
        {options.map((o) => {
          const chosen = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={chosen}
              tabIndex={chosen || (value === null && o === options[0]) ? 0 : -1}
              disabled={disabled}
              className={[s.word, chosen ? s.chosen : ''].join(' ')}
              onClick={() => onChange(o.value)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The fixed No and Yes pair. */
export function YesNo({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean | null;
  onChange: (yes: boolean) => void;
  disabled?: boolean | undefined;
}) {
  const t = useT();
  return (
    <Choice<'no' | 'yes'>
      label={label}
      labelHidden
      form="pair"
      options={[
        { value: 'no', label: t('CHOICE.no') },
        { value: 'yes', label: t('CHOICE.yes') },
      ]}
      value={value === null ? null : value ? 'yes' : 'no'}
      onChange={(v) => onChange(v === 'yes')}
      disabled={disabled}
    />
  );
}
