/**
 * "A short plan" under the chief's answer (D-Chats `.plan` and `.act`): the steps Chausar proposed, numbered, each with
 * what it does in the engine's words (ProposalView.what), the agent it names (when the engine names one), where it stands, and "each one asks you first". Chausar never
 * acts from here: the next drafted step says, in the engine's words, "This becomes a card on Today for your approval",
 * with Not now and Start. Start raises it (venture.proposals.raise) and it becomes a card on Today, where the owner
 * approves it by its digest, with the second ask when it spends or sends; the step then says "On Today" with a link.
 * Not now sets it aside (venture.proposals.dismiss). A refusal reaches the owner in the engine's words.
 */

import { useEffect, useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import type { ProposalView } from '../../engine/types';
import { Avatar, type DeptId } from '../../parts/Avatar';
import { Button } from '../../parts/Button';
import { cx } from '../../parts/cx';
import { Icon } from '../../parts/Icon';
import s from './Chats.module.css';

export type AgentLookup = (id: string) => { name: string; dept: DeptId | undefined } | undefined;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function PlanCard({ proposals, agentOf, onChanged }: { proposals: readonly ProposalView[]; agentOf: AgentLookup; onChanged: () => void }) {
  const t = useT();
  const engine = useEngine();
  const titleId = useId();
  const [shown, setShown] = useState<readonly ProposalView[]>(proposals);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => { setShown(proposals); }, [proposals]);

  const next = shown.find((proposal) => proposal.status === 'drafted');
  const replace = (changed: ProposalView) => setShown((was) => was.map((item) => (item.id === changed.id ? changed : item)));

  async function act(kind: 'raise' | 'dismiss', proposal: ProposalView) {
    setBusy(true);
    setProblem(null);
    setSaid(null);
    try {
      if (kind === 'raise') {
        const raised = await engine.request('venture.proposals.raise', { id: proposal.id });
        replace(raised.proposal);
        setSaid(raised.line);
      } else {
        replace((await engine.request('venture.proposals.dismiss', { id: proposal.id })).proposal);
      }
      onChanged();
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={s.plan} aria-labelledby={titleId}>
      <div className={s.planHead}>
        <span className={s.planMark} aria-hidden="true"><Icon name="target" size={16} /></span>
        <h3 id={titleId} className={s.planTitle}>{t('chats.plan.title')}</h3>
        <span className={s.planMeta}>{t('chats.plan.meta', { count: shown.length })}</span>
      </div>
      <ol className={s.steps}>
        {shown.map((proposal, index) => {
          const agent = proposal.agent ? agentOf(proposal.agent) : undefined;
          return (
            <li key={proposal.id} className={s.step} data-status={proposal.status}>
              <span className={cx(s.stepNumber, 'mono')} data-live={proposal.status === 'drafted' || proposal.status === 'raised' ? '' : undefined} aria-hidden="true">{index + 1}</span>
              <div className={s.stepBody}>
                <p className={s.stepTitle} data-step-title="">{proposal.title}</p>
                {proposal.what && <p className={s.stepWhat}>{proposal.what}</p>}
                <p className={s.stepMeta}>
                  {agent && (
                    <>
                      <Avatar name={agent.name} dept={agent.dept} size={24} />
                      <span>{agent.name}</span>
                      <span aria-hidden="true"> · </span>
                    </>
                  )}
                  <Where proposal={proposal} next={proposal.id === next?.id} />
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {next && (
        <div className={s.act} data-next="">
          <p className={s.actChip}><Icon name="sparkles" size={14} />{t('chats.plan.next')}</p>
          <p className={s.actTitle}>{next.title}</p>
          <p className={s.actLine}>{next.line}</p>
          {next.secondAsk && <p className={s.actLine}>{t('chats.plan.asksAgain')}</p>}
          <div className={s.actions}>
            <Button disabled={busy} onClick={() => void act('dismiss', next)}>{t('chats.plan.notNow')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void act('raise', next)}>{t('chats.plan.start')}</Button>
          </div>
        </div>
      )}
      {said && <p className={s.said} role="status">{said}</p>}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </section>
  );
}

/** Where a step stands: the next one, not started, on Today (a link), set aside, or what the engine said it did. */
function Where({ proposal, next }: { proposal: ProposalView; next: boolean }) {
  const t = useT();
  switch (proposal.status) {
    case 'drafted': return <span>{t(next ? 'chats.plan.state.next' : 'chats.plan.state.drafted')}</span>;
    // The card's subject (?row=proposal:<id>, as an agent's chat links it), so Today brings it into view even when folded.
    case 'raised': return <a className={s.onToday} href={`#/today?row=${encodeURIComponent(`proposal:${proposal.id}`)}`}>{t('chats.plan.onToday')}</a>;
    case 'dismissed': return <span>{t('chats.plan.state.dismissed')}</span>;
    default: return <span>{proposal.line}</span>;
  }
}
