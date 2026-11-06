import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './cx';
import { afterExit, motionOff } from './motion';
import s from './Swap.module.css';

/** Track a changing key: `old` holds what it just showed, until `clear`. Never on the first render; never with motion off. */
export function useSwapped<T>(key: unknown, content: T): { old: T | null; gen: number; clear: () => void } {
  const [state, setState] = useState<{ key: unknown; old: T | null; gen: number }>({ key, old: null, gen: 0 });
  const last = useRef(content);
  let shown = state;
  if (!Object.is(key, state.key)) {
    shown = { key, old: motionOff() ? null : last.current, gen: state.gen + 1 };
    setState(shown);
  }
  useLayoutEffect(() => { last.current = content; });
  return { old: shown.old, gen: shown.gen, clear: () => setState((now) => (now.old === null ? now : { ...now, old: null })) };
}

/** Removes the old copy when its fade ends, on its own timer if the end event never comes. */
export function useOldCopy<E extends HTMLElement = HTMLSpanElement>(gen: number, hasOld: boolean, clear: () => void) {
  const ref = useRef<E>(null);
  const latest = useRef(clear);
  latest.current = clear;
  useEffect(() => {
    if (!hasOld) return undefined;
    return afterExit(ref.current, () => latest.current());
  }, [gen, hasOld]);
  return ref;
}

/**
 * A state that changes in place (one-shot C3 task 8): when `value` changes while on screen, the old content fades out
 * where it stands (hidden from screen readers) while the new one fades in, so a word never jumps. Never on the first
 * render; with motion off only the new content. A repeated line that should show it ran again takes a new `value`.
 */
export function Swap({ value, children, className, block = false }: { value: string | number; children: ReactNode; className?: string | undefined; block?: boolean | undefined }) {
  const { old, gen, clear } = useSwapped<ReactNode>(value, children);
  const ref = useOldCopy<HTMLElement>(gen, old !== null, clear);
  const Tag = block ? 'div' : 'span';
  return (
    <Tag className={cx(s.swap, className)} data-swap-block={block ? '' : undefined}>
      {old !== null && <Tag ref={node => { ref.current = node; }} className={s.old} aria-hidden="true" inert data-swap-old="" onClickCapture={event => { event.preventDefault(); event.stopPropagation(); }} onSubmitCapture={event => { event.preventDefault(); event.stopPropagation(); }}>{old}</Tag>}
      <Tag key={gen} className={s.now} data-swap-new={gen > 0 ? '' : undefined}>{children}</Tag>
    </Tag>
  );
}

/**
 * The same for plain words inside a part that holds text directly (a button's label, a chip's word): at rest it adds no
 * element at all, so the part's markup stays as it was; only while the words change do two spans stand in. `slow`: both
 * move over the sheet time (money, which cross-fades and never rolls).
 */
export function SwapWords({ children, slow = false }: { children: string; slow?: boolean | undefined }) {
  const { old, gen, clear } = useSwapped<string>(children, children);
  const ref = useOldCopy(gen, old !== null, clear);
  if (old === null) return <>{children}</>;
  return (
    <span className={s.swap} data-slow={slow ? '' : undefined}>
      <span ref={ref} className={s.old} aria-hidden="true" data-swap-old="">{old}</span>
      <span className={s.now} data-swap-new="">{children}</span>
    </span>
  );
}
