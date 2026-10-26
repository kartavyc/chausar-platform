import { useId, useState, type FormEvent } from 'react';
import { useLanguage, useT, type T } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Figure } from '../../parts/Figure';
import { GoalBar } from '../../parts/charts/GoalBar';
import { EngineError, type GoalView } from '../../engine/types';
import { GOAL_EVENTS, goalAmount, goalFromView, monthBefore, monthOf, useGoalSuggestion } from '../today/goal';
import { TileSection, messageOf, usePlan } from './shared';
import { DraftRecover, DraftWord, useSettingsDraft } from './settingsDraft';
import b from './Business.module.css';
import s from './GoalsView.module.css';

/**
 * Business > Goals (W4 4I2): the owner's monthly goal, money invoiced in the month before tax (founder, 23 Oct). The
 * month chosen (this one, or one up to a year ahead) shows the goal in use with its receipt, what was invoiced toward
 * it and the bar the engine scaled; with no goal, last month's figure and the engine's suggestion, a model estimate
 * the owner may copy into the field. The goal is sent as typed; the engine reads it in the business's currency, checks
 * it, keeps it, and the newest goal for a month is the one in use. Nothing is converted here. Beside it, the goals of the three months before, each with how far it got. Today's goal card reads the same view.
 */
export function GoalsView() {
  const t = useT();
  const language = useLanguage();
  const locale = language === 'hi' ? 'hi-IN' : 'en-IN';
  const current = useResource('venture.goals.get', {}, { refreshOn: GOAL_EVENTS });
  const [picked, setPicked] = useState<string | null>(null);
  const thisMonth = current.data?.month;
  const month = picked ?? thisMonth;
  const other = useResource('venture.goals.get', { month: month ?? '' }, { refreshOn: GOAL_EVENTS, skip: !month || month === thisMonth });
  const view = month === thisMonth ? current.data : other.data;
  const failed = month === thisMonth ? current.error : other.error;
  const words = (m: string) => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1));

  return (
    <div className={b.page}>
      <div className={b.split}>
        {month && thisMonth ? (
          <MonthGoal
            key={month}
            month={month}
            months={ahead(thisMonth)}
            words={words}
            view={view && view.month === month ? view : undefined}
            failed={failed ? messageOf(failed) : undefined}
            onMonth={setPicked}
          />
        ) : (
          current.error && <p className={b.problem} role="alert">{messageOf(current.error)}</p>
        )}
        {thisMonth && <EarlierGoals thisMonth={thisMonth} words={words} />}
      </div>
    </div>
  );
}

/** This month and the eleven after it, as 'YYYY-MM': calendar parts only. */
function ahead(month: string): string[] {
  const months: string[] = [];
  let year = Number(month.slice(0, 4)), index = Number(month.slice(5, 7));
  for (let i = 0; i < 12; i++) {
    months.push(`${year}-${String(index).padStart(2, '0')}`);
    index += 1;
    if (index > 12) { index = 1; year += 1; }
  }
  return months;
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
  months: string[];
  words: (month: string) => string;
  view: GoalView | undefined;
  failed: string | undefined;
  onMonth: (month: string) => void;
}

/** One month's goal: the one in use (or the ask), and the form that sets it. One filled button. */
function MonthGoal({ month, months, words, view, failed, onMonth }: MonthGoalProps) {
  const t = useT();
  const language = useLanguage();
  const locale = language === 'hi' ? 'hi-IN' : 'en-IN';
  const client = useEngine();
  const plan = usePlan();
  const taxRegistered = plan.data?.blueprint.backOffice.taxRegistered.value === true;
  // The goal's currency in words, from the business's plan: the field never assumes rupees.
  const currency = plan.data?.blueprint.backOffice.currency ?? '';
  const monthId = useId();
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<GoalView | null>(null);
  const shown = answer ?? view;
  // W4 4J21: the typed goal is kept in the vault as a draft of exactly what venture.goals.set takes, and offered back.
  const draft = useSettingsDraft<{ month: string; amount: string }>('goals', { month, amount: typed }, typed.trim() !== '');
  const offer = draft.offer && draft.offer.values.month === month && draft.offer.values.amount && !typed ? draft.offer : null;
  // Asked only on a press of "Suggest a goal", and never for a month that has a goal.
  const { suggestion, ask } = useGoalSuggestion(shown?.state === 'unset' ? month : null);
  const pastBy = shown?.past ? goalAmount(shown.pastBy) : null;
  const data = shown ? goalFromView(shown, { month: words(month), lastMonth: monthOf(monthBefore(month), locale) }, t) : null;

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaved(null);
    if (!typed.trim()) { setProblem(t('business.goals.typeAmount')); return; }
    setProblem(null);
    setBusy(true);
    try {
      // The goal goes as typed; the engine reads it in the business's currency.
      setAnswer(await client.request('venture.goals.set', { month, amount: typed }));
      setTyped('');
      setSaved(t('business.goals.saved', { month: words(month) }));
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
              <dd className="mono">{data.percent}</dd>
            </div>
            {pastBy && (
              <div className={s.pair}>
                <dt>{t('today.goal.foot.past')}</dt>
                <dd><Figure value={pastBy.value} receiptId={pastBy.receiptId!} size="tile" /></dd>
              </div>
            )}
          </dl>
          <GoalBar data={data.bar} tone="light" />
        </>
      )}
      {data?.state === 'unset' && (
        <>
          <p className={b.line}>{t('business.goals.none', { month: words(month) })}</p>
          {data.lastMonth && (
            <p className={s.inline}>
              <span>{t('today.goal.lastMonth', { month: data.lastMonth.month })}</span>
              <Figure value={data.lastMonth.amount.value} receiptId={data.lastMonth.amount.receiptId!} />
            </p>
          )}
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
          {suggestion.state === 'failed' && <p className={b.problem} role="alert">{t('today.goal.suggestFailed', { message: suggestion.message })}</p>}
          {suggestion.state !== 'sent' && (
            <div>
              <Button size="sm" disabled={suggestion.state === 'asking'} onClick={ask}>{t('today.goal.suggest')}</Button>
            </div>
          )}
        </>
      )}
      {offer && <DraftRecover offer={offer} onRecover={(values) => { setTyped(values.amount); setProblem(null); draft.taken(); }} onDecline={draft.decline} />}
      <form className={b.priceForm} onSubmit={(event) => void save(event)} noValidate>
        <div className={s.field}>
          <label htmlFor={monthId} className={s.label}>{t('business.goals.monthField')}</label>
          <select id={monthId} className={s.select} value={month} disabled={busy} onChange={(event) => onMonth(event.currentTarget.value)}>
            {months.map((option) => <option key={option} value={option}>{words(option)}</option>)}
          </select>
        </div>
        <Field
          label={t('business.goals.amountField')}
          hint={t(taxRegistered ? 'business.goals.amountHintTax' : 'business.goals.amountHint', { currency })}
          inputMode="decimal" autoComplete="off" value={typed} disabled={busy}
          onChange={(event) => { setTyped(event.currentTarget.value); setProblem(null); }}
        />
        {problem && <p className={b.problem} role="alert">{problem}</p>}
        {saved && <p className={b.quiet} role="status">{saved}</p>}
        <div className={b.formEnd}>
          <DraftWord saved={draft.saved} refused={draft.refused} shown={typed.trim() !== ''} />
          <Button variant="primary" type="submit" disabled={busy}>{t(shown?.state === 'set' ? 'business.goals.change' : 'business.goals.set')}</Button>
        </div>
      </form>
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
  const loaded = reads.every((read) => read.data || read.error);
  const set = reads.flatMap((read) => (read.data && read.data.state === 'set' && read.data.goal ? [read.data] : []));
  return (
    <TileSection title={t('business.goals.earlier')}>
      {set.length > 0 ? (
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
                {view.invoicedPercent !== null && <span className="mono">{`${view.invoicedPercent}%`}</span>}
              </li>
            );
          })}
        </ul>
      ) : (
        loaded && <p className={b.quiet}>{t('business.goals.noEarlier')}</p>
      )}
    </TileSection>
  );
}
