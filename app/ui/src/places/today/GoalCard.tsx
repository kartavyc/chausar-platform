import { memo, useId } from 'react';
import { useLanguage, useT } from '../../text';
import { useResource } from '../../engine/context';
import type { VentureRunEvent } from '../../engine/types';
import { Button } from '../../parts/Button';
import { Figure, proofOf, type FigureSize } from '../../parts/Figure';
import { Icon } from '../../parts/Icon';
import { GoalBar, GoalBarKey } from '../../parts/charts/GoalBar';
import { cx } from '../../parts/cx';
import { goalFromBooks, monthOf, type GoalAmount, type GoalCardData, type GoalFootItem } from './goal';
import s from './GoalCard.module.css';

export interface GoalCardProps {
  data: GoalCardData;
  /** Change the month's goal (a set goal only). W4 4I opens Business > Goals with it. */
  onEdit?: (() => void) | undefined;
  /** Set a goal for the month (no goal yet). */
  onSet?: (() => void) | undefined;
}

/**
 * The dark goal card (D-Today `section.goal`). Before goals exist (W3) it says what was invoiced this month, before
 * tax, with its receipt, and what came in; it draws no bar, no percent and no goal it does not have. With a goal
 * (W4 4I) it adds "of" the goal, the percent, the bar with what is ready to issue and today's pace, days left and the
 * foot figures, each with its receipt. With no goal set for the month it asks for one, with a suggested figure the
 * model wrote, labelled as a model estimate. It is one card: at most one filled button.
 */
export function GoalCard({ data, onEdit, onSet }: GoalCardProps) {
  const t = useT();
  const headingId = useId();
  const none = data.state === 'none';
  const foot: GoalFootItem[] = data.state === 'set'
    ? data.foot
    : data.state === 'none' && data.received ? [{ id: 'received', label: t('today.goal.received'), amount: data.received }] : [];

  return (
    <section className={s.goal} aria-labelledby={headingId} data-card="" data-state={data.state}>
      <div className={s.top}>
        <span className={s.icon}><Icon name="target" size={16} /></span>
        <h2 id={headingId} className={s.label}>{none ? t('today.goal.invoiced') : t('today.goal.month', { month: data.month })}</h2>
        <span className={s.sub}>{none ? t('today.goal.beforeTax') : t('today.goal.invoiced')}</span>
        {(data.state === 'set' ? data.daysLeft : data.month) && (
          <span className={s.pill}>
            <Icon name="calendar" size={14} />
            {data.state === 'set' ? data.daysLeft : data.month}
          </span>
        )}
        {data.state === 'set' && onEdit && (
          <button type="button" className={s.edit} aria-label={t('today.goal.edit')} onClick={onEdit}>
            <Icon name="pencil" size={16} />
          </button>
        )}
      </div>

      <div className={s.figures}>
        {data.invoiced && <GoalFigure amount={data.invoiced} size="goal" className={s.amount} />}
        {data.state === 'set' && (
          <span className={s.of}>
            {t('today.goal.of')}
            <GoalFigure amount={data.goal} />
          </span>
        )}
        {data.state === 'set' && <span className={cx(s.percent, 'mono')}>{data.percent}</span>}
      </div>
      {data.invoiced?.stale && <p className={s.stale}>{t('money.changed')}</p>}

      {data.state === 'set' && (
        <>
          <div className={s.bar}><GoalBar data={data.bar} /></div>
          <div className={s.key}>
            <GoalBarKey ready={data.ready ? <GoalFigure amount={data.ready} /> : undefined} />
          </div>
        </>
      )}

      {data.state === 'unset' && (
        <div className={s.ask}>
          <p className={s.askLine}>{t('today.goal.unset', { month: data.month })}</p>
          <p className={s.suggest}>
            <span>{t('today.goal.suggested')}</span>
            <Figure value={data.suggested} estimate tone="dark" />
          </p>
          {onSet && <Button variant="primary" onClick={onSet}>{t('today.goal.set')}</Button>}
        </div>
      )}

      {foot.length > 0 && (
        <dl className={s.foot} data-goal-foot="">
          {foot.map((item) => (
            <div key={item.id} className={s.footItem}>
              <dt className={s.footLabel}>{item.label}</dt>
              <dd className={s.footValue}>
                {item.trend === 'ahead' && <Icon name="trending-up" size={16} className={s.trend} />}
                <GoalFigure amount={item.amount} />
                {item.trend && <span>{t(item.trend === 'ahead' ? 'today.goal.ahead' : 'today.goal.behind')}</span>}
                {item.amount.stale && <span className={s.stale}>{t('money.changed')}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/** An amount on the dark card, with its receipt (or "model estimate"). */
function GoalFigure({ amount, size, className }: { amount: GoalAmount; size?: FigureSize | undefined; className?: string | undefined }) {
  const proof = proofOf(amount);
  return proof ? <Figure {...proof} value={amount.value} size={size} tone="dark" className={className} /> : null;
}

/** The books are read again when an invoice is issued or a payment recorded, which changes the queue. */
const BOOKS_EVENTS = (event: VentureRunEvent) => event.type === 'queue.changed';

/**
 * Today's goal card before goals exist: this month's books, read from the engine. Nothing is drawn until they answer,
 * and nothing when they cannot be read (the rest of Today does not wait on them).
 */
export const TodayGoal = memo(function TodayGoal() {
  const language = useLanguage();
  const books = useResource('venture.books.summary', { period: 'this-month' }, { refreshOn: BOOKS_EVENTS });
  if (!books.data) return null;
  return <GoalCard data={goalFromBooks(books.data, monthOf(books.data.period.from, language === 'hi' ? 'hi-IN' : 'en-IN'))} />;
});
