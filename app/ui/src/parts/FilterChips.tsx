import { Fragment, useEffect, useRef } from 'react';
import { useT } from '../text';
import { initialsOf } from './Avatar';
import { DeptDot } from './Chip';
import { cx } from './cx';
import { Count } from './Figure';
import { Icon } from './Icon';
import type { DeptId, IconName } from './icons';
import { revealInRow } from './reveal';
import s from './FilterChips.module.css';

export interface FilterOption {
  id: string;
  label: string;
  /** How many there are (a Count: never money, so no proof). */
  count?: number | string | undefined;
  /** A business: its initials square goes before the name (D's `.bsq`). */
  business?: boolean | undefined;
  /** A locked business: the lock goes before the name instead, and a screen reader hears "locked". */
  locked?: boolean | undefined;
  /** A department's dot before the name (the phone's department toggle). */
  dept?: DeptId | undefined;
  icon?: IconName | undefined;
  /** Draw the thin separator before this option (between the kinds and the businesses). */
  separatorBefore?: boolean | undefined;
}

export interface FilterChipsProps {
  /** The group's name ("Show"). */
  label: string;
  options: readonly FilterOption[];
  /** The id of the option that is on. */
  value: string;
  onChange: (id: string) => void;
  /** A phone row: one line that scrolls sideways instead of wrapping. */
  scroll?: boolean | undefined;
  className?: string | undefined;
}

/**
 * D's `.fchips`: a row of toggle chips, one of them on. Each is a button with `aria-pressed`; the place keeps the
 * choice (in the address, where it should survive a reload) and passes it back as `value`. In a row that scrolls,
 * the pressed chip is brought into view sideways when the row first shows it.
 */
export function FilterChips({ label, options, value, onChange, scroll = false, className }: FilterChipsProps) {
  const t = useT();
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pressed = row.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (row.current && pressed) revealInRow(row.current, pressed);
  }, [value]);
  return (
    <div ref={row} className={cx(s.chips, className)} role="group" aria-label={label} data-scroll={scroll ? '' : undefined}>
      {options.map((option) => (
        <Fragment key={option.id}>
          {option.separatorBefore && <span className={s.separator} data-separator="" aria-hidden="true" />}
          <button
            type="button"
            className={s.chip}
            aria-pressed={option.id === value}
            onClick={() => onChange(option.id)}
          >
            {option.locked ? (
              <Icon name="lock" size={14} />
            ) : option.business ? (
              <span className={s.business} data-business="" aria-hidden="true">{initialsOf(option.label)}</span>
            ) : option.dept ? (
              <DeptDot dept={option.dept} />
            ) : option.icon ? (
              <Icon name={option.icon} size={14} />
            ) : null}
            <span>
              {option.label}
              {option.locked && <span className="sr-only">, {t('filter.locked')}</span>}
            </span>
            {option.count !== undefined && (
              <>
                {' '}
                <Count value={option.count} className={s.count} />
              </>
            )}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
