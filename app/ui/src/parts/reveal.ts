/** How far a focus ring reaches outside a control: the 2 px outline plus its 2 px offset (tokens/base.css). */
const RING_ROOM = 4;

/**
 * Scroll a row sideways, only as far as it must, so that `item` is in view with room for its focus ring (the
 * pressed filter chip or the current segment in a phone row that bleeds off the edge). It moves the row alone:
 * unlike `scrollIntoView`, it never scrolls the page up or down. These are layout pixels, never money.
 */
export function revealInRow(row: HTMLElement, item: HTMLElement): void {
  const start = item.offsetLeft - RING_ROOM;
  const end = item.offsetLeft + item.offsetWidth + RING_ROOM;
  if (start < row.scrollLeft) row.scrollLeft = Math.max(0, start);
  else if (end > row.scrollLeft + row.clientWidth) row.scrollLeft = end - row.clientWidth;
}
