import { useLanguage, useT } from '../../text';
import type { OrderLite, OrderStageView } from '../../engine/types';
import { Icon } from '../../parts/Icon';
import type { IconName } from '../../parts/icons';
import s from './OrderSteps.module.css';

/** The mark on each step, by its state: a tick, a clock while it waits on the owner, a lock where it always asks, a
 *  question mark where the engine is not sure; a step not reached yet is an empty dashed circle. */
const MARK: Record<OrderStageView['state'], IconName | null> = { done: 'check', waits: 'clock', 'always-asks': 'lock', unknown: 'circle-help', 'not-yet': null };

const LOCALE = { en: 'en-IN', hi: 'hi-IN' } as const;

/**
 * W4 4J19: an order's stage steps (D-Work `.osteps`), read by the engine from the order's records (4J3's
 * money/order-steps.ts), worded on screen from the engine's codes in English and Hindi: each step's name and state, who
 * it waits on and the day a payment is due for a screen reader; then what waits on the owner, counted and named by the
 * steps the engine lists ("2 wait on you: Price, Episode"). The engine's English detail and line are never shown, so a
 * Hindi screen reads Hindi. Nothing is drawn for an order the engine sends no steps for.
 */
export function OrderSteps({ order }: { order: OrderLite }) {
  const t = useT();
  const language = useLanguage();
  const stages = order.stages ?? [];
  if (stages.length === 0) return null;
  const waits = order.waitsOnYou;
  const day = (iso: string) => {
    const date = new Date(`${iso}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat(LOCALE[language], { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
  };
  const name = (id: OrderStageView['id']) => t(`work.steps.stage.${id}`);
  return (
    <>
      <ol className={s.steps} aria-label={t('work.steps.label')} data-order-steps="">
        {stages.map((stage, index) => {
          const mark = MARK[stage.state] ?? null;
          const reached = index > 0 && stages[index - 1]!.state === 'done';
          const extra = [
            stage.waitsOn && stage.waitsOn !== 'you' ? t(`work.steps.waitsOn.${stage.waitsOn}`) : null,
            stage.due ? t('work.steps.due', { date: day(stage.due) }) : null,
          ].filter(Boolean);
          return (
            <li key={`${stage.id}:${index}`} className={s.step} data-state={stage.state} data-waits-on={stage.waitsOn}>
              {index > 0 && <span className={s.line} data-reached={reached ? '' : undefined} aria-hidden="true" />}
              <span className={s.dot} aria-hidden="true">{mark && <Icon name={mark} size={12} />}</span>
              <span className={s.label}>{name(stage.id)}</span>
              <span className="sr-only">, {[t(`work.steps.state.${stage.state}`), ...extra].join(', ')}</span>
            </li>
          );
        })}
      </ol>
      {waits && waits.count > 0 && (
        <p className={s.waits} data-waits-on-you="">
          <Icon name="clock" size={14} />
          <span>{t('work.steps.waits', { count: String(waits.count), stages: waits.items.map((item) => name(item.stage)).join(', ') })}</span>
        </p>
      )}
    </>
  );
}
