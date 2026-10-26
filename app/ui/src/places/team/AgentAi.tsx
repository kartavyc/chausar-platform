import { useId } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { TEMPLATES } from '../connections/YourAi';
import { refreshOn } from './shared';
import s from './Team.module.css';
import a from './AgentAi.module.css';

/**
 * Its AI (W4 4H2; catalogue M19), in the agent panel: each kind of job this agent's steps use (quick work, plans and
 * drafts), the AI that serves it now and that AI's price line, as the engine writes them (venture.models.roles, 4H1).
 * The team runs as one agent, so a role's AI is its kind of job's AI, chosen under Your AI; the engine's line says so,
 * and while no AI can run it also says that agents wait for one. A list price is the engine's words with no receipt,
 * so it is marked as its line: the engine's receipt kinds have none for a preset's price table. The engine's line on
 * how a role's AI is chosen sits one fold away.
 */
export function AgentAi({ agentId }: { agentId: string }) {
  const t = useT();
  const headingId = useId();
  const roles = useResource('venture.models.roles', {}, { refreshOn });
  const presets = useResource('venture.models.presets', {}, { refreshOn });
  const label = (presetId: string) => presets.data?.find((p) => p.id === presetId)?.label ?? presetId;
  const role = roles.data?.roles.find((r) => r.agent === agentId);
  return (
    <section className={s.section} aria-labelledby={headingId}>
      <h3 id={headingId} className={s.small}>{t('connections.cli.role.title')}</h3>
      {roles.error && <p className={s.failed}>{t('connections.cli.role.failed', { message: roles.error.message })}</p>}
      {!roles.data && !roles.error && <p className={s.quiet}>{t('connections.cli.role.loading')}</p>}
      {roles.data && !role && <p className={s.quiet}>{t('connections.cli.role.none')}</p>}
      {role && (
        <ul className={a.tiers}>
          {role.tiers.map((tier) => (
            <li key={tier.tier} className={a.tier} data-tier={tier.tier} data-usable={tier.usable ? '' : undefined}>
              <p className={a.name}>
                {t('connections.ai.tier', { job: t(`connections.ai.job.${tier.tier}`), name: label(tier.presetId) })}
                {!tier.usable && tier.presetId !== TEMPLATES && <span className={s.quiet}>{` · ${t('connections.cli.role.cantRun')}`}</span>}
              </p>
              <p className={s.quiet}><span data-engine-line="">{tier.price}</span></p>
            </li>
          ))}
        </ul>
      )}
      {/* How a role's AI is chosen, and that agents wait without one, one fold away. */}
      {roles.data && (
        <details className={a.how}>
          <summary>{t('connections.cli.role.how')}</summary>
          <p className={s.quiet}>{roles.data.line}</p>
        </details>
      )}
      <a className={s.link} href="#/connections/ai">{t('connections.cli.role.change')}</a>
    </section>
  );
}
