import { useId, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import type { SheetComponentProps } from '../../shell/sheets';
import { Button } from '../../parts/Button';
import { ConsentWords } from '../../parts/ConsentWords';
import { Field } from '../../parts/Field';
import { Icon } from '../../parts/Icon';
import { ModelEstimate } from '../../parts/ModelEstimate';
import { Sheet } from '../../parts/Sheet';
import { LoadingPlace } from '../../parts/Skeleton';
import { cx } from '../../parts/cx';
import { EngineError, type ChiefPlanMoveView, type ChiefPlanStep, type ChiefPlanView, type VentureRunEvent } from '../../engine/types';
import { NextStep, TodayNextStep, FoldedStep, type NextStepHost } from './NextStep';
import { goalAmount } from './goal';
import { usePlanWords } from './plan-words';
import { formatClock } from '../../../../../platform/runtime/owner-format';
import s from './ChiefPlan.module.css';

/**
 * The chief's standing plan on Today (venture.chief.plan.get): its line for today, the one next best step with its one
 * primary action, and this week's moves with their states. Every word is the engine's; this file only places them.
 * The plan moves when the records do, which the engine says with a queue change (and a pipeline change for a lead).
 */
export const PLAN_EVENTS = (event: VentureRunEvent) => event.type === 'queue.changed' || event.type === 'pipeline.changed' || event.type === 'proposal.created';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Whether the step has a primary the owner can press now: a card that is on Today and not decided here, a page, or a tick. */
export function stepHasPrimary(step: ChiefPlanStep | undefined, host: Pick<NextStepHost, 'rows' | 'isDecided'>): boolean {
  const action = step?.action;
  if (!action) return false;
  return action.id !== 'row' || (host.rows.some((row) => row.id === action.rowId) && !host.isDecided(action.rowId));
}

/**
 * The next best step with its one primary. A step that is a card on Today presses that card's own primary (view before
 * approve, the second ask and the digest hold as on the card); one that is done elsewhere goes there; a move of the
 * week the owner does themselves is ticked done. With nothing left it says so, with no button. folded: inside the goal
 * card on a phone.
 */
export function PlanStep({ step, host, folded = false, onChanged }: { step: ChiefPlanStep; host: NextStepHost; folded?: boolean; onChanged: () => void }) {
  const client = useEngine();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useT();
  const action = step.action;
  // A step code wrote the same every time ("Read your plan and accept it.", its "Done") is said from the pack (plan-words.ts).
  const words = usePlanWords();
  const title = words(step.title);
  // The setup cards that also wait, as the engine's one line, said from the pack with each card's title (round 5,
  // re-check 082): under the step, never in its place.
  const also = step.also ? t('today.plan.also', { titles: step.also.titles.map(words).join(', ') }) : undefined;
  if (action?.id === 'row') {
    const row = host.rows.find((item) => item.id === action.rowId && !host.isDecided(item.id));
    // Its card left Today a moment ago (decided here, or resolved elsewhere): the plan reads again and names the next.
    if (!row) return null;
    return <TodayNextStep step={{ rowId: action.rowId, title, agent: step.agent, line: step.line ? words(step.line) : '', figure: step.figure, goalAfter: null, goalAfterPercent: step.goalAfterPercent }} row={row} host={host} folded={folded} title={title} also={also} />;
  }
  async function tick(moveId: string) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await client.request('venture.chief.plan.move', { id: moveId, to: 'done' });
      onChanged();
    } catch (error) {
      setProblem(messageOf(error));
    } finally { setBusy(false); }
  }
  const press = action?.id === 'go' ? () => { window.location.hash = action.link; } : action?.id === 'done' ? () => { void tick(action.moveId); } : undefined;
  const primary = action && press ? { label: words(action.label), locked: false, note: undefined, asksAgain: false } : undefined;
  if (folded) return <FoldedStep title={title} total={goalAmount(step.figure) ?? undefined} primary={primary} onPrimary={press} also={also} />;
  // The step to finish what is sold says what to do in its title; why (nobody is looked for before it) is the chat's to say.
  const line = problem ?? (step.kind === 'offer' || !step.line ? null : words(step.line));
  return <NextStep data={{ title, ...(line ? { line } : {}), ...(also ? { also } : {}) }} primary={primary} onPrimary={press} />;
}

const MARKS: Readonly<Record<ChiefPlanMoveView['state'], 'check' | 'arrow-right' | 'bell' | 'clock' | 'triangle-alert' | 'x' | null>> = {
  done: 'check', waiting: 'arrow-right', proposed: 'bell', working: 'clock', failed: 'triangle-alert', dropped: 'x', planned: null,
};
/** The states said in words beside the move: each asks something of the owner, or says its card's work is not done. */
const SAID: ReadonlySet<ChiefPlanMoveView['state']> = new Set(['waiting', 'proposed', 'working', 'failed']);

/** The chief's line for today, in the engine's words; one the owner's AI wrote with a number in it is labelled a model estimate. */
export function PlanSay({ line }: { line: ChiefPlanView['line'] }) {
  // A line from the records that code writes the same every time is said from the pack; the AI's own line stays as written.
  const words = usePlanWords();
  return (
    <p className={s.say} data-chief-line="">
      <Icon name="sparkles" size={14} className={s.sayIcon} />
      <span className={s.sayText}>{line.by === 'records' ? words(line.text) : line.text}{line.estimate && <>{' '}<ModelEstimate /></>}</span>
    </p>
  );
}

/**
 * This week's moves with their states, and the daily review under them. A move's state is said in words where it asks
 * something of the owner (waiting on them, or on Today for approval) or its card's work is not done (approved and
 * working, or it did not finish: never a tick), and by its mark otherwise, which a screen reader
 * hears in words. The owner ticks, drops or plans again a move of their own.
 *
 * The chat consent, in place (review.consent, sent only while it is missing and matters). On the offer, Turn on shows
 * it before anything is switched: its exact words behind "What's sent", one button that agrees and turns the review on
 * (the consent Chats records, venture.chats.consent, then the switch) and one that turns it on from records only. With
 * the review on, the engine's one line says it plans from records only, with the same words and Agree beside it.
 */
export function PlanWeek({ view, onChanged }: { view: ChiefPlanView; onChanged: () => void }) {
  const t = useT();
  // A setup move code writes ("Accept your plan") is said from the pack; a move the AI or the owner wrote stays as written.
  const planWords = usePlanWords();
  const client = useEngine();
  const titleId = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await work();
      onChanged();
    } catch (error) {
      setProblem(messageOf(error));
    } finally { setBusy(false); }
  }
  const move = (id: string, to: 'done' | 'dropped' | 'planned') => ask(() => client.request('venture.chief.plan.move', { id, to }));
  const answer = (on: boolean) => ask(() => client.request('venture.chief.review.set', { on }));
  const { review } = view;
  // The review's line in the pack's words from its own facts (round 5, re-check 082); a fixed note from the pack too.
  const reviewLine = review.on ? t('today.plan.reviewAt', { time: formatClock(review.time) }) : planWords(review.line);
  // Turn on was pressed while the consent is missing: the offer shows it in place, and nothing is switched yet.
  const [asking, setAsking] = useState(false);
  const consent = review.consent;
  /** Agrees to exactly the words shown (their digest), as Chats does; then, on the offer, turns the review on. */
  const agree = (thenOn: boolean) => ask(async () => {
    await client.request('venture.chats.consent', { digest: consent?.digest ?? '' });
    if (thenOn) await client.request('venture.chief.review.set', { on: true });
  });

  return (
    <section className={s.week} aria-labelledby={titleId} data-chief-plan="">
      <h2 id={titleId} className={s.title}>{t('today.plan.week')}</h2>
      {view.moves.length === 0 ? <p className={s.none}>{t('today.plan.none')}</p> : (
        <ul className={s.moves}>
          {view.moves.map((item) => {
            const mark = MARKS[item.state];
            const said = SAID.has(item.state);
            return (
              <li key={item.id} className={s.move} data-state={item.state} data-move="">
                <span className={s.mark} aria-hidden="true">{mark && <Icon name={mark} size={14} />}</span>
                <span className={s.text}>{planWords(item.text)}</span>
                {/* The state is one of five the engine names by code beside its English label, so the app says it from its own pack (Hindi too). */}
                <span className={said ? s.state : 'sr-only'}>{t(`state.move.${item.state}`)}</span>
                {item.can.length > 0 && (
                  <span className={s.acts}>
                    {item.can.includes('done') && <button type="button" className={s.act} disabled={busy} aria-label={t('today.plan.markDone', { move: planWords(item.text) })} onClick={() => { void move(item.id, 'done'); }}><Icon name="check" size={16} /></button>}
                    {item.can.includes('dropped') && <button type="button" className={s.act} disabled={busy} aria-label={t('today.plan.drop', { move: planWords(item.text) })} onClick={() => { void move(item.id, 'dropped'); }}><Icon name="x" size={16} /></button>}
                    {item.can.includes('planned') && <button type="button" className={s.act} disabled={busy} aria-label={t('today.plan.again', { move: planWords(item.text) })} onClick={() => { void move(item.id, 'planned'); }}><Icon name="rotate-ccw" size={16} /></button>}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {review.offer && (
        <div className={s.offer} data-review-offer="">
          <p className={s.offerTitle}>{planWords(review.offer.title)}</p>
          <p className={s.offerLine}>{review.offer.line}</p>
          {asking && consent?.text ? (
            <>
              {consent.state === 'stale' && <p className={s.offerLine}>{t('today.plan.consentStale')}</p>}
              <ConsentWords line={t('today.plan.consentLine')} text={consent.text} />
              <div className={s.offerActs}>
                <Button size="sm" variant="quiet" disabled={busy} onClick={() => { void answer(true); }}>{t('today.plan.recordsOnly')}</Button>
                <Button size="sm" disabled={busy} onClick={() => { void agree(true); }}>{t('today.plan.agreeOn')}</Button>
              </div>
            </>
          ) : (
            <div className={s.offerActs}>
              <Button size="sm" variant="quiet" disabled={busy} onClick={() => { void answer(false); }}>{t('today.plan.notNow')}</Button>
              <Button size="sm" disabled={busy} onClick={() => { if (consent?.text) setAsking(true); else void answer(true); }}>{t('today.plan.turnOn')}</Button>
            </div>
          )}
        </div>
      )}
      {problem && <p className={s.problem} role="alert">{t('today.plan.failed', { message: problem })}</p>}
      {/* The review is on and would ask the owner's AI, but for the consent: the engine's line, the words, and Agree. */}
      {!review.offer && consent?.text && (
        <div className={s.held} data-review-consent={consent.state}>
          <ConsentWords line={review.note ? planWords(review.note) : undefined} text={consent.text} />
          <div className={s.offerActs}>
            <Button size="sm" disabled={busy} onClick={() => { void agree(false); }}>{t('today.plan.agree')}</Button>
          </div>
        </div>
      )}
      {!review.offer && (
        <p className={s.foot}>
          <span>{consent?.text || !review.note ? reviewLine : planWords(review.note)}</span>
          <button type="button" className={s.change} aria-label={t('today.plan.changeLabel')} onClick={(event) => openSheet('review', 'daily', event.currentTarget)}>{t('today.plan.change')}</button>
        </p>
      )}
    </section>
  );
}

/** The plan beside the goal card on a wide screen: the chief's line for today, the next best step, then the week. */
export function TodayPlan({ view, host, onChanged }: { view: ChiefPlanView; host: NextStepHost; onChanged: () => void }) {
  return (
    <div className={s.plan}>
      <PlanSay line={view.line} />
      <PlanStep step={view.next} host={host} onChanged={onChanged} />
      <PlanWeek view={view} onChanged={onChanged} />
    </div>
  );
}

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/**
 * The daily review's sheet (`review:daily`): on or off, its time on the owner's clock, and how much Chausar may use the
 * owner's AI on its own each day. Saving it is the owner's approval of that standing arrangement
 * (venture.chief.review.set); the engine's own words say when it runs and what a run never does.
 */
export function ReviewSheet({ onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const client = useEngine();
  const plan = useResource('venture.chief.plan.get', {}, { refreshOn: PLAN_EVENTS });
  const review = plan.data?.review;
  const [on, setOn] = useState<boolean | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [runs, setRuns] = useState<string | null>(null);
  const [cap, setCap] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = { on: on ?? review?.on ?? false, time: time ?? review?.time ?? '', runs: runs ?? String(review?.ownUse.runsPerDay ?? ''), cap: cap ?? review?.ownUse.capTyped ?? '' };
  const runsOk = /^\d{1,2}$/.test(shown.runs);
  const ready = Boolean(review) && TIME.test(shown.time) && runsOk;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!review || !ready || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await client.request('venture.chief.review.set', { on: shown.on, time: shown.time, runsPerDay: Number(shown.runs), ...(review.ownUse.keyed ? { cap: shown.cap.trim() } : {}) });
      plan.reload();
      onClose();
    } catch (error) {
      setProblem(error instanceof EngineError || error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }

  return (
    <Sheet label={t('today.review.kind')} title={t('today.review.title')} line={review?.when} onClose={onClose} returnFocus={returnFocus}>
      {plan.error && <p className={s.problem}>{t('sheet.failed', { message: plan.error.message })}</p>}
      {!review && !plan.error && <LoadingPlace shape="sheet" />}
      {review && (
        <form className={s.form} aria-label={t('today.review.title')} onSubmit={(event) => { void save(event); }}>
          <label className={s.switch}>
            <input type="checkbox" checked={shown.on} onChange={(event) => setOn(event.currentTarget.checked)} />
            <span>{t('today.review.on')}</span>
          </label>
          <Field type="time" label={t('today.review.time')} value={shown.time} onChange={(event) => setTime(event.currentTarget.value)} />
          <Field inputMode="numeric" label={t('today.review.runs')} value={shown.runs} maxLength={2} onChange={(event) => setRuns(event.currentTarget.value)} />
          {review.ownUse.keyed && <Field inputMode="decimal" label={t('today.review.cap')} value={shown.cap} maxLength={10} onChange={(event) => setCap(event.currentTarget.value)} />}
          <p className={s.sheetLine}>{review.ownUse.line}</p>
          {review.last && <p className={cx(s.sheetLine, s.sheetLast)}>{review.last.line}</p>}
          {problem && <p className={s.problem} role="alert">{t('today.plan.failed', { message: problem })}</p>}
          <div className={s.formActs}>
            <Button type="submit" variant="primary" disabled={busy} disabledReason={ready ? undefined : t('today.review.need')}>{t('today.review.save')}</Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
