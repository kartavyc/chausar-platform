import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';
import type { DeptId } from './icons';
import { CountChip } from './Chip';
import s from './Tile.module.css';

/*
 * Containers and cards. Bento, Tile and Panel are containers: they group things and are never a card themselves,
 * so a tile or panel that holds cards (Inner, Lift, approval cards) or rows is never marked `data-card`; only the
 * cards inside it are (tests/helpers/ink-rules.ts `assertOnePrimary`). Inner and Lift (Card.tsx) are the cards. The
 * one exception is a tile that is itself a single card and holds no other card, such as a stat tile: it may pass
 * `card`. Panel takes no `card` at all, because a department panel always holds agent cards.
 */

/** How many of the bento's 12 columns a tile takes (D's `.c3` to `.c12`). A phone stacks every tile full width. */
export type TileSpan = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** The elements that can carry a name: a landmark region, a self-contained card, a side note, a list item. */
export type NamedElement = 'section' | 'article' | 'aside' | 'li';

/** The elements a surface may be: a plain box, or one of the elements that can carry a name. */
export type SurfaceElement = 'div' | NamedElement;

/**
 * A surface's element and its name. A plain div has no role, so a name on it is not announced (and axe flags it):
 * only a section, article, aside or list item may be named. The type holds it: `label` or `labelledBy` without one
 * of those `as` values does not compile.
 */
export type SurfaceNaming =
  | { as?: 'div' | undefined; label?: never; labelledBy?: never }
  | {
      as: NamedElement;
      /** A name, when no visible heading names it. */
      label?: string | undefined;
      /** The id of the heading that names it. */
      labelledBy?: string | undefined;
    };

type SurfaceProps = SurfaceNaming & {
  className?: string | undefined;
  children?: ReactNode;
};

export type BentoProps = SurfaceProps;

/** D's `.bento`: the 12-column grid tiles sit in, with the grid gap. */
export function Bento({ as: Tag = 'div', labelledBy, label, className, children }: BentoProps) {
  return (
    <Tag className={cx(s.bento, className)} aria-labelledby={labelledBy} aria-label={label}>
      {children}
    </Tag>
  );
}

export type TileProps = SurfaceProps & {
  span?: TileSpan | undefined;
  /** `fail`: a stopped run's tile keeps a red line (D's red wash is dropped on purpose). `wait`: it is about
   *  something that waits on the owner (the tile itself does not change; its parts may colour words amber). */
  tone?: 'fail' | 'wait' | undefined;
  /** Padding: the tile's 20 (default), the compact 16, or none when the content pads itself. */
  pad?: 'tile' | 'compact' | 'none' | undefined;
  /** Only for a tile that is itself one card and holds no other card or row (a stat tile): it then carries
   *  `data-card` and at most one filled primary. Never on a tile that holds cards or rows; those are the cards. */
  card?: boolean | undefined;
};

/** D's `.tile`: the white surface with a line border, the tile radius and the one tile shadow. Rings inside sit on the
 *  surface. */
export function Tile({ as: Tag = 'div', span, tone, pad, card, labelledBy, label, className, children }: TileProps) {
  return (
    <Tag
      className={cx(s.tile, className)}
      data-span={span}
      data-tone={tone}
      data-pad={pad && pad !== 'tile' ? pad : undefined}
      data-card={card ? '' : undefined}
      aria-labelledby={labelledBy}
      aria-label={label}
    >
      {children}
    </Tag>
  );
}

export type PanelProps = SurfaceProps & {
  dept: DeptId;
  span?: TileSpan | undefined;
};

/** D's `.dp.p-x`: a department's panel on its tint and line. A container, never a card: the agent cards inside it
 *  (Lift with `card`) are. Rings and badges inside sit on the tint, and amber words on it use --wait-strong, never
 *  plain --wait. */
export function Panel({ dept, as: Tag = 'div', span, labelledBy, label, className, children }: PanelProps) {
  return (
    <Tag className={cx(s.panel, className)} data-dept={dept} data-span={span} aria-labelledby={labelledBy} aria-label={label}>
      {children}
    </Tag>
  );
}

export interface TileHeadProps {
  title: string;
  /** The heading's id, for the tile's `labelledBy`. */
  id?: string | undefined;
  /** The level, when a tile sits under a section heading of its own. */
  level?: 2 | 3 | undefined;
  /** A quiet line beside the title ("3 working · 1 needs you"). */
  meta?: ReactNode;
  /** A link to the place that shows more ("See team"), with a chevron. */
  more?: { href: string; label: string } | undefined;
  /** Anything else at the end of the head, such as one quiet button. */
  end?: ReactNode;
  className?: string | undefined;
}

/** D's `div.th`: the tile's title at tile size, an optional meta line and a "more" link pushed to the end. */
export function TileHead({ title, id, level = 2, meta, more, end, className }: TileHeadProps) {
  const Heading = level === 3 ? 'h3' : 'h2';
  return (
    <div className={cx(s.head, className)}>
      <Heading id={id} className={s.headTitle}>{title}</Heading>
      {meta !== undefined && meta !== null && <span className={s.meta}>{meta}</span>}
      {more && (
        <a className={s.more} href={more.href}>
          {more.label}
          <Icon name="chevron-right" size={16} />
        </a>
      )}
      {end !== undefined && end !== null && <span className={s.end}>{end}</span>}
    </div>
  );
}

export interface SectionHeadProps {
  title: string;
  id?: string | undefined;
  /** A count beside the title, on the amber ground (D's `span.count`): what waits on the owner. */
  count?: number | string | undefined;
  /** What the count means, read instead of the bare number ("12 need you"). */
  countLabel?: string | undefined;
  /** A quiet line beside the title, as on a tile's head (D's Work: "4 running · 1 stopped"). */
  meta?: ReactNode;
  /** A link to the place that shows more ("Open Clients"), with a chevron, pushed to the end. */
  more?: { href: string; label: string } | undefined;
  end?: ReactNode;
  className?: string | undefined;
}

/** D's `div.shead`: a section heading outside the tiles, at section size, with an amber count, a meta line and a link. */
export function SectionHead({ title, id, count, countLabel, meta, more, end, className }: SectionHeadProps) {
  return (
    <div className={cx(s.section, className)}>
      <h2 id={id} className={s.sectionTitle}>{title}</h2>
      {count !== undefined && <CountChip value={count} label={countLabel} />}
      {meta !== undefined && meta !== null && <span className={s.meta}>{meta}</span>}
      {more && (
        <a className={s.more} href={more.href}>
          {more.label}
          <Icon name="chevron-right" size={16} />
        </a>
      )}
      {end !== undefined && end !== null && <span className={s.end}>{end}</span>}
    </div>
  );
}
