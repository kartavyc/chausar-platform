/**
 * Field: a single underline with a label above. The label is always visible.
 * What is typed is data; the field never parses it.
 */

import { useId, type InputHTMLAttributes } from 'react';
import s from './Field.module.css';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> {
  label: string;
  /** A problem with the value, in one plain sentence. */
  problem?: string | undefined;
  /** A short unit shown before the value, such as the rupee sign. */
  prefix?: string | undefined;
  className?: string | undefined;
}

export function Field({ label, problem, prefix, className, ...rest }: FieldProps) {
  const id = useId();
  const problemId = `${id}-problem`;
  return (
    <div className={[s.field, className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className={s.label}>
        {label}
      </label>
      <div className={s.line}>
        {prefix !== undefined && (
          <span className={[s.prefix, 'fig'].join(' ')} aria-hidden="true">
            {prefix}
          </span>
        )}
        <input
          id={id}
          className={s.input}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? problemId : undefined}
          {...rest}
        />
      </div>
      {problem && (
        <p id={problemId} className={s.problem}>
          {problem}
        </p>
      )}
    </div>
  );
}
