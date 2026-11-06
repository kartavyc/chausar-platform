import { useId, type ChangeEvent, type FieldsetHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';
import s from './OptionRows.module.css';

export interface Option<Id extends string> {
  id: Id;
  label: ReactNode;
  /** A line of its own under the words. */
  detail?: ReactNode;
}

export interface OptionRowsProps<Id extends string> extends Omit<FieldsetHTMLAttributes<HTMLFieldSetElement>, 'onChange' | 'children'> {
  legend: ReactNode;
  /** Keep the legend for readers only, when the page already asks the question. */
  legendHidden?: boolean | undefined;
  legendClassName?: string | undefined;
  /** Nothing chosen yet: null. */
  value: Id | null;
  options: readonly Option<Id>[];
  onChange: (id: Id) => void;
}

/** One question with one answer: native radios in plain rows, so arrow keys move within the group. Never chips, which read like filters. */
export function OptionRows<Id extends string>({ legend, legendHidden, legendClassName, value, options, onChange, className, ...rest }: OptionRowsProps<Id>) {
  const name = useId();
  const legendId = `${name}-legend`;
  return (
    <fieldset {...rest} className={cx(s.rows, className)} role="radiogroup" aria-labelledby={legendId}>
      <legend id={legendId} className={cx(legendHidden ? 'sr-only' : s.legend, legendClassName)}>{legend}</legend>
      {options.map((option) => (
        <label key={option.id} className={s.row} data-on={value === option.id ? '' : undefined}>
          <input type="radio" className={s.mark} name={name} value={option.id} checked={value === option.id} onChange={() => onChange(option.id)} />
          <span className={s.words}>
            <span className={s.label}>{option.label}</span>
            {option.detail && <span className={s.detail}>{option.detail}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export interface CheckRowProps {
  label: ReactNode;
  /** A line of its own under the name, never run on after it. */
  detail?: ReactNode;
  checked: boolean;
  disabled?: boolean | undefined;
  onChange: (checked: boolean) => void;
}

/** A checkbox in the same plain row. */
export function CheckRow({ label, detail, checked, disabled, onChange }: CheckRowProps) {
  return (
    <label className={s.row} data-on={checked ? '' : undefined}>
      <input type="checkbox" className={s.mark} checked={checked} disabled={disabled} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)} />
      <span className={s.words}>
        <span className={s.label}>{label}</span>
        {detail && <span className={s.detail}>{detail}</span>}
      </span>
    </label>
  );
}
