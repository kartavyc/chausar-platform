import { useId, type ComponentPropsWithRef } from 'react';
import { Icon } from './Icon';
import field from './Field.module.css';
import s from './Select.module.css';

export interface SelectProps extends ComponentPropsWithRef<'select'> {
  /** With a label it stands as a field, with Field's label, hint and error. Without one, it is the box alone, for a
   *  place that names it another way (its own label around it, or an aria-label). */
  label?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
}

/** The app's select: a native `select`, so keys and the phone's own picker keep working, in Field's box with the app's arrow. */
export function Select({ label, hint, error, className, children, ...rest }: SelectProps) {
  const own = useId();
  const id = rest.id ?? (label === undefined ? undefined : own);
  const hintId = `${own}-hint`;
  const errorId = `${own}-error`;
  const describedBy = [rest['aria-describedby'], hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  const control = (
    <span className={s.wrap}>
      <select {...rest} id={id} className={className} aria-describedby={describedBy} aria-invalid={error ? true : rest['aria-invalid']}>{children}</select>
      <span className={s.arrow} data-select-arrow="" aria-hidden="true"><Icon name="chevron-down" size={16} /></span>
    </span>
  );
  if (label === undefined && !hint && !error) return control;
  return (
    <div className={field.field} data-field="">
      {label !== undefined && <label htmlFor={id} className={field.label}>{label}</label>}
      {control}
      {hint && <p id={hintId} className={field.hint}>{hint}</p>}
      {error && <p id={errorId} className={field.error} role="alert"><Icon name="triangle-alert" size={14} />{error}</p>}
    </div>
  );
}
