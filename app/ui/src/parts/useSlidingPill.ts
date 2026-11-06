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
 */
export function useSlidingPill(value: unknown) {
  const pill = useRef<HTMLSpanElement>(null);
  const place = () => {
    const element = pill.current;
    const row = element?.parentElement;
    if (!element || !row) return;
    const current = row.querySelector<HTMLElement>(CURRENT);
    if (!current) { element.hidden = true; return; }
    element.hidden = false;
    element.style.width = `${current.offsetWidth}px`;
    element.style.height = `${current.offsetHeight}px`;
    element.style.transform = `translate(${current.offsetLeft}px, ${current.offsetTop}px)`;
  };
  useLayoutEffect(place, [value]);
  useEffect(() => {
    const row = pill.current?.parentElement;
    if (!row) return undefined;
    const frame = requestAnimationFrame(() => row.setAttribute('data-pill-ready', ''));
    if (typeof ResizeObserver === 'undefined') return () => cancelAnimationFrame(frame);
    const observer = new ResizeObserver(place);
    observer.observe(row);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return pill;
}
