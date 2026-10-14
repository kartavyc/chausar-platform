/**
 * SettingsRows: rows that open in place to show their choices (Trust, Rules, rhythm, a
 * source's settings). A closed row shows what it is and the current choice in words. Opening
 * one shows its choice under it: the No and Yes pair, or a row of words with the chosen one
 * underlined. One row is open at a time. Read only shows the rows and the current choices,
 * and the choices cannot be changed.
 */

import { useId, useState } from 'react';
import { useT } from '../app/text';
import { Choice, YesNo, type ChoiceOption } from '../parts/Choice';
import s from './SettingsRows.module.css';

export type SettingChoice =
  | { readonly form: 'yes-no'; readonly value: boolean | null; readonly onChange: (yes: boolean) => void }
  | { readonly form: 'words'; readonly options: ReadonlyArray<ChoiceOption<string>>; readonly value: string | null; readonly onChange: (value: string) => void };

export interface SettingRow {
  readonly id: string;
  /** What the setting is, already localised. */
  readonly what: string;
  readonly note?: string | undefined;
  /** The current choice in words, already localised. */
  readonly current: string;
  readonly choice: SettingChoice;
  /** This one setting cannot be changed from here. */
  readonly locked?: boolean | undefined;
}

export interface SettingsRowsProps {
  label: string;
  rows: ReadonlyArray<SettingRow>;
  readOnly?: boolean | undefined;
  /** Controlled open row. Without it the list keeps its own. */
  openId?: string | null | undefined;
  onOpenChange?: ((id: string | null) => void) | undefined;
  className?: string | undefined;
}

function SettingLine({ row, open, onToggle, disabled }: { row: SettingRow; open: boolean; onToggle: () => void; disabled: boolean }) {
  const t = useT();
  const panel = useId();
  const c = row.choice;
  return (
    <li className={[s.row, open ? s.open : ''].join(' ')} data-setting={row.id}>
      <button type="button" className={s.main} aria-expanded={open} aria-controls={panel} onClick={onToggle}>
        <span className={s.what}>
          <span className={s.title}>{row.what}</span>
          {row.note !== undefined && <span className={s.note}>{row.note}</span>}
        </span>
        <span className={s.current}>{row.current}</span>
      </button>
      {open && (
        <div id={panel} className={s.panel}>
          {c.form === 'yes-no' ? (
            <YesNo label={row.what} value={c.value} onChange={c.onChange} disabled={disabled} />
          ) : (
            <Choice<string> label={row.what} labelHidden options={c.options} value={c.value} onChange={c.onChange} disabled={disabled} />
          )}
          {disabled && <p className={s.note}>{t('SETTINGS.locked')}</p>}
        </div>
      )}
    </li>
  );
}

export function SettingsRows({ label, rows, readOnly = false, openId, onOpenChange, className }: SettingsRowsProps) {
  const [ownOpen, setOwnOpen] = useState<string | null>(null);
  const current = openId !== undefined ? openId : ownOpen;
  const toggle = (id: string) => {
    const next = current === id ? null : id;
    if (openId === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };
  return (
    <ul className={[s.list, className].filter(Boolean).join(' ')} aria-label={label}>
      {rows.map((row) => (
        <SettingLine key={row.id} row={row} open={current === row.id} onToggle={() => toggle(row.id)} disabled={readOnly || row.locked === true} />
      ))}
    </ul>
  );
}
