import { useId, type ReactNode } from 'react';
import { useLanguage, useT } from '../../text';
import { useResource } from '../../engine/context';
import { goTo } from '../../shell/navigation';
import { useNarrow } from '../../shell/useNarrow';
import { Button } from '../../parts/Button';
import { Figure, proofOf, type FigureSize } from '../../parts/Figure';
import { Icon } from '../../parts/Icon';
import { GoalBar, GoalBarKey } from '../../parts/charts/GoalBar';
import { cx } from '../../parts/cx';
import { usePlainTiles } from '../../parts/Tile';
import {
  GOAL_EVENTS, goalFromBooks, goalFromView, monthBefore, monthOf, useGoalSuggestion, type GoalAmount, type GoalCardData, type GoalFootItem,
  type SuggestionState,
} from './goal';
import { TodayNextStep, type NextStepHost } from './NextStep';
import s from './GoalCard.module.css';

export interface GoalCardProps {
  data: GoalCardData;
  /** Change the month's goal (a set goal only): Business > Goals. */
  onEdit?: (() => void) | undefined;
  /** Set a goal for the month (no goal yet). */
  onSet?: (() => void) | undefined;
  /** No goal yet: the suggestion the owner may ask for, and the press that asks for it. */
  suggestion?: { state: SuggestionState; ask: () => void } | undefined;
  /** On a phone, the next best step folded into the card (D-Phone-Today). It holds the card's one filled button. */
  next?: ReactNode;
}

/**
 * The goal card (D-Today `section.goal`; dark with D's tiles, on the page ground when the place's tiles are plain). With a goal (W4 4I2) it shows what was invoiced this month, before
 * tax, "of" the goal, the engine's percent, the bar with what is ready to issue and today's pace, days left and the
 * foot figures, each with its receipt. With no goal for the month it still says what was invoiced, then asks for one,
 * with last month's figure; a suggestion, a model estimate on the owner's own AI, is asked for only on a press.
 * Without the goals view (W3) it says only what was invoiced and received. Its only filled button is a folded next step.
 */
export function GoalCard({ data, onEdit, onSet, suggestion, next }: GoalCardProps) {
  const t = useT();
  const headingId = useId();
  const plain = usePlainTiles();
  const tone = plain ? undefined : 'dark';
  const none = data.state === 'none';
  const received = data.state === 'none' || data.state === 'unset' ? data.received : null;
  const foot: GoalFootItem[] = data.state === 'set'
    ? data.foot
    : received ? [{ id: 'received', label: t('today.goal.received'), amount: received }] : [];
  const sub = none ? t('today.goal.beforeTax') : t('today.goal.invoiced');

  return (
    <section className={s.goal} aria-labelledby={headingId} data-card="" data-state={data.state} data-plain={plain ? '' : undefined}>
      <div className={s.top}>
        <span className={s.icon}><Icon name="target" size={16} /></span>
        <h2 id={headingId} className={s.label}>{none ? t('today.goal.invoiced') : t('today.goal.month', { month: data.month })}</h2>
        <span className={s.sub}>{data.business ? `${data.business} · ${sub}` : sub}</span>
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
        {data.state === 'set' && <span className={s.percent} data-num="">{data.percent}</span>}
      </div>
      {data.invoiced?.stale && <p className={s.stale}>{t('money.changed')}</p>}
      {/* One-shot B1 (bug 14): an empty invoiced sum (zero, no receipt) says so, never a blank space. */}
      {!data.invoiced && data.invoicedNone && <p className={s.askLine}>{t('today.goal.invoicedNone')}</p>}

      {data.state === 'set' && (
        <>
          <div className={s.bar}><GoalBar data={data.bar} tone={plain ? 'light' : 'dark'} /></div>
          <div className={s.key}>
            <GoalBarKey tone={plain ? 'light' : 'dark'} ready={data.ready ? <GoalFigure amount={data.ready} /> : undefined} />
          </div>
        </>
      )}

      {data.state === 'unset' && (
        <div className={s.ask}>
          <p className={s.askLine}>{t('today.goal.unset', { month: data.month })}</p>
          {data.lastMonth && (
            <p className={s.suggest}>
              <span>{t('today.goal.lastMonth', { month: data.lastMonth.month })}</span>
              <GoalFigure amount={data.lastMonth.amount} />
            </p>
          )}
          {data.suggested && (
            <p className={s.suggest}>
              <span>{t('today.goal.suggested')}</span>
              <Figure value={data.suggested} estimate tone={tone} />
            </p>
          )}
          {suggestion && <SuggestionLine state={suggestion.state} />}
          {(onSet || suggestion) && (
            <div className={s.askActs}>
              {suggestion && (
                <Button size="sm" disabled={suggestion.state.state === 'asking'} onClick={suggestion.ask}>{t('today.goal.suggest')}</Button>
              )}
              {/* B4: Today's one filled button is the next best step or a card, never this. */}
              {onSet && <Button size="sm" onClick={onSet}>{t('today.goal.set')}</Button>}
            </div>
          )}
        </div>
      )}

      {foot.length > 0 && (
        <dl className={s.foot} data-goal-foot="">
          {foot.map((item) => (
            <div key={item.id} className={s.footItem}>
              <dt className={s.footLabel} data-trend={item.trend}>
                {item.trend && <Icon name={item.trend === 'ahead' ? 'trending-up' : 'trending-down'} size={14} className={s.trend} />}
                {item.label}
              </dt>
              <dd className={s.footValue}>
                <GoalFigure amount={item.amount} />
                {item.amount.stale && <span className={s.stale}>{t('money.changed')}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {next && <div className={s.nextFold}>{next}</div>}
    </section>
  );
}

/** Figures on the goal card take the dark tone on D's dark card and the page's own on plain tiles. */
function useGoalTone(): 'dark' | undefined {
  return usePlainTiles() ? undefined : 'dark';
}

/** The suggestion the owner asked for: the engine's figure as a model estimate with the engine's own words, or why not. */
function SuggestionLine({ state }: { state: SuggestionState }) {
  const t = useT();
  const tone = useGoalTone();
  if (state.state === 'sent') {
    return (
      <>
        <p className={s.suggest}>
          <span>{t('today.goal.suggested')}</span>
          <Figure value={state.suggestion.display} estimate tone={tone} />
        </p>
        <p className={s.suggestLine}>{state.suggestion.line}</p>
      </>
    );
  }
  if (state.state === 'none') return <p className={s.suggestLine}>{t('today.goal.noSuggestion')}</p>;
  if (state.state === 'failed') return <p className={s.suggestLine} role="alert">{t('today.goal.suggestFailed', { message: state.message })}</p>;
  return null;
}

/** An amount on the card, with its receipt (or "model estimate"): the dark tone on D's dark card. */
function GoalFigure({ amount, size, className }: { amount: GoalAmount; size?: FigureSize | undefined; className?: string | undefined }) {
  const tone = useGoalTone();
  const proof = proofOf(amount);
  return proof ? <Figure {...proof} value={amount.value} size={size} tone={tone} className={className} /> : null;
}

/**
 * Today's goal card and the next best step (W4 4I2), both from `venture.goals.get`: beside the card on a wide screen,
 * folded into it on a phone (D-Phone-Today). Until the view answers nothing is drawn; when it cannot be read (an engine
 * without goals), the card falls back to this month's books, as in W3. `spans`: Today lists more than one business, so
 * the card names the open one. The rest of Today never waits on it.
 */
export function TodayGoal({ next, spans }: { next: NextStepHost; spans: boolean }) {
  const t = useT();
  const language = useLanguage();
  const phone = useNarrow();
  const goals = useResource('venture.goals.get', {}, { refreshOn: GOAL_EVENTS });
  const view = goals.data;
  const fallback = !view && Boolean(goals.error);
  const books = useResource('venture.books.summary', { period: 'this-month' }, { refreshOn: GOAL_EVENTS, skip: !fallback });
  const venture = useResource('venture.get', {}, { refreshOn: GOAL_EVENTS, skip: !spans });
  const suggestion = useGoalSuggestion(view?.state === 'unset' ? view.month : null);

  if (!view) {
    return fallback && books.data ? <GoalCard data={goalFromBooks(books.data, monthOf(books.data.period.from))} /> : null;
  }
  const data = goalFromView(view, {
    month: monthOf(`${view.month}-01`),
    lastMonth: monthOf(monthBefore(view.month)),
    business: spans ? venture.data?.venture.workingName : undefined,
  }, t);
  const toGoals = () => goTo('business', 'goals');
  // The step's card must be on Today, not decided here already: the step presses that card's own primary.
  const step = view.next;
  const row = step ? next.rows.find((r) => r.id === step.rowId && !next.isDecided(r.id)) : undefined;
  const ask = view.state === 'unset' ? { state: suggestion.suggestion, ask: suggestion.ask } : undefined;
  if (phone) {
    return (
      <GoalCard
        data={data} onEdit={toGoals} onSet={toGoals} suggestion={ask}
        next={step && row ? <TodayNextStep step={step} row={row} host={next} folded /> : undefined}
      />
    );
  }
  return (
    <div className={s.row} data-next={step && row ? '' : undefined}>
      <GoalCard data={data} onEdit={toGoals} onSet={toGoals} suggestion={ask} />
      {step && row && <TodayNextStep step={step} row={row} host={next} />}
    </div>
  );
}
