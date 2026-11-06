import { cx } from './cx';
import { useOldCopy, useSwapped } from './Swap';
import figure from './Figure.module.css';
import s from './Count.module.css';

/**
 * A count (steps, people, runs, things waiting): the body font with tabular figures (B2), no proof, and no
 * `data-ui-number`, since it is not money. When the number changes while on screen (one-shot C3 task 14) the old slides
 * up and out and the new comes in, once, over the press time: one step, never counting through numbers that did not
 * exist. Nothing at first render; with motion off only the new number. Money never comes here: `Figure` cross-fades.
 */
export function Count({ value, className }: { value: number | string; className?: string | undefined }) {
  const { old, gen, clear } = useSwapped<number | string>(value, value);
  const ref = useOldCopy(gen, old !== null, clear);
  return (
    <span className={cx(figure.count, className)} data-count="">
      {old === null ? value : (
        <span className={s.roll}>
          <span ref={ref} className={s.out} aria-hidden="true" data-roll-old="">{old}</span>
          <span className={s.in} data-roll-new="">{value}</span>
        </span>
      )}
    </span>
  );
}
