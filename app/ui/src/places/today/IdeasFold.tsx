import { messageOf } from '../../../../../platform/shared/errors.ts';
import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type { IdeaView, ProposalView, UiRunEvent } from '../../engine/types';
import { Button } from '../../parts/Button';
import { Count } from '../../parts/Figure';
import { Icon } from '../../parts/Icon';
import s from './IdeasFold.module.css';
import { Fold } from '../../parts/Fold';

/** Ideas rest on the business's records: a queue change (an invoice paid, an order moved) can make or retire one. */
const IDEA_EVENTS = (event: UiRunEvent) => event.type === 'queue.changed' || event.type === 'run.done' || event.type === 'run.failed';



/** An idea the owner started here: the proposal it drafted, and where it stands now. */
type Started = { idea: IdeaView; proposal: ProposalView | null; line: string; raised: string | null };

/**
 * W4 4J22b, from 4J18 (catalogue A11): a fold at the very end of Today, closed at rest so the page above it stays as it is.
 * B4 task 13: "Waiting on you" left the page: the same things are cards above it and orders on Work.
 *   - Ideas: what code found in the business's own records (an invoice past its due day, an order delivered with no
 *     invoice, an order with no run a day after it came in), each with why and the records it rests on. An idea is a
 *     suggestion only: Start drafts a proposal (venture.ideas.start) and says so in the engine's words; nothing reaches
 *     Today until the owner presses Put on Today (venture.proposals.raise), where it is approved like any other card.
 *     Dismiss sets it aside for good.
 * A fold with nothing in it is not drawn at all.
 */
/**
 * W6 6H3: `title`, the name the owner (or their AI) gave the Ideas fold.
 */
export function IdeasFold({ title }: { title?: string | undefined } = {}) {
  const t = useT();
  const engine = useEngine();
  const view = useResource('venture.ideas.list', {}, { refreshOn: IDEA_EVENTS });
  const [started, setStarted] = useState<Record<string, Started>>({});
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [said, setSaid] = useState<string | null>(null);
  // A refusal is said at the fold, not on the idea: the idea may be gone once the list is read again.
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!view.data) return null;

  // An idea started here stays in view with its proposal, though the engine no longer lists it.
  const live = view.data.ideas.filter((idea) => !dismissed.has(idea.id) && !started[idea.id]);
  const ideas = [...Object.values(started).map((entry) => entry.idea), ...live];

  async function act(idea: IdeaView, what: 'start' | 'dismiss' | 'raise') {
    setBusy(idea.id);
    setProblem(null);
    setSaid(null);
    try {
      if (what === 'start') {
        const result = await engine.request('venture.ideas.start', { id: idea.id });
        setStarted((was) => ({ ...was, [idea.id]: { idea, proposal: result.proposal, line: result.line, raised: null } }));
      } else if (what === 'dismiss') {
        const result = await engine.request('venture.ideas.dismiss', { id: idea.id });
        setDismissed((was) => new Set(was).add(idea.id));
        setSaid(result.line);
      } else {
        const entry = started[idea.id];
        if (!entry?.proposal) return;
        const result = await engine.request('venture.proposals.raise', { id: entry.proposal.id });
        setStarted((was) => ({ ...was, [idea.id]: { ...entry, proposal: result.proposal, line: result.line, raised: result.rowId ?? `proposal:${result.proposal.id}` } }));
      }
    } catch (error) {
      setProblem(messageOf(error));
      view.reload();
    } finally {
      setBusy(null);
    }
  }

  if (ideas.length === 0 && !said && !problem) return null;
  return (
    <div className={s.folds}>
      {(ideas.length > 0 || said || problem) && (
        <Fold summary={<><Icon name="sparkles" size={16} />
            <span className={s.title}>{title ?? t('today.ideas.title')}</span>
            <Count value={live.length} className={s.count} /></>} className={s.fold} data-today-fold="ideas" summaryClassName={s.summary}>
          <div className={s.body}>
            <p className={s.lead}>{t('today.ideas.lead')}</p>
            {said && <p className={s.said} role="status">{said}</p>}
            {problem && <p className={s.problem} role="alert">{problem}</p>}
            {ideas.length > 0 && (
              <ul className={s.ideas}>
                {ideas.map((idea, index) => (
                  <li key={idea.id}>
                    <Idea
                      idea={idea}
                      lead={index === 0}
                      started={started[idea.id]}
                      busy={busy === idea.id}
                      onAct={(what) => void act(idea, what)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Fold>
      )}
    </div>
  );
}

/** One idea as a card: its title, why, the records it rests on, what Start would do, and Start (its one primary). */
function Idea({ idea, lead, started, busy, onAct }: {
  idea: IdeaView; lead: boolean; started: Started | undefined; busy: boolean; onAct: (what: 'start' | 'dismiss' | 'raise') => void;
}) {
  const t = useT();
  const titleId = useId();
  const basisId = useId();
  return (
    <article className={s.idea} aria-labelledby={titleId}>
      <h3 id={titleId} className={s.ideaTitle}>{idea.title}</h3>
      <p className={s.reason}>{idea.reason}</p>
      <p id={basisId} className={s.basisLabel}>{t('today.ideas.basis')}</p>
      <ul className={s.basis} aria-labelledby={basisId}>
        {idea.evidence.map((item) => <li key={item.id}>{item.line}</li>)}
      </ul>
      {!started && <p className={s.prompt}>{idea.prompt}</p>}
      {started && <p className={s.said} role="status">{started.line}</p>}
      <div className={s.actions}>
        {!started && (
          <>
            <Button size="sm" disabled={busy} onClick={() => onAct('dismiss')}>{t('today.ideas.dismiss')}</Button>
            <Button size="sm" variant={lead ? 'primary' : 'secondary'} disabled={busy} onClick={() => onAct('start')}>{t('today.ideas.start')}</Button>
          </>
        )}
        {started && !started.raised && started.proposal && (
          <Button size="sm" variant={lead ? 'primary' : 'secondary'} disabled={busy} onClick={() => onAct('raise')}>{t('today.ideas.raise')}</Button>
        )}
        {started?.raised && (
          <a className={s.onToday} href={`#/today?row=${encodeURIComponent(started.raised)}`}>{t('today.ideas.onToday')}</a>
        )}
      </div>
    </article>
  );
}
