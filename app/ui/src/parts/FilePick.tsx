import { useId, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from 'react';
import { useT } from '../text';
import { cx } from './cx';
import { Icon } from './Icon';
import type { IconName } from './icons';
import field from './Field.module.css';
import s from './FilePick.module.css';

export interface FilePickProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'children' | 'files'> {
  /** The field's name above the button, in Field's label. */
  label?: string | undefined;
  hint?: string | undefined;
  /** The button's words: "Choose the file" unless a place has its own. */
  choose?: string | undefined;
  icon?: IconName | undefined;
  /** The icon alone, the words for readers and as a title: a small attach button inside another control. */
  compact?: boolean | undefined;
  /** The files the form holds. Given, the form owns them (pass `onRemove`); left out, the part shows what was picked,
   *  and Remove clears the input and sends the form the same change event with no file in it. */
  files?: readonly { name: string }[] | undefined;
  onRemove?: ((index: number) => void) | undefined;
}

/** The app's file picker: a real file input for readers and keys, drawn as the outlined button, the chosen name beside it as a chip with Remove. */
export function FilePick({ label, hint, choose, icon = 'upload', compact, files, onRemove, onChange, className, ...rest }: FilePickProps) {
  const t = useT();
  const own = useId();
  const id = rest.id ?? own;
  const hintId = `${own}-hint`;
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const words = choose ?? t('file.choose');
  const names = files ? files.map((file) => file.name) : picked;

  function changed(event: ChangeEvent<HTMLInputElement>) {
    onChange?.(event);
    // After the form's own handler: a form that takes the file at once clears the input, so nothing stays to show.
    setPicked(Array.from(event.currentTarget.files ?? [], (file) => file.name));
  }

  function remove(index: number) {
    const box = input.current;
    if (!files && box) {
      box.value = '';
      box.dispatchEvent(new Event('change', { bubbles: true }));
      setPicked([]);
    }
    onRemove?.(index);
  }

  const describedBy = [rest['aria-describedby'], hint ? hintId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx(s.pick, className)} data-file-pick="" data-field="">
      {label && <label htmlFor={id} className={field.label}>{label}</label>}
      <div className={s.row}>
        <input {...rest} ref={input} id={id} type="file" className={cx('sr-only', s.native)} aria-describedby={describedBy} onChange={changed} />
        <label htmlFor={id} className={s.choose} data-compact={compact ? '' : undefined} title={compact ? words : undefined}>
          <Icon name={icon} size={compact ? 18 : 16} />
          {compact ? <span className="sr-only">{words}</span> : <span>{words}</span>}
        </label>
        {names.map((name, index) => (
          <span key={`${name}-${index}`} className={s.chip} data-file-chip="">
            <Icon name="file-text" size={14} />
            <span className={s.name} data-content="">{name}</span>
            <button type="button" className={s.remove} disabled={rest.disabled} aria-label={t('file.remove', { name })} onClick={() => remove(index)}>
              <Icon name="x" size={14} />
            </button>
          </span>
        ))}
      </div>
      {hint && <p id={hintId} className={field.hint}>{hint}</p>}
    </div>
  );
}
