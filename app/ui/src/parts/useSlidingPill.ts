import { useEffect, useLayoutEffect, useRef } from 'react';

/** What marks the current item in a row: a button pressed, the page's link, or C1's Tabs part. */
const CURRENT = '[aria-pressed="true"], [aria-current="page"], [data-current]';

/**
 * One pill under a row of tabs (one-shot C3 task 15). Give the returned ref to an `aria-hidden` span inside the row (the
 * row's positioned element is its offset parent); it sits under the current item and slides to the next one over the
 * press time through its CSS. It is placed through the element's style object (CSSOM, as the popovers are), from layout
 * offsets only, never a figure. The first placement has no transition: `data-pill-ready` goes on the row only after it,
 * so nothing moves at first paint, and the row's own CSS keeps the current item's fill until then. C1's Tabs part adopts
 * it with `data-tabs` and `data-current`.
 * It is placed again after every draw of its row, not only when the choice moves: the current item changes width when
 * its own words do (a count, a version badge read later), and an item before it moving it along does the same. A font
 * that loads late changes every width with no draw at all, so it is placed then too.
 */
export function useSlidingPill() {
  const pill = useRef<HTMLSpanElement>(null);
  const place = () => {
    const element = pill.current;
    const row = element?.parentElement;
    if (!element || !row) return;
    const current = row.querySelector<HTMLElement>(CURRENT);
    if (!current) { element.hidden = true; return; }
    element.hidden = false;
    // A row that is not laid out has nothing to place; the observer places it once it has a size.
    if (current.offsetWidth === 0) return;
    element.style.width = `${current.offsetWidth}px`;
    element.style.height = `${current.offsetHeight}px`;
    element.style.transform = `translate(${current.offsetLeft}px, ${current.offsetTop}px)`;
  };
  useLayoutEffect(place);
  useEffect(() => {
    const row = pill.current?.parentElement;
    if (!row) return undefined;
    let live = true;
    void document.fonts?.ready?.then(() => { if (live) place(); });
    const frame = requestAnimationFrame(() => row.setAttribute('data-pill-ready', ''));
    if (typeof ResizeObserver === 'undefined') return () => { live = false; cancelAnimationFrame(frame); };
    const observer = new ResizeObserver(place);
    observer.observe(row);
    return () => { live = false; cancelAnimationFrame(frame); observer.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return pill;
}
