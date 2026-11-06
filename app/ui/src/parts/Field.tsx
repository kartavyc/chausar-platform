import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useT } from '../text';
import { Icon } from './Icon';
import s from './Field.module.css';

interface Shared {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  /** A short mark inside the box ("INR", "%") the owner reads with the value. Hidden from readers: the label says it. */
  adornment?: string | undefined;
}
type InputField = Shared & { multiline?: false } & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>;
type TextField = Shared & { multiline: true } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>;

/** While a date box is empty it says this in the body face, not the browser's "dd-mm-yyyy". */
function PickADay() {
  const t = useT();
  return <span className={s.dateWord} aria-hidden="true">{t('field.pickDay')}</span>;
}

/** A labelled input in D's box (button-line border, button radius, one ring on focus). The hint and the error describe
 *  it; an error marks it invalid and carries a warning icon beside its words. A single line stops at `--field-max`. */
export function Field(props: InputField | TextField) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [props.hint ? hintId : '', props.error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  const shared = { id, 'aria-describedby': describedBy, 'aria-invalid': props.error ? true : undefined, className: s.input } as const;
  let control;
  let dateEmpty = false;
  if (props.multiline) {
    const { label: _l, hint: _h, error: _e, adornment: _a, multiline: _m, ...rest } = props;
    control = <textarea {...rest} {...shared} rows={rest.rows ?? 3} />;
  } else {
    const { label: _l, hint: _h, error: _e, adornment: _a, multiline: _m, ...rest } = props;
    control = <input type="text" {...rest} {...shared} />;
    dateEmpty = rest.type === 'date' && rest.value === '';
  }
  return (
    <div className={s.field} data-field="" data-single={props.multiline ? undefined : ''}>
      <label htmlFor={id} className={s.label}>{props.label}</label>
      {props.adornment || dateEmpty ? (
        <span className={s.box} data-field-box="" data-adorned={props.adornment ? '' : undefined} data-date-empty={dateEmpty ? '' : undefined}>
          {props.adornment && <span className={s.adornment} aria-hidden="true">{props.adornment}</span>}
          {control}
          {dateEmpty && <PickADay />}
        </span>
      ) : control}
      {props.hint && <p id={hintId} className={s.hint}>{props.hint}</p>}
      {props.error && <p id={errorId} className={s.error} role="alert"><Icon name="triangle-alert" size={14} />{props.error}</p>}
    </div>
  );
}
