/**
 * BK-09, round 4: the ways a copy can be published, each with its impact preview from core
 * (`trials.impact`) before anything is published. "From now on" (prospective) and "from now
 * on, and work out saved answers again" (retrospective) are both offered; a way core refuses
 * shows its code, and a way with open jobs or actions cannot be published until they settle.
 * Publishing names the way and the exact impact digest the person saw.
 */
import { Note, Section, Actions, Button } from '../work/kit/Page';
import type { StrategyImpact } from './contract-r4b.ts';
import { approves, fill, styles as s, type BooksProps } from './shared.tsx';
import { useR4bWords } from './words-r4b.ts';

export function TrialStrategies({ props, impacts, canPublish, busy, onPublish }: {
  props: BooksProps; impacts: readonly StrategyImpact[]; canPublish: boolean; busy: boolean; onPublish: (impact: StrategyImpact) => void;
}) {
  const k = useR4bWords(props.language);
  return (
    <Section title={k['strat.title']}>
      <ul className={s.list} data-strategies>
        {impacts.map(i => {
          const name = k[`strat.name.${i.strategy}`];
          const open = i.digest !== null && i.activeWork > 0;
          return (
            <li key={i.strategy} data-strategy={i.strategy} className={s.stack}>
              <strong>{name}</strong>
              <span>{k[`strat.about.${i.strategy}`]}</span>
              {i.digest === null
                ? <span className={s.amber} data-refused={i.code ?? ''}>{fill(k['strat.refused'], { code: i.code ?? '' })}</span>
                : <>
                  <span data-impact={i.strategy}>{fill(k['strat.impact'], { n: i.affectedAnswers, r: i.rebuild, a: i.activeWork })}</span>
                  {props.view !== 'simple' && i.preserved > 0 && <Note>{fill(k['strat.kept'], { n: i.preserved })}</Note>}
                  {open && <span className={s.amber}>{k['strat.openWork']}</span>}
                </>}
              {approves(props) && canPublish && i.digest !== null && !open && (
                <Actions><Button variant="filled" onClick={() => onPublish(i)} disabled={busy}>{fill(k['strat.publish'], { name })}</Button></Actions>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
