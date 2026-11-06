import { useState, type FormEvent } from 'react';
import { useT, type T } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Figure } from '../../parts/Figure';
import { useMonth } from '../../parts/when';
import { GoalBar } from '../../parts/charts/GoalBar';
import { EngineError, type GoalView } from '../../engine/types';
import { GOAL_EVENTS, goalAmount, goalFromView, monthBefore, monthOf, useGoalSuggestion } from '../today/goal';
import { TileSection, messageOf, usePlan } from './shared';
import { DraftRecover, DraftWord, useSettingsDraft } from './settingsDraft';
import { ResultLine } from '../../parts/ResultLine';
import b from './Business.module.css';
import s from './GoalsView.module.css';
import { Progress } from '../../parts/Progress';

/**
 * Business > Goals (W4 4I2): the owner's monthly goal, money invoiced in the month before tax (founder, 23 Oct). The
 * month chosen (this one, or one up to a year ahead) shows the goal in use with its receipt, what was invoiced toward
 * it and the bar the engine scaled; with no goal, last month's figure and the engine's suggestion, a model estimate
 * the owner may copy into the field. The goal is sent as typed; the engine reads it in the business's currency, checks
 * it, keeps it, and the newest goal for a month is the one in use. Nothing is converted here. Beside it, the goals of the three months before, each with how far it got. Today's goal card reads the same view.
 */
export function GoalsView() {
  const t = useT();
  const current = useResource('venture.goals.get', {}, { refreshOn: GOAL_EVENTS });
  const thisMonth = current.data?.month;
  const month = thisMonth;
  const view = current.data;
  const failed = current.error;
  const words = useMonth();

  return (
    <div className={b.page}>
      <div className={b.split}>
        {month && thisMonth ? (
          <MonthGoal
            key={month}
            month={month}
            words={words}
            view={view && view.month === month ? view : undefined}
            failed={failed ? messageOf(failed) : undefined}
          />
        ) : (
          current.error && <p className={b.problem} role="alert">{messageOf(current.error)}</p>
        )}
        {thisMonth && <EarlierGoals thisMonth={thisMonth} words={words} />}
      </div>
    </div>
  );
}

/** An engine refusal in the reader's words where the UI words its code; otherwise the engine's own sentence. */
function refusal(error: unknown, t: T): string {
  const code = error instanceof EngineError ? error.code : '';
  if (code === 'GOAL_INVALID') return t('business.goals.typeAmount');
  if (code === 'GOAL_MONTH_PAST') return t('business.goals.refused.past');
  return t('business.goals.failed', { message: messageOf(error) });
}

interface MonthGoalProps {
  month: string;
  words: (month: string) => string;
  view: GoalView | undefined;
  failed: string | undefined;
}

/** One month's goal: the one in use (or the ask), and the form that sets it. One filled button. */
function MonthGoal({ month, words, view, failed }: MonthGoalProps) {
  const t = useT();
  const client = useEngine();
  const plan = usePlan();
  const taxRegistered = plan.data?.blueprint.backOffice.taxRegistered.value === true;
  // The goal's currency in words, from the business's plan: the field never assumes rupees.
  const currency = plan.data?.blueprint.backOffice.currency ?? '';
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<GoalView | null>(null);
  const shown = answer ?? view;
  // W4 4J21: the typed goal is kept in the vault as a draft of exactly what venture.goals.set takes, and offered back.
  const draft = useSettingsDraft<{ month: string; amount: string }>('goals', { month, amount: typed }, typed.trim() !== '');
  const offer = draft.offer && draft.offer.values.month === month && draft.offer.values.amount && !typed ? draft.offer : null;
  // Asked only on a press of "Suggest a goal", and never for a month that has a goal.
  const { suggestion, ask } = useGoalSuggestion(shown?.state === 'unset' ? month : null);
  const pastBy = shown?.past ? goalAmount(shown.pastBy) : null;
  const data = shown ? goalFromView(shown, { month: words(month), lastMonth: monthOf(monthBefore(month)) }, t) : null;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!typed.trim()) { setProblem(t('business.goals.typeAmount')); return; }
    setProblem(null);
    setBusy(true);
    try {
      // The goal goes as typed; the engine reads it in the business's currency.
      setAnswer(await client.request('venture.goals.set', { month, amount: typed }));
      setTyped('');
      setEditing(false);
    } catch (error) {
      setProblem(refusal(error, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TileSection title={t('business.goals.month', { month: words(month) })}>
      {failed && !shown && <p className={b.problem} role="alert">{failed}</p>}
      {data?.state === 'set' && (
        <>
          <dl className={s.figures}>
            <div className={s.pair}>
              <dt>{t('business.goals.inUse')}</dt>
              <dd><Figure value={data.goal.value} receiptId={data.goal.receiptId!} size="tile" /></dd>
            </div>
            {data.invoiced && (
              <div className={s.pair}>
                <dt>{t('business.goals.invoiced')}</dt>
                <dd><Figure value={data.invoiced.value} receiptId={data.invoiced.receiptId!} size="tile" /></dd>
              </div>
            )}
            <div className={s.pair}>
              <dt>{t('business.goals.share')}</dt>
              <dd data-num="">{data.percent}</dd>
            </div>
            {pastBy && (
              <div className={s.pair}>
                <dt>{t('today.goal.foot.past')}</dt>
                <dd><Figure value={pastBy.value} receiptId={pastBy.receiptId!} size="tile" /></dd>
              </div>
            )}
          </dl>
          <GoalBar data={data.bar} tone="light" />
          {/* C4 task 34 (140.x1): the pace sentence Today's goal shows, from the same engine field (pacePercent). */}
          {shown?.pace && <p className={b.line} data-goal-pace="">{t('today.goal.bar.pace', { pace: `${shown.pacePercent}%` })}</p>}
        </>
      )}
      {data?.state === 'unset' && (
        <>
          <p className={b.line}>{t('business.goals.none', { month: words(month) })}</p>
          {suggestion.state === 'sent' && (
            <>
              <p className={s.inline}>
                <span>{t('today.goal.suggested')}</span>
                <Figure value={suggestion.suggestion.display} estimate />
                <Button size="sm" onClick={() => { setTyped(suggestion.suggestion.typed); setProblem(null); }}>{t('business.goals.useSuggested')}</Button>
              </p>
              <p className={b.quiet}>{suggestion.suggestion.line}</p>
            </>
          )}
          {suggestion.state === 'none' && <p className={b.quiet}>{t('today.goal.noSuggestion')}</p>}
          <Progress kind="goal-suggest" active={suggestion.state === 'asking'} />
          {suggestion.state === 'failed' && <p className={b.problem} role="alert">{t('today.goal.suggestFailed', { message: suggestion.message })}</p>}
        </>
      )}
      {offer && <DraftRecover offer={offer} onRecover={(values) => { setTyped(values.amount); setProblem(null); draft.taken(); }} onDecline={draft.decline} />}
      {shown?.state === 'set' && !editing ? <Button variant="quiet" onClick={() => setEditing(true)}>{t('business.goals.edit')}</Button> : <form className={b.priceForm} onSubmit={(event) => void save(event)} noValidate>
        <Field
          label={t('business.goals.amountField')}
          hint={t(taxRegistered ? 'business.goals.amountHintTax' : 'business.goals.amountHint', { currency })}
          inputMode="decimal" autoComplete="off" value={typed} disabled={busy} placeholder={t('business.goals.placeholder')}
          onChange={(event) => { setTyped(event.currentTarget.value); setProblem(null); }}
        />
        {shown?.state === 'unset' && suggestion.state !== 'sent' && <Button variant="quiet" size="sm" disabled={suggestion.state === 'asking'} onClick={ask}>{t('business.goals.suggest')}</Button>}
        {/* C4 task 34 (13.x1): last month's invoiced figure beside the field, set or not, with its receipt. */}
        {shown && (
          shown.lastMonth?.receiptId
            ? <p className={s.inline} data-last-month=""><span>{t('today.goal.lastMonth', { month: monthOf(monthBefore(month)) })}</span><Figure value={shown.lastMonth.display} receiptId={shown.lastMonth.receiptId} /></p>
            : <p className={b.quiet} data-last-month="">{t('business.goals.noLastMonth')}</p>
        )}
        <ResultLine tone="problem">{problem}</ResultLine>
        <div className={b.formEnd}>
          <DraftWord saved={draft.saved} refused={draft.refused} shown={typed.trim() !== ''} />
          <Button variant="primary" type="submit" disabled={busy}>{t(shown?.state === 'set' ? 'business.goals.change' : 'business.goals.set')}</Button>
        </div>
      </form>}
    </TileSection>
  );
}

/** The goals of the three months before this one, each with what was invoiced and how far it got. */
function EarlierGoals({ thisMonth, words }: { thisMonth: string; words: (month: string) => string }) {
  const t = useT();
  const one = monthBefore(thisMonth).slice(0, 7);
  const two = monthBefore(one).slice(0, 7);
  const three = monthBefore(two).slice(0, 7);
  const reads = [
    useResource('venture.goals.get', { month: one }, { refreshOn: GOAL_EVENTS }),
    useResource('venture.goals.get', { month: two }, { refreshOn: GOAL_EVENTS }),
    useResource('venture.goals.get', { month: three }, { refreshOn: GOAL_EVENTS }),
  ];
  const set = reads.flatMap((read) => (read.data && read.data.state === 'set' && read.data.goal ? [read.data] : []));
  if (set.length === 0) return null;
  return (
    <TileSection title={t('business.goals.earlier')}>
        <ul className={s.list}>
          {set.map((view) => {
            const invoiced = goalAmount(view.invoiced);
            return (
              <li key={view.month} className={s.item}>
                <span className={s.itemMonth}>{words(view.month)}</span>
                <span className={s.inline}>
                  <span>{t('business.goals.goal')}</span>
                  <Figure value={view.goal!.display} receiptId={view.goal!.receiptId} />
                </span>
                {invoiced && (
                  <span className={s.inline}>
                    <span>{t('business.goals.invoiced')}</span>
                    <Figure value={invoiced.value} receiptId={invoiced.receiptId!} />
                  </span>
                )}
                {view.invoicedPercent !== null && <span data-num="">{`${view.invoicedPercent}%`}</span>}
              </li>
            );
          })}
        </ul>
    </TileSection>
  );
}
