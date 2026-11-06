import { useId, useRef, useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { cx } from '../../parts/cx';
import { Icon } from '../../parts/Icon';
import { EngineError, type AgentView, type Posture } from '../../engine/types';
import { POSTURES } from './shared';
// W4 4J22a: auto is built but locked (4J15); the shadow summary and what auto would need sit under the choice.
import { AutoReadiness, LOCKED_POSTURE } from './Readiness';
import s from './Team.module.css';
import r from './Readiness.module.css';

/**
 * How much an agent may do alone, as four radio cards, each with what it means for the owner (catalogue O16). Choosing
 * one asks the engine (venture.team.posture); while it answers the choice is disabled, and focus goes back to the
 * chosen card after. Auto with spot checks is built but locked (W4 4J15, the founder's decision): its card stays
 * locked with the reason and asks the engine nothing, and an AUTO_LOCKED answer reads the same words. The engine says
 * when another posture is above what the business has earned (POSTURE_ABOVE_STAGE); its words are shown as they are,
 * and the choice goes back. A posture this build does not know is shown as the engine named it.
 */
export function PostureChoice({ agent, onSaved }: { agent: AgentView; onSaved: (agent: AgentView) => void }) {
  const t = useT();
  const client = useEngine();
  const base = useId();
  const group = useRef<HTMLFieldSetElement>(null);
  const [pending, setPending] = useState<Posture | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function choose(posture: Posture) {
    if (pending || posture === agent.posture || posture === LOCKED_POSTURE) return;
    setProblem(null);
    setPending(posture);
    try {
      const reply = await client.request('venture.team.posture', { agentId: agent.id, posture });
      onSaved(reply.agent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof EngineError ? error.code : null;
      setProblem(code === 'AUTO_LOCKED' ? t('team.readiness.locked') : code === 'POSTURE_ABOVE_STAGE' ? message : t('team.postureFailed', { message }));
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
            const locked = posture === LOCKED_POSTURE;
            const why = `${means}-locked`;
            return (
              <div key={posture} className={cx(s.choice, locked && r.lockedChoice)} data-choice="" data-chosen={chosen === posture ? '' : undefined}>
                <label className={cx(s.choiceLabel, locked && r.lockedLabel)}>
                  <input
                    type="radio"
                    name={`posture-${agent.id}`}
                    value={posture}
                    checked={chosen === posture}
                    aria-describedby={locked ? `${means} ${why}` : means}
                    aria-disabled={locked ? true : undefined}
                    onClick={locked ? (event) => event.preventDefault() : undefined}
                    onChange={() => void choose(posture)}
                  />
                  <span>{t(`team.posture.${posture}`)}</span>
                </label>
                {/* Built but locked: a lock chip, as a floor step's "Always asks you" has; the reason below says it in words. */}
                {locked && <span className={r.lockChip} data-lock-chip="" aria-hidden="true"><Icon name="lock" size={14} />{t('team.readiness.lockChip')}</span>}
                <p id={means} className={s.means}>{t(`team.postureMeans.${posture}`)}</p>
                {locked && <p id={why} className={cx(s.means, r.lockLine)} data-locked="">{t('team.readiness.locked')}</p>}
              </div>
            );
          })}
        </div>
      </fieldset>
      {problem && <p role="alert" className={s.problem}>{problem}</p>}
      <AutoReadiness agent={agent} />
    </section>
  );
}
