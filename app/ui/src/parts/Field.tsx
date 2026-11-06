import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Icon } from './Icon';
import s from './Field.module.css';

interface Shared { label: string; hint?: string | undefined; error?: string | undefined }
type InputField = Shared & { multiline?: false } & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>;
type TextField = Shared & { multiline: true } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>;

/** A labelled input in D's box (button-line border, button radius, the ink border on focus). The hint and the error
 *  describe it; an error marks it invalid and carries a warning icon beside its words. */
export function Field(props: InputField | TextField) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [props.hint ? hintId : '', props.error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  const shared = { id, 'aria-describedby': describedBy, 'aria-invalid': props.error ? true : undefined, className: s.input } as const;
  let control;
  if (props.multiline) {
    const { label: _l, hint: _h, error: _e, multiline: _m, ...rest } = props;
    control = <textarea {...rest} {...shared} rows={rest.rows ?? 3} />;
  } else {
    const { label: _l, hint: _h, error: _e, multiline: _m, ...rest } = props;
    control = <input type="text" {...rest} {...shared} />;
  }
  return (
    <div className={s.field}>
      <label htmlFor={id} className={s.label}>{props.label}</label>
      {control}
      {props.hint && <p id={hintId} className={s.hint}>{props.hint}</p>}
      {props.error && <p id={errorId} className={s.error}><Icon name="triangle-alert" size={14} />{props.error}</p>}
    </div>
  );
}
