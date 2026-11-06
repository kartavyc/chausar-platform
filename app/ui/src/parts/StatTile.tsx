import type { ReactNode } from 'react';
import { cx } from './cx';
import { Count, Figure, type FigureProof } from './Figure';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { Tile, type SurfaceElement, type TileSpan } from './Tile';
import s from './StatTile.module.css';

/** One value per stat tile: an engine figure with its proof (shown at stat size), or a count. Never both, never
 *  neither. */
type StatFigure = FigureProof & { value: string; onReceipt?: ((id: string) => void) | undefined };

type StatValue =
  | { figure: StatFigure; count?: never }
  | { count: number | string; figure?: never };

export type StatTileProps = StatValue & {
  label: string;
  icon?: IconName | undefined;
  /** A small state dot before the label instead of an icon (D's `.ldot`): working (the accent) or waiting (amber). */
  dot?: 'working' | 'wait' | undefined;
  /** The line under the value: who, or what it covers. */
  sub?: ReactNode;
  /** Beside the value: an avatar stack, mini bars, a ring. */
  side?: ReactNode;
  /** `wait`: the value is amber (something waits on the owner). */
  tone?: 'wait' | undefined;
  span?: TileSpan | undefined;
  as?: SurfaceElement | undefined;
  className?: string | undefined;
};

/**
 * D's stat tile (`.stat`, `.s-lab`, `.s-row`, `.s-val`, `.s-sub`): a label, one big value, a sub line. The value is
 * at stat size (30) and, under 760 px, at hero size (24); it never wraps or truncates, so the side slot drops under
 * it when the row is narrow. The sub line wraps rather than cut a word or a figure.
 */
export function StatTile(props: StatTileProps) {
  const { label, icon, dot, sub, side, tone, span, as, className } = props;
  return (
    <Tile as={as} span={span} tone={tone} pad="compact" card className={cx(s.stat, className)}>
      <p className={s.label}>
        {dot ? <span className={s.dot} data-dot={dot} aria-hidden="true" /> : icon ? <Icon name={icon} size={14} /> : null}
        {label}
      </p>
      <div className={s.row}>
        {props.figure ? (
          // No Figure size: the figure takes the tile's value size, which steps down on a phone.
          <Figure {...props.figure} className={s.value} />
        ) : (
          <Count value={props.count} className={s.value} />
        )}
        {side !== undefined && side !== null && <span className={s.side}>{side}</span>}
      </div>
      {sub !== undefined && sub !== null && <p className={s.sub}>{sub}</p>}
    </Tile>
  );
}
