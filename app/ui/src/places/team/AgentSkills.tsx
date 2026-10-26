import { useId } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import type { AgentView } from '../../engine/types';
import { Button } from '../../parts/Button';
import s from './AgentExtras.module.css';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The skills at the top of the agent panel's Can do tab (W4 4J22b, from 4J17's skills.ts; catalogue A18): each skill the engine reads from the
 * steps the agent does with the owner's AI, with its one line and a "try this" question. Try this opens Chat with the
 * question in the box; it is never sent: the owner presses Send, or does not.
 */
export function AgentSkills({ agent, onTry }: { agent: AgentView; onTry: (starter: string) => void }) {
  const t = useT();
  const headId = useId();
  const view = useResource('venture.persona.get', { agent: agent.id });
  const skills = view.data?.skills ?? [];
  return (
    <section className={s.section} aria-labelledby={headId}>
      <h3 id={headId} className={s.small}>{t('team.skills.title')}</h3>
      {view.error && <p className={s.problem} role="alert">{messageOf(view.error)}</p>}
      {view.data && skills.length === 0 && <p className={s.quiet}>{t('team.skills.none', { name: agent.name })}</p>}
      {skills.length > 0 && <p className={s.quiet}>{t('team.skills.lead')}</p>}
      {skills.length > 0 && (
        <ul className={s.skills} aria-label={t('team.skills.list', { name: agent.name })}>
          {skills.map((skill) => (
            <li key={skill.name} className={s.skill}>
              <h4 className={s.skillName}>{skill.name}</h4>
              <p className={s.line}>{skill.line}</p>
              <p className={s.starter}>{skill.starter}</p>
              <div className={s.buttons}>
                <Button size="sm" onClick={() => onTry(skill.starter)}>{t('team.skills.try')}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
