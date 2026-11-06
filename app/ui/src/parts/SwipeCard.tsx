import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useT } from '../text';
import type { PressResult } from './ApprovalRow';
import { cx } from './cx';
import { Icon } from './Icon';
import s from './SwipeCard.module.css';

export type { PressResult } from './ApprovalRow';

/** How far a card is dragged, in CSS pixels, before letting go acts. The underlay is this wide, so a card that shows
 *  all of it acts when let go. */
export const SWIPE_DISTANCE = 96;

/** The card follows the finger in steps of `--sp-1` (4 px), as `data-shift` 1 to 24, so nothing is set inline. */
const STEP = 4;
const STEPS = SWIPE_DISTANCE / STEP;
/** Movement under this many pixels is a tap, not a drag. */
const SLOP = 8;
/** The click a browser sends right after a swipe comes within this many milliseconds; only that one is swallowed, so
 *  a later tap (or a screen reader's double-tap) presses as usual. */
const CLICK_AFTER_SWIPE = 500;

type Side = 'right' | 'left';

interface Drag {
  pointerId: number;
  x0: number;
  y0: number;
  /** Decided on the first real movement: sideways is a swipe, up or down is the page scrolling. */
  axis: 'x' | 'y' | null;
  dx: number;
}

/** A value, or a function that reads it when it is needed (so it is never stale). */
type Live<T> = T | (() => T);
const read = <T,>(value: Live<T>): T => (typeof value === 'function' ? (value as () => T)() : value);

export interface SwipeCardProps {
  /** The card: an ApprovalRow card, whose own buttons stay the way to act by keyboard and screen reader. */
  children: ReactNode;
  /** The primary's own words ("Approve", "Issue"), shown under the card as it moves right. A function reads them as
   *  the card moves (`() => handle.current?.primary().label`), so a newer version's words show. */
  rightLabel: Live<string>;
  /** The words shown as it moves left; "Later" when left out. */
  leftLabel?: string | undefined;
  /** The primary asks once more before it acts; the underlay says so. A function reads it as the card moves. */
  asksAgain?: Live<boolean | undefined> | undefined;
  /**
   * Draws the underlay with the lock (view before approve). Only the look: it never stops the swipe, since it could be
   * stale; the card's own path refuses a locked primary and answers 'locked'. Pass a function to read it live
   * (`() => handle.current?.primary().locked ?? false`).
   */
  rightLocked?: Live<boolean | undefined> | undefined;
  /** What to show when the card's path answers 'locked', in the card's own words ("Approve unlocks after you watch it").
   *  A function reads it when needed (`() => handle.current?.primary().note`). An empty string says nothing more: the
   *  card already shows why on its own note line (Today's cards do). */
  lockedNote?: Live<string | undefined> | undefined;
  /**
   * Called once when the card is let go past the swipe distance to the right. The swipe never decides anything
   * itself: pass the card's own path, ApprovalRow's `handle.current?.pressPrimary()`, which goes the way a click does
   * (a locked primary stays locked, a second ask opens in the card and decides nothing, a press while it asks or sends
   * does nothing). Return what it did; 'locked' shows `lockedNote`. Left out, a right drag does nothing and shows no
   * ground: a card whose primary is not a decision (open a business, go to Connections) is never pressed by a swipe.
   */
  onRight?: (() => PressResult | void) | undefined;
  /** Called once when let go past the swipe distance to the left: ApprovalRow's `handle.current?.pressLater()`. Left
   *  out, a left drag does nothing. */
  onLeft?: (() => PressResult | void) | undefined;
  className?: string | undefined;
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

/**
 * A card that can be swiped on a phone (D's `.swipe`, `.under`, `.shifted`): right for the primary, left for later.
 * It only moves the card and calls `onRight` or `onLeft`; it holds no engine call and decides nothing. Touch and pen
 * only: a mouse has the buttons. One finger only: a second finger drops the swipe without acting, and pinch-zoom and
 * vertical scrolling stay with the page. A drag shorter than the swipe distance snaps back once, over `--t-settle`
 * (at once under reduced motion). The underlay is hidden from screen readers; the card's buttons are the accessible
 * way to act.
 */
export function SwipeCard({
  children, rightLabel, leftLabel, asksAgain = false, rightLocked, lockedNote, onRight, onLeft, className,
}: SwipeCardProps) {
  const t = useT();
  const card = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  /** Every touch or pen pointer down on the card now. */
  const pointers = useRef(new Set<number>());
  /** A second pointer came down: no swipe until every pointer is up. */
  const multi = useRef(false);
  /** When the last swipe ended: the click it causes must not press a button inside the card. */
  const swipedAt = useRef<number | null>(null);
  const [side, setSide] = useState<Side | null>(null);
  const [steps, setSteps] = useState(0);
  const [snap, setSnap] = useState(0);
  const [note, setNote] = useState('');

  /** Back to rest from `from` steps: once, over the settle time, or at once under reduced motion. */
  function settle(from: number) {
    setSteps(0);
    if (from > 0 && !reducedMotion()) {
      setSnap(from);
    } else {
      setSnap(0);
      setSide(null);
    }
  }

  /** Drop the drag in progress without acting. */
  function abandon() {
    const current = drag.current;
    drag.current = null;
    if (current?.axis === 'x') settle(Math.min(STEPS, Math.floor(Math.abs(current.dx) / STEP)));
  }

  // A pointer can go up or be cancelled outside the card (a drag that became a scroll): the window still hears it, so
  // a stale drag or pointer never blocks the next swipe. The card's own handlers run first for one that ends on it.
  const abandonRef = useRef(abandon);
  abandonRef.current = abandon;
  useEffect(() => {
    const ended = (event: globalThis.PointerEvent) => {
      if (!pointers.current.has(event.pointerId)) return;
      pointers.current.delete(event.pointerId);
      if (drag.current?.pointerId === event.pointerId) abandonRef.current();
      if (pointers.current.size === 0) multi.current = false;
    };
    window.addEventListener('pointerup', ended);
    window.addEventListener('pointercancel', ended);
    return () => {
      window.removeEventListener('pointerup', ended);
      window.removeEventListener('pointercancel', ended);
    };
  }, []);

  // The snap ends when its one animation does. A native listener, because React names the event by vendor prefix
  // where the browser has one; an animation inside the card (a decided row settling) is not the snap.
  useEffect(() => {
    const element = card.current;
    if (!element) return undefined;
    const ended = (event: Event) => {
      // A new drag that took over the card cancels the snap; the drag owns the card now.
      if (event.target !== element || drag.current?.axis === 'x') return;
      setSnap(0);
      setSide(null);
    };
    element.addEventListener('animationend', ended);
    element.addEventListener('animationcancel', ended);
    return () => {
      element.removeEventListener('animationend', ended);
      element.removeEventListener('animationcancel', ended);
    };
  }, []);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' || event.button !== 0) return;
    // Nothing in progress: any pointer still listed lost its end event, so it is stale.
    if (!drag.current && !multi.current) pointers.current.clear();
    pointers.current.add(event.pointerId);
    if (pointers.current.size > 1 || multi.current) {
      multi.current = true;
      abandon();
      return;
    }
    drag.current = { pointerId: event.pointerId, x0: event.clientX, y0: event.clientY, axis: null, dx: 0 };
    swipedAt.current = null;
    setNote('');
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const dx = event.clientX - current.x0;
    const dy = event.clientY - current.y0;
    if (current.axis === null) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      current.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (current.axis === 'x') {
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* the drag still works without it */ }
        setSnap(0);
      }
    }
    if (current.axis !== 'x') return;
    current.dx = dx;
    if ((dx < 0 && !onLeft) || (dx > 0 && !onRight)) {
      setSide(null);
      setSteps(0);
      return;
    }
    setSide(dx > 0 ? 'right' : 'left');
    setSteps(Math.min(STEPS, Math.floor(Math.abs(dx) / STEP)));
  }

  function finish(event: PointerEvent<HTMLDivElement>, act: boolean) {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    drag.current = null;
    if (current.axis !== 'x') return;
    swipedAt.current = now();
    const dx = Number.isFinite(event.clientX) ? event.clientX - current.x0 : current.dx;
    if (act && Math.abs(dx) >= SWIPE_DISTANCE) {
      const result = dx > 0 ? onRight?.() : onLeft?.();
      if (result === 'locked') setNote(read(lockedNote) ?? t('swipe.locked'));
    }
    const still = (dx < 0 && !onLeft) || (dx > 0 && !onRight);
    settle(still ? 0 : Math.min(STEPS, Math.floor(Math.abs(current.dx) / STEP)));
  }

  const armed = steps >= STEPS;
  const showRight = side === 'right' && onRight !== undefined;
  const showLeft = side === 'left' && onLeft !== undefined;
  const lockedLook = showRight && Boolean(read(rightLocked));

  return (
    <div className={cx(s.root, className)}>
      <div
        className={s.swipe}
        data-side={side ?? undefined}
        data-locked={lockedLook ? '' : undefined}
        data-armed={armed ? '' : undefined}
      >
        {showRight && (
          <div className={s.under} data-under="right" data-locked={lockedLook ? '' : undefined} aria-hidden="true">
            <span className={s.underIcon}><Icon name={lockedLook ? 'lock' : 'check'} size={20} /></span>
            {read(rightLabel)}
            {read(asksAgain) && !lockedLook && <small className={s.underSmall}>{t('swipe.asksAgain')}</small>}
          </div>
        )}
        {showLeft && (
          <div className={s.under} data-under="left" aria-hidden="true">
            <span className={s.underIcon}><Icon name="clock" size={20} /></span>
            {leftLabel ?? t('swipe.later')}
          </div>
        )}
        <div
          ref={card}
          className={s.card}
          data-swipe-card=""
          data-side={side ?? undefined}
          data-shift={steps > 0 ? steps : undefined}
          data-snap={snap > 0 ? snap : undefined}
          data-armed={armed ? '' : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => finish(event, true)}
          onPointerCancel={(event) => finish(event, false)}
          onKeyDownCapture={() => { swipedAt.current = null; }}
          onClickCapture={(event) => {
            const at = swipedAt.current;
            swipedAt.current = null;
            if (at === null || now() - at > CLICK_AFTER_SWIPE) return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {children}
        </div>
      </div>
      <p className={s.note} role="status">
        {note && <><Icon name="lock" size={14} />{note}</>}
      </p>
    </div>
  );
}
