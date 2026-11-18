import type { ReactNode } from 'react';
import { useT } from '../text';
import type { Posture } from '../engine/types';
import { cx } from './cx';
import { Count } from './Figure';
import { Icon } from './Icon';
import type { DeptId, IconName } from './icons';
import { stateWord, type StateKind, type StateTone, type StateValue } from './states';
import { SwapWords } from './Swap';
import s from './Chip.module.css';
import { deptKey } from '../text/dept';

/** A chip's tone: a state tone from states.ts, or `line` (a plain bordered label, D's `.chip.line`). */
export type ChipTone = StateTone | 'line';

/** Tones that draw a dot before the words; done draws a tick instead, so the shapes differ beyond colour. */
const DOTTED: ReadonlySet<ChipTone> = new Set<ChipTone>(['working', 'wait', 'fail']);

export interface ChipProps {
  tone?: ChipTone | undefined;
  children: ReactNode;
  className?: string | undefined;
}

/**
 * D's `.chip`: words on a soft ground, with a hidden dot (working, waiting, stopped) or tick (done). Colour never says
 * the state alone: the words always do. Use StateChip for an engine state; Chip is for words states.ts does not hold
 * ("3 checks passed").
 */
export function Chip({ tone = 'neutral', children, className }: ChipProps) {
  return (
    <span className={cx(s.chip, className)} data-tone={tone}>
      {DOTTED.has(tone) && <span className={s.dot} data-dot="" aria-hidden="true" />}
      {tone === 'done' && <Icon name="check" size={12} />}
      {/* One-shot C3 task 8: a state word that changes (Idle to Working, Draft to Issued) fades in place. */}
      {typeof children === 'string' ? <SwapWords>{children}</SwapWords> : children}
    </span>
  );
}

export interface StateChipProps<K extends StateKind> {
  kind: K;
  /** The engine's value. One this build does not know reads "Unknown" in the neutral tone. */
  value: StateValue<K> | (string & {});
  className?: string | undefined;
}

/** An engine state as a chip: the words and the tone both come from states.ts. */
export function StateChip<K extends StateKind>({ kind, value, className }: StateChipProps<K>) {
  const t = useT();
  const entry = stateWord(kind, value);
  return <Chip tone={entry.tone} className={className}>{t(entry.key)}</Chip>;
}

/** D's `.dchip`: the department's name on its tint, beside an agent's name. */
export function DeptChip({ dept, className }: { dept: DeptId; className?: string | undefined }) {
  const t = useT();
  return <span className={cx(s.dept, className)} data-dept={dept}>{t(deptKey(dept))}</span>;
}

/** D's `.sdot`: a department's small solid dot before its name in a toggle or filter row. Hidden: the name says it.
 *  The one place the department dot colours live (Tabs and FilterChips both draw this). */
export function DeptDot({ dept, className }: { dept: DeptId; className?: string | undefined }) {
  return <span className={cx(s.deptDot, className)} data-dept={dept} aria-hidden="true" />;
}

/** Each posture's icon (D's `.pos`). */
export const POSTURE_ICONS: Readonly<Record<Posture, IconName>> = {
  'approve-each': 'shield-check',
  shadow: 'eye',
  rehearsal: 'history',
  'auto-spot-check': 'check',
};

/** D's `.pos`: how much an agent may do alone, in words from states.ts with its icon. */
export function PostureChip({ posture, className }: { posture: Posture; className?: string | undefined }) {
  const t = useT();
  return (
    <span className={cx(s.posture, className)} data-posture={posture}>
      <Icon name={POSTURE_ICONS[posture] ?? 'shield-check'} size={12} />
      {t(stateWord('posture', posture).key)}
    </span>
  );
}

export interface CountChipProps {
  value: number | string;
  /** `wait` (default, D's amber `.count`): things that wait on the owner. `neutral`: a plain count. */
  tone?: 'wait' | 'neutral' | undefined;
  /** What the count means, read in place of the bare number ("12 need you"). */
  label?: string | undefined;
  className?: string | undefined;
}

/** D's `.count`: a count in DM Mono on a small pill. A count is never money, so it carries no proof. Zero draws nothing. */
export function CountChip({ value, tone = 'wait', label, className }: CountChipProps) {
  if (Number(value) === 0) return null;
  return (
    <span className={cx(s.count, className)} data-tone={tone}>
      {label ? (
        <>
          <span aria-hidden="true"><Count value={value} /></span>
          <span className="sr-only">{label}</span>
        </>
      ) : (
        <Count value={value} />
      )}
    </span>
  );
}
