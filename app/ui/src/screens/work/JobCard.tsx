/**
 * A job's card (WK-09, WK-11): what the job may do before it starts. The four facts lead;
 * the card follows: how you will know it is met, the owner, the actions it may use by
 * name, the routes it was tested on, the review date, what happens to a missed run, which
 * computer runs it, the last and next run. A job from an imported skill says so.
 */
import { KeyValue, type Pair } from '../../parts/KeyValue';
import { Label } from '../../parts/Label';
import type { Language } from '../../app/presentation.ts';
import { amountText, day, dayTime } from './kit/format.ts';
import type { JobCard } from './contract.ts';
import { say } from './shared.tsx';
import type { WorkWords } from './text.ts';
import s from './work.module.css';

const when = (iso: string, language: Language) => (iso.length > 10 ? dayTime(iso, language) : day(iso, language));

export function jobFacts(card: JobCard, stateWord: string, w: WorkWords, language: Language): Pair[] {
  return [
    { name: w['f.goal'], value: card.goal },
    { name: w['f.progress'], value: say(w, 'progress', { runs: card.runs, state: stateWord }) },
    { name: w['f.budget'], value: say(w, 'budgetLine', { spent: amountText(card.spent, language), budget: amountText(card.budget, language), reserve: amountText(card.reserve, language) }), mono: true },
    { name: w['f.stops'], value: say(w, 'stops', { runs: card.stopRule.maxRuns, date: when(card.stopRule.deadline, language) }) },
  ];
}

export function JobCardView({ card, w, language, onReceipt, simple }: { card: JobCard; w: WorkWords; language: Language; onReceipt: (id: string) => void; simple: boolean }) {
  const none = w.none;
  const pairs: Pair[] = [
    { name: w['f.doneWhen'], value: card.doneWhen },
    { name: w['f.owner'], value: card.owner },
    { name: w['f.actions'], value: card.actions.length > 0 ? card.actions.join(', ') : none },
    { name: w['f.missed'], value: w[`missed.${card.missedRun}`] },
    { name: w['f.lastRun'], value: card.lastRunAt === null ? none : dayTime(card.lastRunAt, language), mono: true },
    { name: w['f.nextRun'], value: card.nextRunAt === null ? none : dayTime(card.nextRunAt, language), mono: true },
  ];
  if (!simple) {
    pairs.splice(3, 0,
      { name: w['f.routes'], value: card.testedRoutes.length > 0 ? card.testedRoutes.join(', ') : none },
      { name: w['f.review'], value: card.reviewOn === null ? none : when(card.reviewOn, language) },
      { name: w['f.runsOn'], value: w.runsOn });
  }
  return (
    <div className={s.block}>
      <h3 className={s.h}>{w.card}</h3>
      {card.untrustedInstructions && <p className={s.meta}><Label kind="from-outside" /> {w.untrusted}</p>}
      <KeyValue pairs={pairs} onReceipt={onReceipt} />
    </div>
  );
}
