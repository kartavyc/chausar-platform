import { useId, useRef, useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { EngineError, type AgentView, type Posture } from '../../engine/types';
import { POSTURES } from './shared';
import s from './Team.module.css';

/**
 * How much an agent may do alone, as four radio cards, each with what it means for the owner (catalogue O16). Choosing
 * one asks the engine (venture.team.posture); while it answers the choice is disabled, and focus goes back to the
 * chosen card after. The engine says when a posture is above what the business has earned (POSTURE_ABOVE_STAGE); its
 * words are shown as they are, and the choice goes back. A posture this build does not know is shown as the engine
 * named it.
 */
export function PostureChoice({ agent, onSaved }: { agent: AgentView; onSaved: (agent: AgentView) => void }) {
  const t = useT();
  const client = useEngine();
  const base = useId();
  const group = useRef<HTMLFieldSetElement>(null);
  const [pending, setPending] = useState<Posture | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function choose(posture: Posture) {
    if (pending || posture === agent.posture) return;
    setProblem(null);
    setPending(posture);
    try {
      const reply = await client.request('venture.team.posture', { agentId: agent.id, posture });
      onSaved(reply.agent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProblem(error instanceof EngineError && error.code === 'POSTURE_ABOVE_STAGE' ? message : t('team.postureFailed', { message }));
    } finally {
      setPending(null);
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!active || active === document.body) group.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
      });
    }
  }

  const known = POSTURES.includes(agent.posture);
  const chosen = pending ?? agent.posture;
  return (
    <section className={s.section}>
      <fieldset ref={group} className={s.postures} disabled={pending !== null}>
        <legend className={s.small}>{t('team.posture')}</legend>
        {!known && <p className={s.posture}>{agent.posture}</p>}
        <div className={s.choices}>
          {POSTURES.map((posture) => {
            const means = `${base}-${posture}`;
            return (
              <div key={posture} className={s.choice} data-choice="" data-chosen={chosen === posture ? '' : undefined}>
                <label className={s.choiceLabel}>
                  <input
                    type="radio"
                    name={`posture-${agent.id}`}
                    value={posture}
                    checked={chosen === posture}
                    aria-describedby={means}
                    onChange={() => void choose(posture)}
                  />
                  <span>{t(`team.posture.${posture}`)}</span>
                </label>
                <p id={means} className={s.means}>{t(`team.postureMeans.${posture}`)}</p>
              </div>
            );
          })}
        </div>
      </fieldset>
      {problem && <p role="alert" className={s.problem}>{problem}</p>}
    </section>
  );
}
