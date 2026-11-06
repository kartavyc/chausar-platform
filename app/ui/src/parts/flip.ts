import { useLayoutEffect, useRef, type RefObject } from 'react';
import { motionOff } from './motion';

/**
 * Rows that stay slide to their new place (one-shot C3 task 13): when a filter, a sort, a reorder or a move between
 * groups changes a list, each row with `data-flip-id` inside `container` starts from where it stood and eases to where
 * it now is. One measure before, one after; transform only, through the element's style object (CSSOM, which the strict
 * policy allows). None with motion off, and none for a row that has no earlier place.
 */
export function flipFrom(container: Element, before: ReadonlyMap<string, DOMRect>): void {
  if (motionOff()) return;
  for (const element of container.querySelectorAll<HTMLElement>('[data-flip-id]')) {
    const from = before.get(element.dataset.flipId!);
    if (!from) continue;
    const to = element.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (!dx && !dy) continue;
    element.style.transition = 'none';
    element.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      element.style.transition = 'transform var(--t-sheet) var(--ease)';
      element.style.transform = '';
      const clear = () => { element.style.transition = ''; element.removeEventListener('transitionend', clear); };
      element.addEventListener('transitionend', clear);
    });
  }
}

/** Where each row stands now. */
export function measureRows(container: Element): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>();
  for (const element of container.querySelectorAll<HTMLElement>('[data-flip-id]')) rects.set(element.dataset.flipId!, element.getBoundingClientRect());
  return rects;
}

/**
 * Hook form: give the list's element the ref and pass `order`, the list's keys in order joined by anything stable.
 * Rows are measured after every commit and moved only when the order changed; a first render moves nothing.
 */
export function useFlip<E extends Element>(order: string): RefObject<E | null> {
  const container = useRef<E | null>(null);
  const last = useRef<{ order: string; rects: Map<string, DOMRect> } | null>(null);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const previous = last.current;
    if (previous && previous.order !== order) flipFrom(element, previous.rects);
    last.current = { order, rects: measureRows(element) };
  });
  return container;
}
