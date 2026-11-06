import { type FocusEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { T } from '../text';
import { DeptDot } from './Chip';
import { cx } from './cx';
import { Count } from './Figure';
import { Icon } from './Icon';
import { DEPT_IDS, type DeptId, type IconName } from './icons';
import { revealInRow } from './reveal';
import s from './Segmented.module.css';

export interface SegmentOption {
  id: string;
  label: string;
  icon?: IconName | undefined;
  /** A department's dot before the words (the department toggle). */
  dept?: DeptId | undefined;
  /** How many there are (a Count, never money). */
  count?: number | string | undefined;
}

/** A sub-page in links mode: it always has its address. */
export interface SegmentLink extends SegmentOption {
  href: string;
}

interface Common {
  /** The control's name ("Show departments", "Clients views"). */
  label: string;
  /** The id of the current option. */
  value: string;
  className?: string | undefined;
}

/**
 * `buttons`: a one-of-many switch inside the page (the department toggle); the place holds the choice.
 * `links`: sub-pages held in the address (Clients, Money, Business); the current one is the page.
 */
export type SegmentedProps =
  | (Common & { mode: 'buttons'; options: readonly SegmentOption[]; onChange: (id: string) => void })
  | (Common & { mode: 'links'; options: readonly SegmentLink[]; onChange?: never });

function Inside({ option }: { option: SegmentOption }) {
  return (
    <>
      {option.dept ? <DeptDot dept={option.dept} /> : option.icon ? <Icon name={option.icon} size={16} /> : null}
      <span>{option.label}</span>
      {option.count !== undefined && (
        <>
          {' '}
          <Count value={option.count} className={s.count} />
        </>
      )}
    </>
  );
}

/** Which edges of a scrolling row hide more segments; undefined when the row fits. These are layout pixels, never money. */
type More = 'start' | 'end' | 'both' | undefined;
function moreOf(row: HTMLElement): More {
  const start = row.scrollLeft > 1;
  const end = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
  return start && end ? 'both' : start ? 'start' : end ? 'end' : undefined;
}

/**
 * D's `.seg`: a row of segments on a white pill, the current one on the selected ink. When the row is wider than
 * its place, it scrolls sideways and the current segment is brought into view, on mount, when the choice changes and
 * when the row's own width changes (a sheet opening beside the page). The edge that hides more fades (`data-more`),
 * so the segments past it are found at every width.
 */
export function Segmented(props: SegmentedProps) {
  const { label, value, className } = props;
  const row = useRef<HTMLElement | null>(null);
  const [more, setMore] = useState<More>(undefined);
  const setRow = (element: HTMLElement | null) => {
    row.current = element;
  };
  const measure = useCallback(() => {
    if (row.current) setMore(moreOf(row.current));
  }, []);
  const reveal = useCallback(() => {
    const current = row.current?.querySelector<HTMLElement>('[aria-pressed="true"], [aria-current="page"]');
    if (row.current && current) revealInRow(row.current, current);
    measure();
  }, [measure]);
  useEffect(reveal, [value, reveal]);
  // A segment reached by Tab comes into the row too, so focus never sits under the faded edge.
  const onFocus = (event: FocusEvent<HTMLElement>) => {
    if (row.current && event.target !== row.current) revealInRow(row.current, event.target);
    measure();
  };
  useEffect(() => {
    if (!row.current || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => reveal());
    observer.observe(row.current);
    return () => observer.disconnect();
  }, [reveal]);
  if (props.mode === 'links') {
    return (
      <nav ref={setRow} className={cx(s.seg, className)} aria-label={label} data-more={more} onScroll={measure} onFocus={onFocus}>
        <ul className={s.list}>
          {props.options.map((option) => (
            <li key={option.id}>
              <a className={s.item} href={option.href} aria-current={option.id === value ? 'page' : undefined}>
                <Inside option={option} />
              </a>
            </li>
          ))}
        </ul>
      </nav>
    );
  }
  const { onChange } = props;
  return (
    <div ref={setRow} className={cx(s.seg, className)} role="group" aria-label={label} data-more={more} onScroll={measure} onFocus={onFocus}>
      {props.options.map((option) => (
        <button key={option.id} type="button" className={s.item} aria-pressed={option.id === value} onClick={() => onChange(option.id)}>
          <Inside option={option} />
        </button>
      ))}
    </div>
  );
}

/**
 * The department toggle's choices (founder decision 23 Oct, spec section 3 "Team"): "All departments", then the
 * five departments in their fixed order, each with its dot. Segmented takes them on a desktop and FilterChips on a
 * phone (D-STYLE "Segmented toggle"). The ids are `all` and the department ids.
 */
export function departmentChoices(t: T): (SegmentOption & { id: 'all' | DeptId })[] {
  return [
    { id: 'all', label: t('dept.all'), icon: 'layout-grid' },
    ...DEPT_IDS.map((dept) => ({ id: dept, label: t(`dept.${dept}`), dept })),
  ];
}
