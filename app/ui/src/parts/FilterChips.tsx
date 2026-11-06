import { Fragment, startTransition, useEffect, useRef } from 'react';
import { useT } from '../text';
import { initialsOf } from './Avatar';
import { DeptDot } from './Chip';
import { cx } from './cx';
import { Count } from './Figure';
import { Icon } from './Icon';
import type { DeptId, IconName } from './icons';
import { revealInRow } from './reveal';
import { useSlidingPill } from './useSlidingPill';
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
  /** Fewer items than this and there is nothing worth filtering: no row. Counted from All, else from the chips. */
  minItems?: number | undefined;
  /** false: the counts decide which chips show, and are not written on them. */
  drawCounts?: boolean | undefined;
  className?: string | undefined;
}

const ALL = 'all';
const isZero = (option: FilterOption) => option.count !== undefined && Number(option.count) === 0;

/**
 * B4 task 6: the chips worth drawing. A chip at zero goes, except All and the one that is on (so it can be seen and
 * left). No row while every count is zero, under minItems, or when only one chip of several would be left. A chip with
 * no count (a locked business, a page like Ideas) is not a zero: it stays.
 */
function worthDrawing(options: readonly FilterOption[], value: string, minItems: number): readonly FilterOption[] {
  const counted = options.filter((option) => option.count !== undefined);
  if (counted.length === 0) return options;
  if (counted.every(isZero) && options.every((option) => option.count !== undefined || option.id === ALL)) return [];
  const total = options.find((option) => option.id === ALL)?.count ?? counted.reduce((sum, option) => sum + Number(option.count), 0);
  if (Number(total) < minItems) return [];
  const kept = options.filter((option) => !isZero(option) || option.id === ALL || option.id === value);
  return kept.length < 2 && kept.length < options.length ? [] : kept;
}

/**
 * D's `.fchips`: a row of toggle chips, one of them on. Each is a button with `aria-pressed`; the place keeps the
 * choice (in the address, where it should survive a reload) and passes it back as `value`. In a row that scrolls,
 * the pressed chip is brought into view sideways when the row first shows it.
 */
export function FilterChips({ label, options, value, onChange, scroll = false, minItems = 0, drawCounts = true, className }: FilterChipsProps) {
  const t = useT();
  const row = useRef<HTMLDivElement>(null);
  // One-shot C3 task 15: the same sliding pill as the tabs.
  const pill = useSlidingPill(value);
  useEffect(() => {
    const pressed = row.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (row.current && pressed) revealInRow(row.current, pressed);
  }, [value]);
  const shown = worthDrawing(options, value, minItems);
  if (shown.length === 0) return null;
  return (
    <div ref={row} className={cx(s.chips, className)} role="group" aria-label={label} data-scroll={scroll ? '' : undefined}>
      <span ref={pill} className={s.pill} data-pill="" aria-hidden="true" />
      {shown.map((option) => (
        <Fragment key={option.id}>
          {option.separatorBefore && <span className={s.separator} data-separator="" aria-hidden="true" />}
          <button
            type="button"
            className={s.chip}
            aria-pressed={option.id === value}
            onClick={() => startTransition(() => onChange(option.id))}
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
            {drawCounts && option.count !== undefined && !isZero(option) && (
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
