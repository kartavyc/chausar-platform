import { useT } from '../../text';
import { useResource } from '../../engine/context';
import type { AgentView, Posture } from '../../engine/types';
import { refreshOn } from './shared';
import r from './Readiness.module.css';

/** The posture that is built but locked (W4 4J15): never offered as available, whatever the readiness says. */
export const LOCKED_POSTURE: Posture = 'auto-spot-check';

const dash = (n: number | null) => (n === null ? '-' : String(n));

/**
 * Under the posture choice (W4 4J22a, from 4J15; catalogue Q10, Q11): what the agent's shadow drafts would have done,
 * counted by the engine with a dash where a figure is unknown, and, folded one step away, what auto would need: each
 * item met or not with the engine's own line, and the lock. Both are reads; nothing here changes a posture.
 */
export function AutoReadiness({ agent }: { agent: AgentView }) {
  const t = useT();
  const shadow = useResource('venture.shadow.summary', { agent: agent.id }, { refreshOn });
  const readiness = useResource('venture.auto.readiness', { agent: agent.id }, { refreshOn });
  const summary = shadow.data;
  const ready = readiness.data;
  return (
    <div className={r.block}>
      {summary && (
        <p className={r.line} data-shadow="">
          {t('team.readiness.shadow', { gone: dash(summary.wouldHaveGone), held: dash(summary.held), changed: dash(summary.changed) })}
        </p>
      )}
      {ready && (
        <details className={r.fold} data-fold="readiness">
          <summary>{t('team.readiness.title')}</summary>
          {summary && summary.offers.length > 0 && (
            <ul className={r.list}>{summary.offers.map((offer, i) => <li key={i} data-offer="">{offer}</li>)}</ul>
          )}
          <ul className={r.list}>
            {ready.items.map((item) => (
              <li key={item.id} data-item={item.id} data-met={item.met ? '' : undefined}>
                {t('team.readiness.item', { word: t(item.met ? 'team.readiness.met' : 'team.readiness.notMet'), label: item.label, line: item.line })}
              </li>
            ))}
          </ul>
          <p className={r.line} data-lock="">{t('team.readiness.locked')}</p>
        </details>
      )}
    </div>
  );
}
