import { useId, useState } from 'react';
import { useLanguage, useT } from '../../text';
import { useEngine, type Resource } from '../../engine/context';
import { EngineError, type AgentView, type StandingOrdersView, type StandingPlaybookView, type StandingUndoView } from '../../engine/types';
import { Button } from '../../parts/Button';
import { AgentAi } from './AgentAi';
import { AgentPersona } from './AgentPersona';
import { canChat, dayWords } from './chat';
import { GateList } from './GateList';
import { PostureChoice } from './PostureChoice';
import s from './Team.module.css';
import c from './AgentChat.module.css';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface InstructionsProps {
  agent: AgentView;
  /**
   * venture.agents.orders.list (read): the standing orders, the version in use, the agent's own steps with their
   * guidance and checks, and what Undo would do. Skipped for a role whose steps are code (it has no chat).
   */
  standing: Resource<StandingOrdersView>;
  onSaved: (agent: AgentView) => void;
  onFloor: () => void;
  /** The version in use changed (an undo here): the panel reads it again. */
  onPlaybookChanged: () => void;
}

/**
 * The Instructions tab (W4 4B3; spec 5.2; catalogue A3, A4, O16): how this agent works, in words. The version in use
 * and where it came from; each step the agent owns with its guidance lines and "Done when these checks pass" (check
 * ids worded here); its standing orders, each with the version it arrived in and the owner's own words; going back
 * from the owner's last change whenever the engine says Undo can, which asks once more; then its posture with who set
 * it, when each step asks the owner, the AI that serves it and where its spend is. Everything is read, never written:
 * opening the panel makes no version (the engine's read-level venture.agents.orders.list).
 */
export function Instructions({ agent, standing, onSaved, onFloor, onPlaybookChanged }: InstructionsProps) {
  const t = useT();
  const language = useLanguage();
  const howId = useId();
  const ordersId = useId();
  const stepsId = useId();
  const spendId = useId();
  const chat = canChat(agent);
  const data = standing.data;
  const playbook = data?.playbook ?? null;
  const steps = agent.steps.map((step) => ({ step, inUse: data?.steps.find((item) => item.stepId === step.id) }));
  const mine = data?.orders ?? [];
  // The engine's line after going back, kept here: the standing order it took away leaves the list.
  const [undone, setUndone] = useState<string | null>(null);

  return (
    <>
      <section className={s.section} aria-labelledby={howId}>
        <h3 id={howId} className={s.small}>{t('team.instructions.how', { name: agent.name })}</h3>
        {playbook && (
          <p className={c.version} data-version="">
            {t(`team.instructions.from.${playbook.origin}`, { version: playbook.version, date: dayWords(playbook.at, language) })}
          </p>
        )}
        {data?.rebuildDue && <p className={s.quiet} data-rebuild="">{t('team.instructions.rebuildDue')}</p>}
        {standing.error && <p className={s.failed}>{t('team.instructions.failed', { message: standing.error.message })}</p>}
        <ol className={c.howSteps}>
          {steps.map(({ step, inUse }) => (
            <li key={step.id} className={c.howStep}>
              <h4 className={c.howTitle}>{inUse?.title ?? step.purpose}</h4>
              {inUse && inUse.guidance.length > 0 && (
                <ul className={c.guidance}>
                  {inUse.guidance.map((line) => <li key={line} data-content="">{line}</li>)}
                </ul>
              )}
              {inUse && inUse.guidance.length === 0 && <p className={s.quiet}>{t('team.instructions.noGuidance')}</p>}
              {inUse && inUse.checks.length > 0 && (
                <p className={c.doneWhen}>{t('team.instructions.doneWhen', { checks: inUse.checks.map((check) => t(`team.instructions.check.${check}`)).join(', ') })}</p>
              )}
            </li>
          ))}
        </ol>
      </section>

      {chat && (
        <section className={s.section} aria-labelledby={ordersId}>
          <h3 id={ordersId} className={s.small}>{t('team.instructions.orders')}</h3>
          {data && mine.length === 0 && <p className={s.quiet}>{t('team.instructions.ordersNone', { name: agent.name })}</p>}
          {mine.length > 0 && (
            <ul className={c.orders} aria-labelledby={ordersId}>
              {mine.map((order) => (
                <li key={`${order.stepId}-${order.text}`} className={c.order}>
                  <p className={c.orderText} data-content="">{order.text}</p>
                  <p className={c.orderMeta}>
                    <span className="mono">{t('team.instructions.since', { version: order.since })}</span>
                    {' · '}
                    {order.step}
                  </p>
                  {order.quote && <p className={c.orderQuote}>{t('team.instructions.said')} <span data-content="">{order.quote}</span></p>}
                </li>
              ))}
            </ul>
          )}
          {playbook && data?.undo && (
            <GoBack
              agent={agent} playbook={playbook} undo={data.undo} onAsk={() => setUndone(null)} onStale={standing.reload}
              onDone={(line) => { setUndone(line); onPlaybookChanged(); }}
            />
          )}
          {undone && <p className={c.line} role="status">{undone}</p>}
        </section>
      )}
      {/* W4 4J22b: how it talks (its persona, tried and set as a version) and the agent file. */}
      {canChat(agent) && <AgentPersona key={agent.id} agent={agent} />}

      <PostureChoice agent={agent} onSaved={onSaved} />
      {agent.postureSetBy && <p className={c.setBy}>{t(`team.instructions.setBy.${agent.postureSetBy}`, { name: agent.name })}</p>}
      <section className={s.section}>
        <h3 id={stepsId} className={s.small}>{t('team.steps')}</h3>
        <GateList agents={[agent]} look="list" labelledBy={stepsId} onSaved={onSaved} onFloor={onFloor} />
      </section>
      <AgentAi agentId={agent.id} />
      {/* Per-agent spend with receipt: the engine sends an agent's spend as words with no receipt, and a money figure
          always carries one (or "model estimate"), so it is not printed here; every paid call, by agent and with its
          receipt, is one step away in Money. */}
      <section className={s.section} aria-labelledby={spendId}>
        <h3 id={spendId} className={s.small}>{t('team.spend')}</h3>
        <p className={s.quiet}>{t('team.spendWhere')}</p>
        <a className={s.link} href="#/money/spend">{t('team.spendLink')}</a>
      </section>
    </>
  );
}

/**
 * Going back from the owner's last change to this agent (venture.agents.version.undo with the hash of the version in
 * use), worded by what the engine says Undo would do: back to the version the change was made from, or a new version
 * without it. It asks once more, then shows the engine's own line ("Back to version 4. Version 5 stays stored."). A
 * version that changed since the owner read it (APPROVAL_STALE) is read again, with the engine's words.
 */
function GoBack({ agent, playbook, undo: plan, onAsk, onStale, onDone }: {
  agent: AgentView; playbook: StandingPlaybookView; undo: StandingUndoView; onAsk: () => void; onStale: () => void; onDone: (line: string) => void;
}) {
  const t = useT();
  const client = useEngine();
  const askId = useId();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function undo() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await client.request('venture.agents.version.undo', { agent: agent.id, digest: playbook.hash });
      setAsking(false);
      onDone(result.line);
    } catch (error) {
      setProblem(t('team.instructions.undoFailed', { message: messageOf(error) }));
      if (error instanceof EngineError && error.code === 'APPROVAL_STALE') {
        setAsking(false);
        onStale();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={c.goBack}>
      {!asking ? (
        <Button size="sm" onClick={() => { onAsk(); setProblem(null); setAsking(true); }}>
          {plan.kind === 'back' ? t('team.instructions.goBack', { version: plan.version }) : t('team.instructions.undo')}
        </Button>
      ) : (
        <div className={c.ask} role="group" aria-labelledby={askId}>
          <p id={askId}>{t(plan.kind === 'back' ? 'team.instructions.undoAsk' : 'team.instructions.undoAskRebuild', { version: playbook.version })}</p>
          <div className={c.actions}>
            <Button size="sm" onClick={() => setAsking(false)} disabled={busy}>{t('team.instructions.undoKeep')}</Button>
            <Button size="sm" variant="primary" onClick={() => void undo()} disabled={busy}>{t('team.instructions.undoYes')}</Button>
          </div>
        </div>
      )}
      {problem && <p className={c.problem} role="alert">{problem}</p>}
    </div>
  );
}
