import { useState } from 'react';
import { useLanguage, useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { momentOf, refusalWords } from '../../parts/custody';
import { Button } from '../../parts/Button';
import { EmptyState } from '../../parts/EmptyState';
import { Row } from '../../parts/Row';
import type { AgentView, DecisionView } from '../../engine/types';
import { TileSection, messageOf } from './shared';
import b from './Business.module.css';
import s from './Decisions.module.css';

/** The step a saved rule let run, from the decision's subject ("step:cut"), or null. */
const stepOf = (decision: DecisionView): string | null => (decision.who === 'saved-rule' && decision.subject.startsWith('step:') ? decision.subject.slice('step:'.length) : null);

/**
 * The step of the agent the decision names (DecisionView.agentId) while it still runs on its own (its gate is Auto, as
 * the team lists it), with its purpose for the words; null once it waits for the owner or the decision names no agent.
 */
function autoStep(agents: readonly AgentView[], agentId: string | null, stepId: string): { agentId: string; purpose: string } | null {
  if (!agentId) return null;
  const step = agents.find((agent) => agent.id === agentId)?.steps.find((item) => item.id === stepId);
  return step && step.gate === 'auto' && !step.floor ? { agentId, purpose: step.purpose } : null;
}

/**
 * Business > Decisions (W4 4J19; catalogue O17): who decided each thing, when, on what rule and why, newest first, from
 * the engine's decision record (venture.decisions.list): the owner's own clicks, a saved rule that let a step run
 * without asking, and anything nobody answered in time. A step a saved rule still lets run on its own offers "Stop
 * always allowing", which sets that step to wait for the owner again (venture.team.gate { gate: 'hold' }). The lines are
 * the engine's own words; who decided is worded here.
 */
export function DecisionsView() {
  const t = useT();
  const language = useLanguage();
  const client = useEngine();
  const decisions = useResource('venture.decisions.list', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const team = useResource('venture.team.list', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const [said, setSaid] = useState<{ id: string; line: string; problem?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const agents = team.data?.agents ?? [];
  const list = decisions.data?.decisions ?? [];

  async function stopAllowing(decision: DecisionView, agentId: string, stepId: string, purpose: string) {
    setBusy(true);
    setSaid(null);
    try {
      await client.request('venture.team.gate', { agentId, stepId, gate: 'hold' });
      setSaid({ id: decision.id, line: t('business.decisions.stopped', { step: purpose }) });
      team.reload();
      decisions.reload();
    } catch (error) {
      setSaid({ id: decision.id, line: refusalWords(error, t), problem: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={b.page}>
      <TileSection title={t('business.decisions.title')} meta={t('business.decisions.line')}>
        {decisions.error && <p className={b.problem} role="alert">{messageOf(decisions.error)}</p>}
        {decisions.data && list.length === 0 && <EmptyState title={t('business.decisions.none')} />}
        {list.length > 0 && (
          <ul className={b.list} data-decisions="">
            {list.map((decision) => {
              const stepId = stepOf(decision);
              const auto = stepId ? autoStep(agents, decision.agentId, stepId) : null;
              return (
                <Row
                  key={decision.id}
                  id={`decision-${decision.id}`}
                  eyebrow={(
                    <span className={s.who} data-who={decision.who}>
                      {t(`business.decisions.who.${decision.who}`)}
                      {' · '}
                      <span className="mono">{momentOf(decision.at, language)}</span>
                    </span>
                  )}
                  // The engine's own words; an amount it named in what was decided has no receipt here (NOTES item 30).
                  title={<span data-engine-line="">{decision.line}</span>}
                  line={decision.rule ? t('business.decisions.rule', { rule: decision.rule }) : decision.reason !== decision.line ? <span data-engine-line="">{decision.reason}</span> : undefined}
                  actions={auto && stepId ? (
                    <Button disabled={busy} onClick={() => void stopAllowing(decision, auto.agentId, stepId, auto.purpose)}>{t('business.decisions.stopAllowing')}</Button>
                  ) : undefined}
                >
                  {said?.id === decision.id && <p className={said.problem ? b.problem : b.said} role="status">{said.line}</p>}
                </Row>
              );
            })}
          </ul>
        )}
      </TileSection>
    </div>
  );
}
