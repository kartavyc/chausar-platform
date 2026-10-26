import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type { IdeaView, ProposalView, VentureRunEvent } from '../../engine/types';
import { Button } from '../../parts/Button';
import { Count } from '../../parts/Figure';
import { Icon } from '../../parts/Icon';
import s from './IdeasFold.module.css';

/** Ideas rest on the business's records: a queue change (an invoice paid, an order moved) can make or retire one. */
const IDEA_EVENTS = (event: VentureRunEvent) => event.type === 'queue.changed' || event.type === 'run.done' || event.type === 'run.failed';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Where a waiting line opens: an order on Work; a message on its reply card here on Today, whose id starts with
 * reply:<mail id> (network/inbound-rows.ts), which Today brings into view by that start (?row=).
 */
function hrefOf(id: string, recordId: string): string {
  return id.startsWith('waiting:order:') ? `#/work?order=${encodeURIComponent(recordId)}` : `#/today?row=${encodeURIComponent(`reply:${recordId}`)}`;
}

/** 4Z2: the chevron at a fold's end, so a closed fold reads as one that opens, never as an empty tile. */
function FoldMark() {
  return <span className={s.mark} data-fold-mark="" aria-hidden="true"><Icon name="chevron-down" size={16} /></span>;
}

/** An idea the owner started here: the proposal it drafted, and where it stands now. */
type Started = { idea: IdeaView; proposal: ProposalView | null; line: string; raised: string | null };

/**
 * W4 4J22b, from 4J18 (catalogue A11): two folds at the very end of Today (D-Today's folds), closed at rest so the
 * page above them stays as it is.
 *   - Waiting on you: real records only (orders, and mail the owner answers themselves), newest first, each line
 *     the engine's, each opening where the thing is (the order on Work, the reply card on Today).
 *   - Ideas: what code found in the business's own records (an invoice past its due day, an order delivered with no
 *     invoice, an order with no run a day after it came in), each with why and the records it rests on. An idea is a
 *     suggestion only: Start drafts a proposal (venture.ideas.start) and says so in the engine's words; nothing reaches
 *     Today until the owner presses Put on Today (venture.proposals.raise), where it is approved like any other card.
 *     Dismiss sets it aside for good.
 * A fold with nothing in it is not drawn at all.
 */
export function IdeasFold() {
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
  const waiting = view.data.waiting;

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

  if (ideas.length === 0 && waiting.length === 0 && !said && !problem) return null;
  return (
    <div className={s.folds}>
      {waiting.length > 0 && (
        <details className={s.fold} data-today-fold="waiting">
          <summary className={s.summary}>
            <Icon name="clock" size={16} />
            <span className={s.title}>{t('today.ideas.waiting')}</span>
            <Count value={waiting.length} className={s.count} />
            <FoldMark />
          </summary>
          <ul className={s.waiting}>
            {waiting.map((item) => (
              <li key={item.id}>
                <a className={s.waitLink} href={hrefOf(item.id, item.recordId)}>{item.line}</a>
              </li>
            ))}
          </ul>
        </details>
      )}
      {(ideas.length > 0 || said || problem) && (
        <details className={s.fold} data-today-fold="ideas">
          <summary className={s.summary}>
            <Icon name="sparkles" size={16} />
            <span className={s.title}>{t('today.ideas.title')}</span>
            <Count value={live.length} className={s.count} />
            <FoldMark />
          </summary>
          <div className={s.body}>
            <p className={s.lead}>{t('today.ideas.lead')}</p>
            {said && <p className={s.said} role="status">{said}</p>}
            {problem && <p className={s.problem} role="alert">{problem}</p>}
            {ideas.length > 0 && (
              <ul className={s.ideas}>
                {ideas.map((idea) => (
                  <li key={idea.id}>
                    <Idea
                      idea={idea}
                      started={started[idea.id]}
                      busy={busy === idea.id}
                      onAct={(what) => void act(idea, what)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

/** One idea as a card: its title, why, the records it rests on, what Start would do, and Start (its one primary). */
function Idea({ idea, started, busy, onAct }: {
  idea: IdeaView; started: Started | undefined; busy: boolean; onAct: (what: 'start' | 'dismiss' | 'raise') => void;
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
            <Button size="sm" variant="primary" disabled={busy} onClick={() => onAct('start')}>{t('today.ideas.start')}</Button>
          </>
        )}
        {started && !started.raised && started.proposal && (
          <Button size="sm" variant="primary" disabled={busy} onClick={() => onAct('raise')}>{t('today.ideas.raise')}</Button>
        )}
        {started?.raised && (
          <a className={s.onToday} href={`#/today?row=${encodeURIComponent(started.raised)}`}>{t('today.ideas.onToday')}</a>
        )}
      </div>
    </article>
  );
}
