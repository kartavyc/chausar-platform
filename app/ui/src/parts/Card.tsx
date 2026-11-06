import type { ReactNode } from 'react';
import { cx } from './cx';
import type { SurfaceNaming } from './Tile';
import s from './Card.module.css';

/** A card's element and name follow SurfaceNaming (Tile.tsx): only a section, article, aside or list item is named. */
export type CardProps = SurfaceNaming & {
  /** Padding: the inner card's 14 (default) or none when the content pads itself. */
  pad?: 'card' | 'none' | undefined;
  /** Inner and Lift are cards (`data-card`: one filled primary at most, tests/helpers/ink-rules.ts). Pass `false`
   *  only for a plain grey or white box that holds no action of its own (a figure box inside a panel). */
  card?: boolean | undefined;
  className?: string | undefined;
  children?: ReactNode;
};

/*
 * The cards. Tiles and panels (Tile.tsx) are containers and are never cards when they hold these; Inner (on a white
 * tile) and Lift (on a department tint) are the cards inside them: an agent card, a live run, an order.
 */
function surface(kind: string | undefined, { as: Tag = 'div', labelledBy, label, pad, card = true, className, children }: CardProps) {
  return (
    <Tag
      className={cx(kind, className)}
      data-pad={pad === 'none' ? 'none' : undefined}
      data-card={card ? '' : undefined}
      aria-labelledby={labelledBy}
      aria-label={label}
    >
      {children}
    </Tag>
  );
}

/** D's `.inner`: a grey inner card on a white tile. Rings inside sit on the inner grey; --dim never sits on it. */
export function Inner(props: CardProps) {
  return surface(s.inner, props);
}

/** D's `.lift`: a white card lifted off a department tint with the soft lift shadow. Rings inside sit on white. */
export function Lift(props: CardProps) {
  return surface(s.lift, props);
}
